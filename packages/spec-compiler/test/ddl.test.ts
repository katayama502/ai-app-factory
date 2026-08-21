import { describe, expect, it } from "vitest";
import { entityTableDDL, indexStatements, referenceConstraints } from "../src/ddl.js";

const room = {
  name: "Room",
  label: "Room",
  classification: "INTERNAL" as const,
  fields: [
    { name: "roomName", type: "string" as const, label: "Name", required: true, maxLength: 100, index: true },
    { name: "capacity", type: "number" as const, label: "Capacity", min: 1 },
  ],
};

const reservation = {
  name: "Reservation",
  label: "Reservation",
  classification: "INTERNAL" as const,
  fields: [
    { name: "room", type: "reference" as const, label: "Room", required: true, references: "Room" },
    { name: "reservedBy", type: "actor" as const, label: "By", system: true },
  ],
};

describe("entityTableDDL", () => {
  it("includes the standard columns (id/createdAt/updatedAt/deletedAt)", () => {
    const sql = entityTableDDL("app_meeting_room", room);
    expect(sql).toContain(`"id" UUID PRIMARY KEY DEFAULT gen_random_uuid()`);
    expect(sql).toContain(`"createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()`);
    expect(sql).toContain(`"updatedAt" TIMESTAMPTZ NOT NULL DEFAULT now()`);
    expect(sql).toContain(`"deletedAt" TIMESTAMPTZ`);
  });

  it("maps field types to SQL types and applies required/NOT NULL", () => {
    const sql = entityTableDDL("app_meeting_room", room);
    expect(sql).toContain(`"roomName" VARCHAR(100) NOT NULL`);
    expect(sql).toContain(`"capacity" NUMERIC CHECK ("capacity" >= 1)`);
  });

  it("makes actor fields NOT NULL with no DB-level default (SDK Gateway injects it)", () => {
    const sql = entityTableDDL("app_meeting_room", reservation);
    expect(sql).toContain(`"reservedBy" UUID NOT NULL`);
    expect(sql).not.toContain(`"reservedBy" UUID NOT NULL DEFAULT`);
  });

  it("compiles a computed field to a GENERATED STORED column with an inferred type", () => {
    const dailyReport = {
      name: "DailyReport",
      label: "DailyReport",
      classification: "INTERNAL" as const,
      fields: [{ name: "amount", type: "decimal" as const, label: "Amount", min: 0 }],
      computed: [{ name: "isLargeDeal", expr: "amount > 1000000" }],
    };
    const sql = entityTableDDL("app_sales_daily_report", dailyReport);
    expect(sql).toContain(`"isLargeDeal" BOOLEAN GENERATED ALWAYS AS (("amount" > 1000000)) STORED`);
  });

  it("adds a CHECK constraint enumerating select options", () => {
    const entity = {
      name: "ExpenseRequest",
      label: "Expense",
      classification: "CONFIDENTIAL" as const,
      fields: [
        {
          name: "status",
          type: "select" as const,
          label: "Status",
          required: true,
          options: ["draft", "submitted"],
        },
      ],
    };
    const sql = entityTableDDL("app_expense_request", entity);
    expect(sql).toContain(`"status" IS NULL OR "status" IN ('draft', 'submitted')`);
  });
});

describe("referenceConstraints", () => {
  it("emits a FOREIGN KEY for a reference field", () => {
    const [fk] = referenceConstraints("app_meeting_room", reservation);
    expect(fk).toBe(
      `ALTER TABLE "app_meeting_room"."Reservation" ADD CONSTRAINT "fk_Reservation_room" FOREIGN KEY ("room") REFERENCES "app_meeting_room"."Room"("id")`
    );
  });
});

describe("indexStatements", () => {
  it("emits a CREATE INDEX for fields marked index: true", () => {
    const [idx] = indexStatements("app_meeting_room", room);
    expect(idx).toBe(`CREATE INDEX "idx_Room_roomName" ON "app_meeting_room"."Room" ("roomName")`);
  });
});
