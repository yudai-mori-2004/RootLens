# mock-device (Pipeline 1 mock CLI)

iOS 端末で実行される Pipeline 1 を macOS 上で模擬する Rust CLI。 raw MP4 を入力に取り、 C2PA D1 署名 → Apple Vision 顔ぼかし → C2PA D2 署名 (= D1 を ingredient で parentOf 参照) → content_id (= D2 active manifest signature の SHA-256) 算出 → R2 アップロードまでを 1 コマンドで通す。

詳細仕様は `document/v0.1.3/tasks/02-pipeline-1-mock-cli/README.md` 参照。

## ビルド

```
cd v0.1.3/server/scripts/mock_device
cargo build --release
```

## 前提

- macOS (Apple Vision フレームワーク必要)
- 既存 macos_blur Swift CLI が build 済 (= `server/scripts/macos_blur/.build/arm64-apple-macosx/release/MacOsBlur`)
- Rust 1.93+ / Cargo 1.93+

## 使い方

### dev profile (= ローカル出力のみ、 R2 アップロードなし)

```
./target/release/mock-device \
  --input /path/to/raw.mp4 \
  --output-dir /tmp/mock_out \
  --profile dev
```

### prod profile (= R2 アップロード込み)

R2 credential を env で設定:
```
export R2_ACCOUNT_ID=...
export R2_ACCESS_KEY_ID=...
export R2_SECRET_ACCESS_KEY=...
export R2_BUCKET_RAW=rootlens-raw
```

```
./target/release/mock-device \
  --input /path/to/raw.mp4 \
  --sensors /path/to/sensors.jsonl \
  --imu /path/to/imu_high_rate.jsonl \
  --intrinsics /path/to/camera_intrinsics.json \
  --profile prod
```

## 出力

stdout に 1 行 JSON:

```json
{
  "content_id": "abc123...",
  "faces_blurred": 4,
  "frames_processed": 150,
  "duration_ms": 8421,
  "r2_keys": [
    "raw/abc123.../rgb.mp4",
    "raw/abc123.../sensors.jsonl",
    "raw/abc123.../imu_high_rate.jsonl",
    "raw/abc123.../camera_intrinsics.json"
  ]
}
```

dev profile では `r2_keys` の代わりに `output_paths` (= ローカル絶対パス) が入る。

## 構成

```
src/
├── main.rs         CLI 入口、 オーケストレーション
├── c2pa_sign.rs    D1 / D2 署名 (c2pa::Builder + create_signer::from_keys)
├── content_id.rs   compute_signature_hash (= "sha256:<hex>" を返す)
├── jumbf.rs        ISO 19566-5 minimal parser (Title Protocol から移植、 Apache-2.0)
├── blur.rs         MacOsBlur Swift CLI の subprocess wrapper
└── r2_upload.rs    aws-sdk-s3 で R2 に並列 PUT
fixtures/
├── chain.pem       dev ed25519 cert chain (leaf + Test CA)
└── ee.key          dev ed25519 leaf 秘密鍵
```

## 制限

- **本 mock は dev only**。 実機 iOS では Secure Enclave 鍵 + App Attest + RFC 3161 TSA + 端末ごとに発行された device cert が必須。 本 mock は固定の Test EE / Test CA を使う
- C2PA manifest の `claim_generator_info` は `rootlens-mock-device 0.1.3` と固定。 端末側では `RootLens 0.1.3 (iOS 18.x)` 等になる
- 入力 raw MP4 は H.264 のみ動作確認 (= HEVC は MacOsBlur 側の対応次第)
