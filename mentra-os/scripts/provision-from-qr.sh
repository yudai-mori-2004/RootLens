#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 /path/to/account-qr.png" >&2
  exit 2
fi

account_qr=$1
adb_bin=${ROOTLENS_ADB:-/Users/forest/Library/Android/sdk/platform-tools/adb}
package_name=${ROOTLENS_MENTRA_PACKAGE:-io.rootlens.mentra.debug}
temporary_file=$(mktemp -t rootlens-mentra-account.XXXXXX)
trap 'rm -f "$temporary_file"' EXIT
chmod 600 "$temporary_file"

python3 - "$account_qr" "$temporary_file" <<'PY'
import cv2
import json
import os
import sys
from urllib.parse import parse_qs, urlparse

qr_path, output_path = sys.argv[1:]
image = cv2.imread(qr_path)
if image is None:
    raise SystemExit("Could not read account QR")
value, _, _ = cv2.QRCodeDetector().detectAndDecode(image)
parsed = urlparse(value)
query = parse_qs(parsed.query)
login_id = query.get("id", [""])[0]
password = query.get("pw", [""])[0]
if parsed.scheme != "io.rootlens.app" or parsed.netloc != "login":
    raise SystemExit("QR is not a RootLens login code")
if not login_id or not password:
    raise SystemExit("QR has no login credentials")
with open(output_path, "w", encoding="utf-8") as output:
    json.dump({"login_id": login_id, "password": password}, output)
os.chmod(output_path, 0o600)
PY

device_directory="/sdcard/Android/data/${package_name}/files/provisioning"
"$adb_bin" shell mkdir -p "$device_directory" >/dev/null
"$adb_bin" shell rm -f "$device_directory/status.json" >/dev/null
"$adb_bin" push "$temporary_file" "$device_directory/account.json" >/dev/null
"$adb_bin" shell am start-foreground-service \
  -a io.rootlens.mentra.PROVISION_ACCOUNT \
  -n "${package_name}/io.rootlens.mentra.AccountProvisioningService" >/dev/null

for _ in $(seq 1 30); do
  status=$("$adb_bin" shell cat "$device_directory/status.json" 2>/dev/null || true)
  if [[ "$status" == *'"state": "signed_in"'* ]]; then
    login_id=$(python3 -c 'import json,sys; print(json.load(sys.stdin)["login_id"])' <<<"$status")
    echo "Mentra signed in as ${login_id}"
    exit 0
  fi
  if [[ "$status" == *'"state": "error"'* ]]; then
    echo "Mentra sign-in failed; inspect provisioning/status.json" >&2
    exit 1
  fi
  sleep 1
done

echo "Mentra sign-in timed out" >&2
exit 1
