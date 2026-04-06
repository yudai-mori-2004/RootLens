package io.rootlens.app

import com.facebook.react.bridge.*
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import android.util.Base64
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.security.SecureRandom

/**
 * ネイティブ AES-256-GCM 暗号化/復号モジュール
 *
 * javax.crypto (Androidビルトイン) を使用。追加依存ゼロ。
 * ARMv8のAESハードウェア命令を自動利用。
 */
class AesGcmModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "AesGcmBridge"

    /**
     * バイナリペイロード構築 + AES-256-GCM暗号化をネイティブで一括実行。
     * 5MBのコンテンツがJS↔Native Bridgeを一切通過しない。
     *
     * plaintext: [4B meta_len BE][metadata][content_file_bytes]
     * output:    [suite_id(1B)][encap_key_len(2B BE)][encap_key][nonce(12B)][ciphertext+tag]
     *
     * @param contentFilePath コンテンツファイルパス
     * @param metadataJson   メタデータJSON文字列 ({"owner_wallet":"..."})
     * @param requestKeyBase64  方向別鍵 request_key (32B Base64)
     * @param encapKeyBase64    エフェメラル公開鍵 = encapsulated key (32B Base64)
     * @param aadString         Additional Authenticated Data (例: "/verify")
     * @param outputFilePath 出力ファイルパス
     * @return { size: number } 出力ファイルサイズ
     */
    @ReactMethod
    fun buildAndEncryptPayload(
        contentFilePath: String,
        metadataJson: String,
        requestKeyBase64: String,
        encapKeyBase64: String,
        aadString: String,
        outputFilePath: String,
        promise: Promise
    ) {
        try {
            val key = Base64.decode(requestKeyBase64, Base64.NO_WRAP)
            val encapKey = Base64.decode(encapKeyBase64, Base64.NO_WRAP)
            val aad = aadString.toByteArray(Charsets.UTF_8)
            val metaBytes = metadataJson.toByteArray(Charsets.UTF_8)
            val content = File(contentFilePath).readBytes()

            // plaintext: [4B meta_len BE][metadata][content]
            val metaLen = ByteBuffer.allocate(4).putInt(metaBytes.size).array()
            val plaintext = metaLen + metaBytes + content

            // AES-256-GCM with AAD
            val nonce = ByteArray(12).also { SecureRandom().nextBytes(it) }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
            cipher.updateAAD(aad)
            val ciphertext = cipher.doFinal(plaintext)

            // wire format v1: [suite_id(1B)][encap_key_len(2B BE)][encap_key][nonce(12B)][ct+tag]
            val suiteId: Byte = 0x01  // X25519-AES-256-GCM
            val encapKeyLen = ByteBuffer.allocate(2).putShort(encapKey.size.toShort()).array()

            FileOutputStream(outputFilePath).use { out ->
                out.write(byteArrayOf(suiteId))
                out.write(encapKeyLen)
                out.write(encapKey)
                out.write(nonce)
                out.write(ciphertext)
            }

            val totalSize = 1 + 2 + encapKey.size + nonce.size + ciphertext.size
            val result = Arguments.createMap()
            result.putInt("size", totalSize)
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("BUILD_ENCRYPT_ERROR", e.message, e)
        }
    }

    /** ファイルパス方式 AES-256-GCM暗号化（AAD付き）。大容量データがBridgeを通過しない。 */
    @ReactMethod
    fun encryptFile(inputPath: String, outputPath: String, keyBase64: String, aadBase64: String, promise: Promise) {
        try {
            val key = Base64.decode(keyBase64, Base64.NO_WRAP)
            val aad = Base64.decode(aadBase64, Base64.NO_WRAP)
            val plaintext = File(inputPath).readBytes()

            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"))
            cipher.updateAAD(aad)
            val ciphertextWithTag = cipher.doFinal(plaintext)

            File(outputPath).outputStream().use { out ->
                out.write(ciphertextWithTag)
            }

            val result = Arguments.createMap()
            result.putString("nonce", Base64.encodeToString(cipher.iv, Base64.NO_WRAP))
            result.putInt("size", ciphertextWithTag.size)
            promise.resolve(result)
        } catch (e: Exception) {
            promise.reject("AES_ENCRYPT_FILE_ERROR", e.message, e)
        }
    }

    /** ファイルパス方式 AES-256-GCM復号（AAD付き） */
    @ReactMethod
    fun decryptFile(inputPath: String, outputPath: String, keyBase64: String, nonceBase64: String, aadBase64: String, promise: Promise) {
        try {
            val key = Base64.decode(keyBase64, Base64.NO_WRAP)
            val nonce = Base64.decode(nonceBase64, Base64.NO_WRAP)
            val aad = Base64.decode(aadBase64, Base64.NO_WRAP)
            val ciphertext = File(inputPath).readBytes()

            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
            cipher.updateAAD(aad)
            val plaintext = cipher.doFinal(ciphertext)

            File(outputPath).writeBytes(plaintext)
            promise.resolve(outputPath)
        } catch (e: Exception) {
            promise.reject("AES_DECRYPT_FILE_ERROR", e.message, e)
        }
    }
}
