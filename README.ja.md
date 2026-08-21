# AI App Factory — Community Edition

**非エンジニアが AI で社内業務アプリを作れるようにする。ただし AI に「本番で動くコード」を書かせない。**

[English README](./README.md) · [設計書](./docs/design/) · [ロードマップ](./ROADMAP.md) · [セキュリティ設計](./docs/design/02_SECURITY_セキュリティ設計書.md)

> **現在の状態: 設計・雛形段階（M1着手前）。** `packages/app-spec`（Spec スキーマとバリデータ）はテスト付きで動作します。
> AI Builder・App Runtime・Security Gate は設計段階であり、まだ動くコードではありません。
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

## 動かしてみる（現時点で動く唯一の部分）

```bash
pnpm install
pnpm --filter @aiappfactory/app-spec test    # 18テスト（templates/ 配下の3サンプルSpec含む）
```

`templates/` に3つのサンプル Spec（営業日報・経費申請・会議室予約）があります。

## ドキュメント

全体設計・セキュリティ設計・リポジトリ運営・実装計画の原本は [`docs/design/`](./docs/design/) にあります。
アーキテクチャ上の個別の意思決定（なぜこの設計にしたか）は [`docs/adr/`](./docs/adr/) に ADR として記録しています。

## ライセンス

Apache-2.0。詳細は [`LICENSE`](./LICENSE) を参照してください。
