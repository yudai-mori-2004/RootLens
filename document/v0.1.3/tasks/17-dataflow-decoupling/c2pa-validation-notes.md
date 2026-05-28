# C2PA 検証が通らなかった真因と対処 (調査記録)

プロジェクト開始以来、全クリップで TP `/process` の `c2pa-verify` が `validation_state = Invalid` を返し続けていた。パイプラインがこの結果で gate していなかったため (signature_hash は検証失敗でも算出される)、長期間気付かれなかった。2026-05-28 に切り分けて根治した。

真因は **2 つの独立した問題**。どちらも表面のエラーコードが誤解を招く。

---

## 真因 1: D2 manifest の actions 構造が C2PA 2.x 非準拠

### 症状 (c2patool / c2pa-rs reader)
```
assertion.action.malformed        "first action must be created or opened"
assertion.action.ingredientMismatch "opened, placed and removed items must have ingredient(s) parameters"
```

### 原因
D2 の `c2pa.actions.v2` が `c2pa.placed` 単体だった。C2PA 2.x では:
- actions の **先頭は `c2pa.created` か `c2pa.opened`** でなければならない。
- `c2pa.opened` / `c2pa.placed` / `c2pa.removed` は `parameters.ingredients` (= ingredient assertion への参照) が必須。
- 顔ぼかしは ingredient を「配置」する操作ではなく「編集」なので、本来 `c2pa.placed` ではなく `c2pa.edited`。

### 対処
`build_d2_manifest` の blur action を `c2pa.placed` → **`c2pa.edited`** に変更し、署名前に **`builder.set_intent(c2pa::BuilderIntent::Edit)`** を呼ぶ。c2pa 0.84.1 の Builder は intent=Edit + parentOf ingredient があると、先頭に `c2pa.opened` (ingredients param に親 ingredient を入れた状態) を**自動挿入**する (`builder.rs::add_auto_actions_assertions_settings`)。手で HashedUri を組む必要はない。

`c2pa.edited` は ingredients param を要求しないので ingredientMismatch も解消する。

適用先: `native/c2pa-bridge/src/pipeline1.rs`、`tools/mock-device/src/c2pa_sign.rs` の両方 (同一バグを共有していた)。

---

## 真因 2: 署名証明書の Subject DN に Organization (`O=`) が無い ★最大の罠

### 症状
```
claimSignature.mismatch    "claim signature is not valid"
```

### なぜ全員誤認したか
このコードは「署名が暗号的に不正」に見えるが、**実際は暗号検証は成功している**。c2pa-rs (`cose/verifier.rs` 付近、0.78〜0.84 共通) は署名検証成功後に cert subject から `O=` を**必須抽出**し、無いと内部で `MissingSigningCertificateChain` を返す。それが上位で **`claimSignature.mismatch`** という無関係に見えるコードで表面化する。

このため、alg (Ed25519/ES256)・version・format (MP4/JPEG)・`from_json`/`from_context`・trust on/off を変えても**全部 mismatch のまま**になり、「署名/暗号のバグ」「ライブラリのバグ」と何度も誤診した。cert/key の pubkey は一致していた (鍵不一致ではない)。

### 切り分けの決め手 (A/B)
同一鍵で `O=` だけを足した cert と足さない cert を c2patool で署名・検証:
- `-subj "/CN=..."` (O= 無し) → `claimSignature.mismatch` (Invalid)
- `-subj "/O=RootLens/CN=..."` (O= 有り) → **Valid**

`O=` だけが変数だった。

### 対処
dev fixture の EE + CA cert を `O=` 付きで再発行する (`ee.key` は流用可、cert を再発行するだけ):
```bash
openssl genpkey -algorithm ED25519 -out ca.key
openssl req -new -x509 -key ca.key -out ca.pem -days 3650 \
  -subj "/O=RootLens/CN=Title Protocol Test CA" \
  -addext "basicConstraints=critical,CA:TRUE" \
  -addext "keyUsage=critical,digitalSignature,keyCertSign"
openssl req -new -key ee.key -out ee.csr -subj "/O=RootLens/CN=Title Protocol Test EE"
# ee.cnf: basicConstraints=critical,CA:FALSE / keyUsage=critical,digitalSignature,nonRepudiation / extendedKeyUsage=emailProtection
openssl x509 -req -in ee.csr -CA ca.pem -CAkey ca.key -CAcreateserial -out ee.pem -days 3650 -extfile ee.cnf
cat ee.pem ca.pem > chain.pem
```
`native/c2pa-bridge/fixtures/chain.pem` と `tools/mock-device/fixtures/chain.pem` を差し替え。

### ⚠ 将来の罠 (Secure Enclave / 実機 device cert)
現状の C2PA 署名は **bundled dev fixture** (`include_bytes!`) を使うのでこれで通る。だが DATA_SPECS §2.4 の本番設計 = Secure Enclave P-256/ES256 に切替える時、署名 cert は端末側 CSR (`generateDeviceCredentials`) + `certs/dev/issue-device-cert.sh` 経路で発行される。**この CSR / 発行 cert の Subject DN にも `O=` を必ず入れること。** 抜けると実機 SE 署名で全く同じ `claimSignature.mismatch` を踏む。

---

## 検証ツールと注意

| ツール | 用途 | 注意 |
|---|---|---|
| TP gateway `POST /process` (`processor_ids:["c2pa-verify"]`) | **権威**。本番が gate する検証 | error 時は `validation_state = Invalid` の汎用文しか返さず、具体コードは出ない |
| c2pa 0.84.1 `Reader` (= 署名と同じ版、trust-off) | 自己整合チェック。mock-device `--verify-only` で実行 | `verify.verify_trust=false` で untrusted を無視し、claimSignature だけ見られる |
| mock-device `--profile dev` | R2/TP/cNFT 無しでローカル署名のみ | 署名出力を `--verify-only` / TP に回して検証 |
| mock-device `--selftest` | created-only の最小 round-trip | BMFF/image の切り分け用 |
| **c2patool 0.26.35** | ❌ **信頼するな** | この環境では自分で署名したものすら `claimSignature.mismatch` を返す (bundle が c2pa-rs 0.78、sign/verify roundtrip 破綻)。構造系コード (action.malformed 等) は正しいが crypto/trust 判定は当てにならない |

### 検証フロー (再発時)
1. mock-device `--profile dev` で署名 → `--verify-only` (trust-off) で `validation_state` を見る。
2. `claimSignature.mismatch` が出たら **まず cert subject に `O=` があるか** (`openssl x509 -subject`) を疑う。
3. `action.malformed` / `ingredientMismatch` が出たら actions 構造 (created/opened 先頭 + ingredients param) を疑う。
4. 最終確認は R2 にアップロード → TP `/process` で `c2pa-verify status: ok` を取る。

---

## 確証 (2026-05-28)

- mock-device dev 署名 (Ed25519, O= cert, action 修正) → c2pa 0.84.1 reader (trust-off) = **Valid**
- 同ファイルを TP `/process` → `c2pa-verify status: ok`
- **実機** (森雄大's iPhone, iOS 26.4.2) で再録画したクリップ `clip_e06ab7c93be1_mpp5aiwi` → TP `c2pa-verify status: ok`、`attestation` present、Pipeline 2 ready 69/100。実機署名で C2PA 来歴検証が初成立。
