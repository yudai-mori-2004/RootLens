# Task 28: iOS アプリ公開準備

## 目的

RootLens iOS アプリを App Store 審査に提出できる状態にする。
Android では動作している機能のうち、iOS で未実装・未確認の部分を完成させる。

## 事前に読むべき資料

### 仕様書
- `document/v0.1.0/SPECS_JA.md` §6.1（Title Protocol 登録パイプライン、E2EE フロー）

### AES-GCM 実装（Android = iOS 移植元）
- `app/android/app/src/main/java/io/rootlens/app/AesGcmModule.kt` — **全文読むこと**
  - L40-86: `buildAndEncryptPayload()` — ペイロード構築 + AES-256-GCM 暗号化
  - L56-66: ペイロードフォーマット `[4B meta_len BE][metadata][content]`
  - L67-77: ワイヤーフォーマット v1 `[suite_id(1B)][encap_key_len(2B BE)][encap_key][nonce(12B)][ct+tag]`
  - suite_id 0x01 = X25519-AES-256-GCM, nonce 12B, GCM tag 128bit
- `app/android/app/src/main/java/io/rootlens/app/AesGcmPackage.kt` — モジュール登録パターン

### JS ブリッジ（呼び出し側）
- `app/src/services/nativeCryptoProvider.ts` — `AesGcmBridge` の呼び出しインターフェース
- `app/src/services/titleProtocol.ts` L85-186 — AES-GCM が使われる E2E フロー全体
  - L106-112: X25519 ECDH + HKDF で方向別鍵導出
  - L122-129: `AesGcmBridge.buildAndEncryptPayload()` 呼び出し

### iOS ネイティブモジュールのパターン（既存実装）
- `app/modules/c2pa-bridge/ios/C2paBridgeModule.swift` L1-22 — Expo Module の定義パターン
  - `Name("C2paBridge")`, `AsyncFunction("methodName") { ... }` の書き方
- `app/src/native/c2paBridge.ts` L57-71 — TypeScript インターフェース定義

### Privy
- `app/src/hooks/useAuth.ts` — Privy Expo SDK の使い方
- `app/App.tsx` — `<PrivyProvider>` の設定
- `app/app.json` L16-26 — iOS bundleIdentifier, permissions

### signContentWithParent（後続タスク用の参考）
- `app/src/native/c2paBridge.ts` L96-113 — TS ラッパー（宣言はあるが iOS 未実装）
- `app/modules/c2pa-bridge/ios/C2paBridgeModule.swift` — 現状 `signContentWithParent` 未実装

## 背景

Android 版は実機で撮影→署名→Title Protocol 登録→公開ページ検証まで動作済み。
iOS 版は C2PA 署名（Secure Enclave）、マニフェスト読み取り、画像マスク、
動画処理、証明書プロビジョニング（App Attest）までは実装済みだが、
以下のブロッカーが残っている。

## ブロッカー

### 1. AES-GCM 暗号化モジュール（iOS 未実装）

Title Protocol へのコンテンツ送信時、E2E 暗号化チャネルの構築に
AES-256-GCM によるファイル暗号化が必要。Android は `AesGcmModule.kt` で実装済み。
iOS には対応する Swift 実装がなく、`NativeModules.AesGcmBridge` の呼び出しで
ランタイムクラッシュする。

**実装内容:**
- `ios/RootLens/AesGcmModule.swift` を新規作成
- `buildAndEncryptPayload()`: ファイルパスベースの AES-256-GCM 暗号化
  - メタデータ JSON + コンテンツバイナリを連結
  - ワイヤーフォーマット: `[suite_id(1B)][encap_key_len(2B BE)][encap_key][nonce][ct]`
- `encryptFile()` / `decryptFile()`: 汎用ファイル暗号化 API
- Android の `AesGcmModule.kt` と同一の入出力仕様
- `CryptoKit` の `AES.GCM` を使用（iOS 13+）

**参照:** `app/android/app/src/main/java/io/rootlens/app/AesGcmModule.kt`

### 2. signContentWithParent()（iOS 未実装）

編集時に元ファイルの C2PA マニフェストを ingredient として取り込み、
`c2pa.edited` アクションで再署名する機能。iOS の `C2paBridgeModule.swift` に
関数宣言はあるが実装がない。

**対応方針:** 初期リリースでは編集機能を iOS で無効化し、後続タスクで実装する。
撮影→公開（編集なし）フローは現状で動作する。

### 3. Privy 認証（iOS 動作未確認）

Privy Expo SDK (`@privy-io/expo`) は設定済みだが、iOS 実機での動作確認がされていない。
以前 iOS で動作しなかった報告あり。

**確認項目:**
- ログイン画面表示
- Apple ID / Email でのサインイン
- 埋め込み Solana ウォレット生成
- ウォレットアドレスの取得

## 実施内容

### Phase 1: AES-GCM モジュール実装

1. `AesGcmModule.swift` 新規作成
   - `buildAndEncryptPayload(contentPath, metadata, keyBase64, encapKeyBase64, aad, outputPath)`
   - `encryptFile(inputPath, outputPath, keyBase64, aadBase64)`
   - `decryptFile(inputPath, outputPath, keyBase64, aadBase64)`
2. Expo Module として登録（`expo-module.config.json` 更新、または React Native Bridge）
3. Android 版と同一の入出力で単体テスト

### Phase 2: Privy 認証の iOS 動作確認・修正

1. iOS シミュレータ or 実機で Privy ログインフローを確認
2. `@privy-io/expo-native-extensions` の iOS 設定確認
3. `app.json` の iOS bundleIdentifier と Privy ダッシュボードの設定一致確認
4. 動作しない場合: エラーログから原因特定・修正

### Phase 3: E2E 動作確認（iOS 実機）

1. アプリ起動 → Privy ログイン
2. カメラ撮影 → C2PA 署名確認（Secure Enclave）
3. 証明書プロビジョニング（App Attest → サーバー → Device Certificate 保存）
4. Title Protocol 登録（AES-GCM 暗号化 → TEE 検証 → cNFT ミント）
5. 公開リンク生成 → ブラウザで検証成功

### Phase 4: App Store 審査提出

1. EAS Build で本番 IPA ビルド
2. App Store Connect でアプリ登録
3. スクリーンショット（6.7", 6.1", iPad）
4. アプリ説明文（日本語 + 英語）
5. プライバシーポリシー URL: `rootlens.io/privacy`
6. サポート URL
7. 審査提出

## エミュレータでの制限

- **Secure Enclave**: エミュレータでは使用不可。Keychain フォールバックあり（クラッシュはしない）
- **App Attest**: エミュレータでは使用不可。DEV_MODE=true でスキップ可能
- **カメラ**: エミュレータでは使用不可。ギャラリーからの読み込みで代用
- **AES-GCM**: エミュレータで動作可能
- **Privy**: エミュレータで動作可能（Web ベースの認証フロー）
- **Title Protocol 登録**: エミュレータで動作可能（暗号化 + ネットワーク）

## 完了条件

- [ ] `AesGcmModule.swift` が Android 版と同一仕様で動作
- [ ] `nativeCryptoProvider.ts` が iOS で `AesGcmBridge` を正しく呼び出せる
- [ ] Privy ログインが iOS で成功（Apple ID or Email）
- [ ] 埋め込み Solana ウォレットが iOS で生成される
- [ ] iOS 実機で撮影→C2PA 署名→Title Protocol 登録→公開リンク生成が成功
- [ ] 公開ページでブラウザ検証が成功（iOS から登録したコンテンツ）
- [ ] 編集機能が iOS で適切に無効化されている（クラッシュしない）
- [ ] EAS Build で iOS 本番ビルドが成功
- [ ] App Store Connect に提出済み
