# Troubleshooting

## `cargo build-sbf` で `feature 'edition2024' is required`

```
error: failed to download `constant_time_eq v0.4.2`
Caused by: feature `edition2024` is required
```

原因: `cargo-build-sbf` 同梱の Rust が古い (1.79.0)。Solana CLI 2.1.x がそのバージョン。

修正:
```bash
agave-install init 3.1.14
cargo-build-sbf --tools-version --help
# → rustc 1.89.0 / platform-tools v1.52 になることを確認
```

## `Stack offset of 4104 exceeded max offset of 4096`

`#[derive(Accounts)]` が生成する `try_accounts` の stack frame が SBF の 4096B 制約を超えた。

修正: `Account<'info, T>` を `Box<Account<'info, T>>` に変える。`UncheckedAccount` 等の小さな型は対象外で OK。

## `init-config` が `Config PDA は既に初期化済` と言う

すでに deploy した program に対して再度 `init-config` を打つと出る。現状の CLI は idempotent でない (TP の `init_global` のような既存検出 + update フローは未実装)。

回避策: 全部やり直す場合は `solana program close <PROGRAM_ID> --recipient <PUBKEY>` で program を closure → keypair を捨てて Step 1 から。
本番では idempotent な実装が必須なので todo として残す。

## License Collection の Bubblegum V2 plugin が無い

`init-config` で作った Collection は必ず BubblegumV2 plugin 付き。手動で `mpl-core create-collection` した場合は必ず `--plugin BubblegumV2` を付ける。

BubblegumV2 plugin は **Collection 作成時にのみ** 追加可能。後から `AddCollectionPluginV1` では追加不可 (permanent plugin)。

## DAS で License NFT が見えない

Helius / Triton 等の DAS API はインデックスに数秒〜数十秒のラグあり。発行直後は反映されていないことがある。

確認手順:
1. Solscan の cluster=devnet で発行 tx を見る → success/failed
2. 数十秒待つ
3. DAS 直叩き: `getAssetsByGroup { groupingKey: "collection", groupValue: <license_collection> }`

## `error: failed to select a version for solana-program`

Anchor / spl-account-compression / mpl-bubblegum の組み合わせで version 衝突。
推奨組み合わせ (検証済 2026-05-09):
- `anchor-lang = "0.31.1"`
- `anchor-spl = "0.31.1"`
- `mpl-bubblegum = "2.1.1"`
- `spl-account-compression = "1.0.0"` (`features = ["cpi"]`)
- `spl-noop = "1.0"` (transitive 一致用)

`solana-program = "X"` を license-nft の Cargo.toml に直書きしない (Anchor が引き込むので衝突原因になる)。
