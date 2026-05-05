Pod::Spec.new do |s|
  s.name           = 'hand_pose'
  s.version        = '0.1.0'
  s.summary        = 'Real-time 21-joint hand pose detection (Vision framework)'
  s.homepage       = 'https://rootlens.io'
  s.license        = 'MIT'
  s.author         = 'RootLens'
  s.source         = { git: '' }
  s.platform       = :ios, '15.1'

  s.source_files   = '**/*.{swift,h,m}'

  s.frameworks = 'AVFoundation', 'Vision', 'CoreImage', 'CoreVideo'

  s.dependency 'ExpoModulesCore'
end
