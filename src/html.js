// Shell of both webviews. The UI itself is the React bundle media/webview.js (source in webview/, D-012);
// data arrives by postMessage, and body[data-view] tells the bundle which view to draw.

function page({ nonce, cspSource, view, title, scriptUri, styleUri }) {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${cspSource} data:; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<link rel="stylesheet" href="${styleUri}"></head>
<body data-view="${view}"><div id="root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script></body></html>`;
}

const limitsView = (opts) => page({ ...opts, view: "limits", title: "Лимиты" });
const dashboard = (opts) => page({ ...opts, view: "dashboard", title: "Tokens: дашборд" });

module.exports = { page, limitsView, dashboard };
