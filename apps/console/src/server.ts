import { generateAppSpec, type LlmProvider } from "@aiappfactory/ai-core";
import { validateAppSpec } from "@aiappfactory/app-spec";
import { runSecurityGate } from "@aiappfactory/security-gate";
import formbody from "@fastify/formbody";
import Fastify, { type FastifyInstance } from "fastify";
import { escapeHtml, pageShell, verdictBadge } from "./html.js";
import { publishGeneratedApp, type PublishDeps } from "./publish.js";

export interface ConsoleServerConfig {
  provider: LlmProvider;
  /** Purely for the banner text shown on the form page — true when the caller wired up a real AnthropicProvider (ANTHROPIC_API_KEY was set), false for the offline TemplatePickerProvider fallback. */
  usingRealProvider: boolean;
  publishDeps: PublishDeps;
}

function modeBanner(usingRealProvider: boolean): string {
  if (usingRealProvider) {
    return `<div class="mode-banner real"><strong>本物のAIが有効です。</strong> ANTHROPIC_API_KEY が設定されているため、実際にClaude APIでSpecを生成します。</div>`;
  }
  return `<div class="mode-banner"><strong>デモモードで動作中です。</strong> ANTHROPIC_API_KEY が未設定のため、入力内容のキーワードから、あらかじめ用意されたテンプレートの中で一番近いものを選んで返します——本物のAI生成ではありません。生成・検証・公開までの一連の流れはすべて本物です。ANTHROPIC_API_KEY を設定すると、本物のAIによる生成に切り替わります。</div>`;
}

function formPage(usingRealProvider: boolean): string {
  const body = `
${modeBanner(usingRealProvider)}
<h1>AI App Factory — Builder（試作版）</h1>
<p class="note">作りたい社内アプリを説明してください。日本語でも英語でも構いません。</p>
<form method="post" action="/generate">
  <textarea name="description" placeholder="例：出張申請フォームを作りたい。申請日・出張先・目的・金額を入力でき、上長が承認できるようにしたい。" required></textarea>
  <button type="submit">生成する</button>
</form>
`;
  return pageShell("AI App Factory — Builder", body);
}

function errorPage(title: string, message: string): string {
  return pageShell(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p><a href="/">戻る</a></p>`);
}

export function buildConsoleServer(config: ConsoleServerConfig): FastifyInstance {
  const app = Fastify({ logger: false });
  void app.register(formbody);

  app.get("/healthz", async () => ({ status: "ok" }));

  app.get("/", async (_request, reply) => {
    reply.type("text/html");
    return formPage(config.usingRealProvider);
  });

  app.post<{ Body: { description?: string } }>("/generate", async (request, reply) => {
    reply.type("text/html");
    const description = request.body.description?.trim();
    if (!description) {
      reply.code(400);
      return errorPage("入力エラー", "説明文を入力してください。");
    }

    const result = await generateAppSpec(description, config.provider);

    if (!result.ok) {
      const issuesHtml = result.issues
        .map((issue) => `<li><code>${escapeHtml(issue.path || "(root)")}</code>: ${escapeHtml(issue.message)}</li>`)
        .join("");
      return pageShell(
        "生成失敗",
        `<h1>生成できませんでした</h1>
<p>${result.attempts}回試しましたが、有効なApp Specを生成できませんでした。検証で見つかった問題:</p>
<ul>${issuesHtml}</ul>
<p><a href="/">別の説明でもう一度試す</a></p>`
      );
    }

    const specJson = JSON.stringify(result.spec, null, 2);
    const verdict = runSecurityGate(result.spec, { sourceText: specJson });
    const findingsHtml = verdict.findings.length
      ? `<table><tr><th>Gate</th><th>深刻度</th><th>内容</th></tr>${verdict.findings
          .map((f) => `<tr><td>${escapeHtml(f.gate)}</td><td>${escapeHtml(f.severity)}</td><td>${escapeHtml(f.message)}</td></tr>`)
          .join("")}</table>`
      : `<p class="note">検出された問題はありません。</p>`;

    const canPublish = verdict.verdict !== "RED";
    const publishSection = canPublish
      ? `<form method="post" action="/publish">
  <input type="hidden" name="spec" value="${escapeHtml(specJson)}">
  <button type="submit">このアプリを公開する</button>
</form>`
      : `<p class="note">RED判定のため、このままでは公開できません。指摘内容を確認するか、別の説明で試してください。</p>`;

    return pageShell(
      "生成結果",
      `<h1>生成結果</h1>
<p>${result.attempts}回の試行で生成されました。Security Gate判定: ${verdictBadge(verdict.verdict)}（スコア ${verdict.score}）</p>
<h2>指摘事項</h2>
${findingsHtml}
<h2>生成されたApp Spec</h2>
<pre>${escapeHtml(specJson)}</pre>
${publishSection}
<p><a href="/">別の説明でもう一度試す</a></p>`
    );
  });

  app.post<{ Body: { spec?: string } }>("/publish", async (request, reply) => {
    reply.type("text/html");
    const raw = request.body.spec;
    if (!raw) {
      reply.code(400);
      return errorPage("入力エラー", "Specが見つかりません。");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      reply.code(400);
      return errorPage("入力エラー", "Specの形式が不正です。");
    }

    // Never trust the round-tripped hidden field blindly, even though it came from
    // this same server moments ago — re-validate and re-score exactly as /generate
    // did (defense in depth, same principle as everywhere else this Spec pipeline
    // is used).
    const validated = validateAppSpec(parsed);
    if (!validated.ok) {
      reply.code(400);
      return errorPage("検証エラー", "Specの検証に失敗しました。");
    }

    const verdict = runSecurityGate(parsed, { sourceText: raw });
    if (verdict.verdict === "RED") {
      reply.code(400);
      return errorPage("公開できません", "Security GateがRED判定のため公開できません。");
    }

    try {
      const result = await publishGeneratedApp(validated.spec, config.publishDeps);
      return pageShell(
        result.alreadyPublished ? "すでに公開されています" : "公開しました",
        `<h1>${result.alreadyPublished ? "すでに公開されています" : "公開しました"}</h1>
<p><a href="${escapeHtml(result.url)}">${escapeHtml(result.url)}</a> で今すぐ開けます。</p>
<p class="note">ログイン例: alice / alice-dev（bob・carolでも可）——割り当てられたロールによって見える範囲が変わります。</p>
<p><a href="/">別のアプリを作る</a></p>`
      );
    } catch (error) {
      reply.code(500);
      return errorPage("公開エラー", `公開中にエラーが発生しました: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return app;
}
