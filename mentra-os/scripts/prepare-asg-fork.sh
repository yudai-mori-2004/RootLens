#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <MentraOS checkout> <Android SDK directory>" >&2
  exit 2
fi

MENTRA_CHECKOUT=$1
ANDROID_SDK_DIR=$2
EXPECTED_COMMIT=9684b3d6b27c789cccc429ccc7d34b7f5526aab9
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
MENTRA_OS_DIR=$(cd "$SCRIPT_DIR/.." && pwd)
PATCH_FILE="$MENTRA_OS_DIR/asg-fork/rootlens-v39.patch"
ASG_DIR="$MENTRA_CHECKOUT/asg_client"

if [[ $(git -C "$MENTRA_CHECKOUT" rev-parse HEAD) != "$EXPECTED_COMMIT" ]]; then
  echo "error: MentraOS checkout must be exactly $EXPECTED_COMMIT (official ASG v39)" >&2
  exit 1
fi
if [[ ! -f "$ASG_DIR/StreamPackLite/core/build.gradle" ]]; then
  echo "error: clone Mentra-Community/StreamPackLite working branch into $ASG_DIR/StreamPackLite" >&2
  exit 1
fi

if git -C "$MENTRA_CHECKOUT" apply --reverse --check "$PATCH_FILE"; then
  echo "RootLens ASG patch is already applied"
else
  if ! git -C "$MENTRA_CHECKOUT" diff --quiet; then
    echo "error: MentraOS checkout has tracked changes" >&2
    exit 1
  fi
  git -C "$MENTRA_CHECKOUT" apply --check "$PATCH_FILE"
  git -C "$MENTRA_CHECKOUT" apply "$PATCH_FILE"
fi

ASSET_DIR="$ASG_DIR/app/src/main/assets/rootlens"
mkdir -p "$ASSET_DIR"
for ASSET_NAME in \
  capture_start \
  capture_stop \
  capture_failed \
  calibration_instructions \
  upload_started \
  upload_complete \
  upload_unavailable; do
  install -m 0644 \
    "$MENTRA_OS_DIR/app/src/main/res/raw/$ASSET_NAME.mp3" \
    "$ASSET_DIR/$ASSET_NAME.mp3"
done

(
  cd "$ASG_DIR"
  ANDROID_HOME="$ANDROID_SDK_DIR" ./gradlew \
    :app:testDebugUnitTest \
    --tests 'com.mentra.asg_client.audio.RootLensFeedbackTest' \
    --tests 'com.mentra.asg_client.audio.FeedbackVolumeControllerTest' \
    --tests 'com.mentra.asg_client.service.core.PeripheralWakeBoundaryTest' \
    --tests 'com.mentra.asg_client.service.core.TouchEventReconcilerTest' \
    --tests 'com.mentra.asg_client.service.core.handlers.RootLensCaptureControlTest' \
    --tests 'com.mentra.asg_client.service.core.handlers.RootLensButtonReducerTest' \
    :app:assembleDebug
)

echo "ASG fork APK: $ASG_DIR/app/build/outputs/apk/debug/app-debug.apk"
