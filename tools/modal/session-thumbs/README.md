# session-thumbs

- 入力: `rootlens-raw-arkit` の `raw/<content_hash>/rgb.mp4`
- 出力: `rootlens-public` の `lp-sample/preview/<content_hash>_00..04.jpg` (尺の 15/35/55/75/95% 地点の 5 枚。サンプル選定用)
- 実行: `modal run tools/modal/session-thumbs/session_thumbs.py --content-hash <hash>`
