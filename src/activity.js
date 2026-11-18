// Token usage per day and recent sessions of both agents, parsed from their local logs.
const fs = require("fs");
const path = require("path");
const { HOME, listRollouts } = require("./limits");

const cache = new Map(); // file -> { mtimeMs, size, result }

function dayOf(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function normPath(p) {
  if (!p) return "";
  let s = String(p);
  if (s.startsWith("file:///")) s = decodeURIComponent(s.slice(8));
  return s.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function cached(file, parse) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.result;
  let result = null;
  try { result = parse(fs.readFileSync(file, "utf8")); } catch { /* unreadable or mid-write: skip this round */ }
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, result });
  return result;
}

function addUsage(usage, day, tokens) {
  if (tokens > 0) usage[day] = (usage[day] || 0) + tokens;
}

// Claude transcript: one line per event; an answer may repeat over several lines with the same message id.
function parseClaude(text) {
  const usage = {};
  const seen = new Set();
  let cwd = "", title = "", last = 0, id = "";
  for (const line of text.split("\n")) {
    if (!line) continue;
    const isAnswer = line.includes('"usage"') && line.includes('"assistant"');
    const isTitle = line.startsWith('{"type":"ai-title"');
    if (!isAnswer && !isTitle && cwd) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (o.cwd) cwd = o.cwd;
    if (o.sessionId) id = o.sessionId;
    if (isTitle && o.aiTitle) title = o.aiTitle;
    if (o.type !== "assistant" || !o.message || !o.message.usage) continue;
    const ts = Date.parse(o.timestamp);
    if (ts > last) last = ts;
    const key = o.message.id || o.requestId || o.uuid;
    if (seen.has(key)) continue;
    seen.add(key);
    const u = o.message.usage;
    addUsage(usage, dayOf(ts), (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0));
  }
  return { agent: "claude", id, title, cwd, last, usage };
}

// Codex rollout: token_count totals grow during a session, so each day gets the growth seen that day.
function parseCodex(text) {
  const usage = {};
  let cwd = "", id = "", last = 0, auto = false, prev = 0;
  for (const line of text.split("\n")) {
    if (!line) continue;
    const isMeta = line.includes('"session_meta"');
    const isCount = line.includes('"token_count"') && line.includes('"total_token_usage"');
    const isTurn = !auto && line.includes('"turn_context"');
    if (!isMeta && !isCount && !isTurn) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    const p = o.payload || {};
    if (isMeta && o.type === "session_meta") { cwd = p.cwd || cwd; id = p.id || p.session_id || id; }
    if (isTurn && o.type === "turn_context" && String(p.model || "").includes("auto-review")) auto = true;
    if (isCount && p.info && p.info.total_token_usage) {
      const t = p.info.total_token_usage;
      const total = (t.input_tokens || 0) - (t.cached_input_tokens || 0) + (t.output_tokens || 0);
      const ts = Date.parse(o.timestamp);
      if (ts > last) last = ts;
      addUsage(usage, dayOf(ts), total - prev);
      prev = Math.max(prev, total);
    }
  }
  return { agent: "codex", id, title: "", cwd, last, auto, usage };
}

function listClaudeTranscripts(dir = path.join(HOME, ".claude", "projects")) {
  const out = [];
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".jsonl")) out.push(p);
    }
  };
  walk(dir);
  return out;
}

function codexTitles(file = path.join(HOME, ".codex", "session_index.jsonl")) {
  const titles = {};
  try {
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      if (!line) continue;
      try { const o = JSON.parse(line); titles[o.id] = o.thread_name; } catch { /* skip broken line */ }
    }
  } catch { /* no index yet */ }
  return titles;
}

// Returns { sessions, usage }: sessions newest first; usage rows { agent, day, cwd, tokens }.
function scan() {
  const sessions = [];
  const usage = [];
  const collect = (r, file, isSubagent) => {
    if (!r) return;
    for (const [day, tokens] of Object.entries(r.usage)) usage.push({ agent: r.agent, day, cwd: r.cwd, tokens });
    if (!isSubagent && r.last) sessions.push({ ...r, file });
  };
  for (const f of listClaudeTranscripts()) collect(cached(f, parseClaude), f, f.includes(`${path.sep}subagents${path.sep}`));
  const titles = codexTitles();
  for (const f of listRollouts()) {
    const r = cached(f, parseCodex);
    collect(r && { ...r, title: titles[r.id] || "" }, f, false);
  }
  sessions.sort((a, b) => b.last - a.last);
  return { sessions, usage };
}

module.exports = { scan, normPath, dayOf, parseClaude, parseCodex };
