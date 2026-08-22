# AI App Factory — Community Edition

**非エンジニアが AI で社内業務アプリを作れるようにする。ただし AI に「本番で動くコード」を書かせない。**

[English README](./README.md) · [設計書](./docs/design/) · [ロードマップ](./ROADMAP.md) · [セキュリティ設計](./docs/design/02_SECURITY_セキュリティ設計書.md)

**初めての方・エンジニアではない方へ**：まず **[GETTING_STARTED.ja.md](./GETTING_STARTED.ja.md)**
を読んでください——専門知識を前提としない、やさしい言葉のステップバイステップガイドです。この
READMEは技術者向けのリファレンスで、ガイドの方が最初の入り口として適しています。

> **現在の状態: M1（Walking Skeleton）のDoDを達成し、M4の実認証部分に加えて、M0/M2/M3/M5/M6/M7/M9/M10
> の軽量版スライスも完了。** AIを一切介さず手書きした App Specが、分離されたPostgresスキーマにコンパイル
> され、実際のKeycloakログイン（Authorization Code + PKCE、BFFパターン）で保護されたブラウザアプリと
> して動作します——開発用の仮認証ではありません。HTMLフォームからレコードを登録し、一覧で確認し、検索
> でき、ログインユーザーごとに行レベルのアクセス制御が効きます。自然言語の説明文からも同じ形式のSpecを
> 生成でき、検証エラーに対して自己修復します（M2のコアループ）——ただし実際のClaude APIではなくフェイクの
> プロバイダに対してのみ検証済みです。また、SpecはGate 0/2/6と決定論的な署名付きGREEN/YELLOW/RED判定
> （M3のSecurity Gateスライス）を通過します。第三者に必要なインフラ（Postgres/Valkey/Keycloak）は
> `docker compose` で起動できるようになり（M5のインフラスライス——アプリ本体はまだホストのNodeプロセスの
> ままで、コンテナイメージ化はしていません）、`pnpm doctor` で不足要件を日本語の対処法つきで確認でき
> （M6のスライス）、App Specテンプレートは目標10個のうち5個まで揃いました（M7のスライス）。セキュリティ
> 脅威モデルのS-01〜S-18のうち9件をテストに対応付け（うち3件は今回新規追加）、残り9件は未実装の機能に
> 依存するため正直に「未対応」と明記しました。アプリのアーカイブ時にPostgresスキーマ/ロールとKeycloak
> クライアント/ロールを実際に削除する機能も実サーバーで検証済みです（M9のスライス）。`pnpm sbom` は実際の
> 依存関係ツリーから本物のCycloneDX SBOMを生成し、CIにも組み込みました（M10のスライス——署名対象がまだ
> 存在しないため署名と実際のGA宣言は未実施）。M8（実企業でのパイロット）とM11（デスクトップインストーラ）
> は意図的に未着手です——理由はROADMAP.mdを参照してください。いずれもUIや公開フローにはまだ接続されて
> いません——すべてテスト済みのライブラリであって、動く製品ではありません。`pnpm dev:sample` で実際に
> 起動して確認できます（下記）。「今、実際に動くもの」の詳細は [ROADMAP.md](./ROADMAP.md) を参照してください。

## 一言でいうと

AI に任意のコードを書かせて動かすのではなく、AI には **検証可能な宣言（App Spec）** だけを書かせ、
それを汎用の **App Runtime** が解釈して実行します。

```
自然言語  →  App Spec（YAML/JSON、スキーマ検証可能）  →  App Runtime が解釈して実行
```

SQL Injection も eval も、Spec の文法として *そもそも表現できない*。「生成後にスキャンして祈る」ではなく
「危険なものを書けなくする」というアプローチです。詳細は
[`docs/adr/001-constrained-app-model.md`](./docs/adr/001-constrained-app-model.md)。

## 動かしてみる

```bash
pnpm install
pnpm build
pnpm test                                                   # 全パッケージのユニットテスト
pnpm --filter @aiappfactory/spec-compiler test:integration  # ローカルPostgresが必要（下記）
pnpm --filter @aiappfactory/sdk-gateway test:integration
pnpm --filter @aiappfactory/auth-bff test:integration       # Dockerが必要（Keycloakを自動起動）
pnpm --filter @aiappfactory/runtime test:integration        # 両方必要
pnpm --filter @aiappfactory/setup-guard test:integration    # Dockerが必要（Keycloakを自動起動）
```

Postgres系の統合テストは `127.0.0.1:5432` の Postgres スーパーユーザーに接続します（`brew install
postgresql@14` を想定）。それぞれ使い捨てのデータベースとロールを作成し、成功・失敗にかかわらず
`afterAll` で必ず削除します。Keycloak系の統合テストはDockerが必要で、使い捨てのKeycloakコンテナを
自前で起動・削除します。5つとも CI（`.github/workflows/ci.yml` の `integration` ジョブ）に組み込み済みです。

実際にブラウザで触ってみるには：

```bash
pnpm dev:sample
# → http://sales-daily-report.apps.localhost:4200/pages/0
# → http://expense-request.apps.localhost:4200/pages/0
# ログイン: alice/alice-dev, bob/bob-dev, carol/carol-dev
```

2つの異なるテンプレートをローカルの永続Postgres DB（`aiaf_dev`）と永続Keycloakコンテナ
（`aiaf-dev-keycloak`）に展開し、それぞれ別の `*.apps.localhost` オリジン（別々のOIDCクライアント）
から同一のRuntimeプロセスが配信します（`*.localhost` は Chrome 等で自動的にループバックへ解決される
ため `/etc/hosts` の編集は不要です）。ログインするとKeycloak本物のログイン画面にリダイレクトされます
——モックではありません。手動確認用スクリプト（`scripts/dev-server.ts`）で、製品本体には含まれません。

### Docker Composeで動かす（M5 — ローカルにPostgres/Keycloakを入れなくてよい）

Postgresを手動インストールしたりKeycloakを自前で起動したくない場合、
`deploy/compose/docker-compose.yml` がその両方（と Valkey）をコンテナとして用意します。
`scripts/dev-server.ts` は環境変数でそちらを指定すると、自前でコンテナを管理せずそれらに接続します。

```bash
cp deploy/compose/.env.example deploy/compose/.env
# deploy/compose/.env を編集 — POSTGRES_PASSWORD / VALKEY_PASSWORD / KEYCLOAK_ADMIN_PASSWORD を設定
docker compose --env-file deploy/compose/.env -f deploy/compose/docker-compose.yml up -d

AIAF_PG_USER=<.envのPOSTGRES_USER。変更していなければ "factory"> \
AIAF_PG_PASSWORD=<.envのPOSTGRES_PASSWORD> \
AIAF_KEYCLOAK_URL=http://127.0.0.1:8180 \
AIAF_KEYCLOAK_ADMIN_PASSWORD=<.envのKEYCLOAK_ADMIN_PASSWORD> \
pnpm dev:sample
```

このリポジトリ内で実際に動作確認済みです（ポートを分離した環境でスタックを起動し、
Postgres/Valkeyが`healthy`になること、Keycloakの`/realms/master`が応答すること、
`dev:sample`がそれらに対して正常に起動しrealm/schemaを作成すること、
実際のHTTPリクエスト（`/healthz`→200、未認証ページ→`/auth/login`へ302）が
ローカル完結フローと同じように動くことまで確認し、その後きれいに片付けました）。
まだできていないこと（M5本来のDoDのうち、より難しい方の半分）：`apps/runtime`/`sdk-gateway`
自体をコンテナイメージ化することです——今はまだホストのNodeプロセスとして`pnpm dev:sample`経由で
動かしており、Compose内では動きません。

### インストール状況を確認する（M6）

```bash
pnpm doctor
```

Node/pnpmのバージョン、Dockerデーモンの起動状況、メモリ・ディスク空き容量、
このリポジトリの開発フローが使うポート（5432/6379/8180/4100/4200）の空き状況を確認し、
問題があれば日本語の対処法つきで表示します。

`templates/` に5つのサンプル Spec（営業日報・経費申請・会議室予約・IT機器貸与申請・休暇申請）があります
（M7の「10テンプレート」目標への途中経過 — [ROADMAP.md](./ROADMAP.md) 参照）。

### SBOMを生成する（M10）

```bash
pnpm sbom
```

実際の依存関係ツリーから本物のCycloneDX 1.5形式のSBOM（`sbom.cdx.json`）を生成します。
全12ワークスペースパッケージと、解決済みのサードパーティ依存関係（実際にインストールされた
`package.json`から取得した本物のライセンス情報つき）を含みます。CIでも毎回ビルド成果物として
生成されます。

## ドキュメント

全体設計・セキュリティ設計・リポジトリ運営・実装計画の原本は [`docs/design/`](./docs/design/) にあります。
アーキテクチャ上の個別の意思決定（なぜこの設計にしたか）は [`docs/adr/`](./docs/adr/) に ADR として記録しています。

## ライセンス

Apache-2.0。詳細は [`LICENSE`](./LICENSE) を参照してください。
