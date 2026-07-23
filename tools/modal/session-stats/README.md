# session-stats

- 入力: `rootlens-raw-arkit` の `raw/<content_hash>/frames.jsonl` (旧録画は realtime_handpose.jsonl) + `metadata.json`
- 出力: stdout に JSON (尺 / 手検出率 / トラッキング正常率 / 歩行距離 / カバー面積。サンプル選定用)
- 実行: `modal run tools/modal/session-stats/session_stats.py --hashes <hashA,hashB,...>` (結果が stdout なので --detach しない)
