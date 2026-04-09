# 実装カバレッジレポート

本文書は、RootLens仕様書（`SPECS_JA.md` ver.7）の各セクションに対する実装状況を整理したものである。

凡例:
- **実装済み**: ロジックが動作する状態
- **型のみ**: データ構造・インターフェースの定義のみ
- **スタブ**: 関数シグネチャは存在するがロジック未実装
- **未着手**: 対応するコードが存在しない
- **対象外**: 当該コンポーネントの責務ではない

---

## 全体サマリー

| カテゴリ | 状態 |
|---------|------|
| モバイルアプリ (React Native) | 着手中 |
| ネイティブモジュール (c2pa-rs FFI) | 実装済み（署名 + 読み取り） |
| ネイティブモジュール (TEE) | 実装済み（鍵生成 + CSR + TEE署名コールバック。Android/iOS両対応） |
| サーバー (Next.js API Routes) | 着手中（CA + 証明書発行 + CRL） |
| 公開ページ (rootlens.io) | 実装済み（LP + 検証ページ。§7.4準拠のクライアントサイド検証） |
| データベース (Supabase) | 未着手 |
| ストレージ (R2) | 未着手 |

---

## セクション別カバレッジ

### §1 プロダクト概要

仕様書のみの内容（課題定義・コアバリュー・設計思想）であり、実装対象なし。

---

### §2 ユーザーフロー

| 仕様の要素 | 対応コンポーネント | 状態 |
|-----------|------------------|------|
| §2.1 初回起動 (TEE鍵生成 + Attestation) | App / Native Module | 実装済み（起動時証明書プロビジョニング + 14日前自動更新 + リトライUI） |
| §2.2 撮影・選択 | App / Native Module | 実装済み（写真・動画ともC2PA署名 + C2PAフィルタ付きギャラリー選択 + 複数選択） |
| §2.3 編集 | App | 実装済み（クロップ・マスク・リサイズ・トリム + undo/redo + ドラフト永続化 + 動画動的プレビュー + ネイティブマスク描画 + ネイティブ動画書き出し） |
| §2.4 公開 | App / Server | スタブ（登録準備画面まで。サーバー連携なし） |
| §2.5 SNS共有 | App / Public Page | 未着手 |

---

### §3 UI設計

| 仕様の要素 | 対応コンポーネント | 状態 |
|-----------|------------------|------|
| §3.1 UI表現の原則 | App | 実装済み |
| §3.2 画面構成 (フッターナビ) | App | 実装済み |
| §3.3 公開済みギャラリー | App | 実装済み（グリッド表示 + ドラフトバッジ） |
| §3.4 カメラ | App | 実装済み（写真・動画ともC2PA署名 + サムネギャラリー小窓 + 録画タイマー） |
| §3.5 端末ギャラリー (C2PAスキャン) | App / Native Module | 実装済み（C2PAマニフェスト読み取り + 信頼判定 + フィルタリング + セッション内キャッシュ + 複数選択 + 共通コンポーネント化） |
| §3.6 編集画面 | App | 実装済み（クロップ・マスク・リサイズ・トリム + undo/redo + ドラフト永続化 + 動画動的プレビュー + DLボタン + 登録フロー + ネイティブマスク描画 + ネイティブ動画書き出し） |
| §3.7 公開ページプレビュー | App | 実装済み（WebViewモック） |
| §3.8 設定画面 | App | スタブ |

---

### §4 署名アーキテクチャ

| 仕様の要素 | 対応コンポーネント | 状態 |
|-----------|------------------|------|
| §4.1 信頼モデル | — | 未着手 |
| §4.2 暗号アルゴリズム (ES256) | Native Module | 実装済み（c2pa-rs ES256 + TEE ECDSA P-256） |
| §4.3 PKI構造 (Root CA + Intermediate CA + Device Cert) | Server / Native Module | 実装済み（3層PKI: Root CA → iOS/Android Intermediate CA → Device Certificate。Dev CA生成スクリプト + Device Certificate発行 + 90日有効期限 + CRL。アプリ側の3証明書対応は未着手） |
| §4.4 証明書発行フロー | Server / Native Module | 実装済み（CSR生成 + サーバーCA + Dev mode attestation skip。Prod attestation検証はスタブ） |
| §4.5 C2PAマニフェスト | Native Module | 実装済み（読み取り + 検証。署名生成はTEE対応。RFC 3161 TSA対応済み） |
| §4.6 C2PA SDK統合 (c2pa-rs FFI) | Native Module | 実装済み（フォーマット非依存署名 + TEE署名コールバック + マニフェスト読み取り + マスク描画 + 動画処理。Android/iOS両対応） |
| §4.7 鍵ライフサイクル管理 | Server (KMS) / Native Module | 実装済み（90日有効期限 + 更新API + CRL。Prod KMS統合は未着手） |
| §4.8 C2PA Trust List | — | 未着手 |

---

### §5 アカウント・認証

| 仕様の要素 | 対応コンポーネント | 状態 |
|-----------|------------------|------|
| §5.1 アカウントモデル (Privy) | App / Server | 未着手 |
| §5.2 Privyウォレット (Solana) | App / Server | 未着手 |
| §5.3 通信認証 | App / Server | 未着手 |

---

### §6 公開パイプライン

| 仕様の要素 | 対応コンポーネント | 状態 |
|-----------|------------------|------|
| §6.1 パイプラインA: Title Protocol登録 | App (Title Protocol SDK) | 未着手 |
| §6.2 パイプラインB: データ保存 (R2 + Supabase) | App / Server | 未着手 |
| §6.3 Extension仕様 (PDQ / cert) | App / Public Page / TP | 実装済み（image-pdq + cert-rootlens。アプリがsigner_orgからcert extensionを動的選択。ブラウザPDQ再計算: jarosz.wasm + image-pdq.wasm） |
| §6.4 公開ページ生成・リンク発行 | Server | 未着手 |
| §6.5 再登録 | App / Server | 未着手 |

---

### §7 公開ページ

| 仕様の要素 | 対応コンポーネント | 状態 |
|-----------|------------------|------|
| §7.1 URL構造 | Public Page | 一部実装（短縮URL `/p/[shortId]` のみ。正規URL `/{walletAddress}/{pageId}` およびクリエイターページ `/@{username}` は未実装） |
| §7.2 コンテンツページの表示内容 | Public Page | 実装済み（Trust row + NFTトグル + GlobalConfig全フィールド + CSVダウンロード） |
| §7.3 OGP | Public Page | 実装済み（generateMetadata でOGタグ + Twitterカード設定） |
| §7.4 クライアントサイド検証アーキテクチャ | Public Page | 実装済み（DAS API → オフチェーンストレージ → Ed25519署名検証 → PDQ再計算。GlobalConfig/コレクション/TEE署名/Content Hash一致/重複解決/WASMハッシュ/PDQ同一性/cert検証結果表示。§7.4.4 コンソールログ: %c CSSスタイリング + groupCollapsed） |
| §7.5 データの削除・非公開 | App / Server | 未着手 |

---

### §8 ホワイトリスト管理

| 仕様の要素 | 対応コンポーネント | 状態 |
|-----------|------------------|------|
| §8.1-8.4 ホワイトリスト / ガバナンスAPI | Server / App | 実装済み（`GET /api/v1/governance/:network` — trusted_extensions, phash_extensions, tsa_policy, pki, solana設定を返す。アプリ側の連携は未着手） |

---

### §9 課金

| 仕様の要素 | 対応コンポーネント | 状態 |
|-----------|------------------|------|
| §9.1-9.3 サブスクリプション | App / Server | 未着手 |

---

### §10 インフラ構成

| 仕様の要素 | 対応コンポーネント | 状態 |
|-----------|------------------|------|
| §10.1 コンポーネント一覧 | — | 未着手 |
| §10.2 オフライン対応 | App / Native Module | 未着手 |
| §10.3 動画サイズ制限 | App | 未着手 |
| §10.4 データベース設計 | Server (Supabase) | 実装済み（users, pages, contents テーブル + RLSポリシー + インデックス。仕様書を実装に合わせて更新済み。subscriptions テーブルは §9 とともに未着手） |
