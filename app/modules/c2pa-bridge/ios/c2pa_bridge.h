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

/* ─── v0.1.3 Pipeline 1 (= mock-device 互換 D1/D2/content_id) ──────────── */

/**
 * D1 署名: 生 MP4 → c2pa.actions.v2 = [c2pa.created] の C2PA manifest 付き MP4。
 * 戻り値: 0 = 成功, それ以外 = 失敗。
 */
int32_t pipeline1_sign_d1(const char *input_mp4, const char *output_mp4);

/**
 * D2 署名: ぼかし済 MP4 + 親 D1 MP4 → c2pa.actions.v2 = [c2pa.placed]
 *           + D1 を ingredient parentOf 参照した C2PA manifest 付き MP4。
 * 戻り値: 0 = 成功, それ以外 = 失敗。
 */
int32_t pipeline1_sign_d2(
    const char *blurred_mp4,
    const char *parent_d1_mp4,
    const char *output_mp4,
    uint32_t faces_blurred
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
