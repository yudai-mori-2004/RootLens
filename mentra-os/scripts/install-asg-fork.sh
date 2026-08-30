#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <asg fork debug APK>" >&2
  exit 2
fi

ASG_APK=$1
ADB_BIN=${ADB_BIN:-adb}
STOCK_PACKAGE=com.mentra.asg_client
FORK_PACKAGE=com.mentra.asg_client.thirdparty
ASG_ACTIVITY=com.mentra.asg_client.MainActivity
ASG_SERVICE=com.mentra.asg_client.service.core.AsgClientService
SWITCH_COMPLETE=false

if [[ ! -f "$ASG_APK" ]]; then
  echo "error: APK not found: $ASG_APK" >&2
  exit 1
fi
if ! "$ADB_BIN" get-state 2>/dev/null | grep -qx device; then
  echo "error: exactly one authorized ADB device must be connected" >&2
  exit 1
fi
if [[ -z $("$ADB_BIN" shell pm path "$STOCK_PACKAGE" 2>/dev/null) ]]; then
  echo "error: stock ASG is not installed; refusing an unsafe switch" >&2
  exit 1
fi

rollback() {
  if [[ "$SWITCH_COMPLETE" == true ]]; then
    return
  fi
  echo "ASG switch did not complete; restoring stock control plane" >&2
  "$ADB_BIN" shell am force-stop "$FORK_PACKAGE" >/dev/null 2>&1 || true
  "$ADB_BIN" shell pm enable "$STOCK_PACKAGE" >/dev/null 2>&1 || true
  "$ADB_BIN" shell cmd package set-home-activity --user 0 \
    "$STOCK_PACKAGE/$ASG_ACTIVITY" >/dev/null 2>&1 || true
  "$ADB_BIN" shell am start -n "$STOCK_PACKAGE/$ASG_ACTIVITY" >/dev/null 2>&1 || true
}
trap rollback EXIT

# Install and validate the coexistence package before touching the running stock owner.
"$ADB_BIN" install -r -g "$ASG_APK"
if [[ -z $("$ADB_BIN" shell pm path "$FORK_PACKAGE" 2>/dev/null) ]]; then
  echo "error: fork package did not install" >&2
  exit 1
fi

for PERMISSION in \
  android.permission.CAMERA \
  android.permission.RECORD_AUDIO \
  android.permission.ACCESS_FINE_LOCATION \
  android.permission.ACCESS_COARSE_LOCATION \
  android.permission.ACCESS_BACKGROUND_LOCATION \
  android.permission.READ_EXTERNAL_STORAGE \
  android.permission.WRITE_EXTERNAL_STORAGE \
  android.permission.READ_PHONE_STATE; do
  "$ADB_BIN" shell pm grant "$FORK_PACKAGE" "$PERMISSION" >/dev/null 2>&1 || true
done

# Only one process may own the K900 UART. Disable stock before the first fork launch.
"$ADB_BIN" shell pm disable-user --user 0 "$STOCK_PACKAGE"
"$ADB_BIN" shell pm enable "$FORK_PACKAGE" >/dev/null 2>&1 || true
"$ADB_BIN" shell pm clear-package-preferred-activities "$STOCK_PACKAGE" >/dev/null 2>&1 || true
"$ADB_BIN" shell pm clear-package-preferred-activities "$FORK_PACKAGE" >/dev/null 2>&1 || true
"$ADB_BIN" shell cmd package set-home-activity --user 0 "$FORK_PACKAGE/$ASG_ACTIVITY"
"$ADB_BIN" shell am start -n "$FORK_PACKAGE/$ASG_ACTIVITY"

for _ in {1..20}; do
  if "$ADB_BIN" shell dumpsys activity services "$FORK_PACKAGE/$ASG_SERVICE" \
      | grep -q 'ServiceRecord'; then
    SWITCH_COMPLETE=true
    break
  fi
  sleep 1
done

if [[ "$SWITCH_COMPLETE" != true ]]; then
  echo "error: fork ASG service did not become healthy" >&2
  exit 1
fi

trap - EXIT
echo "ASG fork is active; stock remains installed and disabled"
