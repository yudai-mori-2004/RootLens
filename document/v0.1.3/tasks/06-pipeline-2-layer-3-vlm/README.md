# タスク 06: Pipeline 2 第 3 層 (VLM セマンティック解析、 55 点)

## 目的

署名済 MP4 から n_vlm 秒ごとに 1 フレームを抽出し、 Claude Haiku 4.5 に送って 4 基準 (= タスク関連性 / 物体操作 / 環境一致 / 本物さ) を 0-5 で採点させる。 データの中身 (= タスク遂行・手の操作) が価値の本体であり、 全 100 点中 55 点を占める。 1 クリップ約 $0.18 (= n=30s 60 フレーム想定)。

## 読むべきファイル

### 仕様
1. `document/v0.1.3/DATA_SPECS_JA.md` §3.2.3 第 3 層: VLM セマンティック解析 + §3.2.4 第 3 層内訳

### Anthropic SDK
2. `anthropic-sdk-python` docs (= 最新)、 特に Vision (image input) + structured output / JSON mode
3. 既存呼び出し参考: `server/scripts/add_phase_labels.py` (= Pipeline 3 で Claude Haiku を画像送信で呼ぶサンプル、 base64 JPEG + system prompt + JSON 返却)

### タスク定義
4. (本フェーズでは hard-coded) タスクごとの開始 / 終了条件 + 典型的な環境説明 ─ system prompt に挿入する。 詳細は後続フェーズでタスクカタログ実装

## 4 基準

| 基準 | 配点 | 説明 (= VLM への指示) |
|---|---|---|
| `task_activity` | 20 | タスクに関連する動作を行っているか。 0 = 完全に無関係、 5 = タスクを明確に遂行中 |
| `object_interaction` | 15 | 手が物体を操作しているか。 0 = 何にも触れていない、 5 = 道具 / 対象物を能動的に操作している |
| `authenticity` | 10 | 本物の人間の手による実際の動作に見えるか。 0 = 明らかに偽造 / 画面再撮影 / マネキン、 5 = 自然 |
| `scene_match` | 10 | 環境がタスクに適合しているか。 0 = 完全に不一致 (= 例: 「洗い物」 タスクで草原)、 5 = 典型的な環境 |

加えて `idle_ratio` = `task_activity == 0` のフレーム割合。 これは score には算入しないが、 買い手向けカタログのフィルタ軸として `clips.idle_ratio` カラムに保存する。

## スコープ

### やること

1. **Modal app**: `rootlens-layer3-vlm` (= CPU 2 cores / 1 GB / timeout 600s)
2. **Modal Secret**: `anthropic-api-key` で `ANTHROPIC_API_KEY` を注入
3. **入力**: `content_id` + `task_id` + `vlm_interval_sec` (= default 30) を query string で受け、 R2 から `raw/<content_id>/rgb.mp4` を download
4. **フレーム抽出**: cv2 で `int(fps * vlm_interval_sec)` 間隔で frame を読み、 各フレームを 1024px 幅にリサイズ + JPEG quality 70 でエンコード (= 約 50-100 KB / フレーム、 60 フレームで合計 ~5 MB)
5. **VLM 呼び出し**:
   - モデル: `claude-haiku-4-5`
   - 画像送信は `messages` API の image content block (= base64)
   - system prompt: 「あなたはタスク遂行映像の評価者です。 タスク `{task_id}` の開始条件は `{start_condition}`、 終了条件は `{end_condition}`、 典型的な環境は `{scene_description}`。 各フレームを評価して...」
   - user prompt: 「以下の N 枚は撮影者が `{task_id}` を行っているとされる映像のサンプルです。 各フレームを以下の 4 基準で 0-5 で採点し、 短い根拠テキストを添えて JSON で返してください...」
   - 出力 JSON schema: `{frames: [{frame_idx, task_activity, object_interaction, scene_match, authenticity, rationale}], ...}`
6. **採点集計**:
   - 全フレームの平均値を 4 基準各々で計算
   - `score = (task_activity_avg / 5 × 20) + (object_interaction_avg / 5 × 15) + (authenticity_avg / 5 × 10) + (scene_match_avg / 5 × 10)`、 四捨五入で整数化
   - `idle_ratio = task_activity == 0 のフレーム数 / 全フレーム数`
7. **出力**:
   ```json
   {
     "score": 48,
     "taskActivityAvg": 4.2,
     "objectInteractionAvg": 4.0,
     "authenticityAvg": 4.8,
     "sceneMatchAvg": 4.5,
     "idleRatio": 0.08
   }
   ```
8. **冪等性**: VLM 呼び出しは非決定的 (= temperature > 0)。 スコアは微小に変動しうる。 実装側で再採点時の変動は許容する旨を docstring に明記

### やらないこと

- バッチ API による低コスト化 (= 後続最適化)
- フレーム単位の rationale 永続化 (= 集計値のみ保存)
- VLM プロンプトの A/B テスト (= 後続)
- タスクカタログのフル実装 (= 本フェーズでは hard-coded 1-2 タスク)
- VLM 結果のキャッシュ (= 別途、 同一 content_id で再呼び出しを避ける機構は task 03 の workflow 側で扱う)

## 成功基準

- [ ] `modal deploy` 後、 サンプル MP4 で Layer3Score JSON が返る
- [ ] 4 基準の平均値が全て 0..5 範囲内
- [ ] score が 0..55 の整数
- [ ] `idle_ratio` が 0..1 範囲内
- [ ] 5 秒サンプル MP4 (= 1 フレームだけサンプリングされる) で正常に動作
- [ ] 30 分 1080p MP4 で 5 分以内に完了 (= 60 フレーム × Haiku API ~5s/req = 300s 目安)
- [ ] VLM が JSON を返さなかった場合 (= フリーテキスト) の fallback として、 各 metric を 2.5 (= 中央値) で埋め、 errorMessage に「VLM JSON parse failed」 を入れる
- [ ] `ANTHROPIC_API_KEY` が未設定の Modal 環境で fail-loud (= 黙ってモック値を返さない)
- [ ] `v0.1.3/server/lib/modal.ts::callVlmScore` から呼び出せる
