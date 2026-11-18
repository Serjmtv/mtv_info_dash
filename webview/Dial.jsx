// A limit dial: inner ring = 5-hour window, outer ring = week. The arc is the share used;
// the dot is how much of the window's time has passed, so an arc ahead of its dot burns faster than time.
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useReducedMotion, useSpring, useTransform } from "motion/react";
import { AnimatedNumber, stateColor } from "./ui.jsx";
import { elapsed, paceOf } from "./pace.mjs";

export { paceOf };

const C = 110; // centre of the 220×220 drawing

function Ring({ w, r, width, agent, delay, now, onTip }) {
  const reduce = useReducedMotion();
  const share = w ? Math.min(1, w.pct / 100) : 0;
  const color = w ? stateColor(w.sev, agent) : "var(--track)";
  const spring = { type: "spring", stiffness: 55, damping: 17, delay: reduce ? 0 : delay };
  const time = elapsed(w, now);
  const t = useSpring(0, { stiffness: 40, damping: 16 });
  useEffect(() => {
    if (time == null) return;
    if (reduce) { t.jump(time); return; }
    const timer = setTimeout(() => t.set(time), delay * 1000);
    return () => clearTimeout(timer);
  }, [time, reduce, delay, t]);
  const cx = useTransform(t, (v) => C + r * Math.cos(v * 2 * Math.PI - Math.PI / 2));
  const cy = useTransform(t, (v) => C + r * Math.sin(v * 2 * Math.PI - Math.PI / 2));
  const pace = w && paceOf(w, now);
  const label = w ? [`${w.label}: израсходовано ${w.pct}%`, pace && pace.passed, pace && pace.label.toLowerCase(), w.resetLong].filter(Boolean).join(", ") : "";
  const show = (x, y) => onTip(w && { x, y, w, pace });
  return (
    <g>
      <circle cx={C} cy={C} r={r} fill="none" stroke="var(--track)" strokeWidth={width} />
      <motion.circle
        cx={C} cy={C} r={r} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round"
        transform={`rotate(-90 ${C} ${C})`}
        style={{ filter: `drop-shadow(0 0 6px ${color})` }}
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: share, opacity: share > 0 ? 1 : 0 }}
        transition={spring}
      />
      {time != null && <motion.circle cx={cx} cy={cy} r={4.5} fill="var(--ink-strong)" stroke="var(--surface)" strokeWidth={2.5} />}
      {w && (
        // wide invisible ring: the hover and keyboard target for this window
        <circle
          cx={C} cy={C} r={r} fill="none" stroke="transparent" strokeWidth={width + 12} style={{ pointerEvents: "stroke", outline: "none" }}
          tabIndex={0} role="img" aria-label={label}
          onPointerMove={(e) => show(e.clientX, e.clientY)} onPointerLeave={() => onTip(null)}
          onFocus={(e) => { const b = e.target.getBoundingClientRect(); show(b.right, b.top + b.height / 2); }} onBlur={() => onTip(null)}
        />
      )}
    </g>
  );
}

// Rendered into <body>: inside the tilting card, `position: fixed` would be relative to the card and clipped by it.
function DialTip({ tip }) {
  if (!tip) return null;
  const { x, y, w, pace } = tip;
  return createPortal(
    <div className="tip" style={{ left: Math.min(x + 14, innerWidth - 230), top: Math.min(y + 14, innerHeight - 120) }}>
      <div className="t">{w.label}</div>
      <div><b className="num">{w.pct}%</b> израсходовано</div>
      {pace && <div>{pace.passed} ({Math.round(pace.t * 100)}%)</div>}
      {pace && <div className={`pace pace-${pace.tone}`}><i />{pace.label}</div>}
      <div className="muted">{w.resetLong}</div>
    </div>,
    document.body,
  );
}

export function Dial({ agent, windows, delay = 0, compact = false }) {
  const [tip, setTip] = useState(null);
  const five = windows.find((w) => w.label === "5 часов");
  const week = windows.find((w) => w.label === "Неделя");
  const now = Date.now();
  const main = five || week;
  return (
    <div className="dial-box">
      <svg viewBox="0 0 220 220" aria-label={windows.map((w) => `${w.label}: ${w.pct}%`).join(", ") || "нет данных"}>
        <Ring w={week} r={96} width={compact ? 12 : 10} agent={agent} delay={delay + 0.15} now={now} onTip={setTip} />
        <Ring w={five} r={compact ? 70 : 74} width={compact ? 12 : 10} agent={agent} delay={delay} now={now} onTip={setTip} />
        <text x={C} y={compact ? 122 : 116} textAnchor="middle" className="center" fill="var(--ink-strong)" fontSize={compact ? 40 : 44} fontWeight="600" style={{ pointerEvents: "none" }}>
          {main ? <AnimatedNumber as="tspan" value={main.pct} suffix="%" /> : "—"}
        </text>
        {!compact && (
          <text x={C} y={140} textAnchor="middle" fill="var(--muted)" fontSize="12" style={{ pointerEvents: "none" }}>
            {main ? (main === five ? "за 5 часов" : "за неделю") : "нет данных"}
          </text>
        )}
      </svg>
      <DialTip tip={tip} />
    </div>
  );
}
