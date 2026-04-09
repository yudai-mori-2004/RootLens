// Simulator stub for libc2pa_rs.a
// C2PA functions are not available on simulator (no Secure Enclave).
// These stubs allow the app to link and run; callers get error returns.

#include <stdint.h>
#include <stdlib.h>
#include <string.h>

typedef int32_t (*c2pa_sign_fn)(
    const uint8_t *data, uint32_t data_len,
    uint8_t *sig_out, uint32_t *sig_out_len, void *context);

int32_t c2pa_sign_image_tee(
    const char *input_path, const char *output_path,
    const uint8_t *certs_der, const uint32_t *cert_sizes, uint32_t cert_count,
    c2pa_sign_fn sign_fn, void *sign_ctx, const char *tsa_url) {
  return -1; // error
}

int c2pa_sign_image(
    const char *input_path, const char *output_path,
    const char *cert_chain_pem, const char *private_key_pem) {
  return -1; // error
}

static char *dup_str(const char *s) {
  size_t len = strlen(s);
  char *p = malloc(len + 1);
  if (p) memcpy(p, s, len + 1);
  return p;
}

char *c2pa_read_manifest(const char *input_path) {
  return dup_str("{\"error\":\"c2pa not available on simulator\"}");
}

char *c2pa_get_version(void) {
  return dup_str("stub-simulator");
}

void c2pa_free_string(char *s) {
  free(s);
}
