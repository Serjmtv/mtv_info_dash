// Token charts: stacked columns by day and stacked bars by project (Codex at the baseline, Claude on top).
// Marks grow from the baseline when shown; every value is also in the table view.
import { useState } from "react";
import { motion } from "motion/react";
import { fmt, useWidth } from "./ui.jsx";

const niceMax = (v) => { const p = Math.pow(10, Math.floor(Math.log10(Math.max(v, 1)))); return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v); };
const tick = (v) => fmt(v).replace(" тыс.", "K").replace(" млн", "M");
// rectangle with a rounded data end (top or right) and a square baseline end
function roundedEnd(x, y, w, h, r, dir) {
  r = Math.max(0, Math.min(r, dir === "up" ? h : w, dir === "up" ? w / 2 : h / 2));
  return dir === "up"
    ? `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
    : `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
}

function Tip({ tip }) {
  if (!tip) return null;
  const { x, y, title, row } = tip;
  return (
    <div className="tip" style={{ left: Math.min(x + 14, innerWidth - 180), top: y + 14 }}>
      <div className="t">{title}</div>
      <div className="r"><i style={{ background: "var(--claude)" }} /><b>{fmt(row.claude)}</b><span>Claude</span></div>
      <div className="r"><i style={{ background: "var(--codex)" }} /><b>{fmt(row.codex)}</b><span>Codex</span></div>
      <div className="r total"><i /><b>{fmt(row.claude + row.codex)}</b><span>всего</span></div>
    </div>
  );
}

function Table({ first, rows, keyOf }) {
  return (
    <table className="projects num">
      <thead><tr><th>{first}</th><th className="r">Claude</th><th className="r">Codex</th><th className="r">Всего</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={keyOf(r)}><td>{keyOf(r)}</td><td className="r">{fmt(r.claude)}</td><td className="r">{fmt(r.codex)}</td><td className="r">{fmt(r.claude + r.codex)}</td></tr>)}</tbody>
    </table>
  );
}

function Panel({ title, sub, children, table }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="panel" style={{ margin: 0 }}>
      <div className="section-head" style={{ margin: 0 }}>
        <div><h3>{title}</h3><div className="sub">{sub}</div></div>
        <button className="icon-btn" type="button" onClick={() => setAsTable(!asTable)}>{asTable ? "График" : "Таблица"}</button>
      </div>
      <div className="key"><span><i style={{ background: "var(--claude)" }} />Claude</span><span><i style={{ background: "var(--codex)" }} />Codex</span></div>
      {asTable ? table : children}
    </figure>
  );
}

export function DaysChart({ rows, period }) {
  const [ref, W] = useWidth();
  const [tip, setTip] = useState(null);
  const [hover, setHover] = useState(-1);
  const total = rows.reduce((s, r) => s + r.claude + r.codex, 0);
  const H = 210, m = { l: 48, r: 6, t: 20, b: 26 }, pw = Math.max(0, W - m.l - m.r), ph = H - m.t - m.b;
  const max = niceMax(Math.max(...rows.map((r) => r.claude + r.codex)));
  const y = (v) => m.t + ph - (v / max) * ph;
  const slot = rows.length ? pw / rows.length : 0, bw = Math.min(24, slot * 0.6), every = Math.ceil(rows.length / 10);
  const table = <Table first="День" rows={rows} keyOf={(r) => r.label} />;
  return (
    <Panel title="По дням" sub="токены без чтения из кэша" table={table}>
      <div className="chart" ref={ref}>
        {!total ? <div className="empty">За этот период расхода нет.</div> : W > 0 && (
          <svg viewBox={`0 0 ${W} ${H}`} height={H} role="img" aria-label="Расход токенов по дням">
            {[0, 0.25, 0.5, 0.75, 1].map((f) => (
              <g key={f}>
                <line x1={m.l} x2={W - m.r} y1={y(f * max)} y2={y(f * max)} stroke="var(--line)" shapeRendering="crispEdges" />
                <text x={m.l - 8} y={y(f * max) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" className="num">{tick(f * max)}</text>
              </g>
            ))}
            {rows.map((r, i) => {
              const cx = m.l + slot * (i + 0.5), x = cx - bw / 2;
              const hc = (r.codex / max) * ph, gap = hc > 0 && r.claude > 0 ? 2 : 0, hl = Math.max(0, (r.claude / max) * ph - gap);
              const yl = m.t + ph - hc - gap - hl;
              return (
                <g key={`${period}-${r.key}`}>
                  <motion.g
                    initial={{ scaleY: 0 }} animate={{ scaleY: 1, opacity: hover < 0 || hover === i ? 1 : 0.45 }}
                    transition={{ scaleY: { type: "spring", stiffness: 120, damping: 18, delay: 0.25 + i * (0.5 / rows.length) }, opacity: { duration: 0.15 } }}
                    style={{ originY: 1, transformBox: "fill-box" }}
                  >
                    {hc > 0 && <rect x={x} y={m.t + ph - hc} width={bw} height={hc} fill="var(--codex)" />}
                    {r.claude > 0 && <path d={roundedEnd(x, yl, bw, hl, 4, "up")} fill="var(--claude)" />}
                  </motion.g>
                  {(i % every === 0 || i === rows.length - 1) && <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted)">{r.label}</text>}
                  {i === rows.length - 1 && r.claude + r.codex > 0 && <text x={cx} y={Math.min(yl, m.t + ph - hc) - 6} textAnchor="middle" fontSize="11" fill="var(--ink)" className="num">{fmt(r.claude + r.codex)}</text>}
                  <rect x={m.l + slot * i} y={m.t} width={slot} height={ph} fill="transparent" tabIndex={0} aria-label={`${r.label}: Claude ${fmt(r.claude)}, Codex ${fmt(r.codex)}`}
                    onPointerMove={(e) => { setHover(i); setTip({ x: e.clientX, y: e.clientY, title: r.label, row: r }); }}
                    onFocus={(e) => { const b = e.target.getBoundingClientRect(); setHover(i); setTip({ x: b.right, y: b.top, title: r.label, row: r }); }}
                    onPointerLeave={() => { setHover(-1); setTip(null); }} onBlur={() => { setHover(-1); setTip(null); }} />
                </g>
              );
            })}
          </svg>
        )}
        <Tip tip={tip} />
      </div>
    </Panel>
  );
}

export function ProjectsChart({ rows, period }) {
  const [ref, W] = useWidth();
  const [tip, setTip] = useState(null);
  const rowH = 32, bh = 16, labelW = Math.min(190, W * 0.38), valueW = 72, H = rows.length * rowH + 4;
  const max = Math.max(1, ...rows.map((r) => r.claude + r.codex)), pw = Math.max(0, W - labelW - valueW);
  const table = <Table first="Проект" rows={rows} keyOf={(r) => r.name} />;
  return (
    <Panel title="По проектам" sub="токены без чтения из кэша" table={table}>
      <div className="chart" ref={ref}>
        {!rows.length ? <div className="empty">За этот период расхода нет.</div> : W > 0 && (
          <svg viewBox={`0 0 ${W} ${H}`} height={H} role="img" aria-label="Расход токенов по проектам">
            <line x1={labelW} x2={labelW} y1={0} y2={H} stroke="var(--line)" shapeRendering="crispEdges" />
            {rows.map((r, i) => {
              const y0 = i * rowH + (rowH - bh) / 2 + 2, wc = (r.codex / max) * pw, gap = wc > 0 && r.claude > 0 ? 2 : 0, wl = Math.max(0, (r.claude / max) * pw - gap);
              const label = r.name.length > 26 ? r.name.slice(0, 25) + "…" : r.name;
              return (
                <g key={`${period}-${r.name}`}>
                  <text x={labelW - 10} y={y0 + bh / 2 + 4} textAnchor="end" fontSize="12" fill={r.outside ? "var(--muted)" : "var(--ink)"}>{label}</text>
                  <motion.g initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ type: "spring", stiffness: 110, damping: 20, delay: 0.3 + i * 0.06 }} style={{ originX: 0, transformBox: "fill-box" }}>
                    {wc > 0 && <rect x={labelW} y={y0} width={wc} height={bh} fill="var(--codex)" />}
                    {r.claude > 0 && <path d={roundedEnd(labelW + wc + gap, y0, wl, bh, 4, "right")} fill="var(--claude)" />}
                  </motion.g>
                  <motion.text initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 + i * 0.06 }} x={labelW + wc + gap + wl + 8} y={y0 + bh / 2 + 4} fontSize="11" fill="var(--ink)" className="num">{fmt(r.claude + r.codex)}</motion.text>
                  <rect x={0} y={i * rowH} width={W} height={rowH} fill="transparent" tabIndex={0} aria-label={`${r.name}: Claude ${fmt(r.claude)}, Codex ${fmt(r.codex)}`}
                    onPointerMove={(e) => setTip({ x: e.clientX, y: e.clientY, title: r.name, row: r })} onPointerLeave={() => setTip(null)}
                    onFocus={(e) => { const b = e.target.getBoundingClientRect(); setTip({ x: b.right, y: b.top, title: r.name, row: r }); }} onBlur={() => setTip(null)} />
                </g>
              );
            })}
          </svg>
        )}
        <Tip tip={tip} />
      </div>
    </Panel>
  );
}
