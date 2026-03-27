import { useState, useEffect } from "react";
import { recategorize, migrateInternal, getTaxonomy, getTaxonomyCounts,
         addTaxonomy, renameTaxonomy, deleteTaxonomy, deleteTaxonomyL1 } from "../api";
import { Card, Label, Btn, Spinner } from "../components";

async function getCoverage() {
  const pw  = localStorage.getItem("budget_pw") || "";
  const res = await fetch("/api/accounts/coverage", {
    headers: { "Authorization": `Basic ${btoa(`admin:${pw}`)}` }
  });
  return res.json();
}

const inputStyle = {
  background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4,
  color:"var(--text)", fontSize:12, padding:"4px 8px", outline:"none", fontFamily:"inherit",
};
const selectStyle = { ...inputStyle, cursor:"pointer" };

export default function Maintenance() {
  const [coverage,  setCoverage]  = useState([]);
  const [taxonomy,  setTaxonomy]  = useState({});
  const [counts,    setCounts]    = useState({});
  const [loading,   setLoading]   = useState(true);

  // Taxonomy editor state — at most one operation open at a time
  const [editing,  setEditing]  = useState(null); // {type:'l1'|'l2', l1, l2?, val}
  const [deleting, setDeleting] = useState(null); // {type:'l1'|'l2', l1, l2?, toL1, toL2}
  const [moving,   setMoving]   = useState(null); // {l1, l2, toL1}
  const [adding,   setAdding]   = useState(null); // {type:'l1',l1Val,l2Val}|{type:'l2',l1,val}
  const [taxBusy,  setTaxBusy]  = useState(false);
  const [taxError, setTaxError] = useState(null);

  const load = () => {
    setLoading(true);
    Promise.all([getCoverage(), getTaxonomy(), getTaxonomyCounts()])
      .then(([cov, t, c]) => { setCoverage(cov); setTaxonomy(t); setCounts(c); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const closeAll = () => { setEditing(null); setDeleting(null); setMoving(null); setAdding(null); };

  const taxAction = async (fn) => {
    setTaxBusy(true); setTaxError(null);
    try {
      await fn();
      const [t, c] = await Promise.all([getTaxonomy(), getTaxonomyCounts()]);
      setTaxonomy(t); setCounts(c);
      closeAll();
    } catch (e) {
      setTaxError(e.message || "Error");
    } finally {
      setTaxBusy(false);
    }
  };

  // Timeline helpers
  const allDates  = coverage.flatMap(c => [c.date_from, c.date_to]).filter(Boolean).sort();
  const MIN_DATE  = allDates[0]?.slice(0,7) || "2021-01";
  const MAX_DATE  = new Date().toISOString().slice(0,7);
  const monthsBetween = (a, b) => {
    if (!a || !b) return 0;
    const [ay,am] = a.split("-").map(Number);
    const [by,bm] = b.split("-").map(Number);
    return Math.max(1, (by-ay)*12+(bm-am));
  };
  const totalMonths = monthsBetween(MIN_DATE, MAX_DATE) || 1;
  const pct = (d) => d ? Math.min(100, monthsBetween(MIN_DATE, d.slice(0,7)) / totalMonths * 100) : 0;
  const startYear = parseInt(MIN_DATE.split("-")[0]);
  const endYear   = parseInt(MAX_DATE.split("-")[0]);
  const years = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);

  if (loading) return <Spinner/>;

  const l1List    = Object.keys(taxonomy);
  const l1Options = (excludeL1) => l1List.filter(l => l !== excludeL1);

  // Count helper: how many tx + rules are in a category
  const needsReassign = (l1, l2) => {
    const d = counts[l1]?.l2s?.[l2];
    return d ? (d.tx > 0 || d.rules > 0) : false;
  };
  const l1NeedsReassign = (l1) => {
    const d = counts[l1];
    return d ? (d.total_tx > 0 || d.total_rules > 0) : false;
  };

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:20 }}>

      {/* Coverage timeline */}
      <Card>
        <Label>DATA COVERAGE — TRANSACTION DATE RANGE PER ACCOUNT</Label>
        <div style={{ display:"flex", justifyContent:"space-between", marginBottom:10 }}>
          {years.map(y => (
            <span key={y} style={{ fontSize:9, color:"var(--muted)", letterSpacing:"0.1em" }}>{y}</span>
          ))}
        </div>
        {coverage.length === 0 && (
          <div style={{ fontSize:11, color:"var(--muted)" }}>No accounts found — import data first</div>
        )}
        {coverage.map(src => (
          <div key={src.id} style={{ display:"grid", gridTemplateColumns:"180px 1fr 140px", gap:12, alignItems:"center", marginBottom:10 }}>
            <div>
              <div style={{ fontSize:11, color:"var(--text2)" }}>{src.name}</div>
              <div style={{ fontSize:9, color:"var(--muted)" }}>{src.owner} · {src.tx_count} tx</div>
            </div>
            <div style={{ background:"var(--faint)", borderRadius:4, height:20, position:"relative" }}>
              {src.date_from && src.date_to ? (
                <div style={{
                  position:"absolute", left:`${pct(src.date_from)}%`,
                  width:`${Math.max(1, pct(src.date_to) - pct(src.date_from))}%`,
                  height:"100%", background:"var(--accent)", borderRadius:3, opacity:0.7, minWidth:4,
                }}/>
              ) : (
                <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", paddingLeft:8 }}>
                  <span style={{ fontSize:9, color:"var(--muted)" }}>no data</span>
                </div>
              )}
            </div>
            <div style={{ fontSize:10, color:"var(--muted)", textAlign:"right" }}>
              {src.date_from && src.date_to
                ? `${src.date_from.slice(0,7)} → ${src.date_to.slice(0,7)}`
                : "—"}
            </div>
          </div>
        ))}
      </Card>

      {/* Data operations */}
      <Card>
        <Label>DATA OPERATIONS</Label>
        {[
          {
            label: "Re-run categorization",
            desc:  "Apply all active rules to non-reviewed transactions",
            action: async () => { const r = await recategorize(); alert(`Updated ${r.updated} transactions`); },
          },
          {
            label: "Migrate L2 label → is_internal",
            desc:  'Convert all transactions with L2 = "Internal Transfer" to true internal transfers (excluded from reports)',
            action: async () => {
              const l2 = prompt('Convert which L2 label to is_internal=1?', 'Internal Transfer');
              if (!l2) return;
              const r = await migrateInternal(l2);
              alert(`Migrated ${r.migrated} transactions from L2 "${r.l2}" to is_internal=1`);
            },
          },
        ].map(op => (
          <div key={op.label} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"12px", background:"var(--surface2)", borderRadius:6, border:"1px solid var(--border)", marginBottom:8 }}>
            <div>
              <div style={{ fontSize:12, color:"var(--text)", marginBottom:2 }}>{op.label}</div>
              <div style={{ fontSize:10, color:"var(--muted)" }}>{op.desc}</div>
            </div>
            <Btn small onClick={op.action}>RUN</Btn>
          </div>
        ))}
      </Card>

      {/* Taxonomy Editor */}
      <Card>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
          <Label style={{ marginBottom:0 }}>TAXONOMY EDITOR</Label>
          <Btn small onClick={() => { closeAll(); setAdding({type:'l1', l1Val:'', l2Val:''}); }}>
            + NEW CATEGORY
          </Btn>
        </div>

        {taxError && (
          <div style={{ fontSize:11, color:"var(--red)", background:"var(--red-bg)", padding:"8px 12px", borderRadius:4, marginBottom:12 }}>
            {taxError}
          </div>
        )}

        {/* Add new L1 form */}
        {adding?.type === 'l1' && (
          <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", padding:12, background:"var(--accent-bg)", border:"1px solid var(--border)", borderRadius:6, marginBottom:12 }}>
            <input autoFocus style={{ ...inputStyle, width:160 }} placeholder="Category name (L1)"
              value={adding.l1Val} onChange={e => setAdding({...adding, l1Val: e.target.value})} />
            <span style={{ color:"var(--muted)" }}>/</span>
            <input style={{ ...inputStyle, width:160 }} placeholder="First subcategory (L2)"
              value={adding.l2Val} onChange={e => setAdding({...adding, l2Val: e.target.value})}
              onKeyDown={e => {
                if (e.key === 'Enter' && adding.l1Val.trim() && adding.l2Val.trim())
                  taxAction(() => addTaxonomy({l1: adding.l1Val.trim(), l2: adding.l2Val.trim()}));
                if (e.key === 'Escape') closeAll();
              }} />
            <Btn small variant="primary"
              disabled={!adding.l1Val.trim() || !adding.l2Val.trim() || taxBusy}
              onClick={() => taxAction(() => addTaxonomy({l1: adding.l1Val.trim(), l2: adding.l2Val.trim()}))}>
              ADD
            </Btn>
            <Btn small onClick={closeAll}>CANCEL</Btn>
          </div>
        )}

        {/* L1 sections */}
        {l1List.map(l1 => {
          const l2s          = taxonomy[l1] || [];
          const l1Counts     = counts[l1];
          const totalTx      = l1Counts?.total_tx || 0;
          const isEditingL1  = editing?.type  === 'l1' && editing.l1  === l1;
          const isDeletingL1 = deleting?.type === 'l1' && deleting.l1 === l1;

          return (
            <div key={l1} style={{ border:"1px solid var(--border)", borderRadius:6, marginBottom:8, overflow:"hidden" }}>

              {/* L1 header row */}
              <div style={{
                display:"flex", alignItems:"center", gap:10, padding:"10px 14px",
                background:"var(--surface2)",
                borderBottom:(isEditingL1 || isDeletingL1) ? "1px solid var(--border)" : "none",
              }}>
                {isEditingL1 ? (
                  <>
                    <input autoFocus style={{ ...inputStyle, flex:1 }} value={editing.val}
                      onChange={e => setEditing({...editing, val: e.target.value})}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && editing.val.trim())
                          taxAction(() => renameTaxonomy({old_l1: l1, new_l1: editing.val.trim()}));
                        if (e.key === 'Escape') closeAll();
                      }} />
                    <Btn small variant="primary" disabled={!editing.val.trim() || taxBusy}
                      onClick={() => taxAction(() => renameTaxonomy({old_l1: l1, new_l1: editing.val.trim()}))}>
                      SAVE
                    </Btn>
                    <Btn small onClick={closeAll}>CANCEL</Btn>
                  </>
                ) : (
                  <>
                    <span style={{ fontSize:12, fontWeight:500, color:"var(--text)", flex:1 }}>{l1}</span>
                    <span style={{ fontSize:10, color:"var(--muted)" }}>{totalTx} tx</span>
                    <Btn small onClick={() => { closeAll(); setEditing({type:'l1', l1, val:l1}); }}>RENAME</Btn>
                    <Btn small variant="danger" onClick={() => { closeAll(); setDeleting({type:'l1', l1, toL1:'', toL2:''}); }}>DELETE</Btn>
                  </>
                )}
              </div>

              {/* Delete L1 confirmation panel */}
              {isDeletingL1 && (
                <div style={{ padding:"12px 14px", background:"var(--red-bg)", borderBottom:"1px solid var(--border)" }}>
                  {l1NeedsReassign(l1) ? (
                    <>
                      <div style={{ fontSize:11, color:"var(--red)", marginBottom:8 }}>
                        Delete "{l1}"? {totalTx} transactions and {l1Counts?.total_rules||0} rules must be reassigned first.
                      </div>
                      <div style={{ display:"flex", gap:8, alignItems:"center", marginBottom:8, flexWrap:"wrap" }}>
                        <span style={{ fontSize:11, color:"var(--text2)" }}>Move all to:</span>
                        <select style={selectStyle} value={deleting.toL1}
                          onChange={e => setDeleting({...deleting, toL1: e.target.value, toL2:''})}>
                          <option value="">— select category —</option>
                          {l1Options(l1).map(o => <option key={o} value={o}>{o}</option>)}
                        </select>
                        {deleting.toL1 && (
                          <select style={selectStyle} value={deleting.toL2}
                            onChange={e => setDeleting({...deleting, toL2: e.target.value})}>
                            <option value="">— select subcategory —</option>
                            {(taxonomy[deleting.toL1]||[]).map(o => <option key={o} value={o}>{o}</option>)}
                          </select>
                        )}
                      </div>
                      <div style={{ display:"flex", gap:8 }}>
                        <Btn small variant="danger"
                          disabled={taxBusy || !deleting.toL1 || !deleting.toL2}
                          onClick={() => taxAction(() => deleteTaxonomyL1({l1, move_to_l1: deleting.toL1, move_to_l2: deleting.toL2}))}>
                          CONFIRM DELETE
                        </Btn>
                        <Btn small onClick={closeAll}>CANCEL</Btn>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ fontSize:11, color:"var(--red)", marginBottom:8 }}>
                        Delete "{l1}"? No transactions or rules — safe to delete.
                      </div>
                      <div style={{ display:"flex", gap:8 }}>
                        <Btn small variant="danger" disabled={taxBusy}
                          onClick={() => taxAction(() => deleteTaxonomyL1({l1, move_to_l1:'', move_to_l2:''}))}>
                          CONFIRM DELETE
                        </Btn>
                        <Btn small onClick={closeAll}>CANCEL</Btn>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* L2 area */}
              <div style={{ padding:"10px 14px" }}>
                <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginBottom:8 }}>
                  {l2s.map(l2 => {
                    const d            = l1Counts?.l2s?.[l2];
                    const txCount      = d?.tx    || 0;
                    const ruleCount    = d?.rules || 0;
                    const isEditingL2  = editing?.type  === 'l2' && editing.l1  === l1 && editing.l2  === l2;
                    const isDeletingL2 = deleting?.type === 'l2' && deleting.l1 === l1 && deleting.l2 === l2;
                    const isMovingL2   = moving?.l1 === l1 && moving.l2 === l2;

                    return (
                      <div key={l2} style={{ display:"flex", flexDirection:"column", gap:4 }}>

                        {/* L2 pill */}
                        {isEditingL2 ? (
                          <div style={{ display:"flex", gap:6, alignItems:"center", background:"var(--accent-bg)", border:"1px solid var(--border)", padding:"4px 8px", borderRadius:4 }}>
                            <input autoFocus style={{ ...inputStyle, width:130 }} value={editing.val}
                              onChange={e => setEditing({...editing, val: e.target.value})}
                              onKeyDown={e => {
                                if (e.key === 'Enter' && editing.val.trim())
                                  taxAction(() => renameTaxonomy({old_l1:l1, old_l2:l2, new_l1:l1, new_l2:editing.val.trim()}));
                                if (e.key === 'Escape') closeAll();
                              }} />
                            <Btn small variant="primary" disabled={!editing.val.trim()||taxBusy}
                              onClick={() => taxAction(() => renameTaxonomy({old_l1:l1, old_l2:l2, new_l1:l1, new_l2:editing.val.trim()}))}>
                              ✓
                            </Btn>
                            <Btn small onClick={closeAll}>✕</Btn>
                          </div>
                        ) : (
                          <div style={{ display:"flex", alignItems:"center", gap:4, background:"var(--faint)", border:"1px solid var(--border)", padding:"3px 8px", borderRadius:4 }}>
                            <span style={{ fontSize:11, color:"var(--text2)" }}>{l2}</span>
                            <span style={{ fontSize:9, color:"var(--muted)" }}>
                              {txCount > 0 ? `${txCount} tx` : ""}
                              {txCount > 0 && ruleCount > 0 ? " · " : ""}
                              {ruleCount > 0 ? `${ruleCount} rules` : ""}
                              {txCount === 0 && ruleCount === 0 ? "empty" : ""}
                            </span>
                            <button title="Rename"
                              onClick={() => { closeAll(); setEditing({type:'l2', l1, l2, val:l2}); }}
                              style={{ background:"none", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:11, padding:"0 2px", lineHeight:1 }}>
                              ✏
                            </button>
                            <button title="Move to another category"
                              onClick={() => { closeAll(); setMoving({l1, l2, toL1:''}); }}
                              style={{ background:"none", border:"none", cursor:"pointer", color:"var(--muted)", fontSize:11, padding:"0 2px", lineHeight:1 }}>
                              →
                            </button>
                            <button title="Delete"
                              onClick={() => { closeAll(); setDeleting({type:'l2', l1, l2, toL1:'', toL2:''}); }}
                              style={{ background:"none", border:"none", cursor:"pointer", color:"var(--red)", fontSize:11, padding:"0 2px", lineHeight:1 }}>
                              ✕
                            </button>
                          </div>
                        )}

                        {/* Move L2 panel */}
                        {isMovingL2 && (
                          <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", background:"var(--accent-bg)", border:"1px solid var(--border)", padding:"8px", borderRadius:4 }}>
                            <span style={{ fontSize:11, color:"var(--text2)" }}>Move "{l2}" to:</span>
                            <select style={selectStyle} value={moving.toL1}
                              onChange={e => setMoving({...moving, toL1: e.target.value})}>
                              <option value="">— select category —</option>
                              {l1Options(l1).map(o => <option key={o} value={o}>{o}</option>)}
                            </select>
                            <Btn small variant="primary" disabled={!moving.toL1||taxBusy}
                              onClick={() => taxAction(() => renameTaxonomy({old_l1:l1, old_l2:l2, new_l1:moving.toL1, new_l2:l2}))}>
                              MOVE
                            </Btn>
                            <Btn small onClick={closeAll}>CANCEL</Btn>
                          </div>
                        )}

                        {/* Delete L2 panel */}
                        {isDeletingL2 && (
                          <div style={{ background:"var(--red-bg)", border:"1px solid var(--border)", padding:"10px", borderRadius:4 }}>
                            {needsReassign(l1, l2) ? (
                              <>
                                <div style={{ fontSize:11, color:"var(--red)", marginBottom:8 }}>
                                  Delete "{l2}"? {txCount} transactions and {ruleCount} rules must be reassigned.
                                </div>
                                <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", marginBottom:8 }}>
                                  <select style={selectStyle} value={deleting.toL1}
                                    onChange={e => setDeleting({...deleting, toL1:e.target.value, toL2:''})}>
                                    <option value="">— category —</option>
                                    {l1List.map(o => <option key={o} value={o}>{o}</option>)}
                                  </select>
                                  {deleting.toL1 && (
                                    <select style={selectStyle} value={deleting.toL2}
                                      onChange={e => setDeleting({...deleting, toL2:e.target.value})}>
                                      <option value="">— subcategory —</option>
                                      {(taxonomy[deleting.toL1]||[])
                                        .filter(o => !(deleting.toL1 === l1 && o === l2))
                                        .map(o => <option key={o} value={o}>{o}</option>)}
                                    </select>
                                  )}
                                </div>
                                <div style={{ display:"flex", gap:6 }}>
                                  <Btn small variant="danger"
                                    disabled={taxBusy || !deleting.toL1 || !deleting.toL2}
                                    onClick={() => taxAction(() => deleteTaxonomy({l1, l2, move_to_l1:deleting.toL1, move_to_l2:deleting.toL2}))}>
                                    CONFIRM DELETE
                                  </Btn>
                                  <Btn small onClick={closeAll}>CANCEL</Btn>
                                </div>
                              </>
                            ) : (
                              <>
                                <div style={{ fontSize:11, color:"var(--red)", marginBottom:8 }}>
                                  Delete "{l2}"? No transactions or rules.
                                </div>
                                <div style={{ display:"flex", gap:6 }}>
                                  <Btn small variant="danger" disabled={taxBusy}
                                    onClick={() => taxAction(() => deleteTaxonomy({l1, l2, move_to_l1:'', move_to_l2:''}))}>
                                    CONFIRM DELETE
                                  </Btn>
                                  <Btn small onClick={closeAll}>CANCEL</Btn>
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Add L2 */}
                {adding?.type === 'l2' && adding.l1 === l1 ? (
                  <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                    <input autoFocus style={{ ...inputStyle, width:160 }} placeholder="New subcategory"
                      value={adding.val} onChange={e => setAdding({...adding, val:e.target.value})}
                      onKeyDown={e => {
                        if (e.key === 'Enter' && adding.val.trim())
                          taxAction(() => addTaxonomy({l1, l2:adding.val.trim()}));
                        if (e.key === 'Escape') closeAll();
                      }} />
                    <Btn small variant="primary" disabled={!adding.val.trim()||taxBusy}
                      onClick={() => taxAction(() => addTaxonomy({l1, l2:adding.val.trim()}))}>
                      ADD
                    </Btn>
                    <Btn small onClick={closeAll}>CANCEL</Btn>
                  </div>
                ) : (
                  <button
                    onClick={() => { closeAll(); setAdding({type:'l2', l1, val:''}); }}
                    style={{ background:"none", border:"1px dashed var(--border)", borderRadius:4, padding:"3px 10px", cursor:"pointer", color:"var(--muted)", fontSize:10 }}>
                    + ADD SUBCATEGORY
                  </button>
                )}
              </div>

            </div>
          );
        })}
      </Card>

    </div>
  );
}
