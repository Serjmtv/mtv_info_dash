// Sidebar «Лимиты»: the same dials, small, side by side.
import { Dial, paceOf } from "./Dial.jsx";
import { State } from "./ui.jsx";

export function LimitsPanel({ data }) {
  const alerts = data.limits.flatMap((a) => a.windows.filter((w) => w.word).map((w) => ({ a, w })));
  return (
    <div className="side">
      <div className="pair">
        {data.limits.map((a, i) => (
          <div className="mini" key={a.agent}>
            <div className="name"><i className="dot" style={{ background: `var(--${a.agent})` }} />{a.name}{a.plan && <span className="muted" style={{ fontWeight: 400 }}>{a.plan}</span>}</div>
            <Dial agent={a.agent} windows={a.windows} delay={0.1 + i * 0.12} compact />
            <div className="when">{a.refreshing ? "обновляю…" : a.observed ? `обновлён ${a.observed}` : "нет данных"}</div>
          </div>
        ))}
      </div>
      <div className="rows">
        {data.limits.flatMap((a) => a.windows.map((w) => {
          const pace = paceOf(w);
          return (
            <div key={a.agent + w.label}>
              <span>{a.name}, {w.label.toLowerCase()}<small>{w.resetShort}{pace ? `, ${pace.label.toLowerCase()}` : ""}</small></span>
              <b>{w.pct}%</b>
            </div>
          );
        }))}
      </div>
      {alerts.map(({ a, w }) => <div className="hint" key={a.agent + w.label}><State sev={w.sev}>{a.name}, {w.label.toLowerCase()}: {w.word}</State></div>)}
      {data.limits.filter((a) => a.hint).map((a) => <div className="hint" key={a.agent}>{a.name}: {a.hint}</div>)}
    </div>
  );
}
