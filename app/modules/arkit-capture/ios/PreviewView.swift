import ARKit
import ExpoModulesCore
import SceneKit
import UIKit

// ARKit プレビュー View。
//
// session の起動 / 停止は一切しない (= WideCapturePreviewView と同じく「描画専用」)。
// ARSession のライフサイクルは dataflow 層 (= arkitConfig.startSession/stopSession →
// ArkitCaptureController) が排他制御する。 View はその session に attach して描画するだけ。
//
// ⚠ 以前は didMoveToWindow で startSession/stopSession を自動で呼んでいたが、 これだと
//    構成切替 (ultra_wide ⇄ arkit) 時に View の mount/unmount が JS のカメラ直列化と独立に
//    session を起動し、 AVCaptureSession と ARSession がカメラ (排他リソース) を奪い合って
//    FigCaptureSession がクラッシュした。 session 制御を JS 一本に寄せて競合を断つ。
//
// アスペクト挙動: ARSCNView は内部で `displayTransform(for:viewportSize:)` を使って camera
// 映像を view に貼り付ける。 default の挙動だと iPhone 12 のような縦長 / 横長 display で
// カメラ (4:3) との比率差が letterbox (= 黒い領域) として残る。
//
// 対策: parent の bounds を超えるサイズで scnView を配置 (= aspect-fill / overscan) し、
// parent 側で clipsToBounds = true でクリップする。 view aspect とカメラ aspect から
// scnView の frame を毎レイアウト計算する。
//
// カメラ aspect は ARKit が選んでいる videoFormat から取得。 iPhone 12 系は 4:3、
// iPhone 14 Pro+ で ultra-wide を選んだ場合は別の aspect になる。

final class ArkitCapturePreviewView: ExpoView {
  private let scnView = ARSCNView(frame: .zero)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    clipsToBounds = true
    addSubview(scnView)
    scnView.session = ArkitCaptureController.shared.arSession
    scnView.automaticallyUpdatesLighting = true
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) not supported") }

  override func layoutSubviews() {
    super.layoutSubviews()
    layoutScnViewAspectFill()
  }

  // カメラ aspect (= sensor 比率) を display orientation に変換して、 view を aspect-fill するための
  // scnView frame を計算する。
  //
  // - sensor 比率: 例えば iPhone 12 ARWorldTracking = 1920×1440 (= 4:3 横長)
  // - display orientation が portrait なら、 camera は 90° 回転して 3:4 縦長として描画される
  // - landscape なら sensor のまま 4:3 横長
  // 計算した「display 上のカメラ比率」 を view bounds に対して aspect-fill (= 大きい方を超過させて
  // crop) するように scnView の frame を決める。
  private func layoutScnViewAspectFill() {
    let viewW = bounds.width
    let viewH = bounds.height
    guard viewW > 0, viewH > 0 else { return }

    // sensor (= ARKit が選んだ videoFormat) の解像度を取得
    let sensorRes = ArkitCaptureController.shared.currentSensorResolution()
    let sensorW = sensorRes.width > 0 ? sensorRes.width : 1920
    let sensorH = sensorRes.height > 0 ? sensorRes.height : 1440

    // display 上の camera 比率 (= w / h)
    // ARKit capturedImage は sensor の native (= landscape) 向き。 device orientation が portrait
    // なら 90° 回転されて描画されるので、 比率も逆数になる。
    let isPortrait = viewH > viewW
    let cameraAR: CGFloat = isPortrait
      ? sensorH / sensorW   // portrait: 1440/1920 = 0.75
      : sensorW / sensorH   // landscape: 1920/1440 = 1.33

    let viewAR = viewW / viewH

    let scnW: CGFloat
    let scnH: CGFloat
    if viewAR > cameraAR {
      // view の方が camera より wide。 高さを超過させて crop。
      scnW = viewW
      scnH = viewW / cameraAR
    } else {
      // view の方が camera より tall。 幅を超過させて crop。
      scnH = viewH
      scnW = viewH * cameraAR
    }
    scnView.frame = CGRect(x: (viewW - scnW) / 2, y: (viewH - scnH) / 2, width: scnW, height: scnH)
  }
}
