# Quick Start — RootLens License NFT

License NFT Anchor プログラムを devnet にデプロイし、Config + License Collection を初期化する。

> アーキテクチャと trust model は [`SPECS_JA.md` §5](SPECS_JA.md) を参照。
> Title Protocol との対称性については [`tasks/06-license-nft-program/README.md`](tasks/06-license-nft-program/README.md) を参照。

---

## Prerequisites

| Tool | Install |
|------|---------|
| [Rust](https://rustup.rs/) | |
| [Solana CLI / Agave](https://github.com/anza-xyz/agave) **3.1.14+** | `agave-install init 3.1.14` |
| ~5 SOL on devnet | プログラムデプロイ ~2 SOL + 残り collection 作成等。[faucet.solana.com](https://faucet.solana.com) |
| Title Protocol が devnet に既にデプロイ済 | TitleCore Collection の pubkey を取得するため |

---

## Phase 1: Network Setup (一度きり)

License NFT プログラムをビルド + デプロイ + 初期化する。`network.json` が生成される。

```bash
# 1. Program keypair を生成 (自分の独立した program ID)
mkdir -p target/deploy
solana-keygen new -o target/deploy/license_nft-keypair.json --force --no-bip39-passphrase
solana-keygen pubkey target/deploy/license_nft-keypair.json
# このキーを以下 3 ファイルの program ID に貼る:
#   - programs/license-nft/src/lib.rs (declare_id!)
#   - Anchor.toml ([programs.localnet] / [programs.devnet])
#   - crates/cli/src/commands/init_config.rs (DEFAULT_PROGRAM_ID)

# 2. プログラムをビルド
cargo build-sbf --manifest-path programs/license-nft/Cargo.toml

# 3. devnet にデプロイ
solana program deploy target/deploy/license_nft.so \
  --program-id target/deploy/license_nft-keypair.json \
  --url devnet

# 4. CLI ビルド
cargo build --release -p license-cli

# 5. Config PDA + License Collection を初期化
./target/release/license-cli init-config \
  --cluster devnet \
  --title-core-collection $(jq -r .core_collection_mint ../title-protocol/network.json) \
  --usdc-mint <YOUR_USDC_MINT_PUBKEY>
```

詳細は [`programs/license-nft/README.md`](programs/license-nft/README.md) を参照。

`network.json` がリポジトリルートに生成されたら Phase 1 完了。

---

## Phase 2: License Tree 作成 (未実装)

Phase 1 で program と Collection が用意されたら、次は License NFT を mint するための Bubblegum tree を作る。`license-cli create-license-tree` コマンドを今後追加予定。

Tree がいっぱいになったら同コマンドで新しい tree を作り、以降の `issue_license` 呼び出しで新 tree address を渡せばよい。program 側の変更は不要 (SPECS §5.2)。

---

## Phase 3: クライアント / SDK (未実装)

- TS SDK (`sdk/ts/`): buyer / delegate / staker 用ヘルパー
- Co-sign API server (Unit E): RootLens が delegate として `issue_license` に co-sign する HTTP エンドポイント

---

## What's Next

| Goal | Guide |
|------|-------|
| 全体仕様を理解する | [SPECS_JA.md](SPECS_JA.md) |
| プログラム単体ユニットの設計 | [tasks/06-license-nft-program/README.md](tasks/06-license-nft-program/README.md) |
| Title Protocol を立ち上げる (前提) | [../../../title-protocol/QUICKSTART.md](../../../title-protocol/QUICKSTART.md) |
| 既存サンドボックス (RN アプリ) | [app/](../../app/) |

---

## Repository Layout

```
root-lens/
├── programs/
│   └── license-nft/          ← Anchor program (Unit D)
│       ├── src/
│       │   ├── lib.rs
│       │   ├── state.rs
│       │   ├── error.rs
│       │   └── instructions/
│       └── README.md          ← Phase 1 詳細
├── crates/
│   └── cli/                   ← license-cli (init-config 等)
│       └── src/
├── document/
│   └── v0.1.2/
│       ├── SPECS_JA.md        ← 全体仕様
│       └── tasks/
│           ├── 01..05         ← Sandbox 検証 (使い捨て)
│           └── 06-license-nft-program/   ← Unit D 設計 doc
├── app/                       ← Expo / React Native (sandboxes 01-05)
├── Anchor.toml
├── Cargo.toml                 ← workspace
├── network.json               ← gitignore (Phase 1 出力)
└── keys/                      ← gitignore (authority.json 等)
```

Title Protocol との対称性:

| 役割 | RootLens License | Title Protocol |
|------|------------------|----------------|
| Anchor program | `programs/license-nft/` | `programs/title-config/` |
| CLI | `crates/cli/` (license-cli) | `crates/cli/` (title-cli) |
| Bootstrap output | `network.json` | `network.json` |
| 認証鍵置き場 | `keys/authority.json` | `keys/authority.json` |
| Collection 種別 | License (1 個, MPL Core) | Core + Extension (2 個, MPL Core) |
| Collection update_authority | **Config PDA** (より強い trust) | admin keypair (delegate plugin で TEE をホワイトリスト) |
