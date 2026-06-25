#!/usr/bin/env bash
# Pipeline 3 (WiLoR) を未生成の hash だけ順次叩く (= 並列度 2)。 cached が効くので
# 既存 wilor.jsonl を持つ hash はサーバ即返りで通る。 並列 8 は Modal endpoint の
# 同時許容量を超えて 303 で死んだので 2 に絞る。
set -uo pipefail
cd /Users/forest/WebCreations/root-lens
set -a; source web/.env.local; set +a
mkdir -p recovered/p3_logs

run_one() {
  local h="$1"
  local start ts status
  start=$(date +%s)
  # Modal の fastapi_endpoint は 150秒で 303 redirect を返し、 redirect 先で結果待ちさせる
  # 設計。 -L --post303 で redirect を追従して最終結果を取得する。
  status=$(curl -s -L --post303 -o "recovered/p3_logs/$h.json" -w "%{http_code}" \
    --max-time 1800 -X POST "${MODAL_WILOR_ENDPOINT}?signature_hash=${h}")
  ts=$(($(date +%s)-start))
  if [ "$status" = "200" ]; then
    local info
    info=$(python3 -c "
import json
d=json.load(open('recovered/p3_logs/$h.json'))
print(f\"frames={d.get('totalFrames','?')} fps={d.get('fps','?')} hands={d.get('handsDetectedAvg','?')} cached={d.get('cached','?')}\")
" 2>/dev/null || echo "(parse err)")
    echo "[OK ${ts}s] ${h:0:12}  $info"
  else
    local body
    body=$(head -c 120 "recovered/p3_logs/$h.json" 2>/dev/null | tr -d '\n')
    echo "[FAIL HTTP=$status t=${ts}s] ${h:0:12}  $body"
  fi
}
export -f run_one
export MODAL_WILOR_ENDPOINT

ls recovered/raw | xargs -P 2 -I{} bash -c 'run_one "$@"' _ {}
echo "════ 全 32 件 完了 ════"
ok=$(grep -c "^\[OK" /tmp/rl_p3.log 2>/dev/null)
echo "成功: ${ok:-?} / 32"
