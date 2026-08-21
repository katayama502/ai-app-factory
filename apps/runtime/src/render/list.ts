import { escapeAttr, escapeHtml } from "../html.js";

export interface ListRenderOptions {
  columns: string[];
  labels: Record<string, string>;
  rows: Record<string, unknown>[];
  searchFields: string[];
  searchQuery: string;
  searchAction: string;
  editAction?: (id: string) => string;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "✓" : "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/**
 * MVP list renderer (04_IMPLEMENTATION §3 E1-4). Search is a substring filter over
 * the Spec's declared `search` fields, applied here (in the Runtime, after fetching
 * the RLS-scoped rows via Company SDK) rather than pushed into sdk-gateway's query —
 * a deliberate simplification for M1's data volumes; a real filter/search API on
 * sdk-gateway is future work (ROADMAP.md), not silently promised here.
 */
export function renderList(opts: ListRenderOptions): string {
  const searchBox =
    opts.searchFields.length > 0
      ? `<form class="search" method="get" action="${escapeAttr(opts.searchAction)}">
      <input type="search" name="q" placeholder="検索（${opts.searchFields.map((f) => escapeHtml(opts.labels[f] ?? f)).join(" / ")}）" value="${escapeAttr(opts.searchQuery)}">
      <button type="submit">検索</button>
    </form>`
      : "";

  const header = opts.columns.map((c) => `<th>${escapeHtml(opts.labels[c] ?? c)}</th>`).join("");
  const body = opts.rows
    .map((row) => {
      const cells = opts.columns.map((c) => `<td>${escapeHtml(formatCell(row[c]))}</td>`).join("");
      const action = opts.editAction ? `<td><a href="${escapeAttr(opts.editAction(String(row.id)))}">編集</a></td>` : "";
      return `<tr>${cells}${action}</tr>`;
    })
    .join("");

  return `${searchBox}
<table>
  <thead><tr>${header}${opts.editAction ? "<th></th>" : ""}</tr></thead>
  <tbody>${body || `<tr><td colspan="${opts.columns.length + 1}" class="note">データがありません</td></tr>`}</tbody>
</table>`;
}
