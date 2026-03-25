import { useState, useEffect } from "react";
import { getImports, uploadFile, scanHotfolder } from "../api";
import { Card, Label, Btn, Spinner } from "../components";

export default function Upload() {
  const [tab,     setTab]     = useState("manual");
  const [dragging,setDragging]= useState(false);
  const [file,    setFile]    = useState(null);
  const [imports, setImports] = useState([]);
  const [loading, setLoading] = useState(false);
  const [result,  setResult]  = useState(null);

  useEffect(() => {
    getImports().then(setImports).catch(() => {});
  }, []);

  const doUpload = async () => {
    if (!file) return;
    setLoading(true);
    setResult(null);
    try {
      const r = await uploadFile(file, null);
      setResult(r);
      setFile(null);
      getImports().then(setImports);
    } catch(e) {
      setResult({ status:"error", errors:[e.message] });
    } finally {
      setLoading(false);
    }
  };

  const doScan = async () => {
    setLoading(true);
    try {
      const r = await scanHotfolder();
      setResult({ status:"ok", tx_count: r.results?.reduce((s,x)=>s+x.tx_count,0)||0, scanned: r.scanned });
      getImports().then(setImports);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>
      <div>
        <Card>
          <div style={{ display:"flex", gap:0, marginBottom:20, borderBottom:"1px solid var(--border)" }}>
            {[["manual","MANUAL"],["hotfolder","NEXTCLOUD"]].map(([t,l]) => (
              <button key={t} onClick={()=>setTab(t)} style={{ background:"none", border:"none", borderBottom:tab===t?"2px solid var(--accent)":"2px solid transparent", color:tab===t?"var(--accent)":"var(--muted)", padding:"8px 16px", cursor:"pointer", fontFamily:"'DM Mono',monospace", fontSize:10, letterSpacing:"0.1em", marginBottom:-1, transition:"all 0.15s" }}>
                {l}
              </button>
            ))}
          </div>

          {tab==="manual" ? (
            <>
              <div
                onDragOver={e=>{e.preventDefault();setDragging(true)}}
                onDragLeave={()=>setDragging(false)}
                onDrop={e=>{e.preventDefault();setDragging(false);setFile(e.dataTransfer.files[0])}}
                onClick={()=>document.getElementById("fileInput").click()}
                style={{ border:`2px dashed ${dragging?"var(--accent)":"var(--border)"}`, borderRadius:8, padding:"32px 20px", textAlign:"center", color:"var(--muted)", fontSize:12, cursor:"pointer", transition:"all 0.15s", marginBottom:16, background:dragging?"var(--accent-bg)":"transparent" }}>
                {file
                  ? <div style={{ color:"var(--text)" }}>📄 {file.name}</div>
                  : <><span>Drop file here or </span><span style={{ color:"var(--accent)" }}>browse</span><br/><span style={{ fontSize:10 }}>.xlsx · .csv</span></>
                }
                <input id="fileInput" type="file" accept=".xlsx,.csv" style={{ display:"none" }} onChange={e=>setFile(e.target.files[0])}/>
              </div>
              <Btn variant="primary" style={{ width:"100%" }} disabled={!file||loading} onClick={doUpload}>
                {loading ? "IMPORTING…" : "IMPORT"}
              </Btn>
            </>
          ) : (
            <>
              <div style={{ fontSize:11, color:"var(--text2)", marginBottom:16, lineHeight:1.7 }}>
                Drop files into Nextcloud:<br/>
                <code style={{ fontSize:10, background:"var(--faint)", padding:"2px 6px", borderRadius:3 }}>budget-imports/inbox/</code><br/>
                <span style={{ fontSize:10, color:"var(--muted)" }}>Auto-processed every 5 minutes</span>
              </div>
              <Btn variant="primary" onClick={doScan} disabled={loading}>
                {loading ? "SCANNING…" : "SCAN NOW"}
              </Btn>
            </>
          )}

          {result && (
            <div style={{ marginTop:16, padding:12, borderRadius:6, background:result.status==="ok"?"var(--green-bg)":"var(--red-bg)", border:`1px solid ${result.status==="ok"?"var(--green)":"var(--red)"}30` }}>
              {result.status==="ok" ? (
                <div style={{ fontSize:11, color:"var(--green)" }}>
                  ✓ {result.tx_count} transactions imported
                  {result.duplicate_count>0 && ` · ${result.duplicate_count} dupes skipped`}
                  {result.unclassified_count>0 && ` · ${result.unclassified_count} unclassified`}
                </div>
              ) : (
                <div style={{ fontSize:11, color:"var(--red)" }}>
                  ✗ {result.errors?.join(", ")||result.status}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <Label>IMPORT LOG</Label>
        {imports.length===0 && <div style={{ fontSize:11, color:"var(--muted)" }}>No imports yet</div>}
        {imports.map(imp => (
          <div key={imp.id} style={{ padding:"12px 0", borderBottom:"1px solid var(--faint)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", marginBottom:4 }}>
              <code style={{ fontSize:11, color:"var(--text)" }}>{imp.filename}</code>
              <span style={{ fontSize:10, color:imp.status==="ok"?"var(--green)":"var(--red)" }}>
                {imp.status==="ok"?"✓ OK":"✗ ERR"}
              </span>
            </div>
            <div style={{ fontSize:10, color:"var(--muted)", marginBottom:6 }}>{imp.imported_at} · {imp.source}</div>
            <div style={{ display:"flex", gap:12 }}>
              <span style={{ fontSize:10, color:"var(--text2)" }}>{imp.tx_count} transactions</span>
              {imp.duplicate_count>0 && <span style={{ fontSize:10, color:"var(--orange)" }}>{imp.duplicate_count} dupes</span>}
              {imp.unclassified_count>0 && <span style={{ fontSize:10, color:"var(--red)" }}>{imp.unclassified_count} unclassified</span>}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
