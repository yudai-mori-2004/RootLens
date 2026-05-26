// macos-blur: input mp4 → output mp4 (= 顔ぼかし、 Apple Vision + CIGaussianBlur + HEVC encode)。
//
// 使い方:
//   macos-blur --input <path> --output <path> [--blur-radius 32] [--detection-scale 0.66] [--face-inflate 0.18]
//
// 出力: 1 行 JSON で結果を stdout、 失敗時は stderr。

import Foundation

struct CliArgs {
    var input: String = ""
    var output: String = ""
    var blurRadius: Double = 32
    var detectionScale: Double = 0.66
    var faceInflate: Double = 0.18
    var quiet: Bool = false
}

func parseArgs() -> CliArgs {
    var args = CliArgs()
    var iter = CommandLine.arguments.dropFirst().makeIterator()
    while let a = iter.next() {
        switch a {
        case "--input": args.input = iter.next() ?? ""
        case "--output": args.output = iter.next() ?? ""
        case "--blur-radius": args.blurRadius = Double(iter.next() ?? "32") ?? 32
        case "--detection-scale": args.detectionScale = Double(iter.next() ?? "0.66") ?? 0.66
        case "--face-inflate": args.faceInflate = Double(iter.next() ?? "0.18") ?? 0.18
        case "--quiet": args.quiet = true
        case "-h", "--help":
            print("usage: macos-blur --input <path> --output <path> [--blur-radius 32] [--detection-scale 0.66] [--face-inflate 0.18] [--quiet]")
            exit(0)
        default:
            FileHandle.standardError.write(Data("unknown arg: \(a)\n".utf8))
            exit(2)
        }
    }
    if args.input.isEmpty || args.output.isEmpty {
        FileHandle.standardError.write(Data("missing --input / --output\n".utf8))
        exit(2)
    }
    return args
}

let cliArgs = parseArgs()
let cliOpts = PrivacyBlurOptions(
    inputUri: cliArgs.input,
    outputUri: cliArgs.output,
    blurRadius: cliArgs.blurRadius,
    detectionScale: cliArgs.detectionScale,
    faceInflate: cliArgs.faceInflate
)

let cliProgress: PrivacyBlurProgressCallback? = cliArgs.quiet ? nil : { p, done, total in
    FileHandle.standardError.write(Data(String(format: "[macos-blur] %5.1f%%  %d/%d frames\n", p * 100, done, total).utf8))
}

do {
    let result = try await PrivacyBlurProcessor.process(cliOpts, onProgress: cliProgress)
    let payload: [String: Any] = [
        "outputUri": result.outputUri,
        "durationMs": result.durationMs,
        "framesProcessed": result.framesProcessed,
        "facesBlurred": result.facesBlurred,
        "inputBytes": result.inputBytes,
        "outputBytes": result.outputBytes,
        "outputWidth": result.outputWidth,
        "outputHeight": result.outputHeight,
    ]
    let data = try JSONSerialization.data(withJSONObject: payload, options: [.sortedKeys])
    FileHandle.standardOutput.write(data)
    FileHandle.standardOutput.write(Data("\n".utf8))
    exit(0)
} catch {
    FileHandle.standardError.write(Data("ERROR: \(error.localizedDescription)\n".utf8))
    exit(1)
}
