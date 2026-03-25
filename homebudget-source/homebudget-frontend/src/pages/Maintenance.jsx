import { useState, useEffect } from "react";
import { getImports, recategorize, getTaxonomy } from "../api";
import { Card, Label, Btn, Spinner } from "../components";

async function getCoverage() {
  const pw  = localStorage.getItem("budget_pw") || "";
  const res = await fetch("/api/accounts/coverage", {
    headers: { "Authorization": `Basic ${btoa(`admin:${pw}`)}` }
  });
  return res.json();
}

export default function Maintenance() {
  const [coverage,  setCoverage]  = useState([]);
  const [taxonomy,  setTaxonomy]  = useState({});
  const [loading,   setLoading]   = useState(true);

  const load = () => {
    Promise.all([getCoverage(), getTaxonomy()])
      .then(([cov, t]) => { setCoverage(cov); setTaxonomy(t); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Timeline range
  const allDates = coverage.flatMap(c => [c.date_from, c.date_to]).filter(Boolean).sort();
  const MIN_DATE = allDates[0]?.slice(0,7) || "2021-01";
  const MAX_DATE = new Date().toISOString().slice(0,7);

  const monthsBetween = (a, b) => {
    if (!a || !b) return 0;
    const [ay,am] = a.split("-").map(Number);
    const [by,bm] = b.split("-").map(Number);
    return Math.max(1, (by-ay)*12+(bm-am));
  };
  const total = monthsBetween(MIN_DATE, MAX_DATE) || 1;
  const pct   = (d) => d ? Math.min(100, monthsBetween(MIN_DATE, d.slice(0,7)) / total * 100) : 0;

  // Year labels for timeline
  const startYear = parseInt(MIN_DATE.split("-")[0]);
  const endYear   = parseInt(MAX_DATE.split("-")[0]);
  const years = [];
  for (let y = startYear; y <= endYear; y++) years.push(y);

  if (loading) return <Spinner/>;

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
                  position:"absolute",
                  left:`${pct(src.date_from)}%`,
                  width:`${Math.max(1, pct(src.date_to) - pct(src.date_from))}%`,
                  height:"100%",
                  background:"var(--accent)",
                  borderRadius:3,
                  opacity:0.7,
                  minWidth:4,
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

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:20 }}>

        {/* Data operations */}
        <Card>
          <Label>DATA OPERATIONS</Label>
          {[
            {
              label: "Re-run categorization",
              desc:  "Apply all active rules to non-reviewed transactions",
              action: async () => {
                const r = await recategorize();
                alert(`Updated ${r.updated} transactions`);
                load();
              }
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

        {/* Taxonomy */}
        <Card>
          <Label>TAXONOMY — L1 / L2</Label>
          <div style={{ maxHeight:300, overflowY:"auto" }}>
            {Object.entries(taxonomy).map(([l1, l2s]) => (
              <div key={l1} style={{ marginBottom:12 }}>
                <div style={{ fontSize:11, fontWeight:500, color:"var(--text)", marginBottom:4 }}>{l1}</div>
                <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
                  {l2s.map(l2 => (
                    <span key={l2} style={{ fontSize:10, background:"var(--faint)", border:"1px solid var(--border)", padding:"2px 8px", borderRadius:4, color:"var(--text2)" }}>
                      {l2}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
