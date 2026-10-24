Pod::Spec.new do |s|
  s.name             = 'tapcub_flutter'
  s.version          = '0.1.0'
  s.summary          = 'TapCub Flutter bridge'
  s.homepage         = 'https://tapcub.com'
  s.license          = { :type => 'MIT', :file => '../LICENSE' }
  s.author           = { 'TapCub' => 'hello@tapcub.com' }
  s.source           = { :path => '.' }
  s.source_files     = 'Classes/**/*'
  s.dependency       'Flutter'
  # TapCub is not on CocoaPods trunk: the app's ios/Podfile adds
  #   pod 'TapCub', :git => 'https://github.com/tapcub/tapcub-ios.git', :tag => '0.1.0'
  s.dependency       'TapCub', '~> 0.1'
  s.ios.deployment_target = '13.0'
  s.swift_version    = '5.9'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
