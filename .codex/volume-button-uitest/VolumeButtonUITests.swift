import XCTest

final class VolumeButtonUITests: XCTestCase {
  @MainActor
  private func openSettings(_ app: XCUIApplication) {
    let settings = app.descendants(matching: .any)["設定"]
    XCTAssertTrue(settings.waitForExistence(timeout: 10), "Settings tab was not found")
    settings.tap()
  }

  @MainActor
  private func reveal(_ element: XCUIElement, in app: XCUIApplication) -> Bool {
    guard element.waitForExistence(timeout: 5) else { return false }
    for _ in 0..<10 where !element.isHittable {
      app.scrollViews.firstMatch.swipeUp()
    }
    return element.isHittable
  }

  @MainActor
  private func waitForHorizontalShift(
    _ element: XCUIElement,
    from initialX: CGFloat,
    timeout: TimeInterval = 5
  ) -> Bool {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if abs(element.frame.minX - initialX) > 20 { return true }
      RunLoop.current.run(until: Date().addingTimeInterval(0.1))
    }
    return abs(element.frame.minX - initialX) > 20
  }

  @MainActor
  func testSettingsExposeAllControlsAndSwitchOrientation() throws {
    let app = XCUIApplication(bundleIdentifier: "io.rootlens.app")
    app.launch()
    openSettings(app)

    let volumeMode = app.descendants(matching: .any)["音量ボタン"]
    XCTAssertTrue(reveal(volumeMode, in: app), "Volume-button option was clipped or untappable")
    volumeMode.tap()

    let portOnRight = app.descendants(matching: .any)["端子が右"]
    XCTAssertTrue(reveal(portOnRight, in: app), "Landscape Right option was missing")
    portOnRight.tap()
    let subtitle = app.staticTexts["アカウントとアプリの設定"]
    XCTAssertTrue(subtitle.waitForExistence(timeout: 5))
    let rightX = subtitle.frame.minX

    let portOnLeft = app.descendants(matching: .any)["端子が左"]
    XCTAssertTrue(reveal(portOnLeft, in: app), "Landscape Left option was missing")
    portOnLeft.tap()
    XCTAssertTrue(
      waitForHorizontalShift(subtitle, from: rightX),
      "Selecting port-on-left did not move the safe area to the opposite landscape side"
    )
    let leftX = subtitle.frame.minX

    // Leave the device on the historical default for the recording test and
    // for the person using the phone after this suite.
    XCTAssertTrue(reveal(portOnRight, in: app), "Landscape Right option disappeared after rotation")
    portOnRight.tap()
    XCTAssertTrue(waitForHorizontalShift(subtitle, from: leftX))
  }

  @MainActor
  func testVolumeButtonsToggleRootLensCapture() throws {
    let app = XCUIApplication(bundleIdentifier: "io.rootlens.app")
    app.launch()

    // Select the third CaptureFlow through the real settings UI. This proves it
    // is a peer option, not an auxiliary toggle hidden under another flow.
    openSettings(app)
    let volumeMode = app.descendants(matching: .any)["音量ボタン"]
    XCTAssertTrue(reveal(volumeMode, in: app), "Volume-button CaptureFlow option was missing or untappable")
    volumeMode.tap()

    let captureButton = app.buttons["撮影モードを開始"]
    XCTAssertTrue(captureButton.waitForExistence(timeout: 10), "RootLens capture button was not found")
    XCTAssertTrue(captureButton.isEnabled, "The selected capture method is external")
    captureButton.tap()

    // The capture session must own the volume keys before the first press.
    sleep(8)
    XCTAssertTrue(XCUIDevice.shared.hasHardwareButton(.volumeUp))
    XCTAssertTrue(XCUIDevice.shared.hasHardwareButton(.volumeDown))

    XCUIDevice.shared.press(.volumeUp)
    let stopHint = app.descendants(matching: .any)["音量ボタンを押すと撮影を終了します。"]
    XCTAssertTrue(stopHint.waitForExistence(timeout: 10), "Volume up did not start recording")
    sleep(4)
    XCUIDevice.shared.press(.volumeDown)

    // Give AVAssetWriter, the JSONL writers and the local ledger time to close.
    let startHint = app.descendants(matching: .any)["音量ボタンを押すと撮影を開始します。"]
    XCTAssertTrue(startHint.waitForExistence(timeout: 15), "Volume down did not stop recording")
  }
}
