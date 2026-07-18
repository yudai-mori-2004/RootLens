# 14. 撮影フロー抽象化 + 音声コマンドフロー

## 目的

店舗実運用 (2026-07-18) でサムズアップ終了ジェスチャーの検知率に個体差があり、全く通らない
装着者がいた。開始・終了を音声コマンド (「さつえいスタート / ストップ」) に任せるフローを追加し、
既存のジェスチャーフローと設定画面で切り替えられるようにする。

## 読むべきファイル

- `app/src/screens/captureFlow/` — フロー抽象 (types / gestureFlow / voiceFlow / registry)
- `app/src/screens/CaptureScreen.tsx` — 状態機械。フロー差分は 2 接合点 (キャリブ確定後の行き先、
  録画中の停止トリガー) + フロー固有 state の委譲
- `app/modules/arkit-capture/ios/SpeechCommandController.swift` — オンデバイス ja-JP 音声認識
  (SFSpeechRecognizer)。~1 分制限はタスク再起動ループで回避。キーワード照合は Swift 側
- `app/src/services/captureAudio.ts` — isAudioBusy() (= 自アプリ TTS の拾い込み防止ゲート)

## スコープ

やること:
- CaptureFlow インターフェース + registry。フロー追加 = ファイル 1 つ + state kind + 登録
- voice フロー: キャリブレーション (パー) は共通のまま、確定後は開始コマンド待ちで停止
- 設定画面「開始・終了の操作」セグメント (gesture / voice、既定 gesture)
- マイク・音声認識の Info.plist 文言 (= 音声は保存されない・端末外に出ないことを明記)

やらないこと:
- 録画クリップへの音声トラック追加 (しない。合意書「音声は録音しません」のまま)
- キャリブレーション方式の変更
- マニュアルの改訂 (= 実機検証でフローが確定してから)

## 成功基準

- gesture フローの挙動が改修前と同一 (= リグレッションなし)
- voice フロー: キャリブ確定 → 「さつえいスタート」で録画開始 → 「さつえいストップ」で終了
- TTS 再生中の音声コマンドは無視される (= 自己発火なし)
- 実機で騒音環境 (店舗) の誤起動率を確認

## 進捗

- 2026-07-18: 実装完了 (TS + Swift)。tsc 通過。実機未検証 (native 変更のため expo run:ios での
  リビルドが必要)。誤起動対策: 2 語複合キーワード + transcript 末尾 16 文字照合 + 2 秒クールダウン。
