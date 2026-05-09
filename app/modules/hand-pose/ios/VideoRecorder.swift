import AVFoundation
import Foundation

// AVAssetWriter ベースの動画 recorder。HandPoseCameraController の VideoDataOutput
// から流れてくる CMSampleBuffer を受け取り mp4 に書き出す。
//
// 設計:
//   - AVCaptureMovieFileOutput を使わない理由: VideoDataOutput と同居するための制約
//     が機種依存。AVAssetWriter なら既存 frame pipeline を分岐させるだけで済む。
//   - state machine:
//       idle → recording (startRecording で writer 構築 + 入力受付開始)
//       recording → idle (stopRecording で writer.finishWriting → completion)
//   - PTS は最初に append された sample の PTS を session start として使う。
//     (capture queue 上の monotonic 時刻ベースのため、外部 wall-clock と無関係)

final class VideoRecorder {
  enum State { case idle, recording }

  private let writeQueue = DispatchQueue(label: "io.rootlens.hand-pose.video-writer", qos: .userInitiated)
  private(set) var state: State = .idle
  private var writer: AVAssetWriter?
  private var videoInput: AVAssetWriterInput?
  private var sessionStarted = false
  private var pendingCompletion: ((URL?) -> Void)?

  /// 出力先 mp4 のパス。recording 中のみ意味がある。
  private(set) var outputURL: URL?

  /// 録画開始。output に既存ファイルがあれば削除する。
  /// - Parameters:
  ///   - url: mp4 出力先
  ///   - dimensions: capture 解像度 (width × height)。VideoDataOutput と同じであること。
  func startRecording(to url: URL, dimensions: CGSize) throws {
    try writeQueue.sync {
      guard state == .idle else { return }

      try? FileManager.default.removeItem(at: url)

      let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
      let videoSettings: [String: Any] = [
        AVVideoCodecKey: AVVideoCodecType.h264,
        AVVideoWidthKey: dimensions.width,
        AVVideoHeightKey: dimensions.height,
      ]
      let input = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
      input.expectsMediaDataInRealTime = true

      // VideoDataOutput connection で portrait に立てているので buffer は portrait orientation。
      // transform は identity (= 入力 buffer の向きをそのまま採用)。
      input.transform = .identity

      if writer.canAdd(input) {
        writer.add(input)
      } else {
        throw NSError(domain: "VideoRecorder", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "cannot add video input to asset writer"])
      }

      guard writer.startWriting() else {
        throw writer.error ?? NSError(
          domain: "VideoRecorder", code: 2,
          userInfo: [NSLocalizedDescriptionKey: "asset writer failed to start"]
        )
      }

      self.writer = writer
      self.videoInput = input
      self.outputURL = url
      self.sessionStarted = false
      self.state = .recording
    }
  }

  /// HandPoseCameraController の capture queue 上から呼ばれる。録画中のみ append。
  func appendSampleBuffer(_ sampleBuffer: CMSampleBuffer) {
    guard state == .recording else { return }
    guard let writer = writer, let input = videoInput else { return }
    guard CMSampleBufferDataIsReady(sampleBuffer) else { return }

    let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)

    if !sessionStarted {
      writer.startSession(atSourceTime: pts)
      sessionStarted = true
    }
    if input.isReadyForMoreMediaData {
      input.append(sampleBuffer)
    }
    // Backpressure 時は単にスキップ (frame drop)。
  }

  /// 録画停止 → finishWriting 完了で completion(URL or nil)。
  /// completion は writeQueue 上で呼ばれる (caller 側で main 復帰すること)。
  func stopRecording(completion: @escaping (URL?) -> Void) {
    writeQueue.async {
      guard self.state == .recording else {
        completion(nil); return
      }
      self.state = .idle
      let writer = self.writer
      let input = self.videoInput
      let url = self.outputURL

      input?.markAsFinished()
      writer?.finishWriting {
        completion(url)
      }

      self.writer = nil
      self.videoInput = nil
      self.outputURL = nil
      self.sessionStarted = false
    }
  }
}
