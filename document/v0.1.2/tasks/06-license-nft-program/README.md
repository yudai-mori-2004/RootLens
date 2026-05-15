# Task 06 / Unit D: License NFT Solana Program

## 位置付け

**統合ユニット (production-bound)。** sandbox 検証用ではない。SPECS_JA §5 を満たす独立した Anchor プログラム。アプリ統合フェーズで `programs/license-nft/` をそのまま使う。

監査並みのテストでガードして初めて完成扱い。クライアント側 (TS SDK / RootLens API / モバイル) はこのプログラムが verified された後に書き始める。

## 進捗サマリ (2026-05-09 時点)

- ✅ Anchor プログラム実装 (5 命令、Bubblegum V2 経路、URI append による Layer 1 binding)
- ✅ devnet デプロイ済 (`G1PWd1nMe63isDaYT3iijcyWac9d4RE1CBrvaKZFjpV8`)
- ✅ License Collection 作成 + Config PDA 初期化 (test instance、TP TitleCore はテスト用 Collection で代替)
- ✅ `license-cli` (crates/cli) 実装 + 動作確認
- ✅ 監査 grade テスト 17/17 pass (devnet 上の deployed program に対して実打)
- ✅ ライセンス条文テンプレート 4 種別 + Singapore/SIAC 準拠 (法的レビュー前ドラフト)
- ✅ §4.4 ToS サブライセンス連鎖、§5.5 一方的許諾 + Legal-Authoritative の SPECS 反映
- ⏳ 法的レビュー (Singapore primary、US/EU spot-check) — 次フェーズ
- ⏳ 本番用 declare_id 生成 + mainnet deploy — 法的レビュー完了後
- ⏳ Bubblegum V2 `asset_data` を実用できるようになり次第、URI append 方式から asset_data_hash 経路に切替 (現在 devnet bubblegum が NotAvailable を返す)

## 仕様参照

- SPECS_JA §5 全体 (License NFT のコントラクト設計)
- SPECS_JA §4.4 (撮影者→delegate→License 保有者の連鎖、ToS 同意フロー、サブライセンス条文)
- SPECS_JA §5.5 (一方的許諾、Legal-Authoritative、二層 binding)
- `document/v0.1.2/license-templates/` (条文テンプレート 4 種別)

## スコープ

このユニットで作るもの:

- Anchor プログラム `license_nft` (`programs/license-nft/`)
- 命令 6 つ: `initialize_config`, `update_config`, `close_config`, `create_license_tree`, `issue_license`, `claim_revenue`
- アカウント: `Config` PDA, `UserRevenue` PDA, `license_tree_authority` PDA (Bubblegum tree authority)、`pool_usdc` (Token Account, Config PDA owned)
- License MPL Core Collection (`update_authority = Config PDA`)
- Bubblegum V2 LeafSchema 構築 + `mpl_account_compression::verify_leaf` で proof 検証
- USDC 受け払い + 95:5 分配 (atomicity 保証)
- License NFT の URI に `?root_mint=<root_asset_id>` を append して Layer 1 binding
- `license-cli` (`crates/cli/`): bootstrap + License Collection 作成 + Config 初期化
- 監査 grade テスト (`tests/license-nft/`): mocha + 生 IX 構築、devnet 上の deployed program に直接実打
- ライセンス条文テンプレート (4 種別、英語、Singapore/SIAC)

このユニットで**作らない**もの:

- Co-sign API server (RootLens — Unit E)
- Tree creation / management UI (運営側オフチェーン操作)
- License NFT のメタデータ JSON 生成 + R2 アップロード (Unit F)
- フロントエンド統合 (アプリ — 統合フェーズ)
- 撮影者用 ToS 同意の web2 implementation (RootLens server — Unit C 系)

## スタック

| 依存 | バージョン | 根拠 |
|---|---|---|
| anchor-lang | 0.31.1 | title-protocol の 0.30 から 1 minor up。1.0.x は audit-grade として履歴浅い |
| anchor-spl | 0.31.1 | anchor-lang と揃える。USDC Token CPI 用 |
| mpl-bubblegum | 2.1.1 | title-protocol と同じ系統。MintV2 + LeafSchema::V2 |
| **mpl-account-compression** | 1.0.0 | Bubblegum V2 trees の所有 program。**spl-account-compression ではない点に注意** |
| mpl-noop | 1.0 | Bubblegum V2 event log 用 |
| Test framework | mocha + tsx + raw IX | devnet 直接実打。bankrun は不採用 (実環境 verify を優先) |

### 必須環境 (検証 2026-05-09)

- **Agave / Solana CLI 3.1.14+**: 同梱の rustc 1.89.0 + platform-tools v1.52 が
  anchor 0.31.1 → solana-program 2.3 → blake3 1.8 → constant_time_eq 0.4 (edition2024) を処理可能。
  古い 2.1.x シリーズ (rustc 1.79) では build 失敗。
- **Anchor CLI**: cargo deps が真実。CLI 自体は IDL 生成用途のみで AVM pin 不要。

## オンチェーンアカウント設計

### Config (PDA, 1 個)

```rust
#[account]
pub struct Config {
    pub authority: Pubkey,             // 32  admin (update_config 権限のみ)
    pub title_core_collection: Pubkey, // 32  TitleCore MPL Core Collection (TP の Root NFT 保管先)
    pub license_collection: Pubkey,    // 32  License MPL Core Collection (本 program の発行先)
    pub usdc_mint: Pubkey,             // 32  受け払い通貨
    pub staker_basis_points: u16,      // 2   ステーカー分配比率 (初期 9500)
    pub delegate_basis_points: u16,    // 2   delegate 分配比率 (初期 500)
    pub bump: u8,                      // 1
}
// seeds = [b"config"]
// 合計サイズ: 8 (discriminator) + 133 = 141 bytes
```

不変条件: `staker_basis_points + delegate_basis_points == 10000`。

License Collection の update_authority = Config PDA に設定することで、admin keypair が漏洩しても License Collection に偽 cNFT を mint できない (program code path 経由でのみ mint 可能)。

### UserRevenue (PDA, ステーカーごと 1 個)

```rust
#[account]
pub struct UserRevenue {
    pub user: Pubkey,    // 32  staker のウォレット
    pub balance: u64,    // 8   未分配 USDC (6 decimals)
    pub bump: u8,        // 1
}
// seeds = [b"revenue", user.key().as_ref()]
// 合計サイズ: 8 + 41 = 49 bytes
```

初回 `issue_license` 時に自動 init (購入者 = AI 企業負担)。

### UsdcPool (Token Account)

`Config` PDA を authority とする USDC ATA。USDC を物理的に保持。出金は `claim_revenue` でのみ可能。

### License Bubblegum tree authority (PDA)

```
seeds = [b"tree_authority", license_merkle_tree.key().as_ref()]
```

License Bubblegum tree の `tree_creator_or_delegate` に登録される PDA。本 program が `MintV2` を CPI signed する際に署名者として使用。これにより License NFT の mint が完全に program 内に閉じる。

## 命令

### `initialize_config(title_core_collection, license_collection, usdc_mint, staker_bps, delegate_bps)`

- signer: `authority`
- 検証: `staker_bps + delegate_bps == 10000`、各 Pubkey が `Pubkey::default()` でない
- 効果: Config PDA を init、5 フィールドを args で受ける、`authority` を signer に設定

### `update_config(new_authority?, new_staker_bps?, new_delegate_bps?)`

- signer: `Config.authority`
- BPS / authority のみ更新可。`title_core_collection` / `license_collection` / `usdc_mint` は immutable
- BPS 合計 10000 を再検証

### `close_config()`

- signer: `Config.authority`
- Config PDA を close、rent を authority に返却
- audit/dev 環境用 (production では feature gate でオフにする想定)

### `create_license_tree(max_depth, max_buffer_size)`

- signer: `payer` (admin or anyone)
- Bubblegum `CreateTreeConfigV2` を CPI、`tree_creator_or_delegate = license_tree_authority PDA` で sign
- 呼出側が事前に merkle_tree account の allocate (`SystemProgram::CreateAccount`) を行うこと
- これで License Bubblegum tree が生まれた瞬間から program 経由でのみ mint 可能になる

### `issue_license`

```rust
issue_license(
    // Bubblegum V2 proof args
    root: [u8; 32],
    nonce: u64,
    index: u32,
    data_hash: [u8; 32],
    creator_hash: [u8; 32],
    asset_data_hash: [u8; 32],
    flags: u8,
    root_collection: Pubkey,           // 引数で渡す。program 側で config.title_core_collection と一致確認

    // License NFT mint args
    license_metadata_uri: String,      // 例: https://rootlens.io/licenses/commercial-v1/<terms_hash>.json
    license_name: String,              // 例: "Test License #0"

    // Pricing
    price: u64,                        // USDC (6 decimals)
)
```

#### Accounts (17 + remaining_accounts)

```
buyer:                  Signer + Mut       (USDC 出元、tx 手数料 + UserRevenue init 費用)
delegate:               Signer + Mut       (5% 受取)
staker:                 AccountInfo        (Root NFT owner、Merkle proof で identity 確認)
config:                 Box<Account<Config>> (PDA, has_one usdc_mint)
user_revenue:           Box<Account<UserRevenue>> (PDA, init_if_needed)
usdc_mint:              Box<Account<Mint>>
buyer_usdc:             Box<Account<TokenAccount>>
delegate_usdc:          Box<Account<TokenAccount>>
pool_usdc:              Box<Account<TokenAccount>> (token::authority = config)
root_merkle_tree:       UncheckedAccount   (Bubblegum tree)
license_merkle_tree:    UncheckedAccount + Mut
license_tree_config:    UncheckedAccount + Mut (Bubblegum 派生 PDA)
license_tree_authority: PDA [b"tree_authority", license_merkle_tree]
license_collection:     UncheckedAccount + Mut (constraint = config.license_collection)
mpl_core_cpi_signer:    UncheckedAccount   (Bubblegum 派生 PDA [b"mpl_core_cpi_signer"])
compression_program:    UncheckedAccount   (mpl_account_compression、Bubblegum V2 用)
bubblegum_program:      UncheckedAccount
log_wrapper:            UncheckedAccount   (mpl_noop)
mpl_core_program:       UncheckedAccount
token_program, system_program
remaining_accounts:     [proof leaf hashes]
```

SBF stack 4096B 制約のため、`Account<'info, T>` はすべて `Box<>` で heap に逃がしている。

#### Verification (in order, fail-fast)

1. `price > 0`
2. `root_collection == config.title_core_collection` で TitleCore 一致確認
3. `collection_hash = hash_collection_option(Some(root_collection))` を計算
4. `LeafSchema::V2` を構築 (id = `get_asset_id(root_merkle_tree, nonce)`、owner = staker、delegate = co_signer + 引数 hash 群 + collection_hash)
5. `mpl_account_compression::cpi::verify_leaf(root, leaf_hash, index)` を `root_merkle_tree` に対して実行 (失敗時 InvalidLeafProof)
6. Split 計算: `staker_share = price * staker_bps / 10000`、`delegate_share = price - staker_share` (1 unit ずれを delegate 側に乗せず staker に切上げ吸収)

#### Effects (atomic, fail-any-revert-all)

1. **URI 構築**: `final_uri = format!("{}?root_mint={}", license_metadata_uri, root_asset_id)` (SPECS §5.5.3 Layer 1 binding)
   - URI 末尾に既に `?` がある場合は `&` で append
2. **License NFT mint**: `MintV2CpiBuilder` で license_merkle_tree に buyer 宛 mint
   - `core_collection = license_collection`、`collection_authority = config PDA`、`mpl_core_cpi_signer` を渡す
   - 2 つの PDA seeds で `invoke_signed`: `[b"tree_authority", license_merkle_tree, bump]` + `[b"config", bump]`
3. Token transfer: `buyer_usdc` → `pool_usdc` へ `staker_share`
4. Token transfer: `buyer_usdc` → `delegate_usdc` へ `delegate_share`
5. `user_revenue.balance += staker_share` (checked_add)
6. (init_if_needed の場合) UserRevenue PDA 初期化、`user` フィールドに staker pubkey を記録 (改ざん検知用)

### `claim_revenue()`

- signer: `user` (= UserRevenue の所有者)
- 検証: `user_revenue.user == user.key()` (has_one)
- 効果:
  1. `amount = user_revenue.balance`
  2. `user_revenue.balance = 0` (CEI: state を先に変更)
  3. Token transfer `pool_usdc` → `user_usdc` へ `amount` (signer = config PDA)
  4. `amount == 0` の場合は no-op で成功

## SPECS §5.5.3 Layer 1 binding (URI append 方式)

current 実装では Bubblegum V2 の `asset_data` フィールドが devnet bubblegum で `NotAvailable` (error 6050) を返すため、代替として URI に `?root_mint=<root_asset_id_b58>` を program 内で append する方式を採用。

```
caller の URI:        https://rootlens.io/licenses/commercial-v1/<terms_hash>.json
program 内で append:  https://rootlens.io/licenses/commercial-v1/<terms_hash>.json?root_mint=<root_asset_id_b58>
```

URI は `MetadataArgsV2.uri` に格納 → Bubblegum の `data_hash` 計算に取り込まれ → leaf hash の構成要素となる。Mint 後の URI 改ざんは leaf hash 不一致で検知される。caller は root_asset_id を偽装不可 (program が proof verify を通過した leaf.id から導出するため)。

検証側の手順 (SPECS §5.5.3 参照): License NFT を DAS から fetch → URI を読む → `?root_mint=` を parse → 主張される Root NFT を DAS から fetch して TitleCore 所属 + TP 発行を確認 → URI 本体 (query を除いた part) の hash と URL path 内 `<terms_hash>` を比較して条文改ざん検知。

> Bubblegum が将来 asset_data を有効化したら、`asset_data = root_asset_id_bytes` で渡し、Bubblegum 側で `sha256(asset_data)` を `leaf.asset_data_hash` に焼き込ませる方式に切替予定。レイアウト的にこの方が clean。

## 監査 grade テスト計画 (実装済 17 ケース、全 pass)

### Happy path

| ID | シナリオ | 状態 |
|---|---|---|
| H1 | 正規 issue_license + USDC 95:5 分配 + UserRevenue 累積 | ✅ pass (`tests/license-nft/04-issue-happy.spec.ts`) |
| (update_config happy) | BPS 9500/500 → 9000/1000 → 9500/500 round-trip | ✅ pass |

### Adversarial (must reject)

| ID | シナリオ | 期待 / 実態 | テストファイル |
|---|---|---|---|
| A1 | co-signer ≠ leaf.delegate | "Invalid root recomputed from proof" log | `04-issue-happy.spec.ts` |
| A2 | `root_collection` ≠ `config.title_core_collection` | InvalidCollection | `03-issue-license.spec.ts` |
| A3 | `data_hash` 引数を改ざん | "Invalid root recomputed from proof" log | `04-issue-happy.spec.ts` |
| A4 | merkle proof bytes を改ざん | "Invalid root recomputed from proof" log | `04-issue-happy.spec.ts` |
| A7 | usdc_mint mismatch | ConstraintHasOne / UsdcMintMismatch | `03-issue-license.spec.ts` |
| A8 | pool_usdc owner != Config PDA | ConstraintRaw / InvalidPoolOwner | `03-issue-license.spec.ts` |
| A9 | price = 0 | InvalidPrice | `03-issue-license.spec.ts` |
| A10 | claim_revenue を別ユーザーの UserRevenue で呼ぶ | AccountNotInitialized / ConstraintSeeds | `02-claim-revenue.spec.ts` |
| A11 | buyer USDC 残高 < price | SPL Token InsufficientFunds (logs) | `04-issue-happy.spec.ts` |
| A13 | BPS 合計 != 10000 で update_config | InvalidBasisPoints (3 variants tested) | `01-update-config.spec.ts` |
| A14 | 別 keypair が update_config を試行 | ConstraintHasOne | `01-update-config.spec.ts` |
| A15 | 別 tree の seeds で派生した license_tree_authority | ConstraintSeeds | `03-issue-license.spec.ts` |
| (extra) | UserRevenue PDA 未存在で claim 試行 | AccountNotInitialized | `02-claim-revenue.spec.ts` |

実装/対応見送り:
- A5 / A6 (buyer / delegate signer 欠落): TS の sendAndConfirmTransaction が事前検証で reject、tx 投入前に弾かれるため devnet 上では再現困難。code review でカバー
- A12 (UserRevenue.balance overflow): u64::MAX まで累積させるテストは devnet では非現実的。`checked_add` のコードレビューでカバー

### 不変条件 (実装で確保、追加 fuzz は将来課題)

- `staker_bps + delegate_bps == 10000` (update_config で再検証)
- `claim_revenue` 後 `user_revenue.balance == 0`
- 同一 (root, index) ペアで複数回 issue_license は許容 (non-exclusive、SPECS §5.1)、license_tree 内の leaf は別 index になる

### テスト実装

- `tests/license-nft/01-update-config.spec.ts` — 5 ケース (A14, A13×3, happy)
- `tests/license-nft/02-claim-revenue.spec.ts` — 2 ケース (A10, missing PDA)
- `tests/license-nft/03-issue-license.spec.ts` — 5 ケース (A2, A7, A8, A9, A15)
- `tests/license-nft/04-issue-happy.spec.ts` — 5 ケース (H1, A1, A3, A4, A11)
- `tests/license-nft/setup.ts` — License + Root Bubblegum tree 作成、5 個のテスト Root NFT leaf mint
- `tests/license-nft/setup-license-tree.ts` — License tree を `create_license_tree` IX 経由で program owned PDA 化
- `tests/license-nft/setup-alt.ts` — Address Lookup Table (issue_license の tx size を legacy 1232B 制限以下に圧縮)

実行: `cd tests/license-nft && npm test` → 17 passing (~22s, devnet 接続)。

## ディレクトリ構造

```
root-lens/
├── Anchor.toml                       ← workspace 設定
├── Cargo.toml                        ← Cargo workspace ルート
├── programs/
│   └── license-nft/
│       ├── Cargo.toml
│       └── src/
│           ├── lib.rs                ← declare_id + #[program] mod (6 命令)
│           ├── state.rs              ← Config, UserRevenue, tree_authority seed
│           ├── error.rs              ← LicenseNftError (11 variants)
│           └── instructions/
│               ├── mod.rs
│               ├── initialize_config.rs
│               ├── update_config.rs
│               ├── close_config.rs
│               ├── create_license_tree.rs
│               ├── issue_license.rs   ← Bubblegum V2 + URI append + USDC 95:5
│               └── claim_revenue.rs
├── crates/
│   └── cli/                          ← license-cli
│       ├── Cargo.toml
│       └── src/
│           ├── main.rs               ← clap dispatcher
│           ├── error.rs
│           ├── config.rs             ← network.json schema, keypair load
│           ├── rpc.rs                ← 最小 JSON-RPC client
│           ├── anchor.rs             ← Anchor IX builder + MPL Core CreateCollectionV2
│           └── commands/
│               ├── mod.rs
│               ├── init_config.rs
│               ├── close_config.rs
│               └── create_collection.rs
└── tests/
    └── license-nft/
        ├── package.json
        ├── tsconfig.json
        ├── helpers.ts                ← Anchor disc + raw IX + V0 tx with ALT
        ├── issue-helpers.ts          ← issue_license IX builder
        ├── setup.ts                  ← Bubblegum trees + 5 leaves
        ├── setup-license-tree.ts     ← program PDA 経由の License tree
        ├── setup-alt.ts              ← Address Lookup Table
        ├── 01-update-config.spec.ts
        ├── 02-claim-revenue.spec.ts
        ├── 03-issue-license.spec.ts
        └── 04-issue-happy.spec.ts
```

## devnet 状態 (audit instance)

| 役割 | アドレス |
|---|---|
| Program ID | `G1PWd1nMe63isDaYT3iijcyWac9d4RE1CBrvaKZFjpV8` |
| Program upgrade authority | `8jnPEbjtgvDvM9moKofmS8wv3iy4rC5XDPXxfiSxUf6U` (`keys/deployer.json`) |
| Config PDA | `FfsaBAMBuDpWXaBKU8hCXMqtnjH4BFcwzW3EL7fhzx7U` |
| Config admin (authority) | `3q4chjEgfRb45A17byg7NzdyagzHRt25sRxHoyJeojzV` (`keys/authority.json`) |
| License Collection | `BvhuJiTWDW6n5cSzE4XmzYcwLry7vcstS1U7fD7n9N1b` |
| TitleCore (test 用) | `Dfg52e4aG9zusPedUSMQ7q8kRs3W4QebNCQqJf3GjYBy` (本 program 自体が deploy した test Collection、TP 本体ではない) |
| Mock USDC mint | `8dGVmRYTRhyyy5iCPo15nwSYK3nLNSUFvGb9JyZJZVFU` (deployer = mint authority) |
| License Bubblegum tree | `9ebXPaychxwoySQDY3ifmMDdz1XdX5gDR7mi1XdrGuVE` (program PDA 所有) |
| Address Lookup Table | `iaD1HxqeTerYhtYWWkimdey2yhwFLrGJgkvs2fQNUkB` |

mainnet deploy 時には新規 program keypair を生成し、本物の TP TitleCore Collection と本物の USDC mint を指して別 instance を deploy する想定。

## 法的構造 (SPECS §4.4 / §5.5 と license-templates)

- 一方的許諾モデル (SPECS §5.5.1) — クリックスルー同意なしで NFT 保有者が自動的に licensee
- Legal-Authoritative モデル (§5.5.2) — 盗難・詐欺の場合は裁判所が NFT 帰属を修正可能 (license_templates §6 / §9 で対応)
- 二層 binding (§5.5.3):
  - Layer 1: License↔Root を `?root_mint=` URI append で固定
  - Layer 2: License↔条文 を URL path に `<terms_hash>` 埋込で self-certifying
- ライセンス条文テンプレート (`document/v0.1.2/license-templates/`):
  - commercial-v1 (商用利用権)
  - training-only-v1 (AI 学習限定)
  - non-commercial-v1 (非商用)
  - redistribution-v1 (商用 + 再配布、CC Share-Alike 風)
  - 全テンプレート: 英語、Singapore 準拠法、SIAC 仲裁
- §4.4 ToS フロー: 撮影者の同意は web2 SaaS 標準 click-through (Google/Twitter 同等)

法的レビュー前ドラフト。Mainnet deploy 前に Singapore 弁護士による confirmation、米国・EU の spot-check が必要。

## 完了条件

- [x] `cargo build-sbf --manifest-path programs/license-nft/Cargo.toml` 成功
- [x] devnet 上の deployed program に対する H1 + 12 adversarial cases (実装可能なすべて) が pass
- [x] License Collection update_authority = Config PDA で trust model を TP より強化
- [x] SPECS §4.4 / §5.5 の法的構造を反映、license-templates 4 種別作成
- [x] CI なし (devnet 直接実打のため、tests を local で `npm test` する運用)
- [ ] `cargo clippy --all-targets -- -D warnings` でクリーン (現在 17 warnings、Anchor macro 関連 + cfg 警告で実害なしが多いが整理推奨)
- [ ] 法的レビュー (Singapore primary、US/EU spot-check) 通過
- [ ] 本番用 program keypair 生成 + mainnet deploy
- [ ] §4.4 ToS の web2 implementation (Unit C 系で扱う、撮影者同意の DB スキーマ + UI)
- [ ] License JSON wrapper (terms_hash 自己証明 URL のサーバ側ホスティング — Unit F 系)
- [ ] Bubblegum on-chain が `asset_data` を許可したら URI append → asset_data_hash 経路に切替

## 制限事項

- **Bubblegum V2 `asset_data` 不採用 (現時点)**: devnet 上の deployed mpl-bubblegum が NotAvailable (6050) を返すため、URI append 方式で代替実装。将来切替予定 (上記)。
- **Tree authority PDA は legacy bump only**: `find_program_address` で取得した bump をそのまま使う (`bump = ctx.bumps.license_tree_authority`)。新 tree 作成時に bump が衝突する確率は無視できる。
- **License NFT の transfer 制約 (バーン禁止 / freeze 等) は持たない**: Bubblegum 標準の挙動に任せる。program 側で transfer hook は実装しない。
- **USDC は SPL Token (mock for devnet)**: Token-2022 / extension は MVP 範囲外。必要になったら別 PDA / pool 設計を要検討。
- **Audit instance is not production**: devnet のこの deploy は自己 deploy した test Collection を TitleCore として指している。本物の TP TitleCore に対しては Root NFT を mint する手段が現状ない (TP TEE が必要) ため、mainnet deploy までは audit テストはこの instance で実施する。

## 改訂履歴

| 日付 | 変更 |
|---|---|
| 2026-05-09 | 初版 + 実装完了状態を反映。devnet 17 tests pass、Singapore/SIAC 法的設計まで含めて完成 |
