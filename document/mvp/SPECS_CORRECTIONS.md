# SPECS.md 修正箇所リスト

**日付**: 2025-01-17
**対象**: document/mvp/SPECS.md

---

## ✅ 正確な箇所（変更不要）

以下の箇所は現在のコードベースと完全に一致しています:

- 技術スタック（Next.js 16.0.10, React 19.2.0, Tailwind CSS 4.x）
- アーキテクチャ図
- データモデル（Supabase, Arweave, cNFT構造）
- 環境変数
- APIエンドポイント
- デプロイメント構成（Vercel, Railway, Upstash Redis, Cloudflare Workers）
- Dashboard機能
- Lens機能
- 国際化対応（next-intl）
- 購入フロー（SolanaPay）

---

## ⚠️ 修正が必要な箇所

### 1. Worker側C2PA検証の欠如

**該当箇所**: 行500-513「Step 3: クライアントサイドC2PA検証(WASM)」

**問題**: フロントエンドのみでC2PA検証を行っており、Worker側での再検証がない。

**修正内容**:
```markdown
┌─────────────────────────────────────────────────────────────────┐
│  Step 3: クライアントサイドC2PA検証(WASM)                       │
│  ├─ c2pa.read(file) でManifest Storeを解析                      │
│  ├─ Ingredientsを再帰的に遡り、Rootを特定                        │
│  ├─ Root署名証明書が信頼済みリスト(ハードウェアCA)に含まれるか確認│
│  │   ★現在対応: Google Pixel のみ                              │
│  │   ・signatureInfo.issuer が "Google LLC" に一致              │
│  │   ・targetLabel: "c2pa.hash.data.part"                      │
│  │   ・他デバイス(Sony, Leica等)は動作確認後に順次有効化        │
│  ├─ root_signer(CA名)を抽出                                   │
│  ├─ 証明書チェーン(cert_chain)をBase64エンコード               │
│  ├─ サムネイルをData URIに変換                                  │
│  └─ 検証失敗 → エラー表示、アップロード不可                       │
│                                                                 │
│  ⚠️ この検証はフロントエンドのみ (Worker側では未再検証)        │
│  ※ Phase2でWorker側再検証を実装予定                            │
└─────────────────────────────────────────────────────────────────┘
```

**該当箇所**: 行562-571「Step 9: Mintジョブを投入」

**追加内容**:
```markdown
│  ├─ POST /api/upload で以下のデータを送信:                      │
│  │   - userWallet                                              │
│  │   - originalHash                                            │
│  │   - rootSigner  ⚠️ Worker側で未再検証                       │
│  │   - rootCertChain  ⚠️ Worker側で未再検証                    │
│  │   - mediaFilePath                                           │
│  │   - thumbnailPublicUrl                                      │
│  │   - price, title, description                               │
```

**該当箇所**: 行587-593「Step 12: Arweaveアップロード」

**追加内容**:
```markdown
│  Step 12: Arweaveアップロード(Umi + Irys)              │
│  ├─ 証明参照データJSONを作成:                            │
│  │   - target_asset_id: 予測したcNFTアドレス            │
│  │   - image: サムネイル公開URL(R2)                   │
│  │   - attributes: ハッシュ、署名者、証明書チェーン等    │
│  │      ⚠️ フロントエンドからの値をそのまま使用         │
│  └─ umi.uploader.uploadJson()                           │
```

---

### 2. MVP段階の制限事項セクションを追加

**挿入箇所**: 「## 🔄 ユーザーフロー」の直前（行480付近）

**追加内容**:
```markdown
---

## ⚠️ MVP段階の制限事項

### 1. Worker側でのC2PA再検証なし

**現状**:
- フロントエンドから送信される `rootSigner`/`rootCertChain` をそのまま信頼
- 攻撃者が `/api/upload` を直接叩くことで偽装が可能
- RootLens上の表示は騙される（ダウンロード後のc2pa.read()では偽造が発覚）

**対策計画**: Phase2で実装
- Worker側でR2から元ファイルをダウンロード
- Node.js版C2PAライブラリでの再検証
- フロントエンドからの値を破棄し、検証済みの値を使用

詳細: `document/phase2/backend-c2pa-verification.md`

### 2. 単一Merkle Tree構成

**現状**:
- `concurrency: 1` による完全直列処理
- 10人同時アップロード時、最大5分待ち

**拡張計画**: Phase2以降で検討
- 100個のMerkle Treeをランダム振り分け
- 並列度100倍、自然な重複解決メカニズム
- UNIQUE制約による冪等性保証

詳細: `document/phase2/multi-tree-scalability.md`

### 3. 対応デバイス

**現在有効**: Google Pixel のみ
**保留中**: Sony, Leica, Nikon, Canon, Adobe
**理由**: 動作確認後に順次有効化

---
```

---

### 3. アーキテクチャ図に制限事項を追加

**該当箇所**: 行89-94「Worker (Node.js / Railway デプロイ)」

**追加内容**:
```markdown
│  ┌──────────────────────────────────────────────────────────┐  │
│  │         Worker (Node.js / Railway デプロイ)               │  │
│  │  ・次のcNFTアドレス予測 (TreeConfig.numMinted参照)         │  │
│  │  ・Arweaveアップロード (Umi + Irys)                       │  │
│  │  ・cNFT mint (Arweave URI設定)                            │  │
│  │  ・concurrency: 1 で完全直列処理                          │  │
│  │  ・HTTP API (/health, /metrics, /api/upload)             │  │
│  │                                                           │  │
│  │  ⚠️ MVP制限: Worker側でのC2PA再検証なし                  │  │
│  │  → Phase2で実装予定 (document/phase2参照)                │  │
│  └──────────────────────────────────────────────────────────┘  │
```

---

### 4. Solanaのキャプション修正

**該当箇所**: 行103「Solana」

**修正前**:
```
│  │   Solana    │  │
│  │   cNFT     │  │
│  │ (BubbleGum)│  │
```

**修正後**:
```
│  │   Solana    │  │
│  │   cNFT     │  │
│  │ (BubbleGum)│  │
│  │ 単一Tree   │  │
```

---

### 5. Phase2ロードマップに項目追加

**該当箇所**: 行1424-1441「次フェーズ: 本番運用・改善」

**修正後**:
```markdown
### Phase2: セキュリティ・スケーラビリティ強化

| カテゴリ | タスク | 優先度 | 参照 |
| --- | --- | --- | --- |
| **セキュリティ** | Worker側C2PA再検証 | 🔴 最高 | document/phase2/backend-c2pa-verification.md |
| **スケール** | 複数Merkle Tree対応 | 🟡 中 | document/phase2/multi-tree-scalability.md |
| **デバイス対応** | Sony, Leica, Nikon, Canon検証・有効化 | 🔴 高 | - |
| **信頼性** | モニタリング・ログ基盤 | 🔴 高 | - |
|  | エラー通知システム | 🔴 高 | - |
|  | バックアップ戦略 | 🟡 中 | - |
| **パフォーマンス** | 画像最適化・CDN | 🟡 中 | - |
|  | キャッシュ戦略 | 🟡 中 | - |
|  | インデックス最適化 | 🟢 低 | - |
| **機能追加** | NFT譲渡履歴表示 | 🟡 中 | - |
|  | コレクション機能 | 🟢 低 | - |
|  | コメント機能 | 🟢 低 | - |
```

---

### 6. MVP完成表に注記追加

**該当箇所**: 行1396-1398「C2PA検証」

**修正前**:
```
| **アップロード** | C2PA検証(WASM) | ✅ 完了 |
```

**修正後**:
```
| **アップロード** | C2PA検証(WASM - フロントエンドのみ) | ✅ 完了 |
```

---

## 📊 修正箇所サマリー

| 修正箇所 | 種別 | 重要度 |
| --- | --- | --- |
| Worker側C2PA検証の注記追加 | 追加 | 🔴 高 |
| MVP制限事項セクション追加 | 追加 | 🔴 高 |
| Phase2ロードマップ更新 | 修正 | 🟡 中 |
| アーキテクチャ図の注記追加 | 追加 | 🟡 中 |
| Solanaキャプション修正 | 修正 | 🟢 低 |
| MVP完成表の注記追加 | 修正 | 🟢 低 |

---

## 📝 推奨される対応

1. **document/mvp/SPECS.md** を上記の修正内容に基づいて更新
2. **document/phase2/** ディレクトリの内容を参照として明記
3. Notion等への転記時は、このドキュメントと合わせて確認

---

## ✅ Notionコピペ用フォーマット

上記の修正を適用したSPECS.mdは、以下の特徴を持ちます:

- ✅ Markdownフォーマット（Notion互換）
- ✅ 全1570行の完全な仕様書
- ✅ 現在のコードベースと完全一致
- ✅ MVP制限事項を明記
- ✅ Phase2計画への参照を含む

**推奨手順**:
1. 元の `document/mvp/SPECS.md` を開く
2. 上記の修正箇所を適用
3. Notionにコピーペースト
