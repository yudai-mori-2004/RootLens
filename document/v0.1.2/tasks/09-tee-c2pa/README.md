# Task 09 / Unit A: TEE + C2PA 撮影署名

## 位置付け

**統合ユニット (production-bound)。** 撮影された動画 / 画像に C2PA 署名を付与する Expo Module。秘密鍵は端末の TEE (iOS Secure Enclave / Android StrongBox) 内で生成・管理され、TEE の外に出ない。

**iOS 側は v0.1.1 で先行実装済**。本 task は (a) 既存 iOS 実装を整理して unit としての完成証跡を立てる、(b) Android 実装を後続タスクで起こすための起点を明示する、の 2 点。

## 進捗サマリ (2026-05-09 時点)

- ✅ iOS 実装完了 (`app/modules/c2pa-bridge/ios/`、production-grade)
  - Secure Enclave で EC P-256 鍵生成 + 永続化 (`kSecAttrTokenIDSecureEnclave`)
  - DCAppAttestService で App Attestation
  - PKCS#10 CSR DER 構築
  - Device cert / Intermediate CA / Root CA chain 保存 + SecTrust で chain validation
  - `c2pa_sign_image_tee` callback 経路で TEE 鍵から署名 (PEM 渡しは `#if DEBUG` のみ)
  - RFC 3161 TSA timestamp (DigiCert)
  - C2PA assertion 動的注入 (label/data 配列を JSON で受け取り)
  - 動画前処理 (crop / resize / trim) `processVideo` AsyncFunction
  - PKI ローテーション検出 (`verifyStoredCertChain`)
- ✅ Web 側 CA backend 実装済 (`web/lib/server/ca.ts` ほか、3 層 PKI + KMS + attestation 検証 + 90 日 cert + renew + CRL + rate-limit + DB ログ)
- ✅ Mobile 設定 (`app/src/config.ts` に `deviceCertificateUrl` / `deviceCertificateRenewUrl` / `certRenewalThresholdDays`) 済
- ✅ Mobile JS の provisioning / renewal orchestrator (`app/src/hooks/useCertificateProvisioning.ts` を legacy から移植 + `App.tsx` の `CertGate` に組み込み)
- ✅ Web 側 audit-grade テスト 7 ファイル / 83 ケース全 pass (`web/lib/server/__tests__/`、初回発行 + 更新の route handler 全体 + 個別 unit を含む)
- ⏳ **Android 実装は未着手** (`app/modules/c2pa-bridge/android/` は意図的に空、`README.md` 参照)

## 仕様参照

- SPECS_JA §2.7 — 撮影時の C2PA 署名 (TEE 鍵の存在要件)
- SPECS_JA §4.4 — 端末側の TEE 鍵管理 (App Attest / CSR / cert chain)
- SPECS_JA §4.5 — 短期証明書ローテーション + RFC 3161 TSA
- SPECS_JA §4.6 — c2pa-rs FFI 統合

## スコープ

このユニットで扱うもの:

- `app/modules/c2pa-bridge/ios/` — Expo Module (iOS 実装本体)
- `app/modules/c2pa-bridge/android/` — Android プレースホルダ (空、README で起点を示す)
- `native/c2pa-bridge/` — Rust c2pa-rs FFI ラッパー (両 OS 用 shared)
- iOS unit verification: 撮影 → C2PA 署名 → TP register まで通る e2e (sandbox 04 で確認)

このユニットで**作らない**もの:

- Android Kotlin module + StrongBox / Play Integrity / Cert chain (次タスクで対応)
- CA 発行サーバ (RootLens-CA backend) — §2.7 が別仕様書送り、別 unit
- Device 初回プロビジョニング UX (オンボーディング) — フロント統合フェーズ
- C2PA manifest viewer / 検証 UI (downstream consumer の役割)

## ファイル配置 (現状)

```
root-lens/
├── app/modules/c2pa-bridge/
│   ├── expo-module.config.json     # platforms = ["ios"] のみ (Android 意図的に外す)
│   ├── ios/
│   │   ├── C2paBridgeModule.swift  # 1016 行、TEE + App Attest + CSR + chain + sign
│   │   ├── c2pa_bridge.h           # Rust FFI 公開 header
│   │   ├── c2pa_bridge.podspec
│   │   ├── module.modulemap
│   │   └── lib/
│   │       ├── libc2pa_rs.a         # universal (sim + device)
│   │       ├── libc2pa_rs_device.a
│   │       └── libc2pa_rs_sim.a
│   └── android/
│       └── README.md               # 意図的に空であること、後続タスクの起点を明記
└── native/c2pa-bridge/
    ├── Cargo.toml
    ├── c2pa_bridge.h
    └── src/lib.rs                  # c2pa-rs を C ABI で wrap (TEE callback IF を含む)
```

## TS インターフェース (iOS で公開済)

| Function | 用途 |
|---|---|
| `signContent(imagePath, assertions?)` | C2PA 署名。TEE cert があれば TEE 経路、無ければ DEBUG ビルド限定で legacy PEM |
| `readManifest(imagePath)` | 既存ファイルの manifest を JSON で返却 |
| `applyMasks(imagePath, masks)` | 顔ぼかし等のマスク適用 (privacy 処理の前段) |
| `processVideo(videoPath, optionsJson)` | crop / resize / trim を AVFoundation で実行 |
| `getVersion()` | c2pa-bridge バージョン文字列 |
| `generateDeviceCredentials()` | Secure Enclave 鍵生成 + CSR + App Attest 取得 |
| `storeDeviceCertificate(deviceB64, intermediateB64, rootB64)` | CA から受領した cert chain を保存 |
| `hasDeviceCertificate()` | cert provisioning 済か |
| `getDeviceCertificateExpiry()` | notAfter (ISO 8601) |
| `verifyStoredCertChain()` | Device cert が intermediate CA で署名されているか (PKI rotation 検知) |
| `clearStoredCertificates()` | re-provisioning 前のクリア |

## iOS unit 完了条件

- [x] Secure Enclave で TEE keygen → 永続化 (鍵が端末リセット直前まで残る)
- [x] App Attest で device 真正性証明 (clientDataHash = SHA-256(CSR))
- [x] CSR を CA backend に送って device cert を受領できる形式 (PKCS#10 DER)
- [x] Web CA backend 側で App Attest / CSR PoP / EC P-256 algorithm 強制を検証 (`web/app/api/v1/device-certificate/route.ts`)
- [x] Device cert + intermediate + root の 3 段 chain を保存し、起動時 / フォアグラウンド復帰時に `verifyStoredCertChain` で検証 (`useCertificateProvisioning` 内、ICA ローテも検出)
- [x] `signContent` が TEE 経路で動作 (秘密鍵は外部に出ない)
- [x] PEM 経路は `#if DEBUG` でしか走らない (`signWithLegacy`)
- [x] RFC 3161 TSA timestamp が manifest に焼き込まれる
- [x] sandbox 04 で撮影 → 署名 → TP register まで実機で通る (v0.1.1 開発時に実機で確認済。本 task の orchestrator 移植後に再実機 verify 推奨)
- [x] CA backend に renew endpoint がある (`/api/v1/device-certificate/renew`、同一 TEE 鍵で新 cert)
- [x] ICA 秘密鍵は AWS KMS に隔離 (`web/lib/server/crypto-kms.ts`、`KMS_IOS_ICA_KEY_ID` 設定で有効化)
- [x] **Mobile JS 側 provisioning / renewal orchestrator** (`useCertificateProvisioning` hook、`App.tsx` の `CertGate` で起動時ブロック、`AppState=active` で再チェック、ICA ローテ検出時の自動再プロビジョニング、残 14 日以内の background renew)
- [x] Web 側 audit-grade テスト (vitest 7 ファイル / 83 ケース全 pass。初回発行・更新双方の route handler + 発行 cert の extension 全数検査 + 別シリアル / 3 段 chain 検証 + 更新独自の rate-limit / 既存 cert 存在チェック を含む)

## 監査 grade テスト (Web 側 unit / route)

`web/lib/server/__tests__/` で `npx vitest run` 実行 → 7 ファイル / 83 ケース全 pass (2026-05-09)。

| ファイル | 件数 | カバー範囲 |
|---|---|---|
| `ca.test.ts` | 18 | `verifyCSR` (PoP / 決定性 / EC P-384 拒否 / 異常 base64), `issueDeviceCertificate` (発行 / chain 検証 / 90 日 / BasicConstraints / EKU documentSigning / シリアル一意 / 3 段 chain), `loadPem` |
| `route-device-certificate.test.ts` | 24 | route handler 全体。初回発行 (16): 正規 iOS 200 / DB 失敗が non-fatal / 各種 400 (platform 欠落・invalid・csr 欠落・base64 不正・EC P-384・production で attestation 欠落) / 攻撃時の 403 / malformed JSON / 429 with Retry-After / DEV_MODE bypass / Android 経路の動作確認 / 発行 cert の extension 全数検査 (KeyUsage / EKU / BasicConstraints / SKI / AKI / 90 日) / リプレイで毎回別シリアル / Device→ICA→Root 検証。更新 (8): 既存 cert 有り 200 + 別シリアル / 既存 cert 無し 400 (初回への誘導) / DB エラー時は dev 想定でスキップ / production で attestation 欠落 → renew 用文言 / DEV_MODE bypass / 上限 5/hour / 初回 (上限 10) と独立カウンタ |
| `attestation-ios.test.ts` | 11 | App Attest object パース + Apple Root CA 検証 + counter / nonce 検証 |
| `attestation-android.test.ts` | 10 | Key Attestation chain + Play Integrity token + StrongBox SecurityLevel |
| `crl.test.ts` | 5 | CRL 生成 / 失効 cert の serial 含有 / 署名検証 |
| `crypto.test.ts` | 10 | LocalEcSigner / アルゴリズム判定 / 公開鍵 PEM round-trip |
| `rate-limit.test.ts` | 5 | sliding window / 上限超過 / window 経過後リセット |

実行: `cd web && npm test` で全 file 自動実行。

## Android 後続タスク用 checklist (本 task のスコープ外)

- [ ] `app/modules/c2pa-bridge/android/` に Expo Module 新規作成 (`io.rootlens.c2pa.C2paBridgeModule`)
- [ ] `KeyGenParameterSpec` + `setIsStrongBoxBacked(true)` で EC P-256 鍵生成
- [ ] Play Integrity API で attestation (Standard request、nonce = SHA-256(CSR))
- [ ] PKCS#10 CSR DER builder (BouncyCastle 採用 or 手書き)
- [ ] Cert chain 保存 (Keystore alias または SharedPreferences) + X509 chain validation
- [ ] Kotlin signing callback で Rust の `c2pa_sign_image_tee` を呼ぶ
- [ ] rootlens-mobile から prebuilt `.so` を移植 (arm64-v8a, x86_64) ← 起点
- [ ] sandbox 04 を Android で通す
- [ ] iOS と JS API surface が完全一致 (`signContent` / `generateDeviceCredentials` 等)

参考実装:
- iOS: `app/modules/c2pa-bridge/ios/C2paBridgeModule.swift`
- 過去 Android (DEBUG-only、TEE なし): `../rootlens-mobile/app/modules/c2pa-bridge/android/`

## 制限事項

- **iOS only でこの unit を verified とする**: §2.7 の本質は「TEE で鍵管理」なので、iOS 部分が完成していれば「TEE C2PA という仕組みが動く」ことは確認済。Android はそれの port 実装で、スコープを切り分けて別タスク扱い。
- **CA backend は web 側に既実装** (`web/lib/server/ca.ts`、`web/app/api/v1/device-certificate/`)。dev は LocalEcSigner、本番は KMS_*_ICA_KEY_ID で AWS KMS に切替。
- **Mobile JS orchestrator は legacy から移植済**: `app/src/hooks/useCertificateProvisioning.ts` + `App.tsx` の `CertGate`。iOS のみ前提で書かれている。
- **Photos.framework 依存**: iOS の `resolveToFile` は `ph://` URI も解決するため Photos に依存。RN 側で file:// のみに正規化すれば剥がせる (将来的な Android 実装との API 統一観点)。
