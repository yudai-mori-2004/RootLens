# タスク 02: Pipeline 1 mock CLI (macOS, Rust)

## 目的

iOS 端末で実行される Pipeline 1 を、 macOS 上で動く Rust CLI で模擬する。 raw MP4 を入力に取り、 C2PA D1 署名 → Apple Vision 顔ぼかし → C2PA D2 署名 (= D1 を ingredient で参照) → content_id 算出 → R2 アップロードまでを 1 コマンドで通す。

実機 iOS の Pipeline 1 (= Secure Enclave 鍵管理 + Background URLSession 等) は後続フェーズ。 本 task ではサーバ側 Pipeline 2/3 を動かすために必要な R2 上のクリップを生成できれば足りる。

## 読むべきファイル

### 仕様
1. `document/v0.1.3/DATA_SPECS_JA.md` ─ 特に:
   - §1.1 content_id の定義
   - §1.2 対象プラットフォーム (= iOS only、 mock は macOS)
   - §2.2 撮影されるデータ (= 5 ファイル構成)
   - §2.3 プライバシー処理
   - §2.4 C2PA 署名 (= 2 段化、 D1 → D2 と ingredient 参照)
   - §2.5 アップロード (= raw/<content_id>/ 配下に統一)

### Title Protocol からの流用元 (Rust)
2. `/Users/forest/WebCreations/title-protocol/legacy/v0.1.0/crates/core/examples/sign_one.rs` (36 行) ─ C2PA 署名最小例。 `c2pa::create_signer::from_keys` + `c2pa::Builder::from_json` + `builder.sign` の 3 行で 1 段署名
3. `/Users/forest/WebCreations/title-protocol/legacy/v0.1.0/crates/core/examples/gen_c2pa_fixtures.rs` (284 行) ─ ingredient 連結例。 `builder.add_ingredient_from_stream` で D2 が D1 を参照する形を作る
4. `/Users/forest/WebCreations/title-protocol/crates/core/src/c2pa_verify.rs::compute_signature_hash` (L173-179) ─ signature_hash (= content_id) 算出。 `c2pa::jumbf_io::load_jumbf_from_stream` で JUMBF 領域だけ抽出 → 自前 JUMBF parser で active manifest の COSE 署名 bytes を取得 → SHA-256
5. `/Users/forest/WebCreations/title-protocol/crates/core/src/jumbf.rs` (358 行) ─ JUMBF ISO 19566-5 minimal parser。 依存は `sha2` + `hex` のみで c2pa-rs に深くは依存しない
6. `/Users/forest/WebCreations/title-protocol/legacy/v0.1.0/tests/fixtures/certs/chain.pem` + `ee.key` ─ dev 用 ed25519 cert chain + leaf key。 mock では流用、 本番ではアプリ署名 cert (= Secure Enclave 鍵から発行) に差し替え

### v0.1.2 からの流用元 (既存 macOS Apple Vision 顔ぼかし)
7. `/Users/forest/WebCreations/root-lens/server/scripts/macos_blur/Sources/MacOsBlur/` ─ Apple Vision `VNDetectFaceRectanglesRequest` (rev 3) + AVAssetReader/Writer (H.264) で MP4 を再 encode。 release build バイナリ `.build/arm64-apple-macosx/release/MacOsBlur` を subprocess で呼ぶ
8. `/Users/forest/WebCreations/root-lens/server/scripts/rebuild_lp_videos_local.py` ─ subprocess 呼び出し + R2 アップロードのオーケストレーション pattern (= Python だが流れは参考になる)

### 外部仕様
9. `c2pa-rs` 0.84.1 docs (`Builder::from_json` の manifest JSON schema、 `add_ingredient_from_stream`)
10. C2PA 2.1 §13.4 (= 複数 manifest の active 選択規則 = 最後の `c2pa.manifest` box)
11. ISO 19566-5 (JUMBF box 構造)

## 重要な注意点 (= Title Protocol 担当者から)

- **`c2pa.actions.v2` の最低 1 action が必須**。 D1 は `c2pa.created`、 D2 は `c2pa.placed` (= 顔ぼかしの記録)。 無いと c2pa-rs に `assertion.action.malformed` で reject される
- **複数 manifest の active**: C2PA 2.1 §13.4 で「最後の `c2pa.manifest` box」 と決まる。 `jumbf::find_manifest_labels` の戻り値の `.last()` がそれ
- **DoS 防御**: signature box は 256 KiB 上限 (= `MAX_SIGNATURE_SIZE`)。 OCSP / timestamp token 込みでも余裕、 攻撃入力は弾く
- **byte-determinism**: c2pa-rs の version 変更で JSON 順序や数値表現が変わると signature_hash も変わる。 `Cargo.toml` で `c2pa = "=0.84.1"` ピン留め (= Title Protocol と同 version)

## スコープ

### やること

1. **Cargo crate 作成** (= `v0.1.3/server/scripts/mock_device/`):
   - `Cargo.toml`: `c2pa = "=0.84.1"`、 `sha2`、 `hex`、 `serde_json`、 `tokio`、 `aws-sdk-s3`、 `clap` (CLI 引数)、 `anyhow`
   - `src/main.rs`: CLI 入口
   - `src/c2pa_sign.rs`: D1 / D2 署名 + signature_hash 抽出 (= title-protocol/`crates/core/src/c2pa_verify.rs` + `jumbf.rs` を Apache 2.0 ライセンス表記付きで取り込み)
   - `src/blur.rs`: macos_blur subprocess wrapper
   - `src/r2_upload.rs`: aws-sdk-s3 で raw バケットに 4-5 ファイルを並列 PUT

2. **CLI 仕様**:
   ```
   mock-device --input <raw.mp4>
               [--sensors <sensors.jsonl>]
               [--imu <imu_high_rate.jsonl>]
               [--intrinsics <camera_intrinsics.json>]
               [--depth-dir <path/to/depth>]
               [--task-id <id>] [--wallet <pubkey>]
               [--bucket <R2_BUCKET_RAW>]
               [--profile dev]
   ```
   stdout に 1 行 JSON で `{content_id, faces_blurred, frames_processed, duration_ms, r2_keys: [...]}`

3. **処理フロー**:
   ```
   入力 raw.mp4
     ↓
   D1 署名 (= c2pa.actions.v2 = [c2pa.created])、 cert chain は dev ed25519
     ↓ raw_d1.mp4
   MacOsBlur subprocess (Apple Vision 顔ぼかし、 H.264 再 encode)
     ↓ blurred.mp4 (= D1 manifest はここで消滅、 再 encode で破壊される)
   D2 署名 (= add_ingredient_from_stream で raw_d1.mp4 を parentOf 参照、 c2pa.actions.v2 = [c2pa.placed (apple_vision face_blur, N regions)])
     ↓ blurred_d2.mp4
   content_id = compute_signature_hash(blurred_d2.mp4) (= "sha256:<hex>" 形式の hex 部分のみ抽出)
     ↓
   R2 アップロード並列 4-5 ファイル (= rgb.mp4 = blurred_d2.mp4、 sensors.jsonl、 imu_high_rate.jsonl、 camera_intrinsics.json、 + depth/ ディレクトリ)
     ↓
   stdout JSON
   ```

4. **mock device cert の発行**:
   - 最小路線: Title Protocol の `tests/fixtures/certs/chain.pem` + `ee.key` をそのまま `include_bytes!` で埋め込む (= dev only と明記)
   - より本番に近い路線: root-lens の `certs/dev/ios-intermediate-ca.{pem,key.pem}` を読み込んで起動時に 1 回限り mock leaf を発行 → 3 段 chain で署名
   - 第 1 路線で十分。 第 2 路線は本物の iOS 実装フェーズで対応

5. **dev profile** (= `--profile dev`):
   - R2 アップロードを skip して local 出力のみ
   - 出力ファイル名: `output/<content_id>/{rgb.mp4, sensors.jsonl, ...}`
   - cargo test で smoke test を回せるように

### やらないこと

- **iOS Secure Enclave 鍵生成 / App Attest / RFC 3161 TSA** (= 実機実装フェーズ)
- **Apple Vision のフレーム単位呼び出し** (= 既存 macos_blur をそのまま使う)
- **sensors.jsonl / imu_high_rate.jsonl の生成** (= 入力として与える、 task 10 で作る dummy で十分)
- **Background URLSession のような中断耐性** (= mock は同期実行、 失敗時は再実行)
- **CLI の対話的 UX** (= stdin / TTY 操作はなし)

## 成功基準

- [x] `cd v0.1.3/server/scripts/mock_device && cargo build --release` が通る
- [x] サンプル MP4 (= `Title Protocol/tests/fixtures/minimal/test_5s_640x480.mp4` 等) で `cargo run -- --input <path> --profile dev` が成功し、 出力 dir に rgb.mp4 + signed manifest が生成される
- [x] 同じ入力で実行するたびに新しい content_id が返る (= C2PA 規格として manifest 内 `instance_id` がランダム生成され、 COSE 署名 = signature_hash が毎回変わる。 端末側は 1 回 sign で確定する前提で運用するため、 冪等性は `(wallet, content_id)` の組で server-side に担保する)
- [x] 異なる raw MP4 では当然 content_id が異なる
- [x] `c2patool <output_dir>/rgb.mp4` で 2 段 manifest が確認できる (= active manifest が D2、 ingredient relationship `parentOf` で D1 manifest を参照)
- [x] R2 に `raw/<content_id>/{rgb.mp4, sensors.jsonl, imu_high_rate.jsonl, camera_intrinsics.json}` がアップロードされる (= 環境変数で R2 credential が設定されている場合)
- [x] stdout JSON の `content_id` が DB schema (= task 01) の `contentId` カラムと整合 (= "sha256:" prefix を除いた 64 文字 hex)
- [x] `cargo test` の smoke test (= 既知サンプルの content_id 期待値 assert) が通る

## 進捗 (2026-05-26)

- ✅ Rust crate `v0.1.3/mock_device/` で実装。 c2pa = "=0.84.1" + Title Protocol の `sign_one.rs` + `c2pa_verify.rs::compute_signature_hash` + `jumbf.rs` を Apache-2.0 表記付きで持ち込み
- ✅ dev fixture (= Title Protocol の ed25519 chain.pem + ee.key) を `fixtures/` に流用
- ✅ MacOsBlur Swift CLI を subprocess で呼んで Apple Vision 顔ぼかし
- ✅ D2 active manifest signature の SHA-256 で content_id 抽出 → `c2patool` で manifest 構造確認 (= active = D2、 ingredients = [D1, parentOf]、 c2pa.placed action 込み)
- ✅ aws-sdk-s3 で R2 raw バケットに 4 ファイル並列 PUT (= rgb.mp4 + sensors.jsonl + imu_high_rate.jsonl + camera_intrinsics.json)
- ✅ 5 秒 640x480 MP4 で end-to-end 1.5 秒 (= D1 sign + blur 150 frames + D2 sign + R2 upload)
- ⏳ 次フェーズ: TP `/process` 呼び出しを追加 (= signature_hash + attestation を取得して R2 signed-json/ に保存、 user 共有の新 Gateway 仕様)、 さらに cNFT 発行 (= `/extension/solana` + Solana broadcast) で rootAssetId 確定
