# RootLens データパイプライン仕様書

## 1. 全体構成

```
Pipeline 1 (デバイス)
  撮影 → C2PA 署名 → 顔ぼかし → C2PA 再署名 → R2 アップロード
        → TP /process → cNFT 発行 → POST /api/clips
                              ↓
Pipeline 2 (サーバー, CPU)                     ← 自動
  品質スコアリング + VLM 自動ラベリング → processed/ に書き出し
                              ↓
Pipeline 3 (サーバー, GPU)                     ← 手動
  WiLoR 手ポーズ推定 → processed/ に書き出し
```

Pipeline 1 はデバイス上で完結する。TP 登録と cNFT 発行も含まれ、`root_asset_id` 確定後にサーバーへ登録する。Pipeline 2 は登録を契機に自動実行。Pipeline 3 は手動トリガー。

Pipeline 2・3 の出力はいずれも `processed/<signature_hash>/` に個別クリップの処理結果として書き出される。複数クリップをデータセットとしてまとめる作業はパイプラインの範囲外であり、事後的に行う。

### 1.1 識別子

`signature_hash`: ぼかし済み MP4 の C2PA アクティブマニフェスト署名の SHA-256。デバイス上でぼかし・再署名完了時に確定し、全パイプラインを通じて不変のキー。`raw/` と `processed/` の両方でこの値をディレクトリキーとして使用する。

`root_asset_id`: TP 登録完了後に確定する Solana cNFT の asset id（base58）。Pipeline 2 の起動条件。`raw/<signature_hash>/signed-json.json` から参照可能。

---

## 2. Pipeline 1: 撮影 + プライバシー処理（デバイス）

### 2.1 撮影フロー

1. ユーザーが撮影モードに入り、ジェスチャーで撮影を開始する。
2. 何の活動を撮るかをアプリに事前申告しない。分類は Pipeline 2 が事後で行う。
3. 録画中はカメラで RGB 映像を、デバイス側ハンドトラッキングでリアルタイム手ポーズを記録する。撮影構成（§2.2）に応じて追加センサーも記録する。
4. ジェスチャーで撮影を終了する。
5. プライバシー処理（§2.3）と C2PA 署名（§2.4）をデバイス上で実行する。
6. アップロード（§2.5）をバックグラウンドで自動開始する。確認ダイアログは出さない。
7. 録画時間が n 秒未満（初期値: 1 秒）のクリップは自動破棄する。上限は 60 分で自動停止。

### 2.2 撮影構成

撮影構成はプラットフォームごとに複数定義できる抽象レイヤーとして設計する。各プラットフォームは利用可能な撮影構成のリストを持ち、新しい構成をいつでも追加できる。

現時点で定義されている撮影構成は以下の通り。

#### 超広角構成（iOS / Android 共通）

背面 ultra-wide camera（0.5x）を使用する。広い画角で両手の作業領域を捉える。iOS では AVCaptureSession、Android では Camera2 API。

出力ファイル:

| ファイル | 内容 | レート |
|----------|------|--------|
| `rgb.mp4` | RGB 映像（ultra-wide） | 30 fps |
| `realtime_handpose.jsonl` | フレームごとの timestamp + デバイス側手ランドマーク（21×2 関節） | 30 fps |
| `metadata.json` | 機種名、OS、アプリバージョン、カメラスペック（画角・焦点距離・解像度）、撮影構成識別子、キャリブレーション baseline | セッション毎 1 回 |

デバイス側手ランドマークは iOS では Apple Vision、Android では MediaPipe Hand Landmarker で取得する。このデータは Pipeline 2 のスコアリング用であり、学習用の手ポーズ推定は Pipeline 3 の WiLoR が担う。

#### ARKit 構成（iOS 限定）

ARKit world tracking + 背面 wide camera（1x）を使用する。6DoF カメラポーズ、IMU、LiDAR 深度（Pro 端末のみ）を同期取得できる。画角は超広角より狭く、発熱が大きい。

出力ファイル:

| ファイル | 内容 | レート |
|----------|------|--------|
| `rgb.mp4` | RGB 映像（wide 1x） | 30 fps |
| `realtime_handpose.jsonl` | フレームごとの timestamp + 手ランドマーク + カメラポーズ（4×4 変換行列）+ tracking_state | 30 fps |
| `imu.jsonl` | 加速度 / ジャイロ / デバイスモーション | 100 Hz |
| `metadata.json` | 超広角構成と同一フォーマット | セッション毎 1 回 |
| `depth/{frame_id}.png` | LiDAR 深度（Pro 端末のみ） | 30 fps |

時刻同期の基準は `ARFrame.timestamp`。IMU は録画開始から終了まで逐次書き出し。

### 2.3 プライバシー処理

デバイス上で撮影完了直後に実行する。サーバーには処理済みデータのみがアップロードされる。

Apple Vision の `VNDetectFaceRectanglesRequest`（revision 3）/ Android の同等 API でフレームごとに顔を検出し、ガウスぼかしを適用する。テキストのぼかしは行わない。

### 2.4 C2PA 署名

**署名 D1（生 MP4）**: 撮影直後、ぼかし前に Secure Enclave の P-256 鍵で ES256 署名。App Attest + RFC 3161 タイムスタンプ。3 段 PKI。c2pa 0.81 系ストリーミング署名。

**署名 D2（ぼかし済み MP4）**: ぼかし後に再署名。D1 を ingredient として参照、action にぼかし処理を記載。D2 のアクティブマニフェスト署名の SHA-256 が `signature_hash` となる。

### 2.5 アップロード

ぼかし済みデータのみを R2 にアップロードする。生データはアップロードしない。

```
raw/<signature_hash>/
  rgb.mp4
  realtime_handpose.jsonl
  metadata.json
  imu.jsonl                  # ARKit 構成のみ
  depth/                     # ARKit 構成 + Pro 端末のみ
    000000.png
    ...
```

R2 の事前署名 PUT URL による並列転送。iOS Background URLSession / Android WorkManager でバックグラウンド継続。アップロード完了後、デバイス上の生データ（ぼかし前 MP4）を削除する。

### 2.6 Title Protocol 登録

R2 アップロード完了後、デバイスが TP Gateway `POST /process` を呼び出す。TP は C2PA 署名を TEE 内で検証し、attestation を返す。デバイスはこの応答を `raw/<signature_hash>/signed-json.json` として R2 に保存する。

続いて `POST /extension/solana` で cNFT 発行用 partial transaction を取得、デバイスが署名・broadcast し、`root_asset_id` が確定する。

### 2.7 サーバーへの登録

`root_asset_id` 確定後、`POST /api/clips` でサーバーにクリップを登録する。`signature_hash`、`root_asset_id`、`recording_config` を含める。`root_asset_id` 未確定のまま登録することは認めない。

登録と `POST /api/clips/:id/finalize` を経て Pipeline 2 を起動する。

---

## 3. Pipeline 2: 品質スコアリング + 自動ラベリング（サーバー, CPU）

### 3.1 トリガー

`POST /api/clips/:id/finalize` で自動実行。`root_asset_id` が DB に確定済みであることを前提条件とする。

Pipeline 2 は撮影構成を問わず同一のパイプラインで処理する。撮影構成固有のデータがある場合は、存在すれば使い、なければスキップする。

### 3.2 品質スコアリング

3 層構成。後段ほどコストが高い。

#### 3.2.1 第 1 層: メタデータ解析

`realtime_handpose.jsonl` を読み込み、映像をデコードせずに算出する。コストはほぼゼロ。

| 指標 | 計算方法 |
|------|---------|
| フレームドロップ率 | フレーム番号列の欠番割合 |
| 手ランドマーク存在率 | 手が検出されたフレームの割合（片手 / 両手を区別） |
| 手の移動量 | 手首位置のフレーム間変位の平均・分散 |

ARKit 構成の場合、`imu.jsonl` と `realtime_handpose.jsonl` 内のカメラポーズ・tracking_state から追加メトリクスを算出する（トラッキング品質、RGB/センサー同期率、IMU 重力偏差、深度有効率）。追加メトリクスは総合スコアには含めず、カタログのフィルタ軸として公開する。

#### 3.2.2 第 2 層: フレームサンプリング解析

ぼかし済み MP4 から n_frame 秒おきに 1 フレームを抽出（初期値: 3）。CPU で数十秒、コスト $0.01 未満。

| 指標 | 計算方法 |
|------|---------|
| 輝度 | 平均輝度のヒストグラム。暗すぎ / 白飛びを検出 |
| シャープネス | ラプラシアン分散。ボケやブラーを検出 |
| オプティカルフロー | Farneback 法によるフレーム間フロー量。静止区間を検出 |
| フレーム間多様性 | ヒストグラム差分。ループ映像を検出 |

#### 3.2.3 第 3 層: VLM セマンティック解析 + 自動ラベリング

n_vlm 秒おきにフレームを VLM（Claude Haiku 4.5）に送信（初期値: 10 = Ego4D の dense narration（約 10 秒間隔）と同等密度）。30 分の動画で約 180 フレーム、約 $0.60/クリップ。密度はラベルの学習価値とコストのトレードオフで n_vlm により調整できる（n_vlm=30 なら約 $0.20）。

**スコア基準（0〜5）**:

| 基準 | 説明 |
|------|------|
| `task_activity` | 目的的活動を遂行しているか |
| `object_interaction` | 手が物体を操作しているか |
| `scene_match` | 環境が活動と合致しているか |
| `authenticity` | 本物の人間の手による実際の動作か |

**ラベリング**: 主ラベルはフレームごとの**具体的な行動記述文（dense narration）**。「どの手で・何を・どう操作しているか」を verb + noun を含む自然文で書く（Ego4D 流）。固定カテゴリ（`cleaning` / `laundry` / `cooking` / `studying` / `crafting` / `organizing` / `meal_prep` / `other`）は marketplace フィルタ用の**粗い派生ビュー**として併記するだけで主役ではない。taxonomy は固定せず、ジャンルは記述文の embedding から事後に導出・再分類できる設計とする（= 記述文を再生成せずカテゴリだけ付け替え可能）。クリップ全体の多数決で主カテゴリ + 信頼度を出す。

#### 3.2.4 総合スコア

| 層 | 配点 |
|----|------|
| 第 1 層: メタデータ | 15 |
| 第 2 層: フレームサンプリング | 15 |
| 第 3 層: VLM セマンティック | 70 |

**第 1 層（15 点）**: 手ランドマーク存在率 8、フレームドロップ率 4、手の移動量 3。

**第 2 層（15 点）**: 輝度 4、シャープネス 4、オプティカルフロー 4、フレーム間多様性 3。

**第 3 層（70 点）**: task_activity 25、object_interaction 20、authenticity 15、scene_match 10。算出式: `(全フレーム平均 / 5) × 配点`。

`task_activity == 0` のフレーム割合を `idle_ratio` として別途記録。棄却閾値は設けない。

### 3.3 processed への書き出し

Pipeline 2 の出力は `processed/<signature_hash>/` に書き出す。

```
processed/<signature_hash>/
  quality_scores.json        # 総合スコア + 全サブ指標
  semantic.jsonl             # フレーム単位のラベル（VLM 未推定フレームは直近の推定値で補間）
```

`semantic.jsonl` は全フレーム分の行を持つ。VLM が n_vlm 秒おきに推定したフレーム間は、直近の推定値で埋める。各行にモデル名・バージョンを記録する。

DB にも品質スコア、主カテゴリ + 信頼度、ステータス `ready` を書き込む。撮影者に push 通知。

### 3.4 コスト

30 分クリップあたり約 $0.60（n_vlm=10）。大半は第 3 層 VLM。密度を下げれば比例して安くなる（n_vlm=30 で約 $0.20）。

### 3.5 冪等性

メタデータ解析・フレームサンプリングは決定論的。VLM は非決定的のため再実行時に微小変動あり。

---

## 4. Pipeline 3: WiLoR 手ポーズ推定（サーバー, GPU）

### 4.1 位置づけ

ぼかし済み MP4 に対して WiLoR-mini による手ポーズ推定を実行し、結果を `processed/` に書き出す。RootLens チームが手動でトリガーする。

Pipeline 3 は撮影構成を問わず同一の処理を行う（RGB フレームのみを入力とするため）。

### 4.2 トリガー条件

Pipeline 2 完了かつ `ready` 状態のクリップに対してのみ実行可能。

### 4.3 WiLoR 推定

Modal GPU（A10G）。30 分クリップあたり数分、$0.10〜0.20。

ぼかし済み MP4 の各フレームを WiLoR-mini（ViTDet 手検出 + ViT ベースの MANO パラメータ推定）に通す。

フレームごとの出力:

| データ | 形状 |
|--------|------|
| `pred_keypoints_3d` | [2, 21, 3] |
| `pred_cam_t_full` | [2, 3] |
| `global_orient` | [2, 3] |
| `hand_pose` | [2, 45] |
| `hand_present` | [2] |

手が未検出のフレームではゼロ埋め。クォータニオンは恒等 [0,0,0,1]。

### 4.4 processed への書き出し

```
processed/<signature_hash>/
  wilor.jsonl                # フレームごとの WiLoR 推定結果（全カラム）
```

`wilor.jsonl` の各行は 1 フレームに対応し、上記の全出力フィールドを含む。ヘッダーにモデル名・バージョンを記録する。

### 4.5 冪等性

WiLoR は決定論的。再実行が安全。

---

## 5. ストレージ配置

```
rootlens-raw/
  raw/<signature_hash>/
    rgb.mp4
    realtime_handpose.jsonl
    metadata.json
    imu.jsonl                    # ARKit 構成のみ
    depth/                       # ARKit + Pro のみ
    signed-json.json             # TP 応答

rootlens-processed/
  processed/<signature_hash>/
    quality_scores.json          # Pipeline 2
    semantic.jsonl               # Pipeline 2
    wilor.jsonl                  # Pipeline 3
```

`raw/` と `processed/` は同じ `signature_hash` をキーにする。同一動画は同一ハッシュになるため、重複が自然に吸収される。`root_asset_id` が必要な場合は `raw/<signature_hash>/signed-json.json` を参照する。

DB（Supabase）:

| カテゴリ | 内容 |
|---------|------|
| クリップ | `signature_hash`、`root_asset_id`（notNull）、`recording_config`、デバイス情報、撮影日時、撮影時間、ステータス |
| Pipeline 2 | 品質スコア、VLM 分類カテゴリ + 信頼度 |
| ユーザー | ウォレットアドレス、KYC リファレンス |

---

## 6. クリップの状態機械

全クリップは自動アップロードされる。

```
アップロード中 → 処理中 → ready → staked
     ↓              ↓
アップロード失敗  処理エラー
```

| 状態 | 遷移条件 |
|------|---------|
| アップロード中 | Pipeline 1 実行中（`root_asset_id` 確定前） |
| アップロード失敗 | 再試行上限超過 |
| 処理中 | Pipeline 2 実行中 |
| ready | Pipeline 2 正常完了 |
| staked | delegate 設定済み |
| 処理エラー | Pipeline 2 失敗で再試行上限超過 |

---

## 7. コスト構造

全パイプラインの処理コスト合計は動画 1 時間あたり $1〜2 を上限とする。

| パイプライン | 対象 | 30 分あたり |
|-------------|------|-----------|
| Pipeline 1 | 全クリップ | Solana 手数料のみ |
| Pipeline 2 | 全クリップ | 約 $0.60（n_vlm=10、 Ego4D 同等密度） |
| Pipeline 3 | 販売対象 | $0.10〜0.20 |

合計 30 分あたり約 $0.70〜0.80（1 時間あたり約 $1.4〜1.6）。 上限 $1〜2/時 の範囲内。 ラベル密度 (n_vlm) を上げた分だけ Pipeline 2 のコストが上がる（= 密度と学習価値のトレードオフ。 n_vlm=30 なら合計 30 分 $0.40 以下）。