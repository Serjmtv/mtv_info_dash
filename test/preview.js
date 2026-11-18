// Renders the dashboard and the limits view with real data into HTML files for a browser:
//   $env:ELECTRON_RUN_AS_NODE = "1"; & "$env:LOCALAPPDATA\Programs\Microsoft VS Code\Code.exe" test\preview.js <outDir> [light]
const Module = require("module");
const fs = require("fs");
const path = require("path");

// Minimal stand-in for the vscode module: only what refresh() and dashboardModel() touch.
const defaults = { projectsRoot: "", warnPercent: 80, criticalPercent: 95, notifications: true };
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "vscode") return { workspace: { getConfiguration: () => ({ get: (k) => defaults[k] }) } };
  return load.call(this, request, ...rest);
};

const { _internals } = require("../extension");
const html = require("../src/html");
const [outDir, theme = "dark"] = process.argv.slice(2);

// Approximate VS Code Dark Modern / Light Modern variables.
const VARS = {
  dark: "--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1f1f1f;--vscode-widget-border:#313131;--vscode-editorWidget-border:#2b2b2b;--vscode-button-secondaryBackground:#313131;--vscode-button-secondaryForeground:#cccccc;--vscode-textLink-foreground:#4daafc;--vscode-list-hoverBackground:#2a2d2e;--vscode-editorHoverWidget-background:#202020;--vscode-editorHoverWidget-border:#454545;--vscode-focusBorder:#0078d4;background:#1f1f1f;",
  light: "--vscode-foreground:#3b3b3b;--vscode-descriptionForeground:#616161;--vscode-editor-background:#ffffff;--vscode-widget-border:#e5e5e5;--vscode-editorWidget-border:#e5e5e5;--vscode-button-secondaryBackground:#e5e5e5;--vscode-button-secondaryForeground:#3b3b3b;--vscode-textLink-foreground:#005fb8;--vscode-list-hoverBackground:#f2f2f2;--vscode-editorHoverWidget-background:#f8f8f8;--vscode-editorHoverWidget-border:#c8c8c8;--vscode-focusBorder:#005fb8;background:#ffffff;",
};

_internals.refresh().then(() => {
  const data = JSON.stringify(_internals.dashboardModel()).replace(/</g, "\\u003c");
  const stub = `<script nonce="N">window.acquireVsCodeApi = () => ({ getState: () => null, setState() {}, postMessage(m) { if (m.type === "ready") setTimeout(() => window.postMessage(${data}, "*")); } });</script>`;
  const media = (f) => "file:///" + path.resolve(__dirname, "..", "media", f).replace(/\\/g, "/");
  for (const [name, build, width] of [["dashboard", html.dashboard, ""], ["limits", html.limitsView, "max-width:300px;"]]) {
    // the stub must define acquireVsCodeApi before the bundle runs, so it goes right after <body>
    const page = build({ nonce: "N", cspSource: "file:", scriptUri: media("webview.js"), styleUri: media("webview.css") })
      .replace(/<body([^>]*)>/, `<body$1 class="vscode-${theme}" style="${VARS[theme]}${width}">${stub}`);
    fs.writeFileSync(path.join(outDir, `${name}-${theme}.html`), page);
  }
});
