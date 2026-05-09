# Task 02: VLM Task Gate

## 目的

ユーザーが指定したタスクの開始/終了条件を、撮影時スナップショットに対して VLM が自動判定できることを検証する。

## 背景

### なぜ VLM による条件判定が必要か

データ収集プロトコルは「ユーザーがタスク定義を指定し、開始/終了を自分でトリガーする」設計。ただし、ユーザーの自己申告だけでは品質を担保できない (適当にシャッターを切って報酬を得ようとするインセンティブがある)。

VLM がスナップショットを見て「散らかった洗濯物と両手がある (開始条件 OK)」「畳まれた洗濯物がある (終了条件 OK)」を自動判定することで、人手レビューなしに品質の最低ラインを設定できる。reject rate の低減はユニットエコノミクスに直結する (50% → 30% で worker payout を維持したまま gross margin が $38 → $58/hr に改善)。

セキュリティ機構ではなく品質ガイド。本気のスプーフィングは reputation や他の軸で対応する。

### モデル選定 (実機検証で 2 回見直し)

#### 1 回目: Robotics-ER → generic Gemini

当初 `gemini-robotics-er-1.6` を default に想定していたが、実用途を再検討して **generic Gemini が適切**と判断した。Robotics-ER は VLA 前段の embodied reasoning モデル (3D 把持点座標、action planning 生成) で、「画像 + 条件文 → match bool」の単純 VQA には特化機能の大半が遊休。

#### 2 回目: flash → flash-lite (high-demand 503 対策)

実機テスト中に `gemini-2.5-flash` が high-demand 時間帯で 503 (model is overloaded) を頻発。free tier の flash は最も人気で混む。実 API で latency / 可用性を比較:

| Model | 状態 | latency | 備考 |
|---|---|---|---|
| **gemini-2.5-flash-lite** | ✅ stable | **1.51 s** | 採用。プール負荷軽い |
| gemini-2.5-flash | ✅ stable | 1.76 s | high-demand 時 503 多発 |
| gemini-flash-latest (alias) | ✅ alias | 2.27 s | flash-latest = 現状 flash 系の最新 |
| gemini-3.1-flash-lite-preview | ✅ preview | 1.79 s | 新世代 lite, preview 廃止リスク |
| gemini-3-flash-preview | ✅ preview | 3.21 s | 重い |
| gemini-2.5-pro / pro-latest / 3-pro-preview | ❌ 429 | — | free tier 範囲外 |

→ **default は `gemini-2.5-flash-lite`**。さらに `geminiClient.ts` で 503/429 の **指数 backoff retry** (3 回, 600ms / 1.2s / 2.4s) を入れて transient error も回避。

切替したい場合は画面の model フィールドで上書き:

- `gemini-2.5-flash` — 標準 flash
- `gemini-3.1-flash-lite-preview` — 新世代 lite
- `gemini-robotics-er-1.6-preview` — Robotics-ER (preview suffix 必要)

参照: https://ai.google.dev/gemini-api/docs/vision , https://ai.google.dev/gemini-api/docs/structured-output

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
