import { FakeProvider } from "@aiappfactory/ai-core";
import type { FastifyInstance } from "fastify";
import { describe, expect, it } from "vitest";
import { buildConsoleServer, type ConsoleServerConfig, type PublishDeps } from "../src/index.js";

const validSpec = {
  apiVersion: "factory.dev/v1",
  kind: "App",
  metadata: { id: "test-app", name: "Test App", owner: "eng", tier: "T1" },
  data: {
    entities: [
      {
        name: "Widget",
        label: "Widget",
        classification: "INTERNAL",
        fields: [
          { name: "title", type: "string", label: "Title", required: true, maxLength: 100 },
          { name: "owner", type: "actor", label: "Owner", system: true },
        ],
      },
    ],
  },
  ui: { pages: [{ type: "form", entity: "Widget", title: "New Widget" }] },
  access: { roles: [{ role: "member", grants: ["create", "read:own"] }], rowLevel: { own: "record.owner == ctx.user.id" } },
};

// /publish is never expected to reach real infra in these tests (every case here
// is rejected before publishGeneratedApp is called) — this stands in for
// PublishDeps's shape without needing a real Postgres pool or Keycloak client.
const unusedPublishDeps = {} as unknown as PublishDeps;

// Schema-VALID (unlike an SSRF-shaped egress declaration, which Gate 0 rejects
// before a verdict is even computed) but embeds a private-key block in a plain
// string field — Gate 2's secret scan flags it CRITICAL, which risk-engine always
// forces to RED regardless of score. This is how a spec ends up with an actual RED
// *verdict* rather than failing validation outright.
const secretLeakSpec = {
  ...validSpec,
  metadata: { ...validSpec.metadata, name: "Test -----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK...-----END RSA PRIVATE KEY-----" },
};

function buildApp(provider = new FakeProvider([validSpec]), usingRealProvider = false): FastifyInstance {
  const config: ConsoleServerConfig = { provider, usingRealProvider, publishDeps: unusedPublishDeps };
  return buildConsoleServer(config);
}

describe("GET /", () => {
  it("renders the form page, and shows demo-mode banner text when not using a real provider", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<textarea");
    expect(res.body).toContain("デモモードで動作中です");
  });

  it("shows the real-AI banner text when configured with a real provider", async () => {
    const app = buildApp(new FakeProvider([validSpec]), true);
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.body).toContain("本物のAIが有効です");
  });
});

describe("GET /healthz", () => {
  it("responds ok with no auth needed", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

function formPayload(fields: Record<string, string>): { payload: string; headers: Record<string, string> } {
  return {
    payload: new URLSearchParams(fields).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" },
  };
}

describe("POST /generate", () => {
  it("400s with no description", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/generate", ...formPayload({}) });
    expect(res.statusCode).toBe(400);
  });

  it("a successful generation shows the verdict, the Spec, and a publish form when the verdict isn't RED", async () => {
    const app = buildApp(new FakeProvider([validSpec]));
    const res = await app.inject({ method: "POST", url: "/generate", ...formPayload({ description: "a widget tracker" }) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("badge-GREEN");
    expect(res.body).toContain('action="/publish"');
    expect(res.body).toContain("test-app"); // the generated spec's id, echoed (HTML-escaped) in the <pre> block
  });

  it("a schema-valid but Gate-2-flagged (leaked secret) generated Spec comes back RED and offers no publish form", async () => {
    const app = buildApp(new FakeProvider([secretLeakSpec]));
    const res = await app.inject({ method: "POST", url: "/generate", ...formPayload({ description: "x" }) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("badge-RED");
    expect(res.body).not.toContain('action="/publish"');
  });

  it("exhausting every attempt on an invalid Spec shows the failure page, not a crash", async () => {
    const garbage = { not: "a valid spec" };
    const app = buildApp(new FakeProvider([garbage, garbage, garbage]));
    const res = await app.inject({ method: "POST", url: "/generate", ...formPayload({ description: "x" }) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("生成できませんでした");
  });
});

describe("POST /publish", () => {
  it("400s with no spec field", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/publish", ...formPayload({}) });
    expect(res.statusCode).toBe(400);
  });

  it("400s on malformed JSON in the spec field", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/publish", ...formPayload({ spec: "{not json" }) });
    expect(res.statusCode).toBe(400);
  });

  it("400s a structurally invalid spec — never trusts the round-tripped hidden field blindly", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/publish", ...formPayload({ spec: JSON.stringify({ not: "valid" }) }) });
    expect(res.statusCode).toBe(400);
  });

  it("400s a RED-verdict spec — re-runs the Security Gate rather than trusting /generate's earlier verdict", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/publish", ...formPayload({ spec: JSON.stringify(secretLeakSpec) }) });
    expect(res.statusCode).toBe(400);
    expect(res.body).toContain("公開できません");
  });
});
