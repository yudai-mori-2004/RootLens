#!/usr/bin/env bash
# End-to-end smoke test (= task 10、 TP-first flow)。
#
# v0.1.3 で TP register + cNFT mint + /api/clips を mock-device 側に統合したので、
# smoke は mock-device prod プロファイル → finalize → polling → Pipeline 3 だけになる。
#
# 流れ:
#   1. dummy sensors / IMU / intrinsics 生成
#   2. mock-device prod (= C2PA D1+D2 + blur + R2 upload + TP /process + cNFT mint + POST /api/clips)
#      ここで clip 行は既にできていて、 rootAssetId + signedJsonUri も入っている
#   3. POST /api/clips/:id/finalize で Pipeline 2 workflow 起動
#   4. GET /api/clips/:id を 2 秒ごとに polling、 state == "ready" まで待つ
#   5. Pipeline 3 endpoint を手動トリガで叩いて WiLoR 推定結果を processed/ に書き出す
#
# 前提:
#   - Vercel deploy 済 (= rootlens.io/api 経由 もしくは preview URL)
#   - web/.env.local に R2 credential + MODAL_WILOR_ENDPOINT (= mock-device prod 用)。
#     無ければ `cd web && vercel env pull .env.local --yes` で取得
#   - mock-device の release build 済 (= cargo build --release in tools/mock-device)
#   - MERKLE_TREE env (= cNFT mint 先 tree pubkey、 devnet)
#   - SOLANA_KEYPAIR env (= 既定 root-lens/keys/dev/solana/deployer.json)
#
# 使い方:
#   MERKLE_TREE=<pubkey> bash tools/smoke-test.sh [--input <path>] [--api-base <url>]

set -euo pipefail

REPO_ROOT="/Users/forest/WebCreations/root-lens"
MOCK_DEVICE="$REPO_ROOT/tools/mock-device/target/release/mock-device"
GEN_DUMMY="$REPO_ROOT/tools/gen-dummy-sensors.py"

# ─── 引数 ──────────────────────────────────────────────────────────
INPUT_MP4="${INPUT_MP4:-/Users/forest/WebCreations/title-protocol/legacy/v0.1.0/tests/fixtures/minimal/test_5s_640x480.mp4}"
TASK_ID="${TASK_ID:-dishes}"
ACHIEVEMENT="${ACHIEVEMENT:-85}"
API_BASE="${API_BASE:-https://www.rootlens.io}"
SOLANA_KEYPAIR="${SOLANA_KEYPAIR:-$REPO_ROOT/keys/dev/solana/deployer.json}"
SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
# env 一本: TP_GATEWAY (or TP_GATEWAY_URL) で gateway を指定する。 固定 IP は焼かない
# (= EC2 再起動で公開 IP が変わるため)。
TP_GATEWAY="${TP_GATEWAY:-${TP_GATEWAY_URL:-}}"
COLLECTION="${COLLECTION:-Dfg52e4aG9zusPedUSMQ7q8kRs3W4QebNCQqJf3GjYBy}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input) INPUT_MP4="$2"; shift 2 ;;
    --task-id) TASK_ID="$2"; shift 2 ;;
    --api-base) API_BASE="$2"; shift 2 ;;
    --merkle-tree) MERKLE_TREE="$2"; shift 2 ;;
    --keypair) SOLANA_KEYPAIR="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [ -z "${MERKLE_TREE:-}" ]; then
  echo "MERKLE_TREE 必須 (= cNFT mint 先 tree pubkey、 devnet)"
  echo "  例: MERKLE_TREE=<pubkey> bash tools/smoke-test.sh"
  exit 1
fi

# ─── env を web/.env.local から読む ────────────────────────────────
ENV_FILE="${ENV_FILE:-$REPO_ROOT/web/.env.local}"
if [ ! -f "$ENV_FILE" ]; then
  echo "ENV_FILE not found: $ENV_FILE"
  echo "Run: cd $REPO_ROOT/web && vercel env pull .env.local --yes"
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

if [ -z "${MODAL_WILOR_ENDPOINT:-}" ]; then
  echo "MODAL_WILOR_ENDPOINT が .env.local に無い (= Pipeline 3 を叩けない)"
  exit 1
fi

# ─── tmp 出力場所 ────────────────────────────────────────────────
TMP_DIR="$(mktemp -d -t rootlens-smoke-XXXXXX)"
echo "tmp dir: $TMP_DIR"

# ─── Step 1: dummy sensors 生成 ─────────────────────────────────
echo ""
echo "=== Step 1/5: dummy sensors 生成 ==="
python3 "$GEN_DUMMY" --input "$INPUT_MP4" --output-dir "$TMP_DIR" >/dev/null
echo "  ok: sensors.jsonl + imu_high_rate.jsonl + camera_intrinsics.json"

# ─── Step 2: mock-device prod (= R2 + TP + cNFT + /api/clips) ───
echo ""
echo "=== Step 2/5: mock-device prod (= R2 + TP /process + cNFT mint + POST /api/clips) ==="
MOCK_JSON_PATH="$TMP_DIR/mock_device.json"
set +e
"$MOCK_DEVICE" \
  --input "$INPUT_MP4" \
  --sensors "$TMP_DIR/sensors.jsonl" \
  --imu "$TMP_DIR/imu_high_rate.jsonl" \
  --intrinsics "$TMP_DIR/camera_intrinsics.json" \
  --output-dir "$TMP_DIR" \
  --profile prod \
  --solana-keypair "$SOLANA_KEYPAIR" \
  --solana-rpc-url "$SOLANA_RPC_URL" \
  --tp-gateway "$TP_GATEWAY" \
  --merkle-tree "$MERKLE_TREE" \
  --collection "$COLLECTION" \
  --api-base "$API_BASE" \
  --task-id "$TASK_ID" \
  --achievement "$ACHIEVEMENT" \
  --quiet >"$MOCK_JSON_PATH"
MOCK_EXIT=$?
set -e
if [ "$MOCK_EXIT" -ne 0 ]; then
  echo "  mock-device exit=$MOCK_EXIT"
  cat "$MOCK_JSON_PATH" | python3 -m json.tool | sed 's/^/    /' || true
  exit 1
fi

SIGNATURE_HASH=$(python3 -c "import json; d=json.load(open('$MOCK_JSON_PATH')); print(d['signature_hash_hex'])")
ROOT_ASSET=$(python3 -c "import json; d=json.load(open('$MOCK_JSON_PATH')); print(d['root_asset_id'])")
CLIP_ID=$(python3 -c "import json; d=json.load(open('$MOCK_JSON_PATH')); print(d['clip_id'])")
WALLET=$(python3 -c "import json; d=json.load(open('$MOCK_JSON_PATH')); print(d['wallet_pubkey'])")
TX_SIG=$(python3 -c "import json; d=json.load(open('$MOCK_JSON_PATH')); print(d['solana_tx_signature'])")
echo "  ok: signature_hash    = $SIGNATURE_HASH"
echo "      root_asset_id = $ROOT_ASSET"
echo "      clip_id       = $CLIP_ID"
echo "      wallet_pubkey = $WALLET"
echo "      solana tx     = $TX_SIG"

# ─── Step 3: POST /api/clips/:id/finalize ───────────────────────
echo ""
echo "=== Step 3/5: POST /api/clips/$CLIP_ID/finalize (= Pipeline 2 workflow キック) ==="
curl -fsS -X POST "$API_BASE/api/clips/$CLIP_ID/finalize" \
  -H "Content-Type: application/json" \
  -H "X-Wallet-Pubkey: $WALLET" \
  -d "{\"signatureHash\":\"$SIGNATURE_HASH\"}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'  ok: state={d[\"clip\"][\"state\"]} processingStep={d[\"clip\"][\"processingStep\"]}')"

# ─── Step 4: ready 待ち polling ──────────────────────────────────
echo ""
echo "=== Step 4/5: ready 待ち (= 2 秒間隔 polling) ==="
DEADLINE=$(( $(date +%s) + 1800 ))  # 最大 30 分
PREV_STEP=""
while true; do
  if [ $(date +%s) -gt $DEADLINE ]; then
    echo "  TIMEOUT: 30 分待っても ready にならず"
    exit 1
  fi
  STATUS=$(curl -fsS "$API_BASE/api/clips/$CLIP_ID" -H "X-Wallet-Pubkey: $WALLET")
  STATE=$(echo "$STATUS" | python3 -c "import json,sys; print(json.load(sys.stdin)['clip']['state'])")
  STEP=$(echo "$STATUS" | python3 -c "import json,sys; print(json.load(sys.stdin)['clip']['processingStep'] or '')")
  if [ "$STEP" != "$PREV_STEP" ] && [ -n "$STEP" ]; then
    echo "  step: $STEP"
    PREV_STEP="$STEP"
  fi
  if [ "$STATE" = "ready" ]; then
    SCORE=$(echo "$STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['clip']['qualityScore'])")
    echo "  ok: state=ready, qualityScore=$SCORE"
    BREAKDOWN=$(echo "$STATUS" | python3 -c "import json,sys; print(json.dumps(json.load(sys.stdin)['clip']['qualityBreakdown'], indent=2))")
    echo "  qualityBreakdown:"
    echo "$BREAKDOWN" | sed 's/^/    /'
    break
  fi
  if [ "$STATE" = "error" ]; then
    MSG=$(echo "$STATUS" | python3 -c "import json,sys; print(json.load(sys.stdin)['clip']['errorMessage'])")
    echo "  ERROR: $MSG"
    exit 1
  fi
  sleep 2
done

# ─── Step 5: Pipeline 3 を手動トリガ ────────────────────────────
echo ""
echo "=== Step 5/5: Pipeline 3 (= WiLoR 手ポーズ推定) を手動トリガ ==="
WILOR_URL="$MODAL_WILOR_ENDPOINT?signature_hash=$SIGNATURE_HASH"
WILOR_RES=$(curl -fsS -X POST "$WILOR_URL")
echo "$WILOR_RES" | python3 -m json.tool | sed 's/^/  /'

echo ""
echo "=== smoke test 完了 ==="
echo "  clip_id:        $CLIP_ID"
echo "  signature_hash:     $SIGNATURE_HASH"
echo "  root_asset_id:  $ROOT_ASSET"
echo "  wallet_pubkey:  $WALLET"
echo "  processed:      processed/$SIGNATURE_HASH/"
echo "  preview:        $API_BASE/api/clips/$CLIP_ID"
