import { useState, useEffect, useCallback } from "react";
import { getUnclassified, suggestCategory, approveTransaction, getTaxonomy } from "../api";
import { Card, Label, Btn, Badge, Spinner, ConfBar, formatCHF, L1_COLORS } from "../components";

// ── localStorage cache for suggestions (CR-011) ───────────────────────────
const CACHE_KEY = "budget_suggestions_v1";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

function loadSuggestionsCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const { data, ts } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) { localStorage.removeItem(CACHE_KEY); return {}; }
    return data || {};
  } catch { return {}; }
}

function saveSuggestionsCache(data) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ data, ts: Date.now() })); } catch {}
}

function removeSuggestionFromCache(txId) {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    delete obj.data[txId];
    localStorage.setItem(CACHE_KEY, JSON.stringify(obj));
  } catch {}
}

function clearSuggestionsCache() {
  localStorage.removeItem(CACHE_KEY);
}

export default function Review() {
  const [items,      setItems]    = useState([]);
  const [tax,        setTax]      = useState({});
  const [suggestions,setSugg]     = useState(() => loadSuggestionsCache());
  const [suggesting, setSugging]  = useState(false);
  const [sel,        setSel]      = useState(null);
  const [editSugg,   setEditSugg] = useState(null);
  const [loading,    setLoading]  = useState(true);
  const [approving,  setApproving]= useState(false);
  const [sortMode,   setSortMode] = useState("l1");
  const [confThresh, setConfThresh]= useState(90);
  const [keyword,     setKeyword]    = useState("");
  const [keywordOnly, setKeywordOnly]= useState(false);
  const [search,      setSearch]     = useState("");

  useEffect(() => {
    Promise.all([getUnclassified(), getTaxonomy()])
      .then(([its, t]) => {
        setItems(its);
        setTax(t);
        // Auto-select first with cached suggestion, else first item
        const cached = loadSuggestionsCache();
        const first  = its.find(i => cached[i.id]) || its[0];
        if (first) setSel(first);
      })
      .finally(() => setLoading(false));
  }, []);

  // ── Suggest all (CR-011: save to cache) ───────────────────────────────────
  const suggestAll = async () => {
    setSugging(true);
    try {
      const pw  = localStorage.getItem("budget_pw") || "";
      const res = await fetch("/api/review/suggest-all", {
        method: "POST",
        headers: { "Authorization": `Basic ${btoa(`admin:${pw}`)}`, "Content-Type": "application/json" }
      });
      const data = await res.json();
      setSugg(data);
      saveSuggestionsCache(data);
      const first = items.find(i => data[i.id]);
      if (first) setSel(first);
    } finally { setSugging(false); }
  };

  // ── Single suggest ────────────────────────────────────────────────────────
  const suggestOne = async (tx) => {
    setSugging(true);
    try {
      const s = await suggestCategory(tx.id);
      const updated = { ...suggestions, [tx.id]: s };
      setSugg(updated);
      saveSuggestionsCache(updated);
      setEditSugg(s);
    } finally { setSugging(false); }
  };

  // ── Re-fetch unclassified list and preserve selection ─────────────────────
  const refreshList = async (removedIds = []) => {
    const fresh = await getUnclassified();
    setItems(fresh);
    // Keep selection if still unclassified, else pick first
    setSel(prev => fresh.find(t => t.id === prev?.id) || fresh[0] || null);
    removedIds.forEach(id => removeSuggestionFromCache(id));
    setEditSugg(null);
  };

  // ── Approve single — always apply to matching unreviewed transactions ──────
  const approveSingle = async (tx, retroYes = true) => {
    const s = editSugg || suggestions[tx.id];
    if (!s?.l1 || !s?.l2) return;
    setApproving(true);
    try {
      await approveTransaction(tx.id, { l1:s.l1, l2:s.l2, keyword, no_merchant: keywordOnly, apply_retrospective: retroYes });
      await refreshList([tx.id]);
    } finally { setApproving(false); }
  };

  // ── Approve group ─────────────────────────────────────────────────────────
  const approveGroup = async (groupItems) => {
    setApproving(true);
    try {
      for (const tx of groupItems) {
        const s = suggestions[tx.id];
        if (!s?.l1 || !s?.l2) continue;
        await approveTransaction(tx.id, { l1:s.l1, l2:s.l2, keyword:"", apply_retrospective: true });
      }
      await refreshList(groupItems.map(t => t.id));
    } finally { setApproving(false); }
  };

  // ── Bulk approve by confidence (CR-008) ───────────────────────────────────
  const bulkApproveByConfidence = async () => {
    const eligible = items.filter(tx => {
      const s = suggestions[tx.id];
      return s?.l1 && s?.l2 && (s.confidence || 0) * 100 >= confThresh;
    });
    if (!eligible.length) { alert("No suggestions above threshold"); return; }
    if (!confirm(`Approve ${eligible.length} transactions with ≥${confThresh}% confidence?`)) return;
    setApproving(true);
    try {
      for (const tx of eligible) {
        const s = suggestions[tx.id];
        await approveTransaction(tx.id, { l1:s.l1, l2:s.l2, keyword:"", apply_retrospective: true });
      }
      await refreshList(eligible.map(t => t.id));
    } finally { setApproving(false); }
  };

  // ── Search filter ─────────────────────────────────────────────────────────
  const getFiltered = () => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter(tx =>
      (tx.merchant_clean || "").toLowerCase().includes(q) ||
      (tx.raw_text || "").toLowerCase().includes(q)
    );
  };

  // ── Grouping ──────────────────────────────────────────────────────────────
  const groupBySuggestion = () => {
    const filtered = getFiltered();

    if (sortMode === "amount") {
      return [
        ["≥ CHF 500",  filtered.filter(tx => Math.abs(tx.amount) >= 500).sort((a,b) => Math.abs(b.amount)-Math.abs(a.amount))],
        ["CHF 50–500", filtered.filter(tx => Math.abs(tx.amount) >= 50 && Math.abs(tx.amount) < 500).sort((a,b) => Math.abs(b.amount)-Math.abs(a.amount))],
        ["< CHF 50",   filtered.filter(tx => Math.abs(tx.amount) < 50).sort((a,b) => Math.abs(b.amount)-Math.abs(a.amount))],
      ].filter(([,g]) => g.length > 0);
    }

    if (sortMode === "confidence") {
      const conf = tx => suggestions[tx.id]?.confidence || 0;
      return [
        ["HIGH ≥ 80%",    filtered.filter(tx => conf(tx) >= 0.8).sort((a,b) => conf(b)-conf(a))],
        ["MEDIUM 50–80%", filtered.filter(tx => conf(tx) >= 0.5 && conf(tx) < 0.8).sort((a,b) => conf(b)-conf(a))],
        ["LOW < 50%",     filtered.filter(tx => conf(tx) > 0 && conf(tx) < 0.5).sort((a,b) => conf(b)-conf(a))],
        ["NO SUGGESTION", filtered.filter(tx => !suggestions[tx.id])],
      ].filter(([,g]) => g.length > 0);
    }

    // l1 grouping (default)
    const groups = {};
    for (const tx of filtered) {
      const key = suggestions[tx.id]?.l1 || "⬜ No suggestion yet";
      (groups[key] = groups[key] || []).push(tx);
    }
    return Object.entries(groups).sort(([a],[b]) => {
      if (a.startsWith("⬜")) return 1;
      if (b.startsWith("⬜")) return -1;
      return a.localeCompare(b);
    });
  };

  const hasSuggestions  = Object.keys(suggestions).length > 0;
  const filtered        = getFiltered();
  const groups          = groupBySuggestion();
  const selSugg         = editSugg || (sel && suggestions[sel.id]);
  const cachedCount     = items.filter(tx => suggestions[tx.id]).length;
  const highConfCount   = items.filter(tx => (suggestions[tx.id]?.confidence||0)*100 >= confThresh).length;

  // L1/L2 filtered + sorted options
  const curL1 = editSugg?.l1 || selSugg?.l1 || "";
  const curL2 = editSugg?.l2 || selSugg?.l2 || "";
  const l1Options = curL2
    ? Object.keys(tax).filter(l1 => (tax[l1]||[]).includes(curL2)).sort()
    : Object.keys(tax).sort();

  if (loading) return <Spinner/>;

  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 400px", gap:20 }}>

      {/* ── LEFT: Inbox ── */}
      <Card style={{ padding:0, overflow:"hidden" }}>
        {/* Header */}
        <div style={{ padding:"16px 20px", borderBottom:"1px solid var(--border)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom: hasSuggestions ? 10 : 0 }}>
            <Label style={{ marginBottom:0 }}>
              UNCLASSIFIED — {search ? `${filtered.length} / ${items.length}` : items.length} PENDING
              {cachedCount > 0 && <span style={{ color:"var(--green)", marginLeft:8 }}>✓ {cachedCount} suggested</span>}
            </Label>
            <div style={{ display:"flex", gap:8, alignItems:"center" }}>
              {hasSuggestions && <Btn small variant="ghost" onClick={()=>{ clearSuggestionsCache(); setSugg({}); }}>✕ Clear</Btn>}
              <Btn small variant="primary" onClick={suggestAll} disabled={suggesting||items.length===0}>
                {suggesting ? "ASKING AI…" : hasSuggestions ? "↺ REFRESH" : "✦ SUGGEST ALL"}
              </Btn>
            </div>
          </div>

          {/* Search */}
          <div style={{ marginTop:10 }}>
            <input
              placeholder="Search merchant or booking text…"
              value={search} onChange={e => setSearch(e.target.value)}
              style={{ width:"100%", background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"6px 10px", color:"var(--text)", fontFamily:"inherit", fontSize:12, boxSizing:"border-box" }}
            />
          </div>

          {/* Sort + bulk approve controls — shown after suggestions loaded */}
          {hasSuggestions && (
            <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", marginTop:8 }}>
              <span style={{ fontSize:9, color:"var(--muted)", letterSpacing:"0.1em" }}>GROUP BY</span>
              {[["l1","L1"],["confidence","CONFIDENCE ↓"],["amount","AMOUNT ↓"]].map(([v,l]) => (
                <button key={v} onClick={()=>setSortMode(v)}
                  style={{ background: sortMode===v?"var(--accent)":"var(--faint)", color: sortMode===v?"#fff":"var(--muted)", border:`1px solid ${sortMode===v?"var(--accent)":"var(--border)"}`, borderRadius:4, padding:"3px 10px", fontSize:10, cursor:"pointer", fontFamily:"inherit" }}>
                  {l}
                </button>
              ))}
              <div style={{ marginLeft:"auto", display:"flex", gap:6, alignItems:"center" }}>
                <select value={confThresh} onChange={e=>setConfThresh(+e.target.value)}
                  style={{ background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"3px 8px", fontSize:10, color:"var(--text)", fontFamily:"inherit" }}>
                  {[70,80,85,90,95].map(v=><option key={v} value={v}>≥{v}%</option>)}
                </select>
                <Btn small variant="green" onClick={bulkApproveByConfidence} disabled={approving||highConfCount===0}>
                  ✓ APPROVE {highConfCount}
                </Btn>
              </div>
            </div>
          )}
        </div>

        {/* Transaction list */}
        <div style={{ overflowY:"auto", maxHeight:"calc(100vh - 260px)" }}>
          {items.length === 0 && (
            <div style={{ padding:32, fontSize:12, color:"var(--green)", textAlign:"center" }}>✓ All classified</div>
          )}
          {groups.map(([l1Key, groupItems]) => {
            const color   = L1_COLORS[l1Key] || "#888";
            const hasSugg = !l1Key.startsWith("⬜") && l1Key !== "— sorted —";
            const allHaveL2 = groupItems.every(tx => { const s=suggestions[tx.id]; return s?.l1&&s?.l2; });

            return (
              <div key={l1Key}>
                <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"7px 20px", background:"var(--surface2)", borderBottom:"1px solid var(--faint)" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                    <div style={{ width:3, height:14, borderRadius:2, background:hasSugg?color:"var(--border)" }}/>
                    <span style={{ fontSize:10, letterSpacing:"0.1em", color:hasSugg?color:"var(--muted)" }}>{l1Key.toUpperCase()}</span>
                    <span style={{ fontSize:10, color:"var(--muted)" }}>({groupItems.length})</span>
                  </div>
                  {sortMode === "l1" && hasSugg && allHaveL2 && (
                    <Btn small variant="green" onClick={()=>approveGroup(groupItems)} disabled={approving}>
                      ✓ APPROVE ALL
                    </Btn>
                  )}
                </div>
                {groupItems.map(tx => {
                  const s     = suggestions[tx.id];
                  const isSel = sel?.id === tx.id;
                  const color2= L1_COLORS[s?.l1] || "#888";
                  return (
                    <div key={tx.id} onClick={()=>{setSel(tx);setEditSugg(null);setKeyword("");setKeywordOnly(false);}}
                      style={{ display:"flex", borderBottom:"1px solid var(--faint)", cursor:"pointer", background:isSel?"var(--accent-bg)":"transparent", transition:"background 0.12s" }}>
                      <div style={{ width:3, flexShrink:0, alignSelf:"stretch", background:isSel?color2:"transparent" }}/>
                      <div style={{ flex:1, padding:"10px 16px" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:3 }}>
                          <span style={{ fontSize:12, color:"var(--text)", fontWeight:500 }}>{tx.merchant_clean}</span>
                          <span style={{ fontSize:12, color:tx.amount>=0?"var(--green)":"var(--red)", fontVariantNumeric:"tabular-nums" }}>{formatCHF(tx.amount)}</span>
                        </div>
                        <div style={{ display:"flex", gap:8, alignItems:"center" }}>
                          <span style={{ fontSize:10, color:"var(--muted)" }}>{tx.date} · {tx.account_name}</span>
                          {s && <ConfBar value={s.confidence}/>}
                          {s?.l2 && <span style={{ fontSize:10, color:color2 }}>→ {s.l1} / {s.l2}</span>}
                          {tx.merchant_clean === "Unknown" && <span style={{ fontSize:9, color:"var(--orange)" }}>⚠ unknown merchant</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── RIGHT: Detail panel — sticky (CR-009) ── */}
      {sel && (
        <div style={{ display:"flex", flexDirection:"column", gap:16, position:"sticky", top:70, alignSelf:"start", maxHeight:"calc(100vh - 90px)", overflowY:"auto" }}>
          <Card>
            <Label>
              {sel.merchant_clean === "Unknown"
                ? <span style={{ color:"var(--orange)" }}>⚠ UNKNOWN MERCHANT — enter keyword below</span>
                : "BOOKING TEXT"}
            </Label>

            {/* Raw text — larger when merchant unknown (CR-010) */}
            <div style={{ background:sel.merchant_clean==="Unknown"?"var(--orange)10":"var(--faint)", border:sel.merchant_clean==="Unknown"?`1px solid var(--orange)30`:"none", borderRadius:6, padding:"10px 12px", fontSize:sel.merchant_clean==="Unknown"?12:11, color:"var(--text2)", fontFamily:"monospace", lineHeight:1.6, marginBottom:14, wordBreak:"break-all" }}>
              {sel.raw_text}
            </div>

            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:14 }}>
              <span style={{ fontSize:12, color:"var(--text)" }}>{sel.merchant_clean}</span>
              <span style={{ fontSize:14, color:"var(--red)", fontVariantNumeric:"tabular-nums" }}>CHF {formatCHF(sel.amount)}</span>
            </div>

            {/* AI suggestion */}
            {selSugg?.l1 && (
              <div style={{ background:"var(--accent-bg)", border:"1px solid var(--accent)30", borderRadius:6, padding:12, marginBottom:14 }}>
                <div style={{ fontSize:9, letterSpacing:"0.12em", color:"var(--accent)", marginBottom:8 }}>AI SUGGESTION</div>
                <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
                  <Badge label={selSugg.l1} color={L1_COLORS[selSugg.l1]||"#888"}/>
                  <span style={{ fontSize:10, color:"var(--muted)" }}>→</span>
                  <span style={{ fontSize:11, color:"var(--text)" }}>{selSugg.l2}</span>
                </div>
                <ConfBar value={selSugg.confidence}/>
                {/* CR-007: merchant info */}
                {(selSugg.merchant_name || selSugg.place || selSugg.business_type) && (
                  <div style={{ marginTop:8, padding:"6px 8px", background:"var(--faint)", borderRadius:4, fontSize:10, color:"var(--text2)", lineHeight:1.7 }}>
                    {selSugg.merchant_name && <div><span style={{ color:"var(--muted)" }}>NAME </span>{selSugg.merchant_name}</div>}
                    {selSugg.place        && <div><span style={{ color:"var(--muted)" }}>PLACE </span>{selSugg.place}</div>}
                    {selSugg.business_type&& <div><span style={{ color:"var(--muted)" }}>TYPE </span>{selSugg.business_type}</div>}
                  </div>
                )}
                {selSugg.reasoning && (
                  <div style={{ fontSize:10, color:"var(--muted)", marginTop:4, fontStyle:"italic" }}>{selSugg.reasoning}</div>
                )}
              </div>
            )}

            {!selSugg && (
              <Btn small variant="primary" onClick={()=>suggestOne(sel)} disabled={suggesting} style={{ marginBottom:14 }}>
                {suggesting ? "ASKING AI…" : "✦ GET AI SUGGESTION"}
              </Btn>
            )}

            {/* L1/L2 — mutually filtered, both alphabetical */}
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, color:"var(--muted)", marginBottom:5, letterSpacing:"0.08em" }}>L1 (CATEGORY)</div>
              <select value={curL1} onChange={e=>setEditSugg({...(editSugg||selSugg||{}),l1:e.target.value,l2:""})}
                style={{ width:"100%", background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"7px 10px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:12 }}>
                <option value="">Select category…</option>
                {l1Options.map(l=><option key={l}>{l}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, color:"var(--muted)", marginBottom:5, letterSpacing:"0.08em" }}>L2 (SUBCATEGORY)</div>
              <select
                value={curL1 ? curL2 : ""}
                onChange={e => {
                  const val = e.target.value;
                  if (curL1) {
                    setEditSugg({...(editSugg||selSugg||{}), l1: curL1, l2: val});
                  } else {
                    const sep = val.indexOf("||");
                    const l1 = val.slice(0, sep);
                    const l2 = val.slice(sep + 2);
                    setEditSugg({...(editSugg||selSugg||{}), l1, l2});
                  }
                }}
                style={{ width:"100%", background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"7px 10px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:12 }}>
                <option value="">Select subcategory…</option>
                {curL1
                  ? (tax[curL1]||[]).slice().sort().map(l2 =>
                      <option key={l2} value={l2}>{l2}</option>)
                  : Object.entries(tax)
                      .flatMap(([l1, l2s]) => l2s.map(l2 => ({ l1, l2 })))
                      .sort((a, b) => a.l2.localeCompare(b.l2))
                      .map(({l1, l2}) =>
                        <option key={`${l1}||${l2}`} value={`${l1}||${l2}`}>{l2} ({l1})</option>)}
              </select>
            </div>

            {/* Keyword */}
            <div style={{ marginBottom:16 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                <div style={{ fontSize:10, color:sel.merchant_clean==="Unknown"?"var(--orange)":"var(--muted)", letterSpacing:"0.08em" }}>
                  {sel.merchant_clean==="Unknown" ? "⚠ KEYWORD REQUIRED" : "KEYWORD FILTER (optional)"}
                </div>
                <label style={{ display:"flex", alignItems:"center", gap:5, cursor:"pointer", fontSize:10, color: keywordOnly?"var(--accent)":"var(--muted)" }}>
                  <input type="checkbox" checked={keywordOnly} onChange={e=>setKeywordOnly(e.target.checked)}
                    style={{ accentColor:"var(--accent)", cursor:"pointer" }}/>
                  KEYWORD ONLY RULE
                </label>
              </div>
              <input
                autoFocus={sel.merchant_clean==="Unknown"}
                placeholder={keywordOnly ? "Keyword to match (no merchant)" : sel.merchant_clean==="Unknown" ? "Enter keyword from booking text above…" : "Narrows rule scope…"}
                style={{ width:"100%", background: keywordOnly?"var(--accent)10":sel.merchant_clean==="Unknown"?"var(--orange)08":"var(--faint)", border:`1px solid ${keywordOnly?"var(--accent)":sel.merchant_clean==="Unknown"?"var(--orange)":"var(--border)"}`, borderRadius:4, padding:"7px 10px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:12 }}
                value={keyword} onChange={e=>setKeyword(e.target.value)}
              />
              {keywordOnly && <div style={{ fontSize:9, color:"var(--accent)", marginTop:4 }}>Rule will match by keyword only — merchant name ignored</div>}
            </div>

            {/* Mark as internal transfer */}
            <Btn variant="ghost" style={{ width:"100%", marginBottom:8, color:"var(--orange)", border:"1px solid var(--orange)50" }}
              disabled={approving}
              onClick={async () => {
                setApproving(true);
                try {
                  const pw = localStorage.getItem("budget_pw") || "";
                  await fetch(`/api/transactions/${sel.id}`, {
                    method:"PATCH",
                    headers:{"Authorization":`Basic ${btoa(`admin:${pw}`)}`, "Content-Type":"application/json"},
                    body: JSON.stringify({is_internal:1, l1:"Finance & Admin", l2:"Internal Transfer"})
                  });
                  await refreshList([sel.id]);
                } finally { setApproving(false); }
              }}>
              ⇄ MARK AS INTERNAL TRANSFER
            </Btn>

            <div style={{ display:"flex", gap:8 }}>
              {/* CR-001: This transaction only — no rule saved */}
              <Btn variant="default" small
                disabled={!(editSugg?.l1||selSugg?.l1)||approving}
                onClick={async () => {
                  if ((sel.merchant_clean==="Unknown"||keywordOnly)&&!keyword) { alert("Please enter a keyword"); return; }
                  await approveSingle(sel, false);
                  setKeyword(""); setKeywordOnly(false);
                }}>
                THIS ONLY
              </Btn>
              <Btn variant="green" style={{ flex:1 }}
                disabled={!(editSugg?.l1||selSugg?.l1)||(keywordOnly&&!keyword)||approving}
                onClick={async () => {
                  if ((sel.merchant_clean==="Unknown"||keywordOnly)&&!keyword) { alert("Please enter a keyword"); return; }
                  await approveSingle(sel, true);
                  setKeyword(""); setKeywordOnly(false);
                }}>
                ✓ CONFIRM + SAVE RULE
              </Btn>
              <Btn variant="ghost" onClick={()=>{
                removeSuggestionFromCache(sel.id);
                const remain = items.filter(x=>x.id!==sel.id);
                setItems(remain); setSel(remain[0]||null); setEditSugg(null);
              }}>SKIP</Btn>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
