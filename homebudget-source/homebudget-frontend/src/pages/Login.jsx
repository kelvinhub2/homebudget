import { useState } from "react";

export default function Login({ onLogin }) {
  const [pw,  setPw]  = useState("");
  const [err, setErr] = useState("");
  const [busy,setBusy]= useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const res = await fetch("/api/taxonomy", {
        headers: { "Authorization": `Basic ${btoa(`admin:${pw}`)}` }
      });
      if (res.ok) { localStorage.setItem("budget_pw", pw); onLogin(); }
      else        setErr("Wrong password");
    } catch { setErr("Connection failed"); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ minHeight:"100vh", background:"var(--bg)", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Mono',monospace" }}>
      <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:10, padding:40, width:340, boxShadow:"0 4px 24px rgba(0,0,0,0.08)" }}>
        <div style={{ marginBottom:28 }}>
          <div style={{ fontSize:9, letterSpacing:"0.2em", color:"var(--muted)", marginBottom:6 }}>HAUSHALT · MUTTENZ</div>
          <div style={{ fontSize:22, color:"var(--text)", letterSpacing:"0.02em" }}>HomeBudget</div>
        </div>
        <form onSubmit={submit}>
          <input
            type="password"
            value={pw}
            onChange={e=>setPw(e.target.value)}
            placeholder="Password"
            autoFocus
            style={{ width:"100%", background:"var(--faint)", border:"1px solid var(--border)", borderRadius:4, padding:"10px 12px", color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:13, marginBottom:12 }}
          />
          {err && <div style={{ fontSize:11, color:"var(--red)", marginBottom:10 }}>{err}</div>}
          <button type="submit" disabled={busy||!pw}
            style={{ width:"100%", background:"var(--accent)", color:"#fff", border:"none", borderRadius:5, padding:"10px", fontFamily:"'DM Mono',monospace", fontSize:12, letterSpacing:"0.08em", cursor:"pointer", opacity:busy||!pw?0.5:1 }}>
            {busy ? "…" : "LOGIN"}
          </button>
        </form>
      </div>
    </div>
  );
}
