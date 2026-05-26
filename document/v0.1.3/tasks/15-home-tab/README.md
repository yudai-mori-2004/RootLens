# タスク 15: ホームタブ (クリップ管理 + ステーキング + 収益)

UI_SPECS_JA.md §3 のホームタブ全体を実装する。

## 画面構成

### コレクション一覧 (§3.2)

- クリップのカード一覧 (サムネイル + 状態バッジ)
- 状態: アップロード中 / アップロード失敗 / 処理中 / ready / staked / エラー
- フィルタ (状態別) + ソート (スコア順 / 日時順)

### クリップ詳細 (§3.3, §3.4)

- ready 状態: プレビューフレーム、品質スコア + 内訳、タスク情報、「ステーキングする」/「削除する」
- staked 状態: 上記 + ステーキング日時、License NFT 数、累積収益、「アンステークする」

### ステーキング確認シート (§3.5)

- ぼかし済みプレビュー
- 品質スコアと内訳
- 想定報酬レンジ
- 撤回不能性チェックボックス + 二段階確認
- Bubblegum delegate 命令 (Privy wallet 署名)

### 収益セクション (§3.6)

- 未引き出し残高 (USDC)
- 引き出しボタン (`claim_revenue`)
- 収益履歴

## サーバ API (実装済)

```
GET  /api/clips/:id     → クリップ詳細 (state, qualityScore, qualityBreakdown, rootAssetId)
GET  /api/clips          → 一覧 (wallet pubkey でフィルタ)
```

ステーキング / 収益分配は v0.1.2 の License NFT Solana program が処理する。
アプリからは Bubblegum delegate + claim_revenue の tx を組んで Privy wallet で署名。

## 完了条件

- 撮影済みクリップが一覧に表示される (状態バッジが正しく遷移)
- ready クリップの詳細画面でスコア内訳が確認できる
- ステーキング実行でオンチェーン delegate が設定される
