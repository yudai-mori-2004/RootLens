#!/usr/bin/env bash
set -euo pipefail

script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
project_directory=$(cd "${script_directory}/.." && pwd)
output_directory="${project_directory}/app/build/calibration-math-test"

mkdir -p "$output_directory"
javac -d "$output_directory" \
  "${project_directory}/app/src/main/java/io/rootlens/mentra/AppContract.java" \
  "${project_directory}/app/src/main/java/io/rootlens/mentra/FrameMotionEstimator.java" \
  "${project_directory}/app/src/main/java/io/rootlens/mentra/VideoImuOffsetEstimator.java" \
  "${project_directory}/app/src/test/java/io/rootlens/mentra/CalibrationMathTest.java"
java -cp "$output_directory" io.rootlens.mentra.CalibrationMathTest
