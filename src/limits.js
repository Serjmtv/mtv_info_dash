// Remaining usage limits of Claude Code and Codex, read from files the agents write themselves.
const fs = require("fs");
const path = require("path");
const os = require("os");

const HOME = os.homedir();

// A window whose reset time has passed is empty again, whatever the stale snapshot says.
function makeWindow(usedPercent, resetsAt, now) {
  if (typeof usedPercent !== "number") return null;
  if (resetsAt && resetsAt <= now) return { usedPercent: 0, resetsAt: null, reset: true };
  return { usedPercent, resetsAt: resetsAt || null, reset: false };
}

// "claude_pro" -> "pro"; only this one field of the account block is read (no e-mail, no tokens).
function planName(organizationType) {
  return typeof organizationType === "string" && organizationType ? organizationType.replace(/^claude_/, "").replace(/_/g, " ") : null;
}

// Claude Code caches what /usage shows in ~/.claude.json (key cachedUsageUtilization).
function readClaude(now = Date.now(), file = path.join(HOME, ".claude.json")) {
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    const cache = json.cachedUsageUtilization;
    const u = cache && cache.utilization;
    if (!u) return null;
    const win = (w) => w && makeWindow(w.utilization, w.resets_at ? Date.parse(w.resets_at) : null, now);
    return { agent: "claude", plan: planName(json.oauthAccount && json.oauthAccount.organizationType), observedAt: cache.fetchedAtMs, fiveHour: win(u.five_hour), week: win(u.seven_day) };
  } catch {
    return null;
  }
}

function listRollouts(dir = path.join(HOME, ".codex", "sessions")) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.startsWith("rollout-") && e.name.endsWith(".jsonl")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

// Reads at most the last `bytes` of a file: token_count events are frequent, so the tail is enough.
function readTail(file, bytes = 512 * 1024) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

const HOUR = 3600 * 1000;

// Percent per hour within one limit window, from the oldest and newest sample of the last hour.
function pace(samples) {
  if (samples.length < 2) return null;
  const a = samples[0], b = samples[samples.length - 1];
  if (b.ts - a.ts < 10 * 60 * 1000 || a.resetsAt !== b.resetsAt) return null;
  return Math.max(0, (b.pct - a.pct) / ((b.ts - a.ts) / HOUR));
}

// Codex logs rate_limits in every token_count event of its session rollouts.
function readCodex(now = Date.now(), files = listRollouts()) {
  const byMtime = files
    .map((f) => ({ f, t: fs.statSync(f).mtimeMs }))
    .sort((a, b) => b.t - a.t)
    .slice(0, 5);
  const events = [];
  for (const { f, t } of byMtime) {
    if (events.length && t < now - HOUR) break;
    for (const line of readTail(f).split("\n")) {
      if (!line.includes('"rate_limits"')) continue;
      let ev;
      try { ev = JSON.parse(line); } catch { continue; }
      const rl = ev.payload && ev.payload.rate_limits;
      if (rl && (rl.primary || rl.secondary)) events.push({ ts: Date.parse(ev.timestamp), rl });
    }
  }
  if (!events.length) return null;
  events.sort((a, b) => a.ts - b.ts);
  const latest = events[events.length - 1];
  const recent = events.filter((e) => e.ts >= latest.ts - HOUR);
  const result = { agent: "codex", plan: latest.rl.plan_type || null, observedAt: latest.ts, fiveHour: null, week: null };
  for (const slot of ["primary", "secondary"]) {
    const w = latest.rl[slot];
    if (!w) continue;
    const key = w.window_minutes >= 10080 ? "week" : "fiveHour";
    result[key] = makeWindow(w.used_percent, w.resets_at ? w.resets_at * 1000 : null, now);
    const samples = recent.filter((e) => e.rl[slot]).map((e) => ({ ts: e.ts, pct: e.rl[slot].used_percent, resetsAt: e.rl[slot].resets_at }));
    if (result[key] && !result[key].reset) result[key].pacePerHour = pace(samples);
  }
  return result;
}

// When the window runs out at the current pace; null when it lasts until reset or pace is unknown.
function runsOutAt(w, observedAt) {
  if (!w || !w.pacePerHour || !w.resetsAt) return null;
  const at = observedAt + ((100 - w.usedPercent) / w.pacePerHour) * HOUR;
  return at < w.resetsAt ? at : null;
}

function maxPercent(limits) {
  if (!limits) return null;
  const values = [limits.fiveHour, limits.week].filter(Boolean).map((w) => w.usedPercent);
  return values.length ? Math.max(...values) : null;
}

function severity(percent, warn = 80, critical = 95) {
  if (percent == null) return "unknown";
  if (percent >= critical) return "critical";
  if (percent >= warn) return "warning";
  return "good";
}

// The cache above goes stale during a long VS Code session: Claude Code rewrites it only at start and on /usage.
// The official CLI runs /usage locally (no model call) and refreshes the cache; we never touch its credentials.
function refreshClaudeUsage(exe, cwd, timeout = 30000) {
  return new Promise((resolve) => {
    require("child_process").execFile(exe, ["-p", "/usage", "--no-session-persistence"], { cwd, timeout, windowsHide: true }, (err) => resolve(!err));
  });
}

// Refresh when the snapshot is older than the interval, at most once per interval; 0 turns it off.
function needsClaudeRefresh(snapshot, now, intervalMs, lastAttemptAt = 0) {
  if (!intervalMs || now - lastAttemptAt < intervalMs) return false;
  return !snapshot || now - snapshot.observedAt >= intervalMs;
}

module.exports = { readClaude, planName, readCodex, listRollouts, readTail, maxPercent, severity, pace, runsOutAt, refreshClaudeUsage, needsClaudeRefresh, HOME };
