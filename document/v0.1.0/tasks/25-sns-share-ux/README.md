# Task 25: SNSシェアUXブラッシュアップ

## 目的

SNSでのシェア体験を最適化する。InstagramとX（Twitter）それぞれの特性に合わせた専用シェア編集画面を提供し、クロップ・ウォーターマーク・画像エクスポートを可能にする。

## 背景

RootLensは「本物の写真」を証明するアプリであり、SNSでのシェアが最も重要なユースケース。現状のシェアバーは汎用的なOS共有シートに依存しており、SNS別の最適化がない。

### SNSごとの特性

| SNS | リンクシェア | OGP表示 | 画像内情報が必要 | シェア方式 |
|-----|-------------|---------|-----------------|-----------|
| Instagram | ✕（フィードにリンク不可） | ✕ | ○（QR必須） | 画像シェア |
| X（画像） | ○ | — | ○（QR推奨） | 画像シェア |
| X（OGP） | ○ | ○（summary_large_image） | 任意 | リンク intent |

## 画面構成

### 25.1 シェアバー（PublishingScreen + PreviewScreen）

```
┌─ Share to  [𝕏] [📷]  │  [📤] [🔗] [⋮] ─┐
```

- `Share to` テキスト + X アイコン + Instagram アイコン → 各 SNS シェア編集画面へ
- OS 共有シートアイコン + クリップボードアイコン（URL コピー）
- 3 点メニュー → アクションシート（削除等）

### 25.2 Instagram シェア編集画面

2タブ構成。画像をシェアシートで共有。

| タブ | アスペクト比 | 出力サイズ | クロップ | バッジ |
|------|------------|-----------|---------|--------|
| 投稿 | 1:1 | 1080×1080 | 固定枠ピンチパン | QR + REAL + username |
| ストーリー | 9:16 | 1080×1920 | 固定枠ピンチパン | QR + REAL + username |

**画面レイアウト（上から下）:**
1. ヘッダー（← Instagram シェア）
2. アンダーラインタブ（投稿 / ストーリー）
3. クロップエリア（flex:1、灰背景、白余白+黒ボーダー+四隅L字マーク）
4. コントロール
   - ウォーターマーク ON/OFF + S/M/L サイズセレクター
   - SNSアイコン + ユーザーネーム入力
   - URL コピーボックス
5. シェアボタン（全幅、navy、「シェア」）

**シェアフロー:** クリップボードに URL+CTA → Skia で画像合成 → `Sharing.shareAsync`

### 25.3 X シェア編集画面

2タブ構成。タブによってシェア方式が異なる。

| タブ | アスペクト比 | 出力サイズ | クロップ | バッジ | シェア |
|------|------------|-----------|---------|--------|--------|
| 画像 | 16:9, 3:4, 1:1, 2:1 選択 | 1600×900 等 | 比率選択ボタン+ピンチパン | QR + REAL + username | 画像シェア |
| OGP | 1.91:1 固定 | 1200×630 | 固定枠ピンチパン | ✓ + REAL (QR不要) | リンク intent |

**画面レイアウト:**
1. ヘッダー（← X シェア）
2. アンダーラインタブ（画像 / OGP）
3. 画像タブ時: 比率選択バー（16:9 / 3:4 / 1:1 / 2:1）
4. クロップエリア
5. コントロール（同上）
6. シェアボタン（画像タブ: 「シェア」 / OGP タブ: 「ポスト」）

**画像タブ:** X で見切れない4比率から選択。QR コード付きバッジ。`Sharing.shareAsync` で画像シェア。

**OGP タブ:** 1.91:1 (1200×630) 固定枠。チェックマーク + REAL バッジ（QR 不要 — リンクから検証ページに到達可能）。`x.com/intent/tweet` でリンクシェア。将来的にここで編集した画像をサーバーの OGP 画像として更新する機能を追加予定。

## ウォーターマークバッジ仕様

### 共通

- 配置: 画像右下、端から 12px マージン
- 背景: #0f1a3c（ネイビー）、角丸 10px
- ボーダー: rgba(255,255,255,0.15) 1.5px
- パディング: 上下 8px、左 8px、右 12px
- テキスト「REAL」: 白、font-weight 500、letter-spacing 0.14em
- S/M/L の 3 段階サイズ調整（0.65x / 1.0x / 1.35x）
- 表示/非表示トグル

### QR 付き（Instagram 全タブ + X 画像タブ）

```
┌─────────────────────────┐
│ ┌────┐  REAL            │
│ │ QR │  username         │
│ └────┘                   │
└─────────────────────────┘
```

- QR: 40×40px、白背景角丸 5px、#0f1a3c ドット、検証 URL エンコード
- 2 行目: ユーザーネーム（rgba(255,255,255,0.5)）

### チェックマーク（X OGP タブ）

```
┌──────────────────┐
│ ✓  REAL           │
│    username        │
└──────────────────┘
```

- 白丸 24px + ネイビーチェックマーク

## クロップ UI

### 固定枠タイプ（Instagram 全タブ + X OGP タブ）

- 灰背景（#F7F7F7）の中に、白余白 8px → 黒ボーダー 2px → 画像領域
- 四隅に L 字マーク（28px 腕、4px 太さ、#1A1A1A）
- 画像をピンチ/パンで移動・拡大。枠は固定
- `overflow: hidden` で画像がはみ出さない

### 比率選択タイプ（X 画像タブ）

- 16:9 / 3:4 / 1:1 / 2:1 の 4 パターンをボタンで選択
- 選択に応じてクロップ枠のアスペクト比が変わる
- ピンチ/パンは同じ

## 技術実装

### 画像エクスポート — Skia 宣言的 Canvas

命令的 API（`Skia.Surface.MakeOffscreen`）は Android で JSI クラッシュが発生するため、**宣言的 `<Canvas>` + `makeImageSnapshot`** 方式を採用。

- 非表示の `<Canvas>` を `left: -9999` に常時マウント（アンマウント/リマウントによる ref 不安定を回避）
- エクスポート要求時に画像 + バッジを宣言的コンポーネントで描画
- `requestId` カウンターで同一 URL の再リクエストでも effect が確実に再発火
- 300ms 後に `canvasRef.makeImageSnapshot()` → JPEG エンコード → ファイル書き出し
- 15 秒タイムアウトで Promise ハング防止

### ユーザーネーム永続化

- `AsyncStorage` に Instagram / X の @username を独立保存
- `snsShareStore.ts` で `instagramUsername` / `twitterUsername` を管理
- ウォーターマーク OFF でも入力欄を `opacity: 0.4` で表示（発見性）

## 影響範囲

### 新規ファイル

| ファイル | 役割 |
|---------|------|
| `app/src/screens/InstagramShareScreen.tsx` | Instagram シェア編集画面 |
| `app/src/screens/TwitterShareScreen.tsx` | X シェア編集画面 |
| `app/src/components/SnsShareBadge.tsx` | ウォーターマークバッジ（QR / チェックマーク切替） |
| `app/src/components/ShareTextBox.tsx` | URL コピーボックス |
| `app/src/components/CropPreview.tsx` | 固定枠ピンチ/パンクロップ |
| `app/src/components/ImageExportCanvas.tsx` | Skia 宣言的 Canvas エクスポート |
| `app/src/store/snsShareStore.ts` | ユーザーネーム永続化 |
| `app/src/services/imageExport.ts` | （旧命令的 API、廃止予定） |

### 変更ファイル

| ファイル | 変更内容 |
|---------|---------|
| `app/src/screens/PublishingScreen.tsx` | シェアバー再設計 |
| `app/src/screens/PreviewScreen.tsx` | シェアバー再設計 |
| `app/src/screens/PublishedGalleryScreen.tsx` | Preview 遷移に thumbnailUrl 追加 |
| `app/src/navigation/types.ts` | 新画面パラメータ型 + PublishResult.thumbnailUrl |
| `app/App.tsx` | 新画面のスタック登録 |
| `app/src/i18n/index.ts` | シェア関連翻訳キー |

### 依存パッケージ（新規追加）

| パッケージ | 用途 |
|-----------|------|
| `@shopify/react-native-skia` 1.5.0 | バッジ描画・画像エクスポート |
| `react-native-qrcode-skia` 0.4.0 | QR コード（プレビュー用） |
| `expo-sharing` | 画像シェア |
| `@react-native-community/slider` | （導入済み、未使用） |

## 未実装（将来タスク）

- X OGP タブで編集した画像をサーバーの OGP 画像として更新（URL パラメータ方式）
- TikTok / YouTube Shorts 対応
- ウォーターマーク位置カスタマイズ
- サーバーサイド動的 OGP 画像生成

## スコープ外

- 公開ページ（web 側）の OGP メタデータ変更
- Instagram API 連携
