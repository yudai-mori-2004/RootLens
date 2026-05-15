# tests/license-nft

License NFT Anchor program (`G1PWd1nMe63isDaYT3iijcyWac9d4RE1CBrvaKZFjpV8`) の
監査グレードテストと、 SPECS_JA §5.5.3 第三者検証チェーンの確認スクリプト群を置く。

## 種類

| 種別 | 内容 | 実行 |
|---|---|---|
| **spec** (`*.spec.ts`) | vitest で走る整合 / 攻撃テスト。 一部は devnet 実打 (timeout 60 秒) | `npm test` |
| **setup スクリプト** (`setup*.ts`) | devnet に Bubblegum tree / MPL Core collection を 1 度だけ作る。 結果は `fixtures*.json` に書き出される (= ローカル artifact、 commit しない) | `npx tsx setup*.ts` |
| **CLI ツール** (`*-cli.ts`, `verify-*.ts`, `issue-*.ts`, `simulate-*.ts`) | 運用 / デバッグ用、 オフチェーン読み + chain 操作 | `npx tsx ...` |

## fixtures

| ファイル | 何を持つか | 必要な前提 |
|---|---|---|
| `fixtures.json` | 監査テスト用の最小 root tree (depth=5, canopy なし) と leaf 5 個 | `setup.ts` を 1 度実行 |
| `fixtures-canopy.json` | License 発行を実 chain で完走させるための production 想定 root tree (depth=14, canopy=10) と leaf 3 個。 leafDelegate を prod cosign delegate に固定 | `setup-canopy-root-tree.ts` を 1 度実行 |

両方とも `.gitignore` 対象 (= leaf owner secret key を含むため絶対に commit しない)。

## 第三者検証チェーン (= task 14 の `verification-script`)

License NFT asset id だけを手元に持って、 SPECS_JA §5.5.3 step 1-4 を完走させる。

```bash
npx tsx verify-license-chain.ts <license_nft_asset_id> [<asset_id> ...]
```

step 1: License Collection 所属  
step 2: leaf.uri 取得  
step 3: URI から `?root_mint=` parse (Layer 1 binding)  
step 4: `sha256(JSON bytes) == URL hash` (Layer 2 binding)

step 5-6 (Root NFT 側 → TP collection / content_hash) は Extension cNFT
(`rootlens-license-v1` WASM) が未実装のため別スクリプトで担当する想定。

## License NFT を実 chain で発行する手順

「prod の `/api/v1/license/issue` を叩いて partial-signed tx を取り、 buyer 署名を
追加して devnet に broadcast する」 までを再現する。

### 1. Root NFT tree を 1 度だけ用意

```bash
npx tsx setup-canopy-root-tree.ts
```

冪等。 既に `fixtures-canopy.json` 内で記録済みかつ chain 上にも存在するなら skip
する。 中断 / 失敗時は再実行で続きから再開する (collection 作成 1.13 SOL を二重支払
いしない)。

deployer wallet (`keys/deployer.json`) に rent ぶんの SOL が必要 (depth=14
canopy=10 で約 1.5 SOL)。

### 2. on-chain Config を新 collection に切り替え

```bash
npx tsx update-config-cli.ts \
  --root-collection $(jq -r .root_nft_collection fixtures-canopy.json)
```

`update_config` は authority (`keys/authority.json`) で署名する。

### 3. License NFT を発行

新 leaf の asset id は DAS で `getAssetsByOwner(<leaf_0 owner>)` で導出する。
buyer keypair は env 経由:

```bash
BUYER_KEYPAIR_BASE58=<base58> \
  npx tsx issue-license-via-api.ts --root <leaf asset id>
```

デフォルトで commercial-v1 / training-only-v1 / redistribution-v1 の 3 本を発行する。
個別に絞るなら `--type commercial-v1` を複数渡す。

### 4. 検証

```bash
npx tsx verify-license-chain.ts <発行された License NFT asset id> ...
```

4 step すべて PASS で Layer 1 / Layer 2 binding 成立を確認できる。

## デバッグ: simulate モード

broadcast せずに on-chain 挙動だけ見たい場合。 issue が落ちる原因 (= proof
mismatch / collection mismatch / preflight 等) のログを直接読める:

```bash
BUYER_KEYPAIR_BASE58=<base58> \
  npx tsx simulate-issue-license.ts \
    --root <root asset id> \
    --license-url <licenseUrl from web/lib/license-nft/catalog.ts>
```

## ユニットテスト

`web/lib/license-nft/canopy.ts` の pure 関数 (`inferCanopyDepth`,
`truncateProofForCanopy`) は `web/lib/license-nft/__tests__/canopy.test.ts` で
独立テストされる。 web/ 側で:

```bash
cd ../../web && npm test
```

## 既存の整合 / 攻撃テスト spec

| ファイル | 検証範囲 |
|---|---|
| `01-update-config.spec.ts` | `update_config` の境界 (BPS 範囲、 authority 検証、 has_one) |
| `02-claim-revenue.spec.ts` | ステーカー収益の引き出し |
| `03-issue-license.spec.ts` | `issue_license` の adversarial cases |
| `04-issue-happy.spec.ts` | `issue_license` の happy path (= 5 leaf 全パターン) |

これらは `fixtures.json` の存在を前提とするので、 初回は `setup.ts` を走らせる必要
がある。 vitest は `pool: 'forks'` の `singleFork: true` で sequential 実行する
(chain state 共有のため)。

### fixture 破損時の挙動

`fixtures.json` のリーフは devnet 上の永続 chain 状態を指している。 アプリの
staking 機能や別セッションの操作で同じリーフに対する `delegate` を上書きすると、
fixture と chain 状態が乖離して当該リーフを使う spec が `Invalid root recomputed
from proof` で fail する (= leaf hash 計算式の入力 (= delegate) が両者で違うため)。

単一リーフだけ再 mint するなら `regen-leaf.ts`:

```bash
npx tsx regen-leaf.ts --index 4
```

既存 `root_tree` に新 owner / delegate Keypair の leaf を 1 個 mint し、
`fixtures.json[leaves][index]` を新エントリで上書きする。 他のリーフ / tree /
collection には触らない。 SOL は ~0.001 SOL のみ。

全リーフ作り直しが必要なら `fixtures.json` を削除してから `setup.ts` を再実行
(= 新ツリー含めて全部) — SOL を ~1 SOL 消費する。

既知の壊れやすいリーフ:

- `leaves[4]`: アプリの staking フローが消費しうる (= prod cosign delegate `HbVs4...`
  に書き換わる)。 A11 (insufficient USDC test) が hit する。 `regen-leaf.ts --index 4`
  で復旧。
