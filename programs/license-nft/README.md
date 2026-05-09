# License NFT Program — Phase 1: Network Setup

RootLens の License NFT Anchor プログラムをデプロイし、Config PDA + License Collection を初期化する。**開発者ごとに 1 度ずつ実行する**。

Phase 1 は `network.json` を生成する。これは Phase 2 (Tree 作成 / SDK / フロント) のブートストラップに使われる。

> 全体アーキテクチャは [`document/v0.1.2/SPECS_JA.md` §5](../../document/v0.1.2/SPECS_JA.md) を参照。

## 設計思想

**誰でも同じアーキテクチャをコピー可能、公式が「これが公式」と表明したものが公式扱いになる**。

- 各開発者は自分の program keypair を生成 → 自分の Config PDA + 自分の License Collection を持つ
- 公式は別途 README / website で公式 program ID / network.json を公開する
- ローカルの `network.json` と `keys/` はすべて gitignore

これは [Title Protocol の `programs/title-config/README.md`](../../../title-protocol/programs/title-config/README.md) と対称的な設計。

## Prerequisites

| Tool | Notes |
|------|-------|
| [Rust](https://rustup.rs/) | |
| [Solana CLI / Agave](https://github.com/anza-xyz/agave) **3.1.14+** | `agave-install init 3.1.14` (古い 2.1.x は cargo 1.79 同梱で edition2024 対応不可) |
| `cargo-build-sbf` | Solana CLI 同梱 |
| ~5 SOL on devnet | プログラムデプロイ ~2 SOL、残りは collection 作成等 |

## Step 1: Generate Program Keypair

開発者ごとに自分の program keypair を生成し、自分の独立した program ID を持つ。

```bash
mkdir -p target/deploy
solana-keygen new -o target/deploy/license_nft-keypair.json --force --no-bip39-passphrase
solana-keygen pubkey target/deploy/license_nft-keypair.json
# このキーが自分の program ID。次のステップで複数箇所に貼り付ける
```

## Step 2: Update `declare_id!`

新しい program ID を以下の **3 ファイル** に貼る:

| File | Location |
|------|----------|
| `programs/license-nft/src/lib.rs` | `declare_id!("...")` |
| `Anchor.toml` | `[programs.localnet]` と `[programs.devnet]` の `license_nft` |
| `crates/cli/src/commands/init_config.rs` | `DEFAULT_PROGRAM_ID` |

(将来 SDK を追加した場合はそこにも追加すること。)

## Step 3: Build

```bash
cargo build-sbf --manifest-path programs/license-nft/Cargo.toml
```

> Workspace ルートで `cargo build-sbf` だと CLI クレート (tokio 等 host-only deps) まで SBF target でコンパイルされてエラーになる。必ず `--manifest-path` で license-nft に絞る。

`target/deploy/license_nft.so` が生成される。

## Step 4: Deploy

```bash
solana program deploy target/deploy/license_nft.so \
  --program-id target/deploy/license_nft-keypair.json \
  --url devnet
```

Solana CLI のデフォルトウォレットが payer になる。~2 SOL 必要。

## Step 5: Build CLI

```bash
cargo build --release -p license-cli
```

## Step 6: Initialize Config + License Collection

```bash
./target/release/license-cli init-config \
  --cluster devnet \
  --title-core-collection <TitleCore_Collection_Pubkey> \
  --usdc-mint <USDC_Mint_Pubkey>
```

これは **idempotent ではない** (現状)。Config PDA が既存ならエラー。再実行する場合は事前に `solana program close` で program を破棄する必要あり。

実行内容:

1. `keys/authority.json` を読み込む or 新規生成
2. devnet なら airdrop (残高 < 1 SOL の場合)
3. License MPL Core Collection を新規作成 (`update_authority = Config PDA`、BubblegumV2 plugin 付き)
4. `initialize_config` を実行して Config PDA を作成
5. `network.json` を repo ルートに書き出し

### 引数の調達方法

- **TitleCore Collection**: `cat ../title-protocol/network.json | jq -r .core_collection_mint`
- **USDC mint** (devnet 用 mock): 別途 SPL Token CLI で作成、または既存の devnet mint を使う

```bash
# devnet で mock USDC を作る例:
spl-token create-token --decimals 6 --url devnet
# → Pubkey をメモ
```

## Output: `network.json`

`init-config` 後、リポジトリルートに `network.json` が生成される:

```json
{
  "cluster": "devnet",
  "program_id": "G1PWd1nMe63...",
  "config_pda": "...",
  "authority": "...",
  "title_core_collection": "...",
  "license_collection": "...",
  "usdc_mint": "...",
  "staker_basis_points": 9500,
  "delegate_basis_points": 500
}
```

`network.json` は **bootstrap 専用**。初期化後は **オンチェーンの Config PDA が真実**。
ファイル自体は `.gitignore` 済 — 各開発者の環境に固有。

## Trust Model

| 動作 | 必要な署名 |
|---|---|
| `initialize_config` (一度きり) | `authority` (admin keypair) |
| `update_config` (BPS / authority 変更) | `config.authority` |
| `issue_license` の License NFT mint | buyer + delegate (co-sign) のみ。**admin 不要** |
| `claim_revenue` | staker 本人のみ |

License Collection の `update_authority = Config PDA` のため、
**admin keypair が漏洩しても License Collection に偽 cNFT を mint できない**
(= TP の TitleCore Collection より trust model が強い)。

License NFT の発行は完全に program code path 経由でしか起きないことが
オンチェーン強制される。

## Program Instructions Reference

| Instruction | 役割 | Required Signers |
|---|---|---|
| `initialize_config` | Config PDA を初期化、Collection / USDC pin | `authority` (admin) |
| `update_config` | BPS / authority 更新 (Collection / USDC は不変) | `config.authority` |
| `issue_license` | License NFT 発行 + USDC 95:5 分配 | `buyer` + `delegate` (co-sign) |
| `claim_revenue` | UserRevenue PDA から USDC 引き出し | `user` (staker) |

## Next Steps

- [ ] License Bubblegum tree 作成 CLI コマンド (`create-license-tree`) — Phase 3
- [ ] TS SDK (`sdk/ts/`) — buyer / delegate 用クライアント
- [ ] Co-sign API server (Unit E) — RootLens が delegate として co-sign する HTTP エンドポイント
- [ ] 監査 grade テスト (`tests/license-nft/`) — happy path + adversarial 15 cases
