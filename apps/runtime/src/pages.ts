import type { AppSpec, EntitySpec, PageSpec } from "@aiappfactory/app-spec";
import type { CompanySdk } from "@aiappfactory/company-sdk";
import { escapeHtml, pageShell } from "./html.js";
import { renderForm, type ReferenceOption } from "./render/form.js";
import { renderList } from "./render/list.js";

function findEntity(spec: AppSpec, name: string): EntitySpec {
  const entity = spec.data.entities.find((e) => e.name === name);
  if (!entity) throw new Error(`unknown entity "${name}"`);
  return entity;
}

function nav(spec: AppSpec, activeIndex: number): string {
  const links = spec.ui.pages
    .map((page, i) => {
      const label = "title" in page ? page.title : page.entity;
      const active = i === activeIndex ? " (現在のページ)" : "";
      return `<a href="/pages/${i}">${escapeHtml(label)}${active}</a>`;
    })
    .join(" ");
  return `<nav>${links}</nav>`;
}

async function resolveReferenceOptions(sdk: CompanySdk, spec: AppSpec, entity: EntitySpec): Promise<Record<string, ReferenceOption[]>> {
  const result: Record<string, ReferenceOption[]> = {};
  for (const field of entity.fields) {
    if (field.type !== "reference" || !field.references) continue;
    const referenced = findEntity(spec, field.references);
    const labelField = referenced.fields.find((f) => f.type === "string")?.name;
    const rows = await sdk.database.entity(field.references).list();
    result[field.name] = rows.map((row) => ({
      value: String(row.id),
      label: labelField ? String(row[labelField] ?? row.id) : String(row.id),
    }));
  }
  return result;
}

/** Renders one `ui.pages[index]` entry as a full HTML document. Only `form` and `list` are implemented — `detail`/`dashboard`/`import` are 04_IMPLEMENTATION §3's E1-4 scope but not built yet (ROADMAP.md). */
export async function renderPage(spec: AppSpec, index: number, sdk: CompanySdk, query: { q?: string }): Promise<string> {
  const page = spec.ui.pages[index];
  if (!page) throw new Error(`no page at index ${index}`);

  if (page.type === "form") {
    const entity = findEntity(spec, page.entity);
    const referenceOptions = await resolveReferenceOptions(sdk, spec, entity);
    const body = `${nav(spec, index)}<h1>${escapeHtml(page.title)}</h1>${renderForm(entity, `/pages/${index}`, { referenceOptions })}`;
    return pageShell(page.title, body);
  }

  if (page.type === "list") {
    const entity = findEntity(spec, page.entity);
    const rows = await sdk.database.entity(page.entity).list();
    const q = (query.q ?? "").trim().toLowerCase();
    const searchFields = page.search ?? [];
    const filtered = q
      ? rows.filter((row) => searchFields.some((f) => String(row[f] ?? "").toLowerCase().includes(q)))
      : rows;
    const labels = Object.fromEntries(entity.fields.map((f) => [f.name, f.label]));
    const body = `${nav(spec, index)}<h1>${escapeHtml(entity.label)}</h1>${renderList({
      columns: page.columns,
      labels,
      rows: filtered,
      searchFields,
      searchQuery: query.q ?? "",
      searchAction: `/pages/${index}`,
    })}`;
    return pageShell(entity.label, body);
  }

  return pageShell(
    "未対応のページ種別",
    `${nav(spec, index)}<p class="note">ページ種別 "${escapeHtml((page as PageSpec).type)}" はまだ実装されていません（ROADMAP.md 参照）。</p>`
  );
}

/** Handles a `form` page's POST submission: creates the record and returns the redirect target (the nearest `list` page for the same entity, or the app index). */
export async function handleFormSubmit(spec: AppSpec, index: number, sdk: CompanySdk, body: Record<string, unknown>): Promise<string> {
  const page = spec.ui.pages[index];
  if (!page || page.type !== "form") throw new Error(`page at index ${index} is not a form page`);
  const entity = findEntity(spec, page.entity);

  const data: Record<string, unknown> = {};
  for (const field of entity.fields) {
    if (field.type === "actor" || field.type === "file") continue;
    if (!(field.name in body)) continue;
    const raw = body[field.name];
    if (field.type === "boolean") {
      data[field.name] = raw === "true" || raw === "on";
    } else if ((field.type === "number" || field.type === "decimal") && raw !== "") {
      data[field.name] = Number(raw);
    } else if (raw !== "") {
      data[field.name] = raw;
    }
  }

  await sdk.database.entity(page.entity).create(data);

  const listIndex = spec.ui.pages.findIndex((p) => p.type === "list" && p.entity === page.entity);
  return `/pages/${listIndex >= 0 ? listIndex : index}`;
}
