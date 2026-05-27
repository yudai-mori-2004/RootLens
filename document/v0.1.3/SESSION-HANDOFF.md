# RootLens v0.1.3 セッションハンドオフ (2026-05-27)

このドキュメントは Claude のコンテキスト圧縮を生き残らせるための temp メモ。
通常 compact では落ちる「なぜそうしたか」 と 「現場で踏んだ罠」 を集約する。
新しい session で実装続行するときは **まずここを読む**。

## 1. 現在地

v0.1.3 task tree (= `document/v0.1.3/tasks/README.md`) の進捗:

| task | 状態 | 中身 |
|---|---|---|
| 01-10 | ✅ 完了 | データパイプライン (mock-device → Pipeline 2 → Pipeline 3) 全部通る。 949MB 実動画 + iPhone 実機 で end-to-end 確認済 |
| 11 app-shell | ✅ | auth 抽象 (= `services/auth/` + DebugAuthProvider) + 3 タブ (Home/Camera/Settings) |
| 12 capture-pipeline | ✅ (= 動く) | iOS native Pipeline 1: C2PA D1+D2 + 顔ぼかし + content_id + R2 + TP + cNFT + /api/clips |
| 13 voice-agent | 🔄 ブレイン完成、 音声 IO 未着手 | Claude Haiku 4.5 + TTS は実装済。 sherpa-onnx wake word + STT が残作業 |
| 14 camera-mode | ✅ | 単一 CaptureModeScreen で対話 ↔ カメラサブモード切替 (UI_SPECS §2.2) |
| 15 home-tab | ✅ | CollectionScreen + ClipCard + ClipDetailSheet + StakeSheet。 4 層スコア breakdown 表示 |
| 16 onboarding-settings | ✅ | OnboardingScreen (welcome + ToS) + Settings 再構成 (UI_SPECS §7) |

「次のタスク」 = **task 13 の voice IO (= sherpa-onnx)** だけ。
あとは細かい polish のみ。

## 2. 非自明な設計判断 (= なぜそうしたか)

これらの判断は後から見ると「もっと素直な方法」 が思い浮かぶが、 罠を踏んだ結果の選択。

### 2.1 auth は抽象化 + DebugAuthProvider 固定 (Privy 後回し)

`services/auth/`:
- `AuthProvider` interface = pubkey + signTransaction + signMessage + login/logout
- `DebugAuthProvider` = SecureStore に keypair 永続、 起動時に自動生成 or 復元
- React: `useAuth()`、 非 React: `getAuthProvider()` / `requireCurrentSession()`

理由: Privy SDK は癖が強くて本質的じゃないので後回し。 ただし interface だけ切っておけば後で差し替え自由。 `EXPO_PUBLIC_DEBUG_WALLET_BASE58` env で固定 wallet を強制も可 (= 共有テスト用)。

### 2.2 撮影画面は CaptureModeScreen 1 つに統合

旧設計: CameraEntry → TaskBriefing → Capture の 3 画面チェーン。
新設計: `CaptureModeScreen` が `taskId` を内部 state で持ち、 null = 対話、 非 null = カメラサブモード。 ARKit セッションは画面 lifetime 全体で持続 (= UI_SPECS §2.2「視覚的断絶なし」)。
撮影完了 → `setTaskId(null)` で対話に戻る = ループ可能。

### 2.3 対話 UI = "Ephemeral Correspondence" (= SNS チャット禁止)

実装: `DialogueOverlay` 内に `AgentCard` (= 8 秒 fade) + `UserEcho` (= 4 秒 fade) を slot 制で表示。 履歴は state に持つけど描画は最新 1 つだけ。 スクロール禁止。

理由: ヘッドマウント装着中は画面を見ていない。 2 つのメッセージ (= 現在のやり取り) だけが意味を持つ。 SNS 風スタックは「履歴を遡ろう」 という誤った発想を生む。 cinema subtitle / 無線交信のメタファー。

### 2.4 fullScreenModal で **nested SafeAreaProvider** が必須

これが一番ハマった罠。

症状: CaptureMode (= `presentation: 'fullScreenModal'`) 内で `useSafeAreaInsets()` が landscape に回転しても portrait の値 (T:47 L:0 R:0 B:34) を返す。 結果、 close ボタンが Dynamic Island に被る、 入力欄が notch 側に伸びる。

原因: react-native-screens は fullScreenModal を別 UIViewController で presents。 root の `<SafeAreaProvider>` の UIView は root VC 配下にあり、 modal VC に覆われると UIKit が layoutSubviews を呼ばなくなる → insets が stuck。

修正: CaptureModeScreen 本体を `<SafeAreaProvider>` で wrap (= modal VC 配下に provider の UIView を置く)。 Expo / React Navigation の公式ドキュメント推奨パターン。 マジック数フォールバック不要。

参照: safe-area-context #556 / #677、 react-navigation #11664。

### 2.5 chrome は SafeAreaView を使わず `useSafeAreaInsets()` + 明示加算

理由: Yoga (= React Native の layout engine) は `position: absolute` 子を親の padding で内側に押さない (facebook/yoga#1436、 RN では feature flag off で永遠に発動)。 `<SafeAreaView edges=all>` で chrome を包んでも中の absolute 要素は無視される。

正解: 各 chrome 要素で `top: Math.max(insets.top, STATUS_BAR_H=20) + 12` 等を直接書く。 STATUS_BAR_H は iOS landscape で status bar が safe area の外 (= 20pt strip) に居るための floor。

### 2.6 4 層スコア schema (= v0.1.3)

サーバ `shared/api-types.ts`:
```
QualityBreakdown = { total, layer1, layer2, layer3, gtsam } (各 nullable)
Layer1 = メタデータ解析 0-20 点
Layer2 = フレームサンプリング 0-15 点
Layer3 = VLM Claude Haiku 4.5 セマンティック 0-55 点
GtsamScore = Video-IMU 整合性 0-10 点
ProcessingStep = "metadata-scan" | "frame-sampling" | "vlm-score" | "gtsam-eval"
```

クライアントは初期 v0.1.2 schema (= anyHandRatio 等) を持っていて、 GTSAM 完了で 0/3 に固まる罠を踏んだ。 4 層に揃えて修正済。

### 2.7 Pipeline 1 の各種罠

- **sensors.jsonl / imu_high_rate.jsonl schema**: arkit-capture native は元々 `ts/angular_velocity/linear_acceleration` を書いていた。 サーバ (= GTSAM Modal) は `timestamp_ns/accel/gyro` を期待。 iOS native 側を gen-dummy-sensors.py と同じ schema に揃えた。
- **GTSAM 500 エラー**: `_zero_score()` が `float("inf")` を返して FastAPI strict JSON encoder が死ぬ。 1e30 sentinel に変更。
- **cNFT metadata URI 長さ**: R2 presigned URL は 450 文字超で Bubblegum の 200 文字制限を超過。 解決: signed-json を `rootlens-public` バケットにも PUT、 公開 URL (約 90 文字) を offchain_data_url に渡す。
- **TP /process フィールド**: `input_type` と `processor_ids` が必須。 mock-device コードを参照して同じ shape を送る。
- **VLM Anything タスク**: dev 用に「Anything (test)」 タスクを追加 (= VLM gate を無条件で通す condition、 開発で毎回タスク選びが面倒な人向け)。
- **NSFileHandle.writeData**: EAGAIN を ObjC 例外で投げてクラッシュ。 iOS 13.4+ の `write(contentsOf:)` (= Swift throwing) に変更。

### 2.8 サーバ endpoints (= v0.1.3 追加)

iOS Pipeline 1 用に追加:
- `POST /api/v1/raw-uploads` { contentId } → 4 ファイル分の presigned PUT
- `POST /api/v1/tp-process` { contentId } → TP gateway 呼ぶ + signed-json を rootlens-public に保存 + 公開 URL 返す
- `POST /api/v1/tp-mint-tx` { offchainDataUrl, payer, merkleTree, collection? } → partial_tx を返す (= デバイスが署名 + broadcast)

`POST /api/clips` は rootAssetId + signedJsonUri 必須 (= Pipeline 2 起動の前提条件)。

### 2.9 captureFlow 状態機械 (= camera サブモード)

7 ステップ (UI_SPECS §5.3): `await_palm` → `palm_holding` (1s) → `vlm_start_checking` → `countdown` (3s) → `recording` → `thumbs_up_holding` (1s) → `finalizing` → `reviewing`。 既存実装は `domain/captureFlow.ts` の reducer。

## 3. 重要な infra 定数

- **MERKLE_TREE** (= devnet cNFT 発行先 public tree): `HdeJYtJrp6x7Az4PEzmqMT5cqNEbm8J4s1zBRnoi6EaP`
- **R2 public URL base**: `https://pub-494b37dbfc9645299042fcf51236d1fc.r2.dev`
- **R2 public bucket**: `rootlens-public`
- **R2 raw bucket**: `rootlens-raw`
- **TP gateway**: `http://13.113.217.17:3000` (= 公式 IP、 ATS で iOS 直接叩けない、 サーバ proxy 経由)
- **deployer wallet** (= 10 SOL 持ち、 dev 共有用、 keys/deployer.json): `8jnPEbjtgvDvM9moKofmS8wv3iy4rC5XDPXxfiSxUf6U`
- **iPhone device ID** (実機): `00008101-0012159E2EF9001E` (= 森雄大's iPhone、 iPhone 12 Pro 26.4.2)
- **rootlens-server**: `https://www.rootlens.io` (Vercel)
- **Solana cluster**: devnet

## 4. ビルド / 起動コマンド

```
# 実機ビルド (= Swift 変更時必須)
cd /Users/forest/WebCreations/root-lens/app
npx expo run:ios --device 00008101-0012159E2EF9001E

# Metro 起動 (= JS のみの変更は hot reload で済む)
cd /Users/forest/WebCreations/root-lens/app
npx expo start --dev-client

# Metro の dev URL (= iPhone から手動入力するとき): http://192.168.40.140:8081
```

## 5. memory rules (= 既知ルール、 再内在化)

- 全角ダッシュ `—` は使わない (= AI 生成シグナル)。 句読点 / コロン / 括弧で代替
- commit messages は英語。 チャット返信 / コード comment / task docs は日本語
- 日本語の中に英単語を散らさない (= 識別子 / ファイル名 / 固有名詞除く)
- 「どっちにしますか?」 を user に聞かない (= 業界事例で裏取りして自分で決める)
- 公開向け文章 (= LP / dataset card) は Gemini レビュー必須
- Vercel / Next.js skill suggestions は React Native コードでは無視 (= path matching の false positive)
- 「再試行上限」 等の嘘エラーメッセージ禁止。 実エラーをそのまま出す
- worktree は使わない (= 「main checkout で作業」)

## 6. 残作業 (= task 13 voice IO)

サブエージェント (Opus 4.6) に渡すプロンプト案:

> sherpa-onnx を iOS Expo dev client に統合して 「ヘイレンズ」 ウェイクワード + 日本語 / 英語 STT を実現する。 既存 ARKit セッション (`modules/arkit-capture`) と AVAudioSession を競合させないこと。
>
> 成果物:
> 1. 実装計画書 (= podspec / xcframework 配布 vs ソースビルド / モデル DL 戦略 / ARKit との audio session 競合回避)
> 2. 新規 native module `modules/voice-input` (= podspec + Swift skeleton + expo module config + JS bridge interface)
> 3. JS 側 wrapper のスケルトン (= `src/native/voiceInput.ts`、 既存 `arkitCapture.ts` と同じ手触り)
> 4. ウェイクワード / STT モデルは Opus 4.6 の判断で選定。 サイズ / ライセンス / 精度のトレードオフを 1-2 行で記録
> 5. Swift がコンパイル通る状態 (= `pod install` + `xcodebuild` 走らせて verify、 実行はしない)
>
> 既存 modules (= `arkit-capture`, `c2pa-bridge`, `privacy-blur`, `hand-pose`) の構造を踏襲。
> 隔離 worktree 不要。 直接 main で作業。

サブが返したスカフォールドを受けて main session で:
1. `CaptureModeScreen` の TextInput 部分を音声 listening state に置き換え
2. wake word イベント → `setIsListening(true)` → STT 結果 → `sendToAgent`
3. ARKit と AVAudioSession を共存させる (= category 設定の正解を実機で詰める)
4. 実機ビルド + 発話テストの反復

## 7. 確認用ハッシュ (= 認証 wallet を切り替えた時の clip 不可視問題対策)

- Pipeline 1 / 2 で作った最新 ready clip: `clip_f360eb264561_mpnak8q7` (= 12.19 撮影、 4 層完走) ※ 古いスキーマで詰まったまま、 表示はされる
- 認証 wallet (= debug 自動生成): `EetbEK2zEy4G5E148BJFcMHVs5MyzWCD6sDypyXBDbLu` (= user の現在 wallet)

新しい撮影は新 wallet で動く。 履歴は wallet に紐づくので Sign out で wallet 切り替えると以前のクリップは見えなくなる (= 仕様通り)。

---

このドキュメントは voice IO 統合完了 (= task 13 完了) 時点で削除。
