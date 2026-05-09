# Task 06 / Unit D: License NFT Solana Program

## 位置付け

**統合ユニット (production-bound)。** sandbox 検証用ではない。SPECS_JA §5 を満たす独立した Anchor プログラム。アプリ統合フェーズで `programs/license-nft/` をそのまま使う。

監査並みのテストでガードして初めて完成扱い。クライアント側 (TS SDK / RootLens API / モバイル) はこのプログラムが verified された後に書き始める。

## 仕様参照

- SPECS_JA §5 全体 (License NFT のコントラクト設計)
- §4.4 (delegate のサブライセンス権) — プログラム外の法的根拠
- §8 (オンチェーンアカウント構造)

## スコープ

このユニットで作るもの:

- Anchor プログラム `license_nft` (`programs/license-nft/`)
- 命令: `initialize_config`, `issue_license`, `claim_revenue`, `update_config` (admin only)
- アカウント: `Config` PDA, `UserRevenue` PDA, `UsdcPoolAuthority` PDA
- Bubblegum Merkle proof verification (Root NFT の delegate / collection / owner 確認)
- USDC 受け払い + 95:5 分配 (atomicity 保証)
- TS テストハーネス (solana-bankrun + 必要に応じて anchor test on local validator)

このユニットで**作らない**もの:

- Co-sign API (RootLens サーバー — Unit E)
- Tree creation / management UI (運営側オフチェーン操作)
- License NFT のメタデータ生成 (R2 アップロード — Unit F)
- フロントエンド統合 (アプリ — 統合フェーズ)

## スタック

| 依存 | バージョン | 根拠 |
|---|---|---|
| anchor-lang | 0.31.1 (2025-04-20 release) | title-protocol の 0.30 から 1 minor up。API 互換、bug fix の蓄積。1.0.x (2026-04-02 リリース) は audit-grade としては履歴が浅い |
| anchor-spl | 0.31.1 | anchor-lang と揃える。USDC Token CPI に使う |
| mpl-bubblegum | 2.1.1 (2025-08-20) | title-protocol と同じ系統。`MetadataArgs` / `LeafSchema` / proof verify CPI |
| spl-account-compression | 1.0.0 (2025-05-01) | anchor 0.31 / solana-program 2.x と型整合する SDK 版 |
| Test framework | solana-bankrun + ts-mocha | 1 ms 級の adversarial test 量産。最終 smoke test は anchor test on solana-test-validator |

### 必須環境 (検証 2026-05-09)

- **Agave / Solana CLI 3.1.14+**: cargo-build-sbf 同梱の rustc 1.89.0 + platform-tools v1.52 が
  anchor 0.31.1 → solana-program 2.3 → blake3 1.8 → constant_time_eq 0.4 (edition2024) を処理可能。
  古い 2.1.x シリーズは rustc 1.79 同梱で edition2024 を読めず build 失敗する。
- **Anchor CLI**: cargo の deps が真実。CLI version は IDL 生成用途のみなので AVM pin 不要。
- セットアップ: `agave-install init 3.1.14`

## オンチェーンアカウント設計

### Config (PDA, 1 個)

```rust
#[account]
pub struct Config {
    pub authority: Pubkey,             // 32  admin (mutable, update_config 専用)
    pub title_core_collection: Pubkey, // 32  TitleCore MPL Core Collection mint
    pub usdc_mint: Pubkey,             // 32  受け払い通貨 mint
    pub staker_basis_points: u16,      // 2   ステーカー分配比率 (初期 9500)
    pub delegate_basis_points: u16,    // 2   delegate 分配比率 (初期 500)
    pub bump: u8,                      // 1
}
// seeds = [b"config"]
// 合計サイズ: 8 (discriminator) + 101 = 109 bytes
```

不変条件: `staker_basis_points + delegate_basis_points == 10000` を `update_config` で強制。

### UserRevenue (PDA, ステーカーごと 1 個)

```rust
#[account]
pub struct UserRevenue {
    pub user: Pubkey,    // 32  staker のウォレット (PDA seed の一部)
    pub balance: u64,    // 8   未分配 USDC (lamport 単位は USDC の 6 桁基準)
    pub bump: u8,        // 1
}
// seeds = [b"revenue", user.key().as_ref()]
// 合計サイズ: 8 + 41 = 49 bytes
```

初回 `issue_license` 時に自動 init (購入者 = AI 企業負担)。

### UsdcPool (Token Account)

`Config` PDA を authority とする USDC ATA。`Config` PDA そのものを ATA owner にして `Config` 1 個に紐付ける (seeds = [b"config"])。USDC を物理的に保持する。出金は `claim_revenue` でのみ可能。

Tree authority for License Bubblegum tree:
プログラム自身の PDA `[b"tree_authority", license_tree.key().as_ref()]` を Bubblegum tree authority に登録。これにより License NFT の mint authority がプログラムから完全に閉じる (オフチェーンの mint authority 漏洩を防ぐ)。

## 命令

### `initialize_config(staker_bps, delegate_bps)`

- signer: `authority`
- 検証: `staker_bps + delegate_bps == 10000`
- 効果: Config PDA を init、`title_core_collection` と `usdc_mint` を args で受ける、`authority` を args の signer に設定。

### `update_config(...)`

- signer: `authority` (Config に保存された値と一致)
- 任意フィールド更新 (basis points / authority)。`title_core_collection` と `usdc_mint` は init 後変更不可。
- 不変条件 (BPS 合計 = 10000) は再検証。

### `issue_license`

```rust
issue_license(
    // Bubblegum proof args
    root: [u8; 32],            // Merkle root snapshot
    nonce: u64,
    index: u32,
    data_hash: [u8; 32],
    creator_hash: [u8; 32],

    // Asset metadata fields (data_hash の中身を再構成するため)
    metadata_args: MetadataArgs,  // mpl-bubblegum の LeafSchema 用

    // License args
    price: u64,                  // USDC (6 decimals)
    license_metadata_uri: String, // R2 上のライセンス JSON
)
```

#### Accounts

```
buyer:                 Signer + Mut       (= AI 企業のウォレット, USDC 出元 + tx 手数料負担)
delegate:              Signer + Mut       (= co-signer, 5% 受取)
staker:                AccountInfo        (= Root NFT の owner、無署名)
config:                Account<Config>    (PDA, [b"config"])
user_revenue:          Account<UserRevenue> (PDA, init_if_needed [b"revenue", staker.key()])
buyer_usdc:            Account<TokenAccount> (buyer の USDC ATA)
delegate_usdc:         Account<TokenAccount> (delegate の USDC ATA)
pool_usdc:             Account<TokenAccount> (config PDA の USDC ATA)
usdc_mint:             Account<Mint>      (config.usdc_mint と一致確認)
root_merkle_tree:      AccountInfo        (Bubblegum tree, Root NFT の格納先)
license_merkle_tree:   AccountInfo + Mut  (License NFT を mint する tree)
license_tree_authority: AccountInfo + Mut (PDA [b"tree_authority", license_merkle_tree])
log_wrapper, compression_program, system_program, token_program, bubblegum_program, ...
remaining_accounts:    [proof leaf hashes]
```

#### Verification (in order, fail-fast)

1. **Config integrity**: `config.usdc_mint == usdc_mint.key()`、`pool_usdc.mint == usdc_mint`、`pool_usdc.owner == config.key()`。
2. **Asset reconstruction**: `metadata_args` から `data_hash` を計算し、引数の `data_hash` と一致確認。これにより metadata_args が改ざんされていないことを保証。
3. **Collection check**: `metadata_args.collection.verified == true && metadata_args.collection.key == config.title_core_collection`。
4. **Owner / delegate match**: `LeafSchema::V1 { id, owner: staker.key(), delegate: delegate.key(), nonce, data_hash, creator_hash }` を構築 → leaf hash 計算。
5. **Merkle proof**: `spl_account_compression::cpi::verify_leaf(root, leaf_hash, index, proof_accounts)` を root_merkle_tree に対して実行。失敗時は revert。
6. **Price sanity**: `price > 0`。
7. **Bps split sanity**: 内部計算で `staker_share + delegate_share == price` を保証 (整数除算で 1 unit ずれが出ないよう delegate_share = price - staker_share とする方式)。

#### Effects (atomic, fail-any-revert-all)

1. CPI: Bubblegum `mint_v1` で license_merkle_tree に License NFT を `buyer` 宛にミント (tree authority signer = `license_tree_authority` PDA)。
2. CPI: Token `transfer` で `buyer_usdc` → `pool_usdc` へ `staker_share` 移転。
3. CPI: Token `transfer` で `buyer_usdc` → `delegate_usdc` へ `delegate_share` 移転。
4. `user_revenue.balance += staker_share` (overflow check)。
5. (init_if_needed の場合) UserRevenue PDA 初期化、`user` フィールドに staker pubkey を記録。

### `claim_revenue`

```rust
claim_revenue()
```

#### Accounts

```
user:                  Signer + Mut
config:                Account<Config>
user_revenue:          Account<UserRevenue> (PDA, [b"revenue", user.key()])
user_usdc:             Account<TokenAccount> (user の USDC ATA)
pool_usdc:             Account<TokenAccount>
usdc_mint:             Account<Mint>
token_program, system_program
```

#### Effects

1. `amount = user_revenue.balance`
2. `user_revenue.balance = 0`
3. CPI: Token `transfer` で `pool_usdc` → `user_usdc` へ `amount` 移転 (signer = config PDA)
4. `amount == 0` の場合は no-op (revert ではなく成功)

## 監査 grade テスト計画

### Happy path (smoke)

- `H1` initialize_config → 95:5 で create
- `H2` issue_license: 全部正しい args / signers / accounts → License mint + 95% pool 入金 + 5% delegate 即時送金
- `H3` 別の AI 企業が同じ root_mint に対して issue_license → 同 staker の UserRevenue.balance に追加加算
- `H4` claim_revenue: 全額引き出し、balance = 0 にリセット
- `H5` claim_revenue (balance=0): no-op で成功

### Adversarial (must revert)

| ID | シナリオ | 期待 |
|---|---|---|
| A1 | co-signer が delegate ではない別アドレス | merkle proof verify で revert |
| A2 | Root NFT が TitleCore collection に属さない | collection check で revert |
| A3 | metadata_args を改ざん (data_hash と不一致) | data_hash mismatch で revert |
| A4 | Merkle proof が偽物 (別 leaf の proof を投げる) | proof verify で revert |
| A5 | buyer の signature 欠落 | Anchor の Signer 制約で revert |
| A6 | delegate の signature 欠落 | Anchor の Signer 制約で revert |
| A7 | usdc_mint が config と不一致 | account constraint で revert |
| A8 | pool_usdc.owner != config PDA | constraint で revert |
| A9 | price = 0 | price sanity で revert |
| A10 | claim_revenue を別ユーザーの UserRevenue に対して呼ぶ | seeds 不一致で revert |
| A11 | issue_license の途中で USDC 不足 | Token CPI で revert、entire tx ロールバック (license も mint されない) |
| A12 | UserRevenue.balance + staker_share が overflow | checked_add で revert |
| A13 | basis_points 合計 != 10000 で update_config を試みる | constraint で revert |
| A14 | authority 以外が update_config を試みる | has_one = authority で revert |
| A15 | 別の license_tree (tree_authority PDA bump 不一致) | seeds derivation 失敗 |

### 不変条件 (invariants — fuzz)

- 任意の有効な issue_license 後: `pool_usdc.amount == sum(全 UserRevenue.balance) - 全 claim 済額`
- 任意の操作後: `staker_bps + delegate_bps == 10000`
- claim_revenue 後: `user_revenue.balance == 0`
- 同一 (root, index) ペアで複数回 issue_license は許容 (non-exclusive)、ただし license_tree 内の leaf は別 index になる

### テスト基盤

- `tests/license-nft/issue.spec.ts` — H1〜H4, A1〜A12
- `tests/license-nft/claim.spec.ts` — H5, A10
- `tests/license-nft/config.spec.ts` — A13, A14
- 共通フィクスチャ: SPL Mint (mock USDC) 作成、Bubblegum tree create + Root NFT mint helper、staker / delegate / buyer keypair pool
- bankrun でほぼ全テスト。最後に anchor test で local validator 上のスモーク 1 回。

## ディレクトリ構造

```
root-lens/
├── Anchor.toml              ← workspace 設定 (新規)
├── Cargo.toml               ← workspace ルート (新規)
├── programs/
│   └── license-nft/
│       ├── Cargo.toml
│       ├── Xargo.toml
│       └── src/
│           ├── lib.rs           ← declare_id + #[program] mod
│           ├── state.rs         ← Config, UserRevenue
│           ├── error.rs         ← LicenseNftError
│           └── instructions/
│               ├── initialize_config.rs
│               ├── update_config.rs
│               ├── issue_license.rs
│               └── claim_revenue.rs
└── tests/
    └── license-nft/
        ├── helpers/
        │   ├── bubblegum.ts
        │   ├── token.ts
        │   └── pdas.ts
        ├── issue.spec.ts
        ├── claim.spec.ts
        └── config.spec.ts
```

## 完了条件

- [ ] `cargo build-sbf` 成功
- [ ] `anchor test` の TS テスト 1 回でも通る (local validator)
- [ ] bankrun テストで H1〜H5 + A1〜A15 のすべてが期待通りの結果
- [ ] 不変条件の fuzz (100 回 issue_license + claim_revenue ループ) で `pool_usdc.amount == sum(UserRevenue.balance) - claimed` が常に成立
- [ ] `cargo clippy --all-targets -- -D warnings` でクリーン
- [ ] declare_id を本番用 keypair で生成 (deploy 前)
- [ ] このドキュメントの ADR セクションに「変更が必要になった理由 + その後の変更点」を残す履歴ポリシー確立

## 制限事項

- Bubblegum V2 の collection field 周りはまだ仕様 fluid。MPL Core Collection との連動は最新 mpl-bubblegum SDK の挙動を信頼する。重大変更があれば doc に追記。
- License NFT の metadata 構築 (R2 上 JSON ハッシュなど) はオフチェーン側 (Unit F の R2 アップロード) で行う。プログラムは `metadata_uri` を opaque に受け取る。
- USDC は SPL Token (devnet では mock mint で代替)。Token-2022 / extension 対応は MVP では行わない (必要になったら別 issue で別 PDA / pool 設計)。
- License NFT の transfer 制約 (バーン禁止 / freeze など) は Bubblegum 標準の挙動に任せる。プログラム側で transfer フックは持たない。
