/** Escapes text for safe interpolation into HTML — matches apps/runtime's html.ts convention (this package doesn't depend on that one, so it's a small local copy rather than a cross-package import for a two-function utility). */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function pageShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 780px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; line-height: 1.6; }
    h1 { font-size: 1.4rem; }
    textarea { width: 100%; min-height: 6rem; padding: 0.6rem; box-sizing: border-box; font: inherit; }
    button { margin-top: 1rem; padding: 0.6rem 1.2rem; font-size: 1rem; cursor: pointer; }
    pre { background: #f5f5f5; padding: 1rem; overflow-x: auto; border-radius: 4px; font-size: 0.85em; }
    .note { color: #666; font-size: 0.9em; }
    .badge { display: inline-block; padding: 0.2rem 0.7rem; border-radius: 999px; font-weight: 700; color: white; }
    .badge-GREEN { background: #1a7f37; }
    .badge-YELLOW { background: #9a6700; }
    .badge-RED { background: #cf222e; }
    table { border-collapse: collapse; width: 100%; margin-top: 0.5rem; }
    th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #ddd; vertical-align: top; }
    .mode-banner { background: #fff8e6; border: 1px solid #f0d78c; padding: 0.6rem 1rem; border-radius: 4px; margin-bottom: 1.5rem; font-size: 0.9em; }
    .mode-banner.real { background: #e6f4ea; border-color: #8fd19e; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

export function verdictBadge(verdict: string): string {
  return `<span class="badge badge-${escapeHtml(verdict)}">${escapeHtml(verdict)}</span>`;
}
