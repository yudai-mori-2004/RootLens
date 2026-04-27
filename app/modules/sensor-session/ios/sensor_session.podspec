Pod::Spec.new do |s|
  s.name           = 'sensor_session'
  s.version        = '0.1.0'
  s.summary        = 'Abstract sensor session (Camera / IMU / Depth) for RootLens'
  s.homepage       = 'https://rootlens.io'
  s.license        = 'MIT'
  s.author         = 'RootLens'
  s.source         = { git: '' }
  s.platform       = :ios, '15.1'

  s.source_files   = '**/*.{swift,h,m}'

  s.frameworks = 'AVFoundation', 'CoreMotion', 'CoreImage'

  s.dependency 'ExpoModulesCore'
end
