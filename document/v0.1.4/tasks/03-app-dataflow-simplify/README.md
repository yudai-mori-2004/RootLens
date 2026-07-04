# 03. App dataflow 簡素化（D1 のみ + steps 削減）

## 目的

`app/src/dataflow/` を v0.1.4 の最小フローに整える: `recording-configs` + `signClip`（D1 のみ）+
`uploadToR2` + `registerClip`（POST /api/clips）だけにする。 Pipeline 2/3 / TP / mint 関連は削除。
state machine を `uploading → uploaded / error` の 3 値に縮小。

## 読むべきファイル

- `document/v0.1.4/DATA_SPECS_JA.md` §2, §4, §6
- `app/src/dataflow/orchestrator.ts`（または `pipeline.ts`、 advanceClip / enqueueRecording 等）
- `app/src/dataflow/store.ts`（state machine / Clip 型を簡素化）
- `app/src/dataflow/steps/sign.ts`（**D1 のみに**、 blur 呼び出しと D2 を撤去）
- `app/src/dataflow/steps/upload.ts`（**維持**、 files map から signed-json 撤去）
- `app/src/dataflow/steps/register.ts`（必須 body を `signatureHash` / `contentSize` / `network` に）
- `app/src/dataflow/steps/titleProtocol.ts` → **削除**
- `app/src/dataflow/steps/pipeline2.ts` → **削除**
- `app/src/dataflow/steps/pipeline3.ts` → **削除**（存在すれば）
- `app/src/dataflow/steps/lifecycle.ts`（stake / resolveServerClipId / retry など全部撤去）
- `app/src/units/privacy-blur/` → **dataflow からの参照を全部切る**（モジュール自体は残してよい、 native は弄らない）
- `app/src/native/c2paBridge.ts`（signD2 / 関連 wrapper を未使用に）

## スコープ

### やること

1. **steps/sign.ts**: blur 呼び出しと D2 署名を撤去。 入力 = 生 mp4、 出力 = `{ signedMp4Uri, signatureHash,
   contentSize }`。 D1 manifest の actions は `c2pa.created` のみ。
2. **steps/upload.ts**: maybe 変更不要（presigned files map から signed-json を期待しないだけ）。
3. **steps/register.ts**: POST /api/clips body は `signatureHash` / `contentSize` / `network` だけ。
   `rootAssetId` / `signedJsonUri` の引数は撤去。
4. **削除**: `steps/titleProtocol.ts`、 `steps/pipeline2.ts`、 `steps/pipeline3.ts`、
   `steps/lifecycle.ts`、 `findReusableMint` / `dasAssetExists` 等。
5. **store.ts**: Clip 型から rootAssetId / signedJsonUri / quality / autoCategory / delegate / license_*
   / processing_step / workflow_run_id を削除。 state は `uploading / uploaded / error`。
   stake / retry server-side 系のアクションは撤去（retry はローカル再アップロードのみ）。
6. **orchestrator (= pipeline.ts / advanceClip)**: 段は `unsigned → signed(D1=signature_hash 誕生) → uploaded` の
   3 段に縮小。 段レジューム自体は durable workDir のおかげで維持できる。 v0.1.3 の 4 段
   (`unsigned → capture-signed(D1) → blur-signed(D2) → registered`) から 1 段減らすだけ。
7. **services/pipeline1.ts / services/clipPipeline.ts** にまだ残骸があれば削除（task 18 で消した想定だが念のため）。
8. `npm run check:dataflow`（純粋性）+ `npx tsc --noEmit`（app）green。

### やらないこと

- native module の削除（`privacy-blur` swift / rust コードはリポに残す、 v0.1.5 で blur サーバ移管時に
  リファレンスとして使う）。
- recording-configs（ultra_wide / arkit）の変更。 リアルタイム切替は維持。
- C2PA bridge の Rust 側（pipeline1.rs, lib.rs）の変更。 signD1 だけ呼ぶ形になる。

## 成功基準

- dataflow から TP / mint / Pipeline 2/3 / staking / quality 関連の型・関数・import が完全に消えている。
- `signRecording` 1 回 → `uploadToR2` → `registerClip` の 3 ステップで `state='uploaded'` 到達。
- `npm run check:dataflow` green、 `npx tsc --noEmit` green。
- DevSandbox （= task 04 で配線後）が新 dataflow で 1 クリップ通過可能。

## 進捗

- [x] sign.ts: D1 のみに（signRecording / signedUriIn、 blur/D2 撤去）
- [x] upload.ts: files map 整理
- [x] register.ts: body 簡素化（finalize 削除）
- [x] titleProtocol/pipeline2/pipeline3/lifecycle/orchestrator 削除
- [x] store.ts: Clip 型 + state machine 縮小（3 値）
- [x] pipeline.ts: 3 段 (unsigned → signed → registered)
- [x] env.ts: TP/MERKLE/COSIGN optional 化
- [x] tsc + purity (`check:dataflow`) green
