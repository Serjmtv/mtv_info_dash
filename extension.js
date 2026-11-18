// Tokens: remaining Claude Code / Codex limits, token usage and project status inside VS Code.
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const limits = require("./src/limits");
const activity = require("./src/activity");
const projects = require("./src/projects");
const format = require("./src/format");
const html = require("./src/html");
const chats = require("./src/chats");

const NAMES = { claude: "Claude", codex: "Codex" };
const HINTS = {
  claude: "Обновить: /usage в Claude Code.",
  codex: "Появится после первого запроса к Codex.",
  // Codex writes limits only into its own logs, so old numbers simply mean Codex has been idle
  codexStale: "Codex сейчас не работает: цифры обновятся при следующем его запросе.",
};
const STALE_MS = 30 * 60 * 1000;

let state = { claude: null, codex: null, projects: [], scan: { sessions: [], usage: [] }, at: 0 };
const listeners = new Set();
const claudeRefresh = { exe: null, cwd: null, attemptAt: 0, running: false };

// The CLI bundled with the official Claude Code extension; null when that extension is missing.
function findClaudeExe() {
  const ext = vscode.extensions.getExtension("anthropic.claude-code");
  if (!ext) return null;
  const exe = path.join(ext.extensionPath, "resources", "native-binary", process.platform === "win32" ? "claude.exe" : "claude");
  return fs.existsSync(exe) ? exe : null;
}

function claudeHint(cfg) {
  if (claudeRefresh.failed) return "Автообновление через Claude CLI не удалось. " + HINTS.claude;
  return claudeRefresh.exe && cfg.claudeRefreshMinutes ? `Обновляется само раз в ${cfg.claudeRefreshMinutes} мин.` : HINTS.claude;
}

// Empty setting: the folder holding the open .code-workspace (its folders are the projects),
// else the open folder, else ~/Desktop/PROJECTS.
function defaultRoot() {
  const file = vscode.workspace.workspaceFile;
  if (file && file.scheme === "file") return path.dirname(file.fsPath);
  const folders = vscode.workspace.workspaceFolders;
  return folders && folders.length ? folders[0].uri.fsPath : path.join(limits.HOME, "Desktop", "PROJECTS");
}

function config() {
  const c = vscode.workspace.getConfiguration("tokens");
  return {
    root: c.get("projectsRoot") || defaultRoot(),
    warn: c.get("warnPercent"),
    critical: c.get("criticalPercent"),
    notify: c.get("notifications"),
    claudeRefreshMinutes: c.get("claudeRefreshMinutes"),
  };
}

// --- view model shared by status bar, sidebar and dashboard ---

function windowModel(w, label, cfg, now, observedAt) {
  if (!w) return null;
  const pct = Math.round(w.usedPercent);
  const sev = limits.severity(pct, cfg.warn, cfg.critical);
  const spent = pct >= 100;
  const word = spent ? "исчерпан" : { warning: "мало", critical: "почти исчерпан" }[sev] || "";
  let resetShort, resetLong;
  if (w.reset) { resetShort = "сброшен"; resetLong = "Время сброса прошло"; }
  else if (!w.resetsAt) { resetShort = "не начато"; resetLong = "Окно ещё не начато"; }
  else { resetShort = "до " + format.when(w.resetsAt, now); resetLong = `Сброс ${format.when(w.resetsAt, now)} · ${format.until(w.resetsAt, now)}`; }
  let note = spent ? "Исчерпан, ждём сброса" : sev === "good" ? "В норме" : sev === "warning" ? "Мало, лимит близко" : "Почти исчерпан";
  const out = limits.runsOutAt(w, observedAt);
  if (out && sev !== "critical") note = `При текущем темпе кончится ≈ ${format.when(out, now)}`;
  else if (w.pacePerHour > 0 && sev === "good") note = "При текущем темпе хватит до сброса";
  // noteSev colours only the forecast line; sev stays tied to the percent for the bar and notifications.
  // spanMs lets the dial place the "time passed" dot on its ring
  const spanMs = label === "Неделя" ? 7 * 864e5 : 5 * 3600e3;
  return { label, pct, sev, noteSev: out && sev === "good" ? "warning" : sev, word, resetShort, resetLong, resetsAt: w.resetsAt, spanMs, note };
}

function agentModel(agent, cfg, now) {
  const l = state[agent];
  const windows = l ? [windowModel(l.fiveHour, "5 часов", cfg, now, l.observedAt), windowModel(l.week, "Неделя", cfg, now, l.observedAt)].filter(Boolean) : [];
  const week = windows.find((w) => w.label === "Неделя");
  const five = windows.find((w) => w.label === "5 часов");
  if (week && five && week.sev === "critical" && five.sev !== "critical") { five.noteSev = "warning"; five.note = "Упрётся в недельный лимит раньше"; }
  const stale = !!l && now - l.observedAt > STALE_MS;
  return {
    agent,
    name: NAMES[agent],
    plan: l && l.plan ? l.plan.charAt(0).toUpperCase() + l.plan.slice(1) : "",
    observed: l ? format.when(l.observedAt, now) : "",
    stale,
    hint: !l ? "Нет данных. " + (agent === "claude" ? claudeHint(cfg) : HINTS.codex)
      : !stale ? ""
      : agent === "codex" ? HINTS.codexStale
      : "Данные старше 30 минут. " + claudeHint(cfg),
    refreshing: agent === "claude" && claudeRefresh.running,
    windows,
  };
}

function lastDays(n, now) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now - i * 864e5);
    out.push({ key: activity.dayOf(d.getTime()), label: `${d.getDate()} ${format.MONTHS[d.getMonth()]}` });
  }
  return out;
}

function projectFor(cwd) {
  const p = projects.matchProject(cwd, state.projects);
  return p ? { project: p.name, outside: false } : { project: "Вне проектов", outside: true };
}

function dashboardModel() {
  const cfg = config(), now = Date.now();
  return {
    type: "data",
    limits: ["claude", "codex"].map((a) => agentModel(a, cfg, now)),
    days: lastDays(30, now),
    usage: state.scan.usage.map((u) => ({ day: u.day, agent: u.agent, tokens: u.tokens, ...projectFor(u.cwd) })),
    projects: state.projects.map((p) => {
      const s = p.status;
      return {
        name: p.name,
        dir: p.dir,
        folder: path.relative(cfg.root, p.dir) || path.basename(p.dir),
        hasStatus: !!s,
        statusFile: p.statusFile,
        stage: s && s.stage,
        stageIndex: s ? projects.STAGES.indexOf(s.stage) + 1 : 0,
        now: s && s.now.length ? s.now[0].replace(/^\[(Claude|Codex)\]\s*/i, "") : "",
        agent: s && s.agent,
        git: p.git && { hash: p.git.hash, date: format.date(p.git.date), dirty: p.git.dirty, branch: p.git.branch },
        chats: chatsWhere((where) => where.project === p.name, now),
      };
    }),
    outsideChats: chatsWhere((where) => where.outside, now),
    chats: openChats(now).map((c) => ({
      agent: c.agent, pid: c.pid, id: c.sessionId, title: c.title, working: c.working, threads: c.threads,
      project: c.cwd ? projectFor(c.cwd).project : "",
      started: format.when(c.startedAt, now), last: c.last ? format.ago(c.last, now) : "",
    })),
  };
}

function openChats(now = Date.now()) {
  return chats.describeChats(state.procs || [], state.scan.sessions, now);
}

// Every chat of a project (or outside all projects), newest first, with "open now" from live processes.
function chatsWhere(match, now) {
  const procs = state.procs || [];
  const open = new Set(openChats(now).filter((c) => c.agent === "claude" && c.sessionId).map((c) => c.sessionId));
  const codexSince = Math.min(...procs.filter((p) => p.name === "codex.exe").map((p) => p.startedAt));
  return state.scan.sessions
    .filter((s) => !s.auto && s.id && match(projectFor(s.cwd)))
    .sort((a, b) => b.last - a.last)
    .slice(0, 30)
    .map((s) => ({
      agent: s.agent, id: s.id, title: s.title || "без названия", last: format.ago(s.last, now),
      open: s.agent === "claude" ? open.has(s.id) : s.last >= codexSince,
      working: now - s.last < chats.ACTIVE_MS,
    }));
}

// --- refresh ---

async function refresh(force) {
  const cfg = config();
  state.claude = limits.readClaude();
  refreshClaude(cfg, force === true);
  try { state.codex = limits.readCodex(); } catch { state.codex = null; }
  state.scan = activity.scan();
  [state.projects, state.procs] = await Promise.all([projects.loadProjects(cfg.root), chats.listAgentProcesses()]);
  state.at = Date.now();
  for (const fn of listeners) fn();
}

// Runs in the background: the status bar shows the old snapshot until the CLI has written a new one.
function refreshClaude(cfg, force) {
  // the Claude extension's folder name carries its version, so re-resolve after it updates
  if (claudeRefresh.exe && !fs.existsSync(claudeRefresh.exe)) claudeRefresh.exe = findClaudeExe();
  const { exe, cwd } = claudeRefresh;
  const interval = (cfg.claudeRefreshMinutes || 0) * 60 * 1000;
  if (!exe || claudeRefresh.running) return;
  if (!(force && interval) && !limits.needsClaudeRefresh(state.claude, Date.now(), interval, claudeRefresh.attemptAt)) return;
  claudeRefresh.running = true;
  claudeRefresh.attemptAt = Date.now();
  for (const fn of listeners) fn(); // show the spinner: the CLI takes 5–9 s
  limits.refreshClaudeUsage(exe, cwd).then((ok) => {
    claudeRefresh.running = false;
    claudeRefresh.failed = !ok;
    if (ok) state.claude = limits.readClaude();
    for (const fn of listeners) fn();
  });
}

// --- status bar ---

function createStatusBar(context) {
  const items = {};
  for (const [i, agent] of ["claude", "codex"].entries()) {
    const item = vscode.window.createStatusBarItem(`tokens.${agent}`, vscode.StatusBarAlignment.Right, 100 - i);
    item.name = `Tokens: ${NAMES[agent]}`;
    item.command = "tokens.openDashboard";
    item.show();
    items[agent] = item;
    context.subscriptions.push(item);
  }
  return () => {
    const cfg = config(), now = Date.now();
    for (const agent of ["claude", "codex"]) {
      const m = agentModel(agent, cfg, now), item = items[agent];
      const parts = m.windows.map((w) => `${w.pct}%`);
      const icon = m.refreshing ? "$(sync~spin)" : parts.length ? "$(dashboard)" : "$(question)";
      item.text = parts.length ? `${icon} ${m.name} ${parts.join(" · ")}` : `${icon} ${m.name} —`;
      const sev = m.windows.reduce((s, w) => (w.sev === "critical" || (w.sev === "warning" && s !== "critical") ? w.sev : s), "good");
      item.backgroundColor = sev === "critical" ? new vscode.ThemeColor("statusBarItem.errorBackground")
        : sev === "warning" ? new vscode.ThemeColor("statusBarItem.warningBackground") : undefined;
      const md = new vscode.MarkdownString(`**${m.name}${m.plan ? " · " + m.plan : ""}**\n\n`);
      md.isTrusted = { enabledCommands: ["tokens.openDashboard", "tokens.refresh"] };
      if (m.windows.length) {
        md.appendMarkdown("| | | |\n|---|---|---|\n");
        for (const w of m.windows) md.appendMarkdown(`| ${w.label} | **${w.pct}%** | ${w.resetLong} |\n`);
      }
      md.appendMarkdown(`\n${m.observed ? "Обновлено " + m.observed + ". " : ""}${m.hint}\n\n[Открыть дашборд](command:tokens.openDashboard) · [Обновить](command:tokens.refresh)`);
      item.tooltip = md;
    }
  };
}

// --- notifications: once per threshold per limit window ---

function createNotifier(context) {
  return () => {
    const cfg = config();
    if (!cfg.notify) return;
    const seen = context.globalState.get("tokens.notified", {});
    let changed = false;
    for (const agent of ["claude", "codex"]) {
      for (const w of agentModel(agent, cfg, Date.now()).windows) {
        if (!w.resetsAt || (w.sev !== "warning" && w.sev !== "critical")) continue;
        const key = `${agent}:${w.label}:${w.resetsAt}`;
        const level = w.sev === "critical" ? 2 : 1;
        if ((seen[key] || 0) >= level) continue;
        seen[key] = level;
        changed = true;
        const msg = `${NAMES[agent]}: ${w.label === "Неделя" ? "недельный лимит" : "лимит на 5 часов"} использован на ${w.pct}%. ${w.resetLong}.`;
        vscode.window.showWarningMessage(msg, "Открыть дашборд").then((pick) => pick && vscode.commands.executeCommand("tokens.openDashboard"));
      }
    }
    // A window we warned about has reset: say so once, then forget it.
    for (const k of Object.keys(seen)) {
      const [agent, label, resetsAt] = k.split(":");
      if (Number(resetsAt) > Date.now()) continue;
      delete seen[k];
      changed = true;
      vscode.window.showInformationMessage(`${NAMES[agent]}: ${label === "Неделя" ? "недельный лимит" : "лимит на 5 часов"} сброшен.`);
    }
    if (changed) context.globalState.update("tokens.notified", seen);
  };
}

// --- trees ---

class ProjectsTree {
  constructor() { this.emitter = new vscode.EventEmitter(); this.onDidChangeTreeData = this.emitter.event; }
  update() { this.emitter.fire(); }
  getTreeItem(e) { return e; }
  getChildren(parent) {
    if (!parent) {
      return state.projects.map((p) => {
        const s = p.status;
        const item = new vscode.TreeItem(p.name, vscode.TreeItemCollapsibleState.Collapsed);
        item.description = s ? [s.stage, s.agent && NAMES[s.agent]].filter(Boolean).join(" · ") : "нет STATUS.md";
        item.iconPath = new vscode.ThemeIcon(s ? "folder" : "warning", s ? undefined : new vscode.ThemeColor("problemsWarningIcon.foreground"));
        item.contextValue = s ? "project" : "project-nostatus";
        item.tooltip = p.dir;
        item.project = p;
        if (p.statusFile) item.command = { command: "tokens.openStatus", title: "Открыть STATUS.md", arguments: [p.statusFile] };
        return item;
      });
    }
    const p = parent.project, s = p.status, out = [];
    const leaf = (label, icon, description) => { const i = new vscode.TreeItem(label); i.iconPath = new vscode.ThemeIcon(icon); if (description) i.description = description; return i; };
    if (s) {
      for (const n of s.now) out.push(leaf(n, "play"));
      if (s.next[0]) out.push(leaf("Дальше: " + s.next[0], "arrow-right"));
      for (const b of s.blockers) out.push(leaf("Блокер: " + b, "circle-slash"));
    } else {
      const c = leaf("Создать STATUS.md по шаблону", "new-file");
      c.command = { command: "tokens.createStatus", title: "Создать STATUS.md", arguments: [p.dir] };
      out.push(c);
    }
    if (p.git) out.push(leaf(`${p.git.branch} · ${p.git.hash} · ${format.date(p.git.date)}`, "git-branch", p.git.dirty ? `${p.git.dirty} изм.` : "чисто"));
    else out.push(leaf("нет git-репозитория", "git-branch"));
    return out;
  }
}

class ActivityTree {
  constructor() { this.emitter = new vscode.EventEmitter(); this.onDidChangeTreeData = this.emitter.event; }
  update() { this.emitter.fire(); }
  getTreeItem(e) { return e; }
  getChildren() {
    return state.scan.sessions.slice(0, 15).map((s) => {
      const item = new vscode.TreeItem(s.title || "(без названия)");
      const where = projectFor(s.cwd);
      item.description = `${NAMES[s.agent]}${s.auto ? " · авто" : ""} · ${format.when(s.last)}`;
      item.tooltip = `${NAMES[s.agent]} · ${where.project}\n${s.cwd}\nПоследняя активность: ${new Date(s.last).toLocaleString("ru-RU")}`;
      item.iconPath = new vscode.ThemeIcon("circle-filled", new vscode.ThemeColor(s.agent === "claude" ? "charts.orange" : "charts.blue"));
      return item;
    });
  }
}

// --- webviews ---

const nonce = () => crypto.randomBytes(16).toString("base64");
const ALLOWED = new Set(["tokens.refresh", "tokens.openStatus", "tokens.createStatus", "tokens.stopAllChats", "tokens.openChat"]);

let mediaUri = null; // set in activate: the React bundle lives in media/
function wire(webview, build) {
  webview.options = { enableScripts: true, localResourceRoots: [mediaUri] };
  const asset = (name) => webview.asWebviewUri(vscode.Uri.joinPath(mediaUri, name)).toString();
  webview.html = build({ nonce: nonce(), cspSource: webview.cspSource, scriptUri: asset("webview.js"), styleUri: asset("webview.css") });
  const post = () => webview.postMessage(dashboardModel());
  const sub = webview.onDidReceiveMessage((m) => {
    if (m.type === "ready") post();
    if (m.type === "command" && ALLOWED.has(m.command)) vscode.commands.executeCommand(m.command, ...(m.args || []));
  });
  listeners.add(post);
  return { dispose() { listeners.delete(post); sub.dispose(); } };
}

let panel = null;
function openDashboard(context) {
  if (panel) { panel.reveal(); return; }
  panel = vscode.window.createWebviewPanel("tokens.dashboard", "Tokens: дашборд", vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
  panel.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "gauge.svg");
  const w = wire(panel.webview, html.dashboard);
  panel.onDidDispose(() => { w.dispose(); panel = null; });
}

// --- commands ---

// Brings up a chat in its own extension (D-014): Claude by command, Codex by its deep link to /local/<thread>.
async function openChat(agent, id) {
  if (!id) return;
  try {
    if (agent === "claude") await vscode.commands.executeCommand("claude-vscode.editor.open", id);
    else await vscode.env.openExternal(vscode.Uri.parse(`${vscode.env.uriScheme}://openai.chatgpt/local/${id}`));
  } catch (e) {
    vscode.window.showErrorMessage(`Не удалось открыть чат ${NAMES[agent] || agent}: ${e.message}. Проверьте, что расширение ${agent === "claude" ? "Claude Code" : "Codex"} установлено и включено.`);
  }
}

// Ends every open Claude Code / Codex chat process after a modal confirmation (D-013).
async function stopAllChats() {
  await refresh(); // act on the current processes, not the last minute's picture
  const list = openChats();
  if (!list.length) { vscode.window.showInformationMessage("Открытых чатов Claude и Codex нет."); return; }
  const detail = list.map((c) => `• ${NAMES[c.agent]}: ${c.title}${c.working ? " (работает сейчас)" : ""}`).join("\n")
    + "\n\nИдущие ответы прервутся. История сохранится: чат Claude можно продолжить из списка прошлых сессий, Codex может попросить перезагрузить окно.";
  const pick = await vscode.window.showWarningMessage(`Остановить все открытые чаты (${list.length})?`, { modal: true, detail }, "Остановить все");
  if (pick !== "Остановить все") return;
  const stopped = await chats.stopProcesses(list.map((c) => c.pid));
  vscode.window.showInformationMessage(stopped === list.length ? `Остановлено чатов: ${stopped}.` : `Остановлено ${stopped} из ${list.length}: остальные уже завершились или не дали себя остановить.`);
  refresh();
}

async function createStatus(dir) {
  const target = fs.existsSync(path.join(dir, "docs")) ? path.join(dir, "docs", "STATUS.md") : path.join(dir, "STATUS.md");
  if (fs.existsSync(target)) return vscode.window.showTextDocument(vscode.Uri.file(target));
  const d = new Date(), pad = (n) => String(n).padStart(2, "0");
  const stamp = `${activity.dayOf(d.getTime())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  fs.writeFileSync(target, projects.STATUS_TEMPLATE.replace("{{now}}", stamp), "utf8");
  await vscode.window.showTextDocument(vscode.Uri.file(target));
  refresh();
}

function activate(context) {
  // the CLI runs from our own storage folder, so it never lands in a project's history
  claudeRefresh.exe = findClaudeExe();
  claudeRefresh.cwd = context.globalStorageUri.fsPath;
  mediaUri = vscode.Uri.joinPath(context.extensionUri, "media");
  fs.mkdirSync(claudeRefresh.cwd, { recursive: true });
  const updateBar = createStatusBar(context);
  const notify = createNotifier(context);
  const projectsTree = new ProjectsTree();
  const activityTree = new ActivityTree();
  listeners.add(updateBar);
  listeners.add(notify);
  listeners.add(() => projectsTree.update());
  listeners.add(() => activityTree.update());

  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg("tokens.refresh", () => refresh(true));
  reg("tokens.openDashboard", () => openDashboard(context));
  reg("tokens.openStatus", (file) => vscode.window.showTextDocument(vscode.Uri.file(file)));
  reg("tokens.createStatus", (arg) => createStatus(arg && arg.project ? arg.project.dir : arg));
  reg("tokens.openProjectWindow", (item) => vscode.commands.executeCommand("vscode.openFolder", vscode.Uri.file(item.project.dir), { forceNewWindow: true }));
  reg("tokens.stopAllChats", stopAllChats);
  reg("tokens.openChat", openChat);
  reg("tokens.openTerminal", (item) => vscode.window.createTerminal({ name: item.project.name, cwd: item.project.dir }).show());

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("tokens.projects", projectsTree),
    vscode.window.registerTreeDataProvider("tokens.activity", activityTree),
    vscode.window.registerWebviewViewProvider("tokens.limits", { resolveWebviewView(view) { const w = wire(view.webview, html.limitsView); view.onDidDispose(() => w.dispose()); } }),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration("tokens") && refresh()),
  );

  // Logs grow while agents work; a minute is fresh enough for limits measured in hours.
  const timer = setInterval(refresh, 60 * 1000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });
  refresh();
}

function deactivate() {}

// _internals: for test/preview.js, which renders the dashboard outside VS Code.
module.exports = { activate, deactivate, _internals: { refresh, dashboardModel } };
