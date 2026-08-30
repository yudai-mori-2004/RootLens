#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" == "Darwin" && -z "${ADB_LIBUSB+x}" ]]; then
  export ADB_LIBUSB=0
fi

adb_bin=${ROOTLENS_ADB:-/Users/forest/Library/Android/sdk/platform-tools/adb}
package_name=${ROOTLENS_MENTRA_PACKAGE:-io.rootlens.mentra.debug}
service_component="${package_name}/io.rootlens.mentra.CaptureService"
since=$($adb_bin shell date '+%s.000')

send_capture_command() {
  $adb_bin shell run-as "$package_name" am start-foreground-service --user 0 \
    -a "$1" -n "$service_component" "${@:2}"
}

send_capture_command io.rootlens.mentra.START --ei duration_seconds 30
send_capture_command io.rootlens.mentra.STOP
sleep 2

transitions=$($adb_bin logcat -d -T "$since" -v epoch -s RootLensService:I '*:S')
camera_state=$($adb_bin shell dumpsys media.camera)

if [[ "$transitions" != *"IDLE --START--> START_PENDING"* ]]; then
  echo "Missing IDLE -> START_PENDING transition" >&2
  echo "$transitions" >&2
  exit 1
fi
if [[ "$transitions" != *"START_PENDING --STOP--> SUCCEEDED"* ]]; then
  echo "Missing START_PENDING -> SUCCEEDED transition" >&2
  echo "$transitions" >&2
  exit 1
fi
if [[ "$transitions" == *"--OPEN_TIMER-->"* ]]; then
  echo "A stale open timer changed state after STOP" >&2
  echo "$transitions" >&2
  exit 1
fi
if [[ "$camera_state" != *$'Active Camera Clients:\n[]'* ]]; then
  echo "Camera remained active after START/STOP race test" >&2
  exit 1
fi

echo "$transitions"
echo "Device START/STOP race test passed"

since=$($adb_bin shell date '+%s.000')
start_command_id="rootlens-dedup-start-${since}"
stop_command_id="rootlens-dedup-stop-${since}"

send_capture_command io.rootlens.mentra.TOGGLE --es command_id "$start_command_id"
send_capture_command io.rootlens.mentra.TOGGLE --es command_id "$start_command_id"
sleep 3
send_capture_command io.rootlens.mentra.TOGGLE --es command_id "$stop_command_id"
sleep 3

transitions=$($adb_bin logcat -d -T "$since" -v epoch -s RootLensService:I '*:S')
camera_state=$($adb_bin shell dumpsys media.camera)

if [[ "$transitions" != *"RECORDING --STOP--> FINALIZING"* \
      || "$transitions" != *"FINALIZING --SEGMENT_COMPLETED--> SUCCEEDED"* ]]; then
  echo "The duplicate toggle stopped capture, or the unique stop did not complete it" >&2
  echo "$transitions" >&2
  exit 1
fi
if [[ "$camera_state" != *$'Active Camera Clients:\n[]'* ]]; then
  echo "Camera remained active after command deduplication test" >&2
  exit 1
fi

echo "$transitions"
echo "Device command deduplication test passed"
