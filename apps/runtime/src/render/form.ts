import type { EntitySpec, FieldSpec } from "@aiappfactory/app-spec";
import { escapeAttr, escapeHtml } from "../html.js";

export interface ReferenceOption {
  value: string;
  label: string;
}

export interface FormRenderOptions {
  /** Populated <select> options for `reference`-type fields, keyed by field name. */
  referenceOptions?: Record<string, ReferenceOption[]>;
}

/**
 * MVP form renderer (04_IMPLEMENTATION §3 E1-4 scope: the 13 field types, no custom
 * layout). `actor` fields are never rendered — they're server-injected, never
 * user-editable (01_ARCHITECTURE §5.3). `file` fields aren't supported yet (needs
 * `company.storage`, not built — ROADMAP.md); a note is shown instead of an input so
 * the gap is visible rather than a silently-missing field.
 */
export function renderFieldInput(field: FieldSpec, opts: FormRenderOptions = {}): string {
  const name = escapeAttr(field.name);
  const requiredAttr = field.required ? " required" : "";

  switch (field.type) {
    case "string":
      return `<input type="text" id="${name}" name="${name}" maxlength="${field.maxLength ?? 500}"${requiredAttr}>`;
    case "text":
    case "richtext":
      return `<textarea id="${name}" name="${name}" rows="4"${requiredAttr}></textarea>`;
    case "number":
    case "decimal":
      return `<input type="number" id="${name}" name="${name}" step="any"${field.min !== undefined ? ` min="${field.min}"` : ""}${field.max !== undefined ? ` max="${field.max}"` : ""}${requiredAttr}>`;
    case "date":
      return `<input type="date" id="${name}" name="${name}"${requiredAttr}>`;
    case "datetime":
      return `<input type="datetime-local" id="${name}" name="${name}"${requiredAttr}>`;
    case "boolean":
      return `<input type="checkbox" id="${name}" name="${name}" value="true">`;
    case "select": {
      const options = (field.options ?? []).map((o) => `<option value="${escapeAttr(o)}">${escapeHtml(o)}</option>`).join("");
      return `<select id="${name}" name="${name}"${requiredAttr}><option value="">—</option>${options}</select>`;
    }
    case "multiselect": {
      const options = (field.options ?? []).map((o) => `<option value="${escapeAttr(o)}">${escapeHtml(o)}</option>`).join("");
      return `<select id="${name}" name="${name}" multiple>${options}</select>`;
    }
    case "reference": {
      const options = (opts.referenceOptions?.[field.name] ?? [])
        .map((o) => `<option value="${escapeAttr(o.value)}">${escapeHtml(o.label)}</option>`)
        .join("");
      return `<select id="${name}" name="${name}"${requiredAttr}><option value="">—</option>${options}</select>`;
    }
    case "file":
      return `<p class="note">ファイルアップロードは未対応です（company.storage 未実装 — ROADMAP.md 参照）</p>`;
    case "actor":
      return ""; // never rendered — system-injected
  }
}

export function renderForm(entity: EntitySpec, action: string, opts: FormRenderOptions = {}): string {
  const fields = entity.fields.filter((f) => f.type !== "actor");
  const rows = fields
    .map((field) => {
      const input = renderFieldInput(field, opts);
      if (!input) return "";
      return `<label for="${escapeAttr(field.name)}">${escapeHtml(field.label)}</label>${input}`;
    })
    .join("\n");

  return `<form class="record-form" method="post" action="${escapeAttr(action)}">
${rows}
<button type="submit">保存</button>
</form>`;
}
