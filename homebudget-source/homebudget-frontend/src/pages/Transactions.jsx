import { useState, useEffect, useCallback } from "react";
import { getTransactions, updateTransaction, getTaxonomy, get } from "../api";
import { Card, Label, Btn, Badge, Spinner, TxTable, formatCHF, L1_COLORS } from "../components";

export default function Transactions() {
  const [search,       setSearch]       = useState("");
  const [filterL1,     setFilterL1]     = useState("");
  const [filterL2,     setFilterL2]     = useState("");
  const [filterAcc,    setFilterAcc]    = useState("");
  const [filterMonth,  setFilterMonth]  = useState("");
  const [showInternal, setShowInternal] = useState(0);  // 0=hide, 1=include, 2=only
  const [sort,         setSort]         = useState("");
  const [data,         setData]         = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [editing,      setEditing]      = useState(null);
  const [taxonomy,     setTaxonomy]     = useState({});
  const [txRule,       setTxRule]       = useState(null);

  useEffect(() => { getTaxonomy().then(setTaxonomy).catch(()=>{}); }, []);

  useEffect(() => {
    if (!editing) { setTxRule(null); return; }
    get(`/api/transactions/${editing.id}/rule`)
      .then(r => setTxRule(r.rule))
      .catch(() => setTxRule(null));
  }, [editing?.id]);

  const load = useCallback(() => {
    setLoading(true);
    getTransactions({ search, l1:filterL1, l2:filterL2, account:filterAcc, month:filterMonth,
                      show_internal: showInternal, sort: sort||undefined, limit:200 })
      .then(setData)
      .finally(() => setLoading(false));
  }, [search, filterL1, filterL2, filterAcc, filterMonth, showInternal, sort]);

  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const saveEdit = async () => {
    if (!editing) return;
    await updateTransaction(editing.id, {
      l1: editing.l1, l2: editing.l2,
      merchant_clean: editing.merchant_clean,
      is_internal: editing.is_internal ? 1 : 0,
    });
    setEditing(null);
    load();
  };

  const accounts    = [...new Set((data?.transactions||[]).map(t=>t.account_name).filter(Boolean))];
  const l1List      = Object.keys(taxonomy);
  const l2List      = taxonomy[editing?.l1] || [];
  const filterL2List = filterL1 ? (taxonomy[filterL1] || []) : Object.values(taxonomy).flat();

  return (
    <Card>
      {/* Filters */}
      <div style={{ display:"flex", gap:10, marginBottom:20, flexWrap:"wrap", alignItems:"center" }}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search merchant or text…"
          style={{ flex:1, minWidth:180, background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"7px 12px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:12 }}/>
        <input value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} placeholder="YYYY-MM"
          style={{ width:100, background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"7px 10px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:11 }}/>
        <select value={filterL1} onChange={e=>{setFilterL1(e.target.value);setFilterL2("");}}
          style={{ background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"7px 10px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:11 }}>
          <option value="">All L1</option>
          {l1List.map(l=><option key={l}>{l}</option>)}
        </select>
        <select value={filterL2} onChange={e=>setFilterL2(e.target.value)}
          style={{ background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"7px 10px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:11 }}>
          <option value="">All L2</option>
          {[...new Set(filterL2List)].sort().map(l=><option key={l}>{l}</option>)}
        </select>
        <select value={filterAcc} onChange={e=>setFilterAcc(e.target.value)}
          style={{ background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"7px 10px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:11 }}>
          <option value="">All accounts</option>
          {accounts.map(a=><option key={a}>{a}</option>)}
        </select>
        {(search||filterL1||filterL2||filterAcc||filterMonth) &&
          <Btn small onClick={()=>{setSearch("");setFilterL1("");setFilterL2("");setFilterAcc("");setFilterMonth("")}}>× Reset</Btn>}
        <select value={sort} onChange={e=>setSort(e.target.value)}
          style={{ background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"7px 10px", color:"var(--muted)", fontFamily:"'DM Mono',monospace", fontSize:11 }}>
          <option value="">Date ↓</option>
          <option value="merchant">Merchant ↑</option>
          <option value="-merchant">Merchant ↓</option>
          <option value="l1">L1 ↑</option>
          <option value="l2">L2 ↑</option>
          <option value="amount">CHF ↑</option>
          <option value="-amount">CHF ↓</option>
        </select>
        <button onClick={()=>setShowInternal(v=>(v+1)%3)} style={{
          padding:"5px 10px", borderRadius:4, fontSize:10, cursor:"pointer",
          border:"1px solid var(--border)", fontFamily:"inherit", letterSpacing:"0.08em",
          background: showInternal===2 ? "var(--orange)" : showInternal===1 ? "var(--accent)" : "var(--faint)",
          color: showInternal>0 ? "#fff" : "var(--muted)"
        }}>
          {showInternal===2 ? "ONLY INTERNALS" : showInternal===1 ? "+ INTERNALS" : "INTERNALS"}
        </button>
        <span style={{ fontSize:10, color:"var(--muted)", marginLeft:"auto" }}>
          {loading ? "…" : `${data?.total||0} transactions`}
        </span>
      </div>

      {loading ? <Spinner/> : <TxTable transactions={data?.transactions||[]} onEdit={setEditing}/>}

      {/* Edit modal */}
      {editing && (
        <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100 }}>
          <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:10, padding:24, width:420, boxShadow:"0 8px 32px rgba(0,0,0,0.2)" }}>
            <Label>EDIT TRANSACTION</Label>
            <div style={{ fontSize:12, color:"var(--text)", marginBottom:8 }}>{editing.merchant_clean}</div>

            {/* CR-026: raw booking text collapsible */}
            {editing.raw_text && (
              <details style={{ marginBottom:12 }}>
                <summary style={{ fontSize:10, color:"var(--muted)", cursor:"pointer", letterSpacing:"0.08em" }}>BOOKING TEXT</summary>
                <div style={{ marginTop:6, padding:"8px 10px", background:"var(--faint)", borderRadius:4, fontSize:10, fontFamily:"monospace", color:"var(--text2)", whiteSpace:"pre-wrap", maxHeight:120, overflowY:"auto" }}>
                  {editing.raw_text}
                </div>
              </details>
            )}

            {/* CR-012: show matched rule */}
            {txRule && (
              <div style={{ marginBottom:14, padding:"8px 10px", background:"var(--faint)", borderRadius:4, fontSize:11, border:"1px solid var(--border)" }}>
                <span style={{ color:"var(--muted)" }}>Matched rule #{txRule.id}: </span>
                <span style={{ color:"var(--text)" }}>{txRule.merchant}</span>
                {txRule.keyword && <span style={{ color:"var(--accent)", fontFamily:"monospace" }}> + "{txRule.keyword}"</span>}
                <span style={{ color:"var(--muted)" }}> → {txRule.l1}/{txRule.l2}</span>
              </div>
            )}

            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, color:"var(--muted)", marginBottom:5 }}>MERCHANT</div>
              <input value={editing.merchant_clean||""} onChange={e=>setEditing({...editing,merchant_clean:e.target.value})}
                style={{ width:"100%", background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"7px 10px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:12 }}/>
            </div>
            <div style={{ marginBottom:10 }}>
              <div style={{ fontSize:10, color:"var(--muted)", marginBottom:5 }}>L1</div>
              <select value={editing.l1||""} onChange={e=>setEditing({...editing,l1:e.target.value,l2:""})}
                style={{ width:"100%", background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"7px 10px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:12 }}>
                <option value="">Select…</option>
                {l1List.map(l=><option key={l}>{l}</option>)}
              </select>
            </div>
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:10, color:"var(--muted)", marginBottom:5 }}>L2</div>
              <select value={editing.l2||""} onChange={e=>setEditing({...editing,l2:e.target.value})} disabled={!editing.l1}
                style={{ width:"100%", background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"7px 10px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:12 }}>
                <option value="">Select…</option>
                {l2List.map(l=><option key={l}>{l}</option>)}
              </select>
            </div>
            {/* Internal transfer toggle */}
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:20, padding:"10px 12px", background: editing.is_internal ? "var(--orange)18" : "var(--faint)", border:`1px solid ${editing.is_internal ? "var(--orange)60" : "var(--border)"}`, borderRadius:6 }}>
              <input type="checkbox" id="is_internal" checked={!!editing.is_internal}
                onChange={e => setEditing({...editing, is_internal: e.target.checked ? 1 : 0})}
                style={{ cursor:"pointer", accentColor:"var(--orange)" }}/>
              <label htmlFor="is_internal" style={{ fontSize:11, color: editing.is_internal ? "var(--orange)" : "var(--text2)", cursor:"pointer", letterSpacing:"0.06em" }}>
                INTERNAL TRANSFER — excluded from all reports
              </label>
            </div>

            <div style={{ display:"flex", gap:8 }}>
              <Btn variant="primary" style={{ flex:1 }} onClick={saveEdit}>SAVE</Btn>
              <Btn onClick={()=>setEditing(null)}>CANCEL</Btn>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}
