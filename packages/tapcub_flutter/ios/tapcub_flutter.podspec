Pod::Spec.new do |s|
  s.name             = 'tapcub_flutter'
  s.version          = '0.1.0'
  s.summary          = 'TapCub Flutter bridge'
  s.homepage         = 'https://tapcub.com'
  s.license          = { :type => 'Proprietary' }
  s.author           = { 'TapCub' => 'dev@tapcub.com' }
  s.source           = { :path => '.' }
  s.source_files     = 'Classes/**/*'
  s.dependency       'Flutter'
  s.dependency       'TapCub', '~> 0.1'
  s.ios.deployment_target = '13.0'
  s.swift_version    = '5.9'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
end
