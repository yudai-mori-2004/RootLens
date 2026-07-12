# FPV 受け渡し 運用手順

撮影端末が raw を `rootlens-raw-arkit` に上げる → この手順で Modal で Stera 互換 MCAP に変換
→ `rootlens-fpvlabs/<hash>/session.mcap` に出力 → FPV が rclone で取得。

当面は自動化せず手動でよい。新しいセッションが上がったら、その都度これを回すだけ。
コマンドは全部リポジトリ直下 (`root-lens/`) で実行する。

## 事前に一度だけ

- `modal` CLI にログイン済みであること (R2 認証は Modal の secret `r2-creds` 側にあるので、ローカルには不要)。
- **EgoBlur モデル (jit) を Modal Volume に置く** (=顔検出器 EgoBlur が動く前提):
  ```
  modal volume create rootlens-egoblur
  modal volume put rootlens-egoblur references/egoblur/ego_blur_face_gen2.jit /
  ```
  `references/egoblur/ego_blur_face_gen2.jit` は Meta EgoBlur gen2 の顔検出モデル (400MB)。
  gen2 のソースコードは Modal image ビルド時に GitHub から clone するので不要。
- FPV への配布経路をひらく:
  1. Cloudflare ダッシュボード → R2 → Manage R2 API Tokens → Create API Token。
     Permissions = **Object Read only**、対象バケット = **rootlens-fpvlabs のみ**。
  2. 発行された Access Key ID / Secret を FPV に DM。
  3. `document/v0.1.4/fpvlabs-handoff/README-for-fpv.md` を渡す。
  以後は新セッションを足すだけで、FPV 側は `rclone copy` の再実行で追従する。

## 毎回 (新しいセッションが上がったら)

1. 未処理を一覧する:
   ```
   python document/v0.1.4/fpvlabs-handoff/list_pending.py
   ```
   `rootlens-raw-arkit` にあって `rootlens-fpvlabs` に無い hash が「未処理」。
   raw サイズで **本命候補**（>= 0.3GB。そのまま貼れる処理コマンド付き）と
   **小さい (中断/テスト録画の可能性、通常スキップ)** に分けて出る。本命候補だけ処理すればよい。
   各候補には `[depth あり/なし]` が付く。FPV は深度が要るので、`⚠ depth なし`
   (= 非LiDAR端末で撮影) のクリップは通常渡さない。

2. 各 hash を処理する (顔ぼかしオン、EgoBlur GPU がデフォルト):
   ```
   modal run tools/modal/fpvlabs/fpvlabs.py --content-hash <hash>
   ```
   出力 JSON を確認:
   - `blur: true` / `faceDetector: "egoblur"` / `detectionsTotal: N` (検出した顔 bbox の合計数)
   - `stats.rgb == stats.depth == stats.pose` なら切り詰めなし
   - `outputKey: rootlens-fpvlabs/<hash>/session.mcap`

   これで出力完了。FPV 側は次の `rclone copy` で自動的に拾う。

   コスト目安: A10G で 1 時間クリップ ≈ ¥50-100 前後 (実測で調整)。

## オプション

- 顔ぼかしを外す: `--no-blur` を付ける (raw の生映像そのまま)。
- 検出器切替: `--face-detector mediapipe` (EgoBlur が使えないときの CPU fallback)。
- EgoBlur 検出閾値: `tools/modal/fpvlabs/fpvlabs.py` の `EGOBLUR_SCORE_THRESHOLD` (既定 0.5)。
  実測で本物の顔は 0.95+、誤爆は 0.3 以下なので、0.5 で綺麗に分離できる。
- コスト削減: `EGOBLUR_RESIZE` を下げる (480 → 320 で更に高速化、 ただし小さい遠景の顔は取りこぼす)。
- 超長尺 (60 分超) で timeout する場合: `@app.function(timeout=7200)` を上げる。
- 冪等: 同じ hash を再実行すると同じキーに上書き。設定を変えて何度でもやり直せる。

## 検証・チューニング (本番バケットに触らない)

閾値やリサイズを調整して挙動を見るときは、 `--target-bucket <自分のテスト用バケット>` を付けて
本番 `rootlens-fpvlabs` 以外に書き出す。 出力キー形式 (`<hash>/session.mcap`) と処理内容は
本番と完全に同一。 テスト用バケットは自分で R2 に作成しておく (例: `rootlens-fpvlabs-scratch`)。

```
modal run tools/modal/fpvlabs/fpvlabs.py --content-hash <hash> --target-bucket rootlens-fpvlabs-scratch
```

結果を rclone や boto3 で落として目視 → 良ければ `--target-bucket` を外して本番に反映。

## 確認・トラブル時

- 処理来歴は MCAP の `/rootlens/processing_info` に入る (ぼかし有無・閾値・pipeline 版)。
- 中身の検証は stera-sdk: `MCAPReader(path, check_format=True)`。
