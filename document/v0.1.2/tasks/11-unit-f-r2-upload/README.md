# Task 11: Unit F — R2 upload + content_hash dedup

統合フェーズでそのまま使う production-bound ユニット。SPECS §4.3「重複排除」を満たす最小実装。

## 役割

クライアントから (`content_hash`, `kind`, `contentType`) を受け取り、
- **新規**: presigned PUT URL を返す。クライアントが R2 に直接 PUT
- **既存**: 同じ content_hash で過去にアップロード済 → 既存の publicUrl を返し、PUT は発行しない

これだけ。SHA-256 等の再計算はしない。`content_hash` は §3 の TP register で得られる識別子をそのまま使う (TP の signed_json.payload.content_hash)。

## なぜ簡単か

1. R2 の object key を `{kind}/{content_hash}.{ext}` 形式にすれば、object 存在 = content 存在。HEAD 1 回で dedup 判定が完結する
2. SPECS §4.3 は「同一動画の二重アップロード排除」を要求しているだけで、近似重複 (perceptual hash) は MVP 範囲外
3. content_hash が衝突しないことは TP の verify pipeline (vpdq + sha256) が保証する。本ユニットはそれを信頼する

## API

`POST /api/v1/upload-url`

request:
```json
{
  "content_hash": "<32B hex, 0x prefix optional>",
  "kind": "media" | "ogp" | "content",
  "contentType": "video/mp4"
}
```

response (新規):
```json
{
  "status": "new",
  "key": "media/<hash>.mp4",
  "uploadUrl": "<presigned PUT URL, 600s TTL>",
  "publicUrl": "<R2 public URL>"
}
```

response (既存):
```json
{
  "status": "exists",
  "key": "media/<hash>.mp4",
  "publicUrl": "<R2 public URL>"
}
```

エラー (400): 不正な content_hash / 不正な kind / contentType 欠落
エラー (500): R2 不到達 / presign 失敗

## Race condition について

同一 content_hash の 2 並列リクエストは両方 HEAD 404 を見て両方 PUT URL を貰い両方 PUT する可能性がある。R2 (= S3) は last-writer-wins なので最終 state は 1 オブジェクト。bytes は同一なので問題なし。clients は両方とも成功扱い。

より厳密にしたいなら `If-None-Match: *` の conditional PUT を presign に焼き込む手があるが、SDK 互換性が不安定 (presigned URL に conditional headers を入れた時の挙動が provider 依存)。MVP では race tolerance に任せる。

## 信頼境界

- **入力で信頼するもの**: 何も信頼しない。content_hash は形式 (64 hex) のみ検証する
- **content_hash の真正性検証はしない**: クライアントが嘘の content_hash を渡しても R2 にデータが入るだけ。実害はステーキング層 (Unit G) で「Root NFT URI から TP signed_json を取り、その content_hash と R2 key の content_hash が一致するか」を検証する責務
- 本ユニットは「dedup を提供する」だけで「正しい content と一致しているか」は保証しない。これは layered design なので OK

## ハッシュ正規化

入力された content_hash は以下を経て R2 key に使う:
1. `0x` prefix があれば剥がす
2. 全部 lowercase に
3. 正規表現 `^[0-9a-f]{64}$` でマッチしない場合は 400

これにより `0xABcd...` と `abcd...` は同じ key に解決する。

## Audit-grade テスト

vitest (`web/lib/server/__tests__/r2.test.ts` + `web/app/api/v1/upload-url/__tests__/route.test.ts`) で以下をカバー:

### r2.ts ヘルパー単体

- `normalizeContentHash` happy path: lowercase / uppercase / 0x-prefixed (4 variant 全部 same output)
- `normalizeContentHash` reject: length 不正 (63 / 65) / 非 hex (`g` 等) / 空文字 / `0x` だけ
- `keyForContentHash` 各 kind (media / ogp / content) と各 ext (`mp4`, `jpg`, `mov`/quicktime)
- `objectExists` HEAD 200 → true / 404 → false / 403 → throw / network error → throw

### route.ts 統合

- 新規アップロード: HEAD 404 → response.status="new", uploadUrl と publicUrl が含まれる
- 既存: HEAD 200 → response.status="exists", uploadUrl は含まれない
- 不正 content_hash: 400 + error メッセージ
- 不正 kind: 400 (default に倒すなら test を逆向きに)
- contentType 欠落: 400
- HEAD が 403 等で fail: 500
- presign が throw: 500
- 同 content_hash の 2 連続リクエスト: 1 回目 "new"、2 回目 (HEAD 200 になっているので) "exists"
- レース (両方 HEAD 404 のケース): 両方 "new" を返す。回帰テストは race-tolerance を期待動作として明記

## env

既存の R2 関連 env をそのまま使う:
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_PUBLIC_BUCKET`
- `R2_PUBLIC_URL`

新規の env なし。

## 完了条件

- [ ] `web/lib/server/r2.ts` に `normalizeContentHash` / `keyForContentHash` / `objectExists` を追加
- [ ] `web/app/api/v1/upload-url/route.ts` を content_hash dedup 仕様に書き換え
- [ ] `web/lib/server/__tests__/r2.test.ts` で正規化 + key 生成 + HEAD 動作を mock test
- [ ] `web/app/api/v1/upload-url/__tests__/route.test.ts` で route の各分岐を test
- [ ] `pnpm test` (or `npm test`) green
- [ ] §4.3 の「dedup は R2 オブジェクトレベル」が SPECS と整合

## スコープ外

- Private bucket / signed download URL (将来 §9.x で必要になったら別ユニット)
- マルチパートアップロード (現状 1080p 動画は数 MB 想定)
- TTL / lifecycle (R2 bucket 設定で扱う)
- Indexer 連携 (publish/route.ts に既にある)
- `/api/v1/upload-url` の旧 fileId 形式 (caller 居ない、書き換えで OK)
