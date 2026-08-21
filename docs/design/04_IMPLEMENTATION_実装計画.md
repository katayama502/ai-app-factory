# AI App Factory CE — 実装計画

**Version:** 0.1
**Date:** 2026-08-21
**前提:** v0.1 = 「生成 → スキャン → 公開」の一本道を通す

---

## 1. マイルストーン全体像

| MS | 名称 | 期間 | 累計 | ゴール（Definition of Done） |
|---|---|---|---|---|
| **M0** | Foundation | 2週 | 2週 | ADR 確定、monorepo 雛形、CI 稼働、`app-spec` v0 スキーマ確定、**セットアップのトークン保護＋管理者初期作成** |
| **M1** | Walking Skeleton | 6週 | 8週 | **1つのテンプレートを、対話なしで、Spec から動くアプリとして起動できる** |
| **M2** | AI Builder | 6週 | 14週 | 自然言語 →Spec 生成 → プレビュー → 会話編集、評価セット稼働 |
| **M3** | Security Gate | 7週 | 21週 | Gate 0/1/2/6/7/8/9 ＋ Risk Engine ＋ Auto Fix ＋ 承認 |
| **M4** | Identity & Store | 4週 | 25週 | Keycloak SSO、部門・権限、Origin 分離、App Store、公開フロー |
| **M5** | **v0.1 Public Alpha** | 2週 | **27週** | GitHub 公開。compose で第三者が動かせる |
| **M6** | Operations | 5週 | 32週 | Setup Wizard、Doctor、監視、バックアップ、アップデート、ロールバック |
| **M7** | Polish & i18n | 5週 | 37週 | 日英 UI、テンプレート10種、CSV/Excel 取込、ドキュメント、Import/Export |
| **M8** | **v0.5 Public Beta** | 2週 + パイロット4週 | 43週 | 実企業 3社でのパイロット |
| **M9** | Hardening | 6週 | 49週 | セキュリティテスト S-01〜18、性能、外部監査、T3 experimental |
| **M10** | **v1.0 GA** | 3週 | **52週** | LTS 開始、SBOM/署名、ドキュメント完備 |
| M11 | Desktop | 6週 | 58週 | v1.1: Windows/macOS インストーラ、オフラインバンドル |

**v0.1 まで 27週（約6.5ヶ月） / v1.0 まで 52週（約12ヶ月）**（コア3名フルタイム換算）

### 1人で進める場合

フルスコープを1人でやると 14ヶ月以上かかり、途中で失速する確率が高い。**§11 の7項目までスコープを削り、6〜8ヶ月で v0.1 を出してから仲間を集める**ことを強く推奨する。全部作ってから公開するのは、この規模では失敗する。

---

## 2. M0 — Foundation（2週）

### 決めきるべき ADR

| ADR | 決定事項 | 推奨 |
|---|---|---|
| ADR-001 | 生成モデル | Constrained App Model（T1/T2 既定、T3 は後回し） |
| ADR-002 | 言語・スタック | TypeScript / **Node 24 LTS** / Next.js 15 / Fastify 5 / PostgreSQL 17 |
| ADR-003 | ライセンス | Apache-2.0 ＋ DCO。Enterprise は別リポジトリ |
| ADR-004 | コンテナランタイム | Podman 既定 / Docker 互換 |
| ADR-005 | Spec のシリアライズ | YAML（人間向け）＋ JSON（内部）。正規化して hash |
| ADR-006 | 認証 | Keycloak + BFF パターン（SPA に生トークンを渡さない） |
| ADR-007 | アプリのデータ分離 | スキーマ分離 + 専用ロール + RLS |
| ADR-008 | Risk 判定 | 決定論的スコアリング。AI は加点のみ |
| ADR-009 | Git バックエンド | Gitea（MIT）。v0.1 では **内部の git bare repo で代替**し、Gitea 導入は M6 |
| ADR-010 | 式言語（T2） | 制限付き式 DSL。**⚠ 本番品質の JS 製 CEL 実装が事実上存在しない**ため、(a) 自前の制限 AST 評価器 / (b) cel-go サイドカー の2案を M0 で比較検証して決定 |
| ADR-011 | `rowLevel` の表現 | CEL 全体ではなく **RLS 変換可能な制限 DSL**（比較・論理演算・`ctx.user.*`・事前定義解決関数のみ） |
| ADR-012 | アプリの配信オリジン | **アプリごとに独立サブドメイン**（パス分割にしない）。ワイルドカード証明書 |

> **ADR-009 の補足** — v0.1 で Gitea を立てるのはコストが高い。Spec のバージョン履歴は最初 `git` バイナリ + bare repo で十分（ユーザーには「履歴」としか見せないので実装の入れ替えが効く）。Gitea は「Developer Mode でリポジトリを開く」機能が必要になった時点で導入する。

### 成果物

- monorepo 雛形（pnpm + Turborepo）、`.github/workflows/ci.yml`, `security.yml`
- `packages/app-spec` v0（Zod スキーマ、バリデータ、サンプル3件）
- `docker-compose.yml`（postgres + valkey のみ）
- **セットアップ保護の最小実装（2〜3d）** — ワンタイムトークン、`127.0.0.1` バインド既定、管理者アカウント初期作成、完了後のエンドポイント無効化
  → T-08（影響=致命）の唯一の対策。**これを M6 に置くと v0.1 Alpha が無防備なまま公開される**ため M0 に前倒しする
- README（英語）、LICENSE、CONTRIBUTING、SECURITY、CODE_OF_CONDUCT

---

## 3. M1 — Walking Skeleton（6週）★最重要

**「対話なしで、Spec ファイルを置いたら動くアプリが立ち上がる」** を作る。ここが動けば、残りは全部その周辺装備。

### Epic 一覧

担当: **A** = アーキテクト/BE、**F** = フロントエンド、**S** = AI/セキュリティ

| Epic | 内容 | 担当 | 見積 |
|---|---|---|---|
| E1-1 | `app-spec` スキーマ確定（entity / field / page / access / automation） | A | 5d |
| E1-2 | `spec-compiler`: Spec → DDL 生成、スキーマ・ロール作成、RLS ポリシー生成、`SET LOCAL` による主体伝播 | A | 10d |
| E1-3 | `runtime/data`: Spec から CRUD API を動的生成（Fastify + Kysely） | A | 8d |
| E1-4 | `runtime/renderer`: Spec から form / list / dashboard を描画 | F | 12d |
| E1-5 | `company-sdk` + `sdk-gateway` の最小版（database / auth のみ、DB 資格情報は Gateway のみ保持） | S | 6d |
| E1-6 | `deploy-engine`: Spec 登録 → Traefik ルート（**アプリ毎サブドメイン**）→ ヘルスチェック | S | 7d |
| E1-7 | テンプレート「営業日報」を Spec で完全表現 | F | 3d |
| E1-8 | E2E: Spec 投入 → ブラウザで日報を登録・一覧・検索できる | S | 4d |
| E1-9 | Origin 分離（`__Host-` Cookie / per-app CSP / COOP）＋ S-15 テスト | F | 5d |
| | **稼働** | A:23d / F:20d / S:17d（各30d 枠） | |

### DoD

```bash
$ aiaf app import templates/sales-daily-report
  ✔ Spec を検証しました
  ✔ データベースを準備しました (app_sales_daily_report)
  ✔ アプリを起動しました
  → https://localhost:8443/apps/sales-daily-report
```

ブラウザで日報の登録・一覧・検索・編集・ダッシュボード表示ができる。

### 技術的に最も難しい部分

**E1-4（Spec → UI レンダラー）が全体のリスク集中点。** ここを凝りすぎると永遠に終わらない。v0.1 では以下に限定する。

- フィールド型: string / text / richtext / number / decimal / date / datetime / boolean / select / multiselect / file / reference / actor
- ページ型: form / list / detail / dashboard の4種のみ
- ウィジェット: stat / bar / line / pie / table の5種のみ
- レイアウト: 1カラム固定（カスタムレイアウトは v0.5 以降）

---

## 4. M2 — AI Builder（5週）

| Epic | 内容 | 担当 | 見積 |
|---|---|---|---|
| E2-1 | `ai-core`: プロバイダ抽象（OpenAI互換 / Anthropic / Google / Ollama） | S | 5d |
| E2-2 | `ai-gateway`: ルーティング、分類ポリシー、トークン計測、監査 | S | 6d |
| E2-3 | 構造化出力（JSON Schema 制約 / GBNF 文法制約） | S | 4d |
| E2-4 | Requirement Elicitation（意図分類＋最大3往復の質問） | A | 5d |
| E2-5 | テンプレート検索（pgvector 埋め込み） | A | 3d |
| E2-6 | Spec 生成（フル生成 / テンプレート差分 JSON Patch） | A | 6d |
| E2-7 | Spec 自己修復ループ（検証エラー → 再生成、最大3回） | A | 3d |
| E2-8 | Builder UI（チャット + Spec プレビュー + 変更差分表示） | F | 10d |
| E2-9 | Sandbox プレビュー（TTL 30分、ダミーデータ投入） | A | 6d |
| E2-10 | 会話による差分編集（「顧客名も入力できるようにして」） | F | 5d |
| E2-11 | **評価セット（30ケース）＋ 週次 CI 実行＋スコアバッジ** | S | 8d |
| E2-12 | T2 式評価器（ADR-010 の決定に基づく実装） | S | 6d |
| E2-13 | i18n 基盤（M7 から前倒し） | F | 5d |
| | **稼働** | A:23d / F:20d / S:29d（各30d 枠） | |

### 評価基盤（必須）

**生成品質は「感覚」で判断してはいけない。** M2 の一部として評価セットを作る。

```
evals/
├── cases/
│   ├── 001-sales-daily-report.yaml    # 入力プロンプト + 期待される Spec の性質
│   ├── 002-expense-request.yaml
│   └── ... 30ケース
└── run.ts     # 各モデルで実行 → スコア（Spec検証通過率 / 必須エンティティ充足率 / 
                #                       余計な egress を宣言しない率）
```

CI で週次実行し、モデル別スコアを README にバッジ表示する。**「ローカル 8B でも 80% 通る」が示せれば、このプロダクトの説得力が決まる。**

---

## 5. M3 — Security Gate（5週）

| Epic | 内容 | 担当 | 見積 |
|---|---|---|---|
| E3-1 | `scanners`: SARIF 正規化、findings テーブル | S | 4d |
| E3-2 | Gate 0/1（Spec 検証、OPA/Rego ポリシー、require-approval ルール） | S | 7d |
| E3-3 | Gate 2（gitleaks 統合） | S | 2d |
| E3-4 | Gate 6（データ分類推定、PII 辞書 日英） | S | 4d |
| E3-5 | Gate 7（AI Review、加点のみ・severity 上限 MEDIUM） | S | 4d |
| E3-6 | Gate 8（Egress deny ログ確認。T3 の60秒観測は M9） | S | 4d |
| E3-7 | `risk-engine`: スコアリング、hard-block、require-approval、Ed25519 署名 | S | 6d |
| E3-8 | **Gate 9: Spec からの受け入れテスト機械生成（CRUD / 認可マトリクス / automation）** | A | 8d |
| E3-9 | Auto Fix ループ（停止条件、findings のエスケープ） | A | 5d |
| E3-10 | エスカレーション UI（非エンジニア向け表現 + 「機能を外して公開」） | F | 6d |
| E3-11 | スキャン進捗・結果 UI（`✓ Test PASS` / `✓ Security PASS` / Risk 表示） | F | 6d |
| E3-12 | 承認フロー（YELLOW → Approver → 公開）※ロールは暫定実装、M4 で Keycloak に差し替え | A | 5d |
| E3-13 | 危険 Spec 20件 / 正常 Spec 30件のフィクスチャと回帰テスト | F | 5d |
| | **稼働** | A:18d / F:17d / S:31d（各35d 枠） | |

> **E3-12 の順序** — 承認フローは Keycloak 統合（M4）より前に来る。M3 では Factory 内部のロールテーブルで実装し、M4 で Keycloak client role に差し替える。差し替えを前提にインターフェースを切っておくこと。
> **Gate 3/4/5（Trivy / Opengrep）は T3 専用**のため M9 に移動した。

### 検証

- 意図的に危険な Spec を20件用意（`security/fixtures/`）→ 全て RED になること
- 正常な Spec 30件 → 全て GREEN（誤検知ゼロ）。**誤検知は非エンジニア向けプロダクトでは致命傷**

---

## 6. M4 — Identity & App Store（4週）

| Epic | 内容 | 見積 |
|---|---|---|
| E4-1 | Keycloak 統合（realm 自動プロビジョニング、BFF、PKCE） | 6d |
| E4-2 | ユーザー・部門・ロール管理 UI | 6d |
| E4-3 | Spec の `access` → Keycloak client role 同期 | 4d |
| E4-4 | RLS への行レベル条件の反映（多層防御の検証込み） | 4d |
| E4-5 | App Store（一覧・検索・お気に入り・権限フィルタ） | 6d |
| E4-6 | 公開フロー（One Click Publish、進捗表示） | 4d |
| E4-7 | 監査ログ（ハッシュチェーン、閲覧 UI、整合性検証） | 5d |

---

## 7. M5 — v0.1 Public Alpha（2週）

### リリース条件

- [ ] compose 一発で第三者が起動できる（クリーンな VM で検証）
- [ ] 「営業日報アプリを作って」→ 公開 → 別ユーザーで利用、が通る
- [ ] README（英） + README.ja + 90秒デモ GIF
- [ ] ARCHITECTURE.md / App Spec Reference
- [ ] SECURITY.md + Private vulnerability reporting 有効化
- [ ] good first issue 20件
- [ ] 既知の制約を `LIMITATIONS.md` に正直に書く（Alpha である旨、T3 未対応、HA 非対応 など）
- [ ] SBOM + cosign 署名
- [ ] **S-11（トークンなしで `/setup` → 403）が通ること** — Alpha であっても、無防備なセットアップ画面を一般公開しない

### 公開時のコミュニケーション

- Hacker News / Reddit r/selfhosted / Zenn / Qiita
- 訴求の軸は **「AI が任意のコードを書くのではなく、検証可能な宣言を書く」** という設計上の主張。これが他の AI アプリビルダーとの差別化点であり、技術者の関心を引く
- 「非エンジニア向け」だけを前面に出すと技術者コミュニティに刺さらない。**セキュリティモデルを主役にする**

---

## 8. M6 — Operations（5週）

| Epic | 内容 | 見積 |
|---|---|---|
| E6-1 | Setup Wizard 本体（4ステップ UI、公開範囲・AI 設定・TLS 方式選択）※トークン保護は M0 で実装済み | 8d |
| E6-2 | Installation Doctor（CPU/RAM/Disk/Port/Runtime 判定、日本語の対処法） | 5d |
| E6-3 | Health Dashboard（アプリ稼働状況、CPU/Mem/Disk） | 5d |
| E6-4 | 自動再起動、リソース制限、暴走アプリの隔離 | 4d |
| E6-5 | ロールバック（デプロイ失敗時の自動復帰） | 4d |
| E6-6 | バックアップ / リストア（暗号化、日次スケジュール、UI） | 6d |
| E6-7 | アップデート（バージョン検知、ワンクリック、失敗時ロールバック） | 6d |
| E6-8 | Gitea 統合（Developer Mode でのリポジトリ表示） | 4d |
| E6-9 | AI Troubleshooter（ログ解析 → 日本語の原因説明） | 5d |
| E6-10 | コンテナ制御の権限最小化（rootless Podman ソケット、必要なら socket proxy 自前実装） | 5d |
| E6-11 | 社内 CA のルート証明書配布支援（ダウンロード、GPO/MDM 用手順書の自動生成） | 4d |

---

## 9. M7 — Polish & i18n（4週）

| Epic | 内容 | 見積 |
|---|---|---|
| E7-1 | 日英の全画面翻訳（基盤は E2-13 で完了済み） | 5d |
| E7-2 | テンプレート 10種（営業4 / 総務2 / 人事2 / 経理2） | 8d |
| E7-3 | アプリ Import（ZIP / Git URL）、Export（Spec / ZIP / Docker） | 6d |
| E7-4 | **データ Import（CSV / Excel）** — `import` ページ型、列マッピング UI、型検証、ドライラン、エラー行の CSV 返却、`bulkUpsert` API | 8d |
| E7-5 | Beginner / Developer モード切替 | 4d |
| E7-6 | Cost Dashboard（AI 利用量・コスト） | 4d |
| E7-7 | 通知（Email + Webhook）、Notifier 拡張インターフェース | 4d |
| E7-8 | ドキュメントサイト公開 | 5d |
| E7-9 | アクセシビリティ対応（キーボード・スクリーンリーダー・コントラスト） | 4d |

> **E7-4 は削れない。** Excel からの初期データ投入ができないアプリは、日報でも顧客台帳でも備品管理でも実務に載らない。パイロット（M8）で必ず露見する。

---

## 10. M8〜M10 — Beta から GA

### M8: v0.5 Public Beta（2週 + パイロット期間）

- 実企業 3社でのパイロット。**必ず「情シスがいない中小企業」を1社入れる**（想定ユーザーの本命）
- 計測項目: セットアップ完了率、初回アプリ公開までの時間、離脱ポイント、生成やり直し回数
- パイロットのフィードバックで M9 の優先順位を決める

### M9: Hardening（6週）

| Epic | 内容 | 担当 | 見積 |
|---|---|---|---|
| E9-1 | セキュリティテスト **S-01〜S-18** の完全自動化 | S | 10d |
| E9-2 | 性能テスト（50アプリ同時稼働、**300ユーザー**） | A | 6d |
| E9-3 | 外部セキュリティ監査（第三者ペネトレーションテスト）＋指摘対応 | S | 10d |
| E9-4 | 障害注入テスト（DB 停止、AI API 停止、ディスク満杯、スキャナ停止） | A | 6d |
| E9-5 | T3 experimental: Deno 権限サンドボックス、専用コンテナ、Gate 3/4/5（Trivy / Opengrep）、Gate 8 の60秒観測 | S / A | 16d |
| E9-6 | アップグレードテスト（v0.1 → v0.5 → v1.0 のデータ移行） | A | 5d |
| E9-7 | Tauri ランチャーの技術検証（v1.1 に向けた PoC のみ） | F | 8d |
| E9-8 | ARCHIVED 時のリソース回収（DBスキーマ / ロール / OIDC client / ルート / ストレージ） | A | 5d |
| E9-9 | UI 全体の磨き込み・ユーザビリティ改善（パイロット指摘対応） | F | 15d |
| | **稼働** | A:22d / F:23d / S:26d（各30d 枠） | |

### M10: v1.0 GA（3週）

- LTS ポリシー開始、12ヶ月のセキュリティサポート宣言
- Compliance ドキュメント（個人情報の扱い、データ所在、外部送信内容）
- 導入事例 2件以上

---

## 11. 体制と役割

### 最小構成（3名）

| ロール | 担当 | 稼働 |
|---|---|---|
| **アーキテクト / バックエンド** | app-spec, spec-compiler, runtime/data, sdk-gateway, security-gate, risk-engine | 100% |
| **フロントエンド** | console（Builder / Store / Admin / Wizard）, runtime/renderer, i18n, a11y | 100% |
| **AI / セキュリティ** | ai-core, ai-gateway, evals, スキャナ統合, ポリシー, 脅威モデル | 100% |

### 1名で始める場合の優先順位

```
1. app-spec スキーマ           ← ここが全ての土台
2. spec-compiler + runtime/data
3. runtime/renderer（form + list だけ）
4. AI で Spec 生成（テンプレート差分のみ。フル生成は後）
5. Gate 0/1/2 + Risk Engine
6. Gate 9（受け入れテスト生成）— 「動くか」の検証は最初から必要
7. 公開フロー（認証は最初 Basic 認証で代替、Keycloak は後）
8. ここで v0.1 公開して仲間を探す
```

Keycloak / Gitea の統合は **後から差し替え可能な設計**（インターフェース越しに使う）にしておき、初期は最小実装で代替する。これで v0.1 到達を **6〜8ヶ月** まで縮められる（フルスコープなら14ヶ月以上）。

ただし次の3つは初期実装でも省略できない。省略すると後から入れ直すコストが実装し直しに等しくなる。

- **アプリごとの独立オリジン**（後から変えるとアプリの URL が全部変わる）
- **DB スキーマ分離 ＋ `SET LOCAL` による主体伝播**（後から RLS を入れるのは事実上の作り直し）
- **セットアップのトークン保護**（公開する以上、無防備な状態を晒せない）

---

## 12. リスク登録簿

| # | リスク | 影響 | 確率 | 対策 |
|---|---|---|---|---|
| R-01 | **Spec の表現力不足**で「作りたいものが作れない」 | 致命 | 高 | M1 の前に、テンプレート15種を Spec で紙上表現してみる。表現できないものが3割超えたらスキーマを見直す |
| R-02 | ローカル LLM の生成品質が実用に届かない | 高 | 中 | テンプレート差分方式を第一級に。評価セットで定量監視。最低ラインを README に明記 |
| R-03 | Spec → UI レンダラーの実装が肥大化 | 高 | 高 | 型・ページ・ウィジェットを厳格に限定。「増やさない」をレビュー基準にする |
| R-04 | スキャンの誤検知で業務が止まる | 高 | 中 | 正常 Spec 30件で誤検知ゼロを CI で保証。AI 判定は加点上限 MEDIUM |
| R-05 | 1人開発でスコープに押し潰される | 致命 | 高 | v0.1 スコープを厳守。M5 公開を最優先マイルストーンに固定 |
| R-06 | Docker Desktop ライセンス問題の見落とし | 中 | 中 | Podman 既定を M0 で確定（ADR-004）。ドキュメントに明記 |
| R-07 | 同梱 OSS のライセンス非互換 | 高 | 中 | CI でライセンス検査を強制。AGPL/SSPL/BSL は同梱禁止リスト |
| R-08 | セキュリティ製品としての信頼を得られない | 高 | 中 | 外部監査（M9）、SBOM/署名、脅威モデル公開、Safe Harbor |
| R-09 | コントリビューターが集まらない | 中 | 高 | L1（テンプレート）の入口整備、good first issue、48時間応答 |
| R-10 | 「AI が作ったアプリを本番で使う」への組織的抵抗 | 高 | 高 | 承認フロー・監査ログ・Sandbox・Risk 表示を「安心材料」として前面に出す。Compliance ドキュメントを整備 |
| R-11 | DB マイグレーション（列削除等）でデータ喪失 | 高 | 中 | 破壊的変更は必ず承認必須＋自動バックアップ＋論理削除を既定に |
| R-12 | 商標・名称の衝突 | 低 | 中 | 公開前に商標調査。`TRADEMARK.md` を用意 |
| R-13 | **T2 の式言語に本番品質の JS 実装がない**（CEL） | 中 | 高 | M0 で ADR-010 として比較検証（自前 AST 評価器 / cel-go サイドカー）。決まるまで T2 の実装に着手しない |
| R-14 | **`rowLevel` → RLS 変換が一般には成立しない** | 高 | 高 | ADR-011 で制限 DSL に限定し、スキーマで構文的に強制。E1-2 で `SET LOCAL` による主体伝播も実装 |
| R-15 | **アプリ間分離がブラウザ内で成立しない**（同一オリジン配信） | 高 | 中 | ADR-012 でアプリ毎サブドメインを必須化。S-15 で検証 |
| R-16 | 社内 CA のルート証明書配布で導入が止まる | 中 | 高 | Let's Encrypt DNS-01 を推奨経路に。社内 CA 選択時は配布手順を自動生成（E6-11） |

---

## 13. 成功指標（KPI）

| フェーズ | 指標 | 目標 |
|---|---|---|
| v0.1 Alpha | GitHub Star | 500 |
| | セットアップ成功率（クリーン環境） | 90% |
| | Issue 初回応答時間 | 48時間以内 |
| v0.5 Beta | パイロット企業 | 3社 |
| | 初回アプリ公開までの時間（中央値） | 15分以内 |
| | 生成 Spec の検証通過率（ローカル8B） | 80% |
| | 外部コントリビューター | 10名 |
| v1.0 GA | 導入組織（把握できる範囲） | 30 |
| | テンプレート数 | 30（うちコミュニティ提供10） |
| | Critical 脆弱性 | 0（未修正のまま14日超が0） |

---

## 14. 最初の2週間でやること（今すぐ）

1. **テンプレート15種を App Spec で紙上表現してみる**（コードは書かない）
   → R-01 の検証。ここでスキーマの過不足が全部見える。**この作業を飛ばすと、後で全部書き直しになる**
   → 表現できないものが3割を超えたら、Spec スキーマを設計し直すか、対象業務の範囲を狭める
2. ADR-001〜012 を書いて確定する（特に ADR-010 の式言語は実装前に決着させる）
3. リポジトリを作り、README（英語・構想の要約 + 設計の主張）と ROADMAP を置く
4. `packages/app-spec` の Zod スキーマ v0 を書く
5. CI（lint / typecheck / test / gitleaks）を通す
6. 「営業日報」の Spec を1本、手書きで完成させる

**この6項目が終わった時点で、プロジェクトの成否はほぼ決まる。** Spec スキーマが良ければ後は作業量の問題であり、悪ければ何を作っても崩れる。
