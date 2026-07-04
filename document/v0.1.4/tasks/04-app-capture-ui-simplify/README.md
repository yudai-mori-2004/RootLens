# 04. App UI 簡素化（撮影画面 / 一覧 / DevSandbox）

## 目的

撮影画面（CalibrationCaptureScreen）を「録画開始 → 停止 → 自動的に署名 + アップロード」の最小フローに削る。
キャリブレーション ceremony / TTS 音声ガイド / palm gesture / Pipeline 2-3 進捗表示 / mint 進捗 / staking
表示を全部撤去する。 詳細は別添「撮影画面 機能 inventory」参照。

## 読むべきファイル

- `document/v0.1.4/DATA_SPECS_JA.md` §2, §4
- `app/src/screens/CalibrationCaptureScreen.tsx`（902 行、 ほぼ全面書き直しに近い）
- `app/src/screens/CollectionScreen.tsx`（quality / mint / staking 表示を撤去）
- `app/src/devsandbox/DevSandboxScreen.tsx`（Pipeline 2/3 ボタン群を撤去、 「送信」 だけに）
- `app/src/components/ClipCard.tsx` 等の表示部品（あれば quality / autoCategory / delegate 表示撤去）
- `app/src/services/i18n/` または `assets/locales/`（`capture.tts.*`、 `capture.state.*`、 `capture.guide.*`
  などのキー削除）

## スコープ

### やること（撮影画面）

「**いるもの**」（v0.1.4 で残す）:
- 撮影構成スイッチャ（ultra_wide / arkit、 リアルタイム切替）
- カメラプレビュー
- 録画開始 / 停止 ボタン
- REC インジケータ
- 録画前カウントダウン（簡素化、 3 秒程度）
- 停止確認（誤停止防止、 簡素な long-press or 確認ダイアログ）
- 自動アップロード進捗バー（uploading → uploaded）
- エラー表示
- ヘッダ戻るボタン

「**いらないもの**」（v0.1.4 で撤去）:
- キャリブレーション ceremony（`announcing` → `awaiting_palm` → `palm_holding` → `adjust_needed` ループ
  → `calibration_confirmed` の state 群すべて）
- TTS 音声ガイド（`capture.tts.adjustUp/Down/Left/Right`、 `capture.tts.calibrationConfirmed` 等）
- `GestureStabilizer` を使った palm gesture 検出 / 開始トリガー
- 方向ガイダンス表示（`capture.guide.up/down/left/right`）
- `precapture_countdown` → `recording` → `stopping_confirm` → `finalizing` の細分化された state
  （`unsigned → recording → uploading → uploaded` まで縮小）
- Pipeline 2 進捗（`metadata-scan` / `frame-sampling` / `vlm-score` 表示）
- mint 進捗 / cNFT 発行アニメ
- 連続タスク撮影誘導（`next_task_announcing`、 task カタログ参照）
- `expo-speech` への依存（speak / awaitedSpeechSeqRef）

### やること（CollectionScreen）

- 一覧表示: clip の `signature_hash`（短縮 16 文字）+ state + createdAt + recording_config + duration_ms。
- 撤去: quality_score / autoCategory / autoCategoryConfidence / delegate / licenseCount / revenueUsdc
  関連表示、 staking ボタン、 retry ボタン（Pipeline 2 リトライ。 アップロード失敗の retry は残す）。
- 詳細シート（あれば）: SIGNATURE HASH（full）+ recording_config + duration + state のみ。

### やること（DevSandbox）

- 構成スイッチャ / プレビュー / 録画開始 / 録画停止 + 「**送信**」 ボタン 1 つだけに。
- 撤去: 「Pipeline 1 実行」 / 「Pipeline 2 結果確認」 / 「Pipeline 3 実行 / 結果確認」 / 「結果確認」 各ボタン。
- statusBar から rootAssetId / serverStatus 行を削除、 signature_hash + state + uploadProgress だけ表示。

### やらないこと

- recording-config（ultra_wide / arkit）のリアルタイム切替自体は維持。 設定 UI から切替可能に
  （DevSandbox と同型）。
- ナビゲーション構造（Onboarding / Login / Main / CaptureMode）の変更。
- 撮影 UX の完全再設計（次バージョンで購入者向け UI と一緒に再検討）。
- i18n の他キー（onboarding / collection ヘッダ等）の整理。

## 成功基準

- 撮影画面を開く → 構成を選ぶ → 録画開始 → 録画停止 → 自動的に署名 + アップロード →
  `state='uploaded'` 表示 → Collection に出る、 の流れが直感的かつブレずに通る。
- expo-speech / GestureStabilizer / 旧 state 群への参照ゼロ。
- `npx tsc --noEmit` green、 i18n 未使用キー警告ゼロ。

## 進捗

- [x] CaptureScreen.tsx へ書き直し（旧 CalibrationCaptureScreen 削除）:
      ready → countdown(3..1) → recording → confirm_stop（録画継続のまま確認）→ finalizing → ready。
      シャッターボタン式、 REC pill + 経過時間、 送信進捗チップ（useCurrentClip）、 構成スイッチャ復活。
      デリケートな session ハンドオフ（直列化 + カメラ解放待ち）と退場時 orientation 対策は原文温存。
- [x] expo-speech / palm gesture 依存除去（captureAudio / realtimeFeedback / gestureDetect /
      HandPoseOverlay / HandStatusBadge / taskCatalog / useScreenOrientation / staking /
      titleProtocol サービス削除。 効果音 captureSounds (= expo-av) は countdown / rec_stop 用に残置）
- [x] CollectionScreen: フラット一覧 + 温かいヘッダ + 3 状態 ClipCard（stake/quality/preview 撤去）
- [x] StakeSheet / ClipDetailSheet / portfolio/ ディレクトリ 削除
- [x] DevSandbox: Pipeline 2/3 ボタン撤去、 「送信」 1 本に
- [x] i18n: capture.tts.* / capture.state.* / capture.guide.* 削除、 停止確認 + a11y + uploadDone キー追加
- [x] tsc + purity green
