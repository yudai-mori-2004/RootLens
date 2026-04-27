# Task 06: Title Protocol Extension (sensor-depth / sensor-imu WASM) + 公開ページ可視化

## 目的

抽象センサー層で取得した raw API レスポンス入りの C2PA 署名済みコンテンツを、Title Protocol で登録可能にし、公開ページで可視化する。

達成事項:

1. **Title Protocol Extension** (`sensor-depth` / `sensor-imu`) を WASM 実装し、TP Global Config に登録
2. 各 Extension は対応する C2PA assertion を読み、決定論的に検証 + 構造化結果を JSON で返す
3. **RootLens SDK** (`app/src/services/titleProtocol.ts`) の `processor_ids` 解決ロジックに sensor-* を統合
4. **公開ページ** (`web/`) で raw センサーデータの可視化:
   - depth: カラーマップ表示
   - IMU: タイムシリーズグラフ
   - 動画: 再生 + IMU 同期表示

### 思想

- **撮影時アーキテクチャはフラット並列**: Camera / Depth / IMU は等価な ISensor として並列扱い (Task 02 の SensorSession 抽象)
- **Extension 化 (TP cNFT) では camera を優遇**: Camera データは特徴量・ユースケースの幅が大きく、すでに `image-pdq` / `video-vpdq` / `cert-*` 系で個別 Extension が成熟している。Camera を 1 Extension に統合する意味は薄い。一方 Depth / IMU はユースケースが狭く、細分化の必要がない (1 sensor 種 = 1 Extension)
- → **`sensor-camera` Extension は立てない**。Camera 関連メタは既存の `cert-*` / `image-pdq` / `video-vpdq` で十分カバーされ、追加の `c2pa.metadata` (EXIF) も assertion として乗る
- **意味付けは consumer 側**: TP Extension と公開ページが API path 名を受け取り、対応する可視化ロジックに dispatch する
- **意味のあるデータは cNFT のオフチェーンに集約**: signed_json に raw API レスポンスを含む。on-chain には spec hash + 検索可能な最小メタのみ

## 仕様書参照

- v0.1.0 §6 Title Protocol Extension
- v0.1.0 §7 公開ページ
- Title Protocol リポジトリ `/Users/forest/WebCreations/title-protocol/` の Extension 実装パターン (cert-* / image-pdq 系)
- Task 01 APPENDIX 第 8 節 (assertion ラベル設計)

## 技術スタック

```
[RootLens app (撮影 + 公開)]
  signed_uri (C2PA assertion 入り JPEG/mp4)
        │
        ▼
[Title Protocol SDK (RootLens app/src/services/titleProtocol.ts)]
  buildProcessorIds(signer_org, mediaType, sensors)
    → ["core-c2pa", "cert-rootlens", "image-pdq" or "video-vpdq",
       "sensor-depth", "sensor-imu"]
        │
        ▼
[Title Protocol ノード (TEE 内処理)]
  Camera 系: 既存 Extension で処理
    ├── cert-rootlens / cert-google 等 : 署名チェーン検証
    ├── image-pdq / video-vpdq         : 知覚ハッシュ (Camera 出力本体)
    └── (Camera のメタは C2PA `c2pa.metadata` (EXIF) として標準埋め込み)

  Depth / IMU: 新規 Extension で処理
    ├── sensor-depth  : io.rootlens.capture.*.depth.* assertion 読み取り
    │                   → JSON {frames: [...], api_path, ...}
    └── sensor-imu    : io.rootlens.capture.*.imu.* assertion 読み取り
                        → JSON {samples: [...], api_path, sensor_metadata: {...}}
        │
        ▼
[Solana cNFT 発行]
  cert-rootlens cNFT, image-pdq cNFT, ...   (既存)
  sensor-depth cNFT  (off-chain JSON URI)   (新規)
  sensor-imu cNFT    (off-chain JSON URI)   (新規)
        │
        ▼
[公開ページ (rootlens.io / web/)]
  cNFT を読み出し → 各 sensor の可視化コンポーネントに dispatch
    ├── DepthMapVisualizer  (PNG16 → カラーマップ canvas 描画)
    ├── ImuTimeSeriesPlot   (IMU samples をグラフ表示)
    └── VideoSyncPlayer     (動画再生 + IMU 同期)
```

## 実装内容

### Phase 1: WASM Extension の入出力契約定義 — PENDING

2 つの Extension `sensor-depth` / `sensor-imu` を Title Protocol 側に追加する。WASM 実装の詳細 (ホスト関数 ABI, c2pa-rs の WASM ビルド可否, メモリ制約への対処) は **Title Protocol リポ側で別途扱う**。本タスクは **RootLens 側から見た入出力契約**のみ確定する:

**入力 (RootLens の C2PA assertion から TP ノードに渡すもの)**:

- `sensor-depth`: `io.rootlens.capture.*.depth*` プレフィックスの全 assertion
- `sensor-imu`: `io.rootlens.capture.*.imu*` プレフィックスの全 assertion (動画なら CAMM track への参照を含む)

**出力 (cNFT の off-chain JSON に載せる構造)**:

- `sensor-depth`: `{ "api_paths": [...], "frames": [{api_path, pixel_format, width, height, depth_hash, ...}, ...] }`
- `sensor-imu`: `{ "api_paths": [...], "sensors": [{api_path, sensor_name, vendor, sample_count, hash, ...}], "stream_track": {...} }`

実装の進め方は Title Protocol リポ側のタスクに委譲。RootLens 側の関心は「上記入出力契約に合うように撮影時 assertion を生成すること」と「cNFT の off-chain JSON を読んで可視化すること」のみ。

### Phase 2: Title Protocol への登録 (TP リポ側で実施) — PENDING

- Extension ID 採番: `sensor-depth`, `sensor-imu` (RootLens プロジェクト命名)
- WASM 登録 / Global Config 更新の手順は Title Protocol リポ側のタスクで実施
- 本タスクは「Extension ID が解決可能になった」ことを完了条件として参照する

### Phase 3: RootLens SDK の processor_ids 統合 — PENDING

`app/src/services/titleProtocol.ts` の `buildProcessorIds` 関数を拡張:

```typescript
function buildProcessorIds(signerOrg, mediaType, sensors) {
  const ids = ['core-c2pa'];
  
  // 既存 cert extension
  const certMatch = CERT_EXTENSION_MAP.find(...);
  if (certMatch) ids.push(certMatch.id);
  
  // 既存 perceptual hash (Camera 出力の特徴量はここでカバー)
  ids.push(mediaType === 'video' ? 'video-vpdq' : 'image-pdq');
  
  // sensor extensions (新規 — Camera は sensor-camera を立てない、上記の image/video-pdq でカバー)
  if (sensors.hasDepth) ids.push('sensor-depth');
  if (sensors.hasImu)   ids.push('sensor-imu');
  
  return ids;
}
```

`sensors` は SensorCaptureResult 配列を見て判定する単純なロジック (撮影時に取れた sensor が反映される)。

### Phase 4: 公開ページ depth カラーマップ表示 — PENDING

`web/` 配下に追加:

- `web/components/DepthMapVisualizer.tsx`:
  - cNFT off-chain JSON から depth_hash を取得
  - Off-chain ストレージ (R2) から depth pixel buffer の生バイト (PNG16) を fetch
  - canvas 上で擬似カラーマップ描画 (近=赤 / 遠=青のグラデーション、または turbo / viridis colormap)
  - 複数 API path がある場合は切替 UI (例: "AVCaptureDepthDataOutput / ARKit sceneDepth / smoothedSceneDepth")
- 平面率 (depth 分散) の計算 + 表示は **公開ページ側で実装** (RootLens app 側では計算しない)

### Phase 5: 公開ページ IMU タイムシリーズ表示 — PENDING

- `web/components/ImuTimeSeriesPlot.tsx`:
  - cNFT JSON から IMU samples を取得
  - sensor 種類ごとに別グラフ (acc / gyro / mag / pressure / etc.)
  - X 軸: time (ns), Y 軸: 各軸の値
  - sensor metadata (vendor / name / version) を表示

### Phase 6: 公開ページ 動画 + IMU 同期表示 — PENDING

- `web/components/VideoSyncPlayer.tsx`:
  - mp4 を `<video>` で再生
  - 再生時刻 (`video.currentTime`) に応じて IMU グラフのカーソル / depth keyframe をハイライト
  - CAMM track の sample timestamp と同期

### Phase 7: 統合検証 — PENDING

- 撮影 → TP 登録 → 公開ページで sensor データ可視化が end-to-end で動く
- 異なる機種 (LiDAR 有 / 無, ToF 有 / 無, 廉価 / フラグシップ) で取れた assertion がそれぞれ可視化される
- 動画と静止画の両方で動く

## スコープ外

- 編集機能 (v0.1.2 以降)
- 動画 depth の連続表示 (v0.1.2 以降の検討)
- TP Extension のガバナンス自動化 (DAO multi-sig 手動運用は v0.1.x 継続)

## 完了条件

- [ ] `sensor-depth` / `sensor-imu` Extension の入出力契約が確定 (RootLens 側 assertion 仕様と整合)
- [ ] WASM 実装 / Global Config 登録は **Title Protocol リポ側で実施** (本タスクは契約合意で完了とみなす)
- [ ] RootLens SDK の processor_ids 解決に `sensor-depth` / `sensor-imu` 追加
- [ ] 公開ページに DepthMapVisualizer / ImuTimeSeriesPlot / VideoSyncPlayer 追加
- [ ] 撮影 → TP 登録 → 公開ページ end-to-end 検証

## 完了日: TBD

## ディレクトリ構成 (予定)

```
title-protocol/wasm/                 (TP リポ側で実装。RootLens 本タスク範囲外)
├── sensor-depth/src/lib.rs
└── sensor-imu/src/lib.rs

root-lens/app/src/services/
└── titleProtocol.ts                 (processor_ids 拡張)

root-lens/web/components/
├── DepthMapVisualizer.tsx
├── ImuTimeSeriesPlot.tsx
└── VideoSyncPlayer.tsx

root-lens/web/lib/
└── sensorRendering.ts               (cNFT JSON → 可視化用データの変換)
```

## 並列調査が必要な項目 (実装中にエージェントで補強)

- Solana cNFT off-chain JSON のサイズ実用上限と Bubblegum tree depth との関係
- depth pixel buffer の R2 配信パフォーマンス (200KB × 動画キーフレーム数)
- 公開ページの平面率計算アルゴリズム (depth 分散しきい値 / outlier 除外)
- 動画 + IMU 同期表示の Web 実装 (HTMLVideoElement の `timeupdate` で十分かどうか / MediaSource Extensions が必要か)
