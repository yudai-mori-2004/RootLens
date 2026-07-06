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
// アスペクト挙動: ARSCNView は自分の viewport を camera 映像で fill (= 比率が違えば crop) する。
// そこで scnView の frame をカメラ比率ちょうどで view の内側に収める (= aspect-fit / contain)。
// scnView 自身の比率がカメラと一致するので crop は発生せず、 録画される全画角がそのまま見える。
// 余白 (= 横長画面に 4:3 なら左右) は黒帯になる。 プレビューで切れて見えると「録画も切れている」
// ように誤解されるため、 fill ではなく fit を採用 (2026-07-05)。
//
// カメラ aspect は ARKit が選んでいる videoFormat から取得 (= iPhone 12 系 1920x1440 の 4:3)。

final class ArkitCapturePreviewView: ExpoView {
  private let scnView = ARSCNView(frame: .zero)

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    clipsToBounds = true
    addSubview(scnView)
    scnView.session = ArkitCaptureController.shared.arSession
    scnView.automaticallyUpdatesLighting = true
    // 画面消灯 (= 長時間録画): 黒画面の下で 60fps 描画を続けない。 GPU / 帯域ぶんの発熱を削る。
    NotificationCenter.default.addObserver(
      self, selector: #selector(onDimChanged(_:)), name: .rootlensPreviewDim, object: nil)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) not supported") }

  deinit { NotificationCenter.default.removeObserver(self) }

  @objc private func onDimChanged(_ n: Notification) {
    let dimmed = (n.userInfo?["dimmed"] as? Bool) ?? false
    scnView.isHidden = dimmed
    // hidden でも display link が回り得るので描画レートも落とす (0 = デフォルトに復帰)。
    scnView.preferredFramesPerSecond = dimmed ? 1 : 0
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    layoutScnViewAspectFit()
  }

  // カメラ aspect (= sensor 比率) を display orientation に変換して、 view に aspect-fit するための
  // scnView frame を計算する。
  //
  // - sensor 比率: 例えば iPhone 12 ARWorldTracking = 1920×1440 (= 4:3 横長)
  // - display orientation が portrait なら、 camera は 90° 回転して 3:4 縦長として描画される
  // - landscape なら sensor のまま 4:3 横長
  // 計算した「display 上のカメラ比率」 のまま view bounds の内側いっぱいに収まる frame を決める。
  private func layoutScnViewAspectFit() {
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
      // view の方が camera より wide。 高さ基準で収めて左右に黒帯。
      scnH = viewH
      scnW = viewH * cameraAR
    } else {
      // view の方が camera より tall。 幅基準で収めて上下に黒帯。
      scnW = viewW
      scnH = viewW / cameraAR
    }
    let target = CGRect(x: (viewW - scnW) / 2, y: (viewH - scnH) / 2, width: scnW, height: scnH)
    // 実際に変わる時だけ frame を触る (= 毎 layout の再設定で描画が揺れない)
    if !scnView.frame.equalTo(target) {
      scnView.frame = target
    }

    // sensor 解像度が未確定 (= session 起動前) の間はデフォルト比で仮組みしているので、
    // 確定後に一度だけ組み直す (= layoutSubviews は bounds 変化でしか呼ばれないため自前で再試行)。
    if sensorRes.width == 0, !relayoutScheduled {
      relayoutScheduled = true
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
        self?.relayoutScheduled = false
        self?.setNeedsLayout()
      }
    }
  }

  private var relayoutScheduled = false
}
