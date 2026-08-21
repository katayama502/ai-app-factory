# AI App Factory CE — リポジトリ構成と OSS 運営設計

**Version:** 0.1
**Date:** 2026-08-21
**License:** Apache-2.0

---

## 1. リポジトリ戦略

### 1.1 単一 monorepo + 衛星リポジトリ

| リポジトリ | 内容 | 公開時期 |
|---|---|---|
| **`ai-app-factory`** | 本体 monorepo（Console / API / Runtime / SDK / Spec / Deploy / Security Gate）。**同梱コアテンプレートは `templates/` に置く** | v0.1（M5） |
| **`ai-app-factory-templates`** | **コミュニティ提供**テンプレート集（貢献の主戦場）。CI で Spec 検証が通れば merge | v0.5（M8） |
| **`ai-app-factory-docs`** | ドキュメントサイト（Astro Starlight） | v0.5（M7） |
| **`ai-app-factory-desktop`** | Tauri ランチャー（Rust。ビルド環境が違うので分離） | v1.1（M11） |
| **`.github`** | org 共通の Issue/PR テンプレート、プロファイル README | v0.1 |

monorepo を選ぶ理由: Spec スキーマ・SDK・Runtime が同時に変わるため。マルチリポだとバージョン整合で破綻する。

### 1.2 ディレクトリ構成

```
ai-app-factory/
├── apps/
│   ├── console/                 # Next.js 15 — Builder / App Store / Admin / Setup
│   │   ├── app/
│   │   │   ├── (setup)/         # 初回セットアップ Wizard
│   │   │   ├── (store)/         # 社員向け App Store
│   │   │   ├── (builder)/       # AI Builder
│   │   │   └── (admin)/         # 管理コンソール
│   │   ├── components/
│   │   └── locales/{ja,en}.json
│   └── runtime/                 # 汎用 App Runtime（T1/T2 の実行主体）
│       ├── src/renderer/        # Spec → UI
│       ├── src/data/            # Spec → CRUD API
│       └── src/automation/      # Spec → トリガー実行
│
├── services/
│   ├── api/                     # Fastify — Control Plane API
│   ├── ai-gateway/              # LLM 単一出口
│   ├── ai-orchestrator/         # 対話 → Spec 生成 / 差分適用 / 自己修復
│   ├── security-gate/           # スキャンオーケストレータ（Gate 0〜9）
│   ├── deploy-engine/           # デプロイ・ヘルス・ロールバック
│   └── sdk-gateway/             # Company SDK のサーバ側（唯一の信頼境界の穴）
│
├── packages/
│   ├── app-spec/                # ★ Spec スキーマ（Zod → JSON Schema）＋バリデータ＋マイグレータ
│   ├── company-sdk/             # アプリ向けクライアント SDK
│   ├── spec-compiler/           # Spec → DDL / RLS / UIメタ / OIDC client
│   ├── ai-core/                 # プロバイダ抽象 + 構造化出力 + プロンプト
│   ├── risk-engine/             # findings 集約 + Rego 実行 + 署名
│   ├── scanners/                # 各スキャナのアダプタ（SARIF 正規化）
│   ├── audit/                   # ハッシュチェーン監査ログ
│   ├── db/                      # Prisma スキーマ・マイグレーション
│   ├── ui/                      # 共有 React コンポーネント（shadcn/ui ベース）
│   ├── i18n/
│   └── config/                  # eslint / tsconfig / tailwind の共有設定
│
├── policies/                    # 既定 Rego ポリシー
│   ├── classification.rego
│   ├── network.rego
│   └── approval.rego
│
├── templates/                   # 同梱コアテンプレート（コミュニティ提供は別リポジトリ）
│   ├── sales-daily-report/
│   ├── crm-lite/
│   ├── expense-request/
│   ├── asset-management/
│   ├── meeting-room/
│   └── ...
│
├── deploy/
│   ├── compose/
│   │   ├── docker-compose.yml
│   │   ├── docker-compose.gpu.yml
│   │   └── .env.example
│   ├── helm/                    # experimental
│   ├── installer/
│   │   ├── install.sh           # Linux ワンライナー
│   │   └── AI-App-Factory.run   # self-extracting
│   └── seccomp/factory-default.json
│
├── e2e/                         # Playwright（機能 + セキュリティテスト S-01〜S-14）
├── docs/
│   ├── adr/                     # Architecture Decision Records
│   ├── getting-started.ja.md
│   ├── getting-started.en.md
│   ├── app-spec-reference.md
│   ├── extending/               # 拡張ガイド（テンプレ/プロバイダ/スキャナ/ウィジェット）
│   └── operations/              # バックアップ・アップデート・トラブルシュート
│
├── .github/
│   ├── workflows/
│   │   ├── ci.yml               # lint / typecheck / unit / build
│   │   ├── security.yml         # gitleaks / opengrep / trivy / codeql
│   │   ├── e2e.yml
│   │   ├── release.yml          # release-please → イメージ / SBOM / cosign
│   │   └── docs.yml
│   ├── ISSUE_TEMPLATE/
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── dependabot.yml
│
├── LICENSE                      # Apache-2.0
├── NOTICE
├── SECURITY.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── GOVERNANCE.md
├── ROADMAP.md
├── CHANGELOG.md
├── README.md / README.ja.md
├── turbo.json
├── pnpm-workspace.yaml
└── package.json
```

### 1.3 パッケージ間の依存方向（重要）

```
apps/console ──┐
apps/runtime ──┼─→ packages/ui, i18n
services/*   ──┘
                 ↓
           packages/app-spec   ← ★ すべての中心。ここだけは絶対に安定させる
                 ↓
           packages/spec-compiler, risk-engine, ai-core, audit, db
```

`app-spec` は **公開 API 契約**。破壊的変更は必ず major バージョンを上げ、`specVersion` によるマイグレーションを提供する（既存アプリを壊さないことが OSS の信頼を作る）。

---

## 2. 技術スタック確定

| レイヤ | 採用 | 理由 |
|---|---|---|
| 言語 | **TypeScript 5.9+ / Node.js 24 LTS** | フロント・バック・SDK を1言語に統一。22 系は 2027年4月 EOL のため、v1.0 GA 後12ヶ月の LTS 保証と両立しない |
| パッケージ管理 | **pnpm 10** + workspace | monorepo での重複排除、厳格な依存解決 |
| ビルド orchestration | **Turborepo** | 差分ビルド・キャッシュ |
| フロント | **Next.js 15 (App Router) / React 19** | SSR による BFF パターン、トークンをブラウザに置かない |
| UI | **Tailwind CSS 4 + shadcn/ui + Radix** | アクセシビリティ（キーボード操作・スクリーンリーダー）を最初から確保 |
| API | **Fastify 5** | 軽量・高速・プラグイン。NestJS は非エンジニア向け OSS には重い |
| バリデーション | **Zod 4** → JSON Schema 生成 | Spec スキーマと API 契約を単一ソースに |
| ORM | **Prisma 6** | マイグレーション管理。動的スキーマ部分は生 SQL（Kysely）併用 |
| DB | **PostgreSQL 17 + pgvector** | RLS がこの設計の要。pgvector で RAG も同居 |
| Queue | **BullMQ + Valkey** | スキャン・デプロイの非同期実行 |
| 式評価 | **CEL** | サンドボックス化された式（T2） |
| ポリシー | **OPA / Rego** | 業界標準。組織が自分でポリシーを書ける |
| コンテナ | **Podman 5（既定）/ Docker 互換** | Docker Desktop の商用ライセンス問題を回避 |
| リバースプロキシ | **Traefik v3** | 動的ルーティング（アプリ追加のたびに再起動しない） |
| テスト | **Vitest**（unit）/ **Playwright**（E2E） | |
| ログ | **Pino** → JSON Lines | |
| 可観測性 | **OpenTelemetry**（opt-in） | |
| デスクトップ | **Tauri 2 (Rust)** | Electron より軽量（〜10MB）。署名・自動更新の仕組みが標準装備 |
| ドキュメント | **Astro Starlight** | i18n が標準対応 |

### なぜ Docker ではなく Podman を既定にするか

構想 83 項の「Windows .exe / macOS .dmg」を実現しようとすると、コンテナランタイムを同梱する必要がある。しかし **Docker Desktop は従業員250人以上または年商1000万ドル以上の企業では有料**であり、Apache-2.0 の OSS に同梱すると利用者に予期しない義務が生じる。

Podman（Apache-2.0）は、
- Windows: WSL2 上で動作、`podman machine` で自動セットアップ
- macOS: `podman machine`（Apple Virtualization.framework）
- Linux: ネイティブ・rootless

かつ Docker Compose 互換（`podman-compose` / Docker API 互換ソケット）。**既存の Docker 環境がある利用者はそのまま使える**ようアダプタ層で吸収する。

---

## 3. ライセンス設計

### 3.1 本体: Apache-2.0

理由：
- 企業の社内導入の法務ハードルが最も低い（＝採用が伸びる）
- 特許条項があり、コントリビューターと利用者の双方を守る
- Keycloak / Trivy / OPA / Traefik など、依存 OSS の主流と整合

### 3.2 収益モデルとの整合（構想81項）

Apache-2.0 でも収益化は成立する。**「機能を制限する」のではなく「運用の面倒を引き受ける」で稼ぐ**。

| 収益源 | 内容 | OSS との関係 |
|---|---|---|
| 導入支援・PoC | セットアップ、要件整理、テンプレート開発 | 本体無料でも需要は大 |
| Managed Hosting | 自社が運用する SaaS 版 | Apache-2.0 でも自社提供は自由 |
| Enterprise Add-on | SSO 拡張（SAML/SCIM）、監査レポート、HA、SIEM 連携、SLA | **別リポジトリ・別ライセンス**（商用）で提供 |
| Connector 開発 | 基幹システム連携 | Plugin System（拡張点）を使った受託 |
| 研修・認定 | 社内 Builder 育成プログラム | 非エンジニア向けなので研修需要が構造的にある |
| セキュリティ設計支援 | 組織ポリシー（Rego）の設計 | |

> **Open Core にするなら最初から線を引く。** 後から「この機能を有料にします」は OSS コミュニティの信頼を失う最大の原因。v0.1 の README に「コアは永久に Apache-2.0。Enterprise Add-on は別リポジトリ」と明記する。

### 3.3 CLA / DCO

- **DCO（Developer Certificate of Origin）を採用**（CLA ではなく）
- 理由: CLA は個人コントリビューターの心理的ハードルが高い。Apache-2.0 でデュアルライセンスの必要がないため CLA の実益が小さい
- 実装: `git commit -s` + GitHub の DCO App で強制

### 3.4 サードパーティライセンス管理

- `NOTICE` に全依存の帰属表示を自動生成（`license-checker` → CI で差分検出）
- **同梱禁止リスト** を CI で強制: AGPL / SSPL / Sustainable Use License / BSL
- コンテナイメージごとに SBOM（SPDX + CycloneDX）を release asset として添付

### 3.5 商標

- 「AI App Factory」の名称とロゴは商標として別途保護し、`TRADEMARK.md` でフォーク時の利用条件を明示（コードは自由、名称は要許諾）。これは Apache-2.0 プロジェクトの標準的な運用

---

## 4. CI/CD

### 4.1 パイプライン

```
PR
 ├─ ci.yml         : pnpm install → lint → typecheck → unit test → build（affected のみ）
 ├─ security.yml   : gitleaks / opengrep / trivy fs / codeql / license check
 ├─ e2e.yml        : compose 起動 → Playwright（機能 + S-01〜S-14）
 └─ preview        : ドキュメントのプレビューデプロイ

main へ merge
 └─ release-please : Conventional Commits から CHANGELOG / version PR を自動生成

タグ push (v*)
 └─ release.yml    : マルチアーキビルド (amd64/arm64)
                     → ghcr.io へ push
                     → SBOM 生成 (syft)
                     → cosign keyless 署名
                     → GitHub Release 作成（compose / installer / SBOM / checksums 添付）
```

### 4.2 リリース規律

- **SemVer 厳守**。`app-spec` の破壊的変更 = メジャー
- リリースサイクル: **月次マイナー / 随時パッチ**。予測可能性が企業導入の条件
- LTS: v1.0 以降、メジャーごとに12ヶ月のセキュリティサポート
- すべてのリリースに **アップグレードガイド** と **ロールバック手順** を添付

### 4.3 品質ゲート（main への merge 条件）

| 項目 | 基準 |
|---|---|
| ユニットテストカバレッジ | `packages/app-spec`, `risk-engine`, `spec-compiler` は 90% 以上。全体 70% 以上 |
| 型エラー | 0（`strict: true`） |
| セキュリティスキャン | High 以上 0 |
| E2E | 全パス |
| レビュー | 1 approve 以上（コア領域は CODEOWNERS で2名） |

---

## 5. 配布

| 形態 | v1.0 | 内容 |
|---|---|---|
| **Docker Compose** | ✅ | `curl -fsSL get.aiappfactory.dev \| sh` → compose 取得 → 起動 → Wizard URL 表示 |
| **Linux .run** | ✅ | self-extracting。Podman 有無を判定して自動インストール |
| **Helm chart** | experimental | 単一ノード前提の簡易 chart |
| **Windows .exe** | v1.1 | Tauri ランチャー + WSL2/Podman machine 自動構成 |
| **macOS .dmg** | v1.1 | Tauri ランチャー + Podman machine（Apple Silicon 優先） |
| **オフラインバンドル** | v1.1 | 全イメージを tar で固めた `.tar.zst`（インターネット非接続の企業向け。日本の製造業では必須級） |

### インストール体験の目標

```
$ curl -fsSL https://get.aiappfactory.dev | sh

  ✔ システム要件を確認しています... OK (8 CPU / 32GB RAM / 240GB free)
  ✔ コンテナランタイムを確認しています... Podman 5.4 検出
  ✔ ポートを確認しています... 8443 利用可能
  ✔ イメージを取得しています... [########] 100% (1.8GB)
  ✔ 起動しています...

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
   AI App Factory の準備ができました

   https://localhost:8443/setup?token=8f2a...c91

   このURLをブラウザで開いてください（有効期限15分）
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**「エラーが出たら次にすべきことを必ず出す」** — 非エンジニア向け OSS の離脱率はここで決まる。`Installation Doctor` は失敗時に日本語で具体的な対処法（ポート競合ならどのプロセスを止めるか）を出す。

---

## 6. OSS 運営設計

### 6.1 最初の90日でやるべきこと

企業向け OSS が失敗する典型は「コードは立派だが誰も試せない」。次を v0.1 公開時点で揃える。

| # | 項目 | なぜ必要か |
|---|---|---|
| 1 | **5分で動く Quick Start**（compose 一発） | READMEを読んで5分で動かないプロジェクトは試されない |
| 2 | **90秒のデモ動画/GIF**（要求→生成→公開→利用） | 文章より圧倒的に伝わる。README の一番上に置く |
| 3 | **公開デモ環境**（read-only、リセット付き） | 「まず触ってみたい」に応える |
| 4 | **英語 README を第一言語に**（日本語は README.ja.md） | GitHub の可視性・コントリビューター獲得のため |
| 5 | **ARCHITECTURE.md** | 大きなプロジェクトは全体像がないと誰も貢献できない |
| 6 | **good first issue を20件用意** | 最初のコントリビューターの入口 |
| 7 | **GitHub Discussions** の開設 | Issue と質問を分離 |
| 8 | **ROADMAP.md** と公開プロジェクトボード | 「これは続くのか？」への回答 |
| 9 | **SECURITY.md** + Private vulnerability reporting 有効化 | セキュリティ製品として必須 |
| 10 | **SBOM + 署名付きリリース** | 企業が稟議を通すための材料 |

### 6.2 コントリビューションの入口設計

貢献の難易度を意図的に階段状にする。

| レベル | 貢献内容 | 必要スキル |
|---|---|---|
| L1 | **アプリテンプレート追加**（YAML のみ） | 業務知識のみ。プログラミング不要 |
| L2 | 翻訳（ja/en/その他） | 語学 |
| L3 | ドキュメント改善 | |
| L4 | Rego ポリシー追加 | セキュリティ知識 |
| L5 | UI ウィジェット追加 | React |
| L6 | AI プロバイダ / スキャナアダプタ追加 | TS |
| L7 | コア（Spec/Runtime/SDK） | 設計理解 |

**L1 が存在することがこのプロジェクトの強み。** 「営業日報テンプレートを自社向けに作ったので PR します」が成立する OSS は珍しい。テンプレートリポジトリを分離し、CI で Spec 検証だけ通れば merge できるようにする。

### 6.3 ガバナンス（GOVERNANCE.md）

```
- 初期は BDFL（作者）モデル。透明性のため意思決定は ADR で公開
- Maintainer 昇格基準: 継続的な質の高い貢献（目安: 3ヶ月・10PR）
- 領域別 CODEOWNERS（security / spec / runtime / ui / docs）
- 破壊的変更は RFC Issue → 2週間のコメント期間 → ADR
- 将来的に CNCF Sandbox / OpenSSF 参加を検討（企業導入の信頼性向上）
```

### 6.4 コミュニティ運営

- **リリースノートを日本語でも書く**（想定ユーザーが日本企業なら必須）
- 月次の「Community Call」は無理に始めない。まず Discussions での応答速度（48時間以内）を守る
- Issue テンプレートに **環境情報の自動収集コマンド**（`aiaf doctor --report`）を書く。再現できない Issue はメンテナを疲弊させる

---

## 7. ドキュメント構成

| 対象読者 | ドキュメント | 内容 |
|---|---|---|
| 評価者（意思決定者） | README / Why / Comparison | 何ができるか、Power Apps や Retool と何が違うか、セキュリティモデル |
| 導入者（情シス） | Installation / Requirements / Operations | 要件、インストール、バックアップ、アップデート、トラブルシュート |
| 管理者 | Admin Guide / Policy Reference | ユーザー管理、AI ポリシー、Rego、承認フロー |
| 社員（Builder） | User Guide（日本語・スクショ多め） | アプリの作り方。**専門用語を使わない** |
| 開発者 | ARCHITECTURE / App Spec Reference / Extending / ADR | 拡張・貢献 |
| セキュリティ担当 | Security Model / Threat Model / Compliance | 監査対応の材料 |

**Compliance ページ** は日本企業向けに特に重要: 「個人情報保護法上の扱い」「データはどこに保存されるか」「外部 AI に何が送られるか」を明快に書く。ここが曖昧だと導入審査で落ちる。

---

## 8. 命名と初期セットアップの具体

### リポジトリ

```
github.com/<org>/ai-app-factory
```

### npm スコープ

```
@aiappfactory/app-spec
@aiappfactory/company-sdk
@aiappfactory/ai-provider    # 拡張用インターフェース
```

### コンテナイメージ

```
ghcr.io/<org>/aiaf-console:1.0.0
ghcr.io/<org>/aiaf-api:1.0.0
ghcr.io/<org>/aiaf-runtime:1.0.0
ghcr.io/<org>/aiaf-ai-gateway:1.0.0
ghcr.io/<org>/aiaf-security-gate:1.0.0
ghcr.io/<org>/aiaf-deploy-engine:1.0.0
```

### CLI

```
aiaf doctor            # 環境診断（構想75項）
aiaf up / down         # 起動・停止
aiaf backup / restore
aiaf app list / export / import
aiaf update
aiaf logs <service>
```

CLI は Developer Mode / 情シス向け。一般社員は一切触らない。
