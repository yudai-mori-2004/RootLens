# 09. C2PA リモート署名 (= Adobe 方式のクラウド署名)

## 目的

C2PA D1 署名の鍵をアプリバイナリ (= 焼き込みテスト証明書、 抽出可能) からサーバに移す。
ハッシュ計算 + manifest 組み立ては端末ローカルのまま、 **COSE 署名バイト列 (数 KB) だけ**を
RootLens サーバの組織鍵で署名する。 Photoshop の Content Credentials が Adobe の組織証明書で
クラウド署名するのと同じ構図。 per-device PKI (= task 08 で削除した配管) は使わない。

## 設計 (= 2026-07-04 実装済み)

### 署名フロー

```
端末 (Rust c2pa-bridge)                          サーバ (web)
  動画全体のハッシュ計算 (BMFF)
  manifest 組み立て                    GET /api/v1/c2pa-sign
  x5chain 用の証明書チェーン取得  ←──   { alg: "ed25519", certsPem }
  COSE to-be-signed 生成 (数 KB)       POST /api/v1/c2pa-sign
  署名対象を送信              ──→      { dataB64 } + X-Account-Pubkey
                              ←──      { signatureB64 }   (= Ed25519 raw 64B、
  署名を manifest に埋めて mp4 出力                          鍵は C2PA_SIGN_KEY_B64 env のみ)
```

- 動画はこの endpoint を通らない (= GB 級の PUT は従来どおり R2 presigned)。
- 署名は「アップロードする」 押下後に走るのでオンライン前提で良い (= 直後に R2 PUT する)。
- 端末には秘密鍵が一切存在しない。 焼き込み方式の「IPA から鍵を抜けば偽造できる」 弱点を解消。

### 証明書

- RootLens 自己署名チェーン (Ed25519): `RootLens C2PA Root` (CA) → `RootLens C2PA Signer` (EE)。
  profile は旧 fixtures と同一 (EE: KU=digitalSignature,nonRepudiation critical +
  EKU=emailProtection / CA:FALSE) で c2pa-rs の署名時証明書検査を通る。
- 公開チェーンは `web/lib/c2pa-certs.ts` にコード埋め込み (= 公開情報)。 秘密鍵は
  `C2PA_SIGN_KEY_B64` env のみ (web/.env.local + Vercel env)。 CA 鍵は単発利用で破棄済み
  (= ローテーション時はチェーンごと再生成。 過去の署名は manifest 内の証明書で検証されるので影響なし)。
- 検証結果は「integrity 全通過 + signingCredential.untrusted」 (= 従来の焼き込みテスト証明書と
  同じ水準)。 公的 CA 証明書へ格上げする時は env とこのファイルを差し替えるだけ (= アプリ再配布不要)。

### 実装ポイント

- Rust: `pipeline1_sign_d1_remote(input, output, sign_service_url, account_pubkey)` を新設。
  c2pa::CallbackSigner + ureq (json feature)。 旧 `pipeline1_sign_d1` (fixtures ローカル署名) は
  オフラインテスト / mock 用に残置。 crate-type に rlib を追加 (= examples/tests 用)。
  ⚠ iOS static lib は `cargo rustc --release --target aarch64-apple-ios --crate-type staticlib`
  でビルドすること (= cargo build だと rlib 混在で LTO が無効化され .a が 148MB に膨れる。
  staticlib 単体指定で 18MB)。
- Swift: `signD1(inputMp4, outputMp4, signServiceUrl, accountPubkey)` (4 引数に変更)。
- JS: dataflow/steps/sign.ts が `${SERVER_URL}/api/v1/c2pa-sign` + アカウント公開鍵を渡す。
- web: `app/api/v1/c2pa-sign/route.ts` (GET=証明書 / POST=署名)。 サイズ上限 256KB
  (= 動画を送りつけても署名しない)。 認可は X-Account-Pubkey (= 他 API と同じ MVP 水準)。

### セキュリティの現在地と宿題

- この endpoint は「任意バイト列に RootLens 署名を返す signing oracle」 (= account header だけで
  呼べる)。 単一ユーザー収集フェーズでは許容。 買い手に来歴を売る段階までに:
  1. App Attest 検証を「署名する条件」 に追加 (= genuine アプリからのみ署名。 per-device PKI 不要)
  2. rate limit + 監査ログ (アカウント別署名履歴)
  3. 鍵を env から KMS へ

## 検証 (= 実測)

- ホスト macOS から `cargo run --example remote_sign_smoke` で実 mp4 を署名 →
  `claimSignature.validated` + `assertion.bmffHash.match` + signer=`RootLens C2PA Signer`、
  失敗は `signingCredential.untrusted` のみ (= 期待どおり)。 validation_state: Valid。
- signature_hash 抽出も同経路で確認。

## 進捗

- [x] 証明書チェーン生成 + web/lib/c2pa-certs.ts + C2PA_SIGN_KEY_B64 (.env.local)
- [x] web endpoint (GET/POST) + tsc green
- [x] Rust pipeline1_sign_d1_remote + example E2E (ローカル dev サーバ相手に実署名成功)
- [x] iOS static lib 再ビルド (device + sim、 staticlib 単体で LTO 維持)
- [x] Swift signD1 4 引数化 + header 更新
- [x] JS bridge + sign step 更新、 app tsc + purity green
- [ ] **Vercel env に C2PA_SIGN_KEY_B64 を追加** (= web/.env.local の値をダッシュボードで登録 → Redeploy)
- [ ] 実機 E2E (= Xcode rebuild が必要: .a 差し替え + Swift 変更)
