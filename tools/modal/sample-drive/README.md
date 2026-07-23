# sample-drive

- 入力: `rootlens-raw-arkit` の `raw/<content_hash>/metadata.json` + `rootlens-fpvlabs` の `<content_hash>/session.mcap` (ぼかし済み映像の源泉。無ければ実行拒否) + DB `clips` / `accounts` 行 (domain と録画時刻の解決。欠けていれば実行拒否)
- 出力: 共有ドライブ `RootLens Datasets` の `samples/<domain>/arkit/<録画開始時刻>_<hash8>/` (rgb.mp4 = MCAP から再構成したぼかし済み映像 / session.mcap / manifest.json)
- 実行: `modal run --detach tools/modal/sample-drive/sample_drive.py --content-hash <hash>`
- 注意 (Starter プラン運用): 一斉投入しない。数本ずつ投入し、完了を確認してから次を出す。利用上限に達すると走行中タスクが即殺されるため
