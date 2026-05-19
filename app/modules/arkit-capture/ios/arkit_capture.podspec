Pod::Spec.new do |s|
  s.name           = 'arkit_capture'
  s.version        = '0.1.0'
  s.summary        = 'ARKit-based egocentric capture, writes Stera-compatible MCAP'
  s.homepage       = 'https://rootlens.io'
  s.license        = 'MIT'
  s.author         = 'RootLens'
  s.source         = { git: '' }
  s.platform       = :ios, '15.1'

  s.source_files   = '**/*.{swift,h,m}'

  s.frameworks = 'ARKit', 'CoreMotion', 'AVFoundation', 'CoreImage', 'CoreVideo', 'SceneKit', 'UIKit'

  s.dependency 'ExpoModulesCore'
end
