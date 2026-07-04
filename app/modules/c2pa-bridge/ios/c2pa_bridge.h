#ifndef C2PA_BRIDGE_H
#define C2PA_BRIDGE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * TEE署名コールバック関数の型
 */
typedef int32_t (*c2pa_sign_fn)(
    const uint8_t *data,
    uint32_t data_len,
    uint8_t *sig_out,
    uint32_t *sig_out_len,
    void *context
);

/**
 * TEEコールバックを使用したC2PA署名（§4.6）
 *
 * v0.1.1 で `assertions_json` を追加:
 *   - ネイティブ層から任意の C2PA assertion (label + data) を JSON 配列で渡し、
 *     `c2pa.actions` (c2pa.created) と並べて manifest に埋め込む。
 *   - 形式: `[{"label":"io.rootlens.capture...", "data":{...}}, ...]`
 *   - NULL または空文字列なら追加なし。
 */
int32_t c2pa_sign_image_tee(
    const char *input_path,
    const char *output_path,
    const uint8_t *certs_der,
    const uint32_t *cert_sizes,
    uint32_t cert_count,
    c2pa_sign_fn sign_fn,
    void *sign_ctx,
    const char *tsa_url,
    const char *assertions_json
);

/**
 * C2PA署名を実行する（レガシー: PEMベースのソフトウェア署名）
 */
int c2pa_sign_image(
    const char *input_path,
    const char *output_path,
    const char *cert_chain_pem,
    const char *private_key_pem
);

/**
 * C2PAマニフェストを読み取る
 */
char *c2pa_read_manifest(const char *input_path);

/** バージョン文字列を返す。c2pa_free_stringで解放すること */
char *c2pa_get_version(void);

/** c2pa_free_stringで返された文字列を解放する */
void c2pa_free_string(char *s);

/* ─── Pipeline 1 (= D1 署名 / content_id) ─────────────────────────────── */

/**
 * 直近の pipeline1_* 失敗理由 (人間可読)。 c2pa_free_string で解放。 空文字 = エラーなし。
 */
char *pipeline1_last_error(void);

/**
 * D1 リモート署名 (= 本番経路): ハッシュ計算 + manifest 組み立てはローカル、 COSE 署名
 * バイト列だけを sign_service_url (RootLens /api/v1/c2pa-sign) に送って署名を得る。
 * account_pubkey は X-Account-Pubkey header に載る (= 認可)。
 * 戻り値: 0 = 成功, それ以外 = 失敗。
 */
int32_t pipeline1_sign_d1_remote(
    const char *input_mp4,
    const char *output_mp4,
    const char *sign_service_url,
    const char *account_pubkey
);

/**
 * D1 署名 (= dev fixture 鍵によるローカル署名。 オフラインテスト / mock 用)。
 * 戻り値: 0 = 成功, それ以外 = 失敗。
 */
int32_t pipeline1_sign_d1(const char *input_mp4, const char *output_mp4);

/**
 * D2 署名: ぼかし済 MP4 + 親 D1 MP4 → c2pa.actions.v2 = [c2pa.edited]
 *           + D1 を ingredient parentOf 参照した C2PA manifest 付き MP4。
 * blur_assertion_json: per-frame 顔 bbox を載せた io.rootlens.privacy.blur.v1 の data
 *           (JSON 文字列)。 NULL / 空 / parse 失敗時は assertion を付けない (best-effort)。
 * 戻り値: 0 = 成功, それ以外 = 失敗。
 */
int32_t pipeline1_sign_d2(
    const char *blurred_mp4,
    const char *parent_d1_mp4,
    const char *output_mp4,
    uint32_t faces_blurred,
    const char *blur_assertion_json
);

/**
 * content_id 抽出: SHA-256(active manifest の COSE 署名 bytes)。
 * 戻り値: "sha256:<64 hex>" の C string (要 c2pa_free_string) または NULL on error。
 */
char *pipeline1_content_id(const char *input_mp4);

#ifdef __cplusplus
}
#endif

#endif /* C2PA_BRIDGE_H */
