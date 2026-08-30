#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" == "Darwin" && -z "${ADB_LIBUSB+x}" ]]; then
  export ADB_LIBUSB=1
fi

adb_bin=${ROOTLENS_ADB:-/Users/forest/Library/Android/sdk/platform-tools/adb}
package_name=${ROOTLENS_MENTRA_PACKAGE:-io.rootlens.mentra.debug}
script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
default_apk="${script_directory}/../app/build/outputs/apk/debug/app-debug.apk"
apk_path=${1:-$default_apk}

if [[ ! -x "$adb_bin" ]]; then
  echo "ADB is not executable: $adb_bin" >&2
  exit 1
fi
if [[ ! -f "$apk_path" ]]; then
  echo "APK not found: $apk_path" >&2
  exit 1
fi

device_count=$("$adb_bin" devices | awk 'NR > 1 && $2 == "device" { count++ } END { print count + 0 }')
if [[ "$device_count" -ne 1 ]]; then
  echo "Expected exactly one online ADB device, found ${device_count}" >&2
  exit 1
fi

"$adb_bin" install -r "$apk_path"
"$adb_bin" shell pm grant "$package_name" android.permission.CAMERA
"$adb_bin" shell pm grant "$package_name" android.permission.RECORD_AUDIO
"$adb_bin" shell appops set "$package_name" SYSTEM_ALERT_WINDOW allow
"$adb_bin" shell cmd deviceidle whitelist "+${package_name}"
"$adb_bin" shell am start -W \
  -a android.intent.action.MAIN \
  -c android.intent.category.LAUNCHER \
  -n "${package_name}/io.rootlens.mentra.MainActivity"

permission_state=$("$adb_bin" shell dumpsys package "$package_name")
overlay_state=$("$adb_bin" shell appops get "$package_name" SYSTEM_ALERT_WINDOW)

if [[ "$permission_state" != *"android.permission.CAMERA: granted=true"* ]]; then
  echo "CAMERA permission was not granted" >&2
  exit 1
fi
if [[ "$permission_state" != *"android.permission.RECORD_AUDIO: granted=true"* ]]; then
  echo "RECORD_AUDIO permission was not granted" >&2
  exit 1
fi
if [[ "$overlay_state" != *"allow"* ]]; then
  echo "SYSTEM_ALERT_WINDOW app-op was not granted" >&2
  exit 1
fi

echo "RootLens action-button capture is installed and armed on ${package_name}"
