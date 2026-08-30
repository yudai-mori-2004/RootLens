#!/usr/bin/env bash
set -euo pipefail

ADB_BIN=${ADB_BIN:-adb}
STOCK_PACKAGE=com.mentra.asg_client
FORK_PACKAGE=com.mentra.asg_client.thirdparty
ASG_ACTIVITY=com.mentra.asg_client.MainActivity
ASG_SERVICE=com.mentra.asg_client.service.core.AsgClientService

if ! "$ADB_BIN" get-state 2>/dev/null | grep -qx device; then
  echo "error: exactly one authorized ADB device must be connected" >&2
  exit 1
fi
if [[ -z $("$ADB_BIN" shell pm path "$STOCK_PACKAGE" 2>/dev/null) ]]; then
  echo "error: stock ASG is not installed" >&2
  exit 1
fi

"$ADB_BIN" shell am force-stop "$FORK_PACKAGE" >/dev/null 2>&1 || true
"$ADB_BIN" shell pm disable-user --user 0 "$FORK_PACKAGE" >/dev/null 2>&1 || true
"$ADB_BIN" shell pm enable "$STOCK_PACKAGE"
"$ADB_BIN" shell pm clear-package-preferred-activities "$FORK_PACKAGE" >/dev/null 2>&1 || true
"$ADB_BIN" shell pm clear-package-preferred-activities "$STOCK_PACKAGE" >/dev/null 2>&1 || true
"$ADB_BIN" shell cmd package set-home-activity --user 0 "$STOCK_PACKAGE/$ASG_ACTIVITY"
"$ADB_BIN" shell am start -n "$STOCK_PACKAGE/$ASG_ACTIVITY"

for _ in {1..20}; do
  if "$ADB_BIN" shell dumpsys activity services "$STOCK_PACKAGE/$ASG_SERVICE" \
      | grep -q 'ServiceRecord'; then
    echo "Stock ASG is active; fork remains installed and disabled"
    exit 0
  fi
  sleep 1
done

echo "error: stock ASG service did not become healthy" >&2
exit 1
