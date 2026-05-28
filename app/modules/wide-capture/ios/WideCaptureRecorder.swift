import Foundation
import AVFoundation
import CoreMedia
import CoreVideo

// 超広角構成の録画中ファイル並走出力 (DATA_SPECS §2.2「超広角構成」)。
//
// 出力:
//   rgb.mp4                   H.264, 1920×1080, 30 fps (AVAssetWriter)
//   realtime_handpose.jsonl   timestamp_ns + frame_index + hand_landmarks (= JSON Lines)。
//                             Apple Vision の軽量リアルタイム手ランドマーク (= Pipeline 2 の手検出率スコアリング用)。
//   metadata.json             機種名 / OS / アプリ版 / カメラ画角・解像度 / 構成 ID 等の静的情報 (= 録画開始時 1 回)。
//
// 時刻基準: CMSampleBuffer.presentationTimeStamp を ns に変換した値で realtime_handpose.jsonl を統一。
//
// thread strategy:
//   - sample buffer → captureQueue (= AVCaptureSession の出力 callback queue)
//   - rgb.mp4 書き込み → writerQueue (= AVAssetWriter 内部 sync)
//   - realtime_handpose.jsonl 書き込み → sensorFileQueue (= serial、 FileHandle race 回避)
//
// EAGAIN 対策: try handle.write(contentsOf:) を使う (= iOS 13.4+ throwing API、 ObjC 例外で
// クラッシュする FileHandle.writeData は使わない)。

final class WideCaptureRecorder {

  // MARK: - 状態
  private(set) var isRecording = false
  private(set) var sessionDir: URL?
  private(set) var startedAtPts: CMTime = .invalid
  private var frameIndex: Int64 = 0

  // MARK: - file handles
  private var handposeHandle: FileHandle?

  // MARK: - AVAssetWriter
  private var writer: AVAssetWriter?
  private var videoInput: AVAssetWriterInput?
  private var videoSourceFormat: CMFormatDescription?

  // MARK: - queues
  /// JSONL 書き込み専用の serial queue (= FileHandle.write の race を防ぐ)
  private let sensorFileQueue = DispatchQueue(label: "io.rootlens.widecapture.sensor-file", qos: .utility)

  // MARK: - 60 分 hard cap (= UI_SPECS §4.3 + DATA_SPECS §8.1)
  private static let MAX_RECORDING_SECONDS: Double = 60 * 60
  /// 自動停止が走った時に true。 controller 側が次の stopRecording 呼び出しで no-op に
  /// 落ちるのを許容 (= JS 側がそれを ready 状態の終了として扱える)。
  private(set) var autoStoppedByLimit = false

  // MARK: - start / stop

  /// 指定ディレクトリ配下に出力ファイルを準備して録画開始。 戻り値は同ディレクトリ URL。
  /// 引数名は `dir` (= property `sessionDir` の shadow を構造的に排除、 再発防止)。
  /// metadata は controller が組み立てた静的セッション情報 (= metadata.json に書き出す)。
  func start(dir: URL, videoSize: CGSize, metadata: [String: Any]) throws -> URL {
    if isRecording {
      throw NSError(
        domain: "WideCaptureRecorder", code: 1,
        userInfo: [NSLocalizedDescriptionKey: "Already recording"])
    }

    try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

    // ─── AVAssetWriter (rgb.mp4) ───
    let mp4Url = dir.appendingPathComponent("rgb.mp4")
    if FileManager.default.fileExists(atPath: mp4Url.path) {
      try FileManager.default.removeItem(at: mp4Url)
    }
    let writer = try AVAssetWriter(outputURL: mp4Url, fileType: .mp4)
    let videoSettings: [String: Any] = [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: Int(videoSize.width),
      AVVideoHeightKey: Int(videoSize.height),
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: 8_000_000,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
      ],
    ]
    let videoInput = AVAssetWriterInput(mediaType: .video, outputSettings: videoSettings)
    videoInput.expectsMediaDataInRealTime = true
    if writer.canAdd(videoInput) {
      writer.add(videoInput)
    } else {
      throw NSError(
        domain: "WideCaptureRecorder", code: 2,
        userInfo: [NSLocalizedDescriptionKey: "AVAssetWriter cannot add video input"])
    }
    self.writer = writer
    self.videoInput = videoInput

    // ─── realtime_handpose.jsonl ───
    let handposeUrl = dir.appendingPathComponent("realtime_handpose.jsonl")
    if FileManager.default.fileExists(atPath: handposeUrl.path) {
      try FileManager.default.removeItem(at: handposeUrl)
    }
    FileManager.default.createFile(atPath: handposeUrl.path, contents: nil, attributes: nil)
    self.handposeHandle = try FileHandle(forWritingTo: handposeUrl)

    // ─── metadata.json (= 静的セッション情報、 録画開始時に 1 回だけ書く) ───
    let metaUrl = dir.appendingPathComponent("metadata.json")
    if JSONSerialization.isValidJSONObject(metadata),
       let metaData = try? JSONSerialization.data(withJSONObject: metadata, options: [.prettyPrinted, .sortedKeys]) {
      try metaData.write(to: metaUrl)
    }

    // property への代入 (= 引数 rename で shadow リスクは消えたが、 明示は維持)
    self.sessionDir = dir
    self.isRecording = true
    self.autoStoppedByLimit = false
    self.startedAtPts = .invalid
    self.frameIndex = 0
    return dir
  }

  /// 録画停止。 file handle / writer を flush + close する。
  /// 既に自動停止していたら no-op で sessionDir を返す。
  func stop(completion: @escaping (Result<URL, Error>) -> Void) {
    guard isRecording, let writer = writer, let videoInput = videoInput, let sessionDir = sessionDir else {
      // 未開始 (= JS が複数 stopRecording を投げた等) は error じゃなく現 sessionDir を返す
      if let dir = sessionDir {
        completion(.success(dir))
      } else {
        completion(.failure(NSError(
          domain: "WideCaptureRecorder", code: 3,
          userInfo: [NSLocalizedDescriptionKey: "Not recording"])))
      }
      return
    }

    // AVAssetWriter finalize
    videoInput.markAsFinished()
    writer.finishWriting { [weak self] in
      guard let self = self else { return }
      // file handle close は writer finalize 後 (= 並走 write 受信 がもう来ない安全な timing)
      self.sensorFileQueue.async {
        try? self.handposeHandle?.close()
        self.handposeHandle = nil
        self.isRecording = false
        if writer.status == .completed {
          completion(.success(sessionDir))
        } else {
          completion(.failure(writer.error ?? NSError(
            domain: "WideCaptureRecorder", code: 4,
            userInfo: [NSLocalizedDescriptionKey: "AVAssetWriter finalize failed, status=\(writer.status.rawValue)"])))
        }
      }
    }
  }

  // MARK: - sample buffer 受信 (= captureQueue から呼ばれる)

  /// AVCaptureSession の videoDataOutput callback から呼ぶ。
  /// - rgb.mp4 に書き込む
  /// - realtime_handpose.jsonl に hand landmarks を append
  /// - 60 分超過なら autoStop を triggerOnMain で発火する (= 呼出側で stop を実施)
  func ingestSampleBuffer(_ sampleBuffer: CMSampleBuffer, handTrack: HandTracker.Output?, triggerAutoStop: @escaping () -> Void) {
    guard isRecording, let writer = writer, let videoInput = videoInput, sessionDir != nil else {
      return
    }

    let pts = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)

    // 初回 sample: writer.startSession
    if writer.status == .unknown {
      writer.startWriting()
      writer.startSession(atSourceTime: pts)
      self.startedAtPts = pts
      self.videoSourceFormat = CMSampleBufferGetFormatDescription(sampleBuffer)
    }

    // 60 分 hard cap check
    if startedAtPts.isValid {
      let elapsed = CMTimeGetSeconds(CMTimeSubtract(pts, startedAtPts))
      if elapsed >= Self.MAX_RECORDING_SECONDS && !autoStoppedByLimit {
        autoStoppedByLimit = true
        NSLog("[WideCaptureRecorder] auto-stopping at %.1fs (60 min cap)", elapsed)
        triggerAutoStop()
        // 以降の sample は writer 停止後に来うる、 そのまま落ちる
      }
    }

    // video frame を MP4 に
    if videoInput.isReadyForMoreMediaData {
      videoInput.append(sampleBuffer)
    }

    // realtime_handpose.jsonl に hand landmarks 追記 (= hand pose 結果が無いフレームでも 1 行は出す)
    let ts = handTrack?.timestampNs ?? UInt64(CMTimeGetSeconds(pts) * 1e9)
    let row = makeFrameRow(timestampNs: ts, frameIndex: self.frameIndex, handTrack: handTrack)
    self.frameIndex += 1
    if let data = serializeJsonl(row) {
      let handle = self.handposeHandle
      sensorFileQueue.async {
        guard let h = handle else { return }
        do {
          try h.write(contentsOf: data)
        } catch {
          NSLog("[WideCaptureRecorder] realtime_handpose.jsonl write failed: %@", "\(error)")
        }
      }
    }
  }

  // MARK: - frame row

  private func makeFrameRow(timestampNs: UInt64, frameIndex: Int64, handTrack: HandTracker.Output?) -> [String: Any] {
    var hands: [[String: Any]] = []
    if let ht = handTrack {
      for ch in ht.classification.hands where ch.isWearer {
        let lms: [[String: Float]] = ch.raw.landmarks.map { lm in
          ["x": lm.x, "y": lm.y, "confidence": lm.confidence]
        }
        hands.append([
          "handedness": ch.raw.handedness,
          "confidence": ch.raw.confidence,
          "landmarks": lms,
        ])
      }
    }
    return [
      "timestamp_ns": String(timestampNs),
      "frame_index": frameIndex,
      "hands": hands,
    ]
  }

  // MARK: - JSONL serialize

  private func serializeJsonl(_ obj: [String: Any]) -> Data? {
    guard JSONSerialization.isValidJSONObject(obj) else { return nil }
    guard var data = try? JSONSerialization.data(withJSONObject: obj, options: []) else { return nil }
    data.append(0x0A)  // newline
    return data
  }
}
