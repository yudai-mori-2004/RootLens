# fpvlabs

- 入力: `rootlens-raw-arkit` の `raw/<content_hash>/` (rgb.mp4 + frames.jsonl + metadata.json、あれば imu.jsonl / depth.tar)
- 出力: `rootlens-fpvlabs` の `<content_hash>/session.mcap` (EgoBlur 顔ぼかし済み、ROS2 メッセージの MCAP)
- 実行: `modal run --detach tools/modal/fpvlabs/fpvlabs.py --content-hash <hash>`
- 検証: `--target-bucket <bucket>` で本番バケットに触れず出力先を切り替える
