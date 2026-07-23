# lp-sample

LP /sample ビューアの配信キャッシュ生成。サンプルデータの正は共有ドライブ (`samples/<domain>/<pipeline>/<セッション>/`) で、ここで作る 6 素材はその中の 1 本をブラウザで再生するためのビュー変換。rgb はドライブと同じく fpvlabs MCAP のぼかし済み JPEG 列から再構成する (raw の未ぼかし rgb は読まない)。

- 入力: `rootlens-raw-arkit` の `raw/<content_hash>/` (frames.jsonl + metadata.json、あれば depth.tar / mesh.jsonl / imu.jsonl) + `rootlens-fpvlabs` の `<content_hash>/session.mcap` (ぼかし済み映像の源泉。無ければ実行拒否)
- 出力: `rootlens-public` の `lp-sample/<hash8>/` (rgb.mp4 / depth.mp4 / mesh.glb / trajectory.json / timeseries.json / summary.json)
- 実行: `modal run --detach tools/lp-sample/lp_sample.py --content-hash <hash>`
- 検証: `--target-bucket <bucket>` で本番バケットに触れず出力先を切り替える
