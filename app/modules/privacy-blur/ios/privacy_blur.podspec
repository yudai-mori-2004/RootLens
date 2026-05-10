Pod::Spec.new do |s|
  s.name           = 'privacy_blur'
  s.version        = '0.1.0'
  s.summary        = 'On-device face + OCR blur for mp4 (Vision + CoreImage + Metal)'
  s.homepage       = 'https://rootlens.io'
  s.license        = 'MIT'
  s.author         = 'RootLens'
  s.source         = { git: '' }
  s.platform       = :ios, '15.1'

  s.source_files   = '**/*.{swift,h,m}'

  s.frameworks     = 'AVFoundation', 'Vision', 'CoreImage', 'CoreVideo', 'CoreMedia', 'Metal', 'VideoToolbox'

  # AVFoundation / CoreImage 等は iOS 18 時点でまだ Sendable annotation 未整備。
  # AVAssetWriterInput.requestMediaDataWhenReady の closure を扱う際の警告を抑える。
  s.pod_target_xcconfig = {
    'SWIFT_STRICT_CONCURRENCY' => 'minimal',
  }

  s.dependency 'ExpoModulesCore'
end
