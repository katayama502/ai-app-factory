import { describe, expect, it } from "vitest";
import { renderFieldInput, renderForm } from "../src/render/form.js";

const entity = {
  name: "DailyReport",
  label: "Daily Report",
  classification: "INTERNAL" as const,
  fields: [
    { name: "customerName", type: "string" as const, label: "Customer", maxLength: 200 },
    { name: "amount", type: "decimal" as const, label: "Amount", min: 0 },
    { name: "status", type: "select" as const, label: "Status", options: ["draft", "sent"] },
    { name: "author", type: "actor" as const, label: "Author", system: true },
  ],
};

describe("renderFieldInput", () => {
  it("renders a text input for string fields", () => {
    expect(renderFieldInput(entity.fields[0]!)).toContain('type="text"');
  });

  it("renders a number input for decimal fields", () => {
    expect(renderFieldInput(entity.fields[1]!)).toContain('type="number"');
  });

  it("renders a select with the declared options", () => {
    const html = renderFieldInput(entity.fields[2]!);
    expect(html).toContain("<option value=\"draft\">draft</option>");
    expect(html).toContain("<option value=\"sent\">sent</option>");
  });

  it("renders nothing for actor fields — they are never user-editable", () => {
    expect(renderFieldInput(entity.fields[3]!)).toBe("");
  });

  it("renders a note instead of an input for file fields (unsupported for now)", () => {
    const html = renderFieldInput({ name: "receipt", type: "file", label: "Receipt" });
    expect(html).toContain("未対応");
  });
});

describe("renderForm", () => {
  it("excludes actor fields from the rendered form entirely", () => {
    const html = renderForm(entity, "/apps/x/pages/0");
    expect(html).not.toContain('name="author"');
    expect(html).toContain('name="customerName"');
  });

  it("posts to the given action", () => {
    const html = renderForm(entity, "/apps/x/pages/0");
    expect(html).toContain('action="/apps/x/pages/0"');
    expect(html).toContain('method="post"');
  });
});
