# タスク 13: 音声 AI エージェント

UI_SPECS_JA.md §4.4, §8 の音声対話システムを実装する。

## アーキテクチャ (UI_SPECS_JA.md §8.1)

```
[常時オンデバイス]  sherpa-onnx: ウェイクワード「ヘイレンズ」+ VAD + STT
                      ↓ テキスト
[クラウド 1 往復]  Claude Haiku: DeviceContext + 発話 → 意図解析 + 応答
                      ↓ 応答テキスト + action JSON
[オンデバイス]     AVSpeechSynthesizer: テキスト → 音声読み上げ
```

## 実装単位

### 13a. sherpa-onnx 統合

- sherpa-onnx を iOS ビルドに組み込む (CocoaPods or SPM or xcframework)
- ウェイクワード検出モデルの選定とファインチューン (「ヘイレンズ」)
- VAD (Voice Activity Detection): 発話区間の自動検出
- STT (Speech-to-Text): 日本語対応モデル
- レイテンシ目標: ウェイクワード < 100ms、STT < 300ms

### 13b. Claude Haiku 意図解析

- システムプロンプト構築 (UI_SPECS_JA.md §8.3):
  - ロール定義、タスクリスト、DeviceContext 解釈ルール、応答スタイル
- DeviceContext (§4.8) の収集と送信
- action type に応じたアプリ状態遷移:
  - `task_matched` → タスク選択状態に
  - `start_recording` → カメラサブモードへ
  - `end_session` → ホームタブへ
  - `info_response` / `clarification_needed` → 対話継続
- コスト: 1 インタラクション約 $0.002、1 セッション $0.01-0.02

### 13c. TTS

- AVSpeechSynthesizer で応答読み上げ
- 開始レイテンシ目標 < 100ms
- 発話終了 → 応答開始の合計目標 < 1,300ms

## 完了条件

- 「ヘイレンズ」でウェイクワード検出 → STT → Haiku → TTS の往復が 1.3 秒以内
- 「洗い物しようと思う」で `task_matched` action が返る
- DeviceContext のバッテリー / orientation 情報に基づく案内ができる
