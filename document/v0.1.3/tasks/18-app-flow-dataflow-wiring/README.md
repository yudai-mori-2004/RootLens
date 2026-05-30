# 18. 本番アプリフローの dataflow 配線（重複パイプライン一本化）

## 目的

本番アプリ（`RootNavigator` 配下の撮影フロー）を、17 で作った `dataflow/` 層に**一本化**する。
DevSandbox と同じ `dataflow/` を本番フローも呼ぶ「2 人目の Layer-3 消費者」にし、本番側に残っている
重複パイプライン実装（`services/pipeline1.ts` + `services/clipPipeline.ts`）を廃止する。

## 背景

17（dataflow 疎結合 + DevSandbox）で `dataflow/`（純粋 Layer 1: recording-configs / signRecording /
runPipeline1 / steps / pollPipeline2 / triggerPipeline3 / dataflowStore）を作り、DevSandbox がそれを駆動して
E2E 検証済み。しかし**本番アプリは旧 `services/clipPipeline.ts`（clipStore: 複数クリップ list + AsyncStorage
永続化 + retry/remove/stake + finalize + polling）+ `services/pipeline1.ts`（独自 P1 オーケストレーション）を
使い続けており**、`dataflow/` と sign/upload/TP/mint/register を二重実装している。これを解消する。

## 読むべきファイル

- `app/src/dataflow/`（一本化先・単一の真実）: `orchestrator.ts`（signRecording / runPipeline1）、`store.ts`、
  `steps/*`、`recording-configs/*`、`index.ts`
- `app/src/devsandbox/DevSandboxScreen.tsx`（dataflow の参照消費者 = 配線の手本）
- 廃止対象: `app/src/services/clipPipeline.ts`（556 行: clipStore 全機能）、`app/src/services/pipeline1.ts`（旧 P1）
- 配線対象: `app/src/screens/CalibrationCaptureScreen.tsx`（902 行・撮影 UX）、`app/src/screens/CollectionScreen.tsx`（一覧）
- `app/App.tsx`（起点切替）、`app/src/app/RootNavigator.tsx`（CaptureMode = CalibrationCaptureScreen）

## スコープ

### やること

1. **起点フラグ化**: `App.tsx` の `USE_DEV_SANDBOX = __DEV__` → `EXPO_PUBLIC_USE_SANDBOX`（`src/env.ts`）。
   既定=本番 RootNavigator、`=1` の時だけ DevSandbox。DevSandbox は検証ハーネスとして温存。
2. **dataflowStore を複数クリップ対応に拡張**: clipStore の list/get・per-clip 状態・uploadProgress・
   retry/remove/stake・サーバ状態 hydrate（applyServerClip）・local→server id rename を吸収。**Layer 1 純粋**を維持。
3. **submitClip オーケストレータ**: `signRecording → runPipeline1 → POST finalize → pollPipeline2` を束ね、
   store を更新する Layer 1 関数（clipStore.httpEnqueue 相当を dataflow の純粋 steps で）。
4. **永続化アダプタ（Layer 2, AsyncStorage）**: dataflowStore を購読して clip 一覧を hydrate/persist。
   AsyncStorage は react-native 依存なので **Layer 1 の store には入れず Layer 2 に分離**（純粋性維持）。
5. **CollectionScreen を配線**: `useClips`(clipStore) → dataflowStore セレクタ。retry/remove も dataflow 経由。
6. **CalibrationCaptureScreen を配線 + 構成切替**: recording-config 抽象でリアルタイム構成切替（**設定 UI から
   arkit / ultra_wide**、DevSandbox と同じ要領）、録画停止時に `signRecording`（1 回署名）、submit は dataflow 経由。
7. **重複削除**: `services/clipPipeline.ts` + `services/pipeline1.ts` を削除し全 import を dataflow に付替え。
8. **検証**: `tsc` + `check:dataflow`（純粋性）+ 本番フローで 1 クリップ実機 E2E。

### やらないこと

- ラベル品質改善（gemini プロンプト）: 別タスク
- 30 分録画上限の実装: 別タスク（方針のみ決定済み）
- WiLoR(P3) のフレームサンプリング / バッチ化 / 常時化: 別タスク（買い手時 Modal `.map()` バッチ想定）
- 本番 capture UX の抜本再設計（キャリブレーション/ジェスチャーの作り替え）
- 認証ハードニング（X-Wallet-Pubkey の challenge-response 化）

## 重要な設計判断（合意済み）

- **store は dataflowStore に一本化**（clipStore 廃止）。複数クリップ状態は Layer 1 純粋 store、
  永続化（AsyncStorage）は Layer 2 アダプタに分離。
- **本番撮影画面でも recording-config 抽象でリアルタイム構成切替**（設定 UI）。arkit ⇄ ultra_wide。
- **署名は撮影停止時に 1 回だけ**（`signRecording`）。runPipeline1 は署名済みを使い回す。
  → C2PA D2 は RFC3161 TSA タイムスタンプ（sigTst2）を埋めるため、**同じ動画でも再署名すると
  signature_hash が変わる**。再署名すると hash ベースの冪等（重複排除・既発行 cNFT 再利用）が効かず二重 mint する。
- `services/pipeline1.ts` は dataflow steps と等価（重複）なので削除する。
- mint 前冪等チェック（DB lookup + DAS getAsset、`(wallet, signature_hash, network)` 重複排除）は dataflow 側に既存。

### 実装中に確定した追加判断

- **ハンドトラック / snapshot / orientation を `RecordingConfig` 抽象に取り込んだ**。ジェスチャー /
  キャリブレーション UX は「撮影構成（=データフローの土台）の上に薄く乗るソース」であり、構成（wide /
  arkit）の native 差異を意識すべきでない。そのため `config.subscribeHandTrack` / `config.captureSnapshot` /
  `config.setDisplayOrientation` を抽象に追加し、CalibrationCaptureScreen は構成非依存になった
  （preview component だけは React なので UI 層で `configId → PreviewView` マップ、DevSandbox と同型）。
- **submitClip = `runPipeline1`（finalize 内包）+ `pollPipeline2`**。README 当初の「POST finalize 別途」は
  redundant だった（dataflow の `registerClip` が POST /api/clips + finalize 両方を実行する）。
- **remove はローカル削除のみ**（サーバ DELETE は叩かない）= 現行 clipPipeline 踏襲。
- **多軸 QualityVector スコア表示の追従は task 18 のスコープ外**（= task 15 home-tab）。サーバ DTO は既に
  `qualityVector`（多軸・合計なし）+ 単一 `scoring` ステップへ移行済みだが、dataflow Clip 型と UI は旧
  `qualityBreakdown`（3 層合計）のまま据置。配線（本タスク）と表示モデル追従（task 15）は別関心として分離。
- 新規ファイル: `dataflow/submit.ts`、`dataflow/steps/lifecycle.ts`、`src/clips/hooks.ts`、
  `src/clips/persistence.ts`、`src/domain/clipLabels.ts`。

### 実機 1 回目で発覚 → 再設計（段レジューム + identity = signature_hash）

実機で本番フローを回すと cNFT mint が `0x1781 = InsufficientMintCapacity`（= dev merkle tree 容量 32 を
使い切り）で落ちた。配線自体は撮影→署名→アップロード→TP→mint 直前まで完走しており **task 18 の配線は成立**。
tree を depth=14（16384）で作り直して `.env` の `EXPO_PUBLIC_MERKLE_TREE` を差し替えて解消。

この時 retry が `POST /api/clips/local_.../retry` で 404 になり、ユーザー指摘で retry/identity を再設計した:

- **クリップの同一性 = signature_hash**（= blur 後 D2 署名で確定する確定動画の一意 id）。サーバ `id`
  （`clip_<hash12>_<ts>`）は signature_hash 由来の単なる REST ハンドルで、別 identity ではない（`local_`→
  server-id の小細工と「server id」概念を撤去）。撮影〜D2 完了までの間だけ local id でローカル保持し、
  D2 完了の瞬間に **local id → signature_hash へ re-key**（唯一の id 遷移＝identity 誕生）。
- **Pipeline 1 は 4 段のチェックポイント付き再開可能パイプライン**（`Pipeline1Stage`）:
  `unsigned → capture-signed(D1) → blur-signed(D2=signature_hash 誕生) → registered`。
  各段の成果物（d1.mp4 / 署名済 rgb.mp4）を `workDir` に段が通るまで保持し、失敗段から再開する
  （欠けていれば前段へ降格＝生から再署名）。
- **submit と retry を単一の `advanceClip(clipId)` に統一**（`dataflow/pipeline.ts`）。初回投入も再試行も
  「現在 stage から前進するだけ」。`enqueueRecording` が撮影時に stage=unsigned で起こす。
  → `submit.ts`（submitClip/retryClipFlow）と orchestrator の `signRecording` は廃止。
- **Pipeline 2 のユーザー retry は撤去**（コスト高、stuck processing は server ops が再投入）。ErrorCard の
  「もう一度試す」は `登録済み` 未満（= Pipeline 1 段失敗）のみ表示。processing クリップは CollectionScreen
  起動時に signature_hash で 1 回だけ状態を引いて観測更新する。
- store: `applyServerStatus(targetId, status)` に変更（poll の status.id=サロゲートではなく signature_hash
  でキーするため）。未使用化した `signedClip`/`setSignedClip` は撤去。stake は signature_hash → server id を
  `resolveServerClipId` で解決して `/stake` を叩く。
- 新規/改廃: 追加 `dataflow/pipeline.ts`（enqueueRecording/advanceClip）、`steps/sign.ts` に
  `captureSign`/`blurSign`、`steps/pipeline2.ts` に `fetchClipStatusByHash`、`steps/lifecycle.ts` は
  `stakeClip`+`resolveServerClipId`（server retry step は撤去）。削除 `dataflow/submit.ts`。
- ⚠ 既知の限界: 「mint 成功後に POST /api/clips だけ失敗」 という稀な窓では、再試行で二重 mint の
  可能性が残る（= DB 行が無いと findReusableMint が効かない）。pre-mint の DB 記録が要る別件。
- tsc + purity green。**この再設計の実機 E2E は未実施**（= 旧モデルで作られた leftover error クリップは
  `workDir`/`stage` を持たないので retry 不可 → 削除して新規撮影で検証する）。

### 表示クリーンアップ（autoCategory 撤去 + signature_hash 表示）

実機で Collection に「Clip abcd…」(id ベース名) が出ていた + `autoCategory` が表示経路に残っていた件。調査で
**`autoCategory` は常に null = 死んでいる**ことが判明（`web/lib/mapper.ts` が `rowAny.autoCategory ?? null`
で埋めるだけ、DB 列なし、現行 gemini-video-dense ラベリングは 8 値カテゴリを生成しない。実際のラベリング出力
= segment description + summary は R2 `semantic.jsonl` にあり ClipDto に載っていない）。

ユーザー判断: タスク説明の surface（= server summary を DTO に通す full-stack 変更）は見送り、**死んでいる
autoCategory を撤去して全部 signature_hash 表示**にする。実施:

- app の `autoCategory`/`autoCategoryConfidence` を全撤去（dataflow types / ServerClipStatus / store
  applyServerStatus / steps/pipeline2 のイベント / index）。legacy `taskId` も撤去（findTask 経由の表示も）。
- クリップ表示は **signature_hash** に統一（`domain/clipLabels.ts` の `clipTitle()`: 短縮 16 文字 + …、
  未署名は「署名処理中…」）。ClipCard（`TaskName`→`ClipName`、`TaskThumb`→cNFT 固定の `ClipThumb`）、
  ClipDetailSheet（header + SIGNATURE HASH 行に full SHA-256）、StakeSheet（CLIP 行）を配線。
- 未使用 import（useMemo / findTask / TaskDef / describeAutoCategory(Short)）も除去。tsc + purity green。
- ⚠ server (web) の ClipDto は依然 `autoCategory: null` を送る（= app は無視）。 web 側の dead field 撤去は
  別途 deploy が要るため未実施（= 任意）。

### app-kill 復帰のための durable 録画（必要十分な Pipeline 1 再試行）

「blur 中にアプリが kill される」ケースで Pipeline 1 を確実に再開できるよう、録画と署名中間物を
**durable な Documents 配下に置く**ようにした（従来は native が `NSTemporaryDirectory()` = tmp/ に録画して
いたため、 OS が tmp を purge すると再署名の元データも失い復帰不可だった）。

- `ultraWideConfig` / `arkitConfig` の `startRecording` が `${documentDirectory}recordings/rec-<ts>/` を
  native に渡して録画させる（native は plain path を要求 → file:// を剥がす。 返値は file:// URI。
  native module は元から path 引数対応なので **Swift 変更なし = 再ビルド不要、 JS のみ**）。
- `enqueueRecording` の作業 dir を `${sessionDir}sign/`（durable）にした（旧 cache から移動）。 raw + 署名中間物
  (d1.mp4 / 署名済 rgb.mp4) が同じ durable clip dir に揃う。
- `advanceClip` の `effectiveStage` が各段の成果物の実在を確認し、 欠けていれば前段へ降格して再開する
  （= cache 的な部分喪失にも頑健。 最悪は raw から再署名）。
- 登録完了 (`registered`) で clip dir ごと掃除、 破棄は `discardClip` が dir も掃除（Documents にゴミを残さない）。
- これで「停止 → blur 中に kill → 再起動」 で clip は error 表示 → 「もう一度試す」 = `advanceClip` が
  durable な raw/中間物から該当段を再開する。
- ⚠ inherent な限界: 「録画中 (停止前) に kill」 は AVAssetWriter が finalize されず mp4 が壊れる + clip 未生成
  なので復帰不可（= 仕様上どうにもならない）。 復帰対象は「停止後 = signature_hash 確定前後の処理段」。

## 成功基準

- 本番フロー（RootNavigator → CaptureMode）で 録画 → 署名 → アップロード → TP/process + cNFT mint →
  POST /api/clips → finalize → Pipeline 2 が **dataflow 経由**で 1 クリップ E2E 通過。
- CollectionScreen が dataflowStore からクリップ一覧/状態を表示、retry/remove 動作。
- `services/clipPipeline.ts` + `services/pipeline1.ts` 削除済み、参照ゼロ。
- `npx tsc --noEmit` green、`npm run check:dataflow` green（dataflow に react/react-native/zustand 直 import なし）。
- DevSandbox は `EXPO_PUBLIC_USE_SANDBOX=1` で引き続き到達可能。

## 進捗

- [x] 1. 起点フラグ化（`App.tsx` + `src/env.ts` + `.env.example`、tsc green）
- [x] 2. dataflowStore 複数クリップ拡張（`clips: Record<id,Clip>` + `currentClipId` + actions
      `upsertClip`/`patchClip(id)`/`removeClip`/`renameClipId`/`applyServerStatus`/`replaceClips`、
      selectors `clipList`/`selectClip`/`selectCurrentClip`。Clip 型を canonical superset に拡張
      （`uploadProgress`/`previewVideoUrl`/`licenseCount`/`revenueUsdc` + legacy compat
      `taskId`/`reward`/`previewUris`）。UI 購読 hooks = `src/clips/hooks.ts`、表示ラベル =
      `domain/clipLabels.ts`。DevSandbox を `currentClipId` 経由に追従。tsc + purity green）
- [x] 3. submitClip オーケストレータ（`dataflow/submit.ts`: signed → `runPipeline1`(finalize 内包) →
      `pollPipeline2` を束ね、local clip 起こす→`renameClipId`→`applyServerStatus`。uploadProgress は
      step イベントから写像。エラーは clip.state='error' に反映し throw しない。stake/retry は
      `steps/lifecycle.ts`(POST /stake, /retry)。remove はローカルのみ=現挙動踏襲）
- [x] 4. 永続化アダプタ（`src/clips/persistence.ts` Layer 2）: dataflowStore を subscribe して
      AsyncStorage に persist（staked 除外、400ms debounce）、起動時 hydrate（uploading/processing は
      中断=error 化）。保存キーは旧 clipPipeline と同一で既存クリップ引継ぎ。`App.tsx` で init。
- [x] 5. CollectionScreen 配線（`useClips`=`src/clips/hooks`、retry=`retryClip`+`pollPipeline2`、
      remove=`removeClip`、stake=`StakeSheet`→`stakeClip`。on-chain merge 維持。Clip 型は dataflow）
- [x] 6. CalibrationCaptureScreen 配線 + 構成切替（録画を `config.*` 抽象経由に、停止時 `signRecording`
      1 回→`submitClip`(背景実行)。`clipStore.enqueue` 撤去。DevSandbox 同型の session handoff +
      構成スイッチャ（arkit/ultra_wide、待機中のみ）。**ハンドトラック/snapshot/orientation を
      `RecordingConfig` 抽象に取込み**、ジェスチャー層を構成非依存の「土台に乗るソース」化）
- [x] 7. 重複削除（`services/clipPipeline.ts` + `services/pipeline1.ts` を `git rm`、参照ゼロ＝
      残りはコメントのみ。ClipCard/ClipDetailSheet/StakeSheet を dataflow 型 + `domain/clipLabels` へ付替え）
- [~] 8. 検証（`npx tsc --noEmit` green、`npm run check:dataflow` green。**本番フロー実機 E2E は未実施**
      = ユーザーが実機で要確認。DevSandbox 再確認も `EXPO_PUBLIC_USE_SANDBOX=1` で要実施）

## 落とし穴メモ

- dataflowStore に AsyncStorage を直結すると Layer 1 の純粋性（react-native 非依存）を破る → 永続化は Layer 2 アダプタ。
- 本番アプリは現状 `services/clipPipeline`（+`pipeline1`）で**動いている**ので、配線途中で壊さないよう、
  画面単位で dataflow に切替えて検証してから旧サービスを削除する（削除は最後）。
- iOS ネイティブクラッシュは `.ips`（`idevicecrashreport -u <UDID> -e <dir>`）の faulting thread を見る。
