# Task 04: Collection Flow (統合デモ)

## 目的

サンドボックス 01 (hand pose / gesture)、02 (VLM task gate)、HandPose 録画機能を結合し、ユーザーが選んだタスクを「ジェスチャーで開始 → 録画 → ジェスチャーで終了 → VLM で完了判定」まで一貫して回す UX を実機で検証する。

01–03 の各パーツが独立に動くことは確認済み。本タスクは「データ収集体験そのものを成立させる」ことを確認する。

## 背景

### なぜ統合デモを sandbox に含めるか

各パーツ単体で動くことと、それらが時系列で連動して 1 本のデータ収集 UX として成立することは別の問題。特に:

- カメラの session 競合 (hand-pose と recording の AVCaptureSession 共有)
- frame stream を「detection / recording / snapshot」の 3 経路に分岐させた時の backpressure
- gesture トリガー (両手パー / 両手サムズアップ) が誤検出なく拾えるかの実機感
- VLM 開始判定の latency (1–3 秒) 中の UX (ユーザーは何を見せられるか)

これらは本実装フェーズで詰まると致命的なので、統合実装に入る前に最小フローで通しておく。

### ゲーム感覚で終了できる方針

サムズアップでキープしたら **OK か NG かに関係なく** その時点で撮影終了し、終わってから「条件と一致したか」をフィードバックとして返す。
理由:

- 「条件を満たさないと終了できない」UX はユーザーがイライラして撮影を放棄する
- データとして「ユーザーは終わったつもり」のシグナルは残る (たとえ NG でも棄却データとして使える)
- ジェスチャーを終了トリガーから完了判定にも使ってしまうと、最後のフレームに必ず thumbs-up が入って学習データが汚れる懸念があるが、それは終了 1 秒前後をクロップする後処理で対応可能

## 検証内容

### Phase 1: 状態遷移

- task list → brief → capture → result の遷移が UI として通る
- capture 内部の state machine: `await_palm → palm_holding → vlm_start_checking → countdown → recording → thumbs_up_holding → finalizing → result`
- 各遷移条件 (1 秒 hold、両手キープ、VLM 結果) が想定通りに発火

### Phase 2: 録画

- countdown 終了で AVAssetWriter による mp4 録画が開始
- 終了時に finalizeWriting → 出力 mp4 がプレイバック可能
- 録画長と state machine の経過時間が一致

### Phase 3: ジェスチャー連動 VLM 判定

- 開始: 両手パー 1 秒キープ → 開始条件 VLM 判定
  - OK → カウントダウン → 録画開始
  - NG → ステータスバーに不一致理由を表示し await_palm に戻る (撮影プレビューは止めない)
- 終了: 両手サムズアップ 1 秒キープ → 終了条件 VLM 判定
  - 結果に関係なく録画終了 → result 画面でフィードバック

### Phase 4: 警告フィードバック

- 録画中に両手検出が外れた瞬間に Vibration (200ms)
- 右上のインジケーター: 緑 ✋ ↔ 赤 ✕ で視覚フィードバック

## 実装方針

iOS のみ動作確認 (Pixel 10 / Android は本実装フェーズで対応)。

### Native 拡張 (`app/modules/hand-pose/ios/`)

- `HandPoseCameraController` を singleton (`.shared`) 化。複数の view / module 関数が同 session を参照できるように
- `VideoRecorder` (AVAssetWriter ラッパー) 追加。VideoDataOutput の CMSampleBuffer を分岐させて mp4 化
- `HandPoseModule` に AsyncFunction 追加:
  - `captureSnapshot()` — 直近 frame を JPEG 化して file:// URI 返却 (VLM 判定用)
  - `startRecording(outputPath)` / `stopRecording()` — 録画制御

### TS 側 (`app/src/sandboxes/04-collection-flow/`)

```
tasks.ts                  - 予定タスクカタログ (洗濯畳み / 皿洗い / パスタ / 掃除機 / ベッドメイキング)
stateMachine.ts           - capture flow の reducer + state types + classifyHands ヘルパー
CollectionFlowScreen.tsx  - top-level (mode 切替: task_list / brief / capture / result)
components/
  TaskListView.tsx        - タスク選択リスト
  BriefView.tsx           - タスク詳細 (start/end conditions + イラスト placeholder + 始めるボタン)
  CaptureView.tsx         - メインキャプチャ画面 (state machine + 副作用)
  ResultView.tsx          - 結果フィードバック (VLM 終了判定 + 録画 URI + duration)
  CountdownOverlay.tsx    - 3,2,1 のセンターオーバーレイ (rAF)
  HandStatusBadge.tsx     - 録画中の右上インジケーター (緑✋ / 赤✕)
```

## Asset 配置 (任意)

UI ビジュアルとして以下のパスに asset を置くと自動的に表示される。未配置でも動作する (placeholder 表示)。

```
app/assets/sandbox-04/tasks/<task-id>/start.png   - 開始条件のイラスト (16:9 推奨)
app/assets/sandbox-04/tasks/<task-id>/end.png     - 終了条件のイラスト
```

差し替え時は `tasks.ts` の `TASKS` 配列で対応エントリの `startIllustration` / `endIllustration` に `require('...')` を入れる (Metro が build-time に解決)。

警告音を入れる場合は `app/assets/sandbox-04/sounds/warning.mp3` に配置し、`CaptureView.tsx` の警告 vibration 箇所に `Audio.Sound.createAsync(require('...'))` を追加する。

## 完了条件

- [ ] iOS 実機で task list → brief → capture → result が一貫して通る
- [ ] 両手パー 1 秒 → VLM 開始判定 → 通れば countdown → 録画開始
- [ ] 録画中に両手が外れると Vibration + 右上インジケーター切替
- [ ] 両手サムズアップ 1 秒 → VLM 終了判定 → result 画面で表示 (OK/NG 問わず)
- [ ] 録画 mp4 が file:// URI で受け取れ、システムプレイヤーで再生可能
- [ ] 開始 NG 時はカメラプレビューが止まらず、ステータスバーで理由表示

## 制限事項 (sandbox 段階)

- iOS のみ。Android は v0.1.2 統合フェーズで対応
- ARKit / motion capture 3D データ (EgoDex 同等) は本タスクではスコープ外。録画は mp4 のみ
- IMU 同梱や C2PA 署名は v0.1.2 統合フェーズで sensor-session と組み合わせる
- 録画を中断した場合 (画面遷移キャンセル等) のクリーンアップは `useEffect` cleanup で stop は呼ぶが、出力 mp4 が壊れる可能性あり (本番では rollback / temp 削除を実装)
