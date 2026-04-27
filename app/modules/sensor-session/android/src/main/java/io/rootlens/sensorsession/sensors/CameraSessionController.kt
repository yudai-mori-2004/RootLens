package io.rootlens.sensorsession.sensors

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.ImageFormat
import android.hardware.camera2.CameraAccessException
import android.hardware.camera2.CameraCaptureSession
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraDevice
import android.hardware.camera2.CameraManager
import android.hardware.camera2.CameraMetadata
import android.hardware.camera2.CaptureRequest
import android.hardware.camera2.CaptureResult
import android.hardware.camera2.TotalCaptureResult
import android.hardware.camera2.params.OutputConfiguration
import android.hardware.camera2.params.SessionConfiguration
import android.media.Image
import android.media.ImageReader
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.util.Size
import android.view.Surface
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.Executor
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * AVCaptureSession 相当 — Process 内で 1 個だけ持つ singleton。
 * Camera2Sensor が capture に使い、PreviewView がプレビュー描画 Surface を attach する。
 *
 * Plan C: expo-camera は撤去 (session 競合を避ける)。
 * exclusivityGroup="android.camera2" で集約。Task 04 で ARCore depth / Camera2 DEPTH16 系が乗る。
 *
 * API レスポンスをそのまま記録 (Don't be the judge):
 *   capture 結果の payload は CameraCharacteristics / TotalCaptureResult のプロパティを raw に。
 *   RootLens 独自分類は持たない。
 */
class CameraSessionController private constructor(private val appContext: Context) {

  companion object {
    private const val TAG = "CameraSessionController"
    @Volatile private var INSTANCE: CameraSessionController? = null

    fun get(context: Context): CameraSessionController {
      INSTANCE?.let { return it }
      synchronized(this) {
        INSTANCE?.let { return it }
        val c = CameraSessionController(context.applicationContext)
        INSTANCE = c
        return c
      }
    }
  }

  private val cameraManager: CameraManager =
    appContext.getSystemService(Context.CAMERA_SERVICE) as CameraManager

  // Camera2 が callback を呼ぶ用のスレッド (single-threaded HandlerThread)。
  // 注: configureIfNeeded() / rebuildSession() の実行スレッドにはしない。
  //     openCamera() / createCaptureSession() の callback 配送がここで起きるため、
  //     同じスレッドで suspend を待つと自己ロックする。
  private val backgroundThread = HandlerThread("rootlens-camera").apply { start() }
  private val backgroundHandler = Handler(backgroundThread.looper)
  private val backgroundExecutor = Executor { backgroundHandler.post(it) }

  // configure / rebuild を駆動する dedicated coroutine scope (Dispatchers.IO)。
  // Camera2 callback の到着スレッド (backgroundHandler) とは別なのでデッドロックしない。
  private val ctlScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val configMutex = Mutex()

  private var cameraId: String? = null
  private var characteristics: CameraCharacteristics? = null
  private var device: CameraDevice? = null
  private var session: CameraCaptureSession? = null
  private var jpegReader: ImageReader? = null
  private var jpegSize: Size? = null
  private var previewSurface: Surface? = null
  private var previewRequestBuilder: CaptureRequest.Builder? = null
  private var currentFacing: Int = CameraCharacteristics.LENS_FACING_BACK

  // 動画録画モード (Task 03)
  private var videoEncoderSurface: Surface? = null
  private var inVideoMode: Boolean = false

  // Camera 切替時のリスナー (PreviewView が aspect ratio + transform を再計算する用)
  private val cameraChangedListeners: MutableList<() -> Unit> = mutableListOf()
  fun addCameraChangedListener(l: () -> Unit) { synchronized(lock) { cameraChangedListeners.add(l) } }
  fun removeCameraChangedListener(l: () -> Unit) { synchronized(lock) { cameraChangedListeners.remove(l) } }
  private fun notifyCameraChanged() {
    val ls = synchronized(lock) { cameraChangedListeners.toList() }
    Handler(Looper.getMainLooper()).post { ls.forEach { it() } }
  }

  // Depth output (Task 04: Camera2 DEPTH16 multi-stream)
  private var depthReader: ImageReader? = null
  private var depthSize: Size? = null
  private var hasDepthCapability: Boolean = false

  // capturePhotoBundle の 1 ショット結果共有用 (Camera2Sensor + Camera2Depth16Sensor が同 anchor で呼ぶ前提)
  private val bundleMutex = Mutex()
  private var bundleAnchorKey: Long = 0L
  private var bundleResult: CapturedBundle? = null

  private val lock = Any()

  // ---------------- Permission ----------------

  fun hasCameraPermission(): Boolean =
    ContextCompat.checkSelfPermission(appContext, Manifest.permission.CAMERA) ==
      PackageManager.PERMISSION_GRANTED

  // ---------------- Configuration / Lifecycle ----------------

  /**
   * Idempotent。device + jpeg ImageReader の準備。preview Surface が後から attach されたら
   * rebuildSession() で session を再構築する。
   * 呼び出し元: Camera2Sensor.descriptor / Camera2Sensor.capture (Dispatchers.Default)
   */
  suspend fun configureIfNeeded() {
    configMutex.withLock {
      configureIfNeededInternal()
    }
  }

  private fun pickCameraId(facing: Int): String? {
    return cameraManager.cameraIdList.firstOrNull {
      val c = cameraManager.getCameraCharacteristics(it)
      c.get(CameraCharacteristics.LENS_FACING) == facing
    } ?: cameraManager.cameraIdList.firstOrNull()
  }

  /** depth output capability を持つ camera を facing 指定で優先選択する (Task 04) */
  private fun pickDepthCameraId(facing: Int): String? {
    for (id in cameraManager.cameraIdList) {
      try {
        val c = cameraManager.getCameraCharacteristics(id)
        if (c.get(CameraCharacteristics.LENS_FACING) != facing) continue
        val caps = c.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)?.toList() ?: continue
        if (caps.contains(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_DEPTH_OUTPUT)) {
          val sizes = c.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
            ?.getOutputSizes(ImageFormat.DEPTH16)
          if (sizes != null && sizes.isNotEmpty()) {
            Log.i(TAG, "pickDepthCameraId: selected id=$id facing=$facing")
            return id
          }
        }
      } catch (_: Throwable) { /* skip */ }
    }
    return null
  }

  private suspend fun openCamera(id: String): CameraDevice = suspendCancellableCoroutine { cont ->
    try {
      cameraManager.openCamera(id, object : CameraDevice.StateCallback() {
        override fun onOpened(d: CameraDevice) { cont.resume(d) }
        override fun onDisconnected(d: CameraDevice) {
          d.close()
          if (cont.isActive) cont.resumeWithException(
            CameraAccessException(CameraAccessException.CAMERA_DISCONNECTED, "disconnected")
          )
        }
        override fun onError(d: CameraDevice, error: Int) {
          d.close()
          if (cont.isActive) cont.resumeWithException(
            CameraAccessException(CameraAccessException.CAMERA_ERROR, "openCamera error: $error")
          )
        }
      }, backgroundHandler)
    } catch (e: CameraAccessException) {
      if (cont.isActive) cont.resumeWithException(e)
    } catch (e: SecurityException) {
      if (cont.isActive) cont.resumeWithException(e)
    }
  }

  /**
   * Camera2 は preview Surface を後から追加できないため、session を作り直す。
   * mode に応じて出力 Surface 構成を切り替える:
   *  - photo モード: [jpegReader.surface, previewSurface?]
   *  - video モード: [videoEncoderSurface, previewSurface?] (jpegReader は外す)
   */
  private suspend fun rebuildSession() {
    val snap = synchronized(lock) {
      SessionSnap(device, jpegReader, depthReader, previewSurface, videoEncoderSurface, inVideoMode)
    }
    val cam = snap.device
    val jpeg = snap.jpeg
    val depth = snap.depth
    val preview = snap.preview
    val encoderSurface = snap.encoderSurface
    val videoMode = snap.videoMode
    if (cam == null) return

    val outputs = mutableListOf<Surface>()
    if (videoMode && encoderSurface != null) {
      outputs.add(encoderSurface)
      // 動画モードでは depth は出力しない (CAMM track 諸々と組み合わせると複雑)。
      // 動画 depth キーフレーム抽出は Phase 5 で別経路 (Camera2 reprocess または別 capture request) で扱う
    } else if (jpeg != null) {
      outputs.add(jpeg.surface)
      // 静止画モード: depth output が利用可能なら同 session に追加 (multi-stream)。
      // TEMPLATE_STILL_CAPTURE が 1 トリガーで JPEG + DEPTH16 の両方を出す。
      depth?.let { outputs.add(it.surface) }
    } else {
      Log.w(TAG, "rebuildSession: no primary output (no jpeg + no encoder)")
      return
    }
    preview?.let { outputs.add(it) }

    val newSession = createCaptureSession(cam, outputs)
    synchronized(lock) {
      session?.close()
      session = newSession
    }

    if (videoMode && encoderSurface != null) {
      startVideoRepeating(cam, newSession, encoderSurface, preview)
    } else {
      preview?.let { startPreview(cam, newSession, it) }
    }
  }

  /** rebuildSession で synchronized 内から取り出す snapshot */
  private data class SessionSnap(
    val device: CameraDevice?,
    val jpeg: ImageReader?,
    val depth: ImageReader?,
    val preview: Surface?,
    val encoderSurface: Surface?,
    val videoMode: Boolean
  )

  private suspend fun createCaptureSession(
    cam: CameraDevice,
    surfaces: List<Surface>
  ): CameraCaptureSession = suspendCancellableCoroutine { cont ->
    val callback = object : CameraCaptureSession.StateCallback() {
      override fun onConfigured(s: CameraCaptureSession) {
        if (cont.isActive) cont.resume(s)
      }
      override fun onConfigureFailed(s: CameraCaptureSession) {
        if (cont.isActive) cont.resumeWithException(
          CameraAccessException(CameraAccessException.CAMERA_ERROR, "session configure failed")
        )
      }
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      val configs = surfaces.map { OutputConfiguration(it) }
      cam.createCaptureSession(
        SessionConfiguration(SessionConfiguration.SESSION_REGULAR, configs, backgroundExecutor, callback)
      )
    } else {
      @Suppress("DEPRECATION")
      cam.createCaptureSession(surfaces, callback, backgroundHandler)
    }
  }

  private fun startPreview(cam: CameraDevice, sess: CameraCaptureSession, preview: Surface) {
    try {
      val builder = cam.createCaptureRequest(CameraDevice.TEMPLATE_PREVIEW).apply {
        addTarget(preview)
        set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO)
        set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
      }
      previewRequestBuilder = builder
      sess.setRepeatingRequest(builder.build(), null, backgroundHandler)
    } catch (e: Throwable) {
      Log.w(TAG, "startPreview failed: ${e.message}")
    }
  }

  /** 録画用の repeating request: encoder surface (+ optional preview) を target にして 30fps で流す */
  private fun startVideoRepeating(
    cam: CameraDevice,
    sess: CameraCaptureSession,
    encoderSurface: Surface,
    preview: Surface?
  ) {
    try {
      val builder = cam.createCaptureRequest(CameraDevice.TEMPLATE_RECORD).apply {
        addTarget(encoderSurface)
        preview?.let { addTarget(it) }
        set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO)
        set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_VIDEO)
        // 30fps target FPS range は機種依存。auto に任せると安定しないことがあるので明示
        set(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, android.util.Range(30, 30))
      }
      previewRequestBuilder = builder
      sess.setRepeatingRequest(builder.build(), null, backgroundHandler)
      Log.i(TAG, "video repeating started")
    } catch (e: Throwable) {
      Log.w(TAG, "startVideoRepeating failed: ${e.message}", e)
    }
  }

  // ---------------- Preview attach (called by PreviewView) ----------------

  fun setPreviewSurface(s: Surface?) {
    synchronized(lock) {
      if (previewSurface == s) return
      previewSurface = s
    }
    // ctlScope で実行 (Dispatchers.IO)。backgroundHandler の callback と別スレッドなので
    // configureIfNeeded / openCamera の suspend 待ちが安全に行える。
    ctlScope.launch {
      configMutex.withLock {
        try {
          rebuildSessionIfReady()
        } catch (t: Throwable) {
          Log.w(TAG, "rebuildSessionIfReady failed: ${t.message}", t)
        }
      }
    }
  }

  private suspend fun rebuildSessionIfReady() {
    if (synchronized(lock) { device } == null) {
      configureIfNeededInternal()
    } else {
      rebuildSession()
    }
  }

  // configureIfNeeded の内部実装 (mutex は呼出側で取る)
  private suspend fun configureIfNeededInternal() {
    if (!hasCameraPermission()) {
      throw CameraAccessException(CameraAccessException.CAMERA_DISABLED, "CAMERA permission not granted")
    }
    val needConfigure = synchronized(lock) { device == null }
    if (!needConfigure) return

    Log.i(TAG, "configureIfNeededInternal: starting")
    val targetId = pickDepthCameraId(currentFacing) ?: pickCameraId(currentFacing) ?: throw CameraAccessException(
      CameraAccessException.CAMERA_ERROR,
      "no camera available for facing=$currentFacing"
    )
    val chr = cameraManager.getCameraCharacteristics(targetId)
    val streamMap = chr.get(CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
      ?: throw CameraAccessException(CameraAccessException.CAMERA_ERROR, "no stream config map")

    val jpegSizes = streamMap.getOutputSizes(ImageFormat.JPEG)
      ?: throw CameraAccessException(CameraAccessException.CAMERA_ERROR, "no JPEG sizes")
    val largestJpeg = jpegSizes.maxByOrNull { it.width.toLong() * it.height.toLong() }!!
    val jReader = ImageReader.newInstance(largestJpeg.width, largestJpeg.height, ImageFormat.JPEG, 2)

    // DEPTH16 stream (Task 04) — REQUEST_AVAILABLE_CAPABILITIES に DEPTH_OUTPUT があれば取れる
    val capabilities = chr.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)?.toList() ?: emptyList()
    val supportsDepth = capabilities.contains(
      CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES_DEPTH_OUTPUT
    )
    var dReader: ImageReader? = null
    var dSize: Size? = null
    if (supportsDepth) {
      val depthSizes = streamMap.getOutputSizes(ImageFormat.DEPTH16)
      if (depthSizes != null && depthSizes.isNotEmpty()) {
        // 最大解像度の depth (Pixel 系では小さめな場合多い)
        val largestDepth = depthSizes.maxByOrNull { it.width.toLong() * it.height.toLong() }!!
        dReader = ImageReader.newInstance(largestDepth.width, largestDepth.height, ImageFormat.DEPTH16, 2)
        dSize = largestDepth
        Log.i(TAG, "configureIfNeededInternal: DEPTH16 supported, size=${largestDepth.width}x${largestDepth.height}")
      } else {
        Log.i(TAG, "configureIfNeededInternal: DEPTH_OUTPUT capability declared but no DEPTH16 output sizes")
      }
    } else {
      Log.i(TAG, "configureIfNeededInternal: no DEPTH_OUTPUT capability on this camera")
    }

    val opened = openCamera(targetId)
    Log.i(TAG, "configureIfNeededInternal: camera opened id=$targetId jpeg=${largestJpeg.width}x${largestJpeg.height} depth=${dSize?.let { "${it.width}x${it.height}" } ?: "none"}")

    synchronized(lock) {
      cameraId = targetId
      characteristics = chr
      device = opened
      jpegReader = jReader
      jpegSize = largestJpeg
      depthReader = dReader
      depthSize = dSize
      hasDepthCapability = supportsDepth && dReader != null
    }

    rebuildSession()
  }

  // ---------------- Camera facing 切替 (Task 05) ----------------

  /**
   * facing を切り替える: 現 device を close → 新 facing で open → session 再構築。
   * preview surface はそのまま継承される。switchCameraFacing 完了後に
   * cameraChangedListeners が呼ばれ、PreviewView 等が aspect ratio を再計算する。
   */
  suspend fun switchCameraFacing(facing: Int) {
    if (facing == CameraCharacteristics.LENS_FACING_BACK || facing == CameraCharacteristics.LENS_FACING_FRONT) {
      // OK
    } else {
      throw IllegalArgumentException("invalid facing: $facing")
    }
    configMutex.withLock {
      if (currentFacing == facing && device != null) return@withLock
      Log.i(TAG, "switchCameraFacing: $currentFacing -> $facing")
      // 既存 device close
      try { session?.close() } catch (_: Throwable) {}
      try { device?.close() } catch (_: Throwable) {}
      try { jpegReader?.close() } catch (_: Throwable) {}
      try { depthReader?.close() } catch (_: Throwable) {}
      synchronized(lock) {
        session = null
        device = null
        jpegReader = null
        depthReader = null
        characteristics = null
        cameraId = null
        currentFacing = facing
      }
      // 新 facing で再構成
      configureIfNeededInternal()
    }
    notifyCameraChanged()
  }

  fun currentFacingValue(): Int = synchronized(lock) { currentFacing }

  // ---------------- Depth probing helpers (Task 04) ----------------

  fun hasDepthSupport(): Boolean = synchronized(lock) { hasDepthCapability }
  fun currentDepthSize(): Pair<Int, Int>? = synchronized(lock) {
    depthSize?.let { it.width to it.height }
  }

  // ---------------- Descriptor ----------------

  fun currentDeviceDescriptor(): Map<String, Any?> {
    val id = synchronized(lock) { cameraId } ?: return mapOf(
      "configured" to false
    )
    val c = synchronized(lock) { characteristics } ?: return mapOf(
      "configured" to false,
      "camera_id" to id
    )
    val info = mutableMapOf<String, Any?>(
      "configured" to true,
      "camera_id" to id,
      "lens_facing" to c.get(CameraCharacteristics.LENS_FACING),
      "supported_hardware_level" to c.get(CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL),
      "sensor_orientation" to c.get(CameraCharacteristics.SENSOR_ORIENTATION),
      "available_capabilities" to (c.get(CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)?.toList() ?: emptyList<Int>()),
      "active_array_size" to c.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)?.toString(),
      "physical_size" to c.get(CameraCharacteristics.SENSOR_INFO_PHYSICAL_SIZE)?.let {
        mapOf("width_mm" to it.width, "height_mm" to it.height)
      },
      "jpeg_size" to synchronized(lock) { jpegSize }?.let {
        mapOf("width" to it.width, "height" to it.height)
      },
      "session_running" to synchronized(lock) { session != null }
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
      info["sensor_info_timestamp_source"] = c.get(CameraCharacteristics.SENSOR_INFO_TIMESTAMP_SOURCE)
    }
    return info
  }

  // ---------------- Video Stream (Task 03) ----------------

  /**
   * 動画録画モードに切り替える。VideoEncoder を構築し、その input surface を Camera2 capture session に
   * 含めた状態で repeating request を流す。返した VideoEncoder の drain thread が encoded frame を
   * StreamRecorder の video track に書き込む。
   *
   * 録画中は静止画 capturePhoto() は呼ばない前提 (jpegReader を session から外しているため)。
   */
  suspend fun startVideoStream(recorder: io.rootlens.sensorsession.stream.StreamRecorder): VideoEncoder {
    configureIfNeeded()
    val targetSize = synchronized(lock) { jpegSize } ?: throw CameraAccessException(
      CameraAccessException.CAMERA_ERROR, "no JPEG size determined"
    )
    // 動画解像度: 1080p 以下に丸めて safe な範囲にする (機種依存の encoder 上限を踏まないため)
    val videoWidth = targetSize.width.coerceAtMost(1920)
    val videoHeight = targetSize.height.coerceAtMost(1080)

    val encoder = VideoEncoder(
      width = videoWidth,
      height = videoHeight,
      frameRate = 30,
      bitrate = 8_000_000,
      iFrameIntervalSec = 1,
      recorder = recorder
    )

    synchronized(lock) {
      videoEncoderSurface = encoder.inputSurface
      inVideoMode = true
    }

    // session 再構築 (encoder surface を含む構成に切り替え)
    rebuildSession()

    // drain thread を session 構築後に開始 (output format change 通知でmuxer.start するため)
    encoder.startDrainThread()

    return encoder
  }

  /** 動画モード終了 → 静止画 (jpegReader) モードに戻す */
  suspend fun stopVideoStream() {
    synchronized(lock) {
      videoEncoderSurface = null
      inVideoMode = false
    }
    rebuildSession()
  }

  // ---------------- Photo / Depth Bundle Capture ----------------

  data class CapturedPhoto(
    val outputPath: String,
    val captureNs: Long,
    val endNs: Long,
    val resultMetadata: Map<String, Any?>,
    val deviceInfo: Map<String, Any?>
  )

  /** DEPTH16 raw 1 frame */
  data class CapturedDepth(
    val width: Int,
    val height: Int,
    val pixelFormat: String,         // "DEPTH16"
    val rawBytesLE: ByteArray,       // 16-bit unsigned little-endian, lower 13 bits = mm or calibrated, upper 3 bits = confidence
    val captureNs: Long,
    val endNs: Long,
    val intrinsics: Map<String, Any?>,
    val deviceInfo: Map<String, Any?>
  )

  /** capturePhotoBundle の結果。両方が揃って返る。jpeg は必須、depth は対応機種でのみ非 null。 */
  data class CapturedBundle(
    val jpeg: CapturedPhoto,
    val depth: CapturedDepth?
  )

  /**
   * JPEG (+ DEPTH16) を 1 トリガーで同時取得する。
   * 同 anchorKey で複数回呼ばれた場合、先頭のキャプチャ結果を共有する (Camera2Sensor + Camera2Depth16Sensor が
   * 同じ SensorTimeWindow.anchorMonotonicNs で並列に呼ぶ前提)。
   */
  suspend fun captureBundle(anchorKey: Long): CapturedBundle {
    bundleMutex.withLock {
      bundleResult?.let { cached ->
        if (bundleAnchorKey == anchorKey) return cached
      }
      val bundle = doCaptureBundle()
      bundleAnchorKey = anchorKey
      bundleResult = bundle
      return bundle
    }
  }

  /** 後方互換: jpeg だけ欲しい呼び出し用。anchorKey 0 で新規 capture を 1 ショット起こす */
  suspend fun capturePhoto(): CapturedPhoto =
    captureBundle(SystemClock.elapsedRealtimeNanos()).jpeg

  private suspend fun doCaptureBundle(): CapturedBundle = withContext(Dispatchers.Default) {
    configureIfNeeded()
    val cam: CameraDevice
    val jpeg: ImageReader
    val depth: ImageReader?
    val sess: CameraCaptureSession
    val depthSizeLocal: Size?
    synchronized(lock) {
      val c = device ?: throw CameraAccessException(CameraAccessException.CAMERA_ERROR, "camera not ready (device)")
      val j = jpegReader ?: throw CameraAccessException(CameraAccessException.CAMERA_ERROR, "camera not ready (jpeg)")
      val s = session ?: throw CameraAccessException(CameraAccessException.CAMERA_ERROR, "camera not ready (session)")
      cam = c; jpeg = j; sess = s; depth = depthReader; depthSizeLocal = depthSize
    }

    val captureNs = SystemClock.elapsedRealtimeNanos()
    var jpegImage: Image? = null
    var depthImage: Image? = null
    var result: TotalCaptureResult? = null
    val needDepth = depth != null

    suspendCancellableCoroutine<CapturedBundle> { cont ->
      val handler = Handler(backgroundThread.looper)

      val finalize = lambda@{
        val ji = jpegImage ?: return@lambda
        val r = result ?: return@lambda
        if (needDepth && depthImage == null) return@lambda
        try {
          // JPEG 書き出し
          val outDir = appContext.cacheDir
          val outPath = File(outDir, "rootlens_capture_$captureNs.jpg").absolutePath
          val jb = ji.planes[0].buffer
          val jBytes = ByteArray(jb.remaining())
          jb.get(jBytes)
          FileOutputStream(outPath).use { it.write(jBytes) }

          val endNs = SystemClock.elapsedRealtimeNanos()
          val metaSummary = summarizeCaptureResult(r)
          val deviceInfo = currentDeviceDescriptor()
          val photo = CapturedPhoto(outPath, captureNs, endNs, metaSummary, deviceInfo)

          // DEPTH16 1 frame
          var depthCap: CapturedDepth? = null
          val di = depthImage
          if (di != null) {
            val w = di.width
            val h = di.height
            val plane = di.planes[0]
            val buf = plane.buffer
            // 行ごとに rowStride で並ぶ可能性あり。pixelStride は 2 (uint16)。
            val rawLE = ByteArray(w * h * 2)
            val rowStride = plane.rowStride
            val pixStride = plane.pixelStride
            if (rowStride == w * pixStride && pixStride == 2) {
              buf.get(rawLE)
            } else {
              // strided コピー
              val rowBuf = ByteArray(rowStride)
              var off = 0
              for (row in 0 until h) {
                buf.position(row * rowStride)
                buf.get(rowBuf, 0, rowStride)
                System.arraycopy(rowBuf, 0, rawLE, off, w * 2)
                off += w * 2
              }
            }
            val intrinsics = currentDepthIntrinsics(w, h)
            depthCap = CapturedDepth(
              width = w,
              height = h,
              pixelFormat = "DEPTH16",
              rawBytesLE = rawLE,
              captureNs = captureNs,
              endNs = endNs,
              intrinsics = intrinsics,
              deviceInfo = deviceInfo
            )
          }

          if (cont.isActive) cont.resume(CapturedBundle(photo, depthCap))
        } catch (t: Throwable) {
          if (cont.isActive) cont.resumeWithException(t)
        } finally {
          jpegImage?.close(); jpegImage = null
          depthImage?.close(); depthImage = null
          result = null
        }
        Unit
      }

      jpeg.setOnImageAvailableListener({ reader ->
        try {
          jpegImage = reader.acquireLatestImage()
          finalize()
        } catch (t: Throwable) {
          if (cont.isActive) cont.resumeWithException(t)
        }
      }, handler)
      depth?.setOnImageAvailableListener({ reader ->
        try {
          depthImage = reader.acquireLatestImage()
          finalize()
        } catch (t: Throwable) {
          if (cont.isActive) cont.resumeWithException(t)
        }
      }, handler)

      try {
        val builder = cam.createCaptureRequest(CameraDevice.TEMPLATE_STILL_CAPTURE).apply {
          addTarget(jpeg.surface)
          depth?.let { addTarget(it.surface) }
          set(CaptureRequest.CONTROL_MODE, CameraMetadata.CONTROL_MODE_AUTO)
          set(CaptureRequest.CONTROL_AF_MODE, CaptureRequest.CONTROL_AF_MODE_CONTINUOUS_PICTURE)
          set(CaptureRequest.JPEG_ORIENTATION, 90)
        }
        sess.capture(builder.build(), object : CameraCaptureSession.CaptureCallback() {
          override fun onCaptureCompleted(
            session: CameraCaptureSession,
            request: CaptureRequest,
            res: TotalCaptureResult
          ) {
            result = res
            finalize()
          }
          override fun onCaptureFailed(
            session: CameraCaptureSession,
            request: CaptureRequest,
            failure: android.hardware.camera2.CaptureFailure
          ) {
            if (cont.isActive) {
              cont.resumeWithException(
                CameraAccessException(CameraAccessException.CAMERA_ERROR, "capture failed: ${failure.reason}")
              )
            }
          }
        }, handler)
      } catch (t: Throwable) {
        if (cont.isActive) cont.resumeWithException(t)
      }

      cont.invokeOnCancellation {
        try { jpeg.setOnImageAvailableListener(null, handler) } catch (_: Throwable) {}
        try { depth?.setOnImageAvailableListener(null, handler) } catch (_: Throwable) {}
      }
    }
  }

  /** Camera2 LENS_INTRINSIC_CALIBRATION 由来の intrinsics を depth resolution にスケールして返す */
  private fun currentDepthIntrinsics(depthWidth: Int, depthHeight: Int): Map<String, Any?> {
    val c = synchronized(lock) { characteristics } ?: return emptyMap()
    val out = mutableMapOf<String, Any?>(
      "depth_width" to depthWidth,
      "depth_height" to depthHeight
    )
    // SENSOR_INFO_PIXEL_ARRAY_SIZE / SENSOR_INFO_ACTIVE_ARRAY_SIZE — intrinsics の参照寸
    c.get(CameraCharacteristics.SENSOR_INFO_PIXEL_ARRAY_SIZE)?.let {
      out["pixel_array_size"] = mapOf("width" to it.width, "height" to it.height)
    }
    c.get(CameraCharacteristics.SENSOR_INFO_ACTIVE_ARRAY_SIZE)?.let {
      out["active_array_size"] = mapOf(
        "left" to it.left, "top" to it.top, "right" to it.right, "bottom" to it.bottom
      )
    }
    // intrinsic calibration: [fx, fy, cx, cy, s] (5 floats, in pixel units relative to PIXEL_ARRAY_SIZE)
    c.get(CameraCharacteristics.LENS_INTRINSIC_CALIBRATION)?.let {
      out["lens_intrinsic_calibration"] = it.toList()  // [fx, fy, cx, cy, s]
    }
    // lens distortion (radial / tangential)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
      c.get(CameraCharacteristics.LENS_DISTORTION)?.let {
        out["lens_distortion"] = it.toList()
      }
    }
    // poseRotation / poseTranslation (multi-camera 拡張で使う)
    c.get(CameraCharacteristics.LENS_POSE_ROTATION)?.let { out["lens_pose_rotation"] = it.toList() }
    c.get(CameraCharacteristics.LENS_POSE_TRANSLATION)?.let { out["lens_pose_translation"] = it.toList() }
    return out
  }

  private fun summarizeCaptureResult(r: TotalCaptureResult): Map<String, Any?> {
    val out = mutableMapOf<String, Any?>()
    out["sensor_timestamp"] = r.get(CaptureResult.SENSOR_TIMESTAMP)
    out["sensor_exposure_time"] = r.get(CaptureResult.SENSOR_EXPOSURE_TIME)
    out["sensor_sensitivity"] = r.get(CaptureResult.SENSOR_SENSITIVITY)
    out["lens_focal_length"] = r.get(CaptureResult.LENS_FOCAL_LENGTH)
    out["lens_aperture"] = r.get(CaptureResult.LENS_APERTURE)
    out["lens_focus_distance"] = r.get(CaptureResult.LENS_FOCUS_DISTANCE)
    out["control_af_state"] = r.get(CaptureResult.CONTROL_AF_STATE)
    out["control_ae_state"] = r.get(CaptureResult.CONTROL_AE_STATE)
    out["jpeg_orientation"] = r.get(CaptureResult.JPEG_ORIENTATION)
    return out
  }
}
