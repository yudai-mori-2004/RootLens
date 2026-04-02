# Task 24: 本番PKI・Platform Attestation・証明書ライフサイクル実装

## 目的

RootLensの証明書管理を本番デプロイ可能な状態にする。
dev環境のファイルベース鍵管理・Attestationスタブ・インメモリCRLを、
AWS KMS・Platform Attestation・永続CRLに置き換える。

## 背景

### 現状の問題

dev環境では以下が未実装または不十分:

1. **Platform Attestation**: 完全にスタブ。DEV_MODEデフォルトtrueのため本番デプロイ時にAttestation検証なしで証明書が発行されるリスク
2. **鍵管理**: ICA秘密鍵がPEMファイルとしてサーバーメモリに平文で存在
3. **CRL**: `new Set<string>()` のインメモリ実装。サーバー再起動で全消失
4. **証明書発行ログ**: DB記録なし。シリアル番号管理なし
5. **CSR検証**: Proof of Possessionのみ。公開鍵アルゴリズム検証なし
6. **レート制限**: なし

### セキュリティモデル

アプリベースC2PAの信頼モデルと既知の限界については [SECURITY_MODEL.md](./SECURITY_MODEL.md) を参照。

### 仕様書との対応

| 仕様書セクション | 現状 | 本タスクでの対応 |
|-----------------|------|----------------|
| §4.3 PKI構造 | dev環境ファイルベース | AWS KMS移行 |
| §4.4 証明書発行フロー | Attestationスタブ | 完全実装 |
| §4.4.3 証明書発行API | DEV_MODEデフォルトtrue | デフォルト反転 + Attestation実装 |
| §4.7 鍵ライフサイクル | CRLインメモリ | Supabase永続化 |

### 暗号アルゴリズムの抽象化方針

現在のPKIはEC P-256 (ES256) に依存しているが、将来の量子耐性署名（ML-DSA / SLH-DSA等）
への移行を見据え、署名・検証・鍵管理を十分に抽象化する。

#### 設計原則

1. **署名アルゴリズムをハードコードしない**: アルゴリズム識別子を定数で管理し、実装を差し替え可能にする
2. **CryptoSigner インターフェース**: 署名操作をインターフェース化し、EC P-256実装とKMS実装を同一IFで扱う
3. **鍵タイプの型安全性**: TypeScript上で鍵の種類（EC / KMS / PQC）を型レベルで区別する
4. **C2PA仕様との互換性**: C2PA 2.x は ES256/ES384/ES512/EdDSA をサポート。PQC対応はC2PA仕様のアップデート待ち

#### サーバー側の抽象レイヤー

```typescript
// web/lib/server/crypto.ts

/** 署名アルゴリズム定義 — 将来の追加はここに集約 */
export type SigningAlgorithm = "ES256" | "ES384";
// 将来: | "ML-DSA-65" | "SLH-DSA-SHA2-128s"

/** アルゴリズム非依存の署名インターフェース */
export interface CryptoSigner {
  readonly algorithm: SigningAlgorithm;
  sign(data: Uint8Array): Promise<Uint8Array>;
  getPublicKeyDer(): Promise<Uint8Array>;
}

/** EC P-256 ローカル実装（dev環境用） */
export class LocalEcSigner implements CryptoSigner { ... }

/** AWS KMS 実装（本番用） */
export class KmsSigner implements CryptoSigner { ... }

// 将来: export class PqcSigner implements CryptoSigner { ... }
```

#### ネイティブ側

- Android: `KeyGenParameterSpec` のアルゴリズム指定を定数化。KeyStore aliasにアルゴリズム版を含める
- iOS: `kSecAttrKeyType` を定数化。将来の Apple CryptoKit PQC対応に備える
- Rust FFI: `c2pa::SigningAlg` のマッピングを1箇所で管理

#### 移行シナリオ

PQC移行時は:
1. 新アルゴリズムの `CryptoSigner` 実装を追加
2. 新Root CA + ICAを新アルゴリズムで生成
3. cert-rootlens WASMに新Root CA SPKIを追加した新バージョンを `add_wasm_version` で登録
4. アプリの `verifyStoredCertChain()` がICA交代を検出し自動re-provisioning
5. 旧アルゴリズムのWASMバージョンは並行稼働（旧コンテンツの検証用）

---

## 実施内容

### Phase 1: 基盤整備（Attestation実装の前提条件）

#### 1-1. DEV_MODEデフォルト反転

`web/app/api/v1/device-certificate/route.ts`:

```typescript
// Before (危険: 設定忘れで本番が無検証)
const DEV_MODE = process.env.DEV_MODE !== "false";

// After (安全: 明示的にtrueを設定しない限りAttestation必須)
const DEV_MODE = process.env.DEV_MODE === "true";
```

#### 1-2. CSR公開鍵アルゴリズム検証

`web/lib/server/ca.ts` の `verifyCSR()` に追加:

```typescript
// CSR公開鍵がEC P-256であることを検証
const publicKey = await csr.publicKey.export();
const keyAlgorithm = publicKey.algorithm as EcKeyAlgorithm;
if (keyAlgorithm.name !== "ECDSA" || keyAlgorithm.namedCurve !== "P-256") {
  return { valid: false, publicKey: null, deviceIdHash: "", error: "Only EC P-256 keys are accepted" };
}
```

#### 1-3. 証明書発行テーブル（Supabase）

```sql
CREATE TABLE device_certificates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number TEXT NOT NULL UNIQUE,
  device_id_hash TEXT NOT NULL,      -- SHA-256(pubkey)[:16]
  platform TEXT NOT NULL CHECK (platform IN ('android', 'ios')),
  attestation_level TEXT,            -- 'strongbox', 'tee', 'secure_enclave'
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  revocation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_device_certificates_device_id ON device_certificates(device_id_hash);
CREATE INDEX idx_device_certificates_revoked ON device_certificates(revoked_at) WHERE revoked_at IS NOT NULL;
```

#### 1-4. 証明書発行ログの記録

`issueDeviceCertificate()` の返り値にシリアル番号を追加し、発行時にDBに記録する。

---

### Phase 2: Platform Attestation（Android）

仕様書 §4.4.3 のサーバー側検証ロジックに準拠。

#### 2-1. アプリ側: Key Attestation + Play Integrity取得

`app/android/app/src/main/java/io/rootlens/app/C2paBridgeModule.kt`:

```kotlin
// generateDeviceCredentials() に追加:
// 1. Key Attestation chain取得
val keyStore = KeyStore.getInstance("AndroidKeyStore")
keyStore.load(null)
val chain = keyStore.getCertificateChain(TEE_KEY_ALIAS)
val keyAttestationChain = chain.map { Base64.encodeToString(it.encoded, Base64.NO_WRAP) }

// 2. Play Integrity Token取得
val integrityManager = IntegrityManagerFactory.create(context)
val nonce = MessageDigest.getInstance("SHA-256").digest(csrDer)
val request = IntegrityTokenRequest.builder()
    .setNonce(Base64.encodeToString(nonce, Base64.NO_WRAP))
    .build()
val tokenResponse = integrityManager.requestIntegrityToken(request).await()

// 3. CSR + attestation を返す
promise.resolve(mapOf(
    "csr" to csrBase64,
    "platform" to "android",
    "attestation" to mapOf(
        "key_attestation_chain" to keyAttestationChain,
        "play_integrity_token" to tokenResponse.token()
    )
))
```

**注意**: `KeyGenParameterSpec` 生成時に `setAttestationChallenge(SHA256(csrDer))` が必要。
現在の `C2paBridgeModule.kt` の鍵生成コード修正が必要。

#### 2-2. サーバー側: Key Attestation chain検証

`web/lib/server/attestation-android.ts` 新規作成:

```typescript
export async function verifyAndroidAttestation(
  csrBase64: string,
  attestation: { key_attestation_chain: string[]; play_integrity_token: string }
): Promise<{ valid: boolean; securityLevel?: string; error?: string }> {

  // 1. Key Attestation chain検証
  //    - chain[0] の公開鍵 = CSRの公開鍵（同一鍵であること）
  //    - chain を Google Hardware Attestation Root CA まで検証
  //    - Attestation Extension (OID 1.3.6.1.4.1.11129.2.1.17) を解析:
  //      - attestationSecurityLevel ∈ {TRUSTED_ENVIRONMENT(1), STRONGBOX(2)}
  //      - attestationChallenge = SHA-256(CSR)
  //      - purpose に SIGN(2) が含まれる
  //      - algorithm が EC
  //      - packageInfos に RootLens パッケージ名

  // 2. Play Integrity Token検証
  //    - Google Play Integrity API でデコード
  //    - requestPackageName = RootLensパッケージ名
  //    - nonce = Base64(SHA-256(CSR))
  //    - deviceRecognitionVerdict に MEETS_DEVICE_INTEGRITY を含む

  // 3. securityLevel を返す（'strongbox' | 'tee'）
}
```

**依存ライブラリ**:
- ASN.1パーサー: `asn1js` または `@peculiar/asn1-schema`（Attestation Extension解析用）
- Google Play Integrity API: サーバー側はGoogle Cloud APIでトークンをデコード

#### 2-3. Google Hardware Attestation Root CA の埋め込み

```typescript
// Google Hardware Attestation Root CA (固定、ピン留め)
// https://developer.android.com/training/articles/security-key-attestation
const GOOGLE_ROOT_CA_PEM = `-----BEGIN CERTIFICATE-----
MIICizCCAjKgAwIBAgIJAKIFntEOQ1tXMAoGCCqGSM49BAMCMIGiMQswCQYDVQQG
...
-----END CERTIFICATE-----`;
```

---

### Phase 3: Platform Attestation（iOS）

#### 3-1. アプリ側: App Attest取得

`app/modules/c2pa-bridge/ios/C2paBridgeModule.swift`:

```swift
// generateDeviceCredentials() に追加:
import DeviceCheck

let attestService = DCAppAttestService.shared
guard attestService.isSupported else {
    promise.reject("ATTEST_ERROR", "App Attest not supported on this device")
    return
}

// 1. App Attest Key生成
attestService.generateKey { keyId, error in
    guard let keyId = keyId else { ... }

    // 2. clientDataHash = SHA-256(CSR)
    let csrHash = SHA256.hash(data: csrData)

    // 3. Attestation取得
    attestService.attestKey(keyId, clientDataHash: Data(csrHash)) { attestObject, error in
        guard let attestObject = attestObject else { ... }

        promise.resolve([
            "csr": csrBase64,
            "platform": "ios",
            "attestation": [
                "app_attest_object": attestObject.base64EncodedString(),
                "app_attest_key_id": keyId
            ]
        ])
    }
}
```

**注意**: App Attestは端末あたり7日に1回の制限あり（§4.4.1参照）。

#### 3-2. サーバー側: App Attest検証

`web/lib/server/attestation-ios.ts` 新規作成:

```typescript
export async function verifyIOSAttestation(
  csrBase64: string,
  attestation: { app_attest_object: string; app_attest_key_id: string }
): Promise<{ valid: boolean; error?: string }> {

  // 1. CBOR decode of attestation object
  // 2. Certificate chain → Apple App Attest Root CA まで検証
  // 3. rpIdHash = SHA-256(App ID) と一致確認
  // 4. counter = 0（初回attestation）
  // 5. clientDataHash = SHA-256(CSR) と一致確認
  // 6. Attestation Receipt 検証
}
```

**依存ライブラリ**:
- CBORパーサー: `cbor-x` または `cbor`
- Apple App Attest Root CA: Apple公式から取得、ピン留め

---

### Phase 4: AWS KMS移行

#### 4-1. KMS鍵の作成

```bash
# Root CA鍵（既存のdev Root CA SPKIと同一にする場合はインポート、新規なら生成）
aws kms create-key \
  --key-spec ECC_NIST_P256 \
  --key-usage SIGN_VERIFY \
  --description "RootLens Root CA" \
  --tags Key=Environment,Value=production

# iOS Intermediate CA鍵
aws kms create-key \
  --key-spec ECC_NIST_P256 \
  --key-usage SIGN_VERIFY \
  --description "RootLens iOS Intermediate CA" \
  --tags Key=Environment,Value=production Key=Platform,Value=ios

# Android Intermediate CA鍵（同様）
```

#### 4-2. ca.ts のKMS対応

`web/lib/server/ca.ts` を改修:

```typescript
import { KMSClient, SignCommand } from "@aws-sdk/client-kms";

// ICA秘密鍵を読み込む代わりにKMS Key IDを保持
interface IntermediateCA {
  cert: x509.X509Certificate;
  kmsKeyId: string;  // 旧: key: CryptoKey
}

// issueDeviceCertificate() 内の署名ロジック:
// 旧: x509.X509CertificateGenerator.create({ signingKey: intermediateCa.key })
// 新: tbsCertificate DER → KMS Sign API → X.509 DER組立て
async function signWithKMS(tbsCertDer: Uint8Array, kmsKeyId: string): Promise<Uint8Array> {
  const kms = new KMSClient({ region: process.env.AWS_REGION });
  const hash = crypto.createHash("sha256").update(tbsCertDer).digest();
  const response = await kms.send(new SignCommand({
    KeyId: kmsKeyId,
    Message: hash,
    MessageType: "DIGEST",
    SigningAlgorithm: "ECDSA_SHA_256",
  }));
  return new Uint8Array(response.Signature!);
}
```

**注意**: `@peculiar/x509` の `X509CertificateGenerator.create()` はCryptoKeyを直接受け取る設計のため、
tbsCertificate DERを手組みしてKMS Sign APIで署名し、X.509 DER構造を自前で組み立てる必要がある。
あるいは `@peculiar/x509` のカスタムCryptoProviderを実装して KMS を透過的に使う方法も検討。

#### 4-3. 環境変数の整理

```bash
# 本番環境変数（Vercel / AWS）
KMS_ROOT_CA_KEY_ID=arn:aws:kms:ap-northeast-1:xxx:key/xxx
KMS_IOS_ICA_KEY_ID=arn:aws:kms:ap-northeast-1:xxx:key/xxx
KMS_ANDROID_ICA_KEY_ID=arn:aws:kms:ap-northeast-1:xxx:key/xxx
ROOT_CA_CERT_PEM=<Root CA証明書PEM（公開情報）>
IOS_INTERMEDIATE_CA_CERT_PEM=<iOS ICA証明書PEM（公開情報）>
ANDROID_INTERMEDIATE_CA_CERT_PEM=<Android ICA証明書PEM（公開情報）>

# 秘密鍵のPEM環境変数は不要になる（KMS内に閉じ込め）
```

---

### Phase 5: CRL永続化

#### 5-1. Supabaseテーブル

```sql
CREATE TABLE revoked_certificates (
  serial_number TEXT PRIMARY KEY,
  device_id_hash TEXT NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL,  -- 'key_compromise', 'affiliation_changed', 'superseded', 'cessation_of_operation'
  revoked_by TEXT        -- 管理者ID
);
```

#### 5-2. CRLエンドポイント改修

`web/lib/server/crl.ts`: インメモリSetをSupabaseクエリに置換。
5分キャッシュ（仕様書 §4.7）はEdge Cache / `Cache-Control` ヘッダーで実装。

#### 5-3. 管理用API

```
POST /api/v1/admin/revoke-certificate
Authorization: Bearer <admin-token>
{
  "serial_number": "<hex>",
  "reason": "key_compromise"
}
```

管理者認証はSupabase Auth + RLS。

#### 5-4. 公開ページでのCRLチェック

`web/lib/verify/checks/cert.ts` に `checkCertNotRevoked()` を追加:

```typescript
// cert-rootlens の chain[0] (Device Cert) のシリアル番号を
// CRLエンドポイントと照合
function checkCertNotRevoked(payload: CertPayload, crl: string[]): CheckResult {
  // payload.chain[0] からシリアル番号を抽出
  // CRLに含まれていればfailed
}
```

---

### Phase 6: renewエンドポイント強化

#### 6-1. 鍵一致検証

`web/app/api/v1/device-certificate/renew/route.ts`:

```typescript
// renewでは、前回と同じ公開鍵（同一device_id_hash）のCSRのみ受け付ける
const existingCert = await supabase
  .from('device_certificates')
  .select('device_id_hash')
  .eq('device_id_hash', csrResult.deviceIdHash)
  .not('revoked_at', 'is', null)  // 失効済みでない
  .order('issued_at', { ascending: false })
  .limit(1);

if (!existingCert.data?.length) {
  return NextResponse.json(
    { error: "No existing certificate found for this device. Use /device-certificate for initial provisioning." },
    { status: 400 }
  );
}
```

#### 6-2. renewでの再Attestation

renew時もAttestation検証を行う。証明書更新のたびにデバイス健全性を再確認する。

---

### Phase 7: レート制限

#### 7-1. 証明書発行APIのレート制限

仕様書 §4.4.3: IPベースのレートリミット。

```typescript
// Vercel Edge Middleware または Upstash Rate Limit
// /api/v1/device-certificate: 10 requests / hour / IP
// /api/v1/device-certificate/renew: 5 requests / hour / IP
```

---

### Phase 8: 保護強化（P2）

#### 8-1. 証明書保存の改善

- **Android**: `SharedPreferences` → `EncryptedSharedPreferences`（AndroidX Security）
- **iOS**: `UserDefaults` → `Keychain`（`kSecClassGenericPassword`）

証明書は公開情報だが、改竄防止（root化端末での差し替え攻撃の防止）のため。

#### 8-2. .gitignoreへの本番鍵除外パターン追加

```gitignore
# 本番CA鍵は絶対にコミットしない
certs/prod/
**/prod-*-key.pem
```

---

## 完了条件

### P0（本番デプロイ前に必須）

- [ ] DEV_MODEデフォルトが `=== "true"` に反転されている
- [ ] CSR公開鍵アルゴリズム検証（EC P-256以外を拒否）
- [ ] `device_certificates` テーブルが作成され、発行時にDB記録される
- [ ] Android Key Attestation検証が実装され、securityLevel `SOFTWARE` を拒否する
- [ ] Android Play Integrity Token検証が実装され、`MEETS_DEVICE_INTEGRITY` を要求する
- [ ] iOS App Attest検証が実装され、Apple Root CAまでチェーンが検証される
- [ ] アプリ側がCSRと共にAttestation dataを送信する（Android / iOS）
- [ ] AWS KMSでICA鍵を管理し、サーバーメモリにICA秘密鍵が存在しない
- [ ] 環境変数からICA秘密鍵PEMが不要になっている（KMS Key IDのみ）

### P1（本番リリース前に強く推奨）

- [ ] CRLがSupabaseに永続化され、サーバー再起動で消失しない
- [ ] 管理用API（証明書失効）が実装されている
- [ ] 公開ページの検証フローでCRLチェックが行われる
- [ ] renewエンドポイントが同一device_id_hashのCSRのみ受け付ける
- [ ] renewでもAttestation検証が行われる
- [ ] 証明書発行APIにIPベースのレート制限がある

### P2（リリース後の早期改善）

- [ ] Android証明書保存が `EncryptedSharedPreferences` に移行
- [ ] iOS証明書保存が Keychain に移行
- [ ] `.gitignore` に本番鍵の除外パターンが追加されている
- [ ] 鍵ローテーション手順書が作成されている
- [ ] ICA/Root CA期限切れの監視アラートが設定されている

## 依存関係

- Task 22 (cert-wasm-modules) — cert-rootlens WASMモジュール設計 — **完了済み**
- Task 23 (pdq-migration) — PDQ + cert-rootlens 統合 — **完了済み**
- Title Protocol cert-rootlens WASMモジュール — **完了済み**（devnetに登録済み）
- Supabase環境構築 — **未着手**（本タスクPhase 1-3で使用）
- AWS KMS設定 — **未着手**（本タスクPhase 4で使用）
- Google Cloud Console設定（Play Integrity API有効化） — **未着手**
- Apple Developer Console設定（App Attest有効化） — **未着手**
