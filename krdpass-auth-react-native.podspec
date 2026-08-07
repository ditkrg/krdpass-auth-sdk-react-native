require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'krdpass-auth-react-native'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = package['author']
  s.homepage       = package['homepage']
  s.platform       = :ios, '15.5'
  s.swift_version  = '6.0'
  s.source         = { git: 'https://github.com/ditkrg/krdpass-auth-sdk-react-native.git', tag: "v#{s.version}" }
  s.static_framework = true

  # The native core is distributed as a GitHub repository, not through the
  # CocoaPods trunk, so CocoaPods cannot resolve this name on its own. The
  # consuming app's Podfile must supply the source:
  #
  #   pod 'KrdpassAuth',
  #     git: 'https://github.com/ditkrg/krdpass-auth-sdk-ios.git',
  #     tag: 'v1.4.0'
  #
  # Pinned exactly so an app cannot silently drift onto a different core.
  s.dependency 'KrdpassAuth', '1.4.0'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # Codegen's ObjC++ adapter is compiled even for the legacy architecture, but
  # is only invoked when the New Architecture is active. Supported React Native
  # versions supply this helper while evaluating an application's Podfile.
  if respond_to?(:install_modules_dependencies, true)
    install_modules_dependencies(s)
  else
    # Keep `pod spec lint` and non-standard Podfile integrations usable. The
    # helper above adds a larger, version-specific dependency set in apps.
    s.dependency 'React-Core'
    s.dependency 'ReactCodegen'
    s.dependency 'ReactCommon/turbomodule/core'
  end

  s.source_files = 'ios/**/*.{h,m,mm,swift}'
  s.private_header_files = 'ios/KrdpassAuthReactNativeModule.h'
end
