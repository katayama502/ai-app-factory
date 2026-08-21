# AI App Factory — Community Edition

**非エンジニアが AI で社内業務アプリを作れるようにする。ただし AI に「本番で動くコード」を書かせない。**

[English README](./README.md) · [設計書](./docs/design/) · [ロードマップ](./ROADMAP.md) · [セキュリティ設計](./docs/design/02_SECURITY_セキュリティ設計書.md)

> **現在の状態: M1（Walking Skeleton）のDoDを達成し、M4の実認証部分も完了。** AIを一切介さず手書きした
> App Specが、分離されたPostgresスキーマにコンパイルされ、実際のKeycloakログイン（Authorization Code +
> PKCE、BFFパターン）で保護されたブラウザアプリとして動作します——開発用の仮認証ではありません。HTMLフォーム
> からレコードを登録し、一覧で確認し、検索でき、ログインユーザーごとに行レベルのアクセス制御が効きます。
> `pnpm dev:sample` で実際に起動して確認できます（下記）。AI Builder・Security Gate はまだ未着手です。
> 「今、実際に動くもの」の詳細は [ROADMAP.md](./ROADMAP.md) を参照してください。

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
```

Postgres系の統合テストは `127.0.0.1:5432` の Postgres スーパーユーザーに接続します（`brew install
postgresql@14` を想定）。それぞれ使い捨てのデータベースとロールを作成し、成功・失敗にかかわらず
`afterAll` で必ず削除します。Keycloak系の統合テストはDockerが必要で、使い捨てのKeycloakコンテナを
自前で起動・削除します。4つとも CI（`.github/workflows/ci.yml` の `integration` ジョブ）に組み込み済みです。

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

`templates/` に3つのサンプル Spec（営業日報・経費申請・会議室予約）があります。

## ドキュメント

全体設計・セキュリティ設計・リポジトリ運営・実装計画の原本は [`docs/design/`](./docs/design/) にあります。
アーキテクチャ上の個別の意思決定（なぜこの設計にしたか）は [`docs/adr/`](./docs/adr/) に ADR として記録しています。

## ライセンス

Apache-2.0。詳細は [`LICENSE`](./LICENSE) を参照してください。
