# Task 07 / Unit E: Co-sign API Server

## 位置付け

**統合ユニット (production-bound)。** SPECS_JA §5.3 + §6.3 の co-sign フローを実装する RootLens サーバ。Unit D (License NFT Anchor program) を実際にクライアントから叩けるようにする最小の API surface。

## 設計方針

contract (Unit D) が audit-grade で守ってくれる範囲は **再チェックしない**。サーバが見るのは **catalog membership だけ**。

クライアントから partial-signed tx を受け取って検証する方式は採用しない。代わりに **サーバが tx を構築** する。これで:

- IX whitelist 不要 (サーバが組むから他の IX が混ざらない)
- URL allowlist 不要 (catalog key にある時点で公開済 URL)
- price floor 比較不要 (catalog の値がそのまま price になる)
- tx 引数改竄チェック不要 (tx を受け取らない)

検証は 1 つだけ: **`(rootAssetId, licenseUrl)` が catalog にあるか**。

## 仕様参照

- SPECS_JA §5.3 (co-sign による発行フロー)
- SPECS_JA §6.3 (販売条件と価格決定)
- SPECS_JA §5.5.3 (License URL 形式)
- `programs/license-nft/` (Unit D — 呼び出し対象)

## API 仕様

### POST `/api/license/co-sign`

**Request body** (JSON):
```ts
{
  rootAssetId: string;   // base58 — Root NFT (cNFT) の asset id
  licenseUrl: string;    // 公開済ライセンスカタログから選んだ URL
  buyerAddress: string;  // base58 — 買い手の Solana address
}
```

**Response 200**:
```ts
{ partialSignedTx: string }  // base64 — delegate 署名済、買い手の署名待ち
```

**Response 404**:
```ts
{ error: "NOT_LISTED" }  // (rootAssetId, licenseUrl) が catalog に無い
```

**Response 4xx / 5xx**:
```ts
{ error: "INVALID_INPUT" | "DAS_LOOKUP_FAILED" | "INTERNAL_ERROR"; detail?: string }
```

### サーバ処理 (順次)

1. body 形式検証 (3 fields の存在 + base58 形式)
2. catalog lookup `(rootAssetId, licenseUrl) → price`、無ければ 404
3. DAS で `getAsset(rootAssetId)` → owner (= staker), tree, leaf_index, nonce
4. DAS で `getAssetProof(rootAssetId)` → proof
5. on-chain Config (PDA) を読んで root_collection / usdc_mint
6. `issue_license` IX を構築 (引数: licenseUrl, price, buyer_share, proof, ...)
7. `fee_payer = buyerAddress`、recent_blockhash 設定
8. delegate 鍵で署名
9. partial-signed tx を base64 で返す

買い手は受け取った tx に自分の署名を足して broadcast。fee は買い手持ち。

## 構成

```
web/
├── app/api/license/co-sign/
│   └── route.ts              # POST handler
├── lib/cosign/
│   ├── catalog.ts            # YAML load + lookup
│   ├── build-tx.ts           # DAS + on-chain Config + IX 構築
│   ├── signer.ts             # env keypair (dev) / KMS (prod) 抽象化
│   └── types.ts
├── config/
│   └── cosign-catalog.yaml   # (rootAssetId, licenseUrl) → price のマップ
└── test/cosign/
    ├── 01-not-listed.test.ts
    ├── 02-happy.test.ts
    ├── 03-tx-shape.test.ts   # 構築された tx の IX が期待通り
    └── helpers.ts
```

### catalog.yaml の形

```yaml
# (rootAssetId, licenseUrl) → price (USDC, u64 = 6 decimals)
entries:
  - rootAssetId: 7gK...XYZ
    licenseUrl: https://rootlens.io/licenses/commercial-v1/<terms_hash>.json
    price: "1000000"  # 1 USDC
  - rootAssetId: 7gK...XYZ
    licenseUrl: https://rootlens.io/licenses/training-only-v1/<terms_hash>.json
    price: "500000"   # 0.5 USDC
  - rootAssetId: 9pQ...ABC
    licenseUrl: https://rootlens.io/licenses/commercial-v1/<terms_hash>.json
    price: "5000000"  # 5 USDC
```

このフェーズでは hand-edit + redeploy。後の unit で運営 dashboard / DB に置き換える。

## スタック

| 依存 | 用途 | 状態 |
|---|---|---|
| `next@16.1.6` | Route Handler | 既存 |
| `@solana/web3.js` | tx 構築 / sign | 追加 |
| `@coral-xyz/anchor` | License NFT IDL → IX 構築 | 追加 |
| `@aws-sdk/client-kms` | prod signing | 既存 |
| `yaml` | catalog 読み込み | 追加 |
| `vitest` | テスト | 既存 |

DAS endpoint (Helius / Triton) は env で。

## 環境変数

```
LICENSE_NFT_PROGRAM_ID=G1PWd1nMe63isDaYT3iijcyWac9d4RE1CBrvaKZFjpV8
DELEGATE_PUBKEY=<base58>
COSIGN_DELEGATE_PRIVATE_KEY_BASE58=<dev>
COSIGN_KMS_KEY_ID=<prod>
DAS_RPC_URL=https://...
COSIGN_CATALOG_PATH=./config/cosign-catalog.yaml
```

## 完了条件

- [ ] `POST /api/license/co-sign` で happy path が partial-signed tx を返す
- [ ] catalog に無い key で 404 NOT_LISTED
- [ ] tx を decode した時、IX = `issue_license` 1 個、引数が catalog の price と一致
- [ ] dev keypair / prod KMS の両 path が同 IF で動く (KMS は mock テスト)
- [ ] vitest 全 spec pass
- [ ] devnet で E2E ラウンドトリップ: client が API → 受領 tx に自署名 → broadcast → contract 実行成功

## 制限事項 (このフェーズ)

- Authentication / API key / IP allowlist 等は未実装 (別 unit)
- Rate limiting は Vercel / 上流 LB 任せ (別 unit)
- catalog は hand-edit + redeploy。動的更新 UI は無し
- バルク販売 (1 tx に複数 issue_license) は対象外
- audit log は console / Vercel logs のみ。Supabase 永続化は別 unit
