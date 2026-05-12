import Foundation
import CryptoKit

// 仕様書 §6.1 Title Protocol登録パイプライン — E2EE チャネル用 AES-256-GCM
// Android AesGcmModule.kt と同一の入出力仕様

@objc(AesGcmBridge)
class AesGcmModule: NSObject {

  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  /// バイナリペイロード構築 + AES-256-GCM暗号化をネイティブで一括実行。
  ///
  /// plaintext: [4B meta_len BE][metadata][content_file_bytes]
  /// output:    [suite_id(1B)][encap_key_len(2B BE)][encap_key][nonce(12B)][ciphertext+tag]
  ///
  /// メモリ戦略: 1 分動画 (1080p H.264 ≈ 75 MB) でも resident 増加を最小化する。
  ///   • content file は `.alwaysMapped` で mmap → physical memory への即時ロードを避ける
  ///   • plaintext (= meta_len + meta + content) も mmap-backed Data の append。CryptoKit が
  ///     seal で contiguous bytes を要求した時に OS が必要分だけ paging する
  ///   • output は Data に concat せず FileHandle で stream 書き込み。最終的な 4 重複コピー
  ///     (raw / plaintext / ciphertext / output) を回避
  @objc
  func buildAndEncryptPayload(
    _ contentFilePath: String,
    metadataJson: String,
    requestKeyBase64: String,
    encapKeyBase64: String,
    aadString: String,
    outputFilePath: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      autoreleasepool {
        do {
          guard let key = Data(base64Encoded: requestKeyBase64) else {
            throw AesGcmError.invalidBase64("requestKey")
          }
          guard let encapKey = Data(base64Encoded: encapKeyBase64) else {
            throw AesGcmError.invalidBase64("encapKey")
          }
          guard let aad = aadString.data(using: .utf8) else {
            throw AesGcmError.invalidEncoding("aad")
          }
          guard let metaBytes = metadataJson.data(using: .utf8) else {
            throw AesGcmError.invalidEncoding("metadata")
          }

          // mmap で content を仮想領域として読み込む。alwaysMapped にしないと iOS は
          // "small files only" 判定でファイル全体を物理メモリに読み込んでしまう。
          let content = try Data(
            contentsOf: URL(fileURLWithPath: contentFilePath),
            options: [.alwaysMapped, .uncached]
          )

          // plaintext = metaLen + meta + content
          var metaLen = UInt32(metaBytes.count).bigEndian
          var plaintext = Data(capacity: 4 + metaBytes.count + content.count)
          plaintext.append(Data(bytes: &metaLen, count: 4))
          plaintext.append(metaBytes)
          plaintext.append(content)

          // AES-256-GCM with AAD
          let symmetricKey = SymmetricKey(data: key)
          let nonce = AES.GCM.Nonce()
          let sealedBox = try AES.GCM.seal(plaintext, using: symmetricKey, nonce: nonce, authenticating: aad)
          plaintext = Data() // 即解放: ciphertext を持つ間さらに plaintext 抱える理由なし

          // 出力ファイルを FileHandle で stream 書き込み (output Data に concat しない)
          FileManager.default.createFile(atPath: outputFilePath, contents: nil)
          guard let handle = FileHandle(forWritingAtPath: outputFilePath) else {
            throw AesGcmError.invalidEncoding("cannot open output file for writing")
          }
          defer { try? handle.close() }

          let suiteId: UInt8 = 0x01  // X25519-AES-256-GCM
          var encapKeyLen = UInt16(encapKey.count).bigEndian

          var totalSize = 0
          handle.write(Data([suiteId]));                          totalSize += 1
          handle.write(Data(bytes: &encapKeyLen, count: 2));      totalSize += 2
          handle.write(encapKey);                                 totalSize += encapKey.count
          handle.write(Data(sealedBox.nonce));                    totalSize += 12
          handle.write(sealedBox.ciphertext);                     totalSize += sealedBox.ciphertext.count
          handle.write(sealedBox.tag);                            totalSize += sealedBox.tag.count

          resolve(["size": totalSize])
        } catch {
          reject("BUILD_ENCRYPT_ERROR", error.localizedDescription, error)
        }
      }
    }
  }

  /// ファイルパス方式 AES-256-GCM暗号化（AAD付き）。大容量データがBridgeを通過しない。
  @objc
  func encryptFile(
    _ inputPath: String,
    outputPath: String,
    keyBase64: String,
    aadBase64: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        guard let key = Data(base64Encoded: keyBase64) else {
          throw AesGcmError.invalidBase64("key")
        }
        guard let aad = Data(base64Encoded: aadBase64) else {
          throw AesGcmError.invalidBase64("aad")
        }
        let plaintext = try Data(contentsOf: URL(fileURLWithPath: inputPath))

        let symmetricKey = SymmetricKey(data: key)
        let sealedBox = try AES.GCM.seal(plaintext, using: symmetricKey, authenticating: aad)

        // Android: cipher.doFinal() = ciphertext + tag
        var ciphertextWithTag = Data(sealedBox.ciphertext)
        ciphertextWithTag.append(sealedBox.tag)
        try ciphertextWithTag.write(to: URL(fileURLWithPath: outputPath))

        let nonceBase64 = Data(sealedBox.nonce).base64EncodedString()

        resolve(["nonce": nonceBase64, "size": ciphertextWithTag.count])
      } catch {
        reject("AES_ENCRYPT_FILE_ERROR", error.localizedDescription, error)
      }
    }
  }

  /// ファイルパス方式 AES-256-GCM復号（AAD付き）
  @objc
  func decryptFile(
    _ inputPath: String,
    outputPath: String,
    keyBase64: String,
    nonceBase64: String,
    aadBase64: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.global(qos: .userInitiated).async {
      do {
        guard let key = Data(base64Encoded: keyBase64) else {
          throw AesGcmError.invalidBase64("key")
        }
        guard let nonceData = Data(base64Encoded: nonceBase64) else {
          throw AesGcmError.invalidBase64("nonce")
        }
        guard let aad = Data(base64Encoded: aadBase64) else {
          throw AesGcmError.invalidBase64("aad")
        }
        let ciphertextWithTag = try Data(contentsOf: URL(fileURLWithPath: inputPath))

        let symmetricKey = SymmetricKey(data: key)
        let nonce = try AES.GCM.Nonce(data: nonceData)

        // Android GCM: ciphertext includes 16-byte tag at the end
        let tagSize = 16
        guard ciphertextWithTag.count >= tagSize else {
          throw AesGcmError.dataTooShort
        }
        let ciphertext = ciphertextWithTag.prefix(ciphertextWithTag.count - tagSize)
        let tag = ciphertextWithTag.suffix(tagSize)

        let sealedBox = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
        let plaintext = try AES.GCM.open(sealedBox, using: symmetricKey, authenticating: aad)

        try plaintext.write(to: URL(fileURLWithPath: outputPath))
        resolve(outputPath)
      } catch {
        reject("AES_DECRYPT_FILE_ERROR", error.localizedDescription, error)
      }
    }
  }
}

private enum AesGcmError: LocalizedError {
  case invalidBase64(String)
  case invalidEncoding(String)
  case dataTooShort

  var errorDescription: String? {
    switch self {
    case .invalidBase64(let field):
      return "Invalid base64 for \(field)"
    case .invalidEncoding(let field):
      return "Invalid UTF-8 encoding for \(field)"
    case .dataTooShort:
      return "Ciphertext too short (must include 16-byte GCM tag)"
    }
  }
}
