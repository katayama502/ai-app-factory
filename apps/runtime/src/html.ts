/** Escapes text for safe interpolation into HTML — every piece of Spec/record data rendered by this MVP renderer goes through this, since record data is end-user input. */
export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes for safe interpolation into an HTML attribute value (already-quoted with "). */
export function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}

export function pageShell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
    nav { margin-bottom: 1.5rem; }
    nav a { margin-right: 1rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { text-align: left; padding: 0.4rem 0.6rem; border-bottom: 1px solid #ddd; }
    form.record-form label { display: block; margin: 0.75rem 0 0.25rem; font-weight: 600; }
    form.record-form input, form.record-form select, form.record-form textarea { width: 100%; padding: 0.4rem; box-sizing: border-box; }
    button { margin-top: 1rem; padding: 0.5rem 1rem; }
    .search { margin-bottom: 1rem; }
    .note { color: #666; font-size: 0.9em; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}
