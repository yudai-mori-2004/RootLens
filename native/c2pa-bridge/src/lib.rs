/// c2pa-bridge: C2PA署名のC FFIラッパー
/// 仕様書 §4.6 C2PA SDK統合
///
/// React Native → ネイティブモジュール(Kotlin/Swift) → C FFI → c2pa-rs
///
/// 開発用: ソフトウェア秘密鍵で署名。将来はTEEコールバックに置き換え。

use std::ffi::{CStr, CString};
use std::fs;
use std::os::raw::c_char;


/// ファイル拡張子からMIMEタイプを推定する
/// c2pa-rsのBuilder::signに渡すフォーマット識別に使用
fn mime_from_path(path: &str) -> &'static str {
    let lower = path.to_lowercase();
    if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        "image/jpeg"
    } else if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else if lower.ends_with(".heic") {
        "image/heic"
    } else if lower.ends_with(".heif") {
        "image/heif"
    } else if lower.ends_with(".avif") {
        "image/avif"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".tif") || lower.ends_with(".tiff") {
        "image/tiff"
    } else if lower.ends_with(".mp4") || lower.ends_with(".m4v") {
        "video/mp4"
    } else if lower.ends_with(".mov") {
        "video/quicktime"
    } else if lower.ends_with(".avi") {
        "video/avi"
    } else if lower.ends_with(".wav") {
        "audio/wav"
    } else if lower.ends_with(".mp3") {
        "audio/mpeg"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else {
        // フォールバック: JPEG として扱う
        "image/jpeg"
    }
}

// --- TEEコールバック署名 (§4.6) ---

/// 署名コールバック関数の型
/// data: 署名対象データ
/// data_len: dataの長さ
/// sig_out: 署名出力バッファ（呼び出し側が確保）
/// sig_out_len: 入力=バッファサイズ、出力=実際の署名サイズ
/// context: 不透明コンテキストポインタ
/// 戻り値: 0=成功, その他=エラー
pub type CSignFn = extern "C" fn(
    data: *const u8,
    data_len: u32,
    sig_out: *mut u8,
    sig_out_len: *mut u32,
    context: *mut std::ffi::c_void,
) -> i32;

/// TEEコールバックを使用したC2PA署名
///
/// 秘密鍵をRust側に渡さず、コールバック関数経由でTEE内で署名する。
/// 仕様書 §4.6: Signerトレイトのカスタム実装 → TEE API
///
/// 関数名に「image」が残っているが、内部では `mime_from_path()` で input_path の
/// 拡張子から MIME を決定するため、JPEG (image/jpeg) でも MP4 (video/mp4) でも同じ FFI で署名できる。
/// MP4 / MOV では c2pa-rs が自動的に BMFF v3 hash + uuid box JUMBF を埋め込む (Task 03)。
///
/// v0.1.1 で `assertions_json` を追加: ネイティブ層から任意の C2PA assertion
/// (label + data) を JSON 配列で渡し、c2pa.actions.created に追加する形で manifest に注入する。
///
/// # Arguments
/// * `input_path` - 入力メディアファイルのパス
/// * `output_path` - 出力先パス
/// * `certs_der` - DER証明書の連結バイト列 (Device Cert + Root CA)
/// * `cert_sizes` - 各証明書のサイズ配列
/// * `cert_count` - 証明書の数
/// * `sign_fn` - TEE署名コールバック
/// * `sign_ctx` - コールバック用コンテキスト
/// * `tsa_url` - RFC 3161 TSAのURL（NULLの場合タイムスタンプなし）
/// * `assertions_json` - 追加 assertion の JSON 配列 (`[{"label":..., "data":...}, ...]`).
///                       NULL または空配列なら追加なし。
///
/// # Returns
/// * 0: 成功, -1: 引数エラー, -2: 署名エラー, -3: その他
#[no_mangle]
pub extern "C" fn c2pa_sign_image_tee(
    input_path: *const c_char,
    output_path: *const c_char,
    certs_der: *const u8,
    cert_sizes: *const u32,
    cert_count: u32,
    sign_fn: CSignFn,
    sign_ctx: *mut std::ffi::c_void,
    tsa_url: *const c_char,
    assertions_json: *const c_char,
) -> i32 {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        sign_image_tee_inner(
            input_path, output_path, certs_der, cert_sizes, cert_count,
            sign_fn, sign_ctx, tsa_url, assertions_json,
        )
    }));
    match result {
        Ok(r) => r,
        Err(_) => -3,
    }
}

fn sign_image_tee_inner(
    input_path: *const c_char,
    output_path: *const c_char,
    certs_der: *const u8,
    cert_sizes: *const u32,
    cert_count: u32,
    sign_fn: CSignFn,
    sign_ctx: *mut std::ffi::c_void,
    tsa_url: *const c_char,
    assertions_json: *const c_char,
) -> i32 {
    let input = match unsafe_cstr_to_str(input_path) {
        Some(s) => s,
        None => return -1,
    };
    let output = match unsafe_cstr_to_str(output_path) {
        Some(s) => s,
        None => return -1,
    };

    if certs_der.is_null() || cert_sizes.is_null() || cert_count == 0 {
        return -1;
    }

    // DER証明書を分割
    let mut certs: Vec<Vec<u8>> = Vec::new();
    let sizes = unsafe { std::slice::from_raw_parts(cert_sizes, cert_count as usize) };
    let mut offset: usize = 0;
    for &size in sizes {
        let s = size as usize;
        let cert_data =
            unsafe { std::slice::from_raw_parts(certs_der.add(offset), s) };
        certs.push(cert_data.to_vec());
        offset += s;
    }

    let tsa = unsafe_cstr_to_str(tsa_url);

    // assertions_json をパース (NULL / 空文字列は空配列扱い)
    let extra_assertions: Vec<serde_json::Value> = match unsafe_cstr_to_str(assertions_json) {
        Some(s) if !s.is_empty() => match serde_json::from_str::<serde_json::Value>(&s) {
            Ok(serde_json::Value::Array(arr)) => arr,
            Ok(_) => {
                eprintln!("c2pa_sign_image_tee: assertions_json is not a JSON array");
                return -1;
            }
            Err(e) => {
                eprintln!("c2pa_sign_image_tee: assertions_json parse error: {e}");
                return -1;
            }
        },
        _ => Vec::new(),
    };

    match do_sign_tee(&input, &output, certs, sign_fn, sign_ctx, tsa, extra_assertions) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("c2pa_sign_image_tee error: {e}");
            -2
        }
    }
}

/// TEEコールバックSignerの実装
struct CallbackSigner {
    certs: Vec<Vec<u8>>,
    sign_fn: CSignFn,
    sign_ctx: *mut std::ffi::c_void,
    tsa_url: Option<String>,
}

// sign_ctxは単一スレッドからのみ使用される（c2pa-rsのBuilder::signは同期的）
unsafe impl Send for CallbackSigner {}
unsafe impl Sync for CallbackSigner {}

impl c2pa::Signer for CallbackSigner {
    fn sign(&self, data: &[u8]) -> c2pa::Result<Vec<u8>> {
        // ES256署名は最大72バイト（DER形式）
        let mut sig_buf = vec![0u8; 128];
        let mut sig_len: u32 = sig_buf.len() as u32;

        let ret = (self.sign_fn)(
            data.as_ptr(),
            data.len() as u32,
            sig_buf.as_mut_ptr(),
            &mut sig_len,
            self.sign_ctx,
        );

        if ret != 0 {
            return Err(c2pa::Error::OtherError(
                Box::new(std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("TEE sign callback failed with code {ret}"),
                ))
            ));
        }

        sig_buf.truncate(sig_len as usize);
        Ok(sig_buf)
    }

    fn alg(&self) -> c2pa::SigningAlg {
        c2pa::SigningAlg::Es256
    }

    fn certs(&self) -> c2pa::Result<Vec<Vec<u8>>> {
        Ok(self.certs.clone())
    }

    fn reserve_size(&self) -> usize {
        // C2PAマニフェスト内の署名予約サイズ
        // 証明書チェーン + COSE構造 + タイムスタンプ用の余裕
        10240
    }

    /// 仕様書 §4.5.3 RFC 3161タイムスタンプ
    fn time_authority_url(&self) -> Option<String> {
        self.tsa_url.clone()
    }

    /// TSAリクエストの自前実装
    ///
    /// c2pa-rs 0.78.0 のデフォルト `send_timestamp_request` は、内部の HTTP
    /// リゾルバ (`SyncGenericResolver`) 経由で TSA にリクエストするが、
    /// Android クロスコンパイル環境ではこのリゾルバが正常に動作しないことが
    /// 判明した（HTTP 200 が返るにも関わらずタイムスタンプが COSE 署名に
    /// 埋め込まれない）。
    ///
    /// 原因: c2pa-rs 内部の `Signer::send_timestamp_request` デフォルト実装と
    /// c2pa-crypto の `TimeStampProvider::send_time_stamp_request` の間で
    /// レスポンスが正しく伝搬されていない可能性がある。
    ///
    /// 対策: ureq を直接使用して RFC 3161 リクエストを送信し、生の
    /// TimeStampResp バイト列を返す。c2pa-rs は返されたバイト列を
    /// COSE unprotected header の sigTst2 に埋め込む。
    fn send_timestamp_request(&self, message: &[u8]) -> Option<c2pa::Result<Vec<u8>>> {
        let url = self.time_authority_url()?;
        let body = self.timestamp_request_body(message).ok()?;

        match ureq::post(&url)
            .header("Content-Type", "application/timestamp-query")
            .send(&body[..])
        {
            Ok(resp) => {
                if resp.status() == 200 {
                    match resp.into_body().read_to_vec() {
                        Ok(buf) => Some(Ok(buf)),
                        Err(e) => Some(Err(c2pa::Error::OtherError(Box::new(e)))),
                    }
                } else {
                    Some(Err(c2pa::Error::OtherError(Box::new(
                        std::io::Error::new(
                            std::io::ErrorKind::Other,
                            format!("TSA HTTP {}", resp.status()),
                        ),
                    ))))
                }
            }
            Err(e) => Some(Err(c2pa::Error::OtherError(Box::new(
                std::io::Error::new(
                    std::io::ErrorKind::Other,
                    format!("TSA request failed: {e}"),
                ),
            )))),
        }
    }
}

/// C2PA署名の実行 (撮影時署名)
///
/// v0.1.1 で `extra_assertions` を追加:
///   - ネイティブ層から渡された任意の assertion (`io.rootlens.capture.*` 等) を
///     `c2pa.actions` (c2pa.created) と並べて manifest に埋め込む。
///   - manifest は serde_json::Value で動的構築する (文字列テンプレートではない)。
///
/// v0.1.1 で signContentWithParent / parent_path 対応を撤去:
///   - EditScreen が削除されたため、編集時の親マニフェスト参照は不要。
///   - 撮影時署名のみが c2pa-bridge の責務になる。
fn do_sign_tee(
    input_path: &str,
    output_path: &str,
    certs: Vec<Vec<u8>>,
    sign_fn: CSignFn,
    sign_ctx: *mut std::ffi::c_void,
    tsa_url: Option<String>,
    extra_assertions: Vec<serde_json::Value>,
) -> Result<(), Box<dyn std::error::Error>> {
    use c2pa::Builder;
    use serde_json::{json, Value};

    // c2pa.actions (c2pa.created) を先頭に置き、追加 assertion を後続させる
    let mut assertions: Vec<Value> = vec![json!({
        "label": "c2pa.actions",
        "data": {
            "actions": [
                {
                    "action": "c2pa.created",
                    "softwareAgent": {
                        "name": "RootLens",
                        "version": "0.1.1"
                    }
                }
            ]
        }
    })];
    assertions.extend(extra_assertions);

    let manifest = json!({
        "claim_generator_info": [
            {
                "name": "RootLens",
                "version": "0.1.1"
            }
        ],
        "assertions": assertions
    });

    let manifest_json = manifest.to_string();
    let mut builder = Builder::from_json(&manifest_json)?;

    let signer = CallbackSigner {
        certs,
        sign_fn,
        sign_ctx,
        tsa_url,
    };

    let mut source = fs::File::open(input_path)?;
    let mut dest = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .open(output_path)?;

    let mime = mime_from_path(input_path);
    builder.sign(&signer, mime, &mut source, &mut dest)?;

    Ok(())
}

// --- レガシー署名（PEMベース、dev/テスト用） ---

/// C2PA署名を実行する（レガシー: PEMベースのソフトウェア署名）
///
/// # Arguments
/// * `input_path` - 入力メディアファイルのパス (null-terminated UTF-8)
/// * `output_path` - 出力先パス (null-terminated UTF-8)
/// * `cert_chain_pem` - 証明書チェーン PEM (Device Cert + Root CA)
/// * `private_key_pem` - 秘密鍵 PEM
///
/// # Returns
/// * 0: 成功
/// * -1: 引数エラー
/// * -2: 署名エラー
/// * -3: その他のエラー
#[no_mangle]
pub extern "C" fn c2pa_sign_image(
    input_path: *const c_char,
    output_path: *const c_char,
    cert_chain_pem: *const c_char,
    private_key_pem: *const c_char,
) -> i32 {
    let result = std::panic::catch_unwind(|| {
        sign_image_inner(input_path, output_path, cert_chain_pem, private_key_pem)
    });
    match result {
        Ok(r) => r,
        Err(_) => -3,
    }
}

fn sign_image_inner(
    input_path: *const c_char,
    output_path: *const c_char,
    cert_chain_pem: *const c_char,
    private_key_pem: *const c_char,
) -> i32 {
    // パラメータの安全な変換
    let input = match unsafe_cstr_to_str(input_path) {
        Some(s) => s,
        None => return -1,
    };
    let output = match unsafe_cstr_to_str(output_path) {
        Some(s) => s,
        None => return -1,
    };
    let cert_pem = match unsafe_cstr_to_str(cert_chain_pem) {
        Some(s) => s,
        None => return -1,
    };
    let key_pem = match unsafe_cstr_to_str(private_key_pem) {
        Some(s) => s,
        None => return -1,
    };

    match do_sign(&input, &output, &cert_pem, &key_pem) {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("c2pa_sign_image error: {e}");
            -2
        }
    }
}

fn unsafe_cstr_to_str(ptr: *const c_char) -> Option<String> {
    if ptr.is_null() {
        return None;
    }
    unsafe { CStr::from_ptr(ptr) }
        .to_str()
        .ok()
        .map(|s| s.to_owned())
}

fn do_sign(
    input_path: &str,
    output_path: &str,
    cert_chain_pem: &str,
    private_key_pem: &str,
) -> Result<(), Box<dyn std::error::Error>> {
    use c2pa::{Builder, SigningAlg, create_signer};

    // 仕様書 §4.5 C2PAマニフェスト
    // - c2pa.created アクション
    // - claim_generator: RootLens
    let manifest_json = r#"{
        "claim_generator_info": [
            {
                "name": "RootLens",
                "version": "0.1.0"
            }
        ],
        "assertions": [
            {
                "label": "c2pa.actions",
                "data": {
                    "actions": [
                        {
                            "action": "c2pa.created",
                            "softwareAgent": {
                                "name": "RootLens",
                                "version": "0.1.0"
                            }
                        }
                    ]
                }
            }
        ]
    }"#;

    let mut builder = Builder::from_json(manifest_json)?;

    // 仕様書 §4.2: ES256 (ECDSA P-256 with SHA-256)
    let signer = create_signer::from_keys(
        cert_chain_pem.as_bytes(),
        private_key_pem.as_bytes(),
        SigningAlg::Es256,
        None, // タイムスタンプなし（§4.5.3: オフライン時はなし）
    )?;

    let mut source = fs::File::open(input_path)?;
    // BMFF (MP4/MOV) 署名ではc2pa-rsが出力ファイルを読み書き両方するため
    // create() (write-only) ではなく read+write で開く
    let mut dest = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(true)
        .open(output_path)?;

    let mime = mime_from_path(input_path);
    builder.sign(signer.as_ref(), mime, &mut source, &mut dest)?;

    Ok(())
}

/// C2PAマニフェストを読み取る
///
/// # Arguments
/// * `input_path` - 入力画像のパス (null-terminated UTF-8)
///
/// # Returns
/// * JSON文字列のポインタ (c2pa_free_stringで解放すること)
/// * NULL: 致命的エラー
///
/// 返却JSON:
/// - has_manifest: bool
/// - is_valid: bool (暗号検証に致命的失敗がないか。mismatch系がなければtrue)
/// - signer_common_name: string (署名者のCN)
/// - signer_org: string (署名者のO)
/// - claim_generator: string
/// - validation_status: array (検証結果。untrustedは想定内)
#[no_mangle]
pub extern "C" fn c2pa_read_manifest(
    input_path: *const c_char,
) -> *mut c_char {
    let result = std::panic::catch_unwind(|| {
        read_manifest_inner(input_path)
    });
    let json = match result {
        Ok(s) => s,
        Err(_) => r#"{"has_manifest":false,"error":"panic"}"#.to_string(),
    };
    CString::new(json)
        .map(|cs| cs.into_raw())
        .unwrap_or(std::ptr::null_mut())
}

fn read_manifest_inner(input_path: *const c_char) -> String {
    let input = match unsafe_cstr_to_str(input_path) {
        Some(s) => s,
        None => return r#"{"has_manifest":false,"error":"invalid input path"}"#.to_string(),
    };

    match do_read_manifest(&input) {
        Ok(json) => json,
        Err(e) => {
            eprintln!("c2pa_read_manifest error: {e}");
            let err_msg = format!("{e}").replace('\\', "\\\\").replace('"', "\\\"");
            format!(r#"{{"has_manifest":false,"error":"{}"}}"#, err_msg)
        }
    }
}

fn do_read_manifest(input_path: &str) -> Result<String, Box<dyn std::error::Error>> {
    use c2pa::Reader;
    use std::io::Cursor;

    let data = fs::read(input_path)?;

    let format = mime_from_path(input_path);

    let reader = match Reader::from_stream(format, Cursor::new(data)) {
        Ok(r) => r,
        Err(e) => {
            let err_str = format!("{e}");
            // JumbfNotFound = ファイルにC2PAマニフェストがない
            if err_str.contains("Jumbf")
                || err_str.contains("not found")
                || err_str.contains("No JUMBF")
            {
                return Ok(r#"{"has_manifest":false}"#.to_string());
            }
            return Err(e.into());
        }
    };

    // Reader::json() でフルマニフェストJSONを取得してパース
    let json_str = reader.json();
    let raw: serde_json::Value = serde_json::from_str(&json_str)?;

    // アクティブマニフェストから情報を抽出
    let active_label = raw
        .get("active_manifest")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let manifest = raw
        .get("manifests")
        .and_then(|m| m.get(active_label));

    let (claim_generator, signer_cn, signer_org) = match manifest {
        Some(m) => {
            // claim_generator_info は配列: [{"name": "RootLens", "version": "0.1.0", ...}]
            let cg = m
                .get("claim_generator_info")
                .and_then(|v| v.as_array())
                .and_then(|arr| arr.first())
                .and_then(|info| info.get("name"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let sig_info = m.get("signature_info");

            // common_name は signature_info 直下のフィールド
            let cn = sig_info
                .and_then(|si| si.get("common_name"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            // issuer は署名証明書の発行者CAの O (Organization) が入っている
            // Dev: "RootLens Dev", Prod: "RootLens"
            // TODO: 署名証明書自体のsubject Oを取得するように改善する
            let org = sig_info
                .and_then(|si| si.get("issuer"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            (cg.to_string(), cn.to_string(), org.to_string())
        }
        None => (String::new(), String::new(), String::new()),
    };

    let validation_status = raw
        .get("validation_status")
        .cloned()
        .unwrap_or(serde_json::Value::Array(vec![]));

    // 暗号検証の判定: mismatch/failure 系のコードがあれば検証失敗
    // signingCredential.untrusted はtrust anchor未設定時に出るため無視する（自前で信頼判定する）
    let is_valid = validation_status
        .as_array()
        .map(|arr| {
            !arr.iter().any(|entry| {
                let code = entry.get("code").and_then(|v| v.as_str()).unwrap_or("");
                code.contains("mismatch") || code.contains("failure")
            })
        })
        .unwrap_or(false);

    let result = serde_json::json!({
        "has_manifest": true,
        "is_valid": is_valid,
        "signer_common_name": signer_cn,
        "signer_org": signer_org,
        "claim_generator": claim_generator,
        "validation_status": validation_status
    });

    Ok(result.to_string())
}

/// バージョン文字列を返す
///
/// 返されたポインタは呼び出し側で `c2pa_free_string` で解放すること。
#[no_mangle]
pub extern "C" fn c2pa_get_version() -> *mut c_char {
    let version = format!("c2pa-bridge {}, c2pa-rs {}", env!("CARGO_PKG_VERSION"), "0.78");
    CString::new(version).unwrap().into_raw()
}

/// `c2pa_get_version` で返された文字列を解放する
#[no_mangle]
pub extern "C" fn c2pa_free_string(s: *mut c_char) {
    if !s.is_null() {
        unsafe {
            let _ = CString::from_raw(s);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sign_jpeg() {
        let cert_chain = fs::read_to_string(
            concat!(env!("CARGO_MANIFEST_DIR"), "/../../app/dev-certs/dev-chain.pem"),
        )
        .expect("dev-chain.pem not found. Run scripts/gen-dev-certs.sh first.");

        let private_key = fs::read_to_string(
            concat!(env!("CARGO_MANIFEST_DIR"), "/../../app/dev-certs/dev-device-key.pem"),
        )
        .expect("dev-device-key.pem not found");

        let input = "/tmp/test_c2pa_input.jpg";
        let output = "/tmp/test_c2pa_output.jpg";

        assert!(
            std::path::Path::new(input).exists(),
            "テスト用JPEGが必要: sips -s format jpeg -z 100 100 \"/System/Library/Desktop Pictures/Solid Colors/Black.png\" --out {input}"
        );

        let result = do_sign(input, output, &cert_chain, &private_key);
        match &result {
            Ok(()) => println!("署名成功"),
            Err(e) => println!("署名エラー: {e}"),
        }
        assert!(result.is_ok(), "署名に失敗: {:?}", result.err());

        let out_meta = fs::metadata(output).unwrap();
        let in_meta = fs::metadata(input).unwrap();
        assert!(
            out_meta.len() > in_meta.len(),
            "出力ファイルが入力より大きいはず（C2PAマニフェスト分）"
        );

        println!(
            "入力: {} bytes, 出力: {} bytes",
            in_meta.len(),
            out_meta.len()
        );
    }
}
