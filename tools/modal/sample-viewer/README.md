# sample-viewer

- 入力: `rootlens-raw-arkit` の `raw/<content_hash>/` (rgb.mp4 + frames.jsonl + metadata.json、あれば depth.tar / mesh.jsonl / imu.jsonl) + `rootlens-fpvlabs` の `session.mcap` (納品サイズ記載用、無くても可)
- 出力: `rootlens-public` の `lp-sample/<slug>/` (rgb.mp4 / depth.mp4 / mesh.glb / trajectory.json / timeseries.json / summary.json = LP /sample ビューアの 6 素材)
- 実行: `modal run --detach tools/modal/sample-viewer/sample_viewer.py --content-hash <hash> --slug <slug>`
- 検証: `--target-bucket <bucket>` で本番バケットに触れず出力先を切り替える
