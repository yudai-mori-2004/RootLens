# タスク 08: Title Protocol register [廃止]

## 状態: 廃止 (= v0.1.3 で task 02 に完全吸収)

本 task は v0.1.3 で廃止された。 旧スコープ (= サーバ workflow から `submitToTp()` を呼んで Root NFT を発行する経路) は削除済みで、 内容は `02-pipeline-1-mock-cli` に統合された。

## 廃止理由

v0.1.3 で Title Protocol が SDK 廃止 + Gateway 直叩き経路 (= `POST /process`) に切替したため、 サーバから TP を呼ぶ意味が消えた。 加えて、 cNFT 発行は端末側の Solana wallet で署名する必要があり、 サーバから broadcast する経路を残すと wallet 管理がサーバに侵入する。

このため Title Protocol 登録 + cNFT 発行を Pipeline 1 内に前倒し、 `rootAssetId` が確定してから `POST /api/clips` でサーバに登録する設計に変更した。 これにより:

- サーバの Pipeline 2 は scoring のみに集中 (= 4 step、 tp-submit step なし)
- `rootAssetId` は Pipeline 2 起動の前提条件 (= notNull) として扱える
- Pipeline 3 出力 prefix は `datasets/<rootAssetId>/` に確定 (= content_id 代用経路なし)

## 新フロー参照先

- 撮影端末側 TP register + cNFT 発行: `02-pipeline-1-mock-cli/README.md`
- サーバ側 workflow (= 4 step に縮小): `03-pipeline-2-server-skeleton/README.md`
- end-to-end 検証: `10-end-to-end-smoke/README.md`
- 仕様: `document/v0.1.3/DATA_SPECS_JA.md` §2.6 ~ §2.9

## 削除対象 (= v0.1.3 で消去済 or 消去予定)

- `web/lib/tp.ts` (= 削除済)
- `web/workflow/process-clip.ts` の tp-submit step (= 削除済)
- `MODAL_BUNDLE_ENDPOINT` 以外の TP 関連 env (= 削除済)

## 進捗 (2026-05-26)

- ✅ 廃止確定、 サーバ側コード削除済
- ✅ 内容は task 02 に統合 (= 進行中)
