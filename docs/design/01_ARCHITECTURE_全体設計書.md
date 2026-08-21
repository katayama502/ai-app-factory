# AI App Factory Community Edition — 全体設計書

**Version:** 0.1 (Design Draft)
**Date:** 2026-08-21
**License (planned):** Apache-2.0
**Primary stack:** TypeScript (Node.js 24 LTS / Next.js / Fastify) + PostgreSQL + OCI Containers

---

## 0. この設計書の前提と読み方

この文書は、構想「AI App Factory Community Edition」を **GitHub で公開し、第三者が自社に導入して実際に使えるレベル** まで持っていくための技術設計である。

構想（89項目）はプロダクトビジョンとしては一貫している。一方で、そのまま実装計画に落とすと **3〜5年規模・チーム10人以上** の作業量になる。したがって本設計では次の3つを行う。

1. **構想を「アーキテクチャ上の必然」に翻訳する** — 「非エンジニアでも安全に」を実現する技術的な核を1つ決める
2. **v1.0 のスコープを確定し、明示的に「やらないこと」を書く**
3. **OSS として他人が触れる形（リポジトリ・拡張点・ドキュメント）に落とす**

---

## 1. 設計の核心：Constrained App Model（制約付きアプリモデル）

### 1.1 素朴な実装が失敗する理由

構想の素直な実装は次のようになる。

```
自然言語 → LLM が任意のコードを書く → 全部スキャンする → 通ったらデプロイ
```

これは3点で破綻する。

| 問題 | 内容 |
|---|---|
| **生成成功率** | フルスタックアプリ（認証・DB・UI・API）を一発で正しく生成できる確率は低い。ローカルLLM（Qwen/Llama クラス）ではさらに落ちる。非エンジニアは失敗を自力で回復できない |
| **スキャン精度** | 任意コードに対する SAST は誤検知・見逃しが多い。「Security PASS」が信頼できないなら、その表示自体が有害 |
| **修復ループの発散** | AI がスキャン結果を見て直す → 別の箇所が壊れる、を5回繰り返して結局管理者に飛ぶ。運用が回らない |

### 1.2 解決：AI にコードを書かせず「宣言（Spec）」を書かせる

**AI の出力を、任意のコードではなく検証可能な宣言的スキーマ（App Spec）にする。**
アプリを動かすのは、Factory 側があらかじめ用意した **汎用 App Runtime** である。

```
自然言語
   ↓
App Spec (JSON/YAML, スキーマ検証可能)
   ↓
App Runtime が解釈して実行
```

これにより次が成立する。

- **生成成功率が跳ね上がる** — LLM は「アプリを書く」のではなく「フォームを定義する」だけ。7B クラスのローカルモデルでも実用域に入る
- **セキュリティが構造的に保証される** — Spec に「任意コードを実行する」表現が存在しないので、SQL Injection も eval も RCE も *書きようがない*。スキャンは「Spec がスキーマとポリシーに適合するか」の決定論的検証になる
- **修復ループが収束する** — 失敗は「スキーマ違反」という機械可読なエラー。AI に返せば直る
- **後方互換が保てる** — Runtime を改善すると既存の全アプリが自動で恩恵を受ける（セキュリティパッチも一括）

これが構想 89 項「Easy Outside, Strict Inside」の **実装レベルでの意味** である。

### 1.3 3階層の生成モード（Generation Tier）

現実には Spec だけで表現できない要求も出る。段階的に自由度を開放する。

| Tier | 名称 | 生成物 | 実行方式 | 表現力 | セキュリティ検証 | 提供 |
|---|---|---|---|---|---|---|
| **T1** | **Declarative** | App Spec のみ | 汎用 App Runtime が解釈 | CRUD / 一覧 / 検索 / ダッシュボード / 承認フロー | スキーマ検証＋ポリシー検証（決定論的） | v1.0 GA・既定 ON |
| **T2** | **Expression** | Spec ＋ 制限式 | サンドボックス式評価器 | 計算列・条件分岐・バリデーション | 式の AST 検証＋実行時間/メモリ上限 | v1.0 GA・既定 ON |
| **T3** | **Code** | TypeScript ハンドラ | Deno 権限制御 ＋ 専用コンテナ | 任意ロジック・外部API連携 | 全 Security Gate ＋ **管理者承認必須** | v1.0 **experimental**・既定 OFF |

**T1 + T2 が既定。T3 は v1.0 に experimental として同梱するが、管理者が明示的な同意（監査記録付き）で有効化した組織のみ利用できる。**
構想の「Docker / Git / Keycloak を見せない」は、T1/T2 では *そもそもユーザー側にコードが存在しない* ことで自然に達成される。

### 1.4 App Spec の例

```yaml
apiVersion: factory.dev/v1
kind: App
metadata:
  id: sales-daily-report
  name: 営業日報
  owner: sales-dept
  tier: T1

data:
  entities:
    - name: DailyReport
      label: 日報
      classification: INTERNAL          # PUBLIC/INTERNAL/CONFIDENTIAL/PERSONAL/HIGHLY_CONFIDENTIAL
      retention: P3Y
      fields:
        - { name: reportDate,   type: date,     label: 日付,   required: true, default: today }
        - { name: customerName, type: string,   label: 顧客名, maxLength: 200, index: true }
        - { name: amount,       type: decimal,  label: 金額,   min: 0 }
        - { name: body,         type: richtext, label: 内容,   maxLength: 5000 }
        - { name: author,       type: actor,    system: true }   # 認証ユーザーが自動注入
      computed:
        - name: isLargeDeal
          expr: "amount > 1000000"        # T2: CEL 式

ui:
  pages:
    - { type: form,      entity: DailyReport, title: 日報を書く }
    - { type: list,      entity: DailyReport, columns: [reportDate, customerName, amount], search: [customerName], sort: -reportDate }
    - { type: import,    entity: DailyReport, title: Excelから取り込む,
        formats: [csv, xlsx], maxRows: 50000, dryRun: true }
    - { type: dashboard, title: 営業ダッシュボード,
        widgets:
          - { type: bar,  entity: DailyReport, aggregate: count, groupBy: month(reportDate) }
          - { type: stat, entity: DailyReport, aggregate: sum,   field: amount, period: thisMonth } }

access:
  roles:
    - { role: sales_member,  grants: [create, read:own,  update:own] }
    - { role: sales_manager, grants: [create, read:dept, update:dept, export] }
    - { role: exec,          grants: [read:all] }
  rowLevel:
    own:  "record.author == ctx.user.id"
    dept: "record.author.department == ctx.user.department"

automations:
  - id: notify-large-deal
    trigger: { on: create, entity: DailyReport }
    when:    "record.isLargeDeal"
    actions:
      - { type: notify, channel: email, to: role:sales_manager, template: large-deal }

ai:
  features:
    - { id: summarize, type: summarize, entity: DailyReport, field: body,
        policy: { allowExternal: false } }     # 内部データ→ローカルAI固定

network:
  egress: []        # 明示 allowlist のみ。空 = 外部通信一切なし
```

**設計上の重要点**

- `network.egress` が **deny-by-default**。構想 33 項「Network Scan」は、スキャンではなく *宣言と強制* になる（検査より遮断のほうが強い）
- `classification` がデータ分類（構想 34 項）そのもの。これが AI Gateway のルーティングと監査に直結する
- `access` が構想 21〜22 項の権限モデル。Runtime が行レベルで強制するので、アプリ側の実装ミスで漏れることがない

---

## 2. システム全体構成

### 2.1 3プレーン分離

```
┌──────────────────────────────────────────────────────────────────┐
│  EDGE                                                            │
│  Traefik (TLS終端 / アプリ毎サブドメイン / 社内CA or LE DNS-01)  │
└────────────────┬─────────────────────────┬───────────────────────┘
                 │                         │
┌────────────────▼─────────────┐  ┌────────▼──────────────────────┐
│  CONTROL PLANE               │  │  APP PLANE                    │
│  （管理・生成・審査）         │  │  （社員が使うアプリ）          │
│                              │  │                               │
│  ・Console (Next.js)         │  │  ・App Runtime × N            │
│    - AI Builder              │  │    (T1/T2: 共有ランタイム)     │
│    - App Store               │  │  ・App Container × N          │
│    - Admin Console           │  │    (T3: アプリ専用)            │
│  ・Factory API (Fastify)     │  │  ・Sandbox Env (プレビュー用)  │
│  ・AI Gateway                │  │                               │
│  ・Security Gate Orchestrator│  │  ※ Control Plane へ直接到達不可 │
│  ・Build & Deploy Engine     │  │  ※ App 間通信も deny-by-default│
│  ・Risk Engine (OPA)         │  │                               │
└────────────────┬─────────────┘  └────────┬──────────────────────┘
                 │                         │
┌────────────────▼─────────────────────────▼───────────────────────┐
│  PLATFORM SERVICES                                               │
│  Keycloak (IdP) / PostgreSQL (control + app schemas)             │
│  Gitea (Spec・コード履歴) / Zot (OCI Registry)                   │
│  Storage: Local FS（既定） / MinIO（opt-in・同梱しない）          │
│  Valkey (queue/cache) / Ollama (Local LLM) / pgvector (RAG)      │
└──────────────────────────────────────────────────────────────────┘
```

**なぜ分けるか** — 生成されたアプリは *程度の差はあれ信頼できないコード* である。Control Plane と同じネットワーク・同じ DB ロール・同じ権限で動かしてはならない。App Plane から Control Plane への通信は **Company SDK が使う単一のゲートウェイ API のみ**（mTLS ＋ アプリ固有トークン）に限定する。

### 2.2 コンポーネント責務一覧

| # | コンポーネント | 責務 | 実装 |
|---|---|---|---|
| 1 | **Console** | Builder UI / App Store / Admin / Setup Wizard。Beginner・Developer の二重UI | Next.js 15 (App Router), React 19, Tailwind, shadcn/ui |
| 2 | **Factory API** | 認証済み REST/SSE。アプリ・バージョン・承認・ユーザー・ポリシーの CRUD とワークフロー | Fastify 5 + TypeScript, Zod, Prisma |
| 3 | **Spec Compiler** | App Spec → 検証済み内部表現 → DBマイグレーション / UIメタ / 認可ルール | TS ライブラリ（`@aiappfactory/app-spec`） |
| 4 | **AI Orchestrator** | 対話→Spec 生成。要求抽出・Spec 生成・差分適用・自己修復 | `services/ai-orchestrator`。LLM 呼び出しは AI Gateway 経由のみ |
| 5 | **AI Gateway** | 全 LLM アクセスの単一出口。ポリシー適用・PII検出・レート制限・トークン計測・監査 | Fastify。OpenAI互換 I/F を内部標準に |
| 6 | **Security Gate** | スキャン群のオーケストレーション。証拠(finding)を正規化して Risk Engine へ | TS + 各スキャナを別コンテナで実行 |
| 7 | **Risk Engine** | finding 群 → GREEN/YELLOW/RED を **決定論的に** 判定 | OPA/Rego ポリシー ＋ TS ラッパ |
| 8 | **Build & Deploy Engine** | Sandbox/本番へのデプロイ、ヘルスチェック、ロールバック | TS。Podman/Docker API。将来 K8s |
| 9 | **App Runtime** | App Spec を解釈して実際に動くアプリを提供（T1/T2 の実行主体） | Next.js + Fastify。マルチアプリ対応 |
| 10 | **Company SDK** | アプリが使える唯一の API 境界（capability-based） | `@aiappfactory/company-sdk` (TS) |
| 11 | **Audit Log** | 追記専用・ハッシュチェーン付き監査ログ | PostgreSQL + 定期アンカリング |
| 12 | **Desktop Launcher** | 非エンジニア向けインストーラ。コンテナランタイムの面倒を見る | Tauri 2 (Rust) |

### 2.3 採用する OSS とライセンス（重要）

Apache-2.0 で配布するにあたり、**同梱可能なもの／別プロセスで呼ぶだけのもの／同梱不可のもの** を分けて管理する。

| 用途 | 採用 | ライセンス | 扱い |
|---|---|---|---|
| IdP / SSO | **Keycloak** | Apache-2.0 | コンテナ同梱可 |
| Git ホスティング | **Gitea** | MIT | コンテナ同梱可（Forgejo は GPLv3+ のため、同梱の法務判断を避けたいなら Gitea を既定に） |
| DB | **PostgreSQL 17** + pgvector | PostgreSQL License | 同梱可 |
| Reverse Proxy | **Traefik v3** | MIT | 同梱可 |
| OCI Registry | **Zot** | Apache-2.0 | 同梱可（Harbor は重すぎる） |
| Object Storage | **MinIO** or ローカルFS | AGPL-3.0 | **既定はローカルFS**。MinIO はオプション（AGPL のため同梱しない） |
| Queue / Cache | **Valkey** | BSD-3 | 同梱可（Redis のライセンス変更を回避） |
| Local LLM | **Ollama** | MIT | 同梱可（バイナリはオプションDL） |
| Secret Scan | **gitleaks** | MIT | 別プロセス実行 |
| SAST | **Opengrep** | LGPL-2.1 | **別プロセス実行のみ**（リンクしない）。Semgrep はルールのライセンス変更があったため既定にしない |
| 依存/コンテナ/IaC スキャン | **Trivy** | Apache-2.0 | 別プロセス実行 |
| 脆弱性DB | **OSV.dev** API + ローカルミラー | コード Apache-2.0 / **データ CC-BY-4.0** | オフライン運用のため定期ミラー。データ同梱時は帰属表示が必要 |
| ポリシーエンジン | **OPA** | Apache-2.0 | ライブラリ／サイドカー |
| 式評価 | **CEL** | Apache-2.0（仕様/cel-go） | ⚠ **本番品質の JS 実装が事実上存在しない**（ADR-010 のリスク）。代替案: (a) 自前の制限付き AST 評価器、(b) cel-go をサイドカー実行 |
| ワークフロー | **n8n** | Sustainable Use License | **同梱不可**。外部接続のオプション連携のみ（構想58項の修正） |
| サンドボックス | **gVisor** (Linux) / rootless Podman | Apache-2.0 | 利用可能なら自動採用 |

> **法務上の注意** — n8n の Sustainable Use License は OSI 承認ライセンスではない。Apache-2.0 の配布物に同梱すると利用者側に制約が波及する。「n8n を別途立てて Webhook で繋ぐ」構成に限定する。

---

## 3. AI Builder — 生成パイプライン

### 3.1 パイプライン

```
[1] 対話 (Requirement Elicitation)
     ユーザー「営業日報を管理するアプリを作りたい」
     ↓  意図分類 + 不足情報の質問（最大3往復。それ以上は聞かない）
[2] App Intent (中間表現)
     { domain: sales, entities: [...], users: [...], sensitivity: INTERNAL }
     ↓  テンプレート検索（構想15項のテンプレートを RAG で検索）
[3] Template Match
     近いテンプレートがあれば「差分生成」、なければ「フルSpec生成」
     ↓
[4] App Spec 生成 (structured output / JSON Schema 制約デコード)
     ↓
[5] Spec Validation Loop  ← ここが自己修復の主戦場（最大3回）
     スキーマ検証 → ポリシー検証 → 参照整合性検証
     ↓
[6] Preview Build → Sandbox 起動
     ↓
[7] 会話による差分編集（構想12項）
     「顧客名も入力できるようにして」 → Spec Patch (JSON Patch) を生成 → [5] へ
     ↓
[8] Publish 要求 → Security Gate へ
```

### 3.2 「フルSpec生成」ではなく「テンプレート差分」を第一級にする

構想 15〜16 項のテンプレートは、**UX の飾りではなく生成成功率の中核**である。

- テンプレートは App Spec の実体として `templates/` に置く（コミュニティが PR で追加できる）
- ユーザー入力 → 埋め込み検索（pgvector）で最も近いテンプレートを選択
- LLM には「このテンプレートをこの要望に合わせて修正する JSON Patch を出せ」と指示する

これにより、7B クラスのローカルモデルでも実用精度が出る。ゼロショットのフル生成は外部 LLM（Claude/GPT/Gemini）が設定されている場合のフォールバック扱い。

### 3.3 構造化出力の強制

- 外部 LLM: JSON Schema / tool-use による構造化出力を使用
- ローカル LLM: **文法制約デコード**（llama.cpp GBNF / Ollama の format 指定）で JSON Schema を強制
- どちらも失敗したら、パース修復を最大2回。それでも駄目なら「テンプレートをそのまま使いますか？」にフォールバック（非エンジニアを行き止まりにしない）

### 3.4 会話履歴とバージョン

- Builder セッションは全メッセージを保存（監査対象）
- Spec が変わるたびに Gitea へコミット。ユーザーには「バージョン12」「この状態に戻す」としか見せない（構想26〜27項）
- コミットメッセージは AI が日本語で自動生成（「顧客名フィールドを追加」）

---

## 4. AI Gateway

### 4.1 位置づけ

**すべての LLM アクセスは AI Gateway を通る。** Factory 本体も、生成されたアプリ（`company.ai`）も例外なし。アプリが直接 OpenAI に到達する経路は、App Plane の egress deny-by-default によって物理的に存在しない。

### 4.2 機能

| 機能 | 内容 |
|---|---|
| **ルーティング** | データ分類 × ポリシー → モデル選択。例: `PERSONAL` は Local LLM 固定、`PUBLIC` は外部可 |
| **ポリシー適用** | 構想63項。管理者が「外部AI ON/OFF」「個人情報ブロック」「機密はローカルのみ」を設定 |
| **PII / Secret 検出** | 送信前にプロンプトを検査。検出時は masked / blocked（設定可） |
| **プロンプトインジェクション緩和** | 信頼境界の明示（system/user/tool の分離）、ツール出力のサニタイズ、出力の構造化強制 |
| **計測 / コスト** | トークン数・レイテンシ・モデル別コスト。構想65項の Cost Dashboard の元データ |
| **監査** | 誰が・どのアプリで・どのモデルに・いつ。**プロンプト本文の保存は既定 OFF**、管理者が明示的に ON（構想64項） |
| **フォールバック** | 外部APIエラー時にローカルモデルへ降格（設定可） |
| **レート制限** | ユーザー別・アプリ別・組織全体 |

### 4.3 内部インターフェース

内部標準を **OpenAI互換 Chat Completions** に固定し、各プロバイダへのアダプタを持つ。

```
POST /v1/ai/chat/completions
Headers: X-Factory-App-Id, X-Factory-User-Id, X-Factory-Classification
Body:    { model: "auto" | "<alias>", messages, response_format, ... }
```

`model: "auto"` を推奨。実モデル選択は Gateway のポリシーが決める。これによりモデルを差し替えてもアプリ側は無変更（構想9項）。

### 4.4 モデルレジストリ

```yaml
models:
  - alias: local-fast
    provider: ollama
    model: qwen3:8b
    capabilities: [chat, json]
    maxClassification: HIGHLY_CONFIDENTIAL   # ローカルなので何でも可
  - alias: cloud-strong
    provider: anthropic
    model: <configured>
    capabilities: [chat, json, tools]
    maxClassification: PUBLIC                # 既定は公開情報のみ
```

管理者が `maxClassification` を上げる操作は **明示的な同意ダイアログ＋監査記録** を伴う。

---

## 5. Company SDK

### 5.1 原則

アプリは **Company SDK 以外の副作用を持てない**。

- `fetch` / `fs` / `child_process` / 生 DB 接続は Runtime レベルで遮断（T3 は Deno の権限フラグで拒否）
- SDK 呼び出しには必ず **実行コンテキスト**（認証ユーザー・アプリID・目的）が乗る
- SDK の全呼び出しは認可チェックと監査を自動で通る

### 5.2 API

SDK は `@aiappfactory/company-sdk` として公開 API 契約になる（破壊的変更は major）。**実装のない API を v1.0 に出さない**ため、提供バージョンを明示する。

| API | v1.0 | 備考 |
|---|---|---|
| `company.auth.currentUser()` | ✅ | Keycloak から解決済み |
| `company.permission.can(action, resource)` | ✅ | |
| `company.database.entity(E).list/create/update/delete` | ✅ | 行レベル認可・スキーマ検証が自動適用 |
| `company.database.entity(E).bulkUpsert(rows)` | ✅ | CSV/Excel 取り込み用。件数・実行時間上限＋監査必須 |
| `company.database.transaction(fn)` | ✅ | |
| `company.storage.put/getSignedUrl` | ✅ | `classification` 必須 |
| `company.ai.complete/summarize` | ✅ | AI Gateway 経由 |
| `company.notification.send` | ✅ | Email / Webhook のみ |
| `company.audit.record` | ✅ | 業務レベルの監査 |
| `company.webhook.emit(name, payload)` | ✅ | 旧 `workflow.trigger`。**Webhook 発火のみ**（n8n は外部連携） |
| `company.ai.search(query, {collection})` | ✗ v1.1 | 社内 RAG。型定義ごと v1.0 では非公開 |

```ts
// 例
const reports = await company.database
  .entity('DailyReport')
  .list({ filter: { reportDate: { gte: '2026-08-01' } }, sort: '-reportDate' })
// ↑ ctx（認証ユーザー・部門）から行レベル条件が自動注入される
```

### 5.3 なぜ SDK が「セキュリティ機能」なのか

構想 17〜18 項では SDK は利便性の話に見えるが、実際は **信頼境界そのもの**である。

- SQL を書く手段がない → SQL Injection が構造的に発生しない（OWASP A05:2025 Injection）
- 認可を自前で書く手段がない → 認可漏れが構造的に発生しない（OWASP A01:2025 Broken Access Control）
- 生ネットワークがない → SSRF / 意図しない外部送信が発生しない
- 分類なしにデータを保存できない → データガバナンスが自動で効く

---

## 6. データモデル（Control Plane）

主要テーブル（Prisma スキーマの論理設計）。

```
organizations       (id, name, locale, created_at)
departments         (id, org_id, name, parent_id)
users               (id, org_id, keycloak_sub, email, display_name, department_id, status)
role_assignments    (user_id, role, scope)          -- employee / builder / approver / admin / owner

apps                (id, org_id, slug, name, description, owner_user_id, department_id,
                     tier, lifecycle_state, current_version_id, created_at)
app_versions        (id, app_id, version_no, spec_json, spec_hash, git_ref,
                     created_by, created_at, note_ja)
builder_sessions    (id, app_id, user_id, state, created_at)
builder_messages    (id, session_id, role, content, model_alias, tokens, created_at)

environments        (id, app_id, kind)              -- sandbox | production
deployments         (id, app_version_id, environment_id, state, image_ref,
                     started_at, finished_at, health, previous_deployment_id)

scan_runs           (id, app_version_id, started_at, finished_at, state)
findings            (id, scan_run_id, gate, scanner, rule_id, severity, confidence,
                     cwe, file, line, message, evidence_json, fixable, status)
                                                    -- status: open/fixed/accepted
risk_assessments    (id, scan_run_id, level, score, rationale_json, decided_at,
                     signature, signing_key_id)     -- Ed25519 署名。Deploy Engine が検証
repair_attempts     (id, scan_run_id, attempt_no, patch_json, result)
approvals           (id, app_version_id, required_role, decided_by, decision,
                     comment, decided_at)

ai_requests         (id, org_id, app_id, user_id, model_alias, provider, classification,
                     prompt_tokens, completion_tokens, latency_ms, cost_micro, created_at,
                     prompt_ref)                    -- prompt本文は既定 null
ai_policies         (id, org_id, allow_external, block_personal, classification_rules_json)

audit_events        (id, org_id, actor_id, action, target_type, target_id,
                     detail_json, created_at, prev_hash, hash)     -- 追記専用

encrypted_secrets   (id, org_id, kind, ciphertext, nonce, kek_id, created_at,
                     rotated_at)                    -- 外部AI APIキー / DB資格情報 / 署名鍵
backups             (id, kind, location, size, created_at, verified_at)
system_settings     (key, value_json, updated_by, updated_at)
```

**アプリのデータ本体は Control Plane の DB には置かない。** アプリごとに専用スキーマ＋専用 DB ロールを切る（第7章）。

---

## 7. 分離モデル（Isolation）

構想 48〜51 項を具体化する。

### 7.1 データベース分離

アプリ発行時に自動実行：

```sql
CREATE SCHEMA app_<appid>;
CREATE ROLE app_<appid>_rw LOGIN PASSWORD '<random 32B>';
GRANT USAGE ON SCHEMA app_<appid> TO app_<appid>_rw;
REVOKE ALL ON SCHEMA public FROM app_<appid>_rw;
ALTER ROLE app_<appid>_rw SET search_path = app_<appid>;
-- 行レベルセキュリティ (RLS) を全テーブルに強制
ALTER TABLE app_<appid>.<table> ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_<appid>.<table> FORCE ROW LEVEL SECURITY;
```

**`rowLevel` は CEL ではなく「RLS 変換可能な制限 DSL」である。**
CEL 式一般を PostgreSQL の RLS 述語に変換することはできない。したがって `access.rowLevel` に書ける構文をスキーマレベルで制限する。

- 使えるもの: 比較演算（`==`, `!=`, `<`, `>`, `in`）、`&&` / `||` / `!`、自エンティティの列、`ctx.user.*`（id / department / roles）、事前定義の解決関数（`department_of()`, `descendants_of()`）
- 使えないもの: 任意の関数呼び出し、他エンティティへの自由結合、正規表現、算術式

この制限 DSL のみを **RLS ポリシーへ機械変換**する。SDK 側の実装ミスがあっても DB が最終防衛線になる（多層防御）。

**実行主体の伝播（RLS の前提）** — コネクションプール環境では `current_user` がアプリ利用者と一致しない。SDK Gateway は毎リクエスト、トランザクション開始直後に次を発行する。

```sql
SET LOCAL factory.user_id      = '<uuid>';
SET LOCAL factory.department   = '<uuid>';
SET LOCAL factory.roles        = '{sales_member}';
```

RLS ポリシーは `current_setting('factory.user_id')` を参照する。`SET LOCAL` なのでトランザクション終了で必ず消え、接続の使い回しで別ユーザーの権限が漏れない。

### 7.2 ネットワーク分離

| 経路 | 既定 |
|---|---|
| App → App | **禁止** |
| App → Control Plane | Company SDK Gateway の単一エンドポイントのみ（mTLS + アプリ固有 JWT） |
| App → Platform (DB/Storage 直接) | **禁止**（SDK 経由のみ）。**アプリコンテナに DB 資格情報を一切渡さない** |
| App → Internet | **禁止**。`network.egress` の allowlist に書かれたホストのみ、Egress Proxy 経由で許可 |
| Employee → App | Traefik 経由（Keycloak OIDC 認証済みのみ） |

実装は Docker/Podman では専用ネットワーク＋Egress Proxy（Envoy or Squid）、Kubernetes では NetworkPolicy。

### 7.3 ブラウザ側の分離（Origin Isolation）★

ネットワーク層でアプリ間を遮断しても、**全アプリを同一オリジンのパス分割（`/apps/<slug>`）で配信すると、ブラウザの中では分離が成立しない**。アプリ A の JavaScript がアプリ B の DOM・localStorage・Cookie に到達できてしまう。生成物を信頼しない設計である以上、ここが最大の穴になる。

したがって **アプリごとに独立オリジンを必須** とする。

| 項目 | 規定 |
|---|---|
| ホスト名 | `<slug>.apps.<company-domain>`（アプリごとにサブドメイン） |
| Console | `console.<company-domain>`（アプリと別オリジン） |
| Cookie | `__Host-` prefix。ドメイン共有を禁止（親ドメインにセットしない） |
| CSP | アプリごとに個別配信。`frame-ancestors 'none'`, `default-src 'self'`, `connect-src` は SDK Gateway のみ |
| ヘッダ | `COOP: same-origin`, `CORP: same-origin`, `X-Frame-Options: DENY` |
| 証明書 | ワイルドカード（`*.apps.<company-domain>`）で対応 |

この要件があるため、ホスト名は **実在ドメインのサブドメイン**でなければならない（第7.4項）。

### 7.4 ドメインと TLS

`.local` は mDNS 用に予約された TLD（RFC 6762）であり、公的 CA が証明書を発行できない。**既定ホスト名に `.local` を使わない。**

| 方式 | ホスト名 | 証明書 | 対象 |
|---|---|---|---|
| A. 社内CA | `*.apps.factory.internal` | セットアップ時に社内 CA を生成し、ルート CA を配布 | 情シスがいる組織 |
| B. Let's Encrypt (DNS-01) | `*.apps.<所有ドメイン>` | DNS-01 チャレンジ。内部向けIPでも取得可 | ドメインを持つ組織（**推奨**） |
| C. このPCのみ | `localhost:8443` | 自己署名 | 個人検証 |

方式 A を選んだ場合、**ルート CA の配布が非エンジニア組織の最大の離脱点**になる。Setup Wizard は「ルート CA をダウンロード」ボタンと、Windows(GPO)/macOS(MDM)/各ブラウザ向けの手順書を成果物として出力する。

### 7.5 実行分離

すべてのアプリコンテナに強制：

```yaml
user: 10001:10001            # non-root
read_only: true              # rootfs 読み取り専用
tmpfs: [/tmp]
cap_drop: [ALL]
security_opt:
  - no-new-privileges:true
  - seccomp:<factory-default.json>
  - apparmor:factory-app     # 利用可能な場合
runtime: runsc               # gVisor が使える場合は自動採用
deploy:
  resources:
    limits: { cpus: '1.0', memory: 512M, pids: 256 }
```

### 7.6 Sandbox（プレビュー）

- 本番と **物理的に別ネットワーク・別 DB スキーマ・別ホスト名**
- ダミーデータのみ投入（本番データへのアクセス経路なし）
- TTL 30分で自動破棄
- 外部通信は完全遮断（allowlist も無視）

---

## 8. デプロイエンジン

### 8.1 ライフサイクル

```
DRAFT → SCANNING → (GREEN) → PUBLISHING → RUNNING
                 → (YELLOW) → PENDING_APPROVAL → PUBLISHING → RUNNING
                 → (RED)    → BLOCKED
RUNNING → (新バージョン) → PUBLISHING → RUNNING
        → (失敗)        → ROLLED_BACK
RUNNING → STOPPED → ARCHIVED
```

### 8.2 デプロイ手順（T1/T2）

T1/T2 は **コンテナビルドが不要**。共有 App Runtime に Spec を登録するだけ。

```
1. Spec を Runtime レジストリに登録
2. DB マイグレーション実行（差分は自動生成、破壊的変更は要承認）
3. Keycloak に OIDC client / role を同期
4. Traefik ルート登録 (https://<slug>.apps.<company-domain>) ※独立オリジン（§7.3）
5. ヘルスチェック（/healthz が 3回連続 200）
6. App Store に公開（権限のあるユーザーに表示）
```

**デプロイ時間の目標: 30秒以内。** 「公開ボタンを押して30秒で使える」は非エンジニア向けプロダクトとして決定的に重要。

### 8.3 デプロイ手順（T3）

```
1. コンテナビルド（Buildpacks or 固定 Dockerfile）
2. イメージスキャン（Trivy）
3. cosign 署名 → Zot へ push
4. Blue/Green デプロイ
5. ヘルスチェック失敗 → 自動ロールバック（構想44項）
```

### 8.4 ロールバックとバージョン

- 直前の成功デプロイを常に保持（構想44項）
- ユーザー向け表示は「以前の状態に戻す」のみ（構想26項）
- **DB マイグレーションのロールバックは自動化しない**。破壊的変更を含むバージョンは、公開前に「この変更でデータが失われる可能性があります」と明示し、承認を要求する

---

## 9. App Store と権限

### 9.1 App Store（社員画面）

- 「自分が使えるアプリ」だけを表示（権限のないアプリは存在自体を見せない）
- 部門・タグ・検索
- お気に入り / 最近使った
- アプリ詳細に「作成者」「最終更新」「Risk レベル」を表示（透明性）

### 9.2 ロールモデル

| ロール | できること |
|---|---|
| **Employee** | App Store のアプリを使う |
| **Builder** | アプリを作る・編集する・Sandbox で試す。公開は承認経由 |
| **Approver** | YELLOW の公開を承認する |
| **Admin** | ユーザー・ポリシー・AI設定・バックアップ・全アプリの管理 |
| **Owner** | Admin ＋ 課金/ライセンス/組織設定 |

アプリ内の権限（`access.roles`）は Keycloak の client role として同期され、部門メンバーシップから自動割当できる。

---

## 10. 非機能要件

| 項目 | 目標値（v1.0） |
|---|---|
| 想定規模 | 1組織あたり 〜300ユーザー / 〜100アプリ / 〜50同時アクティブアプリ |
| 最小ハードウェア | 4 vCPU / 8GB RAM / 50GB SSD（LIGHT: 外部AI必須） |
| 推奨 | 8 vCPU / 24GB RAM / 200GB SSD（STANDARD: ローカル 8B モデル可） |
| PRO | 16 vCPU / 64GB RAM / GPU 24GB（ローカル 30B クラス） |
| セットアップ完了時間 | 15分以内（イメージDL含まず） |
| アプリ生成→プレビュー | 中央値 60秒以内（外部LLM）／180秒以内（ローカル） |
| 公開（T1/T2、スキャン込み） | 30秒以内 |
| バックアップ | RPO 24時間 / RTO 1時間（既定は日次3:00 フルバックアップ） |
| 可用性 | シングルノード前提。HA は Enterprise 相当機能として対象外 |
| 対応言語 | 日本語 / 英語（i18n 基盤は初期から入れる） |

### ハードウェアモード（構想76項）の実体

Installation Doctor がスペックを判定し、次を自動設定する。

| モード | 判定 | 自動設定 |
|---|---|---|
| LIGHT | RAM < 16GB | Ollama 無効。外部AI必須。同時デプロイアプリ上限 10 |
| STANDARD | 16GB ≤ RAM < 32GB | Ollama 有効（〜8B）。上限 30 |
| PRO | RAM ≥ 32GB or GPU | Ollama 有効（〜30B）。上限 100 |

---

## 11. Beginner Mode / Developer Mode（構想77〜79項）

**単なる用語の言い換えではなく、権限と機能の境界にする。**

| | Beginner | Developer |
|---|---|---|
| 生成 Tier | T1 / T2 | T1 / T2 / T3 |
| 見えるもの | 作る・直す・確認する・公開する・使う | ＋ Spec YAML / Git / ログ / コンテナ / 環境変数 / API |
| 用語 | 保存・履歴・以前の状態に戻す・公開 | Commit / Branch / Deploy / Rollback |
| Spec 直接編集 | 不可 | 可（Monaco Editor + スキーマ補完） |
| 有効化 | 既定 | 管理者がユーザー単位で付与 |

Developer Mode は **OSS の成否を左右する**。技術者が中を触れないと、コントリビューターが育たない。

---

## 12. 拡張点（Extension Points）

OSS として他人に使ってもらうには「フォークしないと直せない」を避ける必要がある。次を公式拡張点にする。

| 拡張点 | 形式 | 用途 |
|---|---|---|
| **App Templates** | `templates/<name>/app.yaml` | 業種・部門別テンプレート。PR で追加可能 |
| **AI Providers** | `@aiappfactory/ai-provider` インターフェース実装 | 新しい LLM プロバイダ |
| **Scanners** | JSON 出力の CLI ＋ マニフェスト | スキャナ追加。SARIF 形式を推奨 |
| **Risk Policies** | Rego ファイル | 組織独自の合否基準 |
| **UI Widgets** | React コンポーネント + Spec スキーマ拡張 | 新しい画面部品 |
| **Notification Channels** | `@aiappfactory/notifier` 実装 | Slack / Teams / Webhook |
| **SDK Capabilities** | `@aiappfactory/capability` 実装 | 社内システム連携（構想67項の Plugin System） |
| **Locales** | JSON | 多言語化 |

すべて **設定ファイル or npm パッケージ** で差し込めること。コア改変を要求しない。

---

## 13. v1.0 のスコープ（明示的な取捨選択）

### 含む

- Setup Wizard（Web、ワンタイムトークン保護）、Installation Doctor
- AI Builder（T1/T2）、対話編集、テンプレート
- Sandbox Preview
- **Security Gate 0〜9**（Spec検証 / ポリシー / Secret / 依存 / SAST / コンテナ / データ分類 / AIレビュー / 動的検査 / **自動受け入れテスト**）
- Risk Engine、承認フロー、Auto Fix ループ
- 自動デプロイ、ロールバック、ヘルス監視、自動再起動
- Keycloak SSO、部門・権限管理、Origin 分離
- App Store
- 監査ログ、AI ログ、コストダッシュボード（基本）
- バックアップ / リストア
- Import（アプリ: ZIP / Git、**データ: CSV / Excel**）、Export（Spec / ZIP / Docker）
- Docker Compose 配布、Linux インストーラ（.run）
- 日本語 / 英語 UI
- Developer Mode（Spec 編集、ログ、API）
- **T3（コード生成）— experimental・既定 OFF**

### 含まない（v1.1 以降 / Enterprise）

| 項目 | 理由・方針 |
|---|---|
| Visual Builder（D&D） | UI 実装コストが極大。まず対話編集の精度を上げる。→ v2.0 |
| Windows .exe / macOS .dmg | Tauri ランチャーの検証は M9、正式提供は **v1.1** |
| オフラインバンドル | v1.1 |
| n8n 埋め込み | ライセンス制約。Webhook 経由の外部連携のみ |
| Community Marketplace | 配布セキュリティ（署名・審査）の設計が別プロジェクト規模 |
| マルチノード / HA / K8s Operator | シングルノード前提。Helm chart は experimental |
| Slack / Teams 通知 | Email + Webhook のみ。他は Notifier 拡張で |
| 社内RAG（Knowledge Base）/ `company.ai.search` | v1.1。pgvector の基盤だけ先に入れる |
| `retention` の自動執行 | v1.0 では**宣言のみ**（Spec リファレンスに明記）。日次リテンションジョブは v1.1 |

---

## 14. 構想からの主な変更点（サマリ）

| # | 構想 | 本設計での扱い | 理由 |
|---|---|---|---|
| 1 | AI が任意コードを生成 | **App Spec を生成し Runtime が解釈**（T1/T2 が既定） | 生成成功率とセキュリティの両立 |
| 2 | 33項 Network Scan | **egress deny-by-default + allowlist 宣言** | 検査より遮断のほうが確実 |
| 3 | 35項 AI Security Review | **AI は Risk を上げられるが下げられない** | AI 判定を合格根拠にしない（fail-closed） |
| 4 | 58項 n8n 組み込み | **外部連携のみ** | Sustainable Use License と Apache-2.0 の不整合 |
| 5 | 83項 exe/dmg 配布 | **v1.1 以降**。v1.0 は compose + Linux インストーラ | Docker Desktop の商用ライセンス問題を回避する設計（Podman 採用）に時間が要る |
| 6 | 13項 Visual Builder | **v2.0** | 対話編集を先に完成させる |
| 7 | ストレージ | MinIO ではなく **ローカルFS 既定** | AGPL 同梱回避 |
| 8 | SAST | Semgrep ではなく **Opengrep** | ルールのライセンス変更リスク回避 |
| 9 | 84項「Docker等を見せない」 | **アプリごとに独立オリジン**（`<slug>.apps.<domain>`）を必須化 | パス分割ではブラウザ内でアプリ間分離が成立しない |
| 10 | 4項 exe をダブルクリック | **URLホスト名は実在ドメイン**（`.local` は使わない） | `.local` は mDNS 予約で公的CA が証明書を発行できない |
| 11 | 「自動テスト」 | **Gate 9: Spec から受け入れテストを機械生成**して Sandbox 実行 | 「動くか」を誰も検証しないまま公開されるのを防ぐ |
| 12 | データ移行 | **CSV/Excel インポートを v1.0 に含める** | これがないと実務でアプリが使われない |

---

## Sources

- [Keycloak 26.6.3 released](https://www.keycloak.org/2026/06/keycloak-2663-released)
- [Forgejo changes license to GPLv3+ (LWN.net)](https://lwn.net/Articles/986998/)
- [Important updates to Semgrep OSS](https://semgrep.dev/blog/2024/important-updates-to-semgrep-oss/)
- [Opengrep — The open-source code security engine](https://www.opengrep.dev/)
- [OWASP Top 10:2025](https://owasp.org/Top10/2025/)
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/)
- [How to sandbox AI agents in 2026: MicroVMs, gVisor & isolation strategies](https://northflank.com/blog/how-to-sandbox-ai-agents)
