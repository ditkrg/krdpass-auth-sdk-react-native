require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

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
  s.source         = { git: 'https://github.com/ditkrg/krdpass-auth-sdk-react-native.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'KrdpassAuth'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = "**/*.{h,m,swift}"
end
