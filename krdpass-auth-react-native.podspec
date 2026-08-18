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
  #     tag: 'v1.6.0'
  #
  # Pinned exactly so an app cannot silently drift onto a different core.
  s.dependency 'KrdpassAuth', '1.6.0'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  # React Native supplies this helper while evaluating an application's Podfile.
  # It adds the version-specific React dependency set the Codegen adapter needs.
  install_modules_dependencies(s)

  s.source_files = 'ios/**/*.{h,m,mm,swift}'
  s.private_header_files = 'ios/KrdpassAuthReactNativeModule.h'
end
