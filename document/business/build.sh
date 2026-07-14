#!/bin/bash
# templates/ 配下の *.html を全て chrome headless で PDF 化する。
# 画像を相対パスで読むため、templates/ をルートに小さな HTTP サーバを立てて file:// ではなく http:// で開く。
#
#   ./build.sh                # 全 HTML をビルド
#   ./build.sh labor-supply   # 指定モデルだけビルド (templates/ 配下のサブディレクトリ名)
#
# 依存: python3 (http.server), Google Chrome (macOS)

set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
TEMPLATES="$HERE/templates"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT=8767

if [ ! -x "$CHROME" ]; then
  echo "chrome not found at: $CHROME"
  exit 1
fi

# 既存の同ポートサーバを掃除
pkill -f "python3 -m http.server $PORT" 2>/dev/null || true
sleep 0.3

# サーバ起動 (templates/ をルート)
cd "$TEMPLATES"
python3 -m http.server "$PORT" > /dev/null 2>&1 &
SERVER_PID=$!
trap "kill $SERVER_PID 2>/dev/null" EXIT
sleep 0.5

# 対象を集める
FILTER="${1:-}"
if [ -n "$FILTER" ]; then
  SCOPE="$TEMPLATES/$FILTER"
else
  SCOPE="$TEMPLATES"
fi

count=0
while IFS= read -r html; do
  rel="${html#$TEMPLATES/}"
  pdf="${html%.html}.pdf"
  echo "→ $rel"
  "$CHROME" \
    --headless --disable-gpu --no-sandbox \
    --print-to-pdf="$pdf" \
    --print-to-pdf-no-header --no-pdf-header-footer --hide-scrollbars \
    --virtual-time-budget=8000 \
    "http://localhost:$PORT/$rel" > /dev/null 2>&1
  count=$((count + 1))
done < <(find "$SCOPE" -type f -name '*.html' | sort)

echo "done. $count file(s) built."
