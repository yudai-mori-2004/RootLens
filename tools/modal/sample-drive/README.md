# sample-drive

- 入力: `rootlens-raw-arkit` の `raw/<content_hash>/metadata.json` + `rootlens-fpvlabs` の `<content_hash>/session.mcap` (ぼかし済み映像の源泉。無ければ実行拒否)
- 出力: 共有ドライブ `RootLens Datasets` の `samples/<domain>/arkit/<日付>_<hash8>/` (rgb.mp4 = MCAP から再構成したぼかし済み映像 / session.mcap / manifest.json)
- 実行: `modal run --detach tools/modal/sample-drive/sample_drive.py --content-hash <hash> --domain <home|bakery>`
