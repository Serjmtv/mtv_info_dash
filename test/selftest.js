// Self-check of the data layer, without VS Code. Run:
//   $env:ELECTRON_RUN_AS_NODE = "1"; & "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" test\selftest.js [projectsRoot]
const assert = require("assert");
const path = require("path");
const limits = require("../src/limits");
const activity = require("../src/activity");
const projects = require("../src/projects");

// --- unit checks on fixed input ---
const status = projects.parseStatus(`---
stage: тест
updated: 2026-11-01 23:00
---
## Сейчас
- [Codex] сборщик лимитов — с 10:00
<!-- - [Claude] закомментировано -->
## Дальше
1. **первое**
2. второе
## Блокеры
- нет Node.js
`);
assert.strictEqual(status.stage, "тест");
assert.deepStrictEqual(status.now, ["[Codex] сборщик лимитов — с 10:00"]);
assert.deepStrictEqual(status.next, ["первое", "второе"]);
assert.deepStrictEqual(status.blockers, ["нет Node.js"]);
assert.strictEqual(status.agent, "codex");

assert.strictEqual(limits.severity(79), "good");
assert.strictEqual(limits.severity(80), "warning");
assert.strictEqual(limits.severity(95), "critical");
assert.strictEqual(limits.severity(null), "unknown");

// Pace: 10% over 30 min = 20%/h; 60% used -> 40% left -> runs out in 2 h, before a reset in 3 h.
const H = 3600e3, T = 1e12;
const p = limits.pace([{ ts: T, pct: 50, resetsAt: 9 }, { ts: T + H / 2, pct: 60, resetsAt: 9 }]);
assert.strictEqual(p, 20);
assert.strictEqual(limits.runsOutAt({ usedPercent: 60, pacePerHour: p, resetsAt: T + H / 2 + 3 * H }, T + H / 2), T + H / 2 + 2 * H);
assert.strictEqual(limits.runsOutAt({ usedPercent: 60, pacePerHour: p, resetsAt: T + H }, T + H / 2), null);
assert.strictEqual(limits.pace([{ ts: T, pct: 90, resetsAt: 1 }, { ts: T + H, pct: 5, resetsAt: 2 }]), null); // window changed

// Plan comes from oauthAccount.organizationType only.
assert.strictEqual(limits.planName("claude_pro"), "pro");
assert.strictEqual(limits.planName("claude_max_20x"), "max 20x");
assert.strictEqual(limits.planName(undefined), null);

// Times next to now read as words, not weekdays.
const format = require("../src/format");
const noon = new Date(2026, 10, 13, 12, 0).getTime();
assert.strictEqual(format.when(new Date(2026, 10, 12, 23, 43).getTime(), noon), "вчера 23:43");
assert.strictEqual(format.when(new Date(2026, 10, 14, 3, 5).getTime(), noon), "завтра 03:05");
assert.strictEqual(format.when(new Date(2026, 10, 13, 9, 0).getTime(), noon), "09:00");

// Claude refresh: only when the snapshot is older than the interval, at most once per interval, off at 0.
const M5 = 5 * 60e3;
assert.strictEqual(limits.needsClaudeRefresh({ observedAt: T - 13 * H }, T, M5, 0), true);  // 13 h stale
assert.strictEqual(limits.needsClaudeRefresh({ observedAt: T - 60e3 }, T, M5, 0), false);   // fresh
assert.strictEqual(limits.needsClaudeRefresh({ observedAt: T - H }, T, M5, T - 60e3), false); // tried a minute ago
assert.strictEqual(limits.needsClaudeRefresh(null, T, M5, 0), true);                          // no cache yet
assert.strictEqual(limits.needsClaudeRefresh(null, T, 0, 0), false);                          // turned off

assert.strictEqual(activity.normPath("file:///C:/Users/X/Desktop/"), "c:\\users\\x\\desktop");
const ps = [{ dir: "C:\\p" }, { dir: "C:\\p\\a" }];
assert.strictEqual(projects.matchProject("c:/p/a/src", ps), ps[1]);
assert.strictEqual(projects.matchProject("C:\\pa", ps), null);

// Codex totals are cumulative: the day gets the growth, not the sum of totals.
const codex = activity.parseCodex([
  '{"timestamp":"2026-11-01T10:00:00Z","type":"session_meta","payload":{"id":"s1","cwd":"C:\\\\p"}}',
  '{"timestamp":"2026-11-01T10:01:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":10}}}}',
  '{"timestamp":"2026-11-01T10:02:00Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":300,"cached_input_tokens":140,"output_tokens":30}}}}',
].join("\n"));
assert.strictEqual(Object.values(codex.usage)[0], 190);

// Claude repeats one answer over several lines with the same message id.
const line = '{"type":"assistant","cwd":"C:\\\\p","sessionId":"c1","timestamp":"2026-11-01T10:00:00Z","message":{"id":"m1","usage":{"input_tokens":5,"cache_creation_input_tokens":10,"cache_read_input_tokens":999,"output_tokens":20}}}';
const claude = activity.parseClaude([line, line].join("\n"));
assert.strictEqual(Object.values(claude.usage)[0], 35);
// Open chats: processes matched to sessions; our own `claude -p /usage` refresher is not a chat.
const chatsMod = require("../src/chats");
{
  const now = Date.UTC(2026, 10, 18, 12, 0), min = 6e4;
  const procs = [
    { pid: 1, name: "claude.exe", startedAt: now - 120 * min, cmd: "claude.exe --output-format stream-json --resume aaaaaaaa-0000-0000-0000-000000000001 --verbose" },
    { pid: 2, name: "claude.exe", startedAt: now - 30 * min, cmd: "claude.exe --output-format stream-json --verbose" },
    { pid: 3, name: "claude.exe", startedAt: now - 1 * min, cmd: "claude.exe -p /usage --no-session-persistence" },
    { pid: 4, name: "codex.exe", startedAt: now - 300 * min, cmd: "codex.exe app-server" },
  ];
  const sessions = [
    { agent: "claude", id: "aaaaaaaa-0000-0000-0000-000000000001", title: "Старый чат", last: now - 1 * min, cwd: "C:\\p" },
    { agent: "claude", id: "bbbbbbbb-0000-0000-0000-000000000002", title: "Новый чат про дашборд", last: now - 10 * min, cwd: "C:\\p" },
    { agent: "codex", id: "c1", title: "Guardian review", auto: true, last: now - 5 * min },
    { agent: "codex", id: "c2", title: "Рефакторинг API", last: now - 40 * min },
  ];
  const list = chatsMod.describeChats(procs, sessions, now);
  assert.deepStrictEqual(list.map((c) => c.pid), [1, 2, 4]); // the /usage refresher is skipped
  assert.strictEqual(list[0].title, "Старый чат");
  assert.strictEqual(list[0].working, true);                 // wrote a minute ago
  assert.strictEqual(list[1].title, "Новый чат про дашборд"); // fresh chat picks the unclaimed session
  assert.strictEqual(list[1].working, false);
  assert.strictEqual(list[2].title, "Рефакторинг API");        // auto reviews are not user chats
  assert.strictEqual(list[2].threads, 1);
}

// Pace on the dials: spend vs time passed in the window (webview/pace.mjs).
const paceChecks = import("../webview/pace.mjs").then(({ paceOf, duration }) => {
  const span = 5 * 3600e3, start = Date.UTC(2026, 10, 13, 0, 10);
  const at = (min) => start + min * 6e4;
  const w = (pct) => ({ pct, spanMs: span, resetsAt: start + span });
  const p = paceOf(w(33), at(18)); // 33% spent after 18 min = 6% of the window
  assert.strictEqual(p.tone, "fast");
  assert.strictEqual(p.passed, "прошло 18 мин из 5 ч");
  assert.strictEqual(p.share, "33% лимита за 6% окна");
  assert.strictEqual(paceOf(w(50), at(150)).tone, "even"); // half spent at half time
  assert.strictEqual(paceOf(w(20), at(150)).tone, "slow");
  assert.strictEqual(paceOf(w(5), at(3)).tone, "start"); // first 2% of the window
  assert.strictEqual(paceOf(w(100), at(60)), null);      // spent: the note says it
  assert.strictEqual(paceOf({ pct: 10, spanMs: span, resetsAt: null }, at(10)), null); // window not started
  assert.strictEqual(duration(7 * 864e5), "7 д");
  assert.strictEqual(duration(26 * 3600e3 + 6e4 * 30), "1 д 2 ч");
});
paceChecks.then(() => console.log("pace checks: ok"), (e) => { console.error("pace checks FAILED:", e.message); process.exitCode = 1; });
console.log("unit checks: ok");

// --- real data on this machine ---
const fmt = (l) => l && `${l.agent} plan=${l.plan} observed=${new Date(l.observedAt).toLocaleString()} 5h=${JSON.stringify(l.fiveHour)} week=${JSON.stringify(l.week)}`;
console.log("claude:", fmt(limits.readClaude()) || "no data");
console.log("codex: ", fmt(limits.readCodex()) || "no data");

const t0 = Date.now();
const { sessions, usage } = activity.scan();
console.log(`scan: ${sessions.length} sessions, ${usage.length} usage rows, ${Date.now() - t0} ms`);
for (const s of sessions.slice(0, 5)) console.log(`  ${s.agent} ${new Date(s.last).toLocaleString()} ${s.auto ? "(auto) " : ""}${s.title || "(без названия)"} @ ${s.cwd}`);
const byDay = {};
for (const u of usage) byDay[`${u.day} ${u.agent}`] = (byDay[`${u.day} ${u.agent}`] || 0) + u.tokens;
console.log("usage:", byDay);

// Real open chats on this machine (read-only: nothing is stopped here).
chatsMod.listAgentProcesses().then((procs) => {
  const list = chatsMod.describeChats(procs, sessions, Date.now());
  console.log(`chats: ${list.length} open`);
  for (const c of list) console.log(`  ${c.agent} pid=${c.pid} ${c.working ? "WORKING" : "idle"} ${c.title}`);
});

const root = process.argv[2] || path.join(limits.HOME, "Desktop", "PROJECTS");
projects.loadProjects(root).then((list) => {
  for (const p of list) console.log(`  ${p.name}: git=${p.git ? `${p.git.hash} ${p.git.branch} dirty=${p.git.dirty}` : "нет"} status=${p.status ? p.status.stage : "нет"}`);
});
