package io.rootlens.app

import android.graphics.*
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaMetadataRetriever
import android.media.MediaMuxer
import android.net.Uri
import android.os.Handler
import android.os.HandlerThread
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import androidx.exifinterface.media.ExifInterface
import androidx.media3.common.MediaItem
import androidx.media3.effect.Crop
import androidx.media3.effect.Presentation
import androidx.media3.transformer.*
import com.facebook.react.bridge.*
import org.bouncycastle.asn1.x500.X500Name
import org.bouncycastle.operator.jcajce.JcaContentSignerBuilder
import org.bouncycastle.pkcs.jcajce.JcaPKCS10CertificationRequestBuilder
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.security.*
import java.security.cert.CertificateFactory
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * 仕様書 §4.6 C2PA SDK統合
 * React Nativeネイティブモジュール: c2pa-bridge (.so) をJNI経由で呼び出す
 */
class C2paBridgeModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        private const val TAG = "C2paBridge"
        init {
            System.loadLibrary("c2pa_bridge")
            System.loadLibrary("c2pa_jni")
        }
    }

    override fun getName(): String = "C2paBridge"

    // TEE鍵のKeyStoreエイリアス
    private val TEE_KEY_ALIAS = "rootlens_c2pa_signing_key"

    // JNI宣言 (レガシー)
    private external fun nativeSignImage(
        inputPath: String,
        outputPath: String,
        certChainPem: String,
        privateKeyPem: String
    ): Int

    // JNI宣言 (TEEコールバック)
    private external fun nativeSignImageTee(
        inputPath: String,
        outputPath: String,
        certsDer: ByteArray,
        certSizes: IntArray,
        certCount: Int,
        tsaUrl: String?
    ): Int

    // JNI宣言 (TEEコールバック + 親マニフェスト参照)
    private external fun nativeSignImageTeeWithParent(
        inputPath: String,
        outputPath: String,
        certsDer: ByteArray,
        certSizes: IntArray,
        certCount: Int,
        tsaUrl: String?,
        parentPath: String?
    ): Int

    private external fun nativeReadManifest(inputPath: String): String

    private external fun nativeGetVersion(): String

    // --- TEE鍵管理 (§4.4, §4.6) ---

    /**
     * TEE内でEC P-256鍵を生成し、CSRとPlatform Attestationを返す
     * 仕様書 §4.4.1 フロー詳細
     */
    @ReactMethod
    fun generateDeviceCredentials(promise: Promise) {
        try {
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)

            // 鍵が存在しない場合のみ新規生成（TEE鍵は永続的）
            // §4.4.1: setAttestationChallenge は鍵生成時にのみ設定可能。
            // 既存鍵の場合はCSRのchallenge検証で紐付ける。
            // 初回生成時: ダミーchallengeで生成し、CSR作成後にKey Attestation chainを取得。
            // Note: attestationChallengeはCSR生成前に設定する必要があるが、
            //       CSRのハッシュはCSR生成後にしか計算できない。
            //       仕様書 §4.4.1: challenge = SHA-256(CSR) の検証はサーバー側で行う。
            //       鍵生成時のattestationChallengeには一時的なランダム値を使用し、
            //       サーバーはKey Attestation chainのリーフ証明書の公開鍵が
            //       CSRの公開鍵と一致することで紐付けを検証する。
            if (!keyStore.containsAlias(TEE_KEY_ALIAS)) {
                generateTeeKey(keyStore)
            } else {
                Log.d(TAG, "TEE key already exists")
            }

            // 公開鍵を取得
            keyStore.load(null)
            val entry = keyStore.getEntry(TEE_KEY_ALIAS, null) as KeyStore.PrivateKeyEntry
            val publicKey = entry.certificate.publicKey
            val privateKey = entry.privateKey

            // PKCS#10 CSR作成（§4.4.1: Subject CN = "RootLens Device"）
            val csrDer = buildCSR(publicKey, privateKey)
            val csrBase64 = Base64.encodeToString(csrDer, Base64.NO_WRAP)

            // Key Attestation chain取得（§4.4.1: ハードウェアが署名した証明書チェーン）
            val attestationChain = getKeyAttestationChain(keyStore)

            val result = Arguments.createMap().apply {
                putString("csr", csrBase64)
                putString("platform", "android")
                // Attestation data
                val attestation = Arguments.createMap().apply {
                    val chainArray = Arguments.createArray()
                    attestationChain.forEach { chainArray.pushString(it) }
                    putArray("key_attestation_chain", chainArray)
                    // TODO: Play Integrity Token（Google Play Services依存、Phase 2で追加）
                }
                putMap("attestation", attestation)
            }

            Log.d(TAG, "generateDeviceCredentials: CSR created (${csrDer.size} bytes), attestation chain: ${attestationChain.size} certs")
            promise.resolve(result)
        } catch (e: Exception) {
            Log.e(TAG, "generateDeviceCredentials failed", e)
            promise.reject("TEE_ERROR", e.message, e)
        }
    }

    /**
     * TEE内でEC P-256鍵を生成する。
     * §4.2: ES256, §4.4.1: StrongBox優先、TEEフォールバック
     * Key AttestationのためsetAttestationChallengeを設定する。
     */
    private fun generateTeeKey(keyStore: KeyStore) {
        // attestation challengeは鍵生成時に固定される。
        // サーバー側ではCSR公開鍵とattestation cert公開鍵の一致で検証する。
        val challenge = ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }

        // StrongBoxを試み、非対応ならTEEにフォールバック
        try {
            val paramBuilder = KeyGenParameterSpec.Builder(
                TEE_KEY_ALIAS,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
            )
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setAttestationChallenge(challenge)
                .setIsStrongBoxBacked(true)

            val kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            kpg.initialize(paramBuilder.build())
            kpg.generateKeyPair()
            Log.d(TAG, "TEE key generated (StrongBox)")
        } catch (e: Exception) {
            Log.w(TAG, "StrongBox not available, falling back to TEE", e)
            // 既にStrongBox試行で鍵が作られている可能性があるので削除
            try { keyStore.deleteEntry(TEE_KEY_ALIAS) } catch (_: Exception) {}

            val fallbackBuilder = KeyGenParameterSpec.Builder(
                TEE_KEY_ALIAS,
                KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY
            )
                .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
                .setDigests(KeyProperties.DIGEST_SHA256)
                .setAttestationChallenge(challenge)

            val kpg = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
            kpg.initialize(fallbackBuilder.build())
            kpg.generateKeyPair()
            Log.d(TAG, "TEE key generated (TEE fallback)")
        }
    }

    /**
     * PKCS#10 CSR作成
     * AndroidKeyStoreはBouncyCastleのJcaContentSignerBuilderと互換性がないため、
     * 標準JCA Signatureを使ったカスタムContentSignerでCSRに署名する。
     */
    private fun buildCSR(publicKey: PublicKey, privateKey: PrivateKey): ByteArray {
        val subject = X500Name("CN=RootLens Device")
        val csrBuilder = JcaPKCS10CertificationRequestBuilder(subject, publicKey)
        val signer = object : org.bouncycastle.operator.ContentSigner {
            private val stream = java.io.ByteArrayOutputStream()
            override fun getAlgorithmIdentifier() =
                org.bouncycastle.asn1.x509.AlgorithmIdentifier(
                    org.bouncycastle.asn1.x9.X9ObjectIdentifiers.ecdsa_with_SHA256
                )
            override fun getOutputStream(): java.io.OutputStream = stream
            override fun getSignature(): ByteArray {
                val sig = Signature.getInstance("SHA256withECDSA")
                sig.initSign(privateKey)
                sig.update(stream.toByteArray())
                return sig.sign()
            }
        }
        return csrBuilder.build(signer).encoded
    }

    /**
     * Key Attestation chain を取得する（DER Base64配列）。
     * Android KeyStoreが自動生成する証明書チェーン:
     *   [0] Attestation cert（公開鍵 + attestation extension）
     *   [1..N-1] Intermediate CAs
     *   [N] Google Hardware Attestation Root CA
     */
    private fun getKeyAttestationChain(keyStore: KeyStore): List<String> {
        val chain = keyStore.getCertificateChain(TEE_KEY_ALIAS) ?: return emptyList()
        return chain.map { cert ->
            Base64.encodeToString(cert.encoded, Base64.NO_WRAP)
        }
    }

    /**
     * サーバーから返却されたDevice Certificate + Root CA Certificateを保存
     * 仕様書 §4.4.1 ステップ7
     */
    @ReactMethod
    fun storeDeviceCertificate(deviceCertBase64: String, intermediateCaCertBase64: String, rootCaCertBase64: String, promise: Promise) {
        try {
            val context = reactApplicationContext
            val prefs = context.getSharedPreferences("rootlens_certs", 0)
            prefs.edit()
                .putString("device_cert_der", deviceCertBase64)
                .putString("intermediate_ca_cert_der", intermediateCaCertBase64)
                .putString("root_ca_cert_der", rootCaCertBase64)
                .apply()
            Log.d(TAG, "Device certificate stored (3-layer chain)")
            promise.resolve(true)
        } catch (e: Exception) {
            Log.e(TAG, "storeDeviceCertificate failed", e)
            promise.reject("STORE_ERROR", e.message, e)
        }
    }

    /**
     * Device Certificateが存在するか確認
     */
    @ReactMethod
    fun hasDeviceCertificate(promise: Promise) {
        try {
            val keyStore = KeyStore.getInstance("AndroidKeyStore")
            keyStore.load(null)
            val hasKey = keyStore.containsAlias(TEE_KEY_ALIAS)

            val prefs = reactApplicationContext.getSharedPreferences("rootlens_certs", 0)
            val hasCert = prefs.getString("device_cert_der", null) != null

            promise.resolve(hasKey && hasCert)
        } catch (e: Exception) {
            promise.resolve(false)
        }
    }

    /**
     * Device Certificateの有効期限を返す（ISO 8601文字列）
     * 証明書更新判定用
     */
    @ReactMethod
    fun getDeviceCertificateExpiry(promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("rootlens_certs", 0)
            val certBase64 = prefs.getString("device_cert_der", null)
            if (certBase64 == null) {
                promise.resolve(null)
                return
            }
            val certDer = Base64.decode(certBase64, Base64.NO_WRAP)
            val cf = java.security.cert.CertificateFactory.getInstance("X.509")
            val cert = cf.generateCertificate(certDer.inputStream()) as X509Certificate
            promise.resolve(cert.notAfter.toInstant().toString())
        } catch (e: Exception) {
            Log.e(TAG, "getDeviceCertificateExpiry failed", e)
            promise.resolve(null)
        }
    }

    /**
     * 保存済み証明書チェーンの整合性を検証
     * Device CertがIntermediate CAで署名されているか確認する。
     * PKIローテーション（ICA再生成）を検出するための軽量チェック。
     */
    @ReactMethod
    fun verifyStoredCertChain(promise: Promise) {
        try {
            val prefs = reactApplicationContext.getSharedPreferences("rootlens_certs", 0)
            val deviceCertBase64 = prefs.getString("device_cert_der", null)
            val intermediateCaBase64 = prefs.getString("intermediate_ca_cert_der", null)
            if (deviceCertBase64 == null || intermediateCaBase64 == null) {
                promise.resolve(false)
                return
            }
            val deviceCertDer = Base64.decode(deviceCertBase64, Base64.NO_WRAP)
            val intermediateCaDer = Base64.decode(intermediateCaBase64, Base64.NO_WRAP)
            val cf = CertificateFactory.getInstance("X.509")
            val deviceCert = cf.generateCertificate(deviceCertDer.inputStream()) as X509Certificate
            val icaCert = cf.generateCertificate(intermediateCaDer.inputStream()) as X509Certificate
            // Device証明書がICA公開鍵で検証できるか — 失敗すればICAが再生成されている
            deviceCert.verify(icaCert.publicKey)
            promise.resolve(true)
        } catch (e: Exception) {
            Log.w(TAG, "verifyStoredCertChain failed: ${e.message}")
            promise.resolve(false)
        }
    }

    /**
     * 保存済み証明書を全削除（re-provisioning前に使用）
     */
    @ReactMethod
    fun clearStoredCertificates(promise: Promise) {
        val prefs = reactApplicationContext.getSharedPreferences("rootlens_certs", 0)
        prefs.edit()
            .remove("device_cert_der")
            .remove("intermediate_ca_cert_der")
            .remove("root_ca_cert_der")
            .apply()
        Log.d(TAG, "Stored certificates cleared for re-provisioning")
        promise.resolve(null)
    }

    /**
     * TEE署名コールバック — JNI C層から呼び出される
     * Android KeyStoreの秘密鍵でECDSA P-256署名を実行
     */
    fun nativeSignCallback(data: ByteArray): ByteArray {
        val keyStore = KeyStore.getInstance("AndroidKeyStore")
        keyStore.load(null)
        val entry = keyStore.getEntry(TEE_KEY_ALIAS, null) as KeyStore.PrivateKeyEntry
        val signature = Signature.getInstance("SHA256withECDSA")
        signature.initSign(entry.privateKey)
        signature.update(data)
        return signature.sign()
    }

    /**
     * 保存済みDER証明書を取得し、TEEコールバック経由で署名する内部メソッド
     */
    private fun signWithTee(inputFile: File, outputFile: File): Int {
        val prefs = reactApplicationContext.getSharedPreferences("rootlens_certs", 0)
        val deviceCertBase64 = prefs.getString("device_cert_der", null)
            ?: throw IllegalStateException("Device certificate not found")
        val intermediateCaBase64 = prefs.getString("intermediate_ca_cert_der", null)
            ?: throw IllegalStateException("Intermediate CA certificate not found")
        val rootCaBase64 = prefs.getString("root_ca_cert_der", null)
            ?: throw IllegalStateException("Root CA certificate not found")

        val deviceCertDer = Base64.decode(deviceCertBase64, Base64.NO_WRAP)
        val intermediateCaDer = Base64.decode(intermediateCaBase64, Base64.NO_WRAP)
        val rootCaDer = Base64.decode(rootCaBase64, Base64.NO_WRAP)

        // DER証明書を連結（Device + Intermediate CA + Root CA）
        val certsDer = deviceCertDer + intermediateCaDer + rootCaDer
        val certSizes = intArrayOf(deviceCertDer.size, intermediateCaDer.size, rootCaDer.size)

        // 仕様書 §4.5.3: RFC 3161 TSAタイムスタンプ（短期証明書には必須）
        val tsaUrl = "http://timestamp.digicert.com"

        return nativeSignImageTee(
            inputFile.absolutePath,
            outputFile.absolutePath,
            certsDer,
            certSizes,
            3,
            tsaUrl
        )
    }

    @ReactMethod
    fun signContent(imagePath: String, promise: Promise) {
        try {
            val context = reactApplicationContext
            Log.d(TAG, "signContent called with: $imagePath")

            // 入力ファイルを実パスに変換（content:// URI対応）
            val inputFile = resolveToFile(imagePath)
            if (inputFile == null || !inputFile.exists()) {
                Log.e(TAG, "Input file not found: $imagePath -> $inputFile")
                promise.reject("FILE_ERROR", "入力ファイルが見つかりません: $imagePath")
                return
            }
            Log.d(TAG, "Input file: ${inputFile.absolutePath} (${inputFile.length()} bytes)")

            // 出力先（入力ファイルの拡張子を保持）
            val ext = inputFile.extension.ifEmpty { "jpg" }
            val outputFile = File(context.cacheDir, "c2pa_signed_${System.currentTimeMillis()}.$ext")

            // TEE証明書があればTEEコールバック署名
            // レガシーPEM署名はDEBUGビルドでのみ許可（§4.6）
            val prefs = context.getSharedPreferences("rootlens_certs", 0)
            val hasTeeCert = prefs.getString("device_cert_der", null) != null

            val result = if (hasTeeCert) {
                Log.d(TAG, "Using TEE callback signing")
                signWithTee(inputFile, outputFile)
            } else if (BuildConfig.DEBUG) {
                Log.d(TAG, "Using legacy PEM signing (dev certs) — DEBUG only")
                val certChain = loadAssetAsString("dev-certs/dev-chain.pem")
                val privateKey = loadAssetAsString("dev-certs/dev-device-key.pem")
                if (certChain == null || privateKey == null) {
                    promise.reject("CERT_ERROR", "証明書が見つかりません")
                    return
                }
                nativeSignImage(inputFile.absolutePath, outputFile.absolutePath, certChain, privateKey)
            } else {
                promise.reject("CERT_ERROR", "Device Certificateが未取得です。ネットワーク接続を確認してください")
                return
            }

            Log.d(TAG, "signContent result: $result")

            when (result) {
                0 -> {
                    Log.d(TAG, "Sign success: ${outputFile.absolutePath} (${outputFile.length()} bytes)")
                    promise.resolve(outputFile.absolutePath)
                }
                -1 -> promise.reject("ARG_ERROR", "引数エラー")
                -2 -> promise.reject("SIGN_ERROR", "署名エラー (code: $result)")
                else -> promise.reject("UNKNOWN_ERROR", "不明なエラー: $result")
            }
        } catch (e: Exception) {
            Log.e(TAG, "Exception in signContent", e)
            promise.reject("EXCEPTION", e.message, e)
        }
    }

    @ReactMethod
    fun signContentWithParent(imagePath: String, parentPath: String, promise: Promise) {
        try {
            val context = reactApplicationContext
            val inputFile = resolveToFile(imagePath)
            val parentFile = resolveToFile(parentPath)
            if (inputFile == null || !inputFile.exists()) {
                promise.reject("FILE_ERROR", "入力ファイルが見つかりません: $imagePath")
                return
            }
            if (parentFile == null || !parentFile.exists()) {
                promise.reject("FILE_ERROR", "親ファイルが見つかりません: $parentPath")
                return
            }

            val ext = inputFile.extension.ifEmpty { "jpg" }
            val outputFile = File(context.cacheDir, "c2pa_edited_${System.currentTimeMillis()}.$ext")

            val prefs = context.getSharedPreferences("rootlens_certs", 0)
            val deviceCertBase64 = prefs.getString("device_cert_der", null)
                ?: run { promise.reject("CERT_ERROR", "Device Certificate未取得"); return }
            val intermediateCaBase64 = prefs.getString("intermediate_ca_cert_der", null)
                ?: run { promise.reject("CERT_ERROR", "Intermediate CA未取得"); return }
            val rootCaBase64 = prefs.getString("root_ca_cert_der", null)
                ?: run { promise.reject("CERT_ERROR", "Root CA未取得"); return }

            val deviceCertDer = android.util.Base64.decode(deviceCertBase64, android.util.Base64.NO_WRAP)
            val intermediateCaDer = android.util.Base64.decode(intermediateCaBase64, android.util.Base64.NO_WRAP)
            val rootCaDer = android.util.Base64.decode(rootCaBase64, android.util.Base64.NO_WRAP)
            val certsDer = deviceCertDer + intermediateCaDer + rootCaDer
            val certSizes = intArrayOf(deviceCertDer.size, intermediateCaDer.size, rootCaDer.size)
            val tsaUrl = "http://timestamp.digicert.com"

            val result = nativeSignImageTeeWithParent(
                inputFile.absolutePath,
                outputFile.absolutePath,
                certsDer,
                certSizes,
                3,
                tsaUrl,
                parentFile.absolutePath
            )

            when (result) {
                0 -> promise.resolve(outputFile.absolutePath)
                -1 -> promise.reject("ARG_ERROR", "引数エラー")
                -2 -> promise.reject("SIGN_ERROR", "署名エラー (code: $result)")
                else -> promise.reject("UNKNOWN_ERROR", "不明なエラー: $result")
            }
        } catch (e: Exception) {
            promise.reject("EXCEPTION", e.message, e)
        }
    }

    @ReactMethod
    fun readManifest(imagePath: String, promise: Promise) {
        try {
            Log.d(TAG, "readManifest called with: $imagePath")

            val inputFile = resolveToFile(imagePath)
            if (inputFile == null || !inputFile.exists()) {
                Log.e(TAG, "Input file not found: $imagePath")
                promise.resolve("{\"has_manifest\":false,\"error\":\"file not found\"}")
                return
            }

            val json = nativeReadManifest(inputFile.absolutePath)
            Log.d(TAG, "readManifest result: $json")
            promise.resolve(json)
        } catch (e: Exception) {
            Log.e(TAG, "Exception in readManifest", e)
            promise.resolve("{\"has_manifest\":false,\"error\":\"${e.message}\"}")
        }
    }

    /**
     * 画像にマスク（黒塗り矩形）を描画する
     * @param imagePath 入力画像パス
     * @param masksArray [{x, y, w, h, rotation}] 配列
     */
    @ReactMethod
    fun applyMasks(imagePath: String, masksArray: ReadableArray, promise: Promise) {
        try {
            val inputFile = resolveToFile(imagePath)
            if (inputFile == null || !inputFile.exists()) {
                promise.reject("FILE_ERROR", "入力ファイルが見つかりません")
                return
            }

            // BitmapFactory はEXIF回転を適用しないため、手動で適用する
            val rawBitmap = BitmapFactory.decodeFile(inputFile.absolutePath)
            if (rawBitmap == null) {
                promise.reject("DECODE_ERROR", "画像のデコードに失敗しました")
                return
            }

            // EXIF orientation を読み取り、正しい向きの mutable bitmap を生成
            val bitmap = applyExifOrientation(rawBitmap, inputFile.absolutePath)
            if (bitmap !== rawBitmap) rawBitmap.recycle()

            Log.d(TAG, "applyMasks: bitmap=${bitmap.width}x${bitmap.height}, masks=${masksArray.size()}")

            val canvas = Canvas(bitmap)
            val paint = Paint().apply {
                color = Color.BLACK
                style = Paint.Style.FILL
                isAntiAlias = false
            }

            for (i in 0 until masksArray.size()) {
                val mask = masksArray.getMap(i)
                val x = mask.getDouble("x").toFloat()
                val y = mask.getDouble("y").toFloat()
                val w = mask.getDouble("w").toFloat()
                val h = mask.getDouble("h").toFloat()
                val rotation = mask.getDouble("rotation").toFloat()

                Log.d(TAG, "applyMasks: mask[$i] x=$x y=$y w=$w h=$h rot=$rotation")

                canvas.save()
                canvas.translate(x + w / 2f, y + h / 2f)
                canvas.rotate(rotation)
                canvas.drawRect(-w / 2f, -h / 2f, w / 2f, h / 2f, paint)
                canvas.restore()
            }

            // Bitmap.compress は JPEG/PNG のみ対応。HEIC等の場合もJPEGで保存し、
            // 拡張子を実際のエンコード形式に合わせる（c2pa-rsが拡張子からMIMEを判定するため）
            val inputExt = inputFile.extension.lowercase()
            val isPng = inputExt == "png"
            val format = if (isPng) Bitmap.CompressFormat.PNG else Bitmap.CompressFormat.JPEG
            val quality = if (isPng) 100 else 95
            val outputExt = if (isPng) "png" else "jpg"
            val outputFile = File(reactApplicationContext.cacheDir, "masked_${System.currentTimeMillis()}.$outputExt")
            FileOutputStream(outputFile).use { bitmap.compress(format, quality, it) }
            bitmap.recycle()

            // EXIF日時をコピー（MediaStoreのDATE_TAKENに必要）
            if (!isPng) {
                try {
                    val inputExif = ExifInterface(inputFile.absolutePath)
                    val outputExif = ExifInterface(outputFile.absolutePath)
                    val dateTags = arrayOf(
                        ExifInterface.TAG_DATETIME,
                        ExifInterface.TAG_DATETIME_ORIGINAL,
                        ExifInterface.TAG_DATETIME_DIGITIZED,
                        ExifInterface.TAG_OFFSET_TIME,
                        ExifInterface.TAG_OFFSET_TIME_ORIGINAL,
                        ExifInterface.TAG_OFFSET_TIME_DIGITIZED,
                    )
                    for (tag in dateTags) {
                        inputExif.getAttribute(tag)?.let { outputExif.setAttribute(tag, it) }
                    }
                    outputExif.saveAttributes()
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to copy EXIF dates to masked output", e)
                }
            }

            Log.d(TAG, "applyMasks: output=${outputFile.absolutePath} (${outputFile.length()} bytes)")
            promise.resolve(outputFile.absolutePath)
        } catch (e: Exception) {
            Log.e(TAG, "Exception in applyMasks", e)
            promise.reject("MASK_ERROR", e.message, e)
        }
    }

    /**
     * 動画にクロップ・リサイズ・トリムを適用する
     * @param inputPath 入力動画パス
     * @param optionsJson JSON形式のオプション {cropX, cropY, cropW, cropH, outputW, outputH, startMs, endMs}
     */
    @ReactMethod
    fun processVideo(inputPath: String, optionsJson: String, promise: Promise) {
        Thread {
            try {
                val opts = JSONObject(optionsJson)
                val inputFile = resolveToFile(inputPath)
                if (inputFile == null || !inputFile.exists()) {
                    promise.reject("FILE_ERROR", "入力ファイルが見つかりません: $inputPath")
                    return@Thread
                }
                Log.d(TAG, "processVideo: input=${inputFile.absolutePath}, opts=$optionsJson")

                // ソース動画の表示サイズ取得（回転考慮）
                val retriever = MediaMetadataRetriever()
                retriever.setDataSource(inputFile.absolutePath)
                val rawW = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)?.toIntOrNull() ?: 0
                val rawH = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)?.toIntOrNull() ?: 0
                val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
                retriever.release()
                val isRotated = rotation == 90 || rotation == 270
                val sourceW = if (isRotated) rawH else rawW
                val sourceH = if (isRotated) rawW else rawH

                val cropX = opts.optDouble("cropX", 0.0)
                val cropY = opts.optDouble("cropY", 0.0)
                val cropW = opts.optDouble("cropW", sourceW.toDouble())
                val cropH = opts.optDouble("cropH", sourceH.toDouble())
                val outputW = opts.optInt("outputW", cropW.roundToInt())
                val outputH = opts.optInt("outputH", cropH.roundToInt())
                val startMs = if (opts.has("startMs")) opts.getLong("startMs") else -1L
                val endMs = if (opts.has("endMs")) opts.getLong("endMs") else -1L

                val hasCrop = cropX != 0.0 || cropY != 0.0 ||
                    abs(cropW - sourceW.toDouble()) > 1 || abs(cropH - sourceH.toDouble()) > 1
                val hasResize = abs(outputW - cropW.roundToInt()) > 1 || abs(outputH - cropH.roundToInt()) > 1
                val hasTrim = startMs >= 0 || endMs >= 0
                val needsReencode = hasCrop || hasResize

                val outputFile = File(reactApplicationContext.cacheDir, "video_out_${System.currentTimeMillis()}.mp4")

                if (!needsReencode && hasTrim) {
                    // トリムのみ: 再エンコード不要の高速パス
                    trimOnly(inputFile, outputFile, startMs, endMs)
                    Log.d(TAG, "processVideo trim-only success: ${outputFile.absolutePath}")
                    promise.resolve(outputFile.absolutePath)
                } else if (!needsReencode && !hasTrim) {
                    // 変更なし
                    promise.resolve(inputFile.absolutePath)
                } else {
                    // Media3 Transformer でクロップ・リサイズ（+トリム）
                    processWithTransformer(
                        inputFile, outputFile,
                        cropX.toFloat(), cropY.toFloat(), cropW.toFloat(), cropH.toFloat(),
                        outputW, outputH, sourceW, sourceH,
                        startMs, endMs, promise
                    )
                }
            } catch (e: Exception) {
                Log.e(TAG, "Exception in processVideo", e)
                promise.reject("VIDEO_ERROR", e.message, e)
            }
        }.start()
    }

    @androidx.annotation.OptIn(androidx.media3.common.util.UnstableApi::class)
    private fun processWithTransformer(
        inputFile: File, outputFile: File,
        cropX: Float, cropY: Float, cropW: Float, cropH: Float,
        outputW: Int, outputH: Int, sourceW: Int, sourceH: Int,
        startMs: Long, endMs: Long, promise: Promise
    ) {
        val handlerThread = HandlerThread("video-transformer")
        handlerThread.start()
        val handler = Handler(handlerThread.looper)

        handler.post {
            try {
                val transformer = Transformer.Builder(reactApplicationContext)
                    .setLooper(handlerThread.looper)
                    .addListener(object : Transformer.Listener {
                        override fun onCompleted(composition: Composition, exportResult: ExportResult) {
                            Log.d(TAG, "processVideo transformer success: ${outputFile.absolutePath}")
                            promise.resolve(outputFile.absolutePath)
                            handlerThread.quitSafely()
                        }
                        override fun onError(composition: Composition, exportResult: ExportResult, exportException: ExportException) {
                            Log.e(TAG, "processVideo transformer error", exportException)
                            promise.reject("VIDEO_ERROR", exportException.message, exportException)
                            handlerThread.quitSafely()
                        }
                    })
                    .build()

                // エフェクト構築
                val effects = mutableListOf<androidx.media3.common.Effect>()
                val hasCrop = cropX != 0f || cropY != 0f ||
                    abs(cropW - sourceW.toFloat()) > 1 || abs(cropH - sourceH.toFloat()) > 1
                if (hasCrop) {
                    // Media3のCropは正規化座標(-1〜1): (-1,-1)=左下, (1,1)=右上
                    val left = 2f * cropX / sourceW - 1f
                    val right = 2f * (cropX + cropW) / sourceW - 1f
                    val top = 1f - 2f * cropY / sourceH
                    val bottom = 1f - 2f * (cropY + cropH) / sourceH
                    effects.add(Crop(left, right, bottom, top))
                }
                val hasResize = abs(outputW - cropW.roundToInt()) > 1 || abs(outputH - cropH.roundToInt()) > 1
                if (hasResize) {
                    // 偶数サイズに丸め
                    val w = (outputW / 2) * 2
                    val h = (outputH / 2) * 2
                    effects.add(
                        Presentation.createForWidthAndHeight(w, h, Presentation.LAYOUT_SCALE_TO_FIT)
                    )
                }

                // MediaItem構築（トリム設定含む）
                val mediaItemBuilder = MediaItem.Builder()
                    .setUri(Uri.fromFile(inputFile))
                val hasTrim = startMs >= 0 || endMs >= 0
                if (hasTrim) {
                    val clippingBuilder = MediaItem.ClippingConfiguration.Builder()
                    if (startMs >= 0) clippingBuilder.setStartPositionMs(startMs)
                    if (endMs >= 0) clippingBuilder.setEndPositionMs(endMs)
                    mediaItemBuilder.setClippingConfiguration(clippingBuilder.build())
                }

                val editedMediaItem = EditedMediaItem.Builder(mediaItemBuilder.build())
                    .setEffects(Effects(/* audioProcessors= */ listOf(), /* videoEffects= */ effects))
                    .build()

                transformer.start(editedMediaItem, outputFile.absolutePath)
            } catch (e: Exception) {
                Log.e(TAG, "Exception starting transformer", e)
                promise.reject("VIDEO_ERROR", e.message, e)
                handlerThread.quitSafely()
            }
        }
    }

    /**
     * トリムのみ（再エンコード不要）の高速処理
     * MediaExtractor + MediaMuxerでストリームコピー
     */
    private fun trimOnly(inputFile: File, outputFile: File, startMs: Long, endMs: Long) {
        val extractor = MediaExtractor()
        extractor.setDataSource(inputFile.absolutePath)

        val muxer = MediaMuxer(outputFile.absolutePath, MediaMuxer.OutputFormat.MUXER_OUTPUT_MPEG_4)

        // 全トラックを追加
        val trackMap = mutableMapOf<Int, Int>()
        for (i in 0 until extractor.trackCount) {
            val format = extractor.getTrackFormat(i)
            val muxerTrack = muxer.addTrack(format)
            trackMap[i] = muxerTrack
        }
        muxer.start()

        val startUs = if (startMs >= 0) startMs * 1000 else 0L
        val endUs = if (endMs >= 0) endMs * 1000 else Long.MAX_VALUE
        val bufferSize = 1024 * 1024
        val buffer = ByteBuffer.allocate(bufferSize)
        val bufferInfo = MediaCodec.BufferInfo()

        // トラックごとに処理
        for (i in 0 until extractor.trackCount) {
            extractor.selectTrack(i)
            extractor.seekTo(startUs, MediaExtractor.SEEK_TO_CLOSEST_SYNC)

            while (true) {
                val sampleSize = extractor.readSampleData(buffer, 0)
                if (sampleSize < 0) break

                val sampleTime = extractor.sampleTime
                if (sampleTime > endUs) break
                if (sampleTime < startUs) {
                    extractor.advance()
                    continue
                }

                bufferInfo.offset = 0
                bufferInfo.size = sampleSize
                bufferInfo.presentationTimeUs = sampleTime - startUs
                bufferInfo.flags = extractor.sampleFlags

                muxer.writeSampleData(trackMap[i]!!, buffer, bufferInfo)
                extractor.advance()
            }

            extractor.unselectTrack(i)
        }

        muxer.stop()
        muxer.release()
        extractor.release()
    }

    @ReactMethod
    fun getVersion(promise: Promise) {
        try {
            promise.resolve("c2pa-bridge 0.1.0")
        } catch (e: Exception) {
            promise.reject("ERROR", e.message, e)
        }
    }

    /**
     * BitmapFactoryはEXIF回転を適用しないため、手動で正しい向きに変換する
     * 返り値はmutableなBitmap
     */
    private fun applyExifOrientation(bitmap: Bitmap, filePath: String): Bitmap {
        return try {
            val exif = ExifInterface(filePath)
            val orientation = exif.getAttributeInt(
                ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL
            )
            val matrix = Matrix()
            when (orientation) {
                ExifInterface.ORIENTATION_ROTATE_90 -> matrix.postRotate(90f)
                ExifInterface.ORIENTATION_ROTATE_180 -> matrix.postRotate(180f)
                ExifInterface.ORIENTATION_ROTATE_270 -> matrix.postRotate(270f)
                ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.preScale(-1f, 1f)
                ExifInterface.ORIENTATION_FLIP_VERTICAL -> matrix.preScale(1f, -1f)
                ExifInterface.ORIENTATION_TRANSPOSE -> { matrix.postRotate(90f); matrix.preScale(-1f, 1f) }
                ExifInterface.ORIENTATION_TRANSVERSE -> { matrix.postRotate(270f); matrix.preScale(-1f, 1f) }
                else -> {
                    // 回転不要 → mutable コピーだけ返す
                    return if (bitmap.isMutable) bitmap
                    else bitmap.copy(Bitmap.Config.ARGB_8888, true)
                }
            }
            Log.d(TAG, "applyExifOrientation: orientation=$orientation, ${bitmap.width}x${bitmap.height}")
            val rotated = Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
            // createBitmap が新しい Bitmap を返した場合は mutable コピーにする
            if (rotated.isMutable) rotated
            else rotated.copy(Bitmap.Config.ARGB_8888, true)
        } catch (e: Exception) {
            Log.w(TAG, "applyExifOrientation failed, using original", e)
            if (bitmap.isMutable) bitmap
            else bitmap.copy(Bitmap.Config.ARGB_8888, true)
        }
    }

    /**
     * パスまたはcontent:// URIを実ファイルに変換
     * content://の場合はキャッシュにコピーする
     */
    private fun resolveToFile(path: String): File? {
        // すでにファイルパスの場合
        if (path.startsWith("/")) {
            return File(path)
        }

        // file:// URI
        if (path.startsWith("file://")) {
            return File(Uri.parse(path).path ?: return null)
        }

        // content:// URI → キャッシュにコピー
        if (path.startsWith("content://") || path.startsWith("ph://")) {
            try {
                val uri = Uri.parse(path)
                val context = reactApplicationContext
                // MIMEタイプから拡張子を推定
                val mimeType = context.contentResolver.getType(uri)
                val ext = when (mimeType) {
                    "image/jpeg" -> "jpg"
                    "image/png" -> "png"
                    "image/webp" -> "webp"
                    "image/heif", "image/heic" -> "heic"
                    "image/avif" -> "avif"
                    "image/gif" -> "gif"
                    "image/tiff" -> "tiff"
                    "video/mp4" -> "mp4"
                    "video/quicktime" -> "mov"
                    "video/avi" -> "avi"
                    else -> uri.lastPathSegment?.substringAfterLast('.', "jpg") ?: "jpg"
                }
                val inputStream = context.contentResolver.openInputStream(uri) ?: return null
                val tempFile = File(context.cacheDir, "c2pa_input_${System.currentTimeMillis()}.$ext")
                FileOutputStream(tempFile).use { output ->
                    inputStream.copyTo(output)
                }
                inputStream.close()
                Log.d(TAG, "Copied content URI to: ${tempFile.absolutePath} (${tempFile.length()} bytes)")
                return tempFile
            } catch (e: Exception) {
                Log.e(TAG, "Failed to resolve content URI: $path", e)
                return null
            }
        }

        return null
    }

    private fun loadAssetAsString(assetPath: String): String? {
        return try {
            reactApplicationContext.assets.open(assetPath).bufferedReader().readText()
        } catch (e: Exception) {
            Log.e(TAG, "Failed to load asset: $assetPath", e)
            null
        }
    }
}
