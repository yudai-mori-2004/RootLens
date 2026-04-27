import ExpoModulesCore
import Photos
import AVFoundation
import MobileCoreServices
import UniformTypeIdentifiers
import Security
import DeviceCheck
import CryptoKit
import C2paBridgeFFI

// 仕様書 §4.6 C2PA SDK統合
// Expo Modules APIでc2pa-bridge (.a) をC FFI経由で呼び出す

public class C2paBridgeModule: Module {
  // 仕様書 §4.4 TEE鍵管理用定数
  private static let teeKeyTag = "io.rootlens.c2pa.signing.key"
  private static let deviceCertKey = "io.rootlens.c2pa.device.cert"
  private static let intermediateCaCertKey = "io.rootlens.c2pa.intermediate.cert"
  private static let rootCaCertKey = "io.rootlens.c2pa.rootca.cert"

  public func definition() -> ModuleDefinition {
    Name("C2paBridge")

    // v0.1.1: signContent は assertions: [{label, data}, ...] を受け取り、
    //         c2pa-bridge に JSON 配列として渡す。c2pa.actions.created と並ぶ追加 assertion になる。
    //         assertions が省略されるとレガシー (assertion なし) で署名する。
    AsyncFunction("signContent") { (imagePath: String, assertions: [Any]?, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        NSLog("[C2paBridge] signContent called with: \(imagePath), assertions=\(assertions?.count ?? 0)")

        Self.resolveToFile(imagePath) { inputPath in
          guard let inputPath = inputPath else {
            NSLog("[C2paBridge] Input file not found: \(imagePath)")
            promise.reject("FILE_ERROR", "入力ファイルが見つかりません: \(imagePath)")
            return
          }

          let fileSize = (try? FileManager.default.attributesOfItem(atPath: inputPath)[.size] as? Int) ?? 0
          NSLog("[C2paBridge] Input file: \(inputPath) (\(fileSize) bytes)")

          let ext = (inputPath as NSString).pathExtension.isEmpty ? "jpg" : (inputPath as NSString).pathExtension
          let outputPath = NSTemporaryDirectory() + "c2pa_signed_\(Int(Date().timeIntervalSince1970 * 1000)).\(ext)"

          // assertions を JSON 文字列にシリアライズ (nil または空配列なら送らない)
          var assertionsJson: String? = nil
          if let arr = assertions, !arr.isEmpty {
            do {
              let data = try JSONSerialization.data(withJSONObject: arr, options: [])
              assertionsJson = String(data: data, encoding: .utf8)
            } catch {
              NSLog("[C2paBridge] assertions serialization failed: \(error)")
              promise.reject("ASSERTIONS_ERROR", "assertions のシリアライズに失敗: \(error.localizedDescription)")
              return
            }
          }

          // TEE証明書があればTEE署名
          // レガシーPEM署名はDEBUGビルドでのみ許可（§4.6）
          if Self.hasStoredCertificate() {
            let result = Self.signWithTee(inputPath: inputPath, outputPath: outputPath, assertionsJson: assertionsJson)
            if result == 0 {
              let outSize = (try? FileManager.default.attributesOfItem(atPath: outputPath)[.size] as? Int) ?? 0
              NSLog("[C2paBridge] TEE sign success: \(outputPath) (\(outSize) bytes)")
              promise.resolve(outputPath)
            } else {
              NSLog("[C2paBridge] TEE sign failed (\(result))")
              promise.reject("SIGN_ERROR", "TEE署名に失敗しました (code: \(result))")
            }
          } else {
            #if DEBUG
            NSLog("[C2paBridge] No TEE cert — falling back to legacy PEM signing (DEBUG only)")
            Self.signWithLegacy(inputPath: inputPath, outputPath: outputPath, promise: promise)
            #else
            promise.reject("CERT_ERROR", "Device Certificateが未取得です。ネットワーク接続を確認してください")
            #endif
          }
        }
      }
    }

    AsyncFunction("readManifest") { (imagePath: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        NSLog("[C2paBridge] readManifest called with: \(imagePath)")

        Self.resolveToFile(imagePath) { inputPath in
          guard let inputPath = inputPath else {
            NSLog("[C2paBridge] Input file not found: \(imagePath)")
            promise.resolve("{\"has_manifest\":false,\"error\":\"file not found\"}")
            return
          }

          let resultPtr = c2pa_read_manifest(inputPath.cString(using: .utf8))
          if let resultPtr = resultPtr {
            let json = String(cString: resultPtr)
            c2pa_free_string(resultPtr)
            NSLog("[C2paBridge] readManifest result: \(json)")
            promise.resolve(json)
          } else {
            promise.resolve("{\"has_manifest\":false,\"error\":\"null result\"}")
          }
        }
      }
    }

    AsyncFunction("applyMasks") { (imagePath: String, masksArray: [[String: Double]], promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        Self.resolveToFile(imagePath) { inputPath in
          guard let inputPath = inputPath,
                let image = UIImage(contentsOfFile: inputPath) else {
            promise.reject("FILE_ERROR", "入力ファイルが見つかりません")
            return
          }

          let size = image.size
          let renderer = UIGraphicsImageRenderer(size: size)
          let masked = renderer.image { ctx in
            image.draw(at: .zero)
            ctx.cgContext.setFillColor(UIColor.black.cgColor)

            for mask in masksArray {
              let x = CGFloat(mask["x"] ?? 0)
              let y = CGFloat(mask["y"] ?? 0)
              let w = CGFloat(mask["w"] ?? 0)
              let h = CGFloat(mask["h"] ?? 0)
              let rotation = CGFloat(mask["rotation"] ?? 0) * .pi / 180

              ctx.cgContext.saveGState()
              ctx.cgContext.translateBy(x: x + w / 2, y: y + h / 2)
              ctx.cgContext.rotate(by: rotation)
              ctx.cgContext.fill(CGRect(x: -w / 2, y: -h / 2, width: w, height: h))
              ctx.cgContext.restoreGState()
            }
          }

          let inputExt = (inputPath as NSString).pathExtension.lowercased()
          let isPng = inputExt == "png"
          let outputExt = isPng ? "png" : "jpg"
          let outputPath = NSTemporaryDirectory() + "masked_\(Int(Date().timeIntervalSince1970 * 1000)).\(outputExt)"
          let data: Data?
          if isPng {
            data = masked.pngData()
          } else {
            data = masked.jpegData(compressionQuality: 0.95)
          }

          guard let data = data else {
            promise.reject("ENCODE_ERROR", "画像のエンコードに失敗しました")
            return
          }

          try? data.write(to: URL(fileURLWithPath: outputPath))

          // EXIF日時をコピー
          if !isPng {
            let inputURL = URL(fileURLWithPath: inputPath) as CFURL
            let outputURL = URL(fileURLWithPath: outputPath) as CFURL
            if let srcRef = CGImageSourceCreateWithURL(inputURL, nil),
               let srcProps = CGImageSourceCopyPropertiesAtIndex(srcRef, 0, nil) as? [String: Any],
               let exifDict = srcProps[kCGImagePropertyExifDictionary as String] as? [String: Any],
               let dstSource = CGImageSourceCreateWithURL(outputURL, nil),
               let dstImage = CGImageSourceCreateImageAtIndex(dstSource, 0, nil),
               let dstRef = CGImageDestinationCreateWithURL(outputURL, UTType.jpeg.identifier as CFString, 1, nil) {
              let dstProps: [String: Any] = [kCGImagePropertyExifDictionary as String: exifDict]
              CGImageDestinationAddImage(dstRef, dstImage, dstProps as CFDictionary)
              CGImageDestinationFinalize(dstRef)
            }
          }

          NSLog("[C2paBridge] applyMasks: \(masksArray.count) masks -> \(outputPath)")
          promise.resolve(outputPath)
        }
      }
    }

    // 動画処理（クロップ・リサイズ・トリム）をAVFoundationで実行
    AsyncFunction("processVideo") { (videoPath: String, optionsJson: String, promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        NSLog("[C2paBridge] processVideo called with: \(videoPath)")

        guard let data = optionsJson.data(using: .utf8),
              let opts = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
          promise.reject("ARG_ERROR", "オプションのパースに失敗しました")
          return
        }

        Self.resolveToFile(videoPath) { inputPath in
          guard let inputPath = inputPath else {
            promise.reject("FILE_ERROR", "入力ファイルが見つかりません: \(videoPath)")
            return
          }

          let asset = AVURLAsset(url: URL(fileURLWithPath: inputPath))
          guard let videoTrack = asset.tracks(withMediaType: .video).first else {
            promise.reject("TRACK_ERROR", "動画トラックが見つかりません")
            return
          }

          let naturalSize = videoTrack.naturalSize
          let transform = videoTrack.preferredTransform
          let isRotated = abs(transform.b) == 1.0 && abs(transform.c) == 1.0
          let sourceW = isRotated ? naturalSize.height : naturalSize.width
          let sourceH = isRotated ? naturalSize.width : naturalSize.height

          let cropX = CGFloat(opts["cropX"] as? Double ?? 0)
          let cropY = CGFloat(opts["cropY"] as? Double ?? 0)
          let cropW = CGFloat(opts["cropW"] as? Double ?? Double(sourceW))
          let cropH = CGFloat(opts["cropH"] as? Double ?? Double(sourceH))
          let outputW = CGFloat(opts["outputW"] as? Double ?? Double(cropW))
          let outputH = CGFloat(opts["outputH"] as? Double ?? Double(cropH))
          let startMs = opts["startMs"] as? Double
          let endMs = opts["endMs"] as? Double

          let hasCrop = cropX != 0 || cropY != 0 ||
            abs(cropW - sourceW) > 1 || abs(cropH - sourceH) > 1
          let hasResize = abs(outputW - cropW) > 1 || abs(outputH - cropH) > 1
          let hasTrim = startMs != nil || endMs != nil
          let needsReencode = hasCrop || hasResize

          // トリムのみ（再エンコード不要）
          if hasTrim && !needsReencode {
            let composition = AVMutableComposition()
            let start = CMTime(seconds: (startMs ?? 0) / 1000.0, preferredTimescale: 600)
            let end = endMs != nil
              ? CMTime(seconds: endMs! / 1000.0, preferredTimescale: 600)
              : asset.duration
            let timeRange = CMTimeRange(start: start, end: end)

            do {
              if let videoTrack = asset.tracks(withMediaType: .video).first {
                let compVideoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
                try compVideoTrack?.insertTimeRange(timeRange, of: videoTrack, at: .zero)
                compVideoTrack?.preferredTransform = videoTrack.preferredTransform
              }
              if let audioTrack = asset.tracks(withMediaType: .audio).first {
                let compAudioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
                try compAudioTrack?.insertTimeRange(timeRange, of: audioTrack, at: .zero)
              }
            } catch {
              promise.reject("COMP_ERROR", "コンポジション作成に失敗: \(error)")
              return
            }

            let outputPath = NSTemporaryDirectory() + "video_out_\(Int(Date().timeIntervalSince1970 * 1000)).mp4"
            let outputURL = URL(fileURLWithPath: outputPath)
            try? FileManager.default.removeItem(at: outputURL)

            guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough) else {
              promise.reject("EXPORT_ERROR", "エクスポートセッション作成に失敗")
              return
            }
            exporter.outputURL = outputURL
            exporter.outputFileType = .mp4

            exporter.exportAsynchronously {
              if exporter.status == .completed {
                NSLog("[C2paBridge] processVideo trim-only success: \(outputPath)")
                promise.resolve(outputPath)
              } else {
                promise.reject("EXPORT_ERROR", "動画エクスポートに失敗: \(exporter.error?.localizedDescription ?? "unknown")")
              }
            }
            return
          }

          // クロップ・リサイズ（再エンコード必要）
          let composition = AVMutableComposition()
          let timeRange: CMTimeRange
          if hasTrim {
            let start = CMTime(seconds: (startMs ?? 0) / 1000.0, preferredTimescale: 600)
            let end = endMs != nil
              ? CMTime(seconds: endMs! / 1000.0, preferredTimescale: 600)
              : asset.duration
            timeRange = CMTimeRange(start: start, end: end)
          } else {
            timeRange = CMTimeRange(start: .zero, duration: asset.duration)
          }

          do {
            let compVideoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)
            try compVideoTrack?.insertTimeRange(timeRange, of: videoTrack, at: .zero)
            if let audioTrack = asset.tracks(withMediaType: .audio).first {
              let compAudioTrack = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid)
              try compAudioTrack?.insertTimeRange(timeRange, of: audioTrack, at: .zero)
            }
          } catch {
            promise.reject("COMP_ERROR", "コンポジション作成に失敗: \(error)")
            return
          }

          let videoComposition = AVMutableVideoComposition()
          let finalW = Int(outputW / 2) * 2
          let finalH = Int(outputH / 2) * 2
          videoComposition.renderSize = CGSize(width: finalW, height: finalH)
          videoComposition.frameDuration = CMTime(value: 1, timescale: CMTimeScale(videoTrack.nominalFrameRate > 0 ? videoTrack.nominalFrameRate : 30))

          let instruction = AVMutableVideoCompositionInstruction()
          instruction.timeRange = CMTimeRange(start: .zero, duration: composition.duration)

          let layerInstruction = AVMutableVideoCompositionLayerInstruction(assetTrack: composition.tracks(withMediaType: .video).first!)

          var tx = transform
          tx = tx.concatenating(CGAffineTransform(translationX: -cropX, y: -cropY))
          if hasResize || hasCrop {
            let scaleX = CGFloat(finalW) / cropW
            let scaleY = CGFloat(finalH) / cropH
            tx = tx.concatenating(CGAffineTransform(scaleX: scaleX, y: scaleY))
          }
          layerInstruction.setTransform(tx, at: .zero)

          instruction.layerInstructions = [layerInstruction]
          videoComposition.instructions = [instruction]

          let outputPath = NSTemporaryDirectory() + "video_out_\(Int(Date().timeIntervalSince1970 * 1000)).mp4"
          let outputURL = URL(fileURLWithPath: outputPath)
          try? FileManager.default.removeItem(at: outputURL)

          guard let exporter = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetHighestQuality) else {
            promise.reject("EXPORT_ERROR", "エクスポートセッション作成に失敗")
            return
          }
          exporter.outputURL = outputURL
          exporter.outputFileType = .mp4
          exporter.videoComposition = videoComposition

          exporter.exportAsynchronously {
            if exporter.status == .completed {
              NSLog("[C2paBridge] processVideo success: \(outputPath)")
              promise.resolve(outputPath)
            } else {
              promise.reject("EXPORT_ERROR", "動画エクスポートに失敗: \(exporter.error?.localizedDescription ?? "unknown")")
            }
          }
        }
      }
    }

    AsyncFunction("getVersion") { () -> String in
      return "c2pa-bridge 0.1.0"
    }

    // --- TEE鍵管理 (§4.4, §4.6) ---

    // 仕様書 §4.4.1 Secure Enclave内でEC P-256鍵を生成し、CSR + App Attestを返す
    AsyncFunction("generateDeviceCredentials") { (promise: Promise) in
      DispatchQueue.global(qos: .userInitiated).async {
        NSLog("[C2paBridge] generateDeviceCredentials called")
        do {
          let (privateKey, publicKey) = try Self.getOrCreateTeeKeyPair()
          guard let csrData = Self.buildCSR(publicKey: publicKey, privateKey: privateKey) else {
            promise.reject("CSR_ERROR", "CSR生成に失敗しました")
            return
          }
          let csrBase64 = csrData.base64EncodedString()
          NSLog("[C2paBridge] CSR generated: \(csrData.count) bytes")

          // §4.4.1: App Attest — clientDataHash = SHA-256(CSR)
          // App AttestはC2PA署名鍵（Secure Enclave）とは独立した仕組み
          Self.getAppAttestation(csrData: csrData) { attestation in
            var result: [String: Any] = [
              "csr": csrBase64,
              "platform": "ios",
            ]
            if let attestation = attestation {
              result["attestation"] = attestation
            }
            promise.resolve(result)
          }
        } catch {
          NSLog("[C2paBridge] generateDeviceCredentials error: \(error)")
          promise.reject("KEY_ERROR", "TEE鍵生成に失敗しました: \(error.localizedDescription)")
        }
      }
    }

    // 仕様書 §4.4.1 ステップ7: Device Certificate + Root CA Certificate保存
    AsyncFunction("storeDeviceCertificate") { (deviceCertBase64: String, intermediateCaCertBase64: String, rootCaCertBase64: String, promise: Promise) in
      guard let deviceCertData = Data(base64Encoded: deviceCertBase64),
            let intermediateCaData = Data(base64Encoded: intermediateCaCertBase64),
            let rootCaCertData = Data(base64Encoded: rootCaCertBase64) else {
        promise.reject("ARG_ERROR", "Base64デコードに失敗しました")
        return
      }
      let defaults = UserDefaults.standard
      defaults.set(deviceCertData, forKey: Self.deviceCertKey)
      defaults.set(intermediateCaData, forKey: Self.intermediateCaCertKey)
      defaults.set(rootCaCertData, forKey: Self.rootCaCertKey)
      NSLog("[C2paBridge] Certificates stored: device=\(deviceCertData.count), intermediate=\(intermediateCaData.count), rootCA=\(rootCaCertData.count)")
      promise.resolve(true)
    }

    AsyncFunction("hasDeviceCertificate") { () -> Bool in
      return Self.hasStoredCertificate()
    }

    // 仕様書 §4.4 証明書有効期限の取得
    AsyncFunction("getDeviceCertificateExpiry") { (promise: Promise) in
      guard let certData = UserDefaults.standard.data(forKey: Self.deviceCertKey) else {
        promise.resolve(nil as String?)
        return
      }
      if let expiry = Self.extractNotAfter(from: certData) {
        promise.resolve(expiry)
      } else {
        promise.resolve(nil as String?)
      }
    }

    // PKIローテーション検出: Device CertがIntermediate CAで署名されているか検証
    AsyncFunction("verifyStoredCertChain") { () -> Bool in
      guard let deviceCertData = UserDefaults.standard.data(forKey: Self.deviceCertKey),
            let icaCertData = UserDefaults.standard.data(forKey: Self.intermediateCaCertKey) else {
        return false
      }
      guard let deviceCertRef = SecCertificateCreateWithData(nil, deviceCertData as CFData),
            let icaCertRef = SecCertificateCreateWithData(nil, icaCertData as CFData) else {
        return false
      }
      var trust: SecTrust?
      let policy = SecPolicyCreateBasicX509()
      let status = SecTrustCreateWithCertificates([deviceCertRef, icaCertRef] as CFArray, policy, &trust)
      guard status == errSecSuccess, let trust = trust else {
        return false
      }
      SecTrustSetAnchorCertificates(trust, [icaCertRef] as CFArray)
      SecTrustSetAnchorCertificatesOnly(trust, true)
      var error: CFError?
      let isValid = SecTrustEvaluateWithError(trust, &error)
      if !isValid {
        NSLog("[C2paBridge] verifyStoredCertChain failed: \(error?.localizedDescription ?? "unknown")")
      }
      return isValid
    }

    // 保存済み証明書を全削除（re-provisioning前に使用）
    AsyncFunction("clearStoredCertificates") { () in
      let defaults = UserDefaults.standard
      defaults.removeObject(forKey: Self.deviceCertKey)
      defaults.removeObject(forKey: Self.intermediateCaCertKey)
      defaults.removeObject(forKey: Self.rootCaCertKey)
      NSLog("[C2paBridge] Stored certificates cleared for re-provisioning")
    }
  }

  // MARK: - TEE Operations

  /// Secure Enclave（シミュレータではKeychain）にEC P-256鍵ペアを生成または取得
  private static func getOrCreateTeeKeyPair() throws -> (SecKey, SecKey) {
    // 既存の鍵を検索
    if let privateKey = loadTeePrivateKey(),
       let publicKey = SecKeyCopyPublicKey(privateKey) {
      NSLog("[C2paBridge] Existing TEE key found")
      return (privateKey, publicKey)
    }

    // 新規生成
    NSLog("[C2paBridge] Creating new TEE key pair")

    let tagData = teeKeyTag.data(using: .utf8)!

    var privateKeyAttrs: [String: Any] = [
      kSecAttrIsPermanent as String: true,
      kSecAttrApplicationTag as String: tagData,
    ]

    #if !targetEnvironment(simulator)
    guard let access = SecAccessControlCreateWithFlags(
      kCFAllocatorDefault,
      kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
      .privateKeyUsage,
      nil
    ) else {
      throw NSError(domain: "C2paBridge", code: -1,
                     userInfo: [NSLocalizedDescriptionKey: "Access control creation failed"])
    }
    privateKeyAttrs[kSecAttrAccessControl as String] = access
    #endif

    var attributes: [String: Any] = [
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrKeySizeInBits as String: 256,
      kSecPrivateKeyAttrs as String: privateKeyAttrs,
    ]

    #if !targetEnvironment(simulator)
    attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
    #endif

    var error: Unmanaged<CFError>?
    guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
      let err = error?.takeRetainedValue() as Error? ?? NSError(domain: "C2paBridge", code: -2)
      throw err
    }

    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
      throw NSError(domain: "C2paBridge", code: -3,
                     userInfo: [NSLocalizedDescriptionKey: "Failed to get public key"])
    }

    NSLog("[C2paBridge] TEE key pair created successfully")
    return (privateKey, publicKey)
  }

  private static func loadTeePrivateKey() -> SecKey? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassKey,
      kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
      kSecAttrApplicationTag as String: teeKeyTag.data(using: .utf8)!,
      kSecReturnRef as String: true,
    ]
    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    if status == errSecSuccess {
      return (item as! SecKey)
    }
    return nil
  }

  // MARK: - App Attest (§4.4.1)

  /// App Attest Key IDの保存キー
  private static let appAttestKeyIdKey = "io.rootlens.c2pa.appAttest.keyId"

  /// App Attest を取得する。clientDataHash = SHA-256(CSR)
  /// App Attestが利用不可の場合はnilを返す（DEV_MODEではサーバー側でスキップ）。
  private static func getAppAttestation(csrData: Data, completion: @escaping ([String: String]?) -> Void) {
    if #available(iOS 14.0, *) {
      let service = DCAppAttestService.shared
      guard service.isSupported else {
        NSLog("[C2paBridge] App Attest not supported on this device")
        completion(nil)
        return
      }

      // App Attest Key の取得または生成
      getOrCreateAppAttestKeyId(service: service) { keyId in
        guard let keyId = keyId else {
          NSLog("[C2paBridge] Failed to get App Attest key")
          completion(nil)
          return
        }

        // clientDataHash = SHA-256(CSR) — 仕様書 §4.4.1
        let clientDataHash = SHA256.hash(data: csrData)
        let clientDataHashData = Data(clientDataHash)

        service.attestKey(keyId, clientDataHash: clientDataHashData) { attestObject, error in
          if let error = error {
            NSLog("[C2paBridge] App Attest failed: \(error.localizedDescription)")
            completion(nil)
            return
          }
          guard let attestObject = attestObject else {
            completion(nil)
            return
          }

          NSLog("[C2paBridge] App Attest success: \(attestObject.count) bytes")
          completion([
            "app_attest_object": attestObject.base64EncodedString(),
            "app_attest_key_id": keyId,
          ])
        }
      }
    } else {
      completion(nil)
    }
  }

  @available(iOS 14.0, *)
  private static func getOrCreateAppAttestKeyId(
    service: DCAppAttestService,
    completion: @escaping (String?) -> Void
  ) {
    // 保存済みのApp Attest Key IDがあれば再利用
    if let savedKeyId = UserDefaults.standard.string(forKey: appAttestKeyIdKey) {
      completion(savedKeyId)
      return
    }

    // 新規生成
    service.generateKey { keyId, error in
      if let error = error {
        NSLog("[C2paBridge] App Attest key generation failed: \(error.localizedDescription)")
        completion(nil)
        return
      }
      guard let keyId = keyId else {
        completion(nil)
        return
      }
      UserDefaults.standard.set(keyId, forKey: appAttestKeyIdKey)
      NSLog("[C2paBridge] App Attest key generated: \(keyId)")
      completion(keyId)
    }
  }

  private static func hasStoredCertificate() -> Bool {
    let hasCert = UserDefaults.standard.data(forKey: deviceCertKey) != nil
    let hasKey = loadTeePrivateKey() != nil
    return hasCert && hasKey
  }

  /// TEE署名でC2PAマニフェストを付与 (§4.6)
  /// v0.1.1: assertionsJson (任意 assertion の JSON 配列) を受け取り、c2pa-bridge に渡す。
  private static func signWithTee(inputPath: String, outputPath: String, assertionsJson: String?) -> Int32 {
    guard let privateKey = loadTeePrivateKey() else {
      NSLog("[C2paBridge] TEE private key not found")
      return -10
    }
    guard let deviceCert = UserDefaults.standard.data(forKey: deviceCertKey),
          let intermediateCaCert = UserDefaults.standard.data(forKey: intermediateCaCertKey),
          let rootCaCert = UserDefaults.standard.data(forKey: rootCaCertKey) else {
      NSLog("[C2paBridge] Stored certificates not found")
      return -11
    }

    // DER証明書を連結、サイズ配列を構築（Device + Intermediate CA + Root CA）
    var allCerts = [UInt8](deviceCert) + [UInt8](intermediateCaCert) + [UInt8](rootCaCert)
    var certSizes: [UInt32] = [UInt32(deviceCert.count), UInt32(intermediateCaCert.count), UInt32(rootCaCert.count)]
    let certCount = UInt32(certSizes.count)

    // コンテキストとしてSecKeyのポインタを渡す（retain して callback 完了後に release）
    let keyPtr = Unmanaged.passRetained(privateKey).toOpaque()

    // 仕様書 §4.5.3: RFC 3161 TSAタイムスタンプ（短期証明書には必須）
    let tsaUrl = "http://timestamp.digicert.com"

    let result = allCerts.withUnsafeMutableBufferPointer { certsBuffer in
      certSizes.withUnsafeMutableBufferPointer { sizesBuffer in
        c2pa_sign_image_tee(
          inputPath.cString(using: .utf8),
          outputPath.cString(using: .utf8),
          certsBuffer.baseAddress,
          sizesBuffer.baseAddress,
          certCount,
          teeSignCallbackFn,
          keyPtr,
          tsaUrl.cString(using: .utf8),
          assertionsJson?.cString(using: .utf8)
        )
      }
    }

    Unmanaged<SecKey>.fromOpaque(keyPtr).release()

    return result
  }

  /// C-compatible TEE署名コールバック: Secure Enclave/Keychainで署名
  private static let teeSignCallbackFn: @convention(c) (
    UnsafePointer<UInt8>?,
    UInt32,
    UnsafeMutablePointer<UInt8>?,
    UnsafeMutablePointer<UInt32>?,
    UnsafeMutableRawPointer?
  ) -> Int32 = { data, dataLen, sigOut, sigOutLen, context in
    guard let data = data, let sigOut = sigOut,
          let sigOutLen = sigOutLen, let context = context else {
      return -1
    }

    let key = Unmanaged<SecKey>.fromOpaque(context).takeUnretainedValue()
    let dataToSign = Data(bytes: data, count: Int(dataLen))

    var error: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(
      key,
      .ecdsaSignatureMessageX962SHA256,
      dataToSign as CFData,
      &error
    ) as Data? else {
      NSLog("[C2paBridge] SecKeyCreateSignature failed: \(String(describing: error?.takeRetainedValue()))")
      return -2
    }

    if UInt32(signature.count) > sigOutLen.pointee {
      return -4  // バッファ不足
    }

    signature.copyBytes(to: sigOut, count: signature.count)
    sigOutLen.pointee = UInt32(signature.count)
    return 0
  }

  /// レガシーPEM署名（開発用）
  private static func signWithLegacy(inputPath: String, outputPath: String, promise: Promise) {
    guard let certPath = Bundle.main.path(forResource: "dev-chain", ofType: "pem"),
          let keyPath = Bundle.main.path(forResource: "dev-device-key", ofType: "pem"),
          let certChain = try? String(contentsOfFile: certPath, encoding: .utf8),
          let privateKey = try? String(contentsOfFile: keyPath, encoding: .utf8) else {
      NSLog("[C2paBridge] Dev certs not found")
      promise.reject("CERT_ERROR", "開発用証明書が見つかりません")
      return
    }

    let result = c2pa_sign_image(
      inputPath.cString(using: .utf8),
      outputPath.cString(using: .utf8),
      certChain.cString(using: .utf8),
      privateKey.cString(using: .utf8)
    )

    switch result {
    case 0:
      let outSize = (try? FileManager.default.attributesOfItem(atPath: outputPath)[.size] as? Int) ?? 0
      NSLog("[C2paBridge] Legacy sign success: \(outputPath) (\(outSize) bytes)")
      promise.resolve(outputPath)
    case -1:
      promise.reject("ARG_ERROR", "引数エラー")
    case -2:
      promise.reject("SIGN_ERROR", "署名エラー (code: \(result))")
    default:
      promise.reject("UNKNOWN_ERROR", "不明なエラー: \(result)")
    }
  }

  // MARK: - PKCS#10 CSR Construction (§4.4.1)

  /// CSR (PKCS#10 Certificate Signing Request) をDER構築
  private static func buildCSR(publicKey: SecKey, privateKey: SecKey) -> Data? {
    // 公開鍵の生バイト列を取得 (04 || x || y, 65 bytes for P-256)
    guard let pubKeyRaw = SecKeyCopyExternalRepresentation(publicKey, nil) as Data? else {
      NSLog("[C2paBridge] Failed to export public key")
      return nil
    }

    // CertificationRequestInfoを構築
    let certReqInfo = buildCertificationRequestInfo(publicKeyRaw: [UInt8](pubKeyRaw))

    // CertificationRequestInfoに署名
    var error: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(
      privateKey,
      .ecdsaSignatureMessageX962SHA256,
      Data(certReqInfo) as CFData,
      &error
    ) as Data? else {
      NSLog("[C2paBridge] CSR signing failed: \(String(describing: error?.takeRetainedValue()))")
      return nil
    }

    // CertificationRequest全体を構築
    // signatureAlgorithm: sha256WithECDSA
    let sha256WithECDSA = derSequence(derOID([1, 2, 840, 10045, 4, 3, 2]))
    let signatureBits = derBitString([UInt8](signature))
    let csr = derSequence(certReqInfo + sha256WithECDSA + signatureBits)

    return Data(csr)
  }

  private static func buildCertificationRequestInfo(publicKeyRaw: [UInt8]) -> [UInt8] {
    // version INTEGER (0)
    let version = derInteger(0)

    // subject: O=RootLens, CN=RootLens Device
    let orgOid = derOID([2, 5, 4, 10])
    let orgValue = derUTF8String("RootLens")
    let orgAttr = derSet(derSequence(orgOid + orgValue))

    let cnOid = derOID([2, 5, 4, 3])
    let cnValue = derUTF8String("RootLens Device")
    let cnAttr = derSet(derSequence(cnOid + cnValue))

    let subject = derSequence(orgAttr + cnAttr)

    // subjectPublicKeyInfo
    let ecPublicKeyOid = derOID([1, 2, 840, 10045, 2, 1])
    let prime256v1Oid = derOID([1, 2, 840, 10045, 3, 1, 7])
    let algId = derSequence(ecPublicKeyOid + prime256v1Oid)
    let pubKeyBits = derBitString(publicKeyRaw)
    let spki = derSequence(algId + pubKeyBits)

    // attributes [0] IMPLICIT (empty)
    let attributes: [UInt8] = [0xA0, 0x00]

    return derSequence(version + subject + spki + attributes)
  }

  // MARK: - X.509 Certificate Parsing

  /// X.509 DER証明書からnotAfterをISO 8601文字列として抽出
  private static func extractNotAfter(from certDer: Data) -> String? {
    let bytes = [UInt8](certDer)
    var offset = 0

    // Certificate SEQUENCE
    guard skipTag(&offset, bytes: bytes, expected: 0x30) else { return nil }
    // TBSCertificate SEQUENCE
    guard skipTag(&offset, bytes: bytes, expected: 0x30) else { return nil }
    // version [0] EXPLICIT (optional)
    if offset < bytes.count && bytes[offset] == 0xA0 {
      guard skipTLV(&offset, bytes: bytes) else { return nil }
    }
    // serialNumber INTEGER
    guard skipTLV(&offset, bytes: bytes) else { return nil }
    // signature AlgorithmIdentifier SEQUENCE
    guard skipTLV(&offset, bytes: bytes) else { return nil }
    // issuer Name SEQUENCE
    guard skipTLV(&offset, bytes: bytes) else { return nil }
    // validity SEQUENCE
    guard skipTag(&offset, bytes: bytes, expected: 0x30) else { return nil }
    // notBefore Time
    guard skipTLV(&offset, bytes: bytes) else { return nil }
    // notAfter Time
    return parseTime(&offset, bytes: bytes)
  }

  // MARK: - ASN.1 DER Helpers

  private static func derLength(_ length: Int) -> [UInt8] {
    if length < 0x80 {
      return [UInt8(length)]
    } else if length < 0x100 {
      return [0x81, UInt8(length)]
    } else {
      return [0x82, UInt8((length >> 8) & 0xFF), UInt8(length & 0xFF)]
    }
  }

  private static func derSequence(_ contents: [UInt8]) -> [UInt8] {
    [0x30] + derLength(contents.count) + contents
  }

  private static func derSet(_ contents: [UInt8]) -> [UInt8] {
    [0x31] + derLength(contents.count) + contents
  }

  private static func derInteger(_ value: Int) -> [UInt8] {
    if value == 0 { return [0x02, 0x01, 0x00] }
    var bytes: [UInt8] = []
    var v = value
    while v > 0 { bytes.insert(UInt8(v & 0xFF), at: 0); v >>= 8 }
    if bytes[0] & 0x80 != 0 { bytes.insert(0x00, at: 0) }
    return [0x02] + derLength(bytes.count) + bytes
  }

  private static func derBitString(_ contents: [UInt8]) -> [UInt8] {
    let inner = [UInt8(0x00)] + contents  // 0 unused bits
    return [0x03] + derLength(inner.count) + inner
  }

  private static func derOID(_ components: [UInt]) -> [UInt8] {
    var bytes: [UInt8] = [UInt8(40 * components[0] + components[1])]
    for i in 2..<components.count {
      var val = components[i]
      if val < 0x80 {
        bytes.append(UInt8(val))
      } else {
        var parts: [UInt8] = []
        while val > 0 {
          parts.insert(UInt8(val & 0x7F), at: 0)
          val >>= 7
        }
        for j in 0..<(parts.count - 1) { parts[j] |= 0x80 }
        bytes.append(contentsOf: parts)
      }
    }
    return [0x06] + derLength(bytes.count) + bytes
  }

  private static func derUTF8String(_ str: String) -> [UInt8] {
    let bytes = [UInt8](str.utf8)
    return [0x0C] + derLength(bytes.count) + bytes
  }

  // MARK: - DER Parsing Helpers

  private static func skipTag(_ offset: inout Int, bytes: [UInt8], expected: UInt8) -> Bool {
    guard offset < bytes.count, bytes[offset] == expected else { return false }
    offset += 1
    guard let _ = readLength(&offset, bytes: bytes) else { return false }
    return true
  }

  private static func skipTLV(_ offset: inout Int, bytes: [UInt8]) -> Bool {
    guard offset < bytes.count else { return false }
    offset += 1
    guard let length = readLength(&offset, bytes: bytes) else { return false }
    offset += length
    return offset <= bytes.count
  }

  private static func readLength(_ offset: inout Int, bytes: [UInt8]) -> Int? {
    guard offset < bytes.count else { return nil }
    let first = bytes[offset]
    offset += 1
    if first < 0x80 { return Int(first) }
    let numBytes = Int(first & 0x7F)
    guard offset + numBytes <= bytes.count else { return nil }
    var length = 0
    for i in 0..<numBytes {
      length = (length << 8) | Int(bytes[offset + i])
    }
    offset += numBytes
    return length
  }

  /// UTCTime or GeneralizedTime をISO 8601に変換
  private static func parseTime(_ offset: inout Int, bytes: [UInt8]) -> String? {
    guard offset < bytes.count else { return nil }
    let tag = bytes[offset]
    offset += 1
    guard let length = readLength(&offset, bytes: bytes) else { return nil }
    guard offset + length <= bytes.count else { return nil }
    let timeBytes = Array(bytes[offset..<(offset + length)])
    offset += length

    guard let timeStr = String(bytes: timeBytes, encoding: .ascii) else { return nil }
    let clean = timeStr.replacingOccurrences(of: "Z", with: "")

    let df = DateFormatter()
    df.timeZone = TimeZone(identifier: "UTC")

    if tag == 0x17 {
      // UTCTime: YYMMDDHHMMSSZ
      guard clean.count >= 12 else { return nil }
      let yy = Int(clean.prefix(2)) ?? 0
      let year = yy >= 50 ? 1900 + yy : 2000 + yy
      df.dateFormat = "yyyyMMddHHmmss"
      guard let date = df.date(from: "\(year)\(clean.dropFirst(2))") else { return nil }
      return ISO8601DateFormatter().string(from: date)
    } else if tag == 0x18 {
      // GeneralizedTime: YYYYMMDDHHMMSSZ
      df.dateFormat = "yyyyMMddHHmmss"
      guard let date = df.date(from: clean) else { return nil }
      return ISO8601DateFormatter().string(from: date)
    }
    return nil
  }

  // MARK: - File Resolution

  private static func resolveToFile(_ path: String, completion: @escaping (String?) -> Void) {
    if path.hasPrefix("/") {
      completion(FileManager.default.fileExists(atPath: path) ? path : nil)
      return
    }

    if path.hasPrefix("file://") {
      if let url = URL(string: path), FileManager.default.fileExists(atPath: url.path) {
        completion(url.path)
      } else {
        completion(nil)
      }
      return
    }

    if path.hasPrefix("ph://") {
      var localId = path.replacingOccurrences(of: "ph://", with: "")
      if let slashIndex = localId.firstIndex(of: "/") {
        localId = String(localId[..<slashIndex])
      }

      let results = PHAsset.fetchAssets(withLocalIdentifiers: [localId], options: nil)
      guard let asset = results.firstObject else {
        NSLog("[C2paBridge] PHAsset not found for: \(localId)")
        completion(nil)
        return
      }

      if asset.mediaType == .video {
        let resources = PHAssetResource.assetResources(for: asset)
        guard let videoResource = resources.first(where: { $0.type == .video }) else {
          NSLog("[C2paBridge] No video resource found for: \(localId)")
          completion(nil)
          return
        }
        let ext = (videoResource.originalFilename as NSString).pathExtension.isEmpty
          ? "mov" : (videoResource.originalFilename as NSString).pathExtension
        let tempPath = NSTemporaryDirectory() + "c2pa_input_\(Int(Date().timeIntervalSince1970 * 1000)).\(ext)"
        let tempURL = URL(fileURLWithPath: tempPath)
        let writeOptions = PHAssetResourceRequestOptions()
        writeOptions.isNetworkAccessAllowed = true
        PHAssetResourceManager.default().writeData(for: videoResource, toFile: tempURL, options: writeOptions) { error in
          if let error = error {
            NSLog("[C2paBridge] Failed to export video for: \(localId) - \(error)")
            completion(nil)
          } else {
            let size = (try? FileManager.default.attributesOfItem(atPath: tempPath)[.size] as? Int) ?? 0
            NSLog("[C2paBridge] Exported ph:// video to: \(tempPath) (\(size) bytes)")
            completion(tempPath)
          }
        }
      } else {
        let options = PHImageRequestOptions()
        options.isSynchronous = true
        options.isNetworkAccessAllowed = true
        options.version = .original

        let resources = PHAssetResource.assetResources(for: asset)
        let ext: String
        if let firstResource = resources.first {
          let resExt = (firstResource.originalFilename as NSString).pathExtension
          ext = resExt.isEmpty ? "jpg" : resExt
        } else {
          ext = "jpg"
        }

        PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, _, _, _ in
          guard let data = data else {
            NSLog("[C2paBridge] Failed to get image data for: \(localId)")
            completion(nil)
            return
          }
          let tempPath = NSTemporaryDirectory() + "c2pa_input_\(Int(Date().timeIntervalSince1970 * 1000)).\(ext)"
          try? data.write(to: URL(fileURLWithPath: tempPath))
          NSLog("[C2paBridge] Copied ph:// to: \(tempPath) (\(data.count) bytes)")
          completion(tempPath)
        }
      }
      return
    }

    completion(nil)
  }
}
