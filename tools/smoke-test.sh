#!/usr/bin/env bash
# End-to-end smoke test (= task 10)。
#
# 流れ:
#   1. mock-device で raw MP4 + dummy sensors を R2 にアップロード (= prod profile)
#   2. POST /api/clips で DB 行作成 + presigned URL 取得 (= 既に R2 に上がっているので URL は使わない)
#   3. POST /api/clips/:id/finalize で Pipeline 2 workflow を起動
#   4. GET /api/clips/:id を 2 秒ごとに polling、 state == "ready" まで待つ
#   5. Pipeline 3 endpoint を手動トリガで叩いて LeRobot v3 dataset を生成
#   6. 結果サマリを print
#
# 前提:
#   - Vercel deploy 済 (= rootlens.io/api 経由 もしくは preview URL)
#   - web/.env.local に R2 credential が入っている (= mock-device の prod profile 用)。 無ければ
#     `cd web && vercel env pull .env.local --yes` で取得
#   - mock-device の release build 済 (= cargo build --release in tools/mock-device)
#   - macos_blur の release build 済 (= server/scripts/macos_blur/.build/.../MacOsBlur)
#
# 使い方:
#   bash tools/smoke-test.sh [--input <path/to/raw.mp4>] [--wallet <pubkey>]
#   API_BASE=https://rootlens.io bash tools/smoke-test.sh

set -euo pipefail

# ─── 引数 ──────────────────────────────────────────────────────────
INPUT_MP4="${INPUT_MP4:-/Users/forest/WebCreations/title-protocol/legacy/v0.1.0/tests/fixtures/minimal/test_5s_640x480.mp4}"
WALLET="${WALLET:-11111111111111111111111111111111}"  # base58 32 文字、 dev mock 用
TASK_ID="${TASK_ID:-dishes}"
ACHIEVEMENT="${ACHIEVEMENT:-85}"
API_BASE="${API_BASE:-http://localhost:3000}"

REPO_ROOT="/Users/forest/WebCreations/root-lens"
MOCK_DEVICE="$REPO_ROOT/tools/mock-device/target/release/mock-device"
GEN_DUMMY="$REPO_ROOT/tools/gen-dummy-sensors.py"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --input) INPUT_MP4="$2"; shift 2 ;;
    --wallet) WALLET="$2"; shift 2 ;;
    --task-id) TASK_ID="$2"; shift 2 ;;
    --api-base) API_BASE="$2"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ─── env を web/.env.local から読む (= mock-device prod 用 R2 credential + Pipeline 3 用 MODAL_BUNDLE_ENDPOINT) ──
# 無ければ `cd web && vercel env pull .env.local --yes` で取得
ENV_FILE="${ENV_FILE:-$REPO_ROOT/web/.env.local}"
if [ ! -f "$ENV_FILE" ]; then
  echo "ENV_FILE not found: $ENV_FILE"
  echo "Run: cd $REPO_ROOT/web && vercel env pull .env.local --yes"
  exit 1
fi
set -a; source "$ENV_FILE"; set +a

# ─── tmp 出力場所 ────────────────────────────────────────────────
TMP_DIR="$(mktemp -d -t rootlens-smoke-XXXXXX)"
echo "tmp dir: $TMP_DIR"

# ─── Step 1: dummy sensors 生成 ─────────────────────────────────
echo ""
echo "=== Step 1/6: dummy sensors 生成 ==="
python3 "$GEN_DUMMY" --input "$INPUT_MP4" --output-dir "$TMP_DIR" >/dev/null
echo "  ok: sensors.jsonl + imu_high_rate.jsonl + camera_intrinsics.json"

# ─── Step 2: mock-device で R2 アップロード ─────────────────────
echo ""
echo "=== Step 2/6: mock-device prod (= R2 upload + 2 段 C2PA + blur) ==="
MOCK_OUT=$("$MOCK_DEVICE" \
  --input "$INPUT_MP4" \
  --sensors "$TMP_DIR/sensors.jsonl" \
  --imu "$TMP_DIR/imu_high_rate.jsonl" \
  --intrinsics "$TMP_DIR/camera_intrinsics.json" \
  --output-dir "$TMP_DIR" \
  --profile prod \
  --quiet)
CONTENT_ID=$(echo "$MOCK_OUT" | python3 -c "import json,sys; print(json.load(sys.stdin)['content_id_hex'])")
echo "  ok: content_id = $CONTENT_ID"

# ─── Step 3: POST /api/clips で DB 行作成 ───────────────────────
echo ""
echo "=== Step 3/6: POST /api/clips ==="
CREATE_RES=$(curl -fsS -X POST "$API_BASE/api/clips" \
  -H "Content-Type: application/json" \
  -H "X-Wallet-Pubkey: $WALLET" \
  -d "{\"taskId\":\"$TASK_ID\",\"achievementConfidence\":$ACHIEVEMENT,\"contentId\":\"$CONTENT_ID\",\"contentSize\":$(stat -f %z "$TMP_DIR/$CONTENT_ID/rgb.mp4")}")
CLIP_ID=$(echo "$CREATE_RES" | python3 -c "import json,sys; print(json.load(sys.stdin)['clip']['id'])")
echo "  ok: clip_id = $CLIP_ID"

# ─── Step 4: POST /api/clips/:id/finalize ───────────────────────
echo ""
echo "=== Step 4/6: POST /api/clips/$CLIP_ID/finalize (= workflow キック) ==="
curl -fsS -X POST "$API_BASE/api/clips/$CLIP_ID/finalize" \
  -H "Content-Type: application/json" \
  -H "X-Wallet-Pubkey: $WALLET" \
  -d "{\"contentId\":\"$CONTENT_ID\"}" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'  ok: state={d[\"clip\"][\"state\"]} processingStep={d[\"clip\"][\"processingStep\"]}')"

# ─── Step 5: ready 待ち polling ──────────────────────────────────
echo ""
echo "=== Step 5/6: ready 待ち (= 2 秒間隔 polling) ==="
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
    # rootAssetId は cNFT 発行 (= TP /extension/solana) 後にのみ入る。 サーバ flow に
    # TP register は無いので、 smoke では未発行のままで bundle を回す。 dataset prefix の
    # キーとしては content_id を代用する。
    ROOT_ASSET=$(echo "$STATUS" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['clip']['rootAssetId'] or '')")
    if [ -z "$ROOT_ASSET" ]; then
      ROOT_ASSET="$CONTENT_ID"
      echo "  (rootAssetId 未発行、 content_id を bundle key として使う)"
    fi
    echo "  ok: state=ready, qualityScore=$SCORE, rootAssetId=$ROOT_ASSET"
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

# ─── Step 6: Pipeline 3 を手動トリガ ────────────────────────────
echo ""
echo "=== Step 6/6: Pipeline 3 (= WiLoR + LeRobot v3 bundle) を手動トリガ ==="
RAW_PREFIX="raw/$CONTENT_ID/"
SIGNED_KEY="raw/$CONTENT_ID/rgb.mp4"
OUTPUT_PREFIX="datasets/$ROOT_ASSET/"
BUNDLE_URL="$MODAL_BUNDLE_ENDPOINT?raw_prefix=$RAW_PREFIX&signed_mp4_key=$SIGNED_KEY&output_prefix=$OUTPUT_PREFIX&root_asset_id=$ROOT_ASSET&idempotency_key=$CONTENT_ID"
BUNDLE_RES=$(curl -fsS -X POST "$BUNDLE_URL")
echo "$BUNDLE_RES" | python3 -m json.tool | sed 's/^/  /'

echo ""
echo "=== smoke test 完了 ==="
echo "  clip_id:        $CLIP_ID"
echo "  content_id:     $CONTENT_ID"
echo "  root_asset_id:  $ROOT_ASSET"
echo "  dataset prefix: $OUTPUT_PREFIX"
echo "  preview: $API_BASE/api/clips/$CLIP_ID"
