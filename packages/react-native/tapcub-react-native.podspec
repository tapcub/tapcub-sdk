require 'json'
package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name         = 'tapcub-react-native'
  s.version      = package['version']
  s.summary      = 'TapCub React Native: optional native crash forwarding'
  s.license      = package['license']
  s.homepage     = 'https://tapcub.com'
  s.author       = 'TapCub'
  s.source       = { :git => 'https://github.com/tapcub/tapcub.git', :tag => "rn-v#{s.version}" }
  s.platforms    = { :ios => '13.0' }
  s.source_files = 'ios/**/*.{h,m}'
  s.dependency 'React-Core'
  s.dependency 'TapCub', '~> 0.1'
end
