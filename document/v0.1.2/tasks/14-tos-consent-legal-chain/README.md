# Task 14: ToS 同意フロー + サブライセンス法的連鎖の実装

## 位置付け

統合ユニット (production-bound)。 SPECS_JA §4.4 が定義する撮影者 → delegate → License NFT 保有者の法的連鎖を、 オンチェーン側 (License NFT Anchor program、 Task 06) が既に成立させている前提で、 オフチェーン側の欠落ピースを埋める。

具体的には、 ToS のホスティング、 同意 UI、 同意ログ、 ライセンス条文 JSON のホスティングを揃える。 これが揃って初めて、 SPECS §4.4.6 で定義された第三者検証チェーンが端から端まで成立する。

設計の法的根拠と残る検討事項は `document/v0.1.2/legal-rationale.md` を参照のこと。

## 進捗サマリ

既に動いていて、 本 task のスコープ外であるもの:

- ✅ Task 06: License NFT Anchor program が監査グレードのテストをパス、 devnet 稼働。 分配比率はオンチェーン Config の `staker_basis_points` / `delegate_basis_points` で記録、 `update_config` で調整可、 e2e で BPS 変更動作確認済。
- ✅ Task 07: Co-sign API → `POST /api/v1/license/issue` 公開、 partial-signed tx 返却、 クライアントからの broadcast 確認済。
- ✅ SPECS §5.5.3 Layer 1 binding: スマートコントラクトが `?root_mint=<root_asset_id>` を URI に append、 leaf hash に焼き込み。
- ✅ SPECS §5.5.3 Layer 2 binding: ライセンス条文 URL に hash を含める設計が仕様として確定。
- ✅ SPECS §4.4 サブライセンス条文の雛形 (§4.4.4)。

## 本 task のスコープ (= 実装すべき成果物)

以下を一つずつ成果物として実装する。 各項目はそのまま「完了の定義」 のチェック対象となる。

- **ToS 文書のホスティング** — `https://rootlens.io/tos/v1.0.0/<tos_hash>.txt` を live にする。 sha256 が URL 内 hash と一致すること。
- **ToS 同意 UI** (`app/src/screens/TosConsentScreen.tsx` 新規) — アプリ初回起動時 + ToS 新 version 公開時に強制表示、 全文スクロール検出 + 明示的チェックボックス + 同意ボタン。 同意成立後にサーバへ POST、 ローカルに `(version, hash, consented_at)` をキャッシュ。 キャッシュ済 version と現行 version を比較してずれていれば再同意。
- **stake 画面の警告 UI** — 「stake 中に発行された License は撤回不能、 永続」 の警告を SPECS §4.2 stake 画面に組み込む (= SPECS §4.4.2 冒頭サマリ #4 と整合する撮影者保護の UX 要件)。
- **同意レコード受信 API** — `POST /api/v1/tos/consent` で `{ wallet_pubkey, tos_version, tos_hash, ip, user_agent }` を append-only に近い形で永続化 (Supabase の row insert、 update / delete を service role でガード)。
- **同意レコード公開 API** — `GET /api/v1/tos/consent?wallet=<pubkey>` を公開、 第三者検証用。 該当 wallet の同意 version 群を返す。 SPECS §4.4.6 step 3 で使用される。
- **現行 ToS API** — `GET /api/v1/tos/current` で現行 ToS version + hash + URL を返す (= アプリが起動時に叩く)。
- **ライセンス条文 JSON 4 種別の本実装** — `https://rootlens.io/licenses/{commercial-v1, training-only-v1, redistribution-v2, attribution-only-v1}/<terms_hash>.json` を live にする。 各 JSON は SPECS §5.5.3 スキーマに準拠、 sha256 計算済 hash を URL path に焼く。
- **4 種別すべてに必須の条文項目を組み込む**:
  - `governing_law: Singapore`、 `dispute_resolution: SIAC`。
  - `ledger_authoritative: false`、 `legal_authoritative: true`。
  - `sanctions_condition` (= OFAC / EU / UK / MAS SDN void ab initio)。
  - Licensor の表明保証、 補償 (Standard ティア: 1 件 5 万米ドル / 同一買い手 × 同一 Root NFT × 年合計 25 万米ドル、 Enterprise ティアは別途個別契約)、 補償対象外項目、 責任の限定、 買い手の通知義務、 二層契約構造の参照。 詳細は SPECS §5.5.3 / `legal-rationale.md` §3.2-§3.5。
- **カタログ (`web/config/cosign-catalog.yaml`) の本物化** — 現状の placeholder URL (wildcard `0000...000.json`) を、 上記 4 種別のホスト済 JSON URL に差し替える。 ただし価格決定権は撮影者側に留保する rate card 方式 (= 著作権等管理事業法 上の一任型 該当回避、 `legal-rationale.md` §2.6)。
- **EU CDSM 第 4 条 第 3 項 対応 (= 機械可読なオプトアウト信号)**:
  - Root NFT mint パイプラインに C2PA assertion `tdm-reservation: yes; tdm-policy: https://rootlens.io/license-required` を組み込む。
  - `https://rootlens.io/.well-known/tdm.json` でポリシーを公開する。
  - `robots.txt` + `llms.txt` で AI クローラに対してオプトアウトを通知する。
  - (= License NFT 発行は「払いました」 信号にすぎず、 「他はオプトアウト」 にはならないため、 並行で留保信号が必要。)
- **TP 側の `rootlens-license-v1` Extension 実装** (SPECS §3.4):
  - TP の Extension WASM として `rootlens-license-v1` を実装、 deploy。
  - 入力 `extension_inputs.rootlens-license-v1 = { tos_version, tos_hash }` を受け取り、 TEE 署名付き signed_json を出力。
  - 出力に `rootlens_binding` フィールド (= license_program_id、 license_collection_mint、 tos_url、 tos_hash、 binding_rule_url、 binding_rule_hash 等) を含める。
  - 専用の Extension Collection を TP 側で新規発行、 そのアドレスを license-nft program の `Config.root_nft_collection` に登録する。
- **binding rule 文書のホスティング** (`https://rootlens.io/extensions/rootlens-license-v1/<sha256>.json`) — SPECS §3.4.5 スキーマ準拠。 「この Extension cNFT が法的にどう機能するか」 を日本語と英語で平易に記述。 URL の sha256 で改ざん検知可能。
- **法務レビュー依頼**:
  - 利用規約 §4.4.4 雛形 (著作者人格権 不行使特約を含む) → 日本語 / 英語版確定 (日本の知的財産専門法律事務所)。
  - ライセンス条文 4 種別 → シンガポール法 / SIAC 準拠で確定 (シンガポール法律事務所)。
  - 著作権等管理事業法 一任型 該当性 → 日本法 適法性意見書を取得。
  - OFAC 条件付与文言 → 米国法律事務所のレビュー。
  - `rootlens-license-v1` binding rule 文書 → 日本の知的財産法律事務所 + シンガポール法律事務所。
  - チェックリスト全項目は `legal-rationale.md` §4 参照。

## 仕様参照

- SPECS_JA §4.4 (撮影者 → delegate → License 保有者の連鎖、 ToS 同意フロー、 サブライセンス条文)
- SPECS_JA §4.4.2 (ToS のバージョン管理と冒頭サマリ)
- SPECS_JA §4.4.3 (ToS 同意フロー — クリックスルー + サーバ側ログ)
- SPECS_JA §4.4.4 (サブライセンス条文の必須項目)
- SPECS_JA §4.4.6 (License NFT 発行済 case の完全連鎖検証)
- SPECS_JA §5.5.1 (一方的許諾モデル)
- SPECS_JA §5.5.3 (二層 binding とライセンス JSON スキーマ)
- `document/v0.1.2/legal-rationale.md` (設計判断の法的根拠と残る検討事項)
- Task 06 README「ライセンス条文テンプレート」 (4 種別、 Singapore / SIAC ドラフト)

## 別 task で扱うもの

### 明示的に範囲外 (= 本 task で実装しない、 別フェーズでも本 task に戻さない)

- 同意 UI の多言語化 (= 最低限 ja / en を本 task で扱い、 他言語は別フェーズの判断)。
- ToS の細部条項の business 判断 (= プロダクトマネジメント / 法務側で決める)。

### 後フェーズで別 task として切る

- ToS 違反検知 / 削除フロー (= 後続 task)。
- KYC 統合 + 内部系個人データ管理体制構築 (= 別 task、 `legal-rationale.md` §3.1 / §3.8(b) 対応。 第三者 KYC 事業者選定、 暗号化保管、 アクセス制限、 監査ログ、 保管期間規程、 削除要求対応フロー)。
- GDPR 削除要求対応フロー (= 別 task、 `legal-rationale.md` §3.8 対応)。
- OFAC SDN List との on-chain ウォレットアドレス自動 screening (= 別 task、 定期更新が必要)。

## 完了の定義

本 task が「完了」 と言えるための受入基準。 各項目は二者択一 (完了 / 未完了) で判定する。

- **tos-hosting**: `https://www.rootlens.io/tos/v1.0.0/<hash>.txt` が live、 sha256 一致。
- **license-terms-hosting**: 4 種別 (`commercial-v1`, `training-only-v1`, `redistribution-v2`, `attribution-only-v1`) すべて live、 各 sha256 一致、 すべて Singapore / SIAC 準拠法。
- **forced-tos-flow**: アプリが初回起動時に ToS 画面を強制表示、 同意せず staking 画面に進めない。
- **moral-rights-clause**: 利用規約に著作者人格権 不行使特約 (名誉声望の除外を含む) が組み込み済。
- **rate-card-catalog**: `web/config/cosign-catalog.yaml` が rate card 方式 (= 撮影者が能動的に accept する形)、 著作権等管理事業法 一任型 該当を回避。
- **sanctions-clause**: ライセンス条文 JSON に `sanctions_condition` (= OFAC SDN void ab initio) が明文化。
- **tdm-optout-signals**: EU CDSM 第 4 条 第 3 項 対応として C2PA `tdm-reservation` assertion + `.well-known/tdm.json` + `robots.txt` / `llms.txt` が live。
- **consent-api**: `POST /api/v1/tos/consent` が同意レコードを永続化、 `GET ...` で公開可能。
- **catalog-real-urls**: `POST /api/v1/license/issue` のカタログが placeholder URL ではなく実ライセンス条文 URL を指す。
- **e2e-pass**: 既存 e2e test (`tests/staking/03-api-license-issue.spec.ts`) が、 カタログ差し替え後もパス。
- **verification-script**: 第三者検証チェーン (SPECS §4.4.6 step 1〜5 + Layer 2 hash verify) を offline で実行できる verification script を提供。
- **legal-review-complete**: 法務レビュー全項目 (`legal-rationale.md` §4) が完了。 うち (a) 著作権等管理事業法 適法性意見書、 (b) 著作者人格権 不行使特約 文言、 (c) OFAC 条件付与の故意違反否定の余地、 の 3 件は刑事 / 金銭ペナルティ視野で最優先。

`verification-script` と `legal-review-complete` は実装本体ではないが、 これがなければ「法的に問題ない」 とは言えない。

## スタック

| 依存 | バージョン | 用途 |
|---|---|---|
| Next.js | 16.1.6 (既存) | `app/tos/[version]/[hash]/page.tsx` 等の静的ルート |
| Supabase | (既存) | `tos_consent_logs` テーブルを append-only として扱う |
| sha256 / @noble/hashes | latest | URL path hash の計算 + 検証 |

新規 npm 依存は最小、 法務レビュー以外は実装軽め。

## 関連 task

- **Task 06**: License NFT Anchor program — `issue_license` の delegate 検証と URI append が本 task の前提。
- **Task 07**: Co-sign API — `POST /api/v1/license/issue` のカタログがライセンス条文 URL を指すよう、 本 task で更新。
- **Task 12 (VLM gate)**: 第三者著作物検知の品質が `legal-rationale.md` §3.2 の現実的リスクを左右。
- **Task 13 (Privacy Blur)**: `legal-rationale.md` §3.6 (肖像権) の技術的対応に直結。
