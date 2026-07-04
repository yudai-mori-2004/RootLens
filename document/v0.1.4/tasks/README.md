# RootLens v0.1.4 タスク一覧

「アプリ = カメラ + センサー + C2PA D1 署名 + raw アップロードの入口」に絞る簡素化。
詳細は `document/v0.1.4/DATA_SPECS_JA.md`。

後段（blur / scoring / labeling / mint / staking）は v0.1.5 以降で**サーバ独立ワーカーとして別配線**するため、
v0.1.4 ではアプリと結合しているコードを削るだけで、 機能の代替は作らない。

## 全体マップ

```
v0.1.4 (簡素化スプリント)
  01. db-schema-simplify        🔄  0001_v0_1_4_simplify.sql 適用 + schema.ts を v0.1.4 列に
  02. web-api-simplify          🔄  POST /api/clips から rootAssetId/signedJsonUri 撤去。
                                    finalize / stake / retry / tp-process / tp-mint-tx エンドポイント削除。
                                    raw-uploads は維持 (= signed-json/ を返さない形に)
  03. app-dataflow-simplify     🔄  dataflow から steps/titleProtocol, steps/pipeline2, steps/pipeline3 削除。
                                    steps/sign.ts は D1 1 回のみ (blur + D2 撤去)。 register は network のみ。
                                    orchestrator は uploading → uploaded の最小 state machine
  04. app-capture-ui-simplify   🔄  CalibrationCaptureScreen を「録画→停止→自動アップロード」最小フローに。
                                    キャリブ ceremony / TTS / palm-gesture 撤去 (= 後述 inventory に従う)。
                                    CollectionScreen は quality / mint / staking 表示撤去。
                                    DevSandbox から Pipeline 2/3 ボタン撤去
  05. workflow-modal-cleanup    🔄  web/workflow/process-clip.ts 削除 (= 自動トリガー無し)。
                                    tools/modal/{layer1, layer2, layer3, wilor}.py はリポに残すが Modal
                                    deployment は teardown (v0.1.5 で再配線時に作り直す)
  06. e2e-smoke                 🔄  端末 録画 → 署名 → R2 raw アップロード → POST /api/clips → state='uploaded'
                                    の 1 クリップ実機通過確認
  07. manual-upload-landscape   🔄 新 ジェスチャーキャリブ復活 + 手動アップロード (マイビデオ = 待ち一覧
                                    + プレビューポップで同意 → アップロード) + 全画面 landscape
                                    + arkit 専用バケット (rootlens-raw-arkit) 分離
  08. deblockchain-cleanup      🔄 新 wallet/Solana/mint/staking/license 残骸の全撤去。 識別子は
                                    「アカウント公開鍵」 (X-Account-Pubkey)、 network 撤去、
                                    Buyer/Privy/web3.js 削除、 文言の現実合わせ (onb slide2 = blur 撤回)
  09. remote-signing            🔄 新 C2PA リモート署名 (= Adobe 方式)。 ハッシュはローカル、 COSE 署名
                                    だけサーバ組織鍵 (/api/v1/c2pa-sign)。 鍵がバイナリから消える
  10. landscape-editorial       🔄 新 右レール縦ナビ + 誌面見開きレイアウト + 写真ファーストカード。
                                    実機スクショの自己反復でデザイン検証
  11. upload-consent            🔄 新 アップロード同意の 2 段化 (層1要約 + 3チェック + 全文導線 →
                                    consent_events に証跡記録 → 動画確認 + アップロード)
```

凡例: ✅ = 完了、 🔄 = 進行中 / 未着手、 新 = 新規追加。

⚠ 07 は 04 の「ジェスチャー撤去 + 自動アップロード」を部分的に巻き戻す (= 実機 UX 検討の結果、
ジェスチャー式が正と確定)。 現行フローの正は 07 の README を参照。

## 順序

01 (DB) → 02 (web API) → 03 (app dataflow) → 04 (app UI) → 05 (workflow/modal cleanup) → 07 (全貌確定) → 06 (E2E)。

DB → web → app → cleanup → 検証 の素直な依存順。 02 と 03 は contract が一致していれば並行可。

## 仕様書

| 文書 | 役割 |
|---|---|
| `DATA_SPECS_JA.md` | データパイプライン仕様 (v0.1.4) |

## v0.1.3 からの差分要約

- 端末 blur (Apple Vision) 撤去 — iOS 専用で発熱+処理時間が許容外。 サーバ側でもこのバージョンでは行わない
- C2PA は D1 のみ (生 mp4 への 1 回署名)。 D2 / blur assertion / parentOf ingredient 撤去
- Title Protocol `/process` + cNFT mint をパイプラインから完全分離
- `rootAssetId` / `signedJsonUri` の必須要件削除
- 段レジューム + identity 再 key (Pipeline1Stage / advanceClip 等) も撤去 (= mint 起因の複雑性が全部消える)
- Pipeline 2 (採点 + ラベリング) と Pipeline 3 (WiLoR) はアプリ + web workflow から切り離し
- `raw/<hash>/` バケットは**本当の raw**（blur 無し）に。 命名と中身が一致
- 撮影構成ごとにバケット分離: ultra_wide → rootlens-raw、 arkit → rootlens-raw-arkit (07 で追加)
- clip state machine (app): `recorded → uploading → uploaded / error` (= 手動アップロード、 07 で確定)
- アップロードは自動ではなくユーザーがプレビュー確認 + 同意して起動 (07)
- UI 全体を横持ち (landscape) ベースに (07)
- DB 列は 10+ 削除（詳細は `0001_v0_1_4_simplify.sql`）
