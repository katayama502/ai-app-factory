# AI App Factory — Community Edition

**非エンジニアが AI で社内業務アプリを作れるようにする。ただし AI に「本番で動くコード」を書かせない。**

[English README](./README.md) · [設計書](./docs/design/) · [ロードマップ](./ROADMAP.md) · [セキュリティ設計](./docs/design/02_SECURITY_セキュリティ設計書.md)

> **現在の状態: M1（Walking Skeleton）のDoDを達成。** AIを一切介さず手書きしたApp Specが、分離された
> Postgresスキーマにコンパイルされ、実際にブラウザから使えるアプリとして動作します——HTMLフォームから
> レコードを登録し、一覧で確認し、検索でき、ログインユーザーごとに行レベルのアクセス制御が効きます。
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
pnpm --filter @aiappfactory/runtime test:integration
```

3つの統合テストはいずれも `127.0.0.1:5432` の Postgres スーパーユーザーに接続します（`brew install
postgresql@14` を想定）。それぞれ使い捨てのデータベースとロールを作成し、成功・失敗にかかわらず
`afterAll` で必ず削除します。CIにはまだ組み込んでいません（`ROADMAP.md` 参照）。

実際にブラウザで触ってみるには：

```bash
pnpm dev:sample
# → http://127.0.0.1:4200/apps/sales-daily-report/pages/0
# ログイン: alice/alice-dev, bob/bob-dev（sales_member）, carol/carol-dev（sales_manager）
```

これはローカルの永続DB（`aiaf_dev`）に営業日報テンプレートを展開する手動確認用スクリプト
（`scripts/dev-server.ts`）で、製品本体には含まれません。

`templates/` に3つのサンプル Spec（営業日報・経費申請・会議室予約）があります。

## ドキュメント

全体設計・セキュリティ設計・リポジトリ運営・実装計画の原本は [`docs/design/`](./docs/design/) にあります。
アーキテクチャ上の個別の意思決定（なぜこの設計にしたか）は [`docs/adr/`](./docs/adr/) に ADR として記録しています。

## ライセンス

Apache-2.0。詳細は [`LICENSE`](./LICENSE) を参照してください。
