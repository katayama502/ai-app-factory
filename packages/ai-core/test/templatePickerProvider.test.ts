import { describe, expect, it } from "vitest";
import { TemplatePickerProvider } from "../src/templatePickerProvider.js";

function specNamed(id: string) {
  return {
    apiVersion: "factory.dev/v1",
    kind: "App",
    metadata: { id, name: id, owner: "eng", tier: "T1" },
    data: { entities: [] },
    ui: { pages: [] },
    access: { roles: [] },
  } as unknown as import("@aiappfactory/app-spec").AppSpec;
}

const salesReport = { spec: specNamed("sales-daily-report"), keywords: ["営業", "日報", "sales", "report"] };
const expenseRequest = { spec: specNamed("expense-request"), keywords: ["経費", "expense", "receipt"] };
const vacationRequest = { spec: specNamed("vacation-request"), keywords: ["休暇", "vacation", "leave"] };

describe("TemplatePickerProvider", () => {
  it("picks the candidate whose keywords match the description (Japanese)", async () => {
    const provider = new TemplatePickerProvider([salesReport, expenseRequest, vacationRequest]);
    const result = (await provider.generateStructured({
      systemPrompt: "x",
      userPrompt: "Generate an App Spec for this internal business app:\n\n経費精算のためのアプリが欲しい",
      jsonSchema: {},
      toolName: "emit_app_spec",
    })) as { metadata: { id: string } };
    expect(result.metadata.id).toBe("expense-request");
  });

  it("picks the candidate whose keywords match the description (English)", async () => {
    const provider = new TemplatePickerProvider([salesReport, expenseRequest, vacationRequest]);
    const result = (await provider.generateStructured({
      systemPrompt: "x",
      userPrompt: "I need an app to request vacation time off",
      jsonSchema: {},
      toolName: "emit_app_spec",
    })) as { metadata: { id: string } };
    expect(result.metadata.id).toBe("vacation-request");
  });

  it("falls back to the first candidate when nothing matches, rather than throwing", async () => {
    const provider = new TemplatePickerProvider([salesReport, expenseRequest]);
    const result = (await provider.generateStructured({
      systemPrompt: "x",
      userPrompt: "something about dragons and spaceships",
      jsonSchema: {},
      toolName: "emit_app_spec",
    })) as { metadata: { id: string } };
    expect(result.metadata.id).toBe("sales-daily-report");
  });

  it("is case-insensitive", async () => {
    const provider = new TemplatePickerProvider([salesReport, expenseRequest]);
    const result = (await provider.generateStructured({
      systemPrompt: "x",
      userPrompt: "please reimburse my RECEIPT",
      jsonSchema: {},
      toolName: "emit_app_spec",
    })) as { metadata: { id: string } };
    expect(result.metadata.id).toBe("expense-request");
  });

  it("throws at construction time if given no candidates at all", () => {
    expect(() => new TemplatePickerProvider([])).toThrow();
  });
});
