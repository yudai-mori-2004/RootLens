package io.rootlens.sensorsession

import android.content.Context
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.util.Size
import android.view.Surface
import android.view.TextureView
import android.view.View
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView
import io.rootlens.sensorsession.sensors.CameraSessionController
import kotlin.math.max

/**
 * 撮影中ライブプレビュー View (Plan C)。
 *
 * TextureView ベースで実装する理由:
 *  - SurfaceView だと preview frame の回転 (sensor_orientation 90° vs display portrait) が
 *    自前で吸収できない (View 自体に transform matrix が適用できない)
 *  - TextureView は setTransform(Matrix) で frame の回転 + アスペクト比補正ができる
 *
 * 表示ルール:
 *  - sensor 出力サイズ (横長) と display 方向 (縦) を考慮し、TextureView の measured 寸法を
 *    アスペクト比に合わせる (AutoFit)
 *  - 回転 transform は (sensor_orientation - display_rotation) を適用
 *
 * Task 05: zoom / focus / flash / カメラ切替の UI 連動はここではなく Camera2Sensor 側で受ける。
 */
class SensorPreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {

  private val textureView = AutoFitTextureView(context)
  private val controller: CameraSessionController by lazy { CameraSessionController.get(context) }
  private var currentSurface: SurfaceTexture? = null

  // controller がカメラ切替したときに preview を再構成するリスナー
  private val cameraChangedListener: () -> Unit = {
    val surf = currentSurface
    if (surf != null) {
      configurePreviewSurface(surf, textureView.width, textureView.height)
    }
  }

  init {
    addView(textureView)
    textureView.surfaceTextureListener = object : TextureView.SurfaceTextureListener {
      override fun onSurfaceTextureAvailable(surface: SurfaceTexture, width: Int, height: Int) {
        currentSurface = surface
        configurePreviewSurface(surface, width, height)
      }

      override fun onSurfaceTextureSizeChanged(surface: SurfaceTexture, width: Int, height: Int) {
        currentSurface = surface
        configurePreviewSurface(surface, width, height)
      }

      override fun onSurfaceTextureDestroyed(surface: SurfaceTexture): Boolean {
        currentSurface = null
        controller.setPreviewSurface(null)
        return true
      }

      override fun onSurfaceTextureUpdated(surface: SurfaceTexture) {}
    }
    controller.addCameraChangedListener(cameraChangedListener)
  }

  override fun onDetachedFromWindow() {
    controller.removeCameraChangedListener(cameraChangedListener)
    super.onDetachedFromWindow()
  }

  private fun configurePreviewSurface(surface: SurfaceTexture, viewWidth: Int, viewHeight: Int) {
    val info = controller.currentDeviceDescriptor()
    val sensorOrientation = (info["sensor_orientation"] as? Int) ?: 90
    val lensFacing = (info["lens_facing"] as? Int) ?: 1  // 1=back, 0=front
    val jpegSizeMap = info["jpeg_size"] as? Map<*, *>
    val sensorW = (jpegSizeMap?.get("width") as? Int) ?: 1920
    val sensorH = (jpegSizeMap?.get("height") as? Int) ?: 1080

    // Camera2 は buffer dim を変えても自動 rotation しない (sensor 出力は常に native landscape orientation)。
    // よって buffer を sensor native (landscape) 寸法にセットし、TextureView 側で rotation transform を適用する。
    // preview 用に縮小した landscape (4:3) を使う:
    val previewLandscapeW = 1280
    val previewLandscapeH = previewLandscapeW * sensorH / sensorW  // 4:3 なら 960
    surface.setDefaultBufferSize(previewLandscapeW, previewLandscapeH)

    // View 表示は portrait なので、displayed dims は rotation 込みで W/H swap (sensorOrientation=90/270 のとき)
    val displayW: Int
    val displayH: Int
    if (sensorOrientation % 180 == 90) {
      displayW = previewLandscapeH  // 960 → 横幅
      displayH = previewLandscapeW  // 1280 → 高さ
    } else {
      displayW = previewLandscapeW
      displayH = previewLandscapeH
    }
    textureView.setAspectRatio(displayW, displayH)

    applyPreviewTransform(
      viewWidth = viewWidth,
      viewHeight = viewHeight,
      bufferW = previewLandscapeW,
      bufferH = previewLandscapeH,
      sensorOrientation = sensorOrientation,
      lensFacing = lensFacing
    )
    controller.setPreviewSurface(Surface(surface))
  }

  /**
   * Camera2 + SurfaceTexture の preview transform。
   *
   * 重要な事実: SurfaceTexture が producer (Camera2) から渡される内部 transform matrix を持ち、
   * これに sensor_orientation 由来の rotation が既に含まれている (Android 公式 Camera2 sample が
   * ROTATION_0 portrait で identity matrix を使っているのはこのため)。
   * 我々の setTransform はその上に積み重ねる形になるので、明示的に rotation を加えると
   * 二重回転 (90° → 180° の見え方) になってしまう。
   *
   * よって portrait 表示では:
   *   - buffer 寸法は landscape (camera native) のまま
   *   - TextureView の view aspect は portrait (height:width swap)
   *   - user matrix は identity (または front camera のみ horizontal mirror)
   *
   * AutoFitTextureView が view 寸法を rotated aspect に合わせており、Camera2 の内部 matrix が
   * buffer 内容を正しく rotate して uv マッピングするので、結果として view に upright + 歪みなしで描画される。
   */
  private fun applyPreviewTransform(
    viewWidth: Int,
    viewHeight: Int,
    bufferW: Int,
    bufferH: Int,
    sensorOrientation: Int,
    lensFacing: Int
  ) {
    if (viewWidth == 0 || viewHeight == 0) return
    val matrix = Matrix()
    if (lensFacing == 0) {
      // front camera のみ horizontal mirror (selfie 視覚)
      matrix.postScale(-1f, 1f, viewWidth / 2f, viewHeight / 2f)
    }
    textureView.setTransform(matrix)
  }
}

/**
 * AutoFitTextureView — measured 寸法を camera 出力の aspect ratio に合わせる。
 * 縦長表示でもプレビューが歪まない (中央フィット、横方向は親サイズいっぱい)。
 */
private class AutoFitTextureView(context: Context) : TextureView(context) {
  private var ratioW: Int = 0
  private var ratioH: Int = 0

  fun setAspectRatio(w: Int, h: Int) {
    if (w <= 0 || h <= 0) return
    if (ratioW != w || ratioH != h) {
      ratioW = w
      ratioH = h
      requestLayout()
    }
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    super.onMeasure(widthMeasureSpec, heightMeasureSpec)
    val width = View.MeasureSpec.getSize(widthMeasureSpec)
    val height = View.MeasureSpec.getSize(heightMeasureSpec)
    if (ratioW == 0 || ratioH == 0) {
      setMeasuredDimension(width, height)
      return
    }
    // 横方向は親いっぱい、縦方向は aspect ratio に合わせて調整
    val expectedH = width * ratioH / ratioW
    if (expectedH <= height) {
      setMeasuredDimension(width, expectedH)
    } else {
      val expectedW = height * ratioW / ratioH
      setMeasuredDimension(expectedW, height)
    }
  }
}
