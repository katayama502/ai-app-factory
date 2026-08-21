# AI App Factory — Community Edition

**非エンジニアが AI で社内業務アプリを作れるようにする。ただし AI に「本番で動くコード」を書かせない。**

[English README](./README.md) · [設計書](./docs/design/) · [ロードマップ](./ROADMAP.md) · [セキュリティ設計](./docs/design/02_SECURITY_セキュリティ設計書.md)

> **現在の状態: M1（Walking Skeleton）着手中。** `packages/app-spec`（Spec スキーマ）・`packages/expr`
> （制限式パーサ）・`packages/spec-compiler`（Spec→PostgreSQL DDL/RLS）はテスト付きで動作し、
> spec-compiler は実際の Postgres に対する統合テストで RLS の分離が機能することまで検証済みです。
> AI Builder・App Runtime・Security Gate はまだ動くコードではありません。
> 「今、実際に動くもの」は [ROADMAP.md](./ROADMAP.md) を参照してください。

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
```

統合テストは `127.0.0.1:5432` の Postgres スーパーユーザーに接続します（`brew install postgresql@14`
を想定）。使い捨てのデータベースとロールを作成し、成功・失敗にかかわらず `afterAll` で必ず削除します。
CIにはまだ組み込んでいません（`ROADMAP.md` 参照）。

`templates/` に3つのサンプル Spec（営業日報・経費申請・会議室予約）があります。

## ドキュメント

全体設計・セキュリティ設計・リポジトリ運営・実装計画の原本は [`docs/design/`](./docs/design/) にあります。
アーキテクチャ上の個別の意思決定（なぜこの設計にしたか）は [`docs/adr/`](./docs/adr/) に ADR として記録しています。

## ライセンス

Apache-2.0。詳細は [`LICENSE`](./LICENSE) を参照してください。
