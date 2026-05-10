# Task 08 / Unit G: Staking Client (Bubblegum delegate wrapper)

## 位置付け

**統合ユニット (production-bound)。** Root NFT の delegate を RootLens の co-sign authority に設定する/解除する TS クライアントライブラリ。Anchor プログラムは作らない (§4.2 に「Bubblegum の標準機能（delegate 命令）を使用する。動画ごとの PDA は作成しない」と明記)。

D (License NFT program) の `issue_license` は co-signer が leaf.delegate と一致することを Merkle proof で検証する。**G の役割は、その leaf.delegate を RootLens の co-sign authority に揃えること**。staking が完了して初めて D が動く。

D ほどの攻撃面はない (Bubblegum 側で leaf 整合性が保証される、USDC が動かない) ので、テストは integration grade で十分。「G で stake → D で issue_license が通る」「G で unstake → D で issue_license が拒否される」ことを e2e で確認すれば成立。

## 進捗サマリ (2026-05-09 時点)

- ⏳ 未着手

## 仕様参照

- SPECS_JA §4.1 ステーキングの前提条件 (撮影承認 + Root NFT 発行 + サーバー品質チェック)
- SPECS_JA §4.2 ステーキングの仕組み (Bubblegum delegate 命令、PDA は作らない)
- SPECS_JA §4.3 重複排除 (R2 ハッシュ管理、staking 受付前にチェック)
- SPECS_JA §4.5 アンステーク (delegate 解除、過去発行 License は影響受けない)

## スコープ

このユニットで作るもの:

- モバイルサービス `app/src/services/staking.ts` (既存の `titleProtocol.ts` と並べる粒度。1 ファイル)
  - `buildStakeIx(rootAssetId, currentOwner, cosignAuthority, connection)` → `TransactionInstruction[]`
  - `buildUnstakeIx(rootAssetId, currentOwner, connection)` → `TransactionInstruction[]` (delegate を owner 自身に戻す)
  - `getDelegateStatus(rootAssetId, dasEndpoint)` → `{ delegate: PublicKey, owner: PublicKey, isStakedTo: (target) => boolean }`
  - 上記関数が内部で必要とする最小 DAS read 用ヘルパー
- Integration テスト `tests/staking/` (`tests/license-nft/` と同じ流儀の独立 npm pkg、raw web3.js):
  - `package.json` / `tsconfig.json` 自前、mocha + ts-mocha + node 実行
  - 実 devnet の TitleCore Bubblegum tree から Root NFT 1 個を mint (fixture or TP devnet helper)
  - 01-stake.spec.ts: `buildStakeIx` 相当の IX を組んで投げ、DAS で leaf.delegate が cosign authority に更新されたこと
  - 02-unstake.spec.ts: `buildUnstakeIx` 相当の IX を組んで投げ、DAS で leaf.delegate が owner 自身に戻ったこと
  - 03-stake-issue-license.spec.ts: stake 状態で **D の `issue_license` が成功する**こと (G→D の e2e)
  - 04-unstake-issue-license.spec.ts: unstake 状態で `issue_license` が `DelegateMismatch` (or 同等の anchor error) で **失敗する**こと
  - `helpers.ts` で raw IX builder を持ち、`app/src/services/staking.ts` からは import しない (mobile bundler から独立)

このユニットで**作らない**もの:

- web 側 DAS read helper — `web/lib/cosign/das.ts` (Unit E) に既存。E はそちらを使う
- Bubblegum proof fetch (`fetchProofForRoot`) — `issue_license` の caller (= Unit E) の責任。G の API には載せない
- 撮影承認・品質チェック (§4.1 の前提条件は RootLens server 側 — Unit C/F 系)
- Root NFT 発行自体 (TP の領域)
- ToS 同意フロー (§4.4.3、Unit E と server 側で対応)
- Staking 招待通知の UX / バックエンド (§4.2 ステップ 1-2、運営側)
- ステーキング受付前の重複排除チェック (§4.3、Unit F の R2 dedup と server 連携)
- アプリの staking ボタン UI

## スタック

| 依存 | バージョン | 根拠 |
|---|---|---|
| `@solana/web3.js` | 1.95.x | Node + RN の両方で動く既存依存。v2 を使うと RN bundling が不安定 |
| `@metaplex-foundation/mpl-bubblegum` (JS SDK) | 7.x | delegate / verify 命令のビルド用。D が使う `mpl-bubblegum` 2.1.1 (Rust) と LeafSchema 互換 |
| `@metaplex-foundation/digital-asset-standard-api` | latest | DAS RPC (`getAsset`, `getAssetProof`) の型付きラッパー |
| Test runner | mocha + ts-mocha | D と統一。devnet 実打 |

DAS RPC は `process.env.SOLANA_RPC_URL` から取る (Helius / Triton / Quicknode 等)。fallback は `https://devnet.helius-rpc.com/?api-key=...` (D のテストと同じ endpoint で OK)。

## 設計判断

### delegate アドレスは「RootLens co-sign authority」 (server hot wallet)

D の `issue_license` は co-signer が `Signer` として tx に含まれることを要求する。つまり delegate は **wallet (Keypair) でなければならない** — PDA は signer になれない (owning program の CPI 内なら signed_with_seeds が使えるが、外部 tx の Signer にはなれない)。

よって G が設定する delegate は、Unit E (co-sign API server) が hot wallet として保持する `Pubkey` である。Unit E がデプロイされた時点で授与される pubkey を、env (`ROOTLENS_COSIGN_AUTHORITY`) から取って G が読む。

### 「ステーカー = Root NFT の owner」

§4.4 の連鎖図で「[撮影者] (著作権保有) → [Root NFT delegate]」と書かれている。撮影者は Root NFT の owner、delegate に権限を付与する側。`buildStakeIx` の `currentOwner` 引数は「撮影者の wallet」であり、tx の payer + signer になる。

### `buildUnstakeIx` の意味論

Bubblegum の `delegate` 命令は「delegate field を上書き」する操作。「unset」は存在しないので、**unstake = delegate を owner 自身に戻す**と定義する。これにより「§4.5 元 delegate は新規 License NFT 発行に co-sign できなくなる」が達成される (owner 自身のウォレットは co-sign API server の hot wallet と一致しないため)。

### proof fetch は G に置かない (E に既存)

D の `issue_license` は Bubblegum proof を引数で受ける。`web/lib/cosign/das.ts` (Unit E) が既に `getAssetWithProof` を持っており、E が cosign 時に内部で呼ぶ。G がモバイル側で proof を取る局面はない (staking 自体には proof 不要、license issuance は E が完結) ので、G の API には載せない。

### Bubblegum V2 / V1 切替

D は Bubblegum V2 (`MintV2`, `LeafSchema::V2`) を使う。staking の delegate 命令は V1/V2 共通だが、proof スキーマが少し違う。env で V2 を選び、V1 は Out of Scope。Title Protocol が V1 を使い続けている期間は Root NFT が V1 leaf になっている可能性があるので、proof パース時に LeafSchema バージョンを判別して D に渡せる形に正規化する。

## ファイルレイアウト (予定)

```
app/src/services/staking.ts
  既存の titleProtocol.ts と並ぶ粒度のモバイルサービス。1 ファイルに収める。
  - buildStakeIx / buildUnstakeIx / getDelegateStatus を export
  - 内部 DAS helper (getAsset の最小 fetch) は private 関数
  - LeafSchema V1 / V2 を判別して delegate / owner を読む
  - StakingError は throw 文字列で十分 (専用クラス不要)

tests/staking/
  package.json / tsconfig.json — tests/license-nft/ と同じ流儀の独立 npm pkg
  01-stake.spec.ts                — stake → DAS で leaf.delegate が cosign authority に更新
  02-unstake.spec.ts              — unstake → DAS で leaf.delegate が owner に復帰
  03-stake-issue-license.spec.ts  — G stake → D issue_license success (e2e)
  04-unstake-issue-license.spec.ts — G unstake → D issue_license DelegateMismatch (e2e)
  helpers.ts                      — raw IX builder (app/src/services/staking.ts から import しない)
  setup.ts                        — Root NFT mint fixture (TP devnet)
  fixtures.json                   — 既知 pubkey / endpoint
```

## 完了条件

- [ ] `buildStakeIx` / `buildUnstakeIx` がオフラインで IX バイト列を組める (RPC 不要、proof は不要)
- [ ] `getDelegateStatus` が devnet 上の任意の Root NFT で leaf.delegate / leaf.owner を返す (V1/V2 両対応)
- [ ] e2e: stake → D の `issue_license` が成功する
- [ ] e2e: unstake → D の `issue_license` が `DelegateMismatch` (or 同等の anchor error) で失敗する
- [ ] devnet 環境変数 (`ROOTLENS_COSIGN_AUTHORITY`, DAS endpoint) で動作確認
- [ ] `app/src/services/staking.ts` が RN bundler でビルド通る

## 制限事項

- 撮影承認・品質チェック (§4.1) の前提条件は呼び出し側 (RootLens server) の責任。G は誰に staking させるかの判断はしない
- KYC や ToS 同意 (§4.4.3) も G の責任外。これらが満たされた前提で staking IX を組む
- staking 招待通知 (§4.2 ステップ 1) は server 側のオフチェーン処理
- 重複排除 (§4.3) のチェックは server 側 (R2 ハッシュ照合)。G は重複かどうかを知らない
- mainnet deploy は D の本番 declare_id 確定後 (D の進捗参照)
