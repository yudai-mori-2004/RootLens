# 07. 手動アップロード + 全画面 landscape + arkit バケット分離

## 目的

v0.1.4 のアプリ全貌を「ジェスチャーでキャリブレーション → 撮影 → (あとで) アップロード」の 3 手に確定する。
撮影直後の自動アップロードを廃止し、 マイビデオ (左タブ) を「アップロード待ち一覧」に作り替える。
UI 全体を横持ち (landscape) ベースにし、 arkit 構成の raw は専用バケットに分離する。

## 設計判断 (= 2026-07-04 確定)

### 1. 撮影フロー: ジェスチャーキャリブレーション復活

タスク 04 で一度撤去したジェスチャー式撮影 (= palm 3 秒 hold → 中央判定 → 方向ガイド TTS →
確定 → カウントダウン → 録画 → thumbs-up 立て続けで停止) を復活。 ヘッドセット装着で両手が
ふさがる利用形態では、 ボタン操作より gesture + TTS が正だった。
`CaptureScreen.tsx` は旧 CalibrationCaptureScreen の実装を土台に、 **録画停止後の自動
アップロードだけを除去** (= enqueueRecording で state 'recorded' に積むだけ)。
`captureAudio.ts` (TTS 直列キュー) / `gestureDetect.ts` (GestureStabilizer) を git 履歴から復元。

### 2. 手動アップロード (= マイビデオの役割変更)

- 状態機械: `recorded → uploading → uploaded / error` (= 'recorded' を新設)。
- マイビデオ = **アップロード待ち一覧** (recorded / uploading / error のみ表示、 uploaded は消える)。
- カードタップ → プレビューポップ (`ClipPreviewModal`): ローカル mp4 を再生し、
  「うつってはいけないものがないか」 を確認してから「アップロードする」 (= 同意はボタンを押す行為)。
  削除もここから。
- アップロード開始でポップは閉じ、 進捗はカード上に出る。 uploaded で消える。
- 永続化: uploaded は AsyncStorage に保存しない (= 再起動で蘇らない)。
- C2PA D1 署名はアップロードボタン押下後の advanceClip 内 (= 撮り捨てるクリップに署名コストを払わない)。

### 3. 全画面 landscape

常に landscape 動画を撮るアプリなので、 UI 全体を横持ちベースに統一。
- RootNavigator: screenOptions orientation 'landscape' (撮影画面のみ 'landscape_right' 固定
  = native カメラ frame と一致)。
- フッタータブ (Home / Camera / Settings) は維持。
- マイビデオは 2 カラムグリッド + 低いバナー。 プレビューポップは左動画・右アクションの横割り。
- 撮影画面退場時の portrait 先回り処理は不要になり削除。

### 4. バケット分離 (= arkit raw)

| 構成 | バケット | ファイル |
|---|---|---|
| ultra_wide | `rootlens-raw` (R2_BUCKET_RAW) | rgb.mp4 / realtime_handpose.jsonl / metadata.json |
| arkit | `rootlens-raw-arkit` (R2_BUCKET_RAW_ARKIT) | + imu.jsonl / depth.tar (LiDAR 機のみ) |

- key prefix はどちらも `raw/<signature_hash>/` で対称。
- `POST /api/v1/raw-uploads` の body に `recordingConfig` を追加 (省略時 ultra_wide = 旧互換)。
  サーバがバケット + ファイルマニフェスト (`RAW_SESSION_MANIFEST`) を決める。
- R2 API トークンは 3 バケット (rootlens-public / rootlens-raw / rootlens-raw-arkit) に
  スコープ済み (= 2026-07-04 ユーザーが更新、 HeadBucket で 3 つとも OK を実測確認)。
- 将来 arkit の point cloud / 再構成 mesh 等の raw が増えたら、 native 出力 + config.outputFiles +
  RAW_SESSION_MANIFEST の 3 か所に同名で追加する (= fail-loud contract)。

### 5. POST /api/clips は「uploaded の登録」

端末は R2 アップロード完了後にのみ登録するので、 insert は `state='uploaded'`。
presign を返す機能は削除 (= presign は /api/v1/raw-uploads の役目)。

### 6. C2PA D1 署名は残す (= 2026-07-04 再確認)

「C2PA のせいで録画が終了できない / クラッシュする」 リスクを検討した結果、 **残す** と確定。

- 録画停止時に C2PA コードには一切触れない (= stopRecording + enqueueRecording のみ)。
  署名が走るのは「アップロードする」 押下後で、 その時点で raw mp4 は Documents 配下に確定済み。
  署名中に Rust が panic してアプリごと落ちても録画データは失われず、 再起動 → 再試行できる
  (= v0.1.3 の「停止直後に自動で署名+blur+D2」 が不安の源で、 それは手動アップロード化で解消済み)。
- 残コスト: 長尺クリップの署名時間 (= ファイル全体 hash + 書き換え) + 一時ディスク 2 倍、
  EAS ビルドの Rust 複雑性。 いずれも許容。
- プロダクト理由: 撮影来歴は後から遡って付けられない。 収集期間中のデータに来歴を残すことが本体価値。
- したがって native/c2pa-bridge / certs/ は現役継続。 crates/ (license-cli) + programs/ (Anchor) は
  v0.1.4 では未使用だが v0.1.5 の mint 再配線で使うためリポに残置 (= アプリビルドには入らない)。

## 読むべきファイル

- `app/src/screens/CaptureScreen.tsx` (ジェスチャー撮影、 旧 CalibrationCaptureScreen 復元 + 保存のみ)
- `app/src/screens/CollectionScreen.tsx` + `app/src/components/ClipPreviewModal.tsx` + `ClipCard.tsx`
- `app/src/dataflow/pipeline.ts` (enqueueRecording = recorded、 advanceClip = 手動起動)
- `web/lib/r2.ts` + `web/lib/r2-keys.ts` (RAW_SESSION_MANIFEST + rawBucketFor)
- `web/app/api/v1/raw-uploads/route.ts` (recordingConfig 受け)

## 成功基準

- 実機: キャリブレーション → 撮影 → 停止 → マイビデオに「アップロード待ち」カードが出る →
  プレビュー再生 → アップロードする → 進捗 → カードが消える。
- ultra_wide のファイルが rootlens-raw に、 arkit のファイルが rootlens-raw-arkit に並ぶ。
- 全画面が landscape で操作可能 (タブ / 設定 / オンボーディング含む)。
- 再起動後も recorded クリップが一覧に残る (= durable)。 uploaded は蘇らない。

## 進捗

- [x] dataflow: state 'recorded' 新設、 enqueueRecording から自動 advanceClip を除去
- [x] upload step: presign body に recordingConfig
- [x] web: RAW_SESSION_MANIFEST + rawBucketFor + raw-uploads/route + POST /api/clips (uploaded insert)
- [x] CaptureScreen: ジェスチャー版復元 (+ スイッチャ有効化、 自動アップロード除去)
- [x] captureAudio / gestureDetect 復元、 i18n capture.tts/state/guide 復元
- [x] CollectionScreen: 2 カラム待ち一覧 + ClipPreviewModal (プレビュー → 同意 → アップロード)
- [x] RootNavigator: 全画面 landscape
- [x] web/.env に R2_BUCKET_RAW_ARKIT (トークンスコープ実測 OK)
- [x] tsc (app/web) + dataflow purity green
- [ ] 実機 E2E (ultra_wide → rootlens-raw / arkit → rootlens-raw-arkit)
- [ ] Vercel env に R2_BUCKET_RAW_ARKIT 追加 (= コード default と同値なので任意、 明示推奨)
