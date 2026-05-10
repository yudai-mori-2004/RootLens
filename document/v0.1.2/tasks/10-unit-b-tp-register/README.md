# Task 10: Unit B — Title Protocol register client (production module setup)

## このタスクの位置付け

タスク 06 以降は、本番統合に直接 import される production module を 1 ユニットずつセットアップしていく。新しい sandbox を作るのではなく、**ユニットの公開 API を確定させ、依存を揃え、本番フロー (collection flow) からそのまま呼べる状態** にする。

ユニット B の実装はタスク 02 以降の作業で揃っており、[sandbox 04 の MintView](../../../app/src/sandboxes/04-collection-flow/components/MintView.tsx) からすでに `registerOnTitleProtocol` を呼んでいる。このタスクは、その状態を「production module としてセットアップ完了」と宣言し、API 境界・依存・確認手順を文書化する。

(タスク番号 06–09 は SPECS の他ユニット — D=License NFT, E=Co-sign API, G=Staking, A=TEE+C2PA — に予約)

## 公開 API

`app/src/services/titleProtocol.ts`:

```ts
export interface TitleProtocolResult {
  contentHash: string;   // TP gateway が C2PA 検証時に算出した content hash
  txSignature: string;   // Solana devnet 上の cNFT mint tx
}

export async function registerOnTitleProtocol(
  contentFilePath: string,                  // file:// 付き or 無しのローカルパス
  ownerWallet: string,                      // Solana pubkey base58 (Root NFT owner)
  signerOrg?: 'RootLens' | 'Google' | 'Sony' | 'Leica',  // C2PA cert org → cert extension 選択
  mediaType?: 'image' | 'video',            // perceptual hash extension 選択 (デフォルト 'video')
): Promise<TitleProtocolResult>;
```

副作用:
- TP TEE node に E2EE 暗号化ペイロードを upload (X25519 ECDH + HKDF + AES-256-GCM)
- TP gateway が delegateMint で Solana devnet にトランザクションを broadcast
- ローカル cache に一時 payload を作成し、関数終了時に削除

エラー:
- ネットワーク失敗 / TEE node down / 検証失敗で `throw`。catch 側でメッセージ表示

## 内部 API (直接 import しない)

`app/src/services/nativeCryptoProvider.ts` — `@title-protocol/sdk` の `CryptoProvider` 実装と `AesGcmBridge` の型付きラッパー。`titleProtocol.ts` からのみ import される。

## ネイティブ依存

公開 API の動作にはネイティブモジュール `AesGcmBridge` が必要。

| プラットフォーム | 実装 | 登録 |
|---|---|---|
| iOS | `app/ios/RootLens/AesGcmModule.swift` (CryptoKit) + `AesGcmModule.m` | RN bridge `getName: "AesGcmBridge"` で自動登録 |
| Android | `app/android/app/src/main/java/io/rootlens/app/AesGcmModule.kt` (javax.crypto) + `AesGcmPackage.kt` | `MainApplication.kt:getPackages()` に `AesGcmPackage()` 追加済み |

API:
```kotlin
// 共通シグネチャ (iOS/Android)
encryptFile(inputPath, outputPath, keyBase64, aadBase64): Promise<{nonce, size}>
decryptFile(inputPath, outputPath, keyBase64, nonceBase64, aadBase64): Promise<string>
buildAndEncryptPayload(contentFilePath, metadataJson, requestKey, encapKey, aad, outputFilePath): Promise<{size}>
```

ネイティブ実装は 5MB 級コンテンツが JS↔Native bridge を通過しない設計 (ファイルパス渡し)。bridge を流れるのは 32B 鍵 / 12B nonce / AAD / パス文字列のみ。

## JS 依存 (package.json)

```
@title-protocol/sdk        # TP の公式 TS SDK
@noble/curves              # X25519 ECDH
@noble/hashes              # SHA-256 + HKDF
@solana/web3.js            # Connection only (鍵は持たない)
expo-file-system           # cache 一時ファイル + uploadAsync
```

## このユニットが鍵を持たない設計

クライアント側で永続的に保持する鍵は無い。

- TEE 公開鍵は `selectNode` で毎回取得
- ECDH 一時鍵ペアは `x25519.utils.randomPrivateKey()` でリクエスト毎に生成
- AES-GCM 鍵は ECDH+HKDF の出力。プロセス内 `Uint8Array` のみ
- 所有者 wallet 秘密鍵は不要 (`delegateMint: true` で gateway 側が tx 構築・署名)

## 本番統合状態

- consumer: [`app/src/sandboxes/04-collection-flow/components/MintView.tsx`](../../../app/src/sandboxes/04-collection-flow/components/MintView.tsx) — collection flow 録画完了 → 採点 → "I agree — mint Core NFT" 押下時に `registerOnTitleProtocol(videoUri, walletAddress, 'RootLens', 'video')` を呼ぶ
- 失敗時は MintView 内で error 表示。video uri はローカルに残る

## 動作確認手順

本ユニットの動作確認は collection flow を通して行う (専用 sandbox は作らない):

1. `EXPO_PUBLIC_DEMO_WALLET_ADDRESS` を `.env` に設定 (Solana devnet pubkey)
2. iOS / Android 実機でアプリ起動
3. Sandbox 04 (Collection Flow) → 任意のタスク選択 → 両手パー 1 秒 → カウントダウン → 録画 → 両手サムズアップで終了
4. Result 画面 → `Mint Core NFT →` ボタン押下 → MintView
5. `I agree — mint Core NFT` → progress (logcat / Xcode console で `[TP] ...ms` ログ) → 完了で contentHash + txSignature 表示
6. `Open in Solscan ↗` で devnet explorer に Root NFT mint tx が出ることを確認

## 完了条件

- [ ] iOS 実機で MintView → MINTED まで通る (Solscan で tx 確認)
- [ ] Android 実機 (Pixel 10) で同様に通る
- [ ] `app/src/services/titleProtocol.ts` 以外から `nativeCryptoProvider` を直接 import していない
- [ ] AesGcmBridge が両 OS で resolve される (`Cannot find native module 'AesGcmBridge'` が出ない)

## 既知の制約

- TP devnet の TEE node が落ちている時間帯は `selectNode` または `verify` で失敗する。これは TP gateway 側の問題でユニットの責務外
- 進捗 (各ステップの ms) は `console.log("[TP] ...")` でのみ出る。UI に進捗バーが必要になったら別途コールバック引数の追加を検討 (現状は YAGNI で持たない)
