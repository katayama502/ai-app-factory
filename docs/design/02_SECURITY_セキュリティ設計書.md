# AI App Factory CE — セキュリティ設計書

**Version:** 0.1
**Date:** 2026-08-21
**準拠フレームワーク:** OWASP Top 10:2025 / OWASP Top 10 for LLM Applications 2025 / NIST SSDF (SP 800-218) / SLSA

---

## 1. セキュリティ設計の前提

このプロダクトは通常のアプリより難しい立場にある。

> **「プログラミングを知らない人が、AI に作らせたコードを、社内本番環境に自動デプロイする」**

つまり **人間のコードレビューが存在しない**。従来の SDLC が暗黙に前提にしていた最後の砦がない。したがってセキュリティは「後段のスキャン」ではなく **アーキテクチャで担保する** しかない。

### 設計原則

| 原則 | 意味 |
|---|---|
| **P1. Structural over Detective** | 「検出して直す」より「そもそも書けない」を優先する（→ App Spec モデル） |
| **P2. Fail Closed** | 判定できないものは通さない。スキャナ落ち = RED |
| **P3. AI Never Approves** | AI はリスクを **上げる** ことしかできない。GREEN の根拠に AI 判定を使わない |
| **P4. Defense in Depth** | SDK の認可 / DB の RLS / ネットワーク遮断 の3層で同じことを守る |
| **P5. Everything is Audited** | 誰が何をしたかを追記専用ログで残す。ログ改竄も検出可能に |
| **P6. Least Privilege by Default** | すべての既定値が「拒否」。許可は宣言で明示 |
| **P7. Secure Defaults, No Footguns** | 安全でない設定は「上級者向け」ではなく「管理者の明示的同意＋監査」を要求 |

---

## 2. 信頼境界とアセット

### 2.1 信頼境界図

```
        [ Internet ]                     信頼度: なし
              │
      ── TB1 ────────────────────────────────────────
              │
        [ Traefik / TLS ]
              │
      ┌───────┴───────────────────────────┐
      │                                   │
[ Console (Control Plane) ]        [ App Plane ]        信頼度: 低（AI生成物）
      │  信頼度: 高                        │
      │                            ── TB2 ──  Company SDK Gateway (唯一の穴)
      │                                   │
      └───────┬───────────────────────────┘
              │
      ── TB3 ────────────────────────────────────────
              │
      [ Platform: PostgreSQL / Keycloak / Gitea / Registry ]   信頼度: 最高
              │
      ── TB4 ────────────────────────────────────────
              │
      [ External LLM APIs ]              信頼度: なし（データ流出先）
```

| 境界 | 守るもの | 手段 |
|---|---|---|
| **TB1** | 外部 → 全体 | TLS、OIDC 認証、レート制限、CSRF、CSP、セキュリティヘッダ |
| **TB2** | 生成アプリ → Control Plane | mTLS、アプリ固有短命 JWT、SDK 以外の経路を物理的に遮断、全呼び出しの認可＋監査 |
| **TB2'** | アプリ ↔ アプリ（**ブラウザ内**） | **独立オリジン**（`<slug>.apps.<domain>`）、`__Host-` Cookie、per-app CSP、COOP/CORP。※ ネットワーク遮断だけでは同一オリジン攻撃を防げない |
| **TB3** | アプリ → Platform | 専用 DB ロール＋スキーマ＋RLS。**DB 資格情報はアプリに渡さず SDK Gateway のみが保持** |
| **TB4** | 社内データ → 外部 LLM | AI Gateway のデータ分類ポリシー、PII 検出、egress allowlist |

### 2.2 保護対象アセット

| アセット | 分類 | 主な脅威 |
|---|---|---|
| 社員の業務データ（アプリのレコード） | INTERNAL〜PERSONAL | 越権閲覧、外部 LLM への流出 |
| 認証情報（Keycloak DB、トークン） | HIGHLY_CONFIDENTIAL | 認証バイパス、権限昇格 |
| 外部 AI の API キー | HIGHLY_CONFIDENTIAL | 漏洩による課金被害・データ流出 |
| App Spec / 生成コード | INTERNAL | 改竄によるバックドア混入 |
| 監査ログ | CONFIDENTIAL | 改竄・削除による証跡消去 |
| ホスト（Docker socket 等） | — | コンテナブレイクアウト → 全社データ |

---

## 3. 脅威モデル（STRIDE ＋ AI 固有）

### 3.1 プラットフォーム脅威

| ID | 脅威 | STRIDE | 影響 | 対策 |
|---|---|---|---|---|
| T-01 | 生成アプリからのコンテナブレイクアウト | E | 致命 | non-root / read-only rootfs / cap_drop ALL / seccomp / no-new-privileges / gVisor / **Docker socket を絶対にマウントしない** |
| T-02 | アプリ A がアプリ B のデータを読む | I | 高 | スキーマ分離＋専用ロール＋RLS＋SDK のアプリID固定 |
| T-02b | **ブラウザ内でアプリ A の JS がアプリ B の DOM/Storage/Cookie に到達** | I | 高 | **アプリごとに独立オリジン**、`__Host-` Cookie、per-app CSP、`COOP: same-origin` |
| T-03 | 一般社員が Builder/Admin API を直接叩く | E | 高 | Keycloak ロールによる API 単位の認可、BFF パターン、IDOR テスト必須 |
| T-04 | 悪意ある App Spec による SSRF | I | 中 | `network.egress` allowlist ＋ Egress Proxy。IP リテラル・内部レンジ（RFC1918/169.254/::1）を Spec 検証で拒否 |
| T-05 | 承認フローの迂回（RED を無理やり公開） | T | 高 | 公開 API は Risk Engine の署名付き判定を必須とし、判定なしの publish を拒否 |
| T-06 | 監査ログの改竄 | R | 中 | 追記専用テーブル、行ハッシュチェーン、日次で外部（ファイル/S3）へアンカリング、DB ロールに DELETE/UPDATE 権限なし |
| T-07 | Supply chain（依存パッケージのバックドア） | T | 高 | lockfile 固定、Trivy + OSV、SBOM 生成、cosign 署名、Renovate による更新監視（OWASP A03:2025） |
| T-08 | Setup Wizard の乗っ取り（初期化前の無防備状態） | S | 致命 | 初回起動時にワンタイムセットアップトークンをコンソール出力し、その提示を必須にする。localhost 以外からのセットアップは既定で拒否 |
| T-09 | バックアップからの情報漏洩 | I | 高 | バックアップは既定で暗号化（age/AES-256）。鍵はセットアップ時に生成し管理者に一度だけ提示 |
| T-10 | デプロイ時のリソース枯渇（暴走アプリ） | D | 中 | cgroups 制限（CPU/Mem/PID）、同時アプリ数上限、ヘルスチェックによる隔離 |

### 3.2 AI 固有脅威（OWASP LLM Top 10 2025 対応）

| ID | 脅威 | LLM Top10 | 対策 |
|---|---|---|---|
| A-01 | ユーザーのプロンプトで Spec に危険な宣言を仕込ませる | LLM01 Prompt Injection | Spec は **必ずスキーマ＋ポリシー検証を通る**。LLM の出力を信用しない（生成物は検証対象であって指示ではない） |
| A-02 | **スキャナ出力経由のインジェクション**（Auto Fix ループ） | LLM01 | スキャナの findings をそのまま LLM に渡すと、攻撃者が仕込んだ文字列が「指示」になる。→ findings は **構造化フィールドのみ**渡し、自由文はエスケープ＋長さ制限。修復後の Spec は必ず再検証 |
| A-03 | 社内機密が外部 LLM に送信される | LLM02 Sensitive Information Disclosure | AI Gateway のデータ分類ルーティング。既定で外部 LLM は PUBLIC のみ。PII 検出でブロック |
| A-04 | ローカルモデル/重みの改竄 | LLM03 Supply Chain | モデルは digest 固定で取得。取得元を allowlist 化 |
| A-05 | RAG に投入した社内文書経由のインジェクション | LLM08 Vector & Embedding Weaknesses | 取り込み時にサニタイズ、RAG コンテキストは `<untrusted_context>` で明示区切り、RAG 結果からツール呼び出しを起動しない |
| A-06 | 生成コードに脆弱性が入る（T3） | LLM05 Improper Output Handling | T3 は全 Gate ＋ 人間承認必須。既定 OFF |
| A-07 | 過剰なエージェント権限 | LLM06 Excessive Agency | AI Orchestrator にはデプロイ権限を与えない。デプロイは常に人間の明示操作 |
| A-08 | LLM 無制限消費（コスト攻撃） | LLM10 Unbounded Consumption | ユーザー/アプリ/組織別レート制限＋トークン上限＋月次予算アラート |
| A-09 | AI 判定への過信 | LLM09 Misinformation | **P3: AI Never Approves**。AI レビューは finding を追加するだけ |
| A-10 | Builder のシステムプロンプト漏洩 → Spec 生成制約の回避 | LLM07 System Prompt Leakage | システムプロンプトに秘密を置かない（制約は Gate 0/1 の検証側で強制）。出力フィルタでプロンプト再現を抑止 |
| A-11 | テンプレート／RAG 文書への汚染 | LLM04 Data & Model Poisoning | テンプレートは PR レビュー＋CI の Spec 検証必須。RAG 取り込み元を allowlist 化し取り込み時に監査記録 |

---

## 4. Security Gate — 段階的ゲート設計

### 4.1 全体フロー

```
Publish 要求
   │
   ├─ Gate 0  Spec Validation      … JSON Schema / 参照整合性 / 禁止宣言
   ├─ Gate 1  Policy Validation    … OPA/Rego（組織ポリシー・分類ルール・egress）
   ├─ Gate 2  Secret Scan          … gitleaks（Spec / コード / 設定）
   ├─ Gate 3  Dependency Scan      … Trivy + OSV（T3 のみ）
   ├─ Gate 4  SAST                 … Opengrep（T3 のみ）
   ├─ Gate 5  Container Scan       … Trivy image（T3 のみ）
   ├─ Gate 6  Data Classification  … Spec 上の分類と実フィールド名の突合（PII 推定）
   ├─ Gate 7  AI Review            … AI による追加リスク指摘（加点のみ）
   ├─ Gate 8  Dynamic Check        … Sandbox 起動 + 実 egress 観測
   └─ Gate 9  Acceptance Test      … Spec から機械生成した受け入れテストを実行
   │
   ▼
Risk Engine（決定論的集約）→ GREEN / YELLOW / RED
```

**T1/T2 では Gate 3/4/5 が不要**（コードが存在しないため）。

| Tier | 実行される Gate | 所要時間目安 |
|---|---|---|
| T1 / T2 | 0, 1, 2, 6, 7, 8(簡易), 9 | **10〜25秒** |
| T3 | 0〜9（全部） | 3〜10分 |

これが「T1/T2 なら30秒で公開」を可能にしている。

### 4.2 各ゲートの詳細

#### Gate 0 — Spec Validation
- JSON Schema（`@aiappfactory/app-spec`）による構造検証
- 参照整合性（存在しない entity/field/role の参照）
- **禁止宣言の検出**: 内部IPへの egress、`system: true` フィールドのユーザー定義、予約語の使用
- 破壊的マイグレーション（列削除・型変更）の検出 → 必ず YELLOW 以上

#### Gate 1 — Policy Validation（OPA/Rego）
組織が Rego でポリシーを書ける。既定ポリシー例：

```rego
package factory.policy

# 個人情報を扱うアプリは外部AIを使えない
deny[msg] {
  input.spec.data.entities[_].classification == "PERSONAL"
  input.spec.ai.features[_].policy.allowExternal == true
  msg := "個人情報を扱うアプリで外部AIは使用できません"
}

# egress は必ず allowlist に限定
deny[msg] {
  host := input.spec.network.egress[_]
  not data.org.approved_hosts[host]
  msg := sprintf("未承認の通信先です: %v", [host])
}

# HIGHLY_CONFIDENTIAL を含むアプリは必ず承認必須
require_approval[msg] {
  input.spec.data.entities[_].classification == "HIGHLY_CONFIDENTIAL"
  msg := "最高機密データを扱うため管理者承認が必要です"
}
```

#### Gate 2 — Secret Scan（gitleaks）
- 検出対象: API Key / Password / Token / Private Key / 接続文字列（構想29項）
- **検出＝即 RED**（例外なし）。誤検知は allowlist ファイルで管理者のみが登録可
- Spec のリテラル値も対象（ユーザーが Builder に API キーを貼るのは日常茶飯事）

#### Gate 3〜5 — 依存 / SAST / コンテナ（T3 のみ）
- Trivy: `vuln,secret,misconfig,license` を有効化
- Opengrep: 既定ルールセット ＋ Factory 独自ルール（SDK 迂回の検出）
- **すべて SARIF 形式で出力し、findings テーブルに正規化**
- Critical/High = RED、Medium = YELLOW、Low = 情報

#### Gate 6 — Data Classification 検証
フィールド名・型から PII らしさを推定し、宣言分類との齟齬を検出。

| パターン | 推定 |
|---|---|
| `email`, `メール`, `mail_address` | PERSONAL |
| `phone`, `tel`, `電話` | PERSONAL |
| `mynumber`, `マイナンバー`, `個人番号` | HIGHLY_CONFIDENTIAL |
| `salary`, `給与`, `年収` | HIGHLY_CONFIDENTIAL |
| `address`, `住所` | PERSONAL |
| `credit_card`, `card_number` | HIGHLY_CONFIDENTIAL（＋そもそも保存を禁止） |

宣言が推定より低い → YELLOW（承認画面で「このアプリは個人情報を扱う可能性があります」と提示）

#### Gate 7 — AI Review
```
入力: App Spec（＋T3ならコード差分）、既存 findings の構造化サマリ
出力: [{ severity, category, message, evidence }] のみ
制約: "GREEN" "PASS" 等の判定を出させない。出しても無視する
```
AI の指摘は severity 上限 **MEDIUM** に丸める（AI 単独で RED にはしない＝誤検知で業務が止まるのを防ぐ）。ただし **AI が指摘した項目は必ず承認画面に表示** する。

#### Gate 8 — Dynamic Check

T1/T2 と T3 で深さを変える（T1/T2 はアプリ固有コードが存在しないため、長時間観測の費用対効果が低い）。

| Tier | 内容 | 時間 |
|---|---|---|
| T1 / T2 | 起動ヘルスチェック ＋ Egress Proxy の deny ログ即時確認 | 5〜10秒 |
| T3 | Sandbox で 60秒間の実挙動観測（syscall / egress / ファイルアクセス） | 60秒 |

- 宣言されていない egress の試行 → **RED**（Spec と実挙動の乖離＝改竄の兆候）
- 起動失敗・クラッシュ → 公開ブロック

#### Gate 9 — Acceptance Test（自動受け入れテスト）★

構想の「自動テスト」に相当する。**非エンジニアが作ったアプリが「動くか」を誰も検証しないまま公開されるのを防ぐ。**

Spec からテストケースを機械生成し、Sandbox で実行する。

| 生成されるテスト | 内容 |
|---|---|
| CRUD 往復 | 各 entity について create → read → update → delete が成功し、値が保存される |
| バリデーション | `required` / `maxLength` / `min` に違反する入力が正しく拒否される |
| **認可マトリクス** | `access.roles` の全ロール × 全操作を実行し、`grants` と結果が完全一致することを検証（★ 越権の主要な検出手段） |
| 行レベル認可 | 別ユーザー・別部門のレコードが `read:own` / `read:dept` で見えないことを検証 |
| automations | トリガー条件を満たすデータを投入し、アクションが発火することを検証 |
| import | サンプル CSV を投入し、型検証とエラー行返却が動くことを検証 |

- 認可マトリクスの不一致 → **RED**（セキュリティ欠陥）
- CRUD / バリデーション / automation の失敗 → **YELLOW**（品質。「このアプリは一部の機能が動作しません」と表示して承認を要求）
- 結果は「テスト 24件中 24件 成功」として Builder 画面に表示（構想24項の `✓ Test PASS`）

### 4.3 Risk Engine

```
score = Σ (severity_weight × confidence × gate_weight)

severity_weight: CRITICAL=100, HIGH=40, MEDIUM=10, LOW=2
gate_weight:     Gate0-2 = 1.5（構造的・確実）
                 Gate3-6 = 1.0
                 Gate7   = 0.5（AI・不確実）

判定（評価順）:
  1. hard-block ルールに該当           → RED
  2. require-approval ルールに該当     → YELLOW（スコアに関わらず）
  3. score >= 100                      → RED
  4. 20 <= score < 100                 → YELLOW
  5. それ以外（全 Gate 正常完了）      → GREEN
```

**hard-block ルール（無条件 RED）**
- Secret 検出
- 内部ネットワークへの egress 宣言
- 宣言外の egress 実行（Gate 8）
- Gate 9 の認可マトリクス不一致
- Critical 脆弱性（CVSS ≥ 9.0）で修正版が存在するもの
- スキャナのクラッシュ / タイムアウト（**P2 Fail Closed**）
- Spec の署名検証失敗

**require-approval ルール（無条件 YELLOW）** — スコアに載せると閾値に届かず発火しないため、独立したルールとして Rego に明示列挙する。

- 破壊的マイグレーション（列削除・型変更・NOT NULL 追加）を含む（Gate 0）
- 宣言分類が推定分類より低い（Gate 6）
- `HIGHLY_CONFIDENTIAL` / `PERSONAL` を扱う（Gate 1）
- `network.egress` に1件以上のホストが宣言されている（Gate 1）
- Gate 9 の機能テスト失敗（品質）
- T3 のアプリである

判定結果は **Ed25519 で署名** し、Deploy Engine は署名を検証してからのみデプロイする（T-05 対策）。

---

## 5. Auto Fix ループ

### 5.1 フロー

```
Scan → FAIL
  │
  ├─ 修復可能性の判定（rule_id ごとに fixable フラグ）
  │     fixable でない → 即エスカレーション
  ↓
AI Fix（findings の構造化データのみを入力）
  ↓
Spec 再検証（Gate 0/1）… ここで落ちたら即リトライ扱い
  ↓
Full Rescan
  ↓
PASS → 公開へ / FAIL → attempt++ 
```

### 5.2 停止条件（構想39項の強化）

| 条件 | 動作 |
|---|---|
| 修復成功 | 公開フローへ |
| **attempt ≥ 5** | 管理者エスカレーション |
| **同一 rule_id が2回連続で解消しない** | 即エスカレーション（無駄な試行を止める） |
| **findings 総数が増加した** | 即エスカレーション（悪化している） |
| **新たに hard-block が発生した** | 即中断・RED 固定 |
| 累計トークンが上限超過 | 中断 |

### 5.3 エスカレーション画面

非エンジニアに「SQL Injection Risk」と表示しても意味がない。二段構えにする。

```
─────────────────────────────────────
⚠ このアプリは今のままでは公開できません

AI が5回修正を試みましたが、
「顧客データを外部サービスに送る設定」が
社内ルールに反しています。

▸ 管理者に相談する
▸ この機能を外して公開する      ← AI が該当機能を除いた Spec を提示
▸ 詳細を見る（技術情報）        ← Developer Mode 相当の情報
─────────────────────────────────────
```

**「この機能を外して公開する」を必ず用意する。** 行き止まりを作らないことが非エンジニア向けプロダクトの生命線。

---

## 6. 認証・認可設計

### 6.1 認証（Keycloak）

- 単一 realm `factory`、組織 = realm 内の group 階層
- Console / App Runtime / 各 T3 アプリは別々の OIDC client
- **Authorization Code + PKCE**。implicit flow は使わない
- トークン: access token 5分 / refresh token 8時間（業務時間想定）/ refresh rotation 有効
- ブラウザ保持は httpOnly + Secure + SameSite=Lax cookie（BFF パターン。SPA に生トークンを渡さない）
- 既定で MFA（TOTP）を Admin ロールに強制
- パスワードポリシー: NIST SP 800-63B 準拠（長さ重視、定期変更を強制しない、漏洩パスワード辞書チェック）

### 6.2 認可（3層）

| 層 | 実装 | 守るもの |
|---|---|---|
| **API 層** | Fastify preHandler + Keycloak role claim | エンドポイント単位の権限 |
| **SDK 層** | `company.database` が ctx から自動で条件を注入 | 行レベル・列レベル |
| **DB 層** | PostgreSQL RLS（Spec から自動生成） | 上2層のバグに対する最終防衛線 |

**IDOR 対策** — すべてのリソース ID は UUIDv7。ID を知っているだけでアクセスできないよう、全 API で所有権チェックを必須にする。この検証は E2E テストの必須項目とする（OWASP A01:2025）。

### 6.3 Company SDK トークン

- アプリコンテナ起動時に **アプリ固有の短命 JWT（15分・自動更新）** を注入
- claim: `app_id`, `tier`, `capabilities[]`, `allowed_entities[]`
- SDK Gateway は JWT の `app_id` と実際のアクセス先スキーマの一致を毎回検証
- アプリは自分の JWT を書き換えられない（署名検証）

---

## 7. シークレット管理

| 対象 | 保管 | 備考 |
|---|---|---|
| 外部 AI の API キー | `encrypted_secrets` に **envelope 暗号化**（AES-256-GCM、KEK はファイル or OS keychain） | **アプリコンテナには絶対に渡さない**。AI Gateway だけが復号する |
| **アプリ用 DB 資格情報** | `encrypted_secrets`。**SDK Gateway だけが復号・保持** | ⚠ **アプリコンテナには一切渡さない**（環境変数注入もしない）。T1〜T3 すべて、DB 接続を張るのは SDK Gateway のみ。これが崩れると S-02 が成立しない |
| Risk 判定の署名鍵（Ed25519） | `encrypted_secrets`。Risk Engine のみ保持 | 公開鍵を Deploy Engine が検証に使用。定期ローテーション |
| Keycloak client secret | 同上 | |
| バックアップ暗号鍵 | セットアップ時生成、**管理者に一度だけ提示** | 復旧不能リスクを明示 |
| 監査ログのアンカ鍵 | 同上 | |
| JWT 署名鍵 | 起動時生成、定期ローテーション | |

**Docker socket は絶対にマウントしない。** Deploy Engine が必要とする場合は、限定コマンドのみを受け付ける socket proxy（`tecnativa/docker-socket-proxy` 相当）を自前実装して間に挟む。

---

## 8. 監査ログ

### 8.1 記録対象（構想41項）

```
who    : actor_id（ユーザー or system）
when   : created_at (UTC, ms)
what   : action（app.create / app.publish / scan.complete / approval.decide /
                 ai.request / user.role_change / settings.update / backup.restore …）
target : target_type + target_id
detail : 差分（Spec の JSON Patch など）
result : success / failure
context: ip, user_agent, session_id
```

### 8.2 改竄検出

```
hash_n = SHA-256( hash_{n-1} || canonical_json(event_n) )
```

- `audit_events` テーブルの DB ロールに UPDATE/DELETE 権限を与えない
- 日次で最新 hash をファイル（と設定時は外部ストレージ）へアンカリング
- Admin Console に「監査ログの整合性を検証」ボタン（チェーン全走査）

### 8.3 保持と閲覧

- 既定保持期間 3年（設定可）
- Admin のみ閲覧可。**監査ログの閲覧自体も監査対象**
- CSV / JSON エクスポート（署名付き）

---

## 9. セキュアな既定設定（Secure Defaults）

セットアップ直後の状態が最も安全であること。

| 設定 | 既定 |
|---|---|
| 公開範囲（構想 STEP 2） | **このPCだけ**（`127.0.0.1` バインド）。社内LAN以上を選ぶと警告と確認 |
| TLS | 有効。社内CA（ルートCA配布手順とダウンロードを Wizard が出力）、または DNS-01 チャレンジによる Let's Encrypt。**`.local` は使わない**（RFC 6762 予約 TLD のため公的 CA が発行不可） |
| アプリのホスト名 | アプリごとに独立オリジン `<slug>.apps.<domain>` |
| 外部 AI | **無効** |
| 個人情報の外部送信 | **ブロック** |
| プロンプト本文の保存 | **無効** |
| T3（コード生成） | **無効** |
| Developer Mode | **無効** |
| 匿名テレメトリ | **無効**（opt-in。OSS として重要） |
| 自動アップデート | 通知のみ（自動適用しない） |
| App の egress | **すべて拒否** |
| 新規ユーザーの既定ロール | Employee |
| 管理者 MFA | **必須** |

---

## 10. インストールと初回セットアップのセキュリティ

構想 4〜7 項の Wizard は、**初期化前の無防備な時間帯** が最大の脆弱点（T-08）。

```
1. 起動時、コンソールにワンタイムトークンを出力
   > Setup URL: https://localhost:8443/setup?token=xxxxxxxx
     このURLを開いてセットアップを完了してください（有効期限15分）

2. トークンなしのアクセスは 403
3. 既定では 127.0.0.1 からのみ受付（--allow-remote-setup で明示的に緩和）
4. 管理者アカウント作成完了と同時にセットアップエンドポイントを永久無効化
5. 生成した秘密（バックアップ鍵など）を一度だけ表示し、
   「保存しました」のチェックを要求
```

Docker Compose 配布時は、初回起動で `.env` に強いランダム値を自動生成する（**弱いデフォルトパスワードを絶対に置かない**。OWASP A02:2025 Security Misconfiguration）。

---

## 11. SECURITY.md と脆弱性対応方針（OSS 運営）

```markdown
# Security Policy

## Supported Versions
最新のマイナーバージョンと、その1つ前をサポートします。

## Reporting a Vulnerability
GitHub Security Advisories（Private vulnerability reporting）を使用してください。
公開 Issue には報告しないでください。

- 初回応答: 3営業日以内
- トリアージ完了: 10営業日以内
- 修正リリース目標: Critical 14日 / High 30日 / Medium 90日
- Coordinated Disclosure: 修正リリース後7日で Advisory を公開

## Scope
対象: このリポジトリのコード、公式コンテナイメージ、公式インストーラ
対象外: 利用者が生成したアプリのロジック、サードパーティ製品（Keycloak 等）の脆弱性
        （ただしバンドルバージョンの更新は責任範囲）

## Safe Harbor
善意のセキュリティ調査に対して法的措置を取りません。
```

### 継続的セキュリティ（CI）

| チェック | ツール | タイミング |
|---|---|---|
| Secret scan | gitleaks | 全 PR + push |
| SAST | Opengrep + CodeQL | 全 PR |
| 依存脆弱性 | Trivy + Dependabot/Renovate | 全 PR + 日次 |
| コンテナ scan | Trivy | イメージビルド時 |
| SBOM 生成 | Syft (SPDX/CycloneDX) | リリース時 |
| イメージ署名 | cosign (keyless / OIDC) | リリース時 |
| ライセンス検査 | Trivy license / license-checker | 全 PR |
| E2E セキュリティテスト | Playwright（認可・IDOR・分離の検証） | 全 PR |

**リリース成果物には SBOM と署名を必ず添付する。** 企業が社内導入を検討するとき、これがないと稟議を通せない（OWASP A03:2025 Software Supply Chain Failures）。

---

## 12. セキュリティテストの必須項目

v1.0 リリース条件として、以下の自動テストが全て通ること。

| # | テスト | 検証内容 |
|---|---|---|
| S-01 | クロステナント読み取り | アプリ A の SDK トークンでアプリ B のスキーマにアクセス → 拒否 |
| S-02 | RLS バイパス | SDK を迂回して直接 SQL 発行を試行 → 接続不可 |
| S-03 | Egress 遮断 | 宣言外ホストへの接続 → 失敗 |
| S-04 | 内部到達 | アプリから Control Plane / Keycloak / DB への直接接続 → 失敗 |
| S-05 | IDOR | 他ユーザーのレコード ID を指定 → 404（403 ではなく存在も隠す） |
| S-06 | 権限昇格 | Employee ロールで Admin API を呼ぶ → 403 |
| S-07 | Secret 検出 | ダミー API キーを含む Spec を publish → RED |
| S-08 | Fail-closed | スキャナを意図的に落として publish → RED |
| S-09 | 署名検証 | Risk 判定の署名を改竄して deploy → 拒否 |
| S-10 | 監査チェーン | 監査ログを直接改竄 → 整合性検証で検出 |
| S-11 | Setup 保護 | トークンなしで /setup にアクセス → 403 |
| S-12 | プロンプトインジェクション | 悪意ある指示を含む要求 → Spec 検証で遮断されることを確認 |
| S-13 | 分類ルーティング | PERSONAL データで外部 LLM 呼び出し → ブロック |
| S-14 | コンテナ強化 | 生成アプリ内で root 昇格・ファイル書き込みを試行 → 失敗 |
| S-15 | **Origin 分離** | アプリ A のページから `document.cookie` / `localStorage` / `window.open` でアプリ B・Console に到達 → 全て失敗 |
| S-16 | **DB 資格情報の非配布** | アプリコンテナの環境変数・ファイルシステムに DB 接続文字列が存在しない |
| S-17 | **RLS の主体伝播** | 同一プール接続で連続する2ユーザーのリクエスト → 前ユーザーの `SET LOCAL` が漏れない |
| S-18 | **認可マトリクス** | Gate 9 が `access.roles` と実挙動の不一致を検出できる（意図的に壊した Spec で検証） |

---

## Sources

- [OWASP Top 10:2025](https://owasp.org/Top10/2025/)
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/)
- [OWASP Top 10 for Large Language Model Applications (project)](https://owasp.org/www-project-top-10-for-large-language-model-applications/)
- [How to sandbox AI agents in 2026: MicroVMs, gVisor & isolation strategies](https://northflank.com/blog/how-to-sandbox-ai-agents)
- [Opengrep — open-source code security engine](https://www.opengrep.dev/)
