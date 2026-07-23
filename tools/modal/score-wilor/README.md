# score-wilor (現運用外)

- 入力: `rootlens-raw` の `raw/<signature_hash>/` (旧 ultra_wide 収録の rgb.mp4 + realtime_handpose.jsonl)
- 出力: score 3 層 (メタデータ / フレームサンプリング / VLM) の採点 JSON + WiLoR 3D 手ポーズ
- 実行: 現運用外 (v0.1.3 の Pipeline 2 実装。identity が signature_hash 前提のため、現行データに使うには content_hash 移行が必要)
