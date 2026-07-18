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
//   - On-device recognition runs on the OS dictation engine, so the device
//     must have Siri or keyboard dictation enabled. When both are off, every
//     recognition task dies instantly with kLSRErrorDomain ("Siri and
//     Dictation are disabled") — retrying can never succeed, so that case
//     stops the listener and surfaces onUnavailable instead.
//   - Runs alongside the ARKit camera session: the camera and the microphone
//     are separate resources, so both can capture concurrently. The audio
//     session uses .playAndRecord with .defaultToSpeaker so the TTS guidance
//     keeps playing through the speaker while the mic listens.
//   - Apple ends a recognition task after roughly one minute, so the task is
//     restarted in a loop for shift-long listening.
//   - expo-av rebuilds the audio session for every sound it plays, and its
//     .playAndRecord configuration lacks .defaultToSpeaker, which lands
//     playback on the quiet earpiece receiver. A route-change observer pushes
//     output back to the speaker whenever that happens.
//   - Keyword matching happens here, on the transcript suffix, so JS only
//     receives discrete 'start' / 'stop' events instead of a partial-result
//     firehose. The suffix window keeps a long rambling transcript from
//     re-matching an old keyword.
final class SpeechCommandController: NSObject {
  static let shared = SpeechCommandController()

  /// (command, transcript) on a keyword match. command is "start" or "stop".
  var onCommand: ((String, String) -> Void)?
  /// Listening stopped for good (e.g. Siri / dictation disabled on the device).
  var onUnavailable: ((String) -> Void)?

  private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "ja-JP"))
  private let audioEngine = AVAudioEngine()
  private var request: SFSpeechAudioBufferRecognitionRequest?
  private var task: SFSpeechRecognitionTask?
  private var running = false
  private var routeChangeObserver: NSObjectProtocol?
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

  /// Permission prompts need a free main thread to present their dialogs, so the
  /// whole start path is callback-chained instead of blocking (a semaphore here
  /// deadlocked: the dialog waited for main while main waited for the dialog).
  func start(completion: @escaping (Error?) -> Void) {
    if running { completion(nil); return }
    guard let recognizer, recognizer.isAvailable else {
      completion(SpeechCommandError.unavailable); return
    }
    SFSpeechRecognizer.requestAuthorization { status in
      DispatchQueue.main.async {
        guard status == .authorized else { completion(SpeechCommandError.unauthorized); return }
        AVAudioSession.sharedInstance().requestRecordPermission { granted in
          DispatchQueue.main.async {
            guard granted else { completion(SpeechCommandError.unauthorized); return }
            do {
              let session = AVAudioSession.sharedInstance()
              try session.setCategory(.playAndRecord, mode: .default,
                                      options: [.defaultToSpeaker, .allowBluetooth])
              try session.setActive(true, options: .notifyOthersOnDeactivation)
              self.running = true
              self.routeChangeObserver = NotificationCenter.default.addObserver(
                forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main
              ) { [weak self] _ in
                self?.reassertSpeakerRoute()
              }
              self.startRecognitionTask()
              completion(nil)
            } catch {
              completion(error)
            }
          }
        }
      }
    }
  }

  func stop() {
    running = false
    if let routeChangeObserver {
      NotificationCenter.default.removeObserver(routeChangeObserver)
      self.routeChangeObserver = nil
    }
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

  /// .playAndRecord without .defaultToSpeaker routes playback to the earpiece
  /// receiver (capped around -9 dB), and expo-av reconfigures the session that
  /// way on its first sound after the listener starts. Route changes are the
  /// only hook for noticing, so push output back to the speaker there.
  private func reassertSpeakerRoute() {
    guard running else { return }
    let session = AVAudioSession.sharedInstance()
    if session.currentRoute.outputs.contains(where: { $0.portType == .builtInReceiver }) {
      try? session.overrideOutputAudioPort(.speaker)
    }
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
    // installTap throws an NSException (= crash) on a 0 Hz / 0 ch format, which is
    // what the input node reports when the audio session is not actually recording.
    guard format.sampleRate > 0, format.channelCount > 0 else {
      restartSoon()
      return
    }
    input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, _ in
      self?.request?.append(buffer)
    }
    if !audioEngine.isRunning {
      audioEngine.prepare()
      try? audioEngine.start()
    }

    task = recognizer.recognitionTask(with: req) { [weak self] result, error in
      // Restarting cancels the old task, which still fires its callback once
      // with a cancellation error; the identity check drops those stale calls
      // so they cannot schedule a second, competing restart.
      guard let self, self.request === req else { return }
      if let result {
        self.match(transcript: result.bestTranscription.formattedString)
        if result.isFinal {
          self.restartSoon()
          return
        }
      }
      if let error {
        let ns = error as NSError
        if ns.domain == "kLSRErrorDomain" {
          // The on-device recognizer itself cannot run (Siri and dictation are
          // both disabled in Settings). No amount of retrying fixes that.
          DispatchQueue.main.async {
            self.stop()
            self.onUnavailable?(ns.localizedDescription)
          }
        } else {
          self.restartSoon()
        }
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
