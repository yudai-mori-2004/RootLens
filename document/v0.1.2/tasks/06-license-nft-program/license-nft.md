# RootLens License NFT — Architecture

## 全体像

RootLens は Title Protocol の上に積む application layer。3 層構成:

```
┌─────────────────────────────────────────────────────────────┐
│  Title Protocol (TP)                                        │
│  TEE で C2PA 検証 → Root NFT (cNFT) を TitleCore Collection に発行 │
│  → 動画コンテンツの "passport"                                  │
└─────────────────────────────────────────────────────────────┘
                            ↓ Bubblegum delegate
┌─────────────────────────────────────────────────────────────┐
│  Stake Layer (Bubblegum 標準)                                │
│  ユーザーが Root NFT の delegate を RootLens addr に設定         │
│  → 利用許諾 + License 発行 co-sign 権限を委譲                    │
└─────────────────────────────────────────────────────────────┘
                            ↓ delegate co-signs
┌─────────────────────────────────────────────────────────────┐
│  License NFT Program (本リポ Unit D)                          │
│  buyer + delegate co-sign で issue_license                   │
│  → License NFT (cNFT) を License Collection に発行             │
│  → USDC 95:5 分配 (atomic)                                    │
└─────────────────────────────────────────────────────────────┘
```

## Trust Model

### Root NFT (TP)

- **Collection**: TitleCore (MPL Core)
- **Update authority**: TP の admin keypair (DAO wallet)
- **Mint authority**: TitleCore Collection の `UpdateDelegate` plugin に登録された TEE pubkey たち
- **保証**: TitleCore に属する Root NFT は、必ず TP の正規 TEE が C2PA 検証して発行したもの

TP では複数 TEE ノードが同じ Collection に並列に mint する必要があるため、`UpdateDelegate` plugin で delegate 分散している。

### License NFT (本プログラム)

- **Collection**: License Collection (MPL Core)
- **Update authority**: 本プログラムの **Config PDA** (= `find_program_address(["config"], program_id)`)
- **Mint authority**: 本プログラム経由のみ (Config PDA seeds で `MintV2` CPI を sign)
- **保証**: License Collection に属する License NFT は、必ず本プログラムの `issue_license` を経由して発行されたもの = USDC 分配等のロジックが必ず実行されている

License は単一プログラム発行なので delegate 分散が不要 → TP より強い trust:

| 攻撃 | TP TitleCore | RootLens License |
|---|---|---|
| admin keypair 漏洩 | 偽 cNFT 発行可能 (admin = update_authority) | 不可能 (update_authority = Config PDA) |
| 偽 mint authority | 不可能 (TEE delegate のみ) | 不可能 (program code path のみ) |
| 偽 Collection で偽装 | 不可能 (collection_hash で検証) | 不可能 (collection_hash で検証) |

## Account Structure

```
license-nft program
├── Config PDA (seeds=[b"config"])
│   ├── authority:               admin (update_config 権限のみ)
│   ├── title_core_collection:   TP TitleCore のアドレス (immutable after init)
│   ├── license_collection:      License Collection のアドレス (immutable after init)
│   ├── usdc_mint:               受け払い通貨 (immutable after init)
│   ├── staker_basis_points:     初期 9500
│   └── delegate_basis_points:   初期 500
│
├── UserRevenue PDA (seeds=[b"revenue", staker_pubkey])
│   ├── user:    staker (改ざん検知用)
│   └── balance: 未分配 USDC
│
├── tree_authority PDA (seeds=[b"tree_authority", license_merkle_tree])
│   └── License Bubblegum tree の MintV2 signer (Bubblegum 側で tree 作成時に登録)
│
└── pool_usdc (Token Account, owner=Config PDA)
    └── USDC pool (claim_revenue でのみ出金可)

License Collection (MPL Core)
├── update_authority = Config PDA
└── plugin: BubblegumV2 (作成時のみ追加可、authority=Bubblegum program)

License Bubblegum Tree (Bubblegum)
├── tree_authority = license_tree_authority PDA (本プログラム所有)
└── leaves: License NFTs (buyer 宛)
```

## issue_license の検証 (audit grade)

呼び出し時のフロー:

```
Input args:
  Root NFT proof:  root, nonce, index, data_hash, creator_hash, asset_data_hash, flags, root_collection
  License args:    license_metadata_uri, license_name
  Pricing:         price

Step 1: price > 0 チェック
Step 2: root_collection == config.title_core_collection で TitleCore 一致確認
Step 3: collection_hash = hash_collection_option(Some(root_collection))
Step 4: LeafSchema::V2 構築 (id=get_asset_id, owner=staker, delegate=co_signer, ...)
Step 5: spl_account_compression::verify_leaf で Bubblegum proof 検証
        → leaf 内の (owner, delegate, collection_hash) が現 tree 状態と一致することを暗号学的に保証

Step 6: split 計算 (delegate_share = price - staker_share で 1 unit 誤差吸収)
Step 7: MintV2 CPI (License NFT を license_merkle_tree に buyer 宛 mint)
        signers: license_tree_authority PDA + Config PDA (collection_authority)
Step 8: Token transfer buyer → pool (staker_share)
Step 9: Token transfer buyer → delegate (delegate_share)
Step 10: user_revenue.balance += staker_share (checked_add)
        init_if_needed の場合は user フィールドに staker pubkey を記録 (改ざん検知)
```

すべて 1 トランザクション内で atomic。失敗すれば全ロールバック。

## DAS Filter (DAS = Solana の cNFT インデクサ)

正規の License NFT のみを取得する場合:

```
DAS getAssetsByGroup
  groupingKey:  "collection"
  groupValue:   <license_collection_pubkey from network.json>
```

これで本プログラム発行 License NFT のみが返る。攻撃者が独自の Bubblegum tree を立てて偽 License を mint しようとしても License Collection には属せないため絶対にこのフィルタを通らない。

## Reproducibility

各開発者は自分の `license_nft-keypair.json` を生成 → 自分の program ID + Config PDA + License Collection を持つ。
公式は別途 README / web で公式の `program_id` と `network.json` を公開する。

各環境の `network.json` は gitignore。bootstrap 後はオンチェーンの Config PDA が真実。
