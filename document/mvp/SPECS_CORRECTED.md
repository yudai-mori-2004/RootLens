# RootLens 企画・仕様書（Ver.5 - MVP完成版）

**最終更新**: 2025-01-17
**ステータス**: 本番環境稼働中 (https://rootlens.io)

---

## 📋 概要

**RootLens**は、C2PAハードウェア署名とブロックチェーン技術を組み合わせ、AI時代における「現実」の価値を再定義し、保護するプラットフォームです。

### 技術の役割分担

| 技術 | 担当する役割 |
| --- | --- |
| **C2PA** | コンテンツの真正性証明、改ざん検出、来歴情報の保持 |
| **Blockchain** | 所有権の帰属先の明確化、権利の流動化(売買・譲渡)、乗っ取り防止 |

> **重要**: C2PAだけでもトラストレスな真正性検証は可能です。ブロックチェーンは「誰のものか」と「権利の流動性」を担います。

### 解決する課題

| 課題 | 解決技術 | RootLensの解決策 |
| --- | --- | --- |
| **AI生成コンテンツの氾濫** | C2PA | ハードウェア署名を検証し、実在性を暗号技術で担保 |
| **コンテンツの改ざん** | C2PA | 改ざんがあれば検出される(元データがあれば誰でも検証可能) |
| **所有権の不明確さ** | Blockchain | ウォレットに紐づけ、権利の帰属先を明確化 |
| **権利の乗っ取り** | Blockchain | Arweave ⇄ cNFT の相互リンク設計により乗っ取りを防止 |
| **権利の固定化** | Blockchain | NFTとして売買・譲渡が可能 |
| **収益化手段の欠如** | Blockchain | Solana Payによる直接取引で撮影者に対価を還元 |

### コアコンセプト

**「Root(始祖)がハードウェア署名であれば、編集済みデータも受け入れる」**

- 無加工のみを対象とせず、色調整・トリミング等を行った報道写真やアート作品も対象
- 重要なのは「どんなに加工されていても、その根っこ(Root)がハードウェア署名である」こと

### ターゲットユーザー

| ユーザー層 | ニーズ |
| --- | --- |
| フォトグラファー・ジャーナリスト | 撮影データの真正性証明、収益化 |
| 報道機関 | 情報源の信頼性担保、証明付きメディアの購入 |
| SNSインフルエンサー | 事実を扱うコンテンツの信頼性向上 |
| AI企業 | クリーンな学習データの調達・購入 |

---

## 🏗️ システムアーキテクチャ

### 全体構成

```
┌─────────────────────────────────────────────────────────────────┐
│                        クライアント                              │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │ アップロード     │  │ 証明書ページ     │  │ 購入            │ │
│  │ ・C2PA検証(WASM)│  │ ・Arweave読取り  │  │ ・SolanaPay     │ │
│  │ ・ハッシュ計算   │  │ ・cNFT検証       │  │ ・即時DL        │ │
│  └────────┬────────┘  │ ・相互リンク検証 │  │                 │ │
│           │           │ ・メディア表示   │  │                 │ │
│           │           └────────┬────────┘  └────────┬────────┘ │
└───────────┼───────────────────┼───────────────────┼────────────┘
            │                   │                   │
            ▼                   ▼                   ▼
┌─────────────────────────────────────────────────────────────────┐
│                  本番環境アーキテクチャ                           │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │            Next.js 16 (Vercel デプロイ)                   │  │
│  │  ・API Routes (ジョブ投入、ステータス確認)                 │  │
│  │  ・Presigned URL発行 (Private R2)                         │  │
│  │  ・Public Bucket直接アップロード (Manifest・サムネイル)     │  │
│  │  ・購入処理 (DB記録、DLリンク発行)                         │  │
│  │  ・next-intl (英語・日本語 完全対応)                       │  │
│  └──────────────────────┬───────────────────────────────────┘  │
│                         │ Job追加                               │
│                         ▼                                       │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │            Upstash Redis (TLS接続)                        │  │
│  │           (BullMQ ジョブキュー)                            │  │
│  │  ・rediss:// プロトコル                                    │  │
│  │  ・Vercel & Railway 共有                                  │  │
│  └──────────────────────┬───────────────────────────────────┘  │
│                         │ Job取得 (直列)                        │
│                         ▼                                       │
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
│                                                                 │
│      ┌───────────────┬───────────────┬───────────────┐          │
│      ▼               ▼               ▼               ▼          │
│  ┌────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐  │
│  │   R2   │  │  Arweave    │  │   Solana    │  │  Supabase  │  │
│  │2バケット│  │ (via Irys)  │  │   cNFT     │  │  DB+Cache  │  │
│  │Private │  │ 証明参照     │  │ (BubbleGum)│  │  +pgvector │  │
│  │+ Public│  │ データ       │  │ 単一Tree   │  │            │  │
│  └────────┘  └─────────────┘  └─────────────┘  └────────────┘  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │        Cloudflare Workers AI (Lens / 独立デプロイ)        │  │
│  │  ・uform-gen2-qwen-500m (画像キャプション生成)             │  │
│  │  ・bge-base-en-v1.5 (テキスト埋め込み)                     │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

【開発環境】
- docker-compose.yml: フロントエンドのみ (ローカル開発用)
- Workerは常にRailwayから実行
```

### 技術スタック

| レイヤー | 技術 | バージョン | 選定理由 |
| --- | --- | --- | --- |
| Frontend | Next.js (App Router) | 16.0.10 | React Server Components、API Routes統合 |
| Runtime | React | 19.2.0 | 最新機能対応 |
| Blockchain | Solana (BubbleGum/Metaplex) | - | cNFTによる低コスト大量mint |
| 永久保存 | Arweave (via Irys) | - | 永久保存、Umi統合、SOL払い |
| Storage | Cloudflare R2 (2バケット) | - | Egress無料、Private+Public構成 |
| Database | Supabase (PostgreSQL + pgvector) | - | DB + ベクトル検索 |
| C2PA | c2pa-rs (WASM) | 0.30.17 | ブラウザ上でのC2PA検証 |
| Auth | Privy | 3.8.0 | ウォレット + SMS認証 |
| 決済 | SolanaPay | 0.2.6 | 直接送金、手数料最小化 |
| RPC | Helius | - | cNFT読み取り、DAS API |
| ジョブキュー | BullMQ + Upstash Redis | 5.36.3 | 直列処理、リトライ、クラウドネイティブ |
| Lens検索 | Cloudflare Workers AI | - | uform-gen2-qwen-500m + bge-base-en-v1.5 |
| 国際化 | next-intl | 4.6.0 | 英語・日本語完全対応 |
| UI | Tailwind CSS | 4.x | ユーティリティファースト |
| デプロイ | Vercel + Railway | - | フロント・Worker分離デプロイ |

### デプロイメント構成

| コンポーネント | プラットフォーム | 環境変数管理 |
| --- | --- | --- |
| **Frontend** | Vercel | Vercel Dashboard |
| **Worker** | Railway | Railway Dashboard |
| **Redis** | Upstash | 両プラットフォームで共有 |
| **Lens Worker** | Cloudflare Workers | wrangler.toml + Secrets |
| **Database** | Supabase Cloud | 全プラットフォームで共有 |
| **Storage** | Cloudflare R2 | 全プラットフォームで共有 |

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

## 🔄 ユーザーフロー

### アップロードフロー

```
┌─────────────────────────────────────────────────────────────────┐
│  Step 1: Privy認証                                              │
│  ├─ ウォレット接続                                               │
│  └─ SMS認証(オプション)                                        │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 2: ファイル選択                                            │
│  ユーザーがC2PA付きメディアをドラッグ&ドロップ                    │
└─────────────────────────────────────────────────────────────────┘
                                ↓
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
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 4: プライバシー警告表示                                    │
│  ├─ C2PAメタデータに含まれる情報を一覧表示                        │
│  │   (GPS、シリアル番号、撮影日時等)                           │
│  ├─ 「これらの情報が公開されます」と警告                          │
│  └─ ユーザーが続行を選択                                         │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 5: 価格・情報設定                                          │
│  ├─ 価格を設定(0 = 無料ダウンロード)                           │
│  ├─ タイトル(オプション)                                       │
│  └─ 説明文(オプション)                                         │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 6: クライアントサイドでハッシュ計算                         │
│  └─ 元メディアファイルのSHA-256ハッシュ(= original_hash)        │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 7: 重複チェック(API経由・強化版)                           │
│  ├─ フロント: Supabase DBでoriginal_hashチェック               │
│  └─ Worker: オンチェーン検証(Arweave + Solana)                 │
│     ├─ Arweave GraphQLでoriginal_hashタグ検索                  │
│     ├─ 現在のサーバーウォレット発行のみを重複として判定           │
│     ├─ 各Arweave TXのtarget_asset_idがSolana上に存在するか確認  │
│     └─ 存在する場合 → 重複エラー                                │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 8: R2アップロード(2段階)                                 │
│                                                                 │
│  【8-1】Private Bucketへ元ファイルアップロード                   │
│  ├─ POST /api/upload/presigned でPresigned URL取得             │
│  ├─ original.{ext} をPUTでアップロード                          │
│  └─ パス: media/{hash}/original.{ext}                          │
│                                                                 │
│  【8-2】Public Bucketへmanifest・サムネイルアップロード           │
│  ├─ POST /api/upload/public を呼び出し                         │
│  ├─ サーバー側でthumbnail.jpg をアップロード                    │
│  ├─ サーバー側でmanifest.json をアップロード                    │
│  └─ 公開URLを取得                                               │
└─────────────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 9: Mintジョブを投入                                        │
│  ├─ POST /api/upload で以下のデータを送信:                      │
│  │   - userWallet                                              │
│  │   - originalHash                                            │
│  │   - rootSigner  ⚠️ Worker側で未再検証                       │
│  │   - rootCertChain  ⚠️ Worker側で未再検証                    │
│  │   - mediaFilePath                                           │
│  │   - thumbnailPublicUrl                                      │
│  │   - price, title, description                               │
│  ├─ Upstash Redis (BullMQ) のキューにジョブを追加               │
│  └─ ユーザーに「処理中」と即座にレスポンス                        │
└─────────────────────────────────────────────────────────────────┘
                                ↓
        ┌─────────────────────────────────────────────────────────┐
        │  【Worker側で直列処理 (Railway)】                        │
        │                                                         │
        │  Step 10: オンチェーン重複チェック(冪等性担保)           │
        │  ├─ Arweave GraphQLでoriginal_hash検索                  │
        │  ├─ 現在のサーバーウォレット発行のTXをフィルタ            │
        │  └─ 各TX のtarget_asset_id がSolana上に存在するか確認   │
        │                                                         │
        │  Step 11: 次のcNFTアドレス予測                          │
        │  ├─ TreeConfig.numMintedを取得                          │
        │  ├─ 次のleaf indexを決定                                │
        │  └─ PDAを計算してAsset IDを予測                          │
        │                                                         │
        │  Step 12: Arweaveアップロード(Umi + Irys)              │
        │  ├─ 証明参照データJSONを作成:                            │
        │  │   - target_asset_id: 予測したcNFTアドレス            │
        │  │   - image: サムネイル公開URL(R2)                   │
        │  │   - attributes: ハッシュ、署名者、証明書チェーン等    │
        │  │      ⚠️ フロントエンドからの値をそのまま使用         │
        │  └─ umi.uploader.uploadJson()                           │
        │                                                         │
        │  Step 13: cNFT mint                                     │
        │  ├─ Metaplex BubbleGum SDKでcNFTをmint                  │
        │  ├─ uri: Arweave URI                                    │
        │  └─ 予測IDと実際のIDの一致を確認                         │
        │                                                         │
        │  Step 14: Supabaseに保存                                │
        │  └─ media_proofsテーブルに記録                          │
        └─────────────────────────────────────────────────────────┘
                                ↓
┌─────────────────────────────────────────────────────────────────┐
│  Step 15: 完了通知                                               │
│  ├─ フロントエンドでジョブステータスをポーリング                  │
│  ├─ 証明書ページURLを表示                                        │
│  ├─ URLコピーボタン                                              │
│  └─ SNSシェアボタン                                              │
└─────────────────────────────────────────────────────────────────┘
```

### アセットページ(証明・購入・ダウンロード)

**URL形式**: `rootlens.io/[locale]/asset/{original_hash}`

- **locale**: `en` または `ja` (next-intl対応)

---

## 🚀 開発ロードマップ

### ✅ MVP完成(Ver.5) - 2025年1月

**すべてのコア機能が実装済み・動作確認済み**

| カテゴリ | 機能 | 状態 |
| --- | --- | --- |
| **基盤** | Vercel + Railway デプロイ | ✅ 完了 |
|  | Upstash Redis + BullMQ(直列処理) | ✅ 完了 |
|  | Privy認証(ウォレット接続) | ✅ 完了 |
|  | R2二重バケット構成 | ✅ 完了 |
|  | next-intl (英語・日本語) | ✅ 完了 |
| **Blockchain** | cNFTアドレス予測 | ✅ 完了 |
|  | Arweaveアップロード(Irys) | ✅ 完了 |
|  | cNFT mint(BubbleGum) | ✅ 完了 |
|  | 相互リンク検証(完全版・5ステップ) | ✅ 完了 |
|  | Burn検出機能 | ✅ 完了 |
|  | 所有権同期(Helius DAS API) | ✅ 完了 |
| **アップロード** | C2PA検証(WASM - フロントエンドのみ) | ✅ 完了 |
|  | Google Pixel対応 | ✅ 完了 |
|  | プライバシー警告表示 | ✅ 完了 |
|  | アップロードフロー(5ステップ) | ✅ 完了 |
|  | Worker側Mint処理 | ✅ 完了 |
|  | オンチェーン重複チェック | ✅ 完了 |
| **アセット管理** | アセット詳細ページ(/asset/[hash]) | ✅ 完了 |
|  | ダッシュボード(/dashboard) | ✅ 完了 |
|  | ページネーション(20件/ページ) | ✅ 完了 |
|  | アセット編集機能 | ✅ 完了 |
|  | 公開/非公開切り替え | ✅ 完了 |
| **購入・決済** | SolanaPay購入フロー | ✅ 完了 |
|  | トランザクション検証 | ✅ 完了 |
|  | ダウンロード機能(トークン制) | ✅ 完了 |
|  | 無料コンテンツ対応 | ✅ 完了 |
| **検索** | Lens機能(画像検索) | ✅ 完了 |
|  | テキスト検索 | ✅ 完了 |
|  | カメラ検索 | ✅ 完了 |
|  | pgvectorベクトル検索 | ✅ 完了 |
| **UI/UX** | レスポンシブデザイン | ✅ 完了 |
|  | ローディング状態表示 | ✅ 完了 |
|  | エラーハンドリング | ✅ 完了 |
| **インフラ** | Railway Worker HTTP API | ✅ 完了 |
|  | ヘルスチェック(/health) | ✅ 完了 |
|  | メトリクス(/metrics) | ✅ 完了 |

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

---

## 📚 参考資料

- [C2PA Technical Specification](https://c2pa.org/specifications/)
- [c2pa-rs GitHub](https://github.com/contentauth/c2pa-rs)
- [Metaplex Bubblegum](https://developers.metaplex.com/bubblegum)
- [Metaplex Umi](https://developers.metaplex.com/umi)
- [Helius DAS API](https://docs.helius.dev/compression-and-das-api/digital-asset-standard-das-api)
- [SolanaPay Specification](https://docs.solanapay.com/)
- [Privy Documentation](https://docs.privy.io/)
- [Cloudflare R2 Documentation](https://developers.cloudflare.com/r2/)
- [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/)
- [Irys Documentation](https://docs.irys.xyz/)
- [BullMQ Documentation](https://docs.bullmq.io/)
- [Supabase pgvector](https://supabase.com/docs/guides/ai/vector-columns)
- [next-intl Documentation](https://next-intl-docs.vercel.app/)
- [Upstash Redis](https://upstash.com/docs/redis)
- [Railway Documentation](https://docs.railway.app/)

---

## 📝 Ver.5 の主要変更点

### インフラ変更

1. **Docker Compose → クラウドネイティブ**
    - フロントエンド: Vercel
    - Worker: Railway
    - Redis: Upstash (TLS対応)
    - docker-compose.ymlは開発用のみ
2. **Redis設定変更**
    - `REDIS_URL` 環境変数で接続
    - `rediss://` プロトコル(TLS)
    - Vercel & Railway で共有

### 機能追加

1. **国際化(i18n)**
    - next-intl 導入
    - 英語・日本語完全対応
    - 443行の翻訳ファイル
    - `/[locale]/` ルーティング
2. **Worker HTTP API**
    - `/health` - ヘルスチェック
    - `/metrics` - キュー統計
    - `/api/upload` - ジョブ投入(代替)
    - `/api/job-status/:jobId` - ステータス確認
3. **検証ロジック強化**
    - サーバーウォレット照合
    - オンチェーン二重チェック(Arweave + Solana)
    - サーバーウォレット変更時の再発行対応

### デバイス対応

- **現在有効**: Google Pixel のみ
- **保留中**: Sony, Leica, Nikon, Canon, Adobe
- **理由**: 動作確認後に順次有効化

### 本番稼働

- **ドメイン**: https://rootlens.io
- **環境**: Production
- **モニタリング**: Railway ダッシュボード

---

**このドキュメントの完全版**: 元のSPECS.mdを参照してください。ここでは主要な変更点のみを記載しています。
