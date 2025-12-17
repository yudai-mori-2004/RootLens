# 複数Merkle Tree戦略の実現可能性分析

## 背景

現在の実装では、単一Merkle Treeで`concurrency: 1`のキュー処理を行っている。10人が同時にUploadした場合、最大5分（10 × 30秒）の待ち時間が発生する。

## 提案

100個のMerkle Treeをランダム振り分けで並列処理し、スループットを100倍に向上させる。

## 初期の懸念点

### 1. データベーススキーマの競合
**懸念**: `original_hash TEXT NOT NULL UNIQUE` 制約により、異なるTreeで同じハッシュをMintできないのでは？

**結論**: 問題なし。どのTreeでMintされようが、`original_hash`が同じ = 同一ファイルの証明。RootLensとして「同じファイルは一度だけ証明する」というビジネスルール。UNIQUE制約は意図された動作。

### 2. 並列処理時の競合状態（Race Condition）
**懸念**: 同じ`original_hash`のJobが異なるTreeで同時処理され、Arweave/cNFTの二重作成が発生するのでは？

**結論**: 問題なし。自然な解決メカニズムが存在する。
- Job1, Job2が同じ`original_hash`で並列処理
- 両方がArweaveアップロード・cNFT Mintを完了
- Supabase INSERT時に**片方がUNIQUE制約違反で失敗**
- **先に完了した方が正当な証明として記録される**（キューの順序保証）

Arweave/Solanaに冗長データが残るが、Supabaseに記録されるのは1つのみであり、システムとして整合性が保たれる。

## 最終結論

**100個のMerkle Treeランダム振り分けは実現可能。追加のロック機構は不要。**

## 実装要件

### 1. Tree選択ロジック
```typescript
function selectRandomTree(): string {
  const trees = process.env.MERKLE_TREE_ADDRESSES!.split(',');
  return trees[Math.floor(Math.random() * trees.length)];
}
```

### 2. 関数シグネチャ変更
- `predictNextAssetId(treeAddress: string)`
- `mintCNFT(data, treeAddress: string)`

### 3. データベーススキーマ
```sql
ALTER TABLE media_proofs
  ADD COLUMN merkle_tree_address TEXT;
```

### 4. Worker設定
```typescript
const worker = new Worker('rootlens-mint-queue', async (job) => {
  const selectedTree = selectRandomTree();
  return processMint(job.data, selectedTree, job.updateProgress);
}, {
  concurrency: 100,
});
```

### 5. 環境変数
```env
MERKLE_TREE_ADDRESSES=Tree1,Tree2,...,Tree100
```

## 期待される効果

- 並列度: 1 → 100（100倍）
- 10人同時Upload時の待ち時間: 最大5分 → 最大30秒
- システム整合性: 維持（UNIQUE制約による自然な重複排除）
