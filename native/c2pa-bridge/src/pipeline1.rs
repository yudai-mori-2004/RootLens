// Pipeline 1 (= iOS デバイス側 C2PA 処理) の Rust 実装。
//
// `tools/mock-device/src/{c2pa_sign,content_id}.rs` を 1 つにまとめて、
// C FFI として iOS の C2paBridgeModule から呼べる形にしたもの。 mock-device と完全
// 同一の出力 (= byte-deterministic) を作るのが目的。
//
// FFI 関数:
//   - pipeline1_sign_d1(input_mp4, output_mp4)            → i32 (0=ok)
//   - pipeline1_sign_d2(blurred_mp4, parent_d1_mp4,
//                       output_mp4, faces_blurred)        → i32 (0=ok)
//   - pipeline1_content_id(input_mp4) -> *mut c_char
//                                       ("sha256:<hex>" / NULL on error)
//
// 鍵 / cert は mock-device と同じ dev fixture (= Title Protocol test EE + Test CA)
// を include_bytes! でバンドル。 production は Secure Enclave callback signer に
// 差し替える前提だが、 v0.1.3 ではこの dev fixture で十分。

use std::ffi::{CStr, CString};
use std::fs::{File, OpenOptions};
use std::io::Cursor;
use std::os::raw::c_char;
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::pipeline1_jumbf as jumbf;

const CERTS_PEM: &[u8] = include_bytes!("../fixtures/chain.pem");
const KEY_PEM: &[u8] = include_bytes!("../fixtures/ee.key");
const MIME_MP4: &str = "video/mp4";

fn build_d1_manifest(title: &str) -> serde_json::Value {
    serde_json::json!({
        "title": title,
        "format": MIME_MP4,
        "claim_generator_info": [{
            "name": "rootlens-ios",
            "version": "0.1.3"
        }],
        "assertions": [{
            "label": "c2pa.actions.v2",
            "data": {
                "actions": [{
                    "action": "c2pa.created",
                    "softwareAgent": "rootlens-ios (arkit-capture)"
                }]
            }
        }]
    })
}

// D2 manifest。 先頭の `c2pa.opened` (parentOf ingredient を ingredients param に持つ) は
// Builder の intent=Edit が自動挿入する。 C2PA 2.x の「最初の action は created/opened」
// 「opened/placed/removed は ingredients param 必須」を満たすため、 ここでは ingredient 不要な
// `c2pa.edited` のみ宣言する (= 顔ぼかしは編集アクション)。
fn build_d2_manifest(title: &str, faces_blurred: u32) -> serde_json::Value {
    serde_json::json!({
        "title": title,
        "format": MIME_MP4,
        "claim_generator_info": [{
            "name": "rootlens-ios",
            "version": "0.1.3"
        }],
        "assertions": [{
            "label": "c2pa.actions.v2",
            "data": {
                "actions": [{
                    "action": "c2pa.edited",
                    "softwareAgent": "Apple Vision VNDetectFaceRectanglesRequest rev 3",
                    "parameters": {
                        "operation": "face_blur",
                        "regions_blurred": faces_blurred
                    }
                }]
            }
        }]
    })
}

fn make_signer() -> Result<Box<dyn c2pa::Signer + Send + Sync>, String> {
    c2pa::create_signer::from_keys(CERTS_PEM, KEY_PEM, c2pa::SigningAlg::Ed25519, None)
        .map_err(|e| format!("Failed to create ed25519 signer: {e}"))
}

fn sign_d1_impl(input_mp4: &Path, output_mp4: &Path) -> Result<(), String> {
    let title = output_mp4
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("d1.mp4");

    let manifest_json = build_d1_manifest(title).to_string();
    let mut builder = c2pa::Builder::from_context(c2pa::Context::default())
        .with_definition(&manifest_json)
        .map_err(|e| format!("Builder::with_definition (D1) failed: {e}"))?;
    let signer = make_signer()?;

    let mut src = File::open(input_mp4)
        .map_err(|e| format!("open input {}: {e}", input_mp4.display()))?;
    let mut dest = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .open(output_mp4)
        .map_err(|e| format!("create output {}: {e}", output_mp4.display()))?;

    builder
        .sign(signer.as_ref(), MIME_MP4, &mut src, &mut dest)
        .map_err(|e| format!("D1 sign failed: {e}"))?;

    Ok(())
}

fn sign_d2_impl(
    blurred_mp4: &Path,
    parent_d1_mp4: &Path,
    output_mp4: &Path,
    faces_blurred: u32,
) -> Result<(), String> {
    let title = output_mp4
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("d2.mp4");

    let manifest_json = build_d2_manifest(title, faces_blurred).to_string();
    let mut builder = c2pa::Builder::from_context(c2pa::Context::default())
        .with_definition(&manifest_json)
        .map_err(|e| format!("Builder::with_definition (D2) failed: {e}"))?;
    // intent=Edit + parentOf ingredient で、 Builder が先頭に `c2pa.opened`
    // (ingredients param 付き) を自動挿入する (= C2PA 2.x の first-action / ingredient ルール充足)。
    builder.set_intent(c2pa::BuilderIntent::Edit);

    let ingredient_json = serde_json::json!({
        "title": parent_d1_mp4.file_name().and_then(|s| s.to_str()).unwrap_or("d1.mp4"),
        "format": MIME_MP4,
        "relationship": "parentOf"
    })
    .to_string();

    let parent_bytes = std::fs::read(parent_d1_mp4)
        .map_err(|e| format!("read parent D1 {}: {e}", parent_d1_mp4.display()))?;
    let mut parent_cursor = Cursor::new(&parent_bytes);
    builder
        .add_ingredient_from_stream(&ingredient_json, MIME_MP4, &mut parent_cursor)
        .map_err(|e| format!("add_ingredient_from_stream (D1 parent): {e}"))?;

    let signer = make_signer()?;

    let mut src = File::open(blurred_mp4)
        .map_err(|e| format!("open blurred input {}: {e}", blurred_mp4.display()))?;
    let mut dest = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .open(output_mp4)
        .map_err(|e| format!("create output {}: {e}", output_mp4.display()))?;

    builder
        .sign(signer.as_ref(), MIME_MP4, &mut src, &mut dest)
        .map_err(|e| format!("D2 sign failed: {e}"))?;

    Ok(())
}

fn content_id_impl(input_path: &Path) -> Result<String, String> {
    let mut file = File::open(input_path)
        .map_err(|e| format!("open {}: {e}", input_path.display()))?;
    let jumbf_data = c2pa::jumbf_io::load_jumbf_from_stream(MIME_MP4, &mut file)
        .map_err(|e| format!("JUMBF extraction failed: {e}"))?;

    let labels = jumbf::find_manifest_labels(&jumbf_data)
        .map_err(|e| format!("find_manifest_labels: {e}"))?;
    let active_label = labels
        .last()
        .ok_or_else(|| "No manifest found in JUMBF data".to_string())?;

    let signature_bytes = jumbf::extract_signature_from_jumbf(&jumbf_data, active_label)
        .map_err(|e| format!("extract_signature_from_jumbf: {e}"))?;

    let hash = Sha256::digest(&signature_bytes);
    Ok(format!("sha256:{}", hex::encode(hash)))
}

// ─── C FFI exports ─────────────────────────────────────────────────────

unsafe fn cstr_to_path<'a>(ptr: *const c_char) -> Result<&'a Path, String> {
    if ptr.is_null() {
        return Err("null path pointer".to_string());
    }
    let s = CStr::from_ptr(ptr)
        .to_str()
        .map_err(|e| format!("non-UTF8 path: {e}"))?;
    Ok(Path::new(s))
}

/// D1 sign FFI. 0 = success, non-zero = failure.
#[no_mangle]
pub unsafe extern "C" fn pipeline1_sign_d1(
    input_mp4: *const c_char,
    output_mp4: *const c_char,
) -> i32 {
    let input = match cstr_to_path(input_mp4) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[pipeline1_sign_d1] {e}");
            return -1;
        }
    };
    let output = match cstr_to_path(output_mp4) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[pipeline1_sign_d1] {e}");
            return -1;
        }
    };
    match sign_d1_impl(input, output) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("[pipeline1_sign_d1] {e}");
            -2
        }
    }
}

/// D2 sign FFI. 0 = success, non-zero = failure.
#[no_mangle]
pub unsafe extern "C" fn pipeline1_sign_d2(
    blurred_mp4: *const c_char,
    parent_d1_mp4: *const c_char,
    output_mp4: *const c_char,
    faces_blurred: u32,
) -> i32 {
    let blurred = match cstr_to_path(blurred_mp4) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[pipeline1_sign_d2] {e}");
            return -1;
        }
    };
    let parent = match cstr_to_path(parent_d1_mp4) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[pipeline1_sign_d2] {e}");
            return -1;
        }
    };
    let output = match cstr_to_path(output_mp4) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[pipeline1_sign_d2] {e}");
            return -1;
        }
    };
    match sign_d2_impl(blurred, parent, output, faces_blurred) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("[pipeline1_sign_d2] {e}");
            -2
        }
    }
}

/// content_id 抽出 FFI. 戻り値は "sha256:<hex>" の C string、 NULL on error。
/// 呼び出し側は `c2pa_free_string` で解放する。
#[no_mangle]
pub unsafe extern "C" fn pipeline1_content_id(input_mp4: *const c_char) -> *mut c_char {
    let input = match cstr_to_path(input_mp4) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("[pipeline1_content_id] {e}");
            return std::ptr::null_mut();
        }
    };
    match content_id_impl(input) {
        Ok(id) => match CString::new(id) {
            Ok(c) => c.into_raw(),
            Err(_) => std::ptr::null_mut(),
        },
        Err(e) => {
            eprintln!("[pipeline1_content_id] {e}");
            std::ptr::null_mut()
        }
    }
}
