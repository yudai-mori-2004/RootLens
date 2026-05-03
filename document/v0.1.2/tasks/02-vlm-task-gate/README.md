# Task 02: VLM Task Gate

## 目的

ユーザーが指定したタスクの開始/終了条件を、撮影時スナップショットに対して VLM が自動判定できることを検証する。

## 背景

### なぜ VLM による条件判定が必要か

データ収集プロトコルは「ユーザーがタスク定義を指定し、開始/終了を自分でトリガーする」設計。ただし、ユーザーの自己申告だけでは品質を担保できない (適当にシャッターを切って報酬を得ようとするインセンティブがある)。

VLM がスナップショットを見て「散らかった洗濯物と両手がある (開始条件 OK)」「畳まれた洗濯物がある (終了条件 OK)」を自動判定することで、人手レビューなしに品質の最低ラインを設定できる。reject rate の低減はユニットエコノミクスに直結する (50% → 30% で worker payout を維持したまま gross margin が $38 → $58/hr に改善)。

セキュリティ機構ではなく品質ガイド。本気のスプーフィングは reputation や他の軸で対応する。

### なぜ Gemini Robotics-ER 1.6 か

2026/4/14 リリース。数千時間の egocentric manipulation デモで訓練済みで、タスク進行判定 (「このタスクは完了したか?」) がネイティブ capability。散らかった / 片付いた等の状態遷移判定、物体認識、手の存在確認を 1 call で処理できる。

- API: Google AI Studio / Vertex AI
- コスト: ~$0.001-0.003/call (画像入力 ~560 tokens)
- thinking budget 調整可能 (簡単な判定は低 budget で 1-2 秒)
- fallback: Gemini 2.5 Flash (~$0.0002/call、egocentric 特化訓練なし)

参照: https://deepmind.google/blog/gemini-robotics-er-1-6/ , https://ai.google.dev/gemini-api/docs/robotics-overview

## 検証内容

### Phase 1: 単発スナップショット判定

- カメラで撮影した 1 枚の画像 + タスク名 + 条件テキストを Gemini Robotics-ER 1.6 に送信
- 構造化レスポンス (match: bool, confidence: float, reason: string) を取得
- 複数タスク (洗濯畳み、皿洗い、掃除機がけ等) で精度を確認

### Phase 2: latency / cost 計測

- thinking budget の高低による latency 差
- 1 判定あたりの実コスト
- fallback (Gemini 2.5 Flash) との精度 / latency / cost 比較

### Phase 3: 境界ケースの確認

- 曖昧なシーン (半分だけ畳まれた洗濯物) での判定挙動
- 暗い室内 / 逆光 / ブレた画像での判定安定性
- 条件テキストの言語 (日本語 / 英語) による精度差

## 実装方針

ネイティブモジュール不要。RN 側で camera snapshot を取得し、Gemini API を HTTP で叩く。sandbox 画面に: タスク名入力 + 条件テキスト入力 + カメラプレビュー + 「判定」ボタン + 結果表示。

## 完了条件

- [ ] Gemini Robotics-ER 1.6 API で egocentric スナップショットの条件判定が動く
- [ ] 3 種以上のタスクで開始 / 終了条件の判定精度を記録
- [ ] latency / cost の実測値を記録
- [ ] fallback モデルとの比較データ
