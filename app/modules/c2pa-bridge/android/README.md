# c2pa-bridge / Android — INTENTIONALLY EMPTY

このディレクトリは**意図的に空**です。Android の C2PA 実装は **未着手**。

## 現状

| | iOS | Android |
|---|---|---|
| TEE keygen | ✅ Secure Enclave (`kSecAttrTokenIDSecureEnclave`) | ❌ |
| App attestation | ✅ DCAppAttestService | ❌ (Play Integrity 等価未実装) |
| PKCS#10 CSR | ✅ 手書き DER (`buildCSR`) | ❌ |
| Cert chain 保存/検証 | ✅ UserDefaults + SecTrust | ❌ |
| C2PA sign | ✅ `c2pa_sign_image_tee` callback 経由 | ❌ Kotlin module 自体ない |
| Rust FFI .a/.so | ✅ iOS .a 同梱 | ⏳ Android .so は `native/c2pa-bridge/` でビルド可能 |

## 後続タスクの起点

`../rootlens-mobile/app/modules/c2pa-bridge/android/` に **DEBUG-only レベル** (PEM を引数で受ける `signMp4` のみ、TEE なし) の Kotlin 実装と prebuilt .so (arm64-v8a, x86_64) がある。これは v0.0.1 sandbox 用で、本 unit (§2.7 準拠) には足りない。production-grade に持ち上げるには:

1. `app/modules/c2pa-bridge/android/` に Expo Module を新規作成 (`io.rootlens.c2pa.C2paBridgeModule`)
2. Android Keystore + StrongBox で EC P-256 鍵生成 (Secure Enclave の 1:1 mirror)
3. Play Integrity API で attestation (App Attest の 1:1 mirror)
4. PKCS#10 CSR DER builder (iOS の `buildCSR` を Kotlin/BouncyCastle で再実装)
5. Device cert / Intermediate CA / Root CA を保存 (Keystore alias or SharedPreferences) + X.509 chain 検証
6. Kotlin signing callback で `c2pa_sign_image_tee` を呼ぶ (PEM 直渡しではなく TEE 鍵で署名)
7. rootlens-mobile の prebuilt .so を `src/main/jniLibs/<abi>/` に配置 (再ビルド手順は `native/c2pa-bridge/` 参照)

## なぜ今は空か

今は iOS に絞って進める方針のため。Android は後続タスクで対応する。

## 関連

- 仕様: `document/v0.1.2/SPECS_JA.md` §2.7 / §4.4 / §4.6
- iOS 実装 (reference): `../ios/C2paBridgeModule.swift`
- Rust FFI: `../../../../native/c2pa-bridge/`
- 過去実装の参考: `../../../../../rootlens-mobile/app/modules/c2pa-bridge/android/`
