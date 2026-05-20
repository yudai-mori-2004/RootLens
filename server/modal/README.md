# server/modal — Modal 関数

SPECS §6.2 で定義した 2 つのサーバ側パイプラインを Modal で動かす。

| 関数 | パイプライン | resource | 役割 |
|---|---|---|---|
| `blur.py` (= `rootlens-blur`) | Pipeline 2 | CPU 4 / 2 GB | YuNet 顔ぼかし + C2PA 「署名 S」 |
| `bundle.py` (= `rootlens-bundle`) | Pipeline 3 | GPU A10G / 16 GB memory | LeRobot v3 dataset 構築 + WiLoR-mini hand pose |

`bundle.py` の手姿勢推定は [WiLoR-mini (warmshao/WiLoR-mini)](https://github.com/warmshao/WiLoR-mini) を使う。 pip install 経由 (= `git+https://github.com/warmshao/WiLoR-mini.git`) で、 weight は HuggingFace から auto-download (= MANO 含む)、 manual 登録なし。 1 clip ~$0.02 (= A10G 15-20 FPS × clip 1 分相当)。

Pipeline 1 (= 撮影) は端末側、 Modal は触らない。

顔ぼかしは YuNet (= OpenCV 公式同梱、 ONNX 232 KB) のみ。 テキストぼかしは入れていない (= SPECS §2.5、 業界標準と同じ判断)。 GPU 不要 (= YuNet は CPU で 100+ FPS)。 過去に EgoBlur Gen2 を使っていたが Aria 用 Faster-RCNN で 2 FPS / T4 と遅すぎたため YuNet へ置換した。

## セットアップ (初回のみ)

### 1. Modal CLI install と token 発行

```bash
pip install modal
modal token new   # ブラウザが開いて OAuth、 30 秒
```

### 2. R2 credential を Modal Secret として登録

[Modal dashboard → Secrets → Create](https://modal.com/secrets) で **名前: `r2-creds`** で以下を set:

| Key | Value |
|---|---|
| R2_ACCOUNT_ID | `4fe04c4663fa99a8ea2f8b6eb80d5e0c` (= 既存 web/.env と同じ) |
| R2_ACCESS_KEY_ID | (同上) |
| R2_SECRET_ACCESS_KEY | (同上) |
| R2_BUCKET_RAW | `rootlens-mcap-raw` |
| R2_BUCKET_BLURRED | `rootlens-mcap-blurred` |

### 3. サーバ署名用 C2PA cert / key を Modal Secret として登録

[Modal dashboard → Secrets → Create](https://modal.com/secrets) で **名前: `rootlens-c2pa`** に以下を set:

| Key | Value |
|---|---|
| SERVER_C2PA_CERT_CHAIN_PEM | `node keys/sync-to-env.mjs server` の出力 1 行目 |
| SERVER_C2PA_PRIVATE_KEY_PEM | 出力 2 行目 |

chain は RootLens Dev Root CA で直接署名された Server leaf + Root の連結 PEM。

### 4. YuNet weight

`server/modal/models/face_detection_yunet_2023mar.onnx` を repo に commit 済 (= 232 KB)。 deploy 時に Modal image へ自動で焼き込まれる (= `.add_local_dir` 経由)。 別途 download / volume 不要。

## デプロイ

```bash
modal deploy server/modal/blur.py
# Output 末尾に web endpoint URL が表示される:
# https://<workspace>--rootlens-blur-blur-clip.modal.run
```

この URL を `server/.env` の `MODAL_BLUR_ENDPOINT` に貼る。

## 動作仕様 (= server 側 lib/modal.ts と一致)

入力 (query string):
- `input_key`: R2 (= `rootlens-mcap-raw`) のオブジェクトキー
- `output_key`: R2 (= `rootlens-mcap-blurred`) の出力先キー
- `idempotency_key`: 冪等性キー。 同じ key で 2 回呼ばれたら 2 回目は短絡

出力 (JSON):
```json
{
  "blurredContentHash": "<sha256 hex>",
  "facesBlurred": 12,
  "framesProcessed": 1800,
  "durationMs": 24000,
  "cached": false
}
```

## パイプライン

1. `ffprobe` で width / height / fps を取得
2. `ffmpeg` で MP4 → raw BGR24 frame を stdout pipe
3. 各 frame に YuNet 顔検出 + 検出領域に Gaussian blur (+ 20% pad、 顎 / 髪まで被覆)
4. blurred frame を `ffmpeg` の stdin pipe に流して H.264 MP4 として書き出し
5. ぼかし済 MP4 に C2PA manifest を埋め込み (= 「署名 S」、 ES256 callback signer)

メモリは 1 frame 分しか持たない (= ffmpeg pipe + 逐次処理)。

## コスト目安

CPU 4 core / 2 GB memory で約 $0.0001 / sec。 28 秒動画で blur ~15 秒見込み → $0.0015 / clip。 月 1000 クリップで $1.5。

## 既知の制約

- C2PA 署名は post-sign verify を off にしている (= dev Root CA は c2pa-python の built-in trust store に居ないため)。 chain 自体は valid (= leaf + Root の連結) なので downstream (TP 等) で検証可能。 本番 (= CA が public trust 済) になったら verify を on に戻す
- YuNet の `score_threshold=0.6` / `nms_threshold=0.3` は OpenCV demo の default。 false negative が目立つようなら 0.5 まで下げる
