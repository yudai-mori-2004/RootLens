// MacOsBlur Swift CLI の subprocess wrapper。
//
// 既存 tools/macos-blur/ で build 済のバイナリを呼ぶ。 Apple Vision
// VNDetectFaceRectanglesRequest revision 3 でフレームごとに顔検出 + 拡張 + Gaussian blur。
// H.264 出力。
//
// stdout に 1 行 JSON が返る (= `outputUri`, `durationMs`, `framesProcessed`, `facesBlurred`,
// `inputBytes`, `outputBytes`, `outputWidth`, `outputHeight`)。

use anyhow::{anyhow, Context, Result};
use serde::Deserialize;
use std::path::{Path, PathBuf};
use std::process::Command;

/// MacOsBlur バイナリの既定パス。 build しなおしたら更新が必要。
/// 起動時に存在チェック → 無ければ修復方法を即座に提示する fail-loud な runtime error。
const MACOS_BLUR_BIN: &str =
    "/Users/forest/WebCreations/root-lens/tools/macos-blur/.build/arm64-apple-macosx/release/MacOsBlur";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlurResult {
    pub output_uri: String,
    pub duration_ms: f64,
    pub frames_processed: u32,
    pub faces_blurred: u32,
    pub input_bytes: u64,
    pub output_bytes: u64,
    pub output_width: u32,
    pub output_height: u32,
}

/// macos_blur バイナリのパス。 環境変数 ROOTLENS_MACOS_BLUR_BIN で override 可。
fn binary_path() -> PathBuf {
    std::env::var("ROOTLENS_MACOS_BLUR_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|_| PathBuf::from(MACOS_BLUR_BIN))
}

/// 顔ぼかし。 同期実行で stdout の JSON を返す。
pub fn blur_faces<P: AsRef<Path>>(input_mp4: P, output_mp4: P) -> Result<BlurResult> {
    let bin = binary_path();
    if !bin.exists() {
        return Err(anyhow!(
            "MacOsBlur binary not found at {}. Build it first: cd tools/macos-blur && swift build -c release",
            bin.display()
        ));
    }

    let output = Command::new(&bin)
        .arg("--input")
        .arg(input_mp4.as_ref())
        .arg("--output")
        .arg(output_mp4.as_ref())
        .arg("--quiet")
        .output()
        .with_context(|| format!("run MacOsBlur at {}", bin.display()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(anyhow!("MacOsBlur failed: {stderr}"));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let result: BlurResult = serde_json::from_str(stdout.trim())
        .with_context(|| format!("parse MacOsBlur JSON output: {stdout}"))?;

    Ok(result)
}
