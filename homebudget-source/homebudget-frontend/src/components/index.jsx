// components/index.jsx — Shared UI components

export const L1_COLORS = {
  "Income":              "#4ade80",
  "Daily Living":        "#fb923c",
  "Home":                "#60a5fa",
  "Health":              "#f87171",
  "Children":            "#34d399",
  "Transportation":      "#a78bfa",
  "Leisure":             "#f472b6",
  "Finance & Admin":     "#94a3b8",
  // legacy names (in case old transactions still have them)
  "Housing":             "#60a5fa",
  "Food & Household":    "#fb923c",
  "Mobility":            "#a78bfa",
  "Health & Insurance":  "#f87171",
  "Lifestyle & Leisure": "#f472b6",
  "Taxes & Savings":     "#94a3b8",
  "Transfers":           "#64748b",
};

export const LIGHT = {
  "--bg":        "#f0f2f5",
  "--surface":   "#ffffff",
  "--surface2":  "#f8f9fb",
  "--border":    "#e5e7eb",
  "--text":      "#111827",
  "--text2":     "#374151",
  "--muted":     "#6b7280",
  "--faint":     "#f3f4f6",
  "--accent":    "#3b7dd8",
  "--accent-bg": "#eff6ff",
  "--green":     "#16a34a",
  "--green-bg":  "#f0fdf4",
  "--red":       "#dc2626",
  "--red-bg":    "#fef2f2",
  "--orange":    "#ea580c",
  "--shadow":    "0 1px 4px rgba(0,0,0,0.06)",
};

export const DARK = {
  "--bg":        "#0c0d0f",
  "--surface":   "#161718",
  "--surface2":  "#1c1d1f",
  "--border":    "#2a2b2e",
  "--text":      "#e8e6e1",
  "--text2":     "#b0aead",
  "--muted":     "#888",
  "--faint":     "#1a1b1d",
  "--accent":    "#5b9cf6",
  "--accent-bg": "#1e2a3a",
  "--green":     "#4ade80",
  "--green-bg":  "#0f2318",
  "--red":       "#f87171",
  "--red-bg":    "#2a0f0f",
  "--orange":    "#fb923c",
  "--shadow":    "0 1px 4px rgba(0,0,0,0.3)",
};

export const formatCHF = (n) => {
  if (n == null) return "—";
  const abs = Math.abs(n).toLocaleString("de-CH", { minimumFractionDigits:2, maximumFractionDigits:2 });
  return n < 0 ? `−${abs}` : `+${abs}`;
};

export const Card = ({ children, style }) => (
  <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:8, padding:24, boxShadow:"var(--shadow)", ...style }}>
    {children}
  </div>
);

export const Label = ({ children, style }) => (
  <div style={{ fontSize:9, letterSpacing:"0.18em", color:"var(--muted)", marginBottom:14, ...style }}>
    {children}
  </div>
);

export const Btn = ({ children, onClick, variant="default", small, disabled, style }) => {
  const base = {
    fontFamily:"'DM Mono',monospace", cursor:disabled?"not-allowed":"pointer",
    borderRadius:5, letterSpacing:"0.06em", fontSize:small?10:11,
    padding:small?"4px 11px":"7px 16px", transition:"all 0.15s",
    opacity:disabled?0.4:1, border:"none",
  };
  const variants = {
    default: { background:"var(--faint)",   color:"var(--text2)", border:"1px solid var(--border)" },
    primary: { background:"var(--accent)",  color:"#fff" },
    green:   { background:"var(--green)",   color:"#fff" },
    danger:  { background:"transparent",    color:"var(--red)",   border:"1px solid var(--red)" },
    ghost:   { background:"transparent",    color:"var(--muted)", border:"1px solid transparent" },
  };
  return (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...variants[variant], ...style }}>
      {children}
    </button>
  );
};

export const Badge = ({ label, color }) => (
  <span style={{ background:`${color}1a`, color, fontSize:10, padding:"2px 8px", borderRadius:4, letterSpacing:"0.04em", whiteSpace:"nowrap", display:"inline-block" }}>
    {label}
  </span>
);

export const Dot = ({ color }) => (
  <span style={{ width:7, height:7, borderRadius:"50%", background:color, display:"inline-block", flexShrink:0 }} />
);

export const Spinner = () => (
  <div style={{ display:"flex", alignItems:"center", justifyContent:"center", padding:40, color:"var(--muted)", fontSize:12 }}>
    Loading…
  </div>
);

export const ConfBar = ({ value }) => (
  <div style={{ display:"flex", alignItems:"center", gap:6 }}>
    <div style={{ width:60, height:3, background:"var(--faint)", borderRadius:2, overflow:"hidden" }}>
      <div style={{ width:`${(value||0)*100}%`, height:"100%", borderRadius:2,
        background: value>0.85?"var(--green)":value>0.65?"var(--orange)":"var(--red)" }}/>
    </div>
    <span style={{ fontSize:10, color:"var(--muted)" }}>{Math.round((value||0)*100)}%</span>
  </div>
);

export const TxTable = ({ transactions, onEdit }) => (
  <>
    <div style={{ display:"grid", gridTemplateColumns:"90px 1fr 110px 150px 100px 110px 28px", gap:8, paddingBottom:10, borderBottom:"1px solid var(--border)" }}>
      {["DATE","MERCHANT","ACCOUNT","L1","L2","CHF",""].map(h => (
        <div key={h} style={{ fontSize:9, letterSpacing:"0.14em", color:"var(--muted)" }}>{h}</div>
      ))}
    </div>
    {transactions.map(tx => (
      <div key={tx.id} style={{ display:"grid", gridTemplateColumns:"90px 1fr 110px 150px 100px 110px 28px", gap:8, padding:"10px 0", borderBottom:"1px solid var(--faint)", fontSize:12, alignItems:"center" }}>
        <div style={{ color:"var(--muted)", fontSize:11 }}>{tx.date}</div>
        <div style={{ display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ color:"var(--text)" }}>{tx.merchant_clean}</span>
          {tx.is_recurring===1 && <span style={{ fontSize:9, color:"var(--muted)" }} title="Recurring">↺</span>}
          {tx.manually_reviewed===1 && <span style={{ fontSize:9, color:"var(--green)" }} title="Reviewed">✓</span>}
        </div>
        <div style={{ fontSize:10, color:"var(--muted)" }}>{(tx.account_name||"").replace("BLKB ","")}</div>
        <Badge label={tx.l1||"—"} color={L1_COLORS[tx.l1]||"#888"}/>
        <div style={{ fontSize:11, color:"var(--text2)" }}>{tx.l2||"—"}</div>
        <div style={{ color:tx.amount>0?"var(--green)":"var(--red)", textAlign:"right", fontVariantNumeric:"tabular-nums" }}>
          {formatCHF(tx.amount)}
        </div>
        <div style={{ color:"var(--muted)", cursor:"pointer", textAlign:"center" }} onClick={()=>onEdit&&onEdit(tx)}>⋯</div>
      </div>
    ))}
  </>
);
