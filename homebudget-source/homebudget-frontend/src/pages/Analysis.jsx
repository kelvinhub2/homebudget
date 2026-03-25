import { useState, useEffect } from "react";
import { getBreakdown } from "../api";
import { Spinner, L1_COLORS } from "../components";

const fmt = (n) => {
  if (n == null) return "—";
  const abs = Math.abs(n).toLocaleString("de-CH", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return (n < 0 ? "−" : "+") + " " + abs;
};

const Bar = ({ amt, max }) => {
  const w = max > 0 ? Math.round(Math.abs(amt) / max * 100) : 0;
  return (
    <div style={{ width: 120, height: 6, background: "var(--faint)", borderRadius: 2, overflow: "hidden" }}>
      <div style={{ width: `${w}%`, height: "100%", borderRadius: 2, background: amt < 0 ? "#E24B4A" : "#639922" }} />
    </div>
  );
};

export default function Analysis() {
  const [data,     setData]     = useState(null);
  const [year,     setYear]     = useState("all");
  const [loading,  setLoading]  = useState(true);
  const [openL1,   setOpenL1]   = useState({});
  const [openL2,   setOpenL2]   = useState({});
  const [hidden,   setHidden]   = useState({});  // CR-018: hidden L1s

  useEffect(() => {
    setLoading(true);
    getBreakdown(year)
      .then(setData)
      .finally(() => setLoading(false));
  }, [year]);

  const toggleL1     = (l1)  => setOpenL1(p => ({ ...p, [l1]: !p[l1] }));
  const toggleL2     = (key) => setOpenL2(p => ({ ...p, [key]: !p[key] }));
  const toggleHidden = (l1)  => setHidden(p => ({ ...p, [l1]: !p[l1] }));

  if (loading) return <Spinner />;
  if (!data)   return <div style={{ color: "var(--red)" }}>Failed to load</div>;

  // Only visible L1s contribute to bar scale
  const visibleRows = data.breakdown.filter(d => !hidden[d.l1]);
  const maxAbs = Math.max(...visibleRows.map(d => Math.abs(d.amt)), 1);

  return (
    <div>
      {/* Year selector */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.1em" }}>YEAR</span>
        {["all", ...(data.years || [])].map(y => (
          <button key={y} onClick={() => setYear(y)}
            style={{
              padding: "5px 12px", borderRadius: 5, border: "1px solid var(--border)",
              background: year === y ? "var(--accent)" : "var(--faint)",
              color: year === y ? "#fff" : "var(--text2)",
              fontSize: 11, cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.06em"
            }}>
            {y === "all" ? "ALL" : y}
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--muted)" }}>
          {data.grand.cnt} transactions
        </span>
      </div>

      {/* L1 filter chips — click dot to hide/show */}
      <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--muted)", letterSpacing: "0.1em" }}>SCALE</span>
        {data.breakdown.map(l1 => {
          const color  = L1_COLORS[l1.l1] || "#888";
          const isHidden = hidden[l1.l1];
          return (
            <button key={l1.l1} onClick={() => toggleHidden(l1.l1)}
              title={isHidden ? "Click to include in scale" : "Click to exclude from scale"}
              style={{
                display: "flex", alignItems: "center", gap: 5,
                padding: "4px 10px", borderRadius: 20,
                border: `1px solid ${isHidden ? "var(--border)" : color + "60"}`,
                background: isHidden ? "var(--faint)" : color + "15",
                cursor: "pointer", fontSize: 10, fontFamily: "inherit",
                color: isHidden ? "var(--muted)" : "var(--text2)",
                opacity: isHidden ? 0.5 : 1, transition: "all 0.15s"
              }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: isHidden ? "#888" : color, display: "inline-block", flexShrink: 0 }} />
              {l1.l1}
            </button>
          );
        })}
        {Object.values(hidden).some(Boolean) && (
          <button onClick={() => setHidden({})}
            style={{ fontSize: 10, color: "var(--accent)", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}>
            Reset
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, overflow: "hidden" }}>
        {/* Header */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 60px 110px", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--border)", background: "var(--surface2)" }}>
          {["CATEGORY", "", "TX", "CHF"].map((h, i) => (
            <div key={i} style={{ fontSize: 9, letterSpacing: "0.14em", color: "var(--muted)", textAlign: i > 1 ? "right" : "left" }}>{h}</div>
          ))}
        </div>

        {/* L1 rows */}
        {data.breakdown.map(l1 => {
          const color    = L1_COLORS[l1.l1] || "#888";
          const isOpen   = openL1[l1.l1];
          const isHidden = hidden[l1.l1];
          return (
            <div key={l1.l1} style={{ opacity: isHidden ? 0.35 : 1, transition: "opacity 0.15s" }}>
              {/* L1 row */}
              <div onClick={() => toggleL1(l1.l1)} style={{ display: "grid", gridTemplateColumns: "1fr 130px 60px 110px", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--faint)", background: "var(--surface2)", cursor: "pointer", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 9, color: "var(--muted)", width: 10 }}>{isOpen ? "▼" : "▶"}</span>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block", flexShrink: 0 }} />
                  <span style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>{l1.l1}</span>
                </div>
                <Bar amt={l1.amt} max={maxAbs} />
                <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "right" }}>{l1.cnt}</div>
                <div style={{ fontSize: 13, fontWeight: 500, color: l1.amt < 0 ? "#E24B4A" : "#639922", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  {fmt(l1.amt)}
                </div>
              </div>

              {/* L2 rows */}
              {isOpen && l1.l2.map(l2 => {
                const key2   = `${l1.l1}|${l2.l2}`;
                const isOpen2 = openL2[key2];
                const hasMerchants = l2.merchants?.length > 0;
                return (
                  <div key={l2.l2}>
                    <div onClick={() => hasMerchants && toggleL2(key2)}
                      style={{ display: "grid", gridTemplateColumns: "1fr 130px 60px 110px", gap: 8, padding: "8px 16px 8px 40px", borderBottom: "1px solid var(--faint)", cursor: hasMerchants ? "pointer" : "default", alignItems: "center" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 9, color: "var(--muted)", width: 10 }}>{hasMerchants ? (isOpen2 ? "▼" : "▶") : " "}</span>
                        <span style={{ fontSize: 12, color: "var(--text2)" }}>{l2.l2}</span>
                      </div>
                      <Bar amt={l2.amt} max={maxAbs} />
                      <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "right" }}>{l2.cnt}</div>
                      <div style={{ fontSize: 12, color: l2.amt < 0 ? "#E24B4A" : "#639922", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                        {fmt(l2.amt)}
                      </div>
                    </div>

                    {/* Merchant rows */}
                    {isOpen2 && l2.merchants.map(m => (
                      <div key={m.merchant} style={{ display: "grid", gridTemplateColumns: "1fr 130px 60px 110px", gap: 8, padding: "6px 16px 6px 64px", borderBottom: "1px solid var(--faint)", alignItems: "center" }}>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{m.merchant}</div>
                        <div />
                        <div style={{ fontSize: 11, color: "var(--muted)", textAlign: "right" }}>{m.cnt}</div>
                        <div style={{ fontSize: 11, color: m.amt < 0 ? "#E24B4A" : "#639922", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                          {fmt(m.amt)}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* Unclassified row */}
        {data.unclassified.cnt > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 60px 110px", gap: 8, padding: "10px 16px", borderBottom: "1px solid var(--faint)", background: "var(--surface2)", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 10 }} />
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#888", display: "inline-block" }} />
              <span style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>(unclassified)</span>
            </div>
            <Bar amt={data.unclassified.amt} max={maxAbs} />
            <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "right" }}>{data.unclassified.cnt}</div>
            <div style={{ fontSize: 12, color: "#E24B4A", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(data.unclassified.amt)}</div>
          </div>
        )}

        {/* Grand total — only visible L1s */}
        {(() => {
          const visGrand = visibleRows.reduce((acc, d) => ({
            cnt: acc.cnt + d.cnt,
            amt: acc.amt + d.amt
          }), { cnt: 0, amt: 0 });
          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 130px 60px 110px", gap: 8, padding: "12px 16px", background: "var(--surface2)", borderTop: "1px solid var(--border)", alignItems: "center" }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: "var(--text)" }}>
                Grand total
                {Object.values(hidden).some(Boolean) && <span style={{ fontSize: 10, color: "var(--muted)", marginLeft: 8 }}>(filtered)</span>}
              </div>
              <div />
              <div style={{ fontSize: 12, fontWeight: 500, color: "var(--text)", textAlign: "right" }}>{visGrand.cnt}</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: visGrand.amt < 0 ? "#E24B4A" : "#639922", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                {fmt(visGrand.amt)}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
