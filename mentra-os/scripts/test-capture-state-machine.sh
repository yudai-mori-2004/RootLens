#!/usr/bin/env bash
set -euo pipefail

script_directory=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
project_directory=$(cd "${script_directory}/.." && pwd)
output_directory="${project_directory}/app/build/state-machine-test"

mkdir -p "$output_directory"
javac -d "$output_directory" \
  "${project_directory}/app/src/main/java/io/rootlens/mentra/AppContract.java" \
  "${project_directory}/app/src/main/java/io/rootlens/mentra/CaptureSessionReducer.java" \
  "${project_directory}/app/src/test/java/io/rootlens/mentra/CaptureSessionReducerTest.java"
java -cp "$output_directory" io.rootlens.mentra.CaptureSessionReducerTest
