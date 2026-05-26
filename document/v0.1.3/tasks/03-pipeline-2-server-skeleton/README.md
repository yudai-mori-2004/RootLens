# タスク 03: Pipeline 2 サーバ骨格 (API + WDK workflow + mapper)

## 目的

Pipeline 2 の REST API と WDK durable workflow の骨格を立てる。 各 scoring step (task 04-08) の中身は別 task で埋めるので、 本 task ではエンドポイント呼び出し + DB 遷移 + step 順序 + エラー経路のみを完成させる。

## 読むべきファイル

### 仕様
1. `document/v0.1.3/DATA_SPECS_JA.md`:
   - §3.1 トリガと実行環境
   - §3.5 ステータス更新と通知 (= push 通知の位置付け)
   - §3.6 入出力まとめ
   - §3.7 冪等性
   - §6 クリップ状態機械

### v0.1.2 流用元 (ADAPTABLE)
2. `server/app/api/clips/route.ts` (92 行) ─ POST + GET の構造、 idempotent 判定
3. `server/app/api/clips/[id]/route.ts` (61 行) ─ GET + DELETE
4. `server/app/api/clips/[id]/finalize/route.ts` (72 行) ─ contentHash 照合 + workflow start
5. `server/app/api/clips/[id]/retry/route.ts` (62 行) ─ error → processing 再キック
6. `server/app/api/clips/[id]/stake/route.ts` (65 行) ─ Bubblegum delegate 設定の mock
7. `server/workflow/process-clip.ts` (169 行) ─ WDK orchestration pattern (= `"use workflow"` / `"use step"` directive、 `FatalError` 経路)
8. `server/lib/mapper.ts` (44 行) ─ Clip row → ClipDto 変換 + presigned preview URL 生成
9. `server/lib/modal.ts` (97 行) ─ Modal HTTP wrapper pattern (= query string + retry なし、 タイムアウトは Modal 側)

### WDK 仕様
10. `workflow` npm パッケージ docs ─ `"use workflow"` / `"use step"` directive、 `start()`、 `FatalError`、 `withWorkflow` の API。 v0.1.2 では `workflow ^4.2.4` を使っており、 本 task でも同 version を使う。 もし破壊的変更がある場合は実装中に判明するので、 task 03 開始時に最新版の changelog 確認

## スコープ

### やること

1. **API endpoints** (= `app/api/clips/`):
   - `route.ts` POST: `taskId` + `achievementConfidence` + `contentId` + `contentSize` を受け、 clips 行を作成、 presigned PUT URL 4 本を返す。 同 wallet × 同 contentId は idempotent
   - `route.ts` GET: wallet の全クリップを `ClipDto[]` で返す
   - `[id]/route.ts` GET: 単件取得 (= presigned preview URL 付き)
   - `[id]/route.ts` DELETE: ready 以下は削除可、 staked は 409
   - `[id]/finalize/route.ts` POST: contentId 照合 + clips を `uploading → processing` に遷移 + workflow キック
   - `[id]/retry/route.ts` POST: state = "error" のみ、 workflow 再キック
   - `[id]/stake/route.ts` POST: `state = "ready"` のみ、 delegate に env の pubkey を書く mock

2. **WDK durable workflow** (= `workflow/process-clip.ts`):
   - 関数全体に `"use workflow"`
   - step 1: `metadata-scan` ─ task 04 で実装、 ここでは TODO 関数 + state 更新
   - step 2: `frame-sampling` ─ task 05 で実装、 ここでは TODO 関数 + state 更新
   - step 3: `vlm-score` ─ task 06 で実装、 ここでは TODO 関数 + state 更新
   - step 4: `gtsam-eval` ─ task 07 で実装、 ここでは TODO 関数 + state 更新
   - step 5: `tp-submit` ─ task 08 で実装、 ここでは TODO 関数 + state 更新
   - 最後: `state = "ready"`、 `processingStep = null`、 `qualityScore` と `qualityBreakdown` を集計して保存
   - エラー経路: `FatalError` で `state = "error"` + `errorMessage`、 retry は外側 endpoint で対応
   - workflow runId を DB の `workflowRunId` に記録

3. **lib/modal.ts**:
   - `callMetadataScore(opts) → Layer1Score` (= task 04 が実装する Modal endpoint を叩く HTTP wrapper)
   - `callFrameSampling(opts) → Layer2Score` (= task 05)
   - `callVlmScore(opts) → Layer3Score` (= task 06)
   - `callGtsam(opts) → GtsamScore` (= task 07)
   - `callBundle(opts) → BundleResponse` (= task 09)
   - 共通 helper として `callModal(endpoint, params)` を 1 つ作る (= query string + fetch + JSON parse)

4. **lib/mapper.ts**:
   - `clipToDto(row) → Promise<ClipDto>` (= signedMp4Key があれば `presignSignedMp4Get` で preview URL 生成)
   - `clipsToDtos(rows) → Promise<ClipDto[]>` (= 並列実行)
   - qualityBreakdown は jsonb をそのまま渡す

5. **lib/clipId.ts** (新規): `clip_<contentId 12 文字>_<unixms>` の id 生成関数

### やらないこと

- 各 step の実体 (= task 04-08 で実装)
- Pipeline 3 トリガ (= task 09 内)
- Push 通知 (= 後続 task、 expo-notifications APNs)
- ToS consent 記録 (= 既存 v0.1.2 のものを別 task で port)

## 成功基準

- [ ] 全 API endpoint が型エラーゼロでビルドできる (= `npm run typecheck`)
- [ ] `curl -X POST /api/clips -H "X-Wallet-Pubkey: <...>" -d '{...}'` で clip 行が作成され、 presigned URL 4 本が返る
- [ ] 同 wallet で同 contentId を再 POST すると、 既存行が返る (= idempotent)
- [ ] `POST /api/clips/:id/finalize` で contentId 不一致なら 409、 一致すれば 200 + workflow 起動
- [ ] workflow が 5 step 全てを順に呼び、 各 step で `processingStep` カラムが更新される (= 各 step の中身は TODO 関数で `await new Promise(r => setTimeout(r, 100))` 程度の placeholder)
- [ ] 全 step 完走で `state = "ready"`、 失敗で `state = "error"` + `errorMessage`
- [ ] `POST /api/clips/:id/retry` で error クリップが processing に戻り workflow が再起動
- [ ] `DELETE /api/clips/:id` で staked クリップは 409、 それ以外は 200
