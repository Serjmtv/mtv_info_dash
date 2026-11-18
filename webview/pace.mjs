// Pace of a limit window: share of the limit spent vs share of the window's time passed.
// No imports, so test/selftest.js can check it with plain Node.

// Share of the window's time that has passed (0..1), or null when the window has no running clock.
export function elapsed(w, now) {
  if (!w || !w.resetsAt || !w.spanMs) return null;
  return Math.min(1, Math.max(0, 1 - (w.resetsAt - now) / w.spanMs));
}

export function duration(ms) {
  const min = Math.max(0, Math.round(ms / 6e4));
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 ? `${h} ч ${min % 60} мин` : `${h} ч`;
  return h % 24 ? `${Math.floor(h / 24)} д ${h % 24} ч` : `${Math.floor(h / 24)} д`;
}

// ±5 points around the time dot counts as "on pace"; a spent limit has no pace, its note says so.
export function paceOf(w, now = Date.now()) {
  const t = elapsed(w, now);
  if (t == null || w.pct >= 100) return null;
  const u = w.pct / 100;
  const tone = t < 0.02 ? "start" : u > t + 0.05 ? "fast" : u < t - 0.05 ? "slow" : "even";
  const label = { start: "Окно только началось", fast: "Тратится быстрее времени", slow: "С запасом", even: "Ровно по времени" }[tone];
  return { t, tone, label, passed: `прошло ${duration(t * w.spanMs)} из ${duration(w.spanMs)}`, share: `${w.pct}% лимита за ${Math.round(t * 100)}% окна` };
}
