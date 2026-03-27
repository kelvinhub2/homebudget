import { useState, useEffect } from "react";
import { getRules, createRule, updateRule, deleteRule, testRule, recategorize, getTaxonomy } from "../api";
import { Card, Label, Btn, Badge, Spinner, formatCHF, L1_COLORS } from "../components";

export default function Rules() {
  const [rules,    setRules]    = useState([]);
  const [taxonomy, setTaxonomy] = useState({});
  const [testStr,  setTestStr]  = useState("");
  const [testRes,  setTestRes]  = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [editing,  setEditing]  = useState(null);
  const [adding,   setAdding]   = useState(false);
  const [running,  setRunning]  = useState(false);   // CR-024
  const [runMsg,   setRunMsg]   = useState(null);    // CR-024
  const [search,   setSearch]   = useState("");      // CR-016

  const load = () => {
    Promise.all([getRules(), getTaxonomy()])
      .then(([r,t]) => { setRules(r); setTaxonomy(t); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const doTest = async () => {
    if (!testStr.trim()) return;
    try { setTestRes(await testRule(testStr)); } catch(e) { setTestRes({ error: e.message }); }
  };

  // CR-024: improved RE-RUN ALL
  const doRecategorize = async () => {
    setRunning(true); setRunMsg(null);
    try {
      const r = await recategorize();
      setRunMsg(`✓ ${r.updated} transactions updated`);
      setTimeout(() => setRunMsg(null), 4000);
    } catch(e) {
      setRunMsg(`✗ Error: ${e.message}`);
    } finally {
      setRunning(false);
    }
  };

  const saveRule = async (rule) => {
    if (rule.id) await updateRule(rule.id, rule);
    else         await createRule(rule);
    setEditing(null); setAdding(false); load();
  };

  // CR-013: duplicate rule
  const duplicateRule = (rule) => {
    setAdding(true);
    setEditing({ ...rule, id: null, priority: rule.priority + 1 });
  };

  const doDelete = async (id) => {
    if (!confirm("Delete this rule?")) return;
    await deleteRule(id); load();
  };

  const l1List = Object.keys(taxonomy);
  const newRule = { merchant:"", keyword:"", l1:"", l2:"", priority:500, is_recurring:0, is_internal:0, active:1 };

  // CR-016: filter rules
  const filteredRules = search.trim()
    ? rules.filter(r =>
        (r.merchant||"").toLowerCase().includes(search.toLowerCase()) ||
        (r.keyword||"").toLowerCase().includes(search.toLowerCase()) ||
        (r.l1||"").toLowerCase().includes(search.toLowerCase()) ||
        (r.l2||"").toLowerCase().includes(search.toLowerCase())
      )
    : rules;

  if (loading) return <Spinner/>;

  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 300px", gap:20 }}>
      {/* Rules list */}
      <Card>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <Label style={{ marginBottom:0 }}>RULES — {rules.length} TOTAL · FIRST-MATCH-WINS</Label>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            {runMsg && <span style={{ fontSize:11, color: runMsg.startsWith("✓") ? "var(--green)" : "var(--red)" }}>{runMsg}</span>}
            <Btn small variant="primary" onClick={doRecategorize} disabled={running}>
              {running ? "Running…" : "↺ RE-RUN ALL"}
            </Btn>
            <Btn small variant="primary" onClick={()=>{ setAdding(true); setEditing(newRule); }}>+ NEW</Btn>
          </div>
        </div>

        {/* CR-016: search bar */}
        <input
          placeholder="Search merchant, keyword, L1, L2…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width:"100%", marginBottom:12, padding:"6px 10px", fontSize:12, boxSizing:"border-box" }}
        />

        <div style={{ display:"grid", gridTemplateColumns:"44px 1fr 140px 120px 60px 40px 50px 80px", gap:8, paddingBottom:10, borderBottom:"1px solid var(--border)" }}>
          {["PRIO","MERCHANT / KEYWORD","L1","L2","RECUR.","INT.","ON",""].map(h=>(
            <div key={h} style={{ fontSize:9, letterSpacing:"0.12em", color:"var(--muted)" }}>{h}</div>
          ))}
        </div>

        {filteredRules.length === 0 && search && (
          <div style={{ padding:"20px 0", color:"var(--muted)", fontSize:12, textAlign:"center" }}>No rules match "{search}"</div>
        )}
        {filteredRules.map(r => (
          <div key={r.id} style={{ display:"grid", gridTemplateColumns:"44px 1fr 140px 120px 60px 40px 50px 80px", gap:8, padding:"10px 0", borderBottom:"1px solid var(--faint)", alignItems:"center", fontSize:11, opacity:r.fallback?0.45:1 }}>
            <div style={{ color:"var(--muted)", fontSize:10, fontFamily:"monospace" }}>{r.priority}</div>
            <div>
              <div style={{ color:"var(--text)" }}>{r.merchant}</div>
              {r.keyword && (
                <div style={{ display:"flex", flexWrap:"wrap", gap:4, marginTop:3 }}>
                  {r.keyword.split(";").map((kw,i) => (
                    <span key={i} style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
                      {i > 0 && <span style={{ fontSize:9, color:"var(--muted)" }}>·</span>}
                      <span style={{ fontSize:10, color:"var(--accent)", fontFamily:"monospace", background:"var(--accent-bg)", padding:"1px 5px", borderRadius:3 }}>{kw.trim()}</span>
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div>{r.l1?<Badge label={r.l1} color={L1_COLORS[r.l1]||"#888"}/>:<span style={{color:"var(--muted)"}}>—</span>}</div>
            <div style={{ color:"var(--text2)", fontSize:11 }}>{r.l2||"—"}</div>
            <div style={{ fontSize:10, color:r.is_recurring?"var(--green)":"var(--muted)" }}>{r.is_recurring?"↺":"—"}</div>
            <div style={{ fontSize:10, color:r.is_internal?"var(--orange)":"var(--muted)" }}>{r.is_internal?"⇄":"—"}</div>
            <div>
              <span style={{ width:7, height:7, borderRadius:"50%", background:r.active?"var(--green)":"#888", display:"inline-block", cursor:"pointer" }}
                onClick={()=>updateRule(r.id,{active:r.active?0:1}).then(load)}/>
            </div>
            <div style={{ display:"flex", gap:6 }}>
              <span style={{ cursor:"pointer", color:"var(--muted)", fontSize:12 }} title="Edit" onClick={()=>setEditing({...r})}>✎</span>
              <span style={{ cursor:"pointer", color:"var(--muted)", fontSize:12 }} title="Duplicate" onClick={()=>duplicateRule(r)}>⧉</span>
              <span style={{ cursor:"pointer", color:"var(--red)", fontSize:12 }} title="Delete" onClick={()=>doDelete(r.id)}>✕</span>
            </div>
          </div>
        ))}
        <div style={{ marginTop:10, fontSize:10, color:"var(--muted)", padding:"8px 0", borderTop:"1px solid var(--faint)" }}>
          Lower priority number = matched first · Generic fallbacks should have priority 980+
        </div>
      </Card>

      {/* Right panel */}
      <div style={{ display:"flex", flexDirection:"column", gap:16 }}>
        <Card>
          <Label>RULE TESTER</Label>
          <textarea value={testStr} onChange={e=>setTestStr(e.target.value)} rows={4}
            placeholder={"Paste booking text here…\ne.g. TWINT-Zahlung / MIGROS MUTTENZ"}
            style={{ width:"100%", background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"8px 10px", color:"var(--text)", fontFamily:"monospace", fontSize:11, resize:"vertical", marginBottom:10 }}/>
          <Btn variant="primary" small style={{ width:"100%" }} onClick={doTest}>TEST</Btn>
          {testRes && (
            <div style={{ marginTop:10, padding:10, background:testRes.rule_id?"var(--green-bg)":"var(--red-bg)", border:`1px solid ${testRes.rule_id?"var(--green)":"var(--red)"}30`, borderRadius:4 }}>
              <div style={{ fontSize:10, color:testRes.rule_id?"var(--green)":"var(--red)", marginBottom:4 }}>
                {testRes.error ? `ERROR: ${testRes.error}` : testRes.rule_id ? `MATCH — Rule #${testRes.rule_id}` : "NO MATCH"}
              </div>
              {testRes.rule_id && (
                <div style={{ fontSize:11, color:"var(--text)" }}>
                  {testRes.merchant_extracted} → <strong>{testRes.l1}</strong> / {testRes.l2}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* Edit / Add modal */}
      {(editing || adding) && (
        <RuleModal
          rule={editing || newRule}
          taxonomy={taxonomy}
          onSave={saveRule}
          onClose={()=>{ setEditing(null); setAdding(false); }}
        />
      )}
    </div>
  );
}

function RuleModal({ rule, taxonomy, onSave, onClose }) {
  const [form, setForm] = useState({...rule});
  const l1List = Object.keys(taxonomy);
  const l2List = taxonomy[form.l1] || [];

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
      <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:10, padding:24, width:420, boxShadow:"0 8px 32px rgba(0,0,0,0.2)" }}>
        <Label>{form.id ? "EDIT RULE" : "NEW RULE"}</Label>

        {[["MERCHANT",    "merchant",  "text",   "e.g. Migros"],
          ["KEYWORD  ( ; = OR  ·  space = AND )", "keyword", "text", "e.g. Geld erhalten;Geld gesendet"],
          ["PRIORITY",    "priority",  "number", "lower = higher priority"],
        ].map(([label, key, type, ph]) => (
          <div key={key} style={{ marginBottom:10 }}>
            <div style={{ fontSize:10, color:"var(--muted)", marginBottom:5 }}>{label}</div>
            <input type={type} value={form[key]||""} onChange={e=>setForm({...form,[key]:type==="number"?+e.target.value:e.target.value})}
              placeholder={ph}
              style={{ width:"100%", background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"7px 10px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:12 }}/>
          </div>
        ))}

        <div style={{ marginBottom:10 }}>
          <div style={{ fontSize:10, color:"var(--muted)", marginBottom:5 }}>L1</div>
          <select value={form.l1||""} onChange={e=>setForm({...form,l1:e.target.value,l2:""})}
            style={{ width:"100%", background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"7px 10px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:12 }}>
            <option value="">Select…</option>
            {l1List.map(l=><option key={l}>{l}</option>)}
          </select>
        </div>
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:10, color:"var(--muted)", marginBottom:5 }}>L2</div>
          <select value={form.l2||""} onChange={e=>setForm({...form,l2:e.target.value})} disabled={!form.l1}
            style={{ width:"100%", background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"7px 10px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:12 }}>
            <option value="">Select…</option>
            {l2List.map(l=><option key={l}>{l}</option>)}
          </select>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
          <input type="checkbox" checked={!!form.is_recurring} onChange={e=>setForm({...form,is_recurring:e.target.checked?1:0})} id="rec"/>
          <label htmlFor="rec" style={{ fontSize:11, color:"var(--text2)", cursor:"pointer" }}>Mark matched transactions as recurring</label>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:20, padding:"8px 10px", background:form.is_internal?"var(--orange)18":"var(--faint)", border:`1px solid ${form.is_internal?"var(--orange)60":"var(--border)"}`, borderRadius:6 }}>
          <input type="checkbox" checked={!!form.is_internal} onChange={e=>setForm({...form,is_internal:e.target.checked?1:0})} id="isint" style={{ accentColor:"var(--orange)", cursor:"pointer" }}/>
          <label htmlFor="isint" style={{ fontSize:11, color:form.is_internal?"var(--orange)":"var(--text2)", cursor:"pointer" }}>Mark matched transactions as internal transfer (excluded from reports)</label>
        </div>

        <div style={{ display:"flex", gap:8 }}>
          <Btn variant="primary" style={{ flex:1 }} disabled={(!form.merchant && !form.keyword)||!form.l1} onClick={()=>onSave(form)}>SAVE</Btn>
          <Btn onClick={onClose}>CANCEL</Btn>
        </div>
      </div>
    </div>
  );
}
