import { useState, useEffect } from "react";
import { LIGHT, DARK } from "./components";
import Login        from "./pages/Login";
import Dashboard    from "./pages/Dashboard";
import Upload       from "./pages/Upload";
import Transactions from "./pages/Transactions";
import Review       from "./pages/Review";
import Rules        from "./pages/Rules";
import Maintenance  from "./pages/Maintenance";
import Analysis     from "./pages/Analysis";
import { getUnclassified, downloadExcel } from "./api";

const PAGES = ["Dashboard","Upload","Transactions","Review","Rules","Analysis","Maintenance"];

export default function App() {
  const [authed,  setAuthed]  = useState(!!localStorage.getItem("budget_pw"));
  const [page,    setPage]    = useState("Analysis");
  const [dark,    setDark]    = useState(localStorage.getItem("budget_dark")==="1");
  const [pending, setPending] = useState(0);
  const theme = dark ? DARK : LIGHT;

  useEffect(() => {
    if (!authed) return;
    getUnclassified().then(r => setPending(r.length)).catch(()=>{});
  }, [authed, page]);

  const toggleDark = () => {
    const nd = !dark; setDark(nd);
    localStorage.setItem("budget_dark", nd?"1":"0");
  };

  const logout = () => {
    localStorage.removeItem("budget_pw");
    setAuthed(false);
  };

  if (!authed) return (
    <div style={{ ...Object.fromEntries(Object.entries(theme)) }}>
      <style>{"@import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap'); *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; } input, button { outline:none; }"}</style>
      <Login onLogin={()=>setAuthed(true)}/>
    </div>
  );

  const PageComponent = { Dashboard, Upload, Transactions, Review, Rules, Analysis, Maintenance }[page];

  return (
    <div style={{ ...Object.fromEntries(Object.entries(theme)), minHeight:"100vh", background:"var(--bg)", fontFamily:"'DM Mono','Courier New',monospace", color:"var(--text)" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');
        *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
        select, input, textarea, button { outline:none; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-thumb { background:var(--border); border-radius:2px; }
      `}</style>

      <div style={{ background:"var(--surface)", borderBottom:"1px solid var(--border)", padding:"0 40px", position:"sticky", top:0, zIndex:10 }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", maxWidth:1280, margin:"0 auto", height:54 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <div style={{ width:26, height:26, background:"var(--accent)", borderRadius:6, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <span style={{ color:"#fff", fontSize:11, fontWeight:500 }}>H</span>
            </div>
            <div>
              <div style={{ fontSize:8, letterSpacing:"0.2em", color:"var(--muted)" }}>HAUSHALT · MUTTENZ</div>
              <div style={{ fontSize:13, fontWeight:500, color:"var(--text)", letterSpacing:"0.02em", lineHeight:1.2 }}>HomeBudget</div>
            </div>
          </div>
          <nav style={{ display:"flex", gap:4, alignItems:"center" }}>
            {PAGES.map(p => (
              <button key={p} onClick={()=>setPage(p)} style={{ background:"none", border:"none", borderBottom:page===p?"2px solid var(--accent)":"2px solid transparent", color:page===p?"var(--accent)":"var(--muted)", padding:"4px 12px", cursor:"pointer", fontFamily:"inherit", fontSize:10, letterSpacing:"0.1em", transition:"all 0.15s", position:"relative" }}>
                {p.toUpperCase()}
                {p==="Review" && pending>0 && (
                  <span style={{ background:"var(--red)", color:"#fff", fontSize:8, padding:"1px 4px", borderRadius:3, marginLeft:4, verticalAlign:"middle" }}>{pending}</span>
                )}
              </button>
            ))}
            <div style={{ width:1, height:16, background:"var(--border)", margin:"0 6px" }}/>
            <button onClick={toggleDark} style={{ background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"4px 8px", cursor:"pointer", fontSize:13, color:"var(--text2)", lineHeight:1 }}>
              {dark?"☀":"☾"}
            </button>
            <button onClick={()=>downloadExcel()} style={{ background:"none", border:"none", fontSize:10, color:"var(--muted)", cursor:"pointer", fontFamily:"inherit", letterSpacing:"0.1em", marginLeft:4 }}>
              ↓ EXCEL
            </button>
            <button onClick={logout} style={{ background:"none", border:"none", fontSize:10, color:"var(--muted)", cursor:"pointer", fontFamily:"inherit", letterSpacing:"0.1em" }}>
              LOGOUT
            </button>
          </nav>
        </div>
      </div>

      <div style={{ maxWidth:1280, margin:"0 auto", padding:"32px 40px" }}>
        <PageComponent onNav={setPage}/>
      </div>
    </div>
  );
}
