# RootLens v0.1.4 データパイプライン仕様書

v0.1.4 (task 12 適用後) は **「データ収集の入口 + 手動での FPV Labs 手渡し」** に絞った最小系。
C2PA / Title Protocol / Solana / 自動採点は全て撤去済み。

## 1. 全体像

```
[撮影端末 (app/)]
  録画完了
  → sha256(raw mp4) 計算   ← 端末で完結、 サーバ経由しない
  → content_hash 誕生 (= R2 raw キー / DB PK)
  → R2 rootlens-raw-arkit へ並列 PUT
  → POST /api/clips で登録 (= state='uploaded')

[サーバ (web/)]
  REST API のみ。 自動後段処理なし。

[運用 (tools/modal/fpvlabs/)]
  手動で `modal run tools/modal/fpvlabs/fpvlabs.py --signature-hash <hash>`
  raw を落として EgoBlur (GPU L4) → Stera 互換 MCAP → rootlens-fpvlabs に put

[FPV Labs]
  rclone で rootlens-fpvlabs から MCAP を pull
```

## 2. 識別子

**content_hash** = raw mp4 全バイト列の SHA-256 hex (64 文字、 prefix なし)。

- 端末が録画完了直後に計算する (= `app/src/dataflow/steps/hash.ts`)。 本線はネイティブ計算
  (`modules/content-hash/` = CryptoKit のストリーム SHA-256。 数 GB でも数秒)。 モジュール未搭載
  ビルド用に 8 MB base64 chunk read + noble/hashes の JS フォールバックを残す (= 同一結果)。
- R2 の raw キー: `raw/<content_hash>/rgb.mp4` (+ 他ファイル)。
- DB `clips` の主キー (= 内容アドレスで世界一意。 重複登録は idempotent に既存行を返す)。

旧 v0.1.3 は C2PA D1 署名の SHA-256 を identity にしていたが、 task 12 で C2PA 廃止と同時に
「生 mp4 のバイト列」 に変更 (= 意味が変わる)。 旧 `raw/<signature_hash>/*` の R2 オブジェクトは
orphan として残置し、 新データは新キーで再アップロードする。

## 3. 撮影構成

| 構成 ID | 端末 | 出力ファイル | R2 バケット |
|---|---|---|---|
| `arkit` | iPhone Pro (LiDAR 有) | rgb.mp4 (H.264, 1920x1440, 30 Hz) + frames.jsonl (= 旧名 realtime_handpose.jsonl、 旧クリップに残存) + imu.jsonl (~100 Hz) + metadata.json + depth.tar (depth/ = 256x192 16bit mm、 confidence/ = 同 index の 8bit 3段階) + pointcloud.jsonl + mesh.jsonl | `rootlens-raw-arkit` |
| `ultra_wide` | 非 LiDAR 機 | rgb.mp4 + frames.jsonl + metadata.json | `rootlens-raw` |

現行運用では `arkit` のみを FPV Labs に渡す。

## 4. クライアント状態機械

`app/src/dataflow/types.ts` の `ClipState` + `Pipeline1Stage`:

```
state:  recorded → uploading → uploaded
                             ↘ error   (再試行可能)

stage:  pending  → hashed   → registered
```

- `pending`: 録画完了、 content_hash 未計算。
- `hashed`: content_hash 確定、 store の key を local id → content_hash に貼り替え済み。
- `registered`: R2 PUT + POST /api/clips 成功、 state='uploaded'。

## 5. サーバ REST API

認証は全エンドポイント共通で `Authorization: Bearer <Supabase JWT>` (= task 13)。
サーバは JWT を検証し、 `auth.users.id` (uuid) を account_id として使う。 クライアント申告の
識別子は信用しない。 旧 `X-Account-Pubkey` ヘッダ認証は task 13 で廃止。

### POST /api/clips
body:

```json
{
  "contentHash": "<64 hex>",
  "contentSize": 12345,
  "recordingConfig": "arkit",
  "durationMs": 330200,
  "deviceModel": "iPhone16,1",
  "consentEventId": "evt_..."
}
```

`content_hash` が主キー。 既存行があれば idempotent に既存 ClipDto を返す。

### POST /api/v1/raw-uploads
body:

```json
{ "contentHash": "<64 hex>", "recordingConfig": "arkit" }
```

構成に応じた presigned PUT URL のマップ (`files: Record<filename, {url, key, contentType}>`) を返す。

### GET /api/clips, GET /api/clips/:id, GET /api/clips/:id/media
撮影アカウント所有のクリップの一覧 / 詳細 / rgb.mp4 の presigned GET URL。

### POST /api/v1/consents
同意証跡を `consent_events` テーブルに append-only で記録する。 詳細は
`document/v0.1.3/legal/consent-log-spec/ja.md` (= task 13 で subject 識別子を
pubkey から account_id (uuid) に置換)。

## 6. DB スキーマ (`web/db/schema.ts`, `web/drizzle/`)

public スキーマは `clips` と `consent_events` の 2 テーブルのみ。 アカウントは Supabase Auth
(`auth.users`) が持ち、 現場名・契約・振込先などの意味論は DB に置かず運営の台帳で
uuid ↔ 実世界を対応させる (= 詳細は `tasks/13-supabase-auth-accounts/`)。

### `clips`
```
content_hash      text  PK            -- sha256(raw mp4)。 R2 raw キーと 1:1
account_id        uuid  NOT NULL      -- auth.users.id (= 検証済み JWT の sub)
consent_event_id  text                -- consent_events.id (= クリップ ⇔ 同意証跡の結合)
created_at        timestamptz         (行作成 ≒ アップロード完了時刻)
recording_config  text  NOT NULL      -- 'ultra_wide' | 'arkit'
duration_ms       integer
content_size      bigint              -- raw mp4 bytes
device_model      text

INDEX (account_id)
```

### `consent_events`
`document/v0.1.3/legal/consent-log-spec/ja.md` 参照。 v0.1.4 (task 13) での差分は
subject 識別子の pubkey → account_id (uuid) 置換のみ。

## 7. FPV 手渡しパイプライン

`tools/modal/fpvlabs/fpvlabs.py`。 手動運用、 自動起動なし。 詳細は
`document/v0.1.4/fpvlabs-handoff/RUNBOOK.md`。

- 入力: `rootlens-raw-arkit/raw/<content_hash>/*`
- 出力: `rootlens-fpvlabs/<content_hash>/session.mcap` (Stera 互換 ROS2 MCAP)
- 顔ぼかし: Meta EgoBlur gen2 (GPU L4、 threshold 0.8、 resize 480、 batch 16)
- `--target-bucket <name>` オプションで本番以外に書き出し可 (= 検証はこれを使う)

## 8. 撤去したもの (v0.1.3 との差分、 task 12 適用後)

- **C2PA 署名インフラ全部**: `native/c2pa-bridge/`, `app/modules/c2pa-bridge/`,
  `app/src/dataflow/steps/sign.ts`, `web/app/api/v1/c2pa-sign/`, `web/lib/c2pa-certs.ts`
- **Title Protocol 統合**: `web/lib/verify/`, verify 用 LP ページ, `@title-protocol/sdk` 依存
- **Solana / cNFT / License NFT**: `programs/`, `crates/`, `tests/`, `Anchor.toml`, `network.json`,
  `@solana/web3.js` 依存, `rootAssetId` / `signedJsonUri` / `wallet_pubkey` / `network` 列
- **オンデバイス顔ぼかし**: `app/modules/privacy-blur/`, `app/src/units/privacy-blur/`
- **旧モックデバイス + E2E smoke**: `tools/mock-device/`, `tools/smoke-test.sh`, `tools/gen-dummy-sensors.py`,
  `tools/macos-blur/`
- **自動採点 Pipeline 2/3**: 削除ではなく `tools/modal/score-wilor/` に移動 (legacy として保持)、
  ただし deploy はしていない。
- **サーバ WDK workflow**: `web/app/.well-known/workflow/`, `next.config.ts` の `withWorkflow`
- **LP sample 生成器**: `tools/lp-sample/` (呼び出す Modal 関数と C2PA 依存が全消失、 実行不能)。
  出力データ (`web/public/lp/sample/dataset/`) は静的に残置。
