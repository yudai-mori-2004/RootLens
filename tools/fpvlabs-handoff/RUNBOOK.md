# FPV 受け渡し 運用手順

撮影端末が raw を `rootlens-raw-arkit` に上げる → この手順で Modal で Stera 互換 MCAP に変換
→ `rootlens-fpvlabs/<hash>/session.mcap` に出力 → FPV が rclone で取得。

当面は自動化せず手動でよい。新しいセッションが上がったら、その都度これを回すだけ。
コマンドは全部リポジトリ直下 (`root-lens/`) で実行する。

## 事前に一度だけ

- `modal` CLI にログイン済みであること (R2 認証は Modal の secret `r2-creds` 側にあるので、ローカルには不要)。
- FPV への配布経路をひらく:
  1. Cloudflare ダッシュボード → R2 → Manage R2 API Tokens → Create API Token。
     Permissions = **Object Read only**、対象バケット = **rootlens-fpvlabs のみ**。
  2. 発行された Access Key ID / Secret を FPV に DM。
  3. `tools/fpvlabs-handoff/README-for-fpv.md` を渡す。
  以後は新セッションを足すだけで、FPV 側は `rclone copy` の再実行で追従する。

## 毎回 (新しいセッションが上がったら)

1. 未処理を一覧する:
   ```
   python tools/fpvlabs-handoff/list_pending.py
   ```
   `rootlens-raw-arkit` にあって `rootlens-fpvlabs` に無い hash が「未処理」。
   raw サイズで **本命候補**（>= 0.3GB。そのまま貼れる処理コマンド付き）と
   **小さい (中断/テスト録画の可能性、通常スキップ)** に分けて出る。本命候補だけ処理すればよい。
   各候補には `[depth あり/なし]` が付く。FPV は深度が要るので、`⚠ depth なし`
   (= 非LiDAR端末で撮影) のクリップは通常渡さない。

2. 各 hash を処理する (顔ぼかしオン・厳格閾値がデフォルト):
   ```
   modal run tools/modal/fpvlabs.py --signature-hash <hash>
   ```
   出力 JSON を確認:
   - `blur: true` / `blurredFaces: N` (顔を検出してぼかした枚数。0 でも正常 = 顔が写っていない)
   - `stats.rgb == stats.depth == stats.pose` なら切り詰めなし
   - `outputKey: rootlens-fpvlabs/<hash>/session.mcap`

   これで出力完了。FPV 側は次の `rclone copy` で自動的に拾う。

## オプション

- 顔ぼかしを外す: `--no-blur` を付ける (raw の生映像そのまま)。
- ぼかしの検出閾値: `tools/modal/fpvlabs.py` の `FACE_BLUR_MIN_CONFIDENCE` (既定 0.9)。
  上げると誤検出が減り、下げると検出が増える。0.5 は緩すぎて手や物を顔と誤爆する。
- 超長尺 (65 分級) で timeout する場合: `fpvlabs.py` の `@app.function(timeout=3600)` を上げる。
- 冪等: 同じ hash を再実行すると同じキーに上書き。設定を変えて何度でもやり直せる。

## 確認・トラブル時

- 処理来歴は MCAP の `/rootlens/processing_info` に入る (ぼかし有無・閾値・pipeline 版)。
- 中身の検証は stera-sdk: `MCAPReader(path, check_format=True)`。
