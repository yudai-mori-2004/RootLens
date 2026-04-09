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
  s.preserve_paths = 'c2pa_bridge.h', 'module.modulemap', 'lib/libc2pa_rs_device.a', 'lib/libc2pa_rs_sim.a'
  s.frameworks = 'Photos'

  # シミュレータ / 実機でリンクする .a を切り替える
  s.script_phase = {
    :name => 'Select c2pa_rs for SDK',
    :script => <<~SCRIPT,
      LIB_DIR="${PODS_TARGET_SRCROOT}/lib"
      if [ "${PLATFORM_NAME}" = "iphonesimulator" ]; then
        cp -f "${LIB_DIR}/libc2pa_rs_sim.a" "${LIB_DIR}/libc2pa_rs.a"
      else
        cp -f "${LIB_DIR}/libc2pa_rs_device.a" "${LIB_DIR}/libc2pa_rs.a"
      fi
    SCRIPT
    :execution_position => :before_compile
  }

  s.dependency 'ExpoModulesCore'
end
