// Shared bits of both webviews: VS Code bridge, number formatting, small animated controls.
import { useEffect, useRef, useState } from "react";
import { motion, useMotionValueEvent, useReducedMotion, useSpring } from "motion/react";

export const vscode = acquireVsCodeApi();
export const run = (command, args) => vscode.postMessage({ type: "command", command, args });

export const fmt = (n) =>
  n >= 1e6 ? (n / 1e6).toLocaleString("ru-RU", { maximumFractionDigits: 2 }) + " млн"
  : n >= 1e3 ? Math.round(n / 1e3).toLocaleString("ru-RU") + " тыс."
  : String(n);

export const agentColor = (agent) => `var(--${agent})`;
export const stateColor = (sev, agent) => (sev === "critical" ? "var(--critical)" : sev === "warning" ? "var(--warning)" : agentColor(agent));

// Counts up to the value on first show and glides to new values after a refresh.
export function AnimatedNumber({ value, suffix = "", as: Tag = "span" }) {
  const reduce = useReducedMotion();
  const spring = useSpring(reduce ? value : 0, { stiffness: 70, damping: 20 });
  const [shown, setShown] = useState(reduce ? value : 0);
  useEffect(() => { reduce ? setShown(value) : spring.set(value); }, [value, reduce, spring]);
  useMotionValueEvent(spring, "change", (v) => setShown(Math.round(v)));
  return <Tag className="num">{shown}{suffix}</Tag>;
}

const ICONS = {
  good: <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#0ca30c" /><path d="M4.8 8.2l2.1 2.1 4.3-4.4" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  warning: <svg viewBox="0 0 16 16"><path d="M8 1.5L15 14H1z" fill="#fab219" stroke="#fab219" strokeLinejoin="round" /><path d="M8 6v3.6" stroke="#0b0b0b" strokeWidth="1.5" strokeLinecap="round" /><circle cx="8" cy="11.8" r=".9" fill="#0b0b0b" /></svg>,
  critical: <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#d03b3b" /><path d="M8 4.2v4.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" /><circle cx="8" cy="11.4" r="1" fill="#fff" /></svg>,
  unknown: <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.3" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M6.3 6.3a1.8 1.8 0 1 1 2.4 1.7c-.5.2-.7.6-.7 1.1v.4" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /><circle cx="8" cy="11.6" r=".8" fill="currentColor" /></svg>,
};

// Colour never carries the state alone: icon and words come with it.
export function State({ sev, children }) {
  return <span className="state">{ICONS[sev] || ICONS.unknown}<span>{children}</span></span>;
}

export function RefreshIcon({ spinning }) {
  return (
    <motion.svg viewBox="0 0 16 16" animate={spinning ? { rotate: 360 } : { rotate: 0 }} transition={spinning ? { repeat: Infinity, duration: 1, ease: "linear" } : { duration: 0 }}>
      <path d="M13 8a5 5 0 1 1-1.5-3.55 M13 2.5v3h-3" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </motion.svg>
  );
}

// Segmented control: the highlight slides to the chosen option (shared layoutId).
export function Segmented({ id, options, value, onChange }) {
  return (
    <span className="seg" role="group">
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.value === value && <motion.span className="pill" layoutId={`pill-${id}`} transition={{ type: "spring", stiffness: 420, damping: 34 }} />}
          {o.label}
        </button>
      ))}
    </span>
  );
}

// Width of an element, kept current on resize (charts draw to it).
export function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}
