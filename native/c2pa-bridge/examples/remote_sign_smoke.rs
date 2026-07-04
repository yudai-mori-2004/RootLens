// リモート署名の E2E smoke (= ホスト macOS で実行)。
//
//   cargo run --example remote_sign_smoke -- <input.mp4> <output.mp4> <sign_service_url> <account_pubkey>
//
// 実サーバ (/api/v1/c2pa-sign) に対して D1 リモート署名を行い、 署名済み mp4 を
// c2pa::Reader で読み戻して manifest / 署名者 / validation 結果を表示する。

use std::ffi::CString;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 5 {
        eprintln!("usage: remote_sign_smoke <input.mp4> <output.mp4> <sign_service_url> <account_pubkey>");
        std::process::exit(2);
    }
    let input = CString::new(args[1].as_str()).unwrap();
    let output = CString::new(args[2].as_str()).unwrap();
    let url = CString::new(args[3].as_str()).unwrap();
    let pubkey = CString::new(args[4].as_str()).unwrap();

    let rc = unsafe {
        c2pa_bridge::pipeline1::pipeline1_sign_d1_remote(
            input.as_ptr(),
            output.as_ptr(),
            url.as_ptr(),
            pubkey.as_ptr(),
        )
    };
    if rc != 0 {
        eprintln!("pipeline1_sign_d1_remote failed rc={rc}");
        std::process::exit(1);
    }
    println!("sign OK → {}", args[2]);

    // signature_hash (= identity) 抽出
    let sig_hash = unsafe { c2pa_bridge::pipeline1::pipeline1_content_id(output.as_ptr()) };
    if sig_hash.is_null() {
        eprintln!("content_id failed");
        std::process::exit(1);
    }
    let hash = unsafe { std::ffi::CStr::from_ptr(sig_hash) }.to_string_lossy().to_string();
    println!("signature_hash: {hash}");

    // Reader で読み戻して検証
    let mut f = std::fs::File::open(&args[2]).expect("open signed mp4");
    let reader = c2pa::Reader::from_context(c2pa::Context::default())
        .with_stream("video/mp4", &mut f)
        .expect("read manifest");
    println!("--- manifest store ---");
    println!("{reader}");
}
