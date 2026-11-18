// Projects under the PROJECTS folder: names, git state and STATUS.md.
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const { normPath } = require("./activity");

const STAGES = ["идея", "разработка", "тест", "прод"];

// The user's projects.code-workspace names the projects; without it, every subfolder is one.
function listProjects(root) {
  const ws = path.join(root, "projects.code-workspace");
  try {
    // shortcut: strips only // line comments, enough for a hand-written workspace file
    const text = fs.readFileSync(ws, "utf8").replace(/^\s*\/\/.*$/gm, "");
    return JSON.parse(text).folders.map((f) => ({ name: f.name || path.basename(f.path), dir: path.resolve(root, f.path) }));
  } catch {
    try {
      return fs.readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => ({ name: e.name, dir: path.join(root, e.name) }));
    } catch {
      return [];
    }
  }
}

function git(dir, args) {
  return new Promise((resolve) => {
    execFile("git", ["-C", dir, ...args], { timeout: 5000, windowsHide: true }, (err, out) => resolve(err ? null : out.trim()));
  });
}

async function gitInfo(dir) {
  const log = await git(dir, ["log", "-1", "--format=%h%x09%cI%x09%s"]);
  if (log == null) return null;
  const [hash, date, subject] = log.split("\t");
  const [branch, status] = await Promise.all([git(dir, ["rev-parse", "--abbrev-ref", "HEAD"]), git(dir, ["status", "--porcelain"])]);
  return { hash, date, subject, branch, dirty: status ? status.split("\n").length : 0 };
}

function findStatusFile(dir) {
  for (const p of [path.join(dir, "docs", "STATUS.md"), path.join(dir, "STATUS.md")]) if (fs.existsSync(p)) return p;
  return null;
}

// Reads the STATUS.md format from the project-handoff skill: frontmatter + «Сейчас», «Дальше», «Блокеры».
function parseStatus(text) {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const field = (name) => {
    const m = front && new RegExp(`^${name}:\\s*(.+)$`, "m").exec(front[1]);
    return m ? m[1].trim() : null;
  };
  const body = text.replace(/<!--[\s\S]*?-->/g, "");
  const section = (title) => {
    const m = new RegExp(`^##\\s+${title}\\s*$([\\s\\S]*?)(?=^##\\s|(?![\\s\\S]))`, "m").exec(body);
    if (!m) return [];
    return m[1].split("\n")
      .filter((l) => /^\s*(?:[-*]|\d+\.)\s+/.test(l))
      .map((l) => l.replace(/^\s*(?:[-*]|\d+\.)\s+/, "").replace(/\*\*/g, "").trim())
      .filter(Boolean);
  };
  const stage = field("stage");
  const now = section("Сейчас");
  const agentMatch = now.map((l) => /\[(Claude|Codex)\]/i.exec(l)).find(Boolean);
  return {
    stage: STAGES.includes(stage) ? stage : stage || null,
    updated: field("updated"),
    now,
    next: section("Дальше"),
    blockers: section("Блокеры"),
    agent: agentMatch ? agentMatch[1].toLowerCase() : null,
  };
}

async function loadProjects(root) {
  return Promise.all(listProjects(root).map(async (p) => {
    const statusFile = findStatusFile(p.dir);
    let status = null;
    if (statusFile) {
      try { status = parseStatus(fs.readFileSync(statusFile, "utf8")); } catch { /* unreadable: show as missing */ }
    }
    return { ...p, statusFile, status, git: await gitInfo(p.dir) };
  }));
}

// Longest project path that contains cwd; null when the session ran outside every project.
function matchProject(cwd, projects) {
  const c = normPath(cwd);
  let best = null;
  for (const p of projects) {
    const d = normPath(p.dir);
    if ((c === d || c.startsWith(d + "\\")) && (!best || d.length > normPath(best.dir).length)) best = p;
  }
  return best;
}

const STATUS_TEMPLATE = `---
stage: разработка
updated: {{now}}
---

# Статус

## Сейчас

## Дальше

1.

## Блокеры

`;

module.exports = { listProjects, loadProjects, parseStatus, matchProject, gitInfo, STAGES, STATUS_TEMPLATE };
