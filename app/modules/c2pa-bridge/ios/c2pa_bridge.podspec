Pod::Spec.new do |s|
  s.name           = 'c2pa_bridge'
  s.version        = '0.1.0'
  s.summary        = 'C2PA signing bridge for RootLens'
  s.homepage       = 'https://rootlens.io'
  s.license        = 'MIT'
  s.author         = 'RootLens'
  s.source         = { git: '' }
  s.platform       = :ios, '15.1'

  s.source_files   = '*.swift'
  s.preserve_paths = 'c2pa_bridge.h', 'module.modulemap'

  s.pod_target_xcconfig = {
    'HEADER_SEARCH_PATHS' => '"${PODS_TARGET_SRCROOT}"',
    'SWIFT_INCLUDE_PATHS' => '"${PODS_TARGET_SRCROOT}"',
    'OTHER_LDFLAGS' => '-ObjC -lc++',
    'LIBRARY_SEARCH_PATHS' => '"${PODS_TARGET_SRCROOT}/lib"',
  }

  s.vendored_libraries = 'lib/libc2pa_rs.a'
  s.frameworks = 'Photos'

  s.dependency 'ExpoModulesCore'
end
