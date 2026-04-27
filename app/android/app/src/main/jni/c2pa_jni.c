#include <jni.h>
#include <string.h>
#include <stdint.h>
#include <stdlib.h>

// c2pa-bridge FFI (レガシー)
extern int c2pa_sign_image(
    const char *input_path,
    const char *output_path,
    const char *cert_chain_pem,
    const char *private_key_pem
);

// c2pa-bridge FFI (TEEコールバック)
typedef int32_t (*c2pa_sign_fn)(
    const uint8_t *data,
    uint32_t data_len,
    uint8_t *sig_out,
    uint32_t *sig_out_len,
    void *context
);

// v0.1.1: assertions_json を追加。with_parent 系は撤廃。
extern int32_t c2pa_sign_image_tee(
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

extern char *c2pa_read_manifest(const char *input_path);
extern char *c2pa_get_version(void);
extern void c2pa_free_string(char *s);

// --- TEE署名コールバック用コンテキスト ---

typedef struct {
    JNIEnv *env;
    jobject module_ref;  // C2paBridgeModule インスタンス
} TeeSignContext;

// TEE署名コールバック: Kotlin側の nativeSignCallback を呼び出す
static int32_t tee_sign_callback(
    const uint8_t *data,
    uint32_t data_len,
    uint8_t *sig_out,
    uint32_t *sig_out_len,
    void *context
) {
    TeeSignContext *ctx = (TeeSignContext *)context;
    JNIEnv *env = ctx->env;

    // data を byte[] に変換
    jbyteArray j_data = (*env)->NewByteArray(env, data_len);
    (*env)->SetByteArrayRegion(env, j_data, 0, data_len, (const jbyte *)data);

    // Kotlin の nativeSignCallback(data: ByteArray): ByteArray を呼び出し
    jclass cls = (*env)->GetObjectClass(env, ctx->module_ref);
    jmethodID method = (*env)->GetMethodID(env, cls, "nativeSignCallback", "([B)[B");

    if (method == NULL) {
        (*env)->DeleteLocalRef(env, j_data);
        return -1;
    }

    jbyteArray j_sig = (jbyteArray)(*env)->CallObjectMethod(
        env, ctx->module_ref, method, j_data
    );

    (*env)->DeleteLocalRef(env, j_data);

    // 例外チェック
    if ((*env)->ExceptionCheck(env)) {
        (*env)->ExceptionClear(env);
        return -2;
    }

    if (j_sig == NULL) {
        return -3;
    }

    jsize sig_len = (*env)->GetArrayLength(env, j_sig);
    if ((uint32_t)sig_len > *sig_out_len) {
        (*env)->DeleteLocalRef(env, j_sig);
        return -4; // バッファ不足
    }

    (*env)->GetByteArrayRegion(env, j_sig, 0, sig_len, (jbyte *)sig_out);
    *sig_out_len = (uint32_t)sig_len;

    (*env)->DeleteLocalRef(env, j_sig);
    return 0;
}

// --- JNI: TEEコールバック署名 ---

// v0.1.1: assertions_json 引数を追加。c2pa_sign_image_tee_with_parent は撤廃。
JNIEXPORT jint JNICALL
Java_io_rootlens_app_C2paBridgeModule_nativeSignImageTee(
    JNIEnv *env,
    jobject thiz,
    jstring input_path,
    jstring output_path,
    jbyteArray certs_der,
    jintArray cert_sizes,
    jint cert_count,
    jstring tsa_url,
    jstring assertions_json
) {
    const char *input = (*env)->GetStringUTFChars(env, input_path, NULL);
    const char *output = (*env)->GetStringUTFChars(env, output_path, NULL);

    // TSA URL（NULLの場合タイムスタンプなし）
    const char *tsa = NULL;
    if (tsa_url != NULL) {
        tsa = (*env)->GetStringUTFChars(env, tsa_url, NULL);
    }

    // assertions_json (NULL なら追加なし)
    const char *aj = NULL;
    if (assertions_json != NULL) {
        aj = (*env)->GetStringUTFChars(env, assertions_json, NULL);
    }

    // DER証明書バイト列
    jbyte *certs_bytes = (*env)->GetByteArrayElements(env, certs_der, NULL);
    jint *sizes = (*env)->GetIntArrayElements(env, cert_sizes, NULL);

    // cert_sizes を uint32_t 配列にコピー
    uint32_t *u_sizes = (uint32_t *)malloc(cert_count * sizeof(uint32_t));
    for (int i = 0; i < cert_count; i++) {
        u_sizes[i] = (uint32_t)sizes[i];
    }

    // コールバックコンテキスト
    TeeSignContext ctx;
    ctx.env = env;
    ctx.module_ref = thiz;

    int32_t result = c2pa_sign_image_tee(
        input, output,
        (const uint8_t *)certs_bytes, u_sizes, (uint32_t)cert_count,
        tee_sign_callback, &ctx,
        tsa,
        aj
    );

    free(u_sizes);
    (*env)->ReleaseIntArrayElements(env, cert_sizes, sizes, JNI_ABORT);
    (*env)->ReleaseByteArrayElements(env, certs_der, certs_bytes, JNI_ABORT);
    if (aj != NULL) {
        (*env)->ReleaseStringUTFChars(env, assertions_json, aj);
    }
    if (tsa != NULL) {
        (*env)->ReleaseStringUTFChars(env, tsa_url, tsa);
    }
    (*env)->ReleaseStringUTFChars(env, output_path, output);
    (*env)->ReleaseStringUTFChars(env, input_path, input);

    return result;
}

// --- JNI: レガシー署名（PEMベース） ---

JNIEXPORT jint JNICALL
Java_io_rootlens_app_C2paBridgeModule_nativeSignImage(
    JNIEnv *env,
    jobject thiz,
    jstring input_path,
    jstring output_path,
    jstring cert_chain_pem,
    jstring private_key_pem
) {
    const char *input = (*env)->GetStringUTFChars(env, input_path, NULL);
    const char *output = (*env)->GetStringUTFChars(env, output_path, NULL);
    const char *cert = (*env)->GetStringUTFChars(env, cert_chain_pem, NULL);
    const char *key = (*env)->GetStringUTFChars(env, private_key_pem, NULL);

    int result = c2pa_sign_image(input, output, cert, key);

    (*env)->ReleaseStringUTFChars(env, input_path, input);
    (*env)->ReleaseStringUTFChars(env, output_path, output);
    (*env)->ReleaseStringUTFChars(env, cert_chain_pem, cert);
    (*env)->ReleaseStringUTFChars(env, private_key_pem, key);

    return result;
}

// --- JNI: マニフェスト読み取り ---

JNIEXPORT jstring JNICALL
Java_io_rootlens_app_C2paBridgeModule_nativeReadManifest(
    JNIEnv *env,
    jobject thiz,
    jstring input_path
) {
    const char *input = (*env)->GetStringUTFChars(env, input_path, NULL);

    char *json = c2pa_read_manifest(input);

    (*env)->ReleaseStringUTFChars(env, input_path, input);

    if (json == NULL) {
        return (*env)->NewStringUTF(env, "{\"has_manifest\":false,\"error\":\"null result\"}");
    }

    jstring result = (*env)->NewStringUTF(env, json);
    c2pa_free_string(json);
    return result;
}

JNIEXPORT jstring JNICALL
Java_io_rootlens_app_C2paBridgeModule_nativeGetVersion(
    JNIEnv *env,
    jobject thiz
) {
    char *version = c2pa_get_version();
    jstring result = (*env)->NewStringUTF(env, version);
    c2pa_free_string(version);
    return result;
}
