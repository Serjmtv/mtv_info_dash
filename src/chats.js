// Open agent chats = running Claude Code / Codex processes; "stop all" ends them (D-013).
const { execFile } = require("child_process");

const ACTIVE_MS = 2 * 60 * 1000; // a transcript written this recently means the chat is generating now

function run(cmd, args, timeout = 15000) {
  return new Promise((resolve) => execFile(cmd, args, { timeout, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, out) => resolve(err ? null : out)));
}

// shortcut: Windows only (the user's machine); on macOS/Linux add a `ps -eo` branch here.
async function listAgentProcesses() {
  if (process.platform !== "win32") return [];
  const ps = "Get-CimInstance Win32_Process -Filter \"Name='claude.exe' OR Name='codex.exe'\" | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; name = $_.Name; started = $_.CreationDate.ToString('o'); cmd = $_.CommandLine } } | ConvertTo-Json -Compress";
  const out = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps]);
  if (!out || !out.trim()) return [];
  try {
    const list = [].concat(JSON.parse(out));
    return list.map((p) => ({ pid: p.pid, name: p.name.toLowerCase(), startedAt: Date.parse(p.started), cmd: p.cmd || "" }));
  } catch {
    return [];
  }
}

// Turns processes + parsed sessions into chats. Our own `claude -p /usage` refresher is not a chat.
function describeChats(procs, sessions, now = Date.now()) {
  const chats = [];
  const claudeSessions = sessions.filter((s) => s.agent === "claude");
  const used = new Set();
  const claudeProcs = procs
    .filter((p) => p.name === "claude.exe" && !/(^|\s)(-p|--print)(\s|$)/.test(p.cmd))
    .map((p) => ({ ...p, sessionId: (/--resume[ =]([0-9a-f-]{36})/i.exec(p.cmd) || [])[1] || null }))
    .sort((a, b) => a.startedAt - b.startedAt);
  // resumed chats name their session; fresh ones get the newest unclaimed session written after they started
  for (const p of claudeProcs) if (p.sessionId) used.add(p.sessionId);
  for (const p of claudeProcs) {
    let s = p.sessionId && claudeSessions.find((x) => x.id === p.sessionId);
    if (!p.sessionId) {
      s = claudeSessions.filter((x) => !used.has(x.id) && x.last >= p.startedAt).sort((a, b) => b.last - a.last)[0];
      if (s) used.add(s.id);
    }
    chats.push({ agent: "claude", pid: p.pid, sessionId: s ? s.id : null, title: (s && s.title) || "Новый чат", startedAt: p.startedAt, last: s ? s.last : null, working: !!s && now - s.last < ACTIVE_MS, cwd: s ? s.cwd : "" });
  }
  // Codex serves all its chats from one app-server process
  for (const p of procs.filter((x) => x.name === "codex.exe")) {
    const threads = sessions.filter((s) => s.agent === "codex" && !s.auto && s.last >= p.startedAt).sort((a, b) => b.last - a.last);
    const last = threads.length ? threads[0].last : null;
    const title = threads.length ? threads.slice(0, 2).map((t) => t.title || "без названия").join(", ") + (threads.length > 2 ? ` и ещё ${threads.length - 2}` : "") : "Codex";
    chats.push({ agent: "codex", pid: p.pid, sessionId: threads.length ? threads[0].id : null, title, threads: threads.length, startedAt: p.startedAt, last, working: !!last && now - last < ACTIVE_MS, cwd: threads.length ? threads[0].cwd : "" });
  }
  return chats;
}

// Ends each process with its children (MCP servers, shells). Returns how many stopped.
async function stopProcesses(pids) {
  const results = await Promise.all(pids.map((pid) => run("taskkill.exe", ["/PID", String(pid), "/T", "/F"])));
  return results.filter((r) => r !== null).length;
}

module.exports = { listAgentProcesses, describeChats, stopProcesses, ACTIVE_MS };
