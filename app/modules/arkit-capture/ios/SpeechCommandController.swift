import AVFoundation
import Foundation
import Speech

// Spoken start/stop command listener for the voice capture flow.
//
// Design constraints:
//   - On-device recognition only (requiresOnDeviceRecognition): audio never
//     leaves the device, which is what the shop-facing documents promise.
//     Audio is transcribed transiently and discarded; nothing is stored and
//     the recording clips carry no audio track.
//   - Runs alongside the ARKit camera session: the camera and the microphone
//     are separate resources, so both can capture concurrently. The audio
//     session uses .playAndRecord with .defaultToSpeaker so the TTS guidance
//     keeps playing through the speaker while the mic listens.
//   - Apple ends a recognition task after roughly one minute, so the task is
//     restarted in a loop for shift-long listening.
//   - Keyword matching happens here, on the transcript suffix, so JS only
//     receives discrete 'start' / 'stop' events instead of a partial-result
//     firehose. The suffix window keeps a long rambling transcript from
//     re-matching an old keyword.
final class SpeechCommandController: NSObject {
  static let shared = SpeechCommandController()

  /// (command, transcript) on a keyword match. command is "start" or "stop".
  var onCommand: ((String, String) -> Void)?

  private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ja-JP"))
  private let audioEngine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var running = false
  // Cooldown so one utterance does not fire twice (partial results repeat the
  // matched suffix while the recognizer refines the sentence).
  private var lastMatchAt: Date = .distantPast
  private static let matchCooldown: TimeInterval = 2.0

  // Accepted spellings. Japanese on-device recognition normally emits kanji
  // (撮影スタート); kana variants cover mis-transcriptions.
  private static let startWords = ["撮影スタート", "さつえいスタート", "撮影開始"]
  private static let stopWords = ["撮影ストップ", "さつえいストップ", "撮影終了"]

  enum SpeechCommandError: LocalizedError {
    case unauthorized
    case unavailable
    var errorDescription: String? {
      switch self {
      case .unauthorized: return "speech recognition not authorized"
      case .unavailable: return "on-device ja-JP recognition unavailable"
      }
    }
  }

  func start() throws {
    if running { return }
    guard let recognizer, recognizer.isAvailable else { throw SpeechCommandError.unavailable }

    var authStatus = SFSpeechRecognizer.authorizationStatus()
    if authStatus == .notDetermined {
      let sem = DispatchSemaphore(value: 0)
      SFSpeechRecognizer.requestAuthorization { status in
        authStatus = status
        sem.signal()
      }
      sem.wait()
    }
    guard authStatus == .authorized else { throw SpeechCommandError.unauthorized }

    var micGranted = AVAudioSession.sharedInstance().recordPermission == .granted
    if AVAudioSession.sharedInstance().recordPermission == .undetermined {
      let sem = DispatchSemaphore(value: 0)
      AVAudioSession.sharedInstance().requestRecordPermission { granted in
        micGranted = granted
        sem.signal()
      }
      sem.wait()
    }
    guard micGranted else { throw SpeechCommandError.unauthorized }

    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .measurement,
                            options: [.defaultToSpeaker, .allowBluetooth, .duckOthers])
    try session.setActive(true, options: .notifyOthersOnDeactivation)

    running = true
    startRecognitionTask()
  }

  func stop() {
    running = false
    task?.cancel()
    task = nil
    request?.endAudio()
    request = nil
    if audioEngine.isRunning {
      audioEngine.stop()
      audioEngine.inputNode.removeTap(onBus: 0)
    }
    // Hand the audio session back so plain playback routes normally again.
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
  }

  private func startRecognitionTask() {
    guard running, let recognizer else { return }

    let req = SFSpeechAudioBufferRecognitionRequest()
    req.shouldReportPartialResults = true
    if recognizer.supportsOnDeviceRecognition {
      req.requiresOnDeviceRecognition = true
    }
    request = req

    let input = audioEngine.inputNode
    input.removeTap(onBus: 0)
    let format = input.outputFormat(forBus: 0)
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.request?.append(buffer)
    }
    if !audioEngine.isRunning {
      audioEngine.prepare()
      try? audioEngine.start()
    }

    task = recognizer.recognitionTask(with: req) { [weak self] result, error in
      guard let self else { return }
      if let result {
        self.match(transcript: result.bestTranscription.formattedString)
        if result.isFinal {
          self.restartSoon()
          return
        }
      }
      if error != nil {
        self.restartSoon()
      }
    }
  }

  /// Recreate the request/task (the ~1-minute cap, errors, and final results all land here).
  private func restartSoon() {
    guard running else { return }
    task?.cancel()
    task = nil
    request = nil
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { [weak self] in
      self?.startRecognitionTask()
    }
  }

  private func match(transcript: String) {
    guard Date().timeIntervalSince(lastMatchAt) >= Self.matchCooldown else { return }
    // Only the tail of the transcript counts: the utterance just spoken.
    let tail = String(transcript.suffix(16))
    let command: String?
    if Self.stopWords.contains(where: { tail.contains($0) }) {
      command = "stop"
    } else if Self.startWords.contains(where: { tail.contains($0) }) {
      command = "start"
    } else {
      command = nil
    }
    if let command {
      lastMatchAt = Date()
      onCommand?(command, transcript)
    }
  }
}
