#!/bin/bash
# サーバ署名用 leaf 証明書生成スクリプト (= §2.10 段階 1 「署名 S」 用)
# 仕様書 §2.10 / §4.3 PKI 構造
#
# 端末側 (= 段階 2) は Root → Platform ICA → Device の 3 層だが、
# サーバ署名は 1 つの identity しか要らないので Root → Server の 2 層で良い。
# Root CA の pathLenConstraint:1 は Root → leaf 直接発行を許す
# (= pathLenConstraint = 「Root と leaf の間にある ICA の最大数」、 leaf 直発行は ICA=0 で合法)。
#
# 出力:
#   certs/dev/server-c2pa.pem      - Server leaf cert (公開)
#   certs/dev/server-c2pa-key.pem  - Server leaf 秘密鍵 (dev のみ、 本番は KMS)
#   certs/dev/server-c2pa-chain.pem - leaf + Root を連結した chain (C2PA Builder に渡す形式)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUT_DIR="${1:-$SCRIPT_DIR}"

ROOT_CA_CERT="$SCRIPT_DIR/root-ca.pem"
ROOT_CA_KEY="$SCRIPT_DIR/root-ca-key.pem"

if [ ! -f "$ROOT_CA_CERT" ] || [ ! -f "$ROOT_CA_KEY" ]; then
    echo "Error: Root CA not found. Run gen-root-ca.sh first."
    exit 1
fi

mkdir -p "$OUT_DIR"

CERT_FILE="$OUT_DIR/server-c2pa.pem"
KEY_FILE="$OUT_DIR/server-c2pa-key.pem"
CHAIN_FILE="$OUT_DIR/server-c2pa-chain.pem"

if [ -f "$CERT_FILE" ] && [ -f "$KEY_FILE" ]; then
    echo "Server cert は既に存在します。再生成する場合は削除してください。"
    openssl x509 -in "$CERT_FILE" -subject -dates -noout
    exit 0
fi

echo "=== Server signing cert を生成します ==="

# 鍵生成 (EC P-256 = ES256 用)
openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:prime256v1 -out "$KEY_FILE"

# CSR
cat > "$OUT_DIR/_server.cnf" << 'EOF'
[req]
distinguished_name = req_dn
prompt = no

[req_dn]
CN = RootLens Server
O = RootLens
C = JP
EOF

openssl req -new -key "$KEY_FILE" \
  -config "$OUT_DIR/_server.cnf" \
  -out "$OUT_DIR/_server.csr"

# Root CA で署名: CA:FALSE, digitalSignature, id-kp-documentSigning
# 有効期間: 365 日 (= dev、 本番は短寿命 + ローテーション)
cat > "$OUT_DIR/_server_ext.cnf" << 'EOF'
[v3_server]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature
extendedKeyUsage = 1.3.6.1.5.5.7.3.36
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
EOF

openssl x509 -req -in "$OUT_DIR/_server.csr" \
  -CA "$ROOT_CA_CERT" \
  -CAkey "$ROOT_CA_KEY" \
  -CAcreateserial \
  -sha256 -days 365 \
  -extfile "$OUT_DIR/_server_ext.cnf" -extensions v3_server \
  -set_serial "0x$(openssl rand -hex 20)" \
  -out "$CERT_FILE" \
  2>/dev/null

# chain (= leaf + root) を作成。 c2pa-rs / c2pa-python の Builder は
# x5chain に leaf → ... → root の順で並べた PEM を渡す慣行。
cat "$CERT_FILE" "$ROOT_CA_CERT" > "$CHAIN_FILE"

rm -f "$OUT_DIR/_server.cnf" "$OUT_DIR/_server.csr" "$OUT_DIR/_server_ext.cnf" "$SCRIPT_DIR/root-ca.srl"

echo ""
echo "=== Server cert 発行完了 ==="
openssl x509 -in "$CERT_FILE" -subject -issuer -dates -noout
echo ""
echo "チェーン検証:"
openssl verify -CAfile "$ROOT_CA_CERT" "$CERT_FILE"
echo ""
echo "出力:"
echo "  cert:  $CERT_FILE"
echo "  key:   $KEY_FILE"
echo "  chain: $CHAIN_FILE (= c2pa Builder に渡す PEM)"
