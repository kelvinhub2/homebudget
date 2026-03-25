import { useState, useEffect } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { getDashboard } from "../api";
import { Card, Label, Btn, Badge, Spinner, formatCHF, L1_COLORS } from "../components";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function prevMonth(m) {
  const [y,mo] = m.split("-").map(Number);
  return mo===1 ? `${y-1}-12` : `${y}-${String(mo-1).padStart(2,"0")}`;
}
function nextMonth(m) {
  const [y,mo] = m.split("-").map(Number);
  return mo===12 ? `${y+1}-01` : `${y}-${String(mo+1).padStart(2,"0")}`;
}
function fmtMonth(m) {
  const [y,mo] = m.split("-").map(Number);
  return `${MONTHS[mo-1].toUpperCase()} ${y}`;
}

const TT = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s,p) => s+(p.value||0), 0);
  return (
    <div style={{ background:"var(--surface)", border:"1px solid var(--border)", borderRadius:8, padding:"12px 16px", fontSize:11, fontFamily:"'DM Mono',monospace", boxShadow:"0 4px 20px rgba(0,0,0,0.12)" }}>
      <div style={{ color:"var(--muted)", marginBottom:6 }}>{label}</div>
      {payload.map(p => p.value>0 && (
        <div key={p.name} style={{ display:"flex", justifyContent:"space-between", gap:20, color:p.fill, marginBottom:2 }}>
          <span>{p.name}</span><span>{p.value.toLocaleString("de-CH")}</span>
        </div>
      ))}
      <div style={{ borderTop:"1px solid var(--border)", marginTop:6, paddingTop:6, display:"flex", justifyContent:"space-between", color:"var(--text)" }}>
        <span>Total</span><span>CHF {total.toLocaleString("de-CH")}</span>
      </div>
    </div>
  );
};

export default function Dashboard({ onNav }) {
  const now = new Date();
  const curMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}`;
  const [month,   setMonth]   = useState(curMonth);
  const [mode,    setMode]    = useState("month"); // month | quarter | year
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const [y, mo] = month.split("-").map(Number);
    let apiParam;
    if (mode === "month")   apiParam = month;
    else if (mode === "year") apiParam = `${y}`;
    else { // quarter
      const qStart = Math.floor((mo-1)/3)*3+1;
      apiParam = `${y}-${String(qStart).padStart(2,"0")}`;
    }
    getDashboard(apiParam)
      .then(setData)
      .finally(() => setLoading(false));
  }, [month, mode]);

  const navigate = (dir) => {
    if (mode === "month") setMonth(dir > 0 ? nextMonth(month) : prevMonth(month));
    else if (mode === "year") {
      const y = parseInt(month.split("-")[0]);
      setMonth(`${y+dir}-01`);
    } else {
      // quarter: jump 3 months
      let m = month;
      for (let i=0; i<3; i++) m = dir>0 ? nextMonth(m) : prevMonth(m);
      setMonth(m);
    }
  };

  const periodLabel = () => {
    const [y, mo] = month.split("-").map(Number);
    if (mode === "month")   return fmtMonth(month);
    if (mode === "year")    return `${y}`;
    return `Q${Math.ceil(mo/3)} ${y}`;
  };

  if (loading) return <Spinner/>;
  if (!data)   return <div style={{ color:"var(--red)" }}>Failed to load dashboard</div>;

  // Build chart data from trend
  const months = [...new Set((data.trend||[]).map(r => r.month))].sort();
  const chartData = months.map(m => {
    const obj = { month: m.slice(5) };
    (data.trend||[]).filter(r => r.month===m).forEach(r => { obj[r.l1] = Math.abs(r.total); });
    return obj;
  });

  return (
    <div>
      {/* Period nav — CR-006 */}
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:24, flexWrap:"wrap", gap:8 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <Btn small onClick={()=>navigate(-1)}>←</Btn>
          <span style={{ fontSize:13, fontWeight:500, color:"var(--text)", letterSpacing:"0.06em", minWidth:100, textAlign:"center" }}>{periodLabel()}</span>
          <Btn small onClick={()=>navigate(1)}>→</Btn>
        </div>
        <div style={{ display:"flex", gap:4 }}>
          {["month","quarter","year"].map(m => (
            <button key={m} onClick={()=>setMode(m)} style={{
              padding:"4px 10px", borderRadius:4, border:"1px solid var(--border)", fontSize:10,
              background: mode===m ? "var(--accent)" : "var(--faint)",
              color: mode===m ? "#fff" : "var(--text2)",
              cursor:"pointer", fontFamily:"inherit", letterSpacing:"0.08em", textTransform:"uppercase"
            }}>{m}</button>
          ))}
        </div>
        <div style={{ fontSize:10, color:"var(--muted)" }}>
          {data.tx_count} transactions
          {data.unclassified>0 && (
            <span style={{ color:"var(--orange)", marginLeft:12, cursor:"pointer" }} onClick={()=>onNav("Review")}>
              ⚠ {data.unclassified} unclassified
            </span>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:16, marginBottom:24 }}>
        {[
          { label:"INCOME",   value:data.income,   border:"#bbf7d0", color:"var(--green)" },
          { label:"EXPENSES", value:data.expenses, border:"#fecaca", color:"var(--red)"   },
          { label:"BALANCE",  value:data.balance,  border: data.balance>=0?"#bbf7d0":"#fecaca", color: data.balance>=0?"var(--green)":"var(--red)" },
        ].map(k => (
          <Card key={k.label} style={{ borderLeft:`3px solid ${k.border}` }}>
            <Label>{k.label}</Label>
            <div style={{ fontSize:24, color:k.color, fontVariantNumeric:"tabular-nums" }}>
              CHF {formatCHF(k.value)}
            </div>
          </Card>
        ))}
      </div>

      {/* Chart + merchants */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 300px", gap:16, marginBottom:24 }}>
        <Card>
          <Label>SPENDING BY CATEGORY — LAST 6 MONTHS</Label>
          <div style={{ display:"flex", flexWrap:"wrap", gap:8, marginBottom:16 }}>
            {Object.entries(L1_COLORS).map(([k,c]) => (
              <div key={k} style={{ display:"flex", alignItems:"center", gap:4 }}>
                <span style={{ width:8, height:8, borderRadius:2, background:c, display:"inline-block" }}/>
                <span style={{ fontSize:9, color:"var(--muted)" }}>{k}</span>
              </div>
            ))}
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData} barSize={26} barCategoryGap="30%">
              <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill:"#9ca3af", fontSize:10, fontFamily:"DM Mono" }}/>
              <YAxis axisLine={false} tickLine={false} tick={{ fill:"#d1d5db", fontSize:9 }} tickFormatter={v=>`${(v/1000).toFixed(0)}k`}/>
              <Tooltip content={<TT/>} cursor={{ fill:"var(--faint)" }}/>
              {Object.entries(L1_COLORS).map(([k,c]) => (
                <Bar key={k} dataKey={k} stackId="a" fill={c}/>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card>
          <Label>TOP MERCHANTS — {fmtMonth(month)}</Label>
          {(data.top_merchants||[]).map((m,i) => (
            <div key={i} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"9px 0", borderBottom:"1px solid var(--faint)" }}>
              <div>
                <div style={{ fontSize:12, color:"var(--text)", marginBottom:3 }}>{m.merchant_clean}</div>
                <Badge label={m.l1} color={L1_COLORS[m.l1]||"#888"}/>
              </div>
              <div style={{ fontSize:12, color:"var(--red)", fontVariantNumeric:"tabular-nums" }}>
                {formatCHF(m.total)}
              </div>
            </div>
          ))}
        </Card>
      </div>

      {/* L1 breakdown */}
      <Card>
        <Label>BREAKDOWN BY CATEGORY</Label>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(200px,1fr))", gap:12 }}>
          {(data.by_l1||[]).map(cat => {
            const pct  = Math.round(Math.abs(cat.total) / Math.abs(data.expenses||1) * 100);
            const color = L1_COLORS[cat.l1]||"#888";
            return (
              <div key={cat.l1} style={{ padding:14, background:"var(--surface2)", borderRadius:6, border:"1px solid var(--border)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", marginBottom:8 }}>
                  <div style={{ fontSize:11, color:"var(--text2)" }}>{cat.l1}</div>
                  <span style={{ fontSize:10, color:"var(--muted)" }}>{pct}%</span>
                </div>
                <div style={{ height:3, background:"var(--faint)", borderRadius:2, marginBottom:8, overflow:"hidden" }}>
                  <div style={{ width:`${pct}%`, height:"100%", background:color, borderRadius:2 }}/>
                </div>
                <div style={{ fontSize:13, color:"var(--text)", fontVariantNumeric:"tabular-nums" }}>
                  CHF {formatCHF(cat.total)}
                </div>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
