# タスク 12: Pipeline 1 の iOS ネイティブ実装

mock-device (macOS Rust CLI) が行う 7 ステップを iOS ネイティブで再現する。
UI_SPECS_JA.md §5 のカメラサブモード Step 4 (録画中) の裏側にあたるデータ処理。

## 7 ステップ (mock-device と同一フロー)

1. **録画**: sensor-session module で H.264 + センサー (IMU, intrinsics, hand landmarks) を同時キャプチャ
2. **C2PA D1 署名**: c2pa-bridge module で raw MP4 に c2pa.created action を署名
3. **Apple Vision 顔ぼかし**: VNDetectFaceRectanglesRequest + AVAssetWriter で再エンコード
4. **C2PA D2 署名**: D1 を parentOf ingredient として c2pa.placed action を署名
5. **content_id 抽出**: D2 active manifest signature の SHA-256
6. **R2 アップロード**: presigned PUT URL で 4 ファイル並列送信 (Background URLSession)
7. **TP + cNFT + /api/clips**: TP Gateway /process → /extension/solana → Solana 署名 (Privy wallet) → POST /api/clips

## 既存資産

| module | 役割 | 状態 |
|---|---|---|
| `modules/sensor-session` | 録画 + IMU + depth キャプチャ | 動作 (Step 1) |
| `modules/c2pa-bridge` | c2pa-rs FFI で D1+D2 署名 | 動作 (Step 2, 4) |
| `modules/aes-gcm` | 暗号化 (将来の E2E 用、本タスクでは不使用) | |
| `src/services/titleProtocol.ts` | TP Gateway 呼び出し | プロトタイプ (Step 7 の一部) |

## 新規実装が必要な部分

- Step 3 (顔ぼかし): VNDetectFaceRectanglesRequest → CIFilter でぼかし → AVAssetWriter で再エンコード。sensor-session module に追加するか、別 module にする
- Step 5 (content_id): JUMBF parser で active manifest signature 取得 → SHA-256。c2pa-bridge に追加
- Step 6 (R2 upload): Background URLSession で 4 ファイル並列 PUT。接続切れ時のリトライ
- Step 7 (Solana 署名): Privy embedded wallet の signTransaction で TP Gateway の partial_tx に署名

## サーバ側 API (全て実装済)

```
POST /api/clips          → clip 行作成 (rootAssetId + signedJsonUri 必須)
POST /api/clips/:id/finalize → Pipeline 2 workflow 起動
GET  /api/clips/:id      → 状態 polling
```

## 完了条件

- iOS 実機で録画 → C2PA D1+D2 → blur → content_id → R2 upload → TP → cNFT → /api/clips の全 7 ステップが通る
- サーバで finalize → Pipeline 2 → ready 遷移まで確認
