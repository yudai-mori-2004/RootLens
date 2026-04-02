# Task 22: Title Protocol cert-* / image-pdq 新仕様への対応

## 目的

Title Protocol v0.1.1 Task 16 で実施されたWASMモジュール再設計に対応し、RootLens側のガバナンスAPI・検証ページ・アプリ登録フローを更新する。

### Title Protocol側の変更概要（Task 16で実施済み）

- `hardware-google` → `cert-google`（他ベンダーも同様に `cert-*` プレフィックス）
- `phash-v1` → `image-phash`（ext_idとディレクトリ名を一致）
- `image-pdq` 新設（PDQ 256-bit、Meta ThreatExchange互換）
- `c2pa-license-v1`, `c2pa-training-v1` 削除

## 背景

### 設計方針

1. **WASMバイナリ = 信頼ポリシーのコミットメント**: Root CA公開鍵をWASMにハードコード → `wasm_hash` で改竄不可を保証
2. **ベンダー別 `ext_id`**: Root CA追加/更新時は `add_wasm_version` で新バージョンを登録（フロー既存）
3. **`cert-` プレフィックスで統一**: 検証メカニズムで命名（`hardware-` ではなくcert chain検証であることを明示）
4. **ホスト関数活用**: 暗号処理は `get_content_feature` の `c2pa_verify_active_cert_chain` op で実行（ホスト側で高速に処理）
5. **チェーン詳細は結果JSONに記録**: Subject情報で消費者がハードウェア/ソフトウェアを判断

### ext_id命名規則

```
cert-google      ← Google C2PA Root CA G3
cert-sony        ← SONY C2PA Root CA G2
cert-leica       ← Leica C2PA Root CA
cert-rootlens    ← RootLens Root CA
```

### cNFT結果フォーマット（全モジュール共通）

```json
{
  "verified": true,
  "chain": [
    {"subject": "CN=...,OU=...,O=...,C=..."},
    {"subject": "CN=...,O=...,C=..."}
  ],
  "root_ca": "Google C2PA Root CA G3",
  "root_spki_hash": "sha256(SPKI DER)"
}
```

- `chain`: x5chainのLeaf→Intermediate順。Subject文字列を記録
- `root_ca`: 検証に使用したRoot CAの人間可読名
- `root_spki_hash`: Root CA SPKIのSHA-256ハッシュ（プログラマティックな信頼検証用）
- 消費者側がSubject文字列からハードウェア/ソフトウェア/プラットフォームを判断

---

## 対象ベンダーと調査結果

### 1. Google（実データあり: Pixel写真）

**Root CA**: Google C2PA Root CA G3
- **アルゴリズム**: ECDSA P-384 + SHA-384
- **ソース**: C2PA公式Trust List + `http://pki.goog/c2pa/root-g3.crt`
- **SPKI DER (hex)**: `3076301006072a8648ce3d020106052b810400220362000486ff5ffe3b8a70fa5edc59bb78021232e4b24beb41c67d1a6070bcdc9faa02c15644418df69e8f37f381a28b8fce9385471beb956a16980237a75957c8f8381377a0ed2342860a29508a62846bbaaa584ff2b2d77f7a7c6e123915343631a176`

**実データの証明書チェーン**（`pixel_photo_plane.jpg`）:

```
Leaf:         CN=Google Photos, OU=Google Photos Android, O=Google LLC, C=US
                署名アルゴリズム: ECDSA-SHA384
                Extensions: 2.5.29.15(KeyUsage), 2.5.29.37(ExtKeyUsage), 2.5.29.19(BasicConstraints),
                            1.3.6.1.4.1.62558.3, 1.3.6.1.4.1.62558.4 (C2PA private extensions)
  ↑ 署名
Intermediate: CN=Google C2PA Mobile A 1P ICA G3 L3, O=Google LLC, C=US
                Intermediate名のセマンティクス:
                  Mobile = モバイル端末由来
                  A = Android (B = 別系統のAndroid?)
                  1P = First Party (Google自社アプリ)
                  ICA = Intermediate CA
                  G3 = Generation 3, L3 = Level 3
  ↑ 署名
Root:         CN=Google C2PA Root CA G3, O=Google LLC, C=US
```

**公式Trust Listに登録済みのICA一覧**（参考、全5種）:
- Google C2PA Media Services 1P ICA G3（メディアサービス）
- Google C2PA Mobile A 1P ICA G3 L1（モバイル A 系統 Level 1）
- Google C2PA Mobile A 1P ICA G3（モバイル A 系統）
- Google C2PA Mobile B 1P ICA G3 L1（モバイル B 系統 Level 1）
- Google C2PA Mobile B 1P ICA G3（モバイル B 系統）

**OID 1.3.6.1.4.1.62558.{3,4}**: C2PA private enterprise arc。Titan M2ハードウェアアテステーション情報が含まれる可能性あり（仕様非公開、内容のパースは将来課題）。

**テスト**: `c2pa_cert.rs` に実写真での検証テスト7件が既存（全パス済み）。

---

### 2. Sony（実データなし — ITLから公開鍵取得）

**Root CA**: SONY C2PA Root CA G2
- **アルゴリズム**: ECDSA P-384 + SHA-384
- **ソース**: C2PA Interim Trust List (ITL) `anchors.pem`
- **SPKI DER (hex)**: `3076301006072a8648ce3d020106052b81040022036200048b1dbc6b2eda02fb8ebdacd48b9e426349a711d12152b1e1acd6d78563c806e5c555cbddd9aa8ba903940c478f629dd8080b7c2a5d900ff5a26a542a54c902f640df601e7743a47e494679891fdcf15e35aadb57432dfb3cae93448894fd5e41`

**対応カメラ**: Alpha 1 II, Alpha 1, Alpha 9 III, Alpha 7R V, Alpha 7S III, Alpha 7 V, Alpha 7 IV, FX3, FX30

**証明書チェーン構造**（推定）:
```
Root:         CN=SONY C2PA Root CA G2, O=SONY Corporation, C=JP
                pathLenConstraint: 2 (Root → ICA → ICA → Leaf まで許容)
  ↓ 署名
Intermediate: 不明（最大2層、実データなしで確認不可）
  ↓ 署名
Leaf:         カメラ固有のデバイス証明書（ハードウェアセキュリティチップに格納）
```

**注意事項**:
- "G2" = 第2世代Root CA。旧ファームウェアの画像はG1 Root CAにチェインする可能性あり
- ITLにのみ掲載。C2PA公式Conforming Products Listには未登録（2026年3月時点）
- Sony公式サイト: `https://authenticity.sony.net/camera/`
- 実写真が入手でき次第、チェーン構造とICA Subject文字列の確認が必要

---

### 3. Leica（実データなし — ITLから公開鍵取得）

**Root CA**: Leica C2PA Root CA
- **アルゴリズム**: ECDSA P-256 + SHA-256
- **ソース**: C2PA Interim Trust List (ITL) `anchors.pem`
- **SPKI DER (hex)**: `3059301306072a8648ce3d020106082a8648ce3d03010703420004d858764b362367ba0dce56e372d036dd4c51030ee55fcd97aa8acdb25f6020a99f5f33647b52a0b4d6fe69331fcdc5131257f43f0c3eb0474770b645dac68864`

**対応カメラ**: M11-P（初のC2PAカメラ、2023年10月）, M11-D, SL3-S, SL3, Q3ファミリー

**証明書チェーン構造**（推定、Tim Brayの分析より）:
```
Root:         CN=Leica C2PA Root CA, O=Leica Camera AG, C=DE
                pathLenConstraint: 制約なし
                PKI運営: D-Trust GmbH (ドイツ連邦印刷局子会社)
  ↓ 署名
Intermediate: Leica中間CA（D-Trust発行）
  ↓ 署名
Leaf:         カメラ固有のデバイス証明書（製造時にセキュアチップに書込み）
```

**注意事項**:
- PKIはD-Trust (Bundesdruckerei) が運営 — 政府機関系のTSP
- OCSPエンドポイント: `http://ocsp.leica.systems`
- CRLエンドポイント: `http://crl.leica.systems/crl/leica_c2pa_root_ca.crl`
- ITLにのみ掲載。C2PA公式Conforming Products Listには未登録（2026年3月時点）
- 実写真が入手でき次第、チェーン構造の確認が必要

---

### 4. RootLens（実装あり: `../root-lens`）

**Root CA**: RootLens Root CA（自社PKI、開発用）
- **アルゴリズム**: ECDSA P-256 + SHA-256
- **Dev SPKI DER (hex)**: `3059301306072a8648ce3d020106082a8648ce3d03010703420004da1dc99b9b680e7c97242fe229746a56d0f43bd999c16b29959324604eb6520d950e18bde6bf12c75394bde14b33880bb60fff99071a65db98e9ff9fe48f4a08`

**証明書チェーン構造**（Task 21で3層化済み）:
```
Root:         CN=RootLens Root CA, O=RootLens, C=JP
                pathLenConstraint: 1
  ↓ 署名
Intermediate: CN=RootLens iOS CA (or Android CA), O=RootLens, C=JP
                pathLenConstraint: 0（プラットフォーム別に分離）
                5年有効
  ↓ 署名
Leaf:         CN=RootLens Device <device_id_hash[:16]>
                90日有効、TEEで秘密鍵生成（Secure Enclave / StrongBox）
                ExtendedKeyUsage: id-kp-documentSigning
```

**他ベンダーとの違い**:
- RootLensは**カメラメーカーではなくアプリ**。C2PA署名はデバイスのTEEで行うが、証明書はRootLensが発行
- 「この端末で撮影された」ではなく「RootLensアプリがデバイスTEE鍵で署名した」を証明
- プラットフォーム別Intermediate CA (iOS / Android) でセキュリティドメインを分離
- 短寿命証明書 (90日) + RFC 3161タイムスタンプで、失効とアーカイブ検証を両立

**改善の余地（調査結果）**:

1. **cert-rootlens の導入価値**: 現在RootLensの検証ページでは `hardware-*` Extension の確認が TEE署名のパススルーのみ（`verify-content.ts` L303-312）。`cert-rootlens` を導入すれば、C2PA署名が実際にRootLens PKIにチェインすることを**暗号的に**検証できる

2. **Intermediate CA Subjectによるプラットフォーム判別**: chain[1].subject に "iOS CA" / "Android CA" が含まれるため、cNFT結果から撮影プラットフォームが判別可能

3. **Dev vs Prod Root CAの切替**: Dev Root CA SPKIがハードコードされたWASMバイナリは本番では使えない。Prod Root CA生成後に新バージョンを `add_wasm_version` で登録するフローが必要

4. **ガバナンスAPI (`/api/v1/governance/:network`) との連携**: ガバナンスAPIの `trusted_extensions` で `cert-rootlens` を返すようにすれば、アプリが「RootLens PKI検証済み」を表示可能に

---

## 実施内容

### Phase 1: ホスト関数の拡張（title-protocol側）

#### 1-1. `c2pa_verify_active_cert_chain` の結果拡張

現在: 1バイト返却（0x01/0x00）
変更: JSON結果を返却

```json
{
  "verified": true,
  "chain": [
    {"subject": "CN=Google Photos,OU=Google Photos Android,O=Google LLC,C=US"},
    {"subject": "CN=Google C2PA Mobile A 1P ICA G3 L3,O=Google LLC,C=US"}
  ]
}
```

対象ファイル:
- `title-protocol/crates/wasm-host/src/c2pa_cert.rs` — `verify_active_cert_chain` の返り値をJSON化
- `title-protocol/crates/wasm-host/src/lib.rs` — `c2pa_verify_active_cert_chain` opの結果バッファをJSONに変更

#### 1-2. MIME タイプ対応

現在の `verify_active_cert_chain` はデフォルトで `image/jpeg` のみ。`verify_active_cert_chain_with_mime` は存在するが、ホスト関数経由で呼ぶインターフェースがない。

opスペックに `mime_type` フィールドを追加:
```json
{"op": "c2pa_verify_active_cert_chain", "root_spki_hex": "...", "mime_type": "image/jpeg"}
```

### Phase 2: WASMモジュール実装

#### 2-1. cert-google

```rust
const ROOT_CA_NAME: &str = "Google C2PA Root CA G3";
const ROOT_SPKI_HEX: &str = "3076301006072a8648ce3d...343631a176";

fn process() -> u32 {
    // 1. get_content_feature で証明書チェーン検証
    // 2. 結果JSONを構築（verified, chain, root_ca, root_spki_hash）
    // 3. write_result で返却
}
```

既存の `wasm/hardware-google/` をリネームまたは新規作成。
テスト: `pixel_photo_plane.jpg`, `pixel_photo_ramen.jpg` で検証。

#### 2-2. cert-sony

```rust
const ROOT_CA_NAME: &str = "SONY C2PA Root CA G2";
const ROOT_SPKI_HEX: &str = "3076301006072a8648ce3d...94fd5e41";
```

テスト: 実写真がないため、チェーン検証ロジックの単体テスト + Root CAマッチの確認のみ。
実写真が入手でき次第、統合テストを追加。

#### 2-3. cert-leica

```rust
const ROOT_CA_NAME: &str = "Leica C2PA Root CA";
const ROOT_SPKI_HEX: &str = "3059301306072a8648ce3d...dac68864";
```

テスト: cert-sony と同様。

#### 2-4. cert-rootlens

```rust
// Dev Root CA (本番では add_wasm_version で切替)
const ROOT_CA_NAME: &str = "RootLens Root CA";
const ROOT_SPKI_HEX: &str = "3059301306072a8648ce3d...e48f4a08";
```

テスト: RootLensアプリで撮影したC2PA署名付き写真で検証。3層チェーン（Leaf → Platform ICA → Root）の通過を確認。

### Phase 3: オンチェーン登録

各モジュールを title-protocol devnet に登録:

```bash
title-cli register-wasm --extension-id cert-google --wasm-path wasm-modules/cert-google.wasm
title-cli register-wasm --extension-id cert-sony   --wasm-path wasm-modules/cert-sony.wasm
title-cli register-wasm --extension-id cert-leica  --wasm-path wasm-modules/cert-leica.wasm
title-cli register-wasm --extension-id cert-rootlens --wasm-path wasm-modules/cert-rootlens.wasm
```

### Phase 4: RootLens統合

#### 4-1. ガバナンスAPI更新

`/api/v1/governance/:network` の `trusted_extensions` を更新:

```json
{
  "trusted_extensions": [
    { "extension_id": "cert-google",   "label": "Google Pixel",  "category": "hardware" },
    { "extension_id": "cert-sony",     "label": "Sony Alpha",    "category": "hardware" },
    { "extension_id": "cert-leica",    "label": "Leica",         "category": "hardware" },
    { "extension_id": "cert-rootlens", "label": "RootLens",      "category": "app" }
  ]
}
```

#### 4-2. 検証ページ対応

`verify-content.ts` の `hardware-*` 判定ロジックを `cert-*` に更新:

```typescript
if (extId.startsWith("cert-")) {
  const result = extPayload as ExtensionPayload & {
    verified?: boolean;
    chain?: { subject: string }[];
    root_ca?: string;
  };
  // chain[0].subject からデバイス/アプリ情報を表示
  // chain[1].subject からプラットフォーム情報を表示
}
```

#### 4-3. アプリ側: RootLens登録フローに cert-rootlens を追加

Title Protocol SDK で `register()` 時の `extension_ids` に `cert-rootlens` を含める。

---

## C2PA Trust List 参考情報

### 公式Trust List（10 Root CA、2026年3月時点）

| Root CA | 組織 | 鍵種 | 用途 |
|---------|------|------|------|
| Google C2PA Root CA G3 | Google LLC | P-384 | Pixel/Android端末 |
| SSL.com C2PA RSA Root CA 2025 | SSL Corporation | RSA 4096 | CA as a Service |
| SSL.com C2PA ECC Root CA 2025 | SSL Corporation | P-256 | CA as a Service |
| Trufo C2PA Root CA (2025) | Trufo Inc. | P-384 | Trufo platform |
| vivo Content Provenance Root CA | vivo Mobile | P-256 | vivo端末 |
| Xiaomi Root CA (EC-P384) | Xiaomi | P-384 | Xiaomi端末 |
| DigiCert RSA4096 Root for C2PA G1 | DigiCert | RSA 4096 | CA as a Service |
| DigiCert ECC P384 Root for C2PA G1 | DigiCert | P-384 | CA as a Service |
| Irdeto C2PA Root CA G1 | Irdeto BV | P-384 | DRM platform |
| Tauth Root CA | Tauth Labs | P-384 | Tauth platform |

### ITL（Interim Trust List、27 Root CA、2026年1月凍結）

Sony, Leica を含む。Nikon, Canon, Fujifilm, Samsung, Microsoft, Adobe なども掲載。
URL: `https://verify.contentauthenticity.org/trust/anchors.pem`

**Sony, Leica は公式Trust Listに未掲載**。将来的に公式Trust ListのCA（DigiCert, SSL.com等）から発行される証明書に移行する可能性あり。その場合はWASMバイナリのRoot CA更新が必要。

---

## 完了条件

- [ ] ガバナンスAPI `/api/v1/governance/:network` の `trusted_extensions` を `cert-*` + `image-pdq` に更新
- [ ] 検証ページ `verify-content.ts` が `cert-*` Extension を適切に表示（chain subjects、Root CA名）
- [ ] 検証ページ `verify-content.ts` が `image-pdq` Extension のpHash比較を PDQ 256-bit ハミング距離で実行
- [ ] アプリの登録フローで `extension_ids` に `cert-rootlens` を含める
- [ ] pHash WASM をブラウザ検証で使用している箇所を PDQ WASM に切り替え

## 依存関係

- Title Protocol v0.1.1 Task 16（WASMモジュール再設計）が完了していること — **完了済み**
- RootLens Task 21 の3層PKI構造が完了していること — **完了済み**
