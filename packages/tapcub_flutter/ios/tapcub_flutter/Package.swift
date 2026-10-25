// swift-tools-version: 5.9
// Swift Package Manager integration (Flutter 3.24+, on by default since 3.44).
// CocoaPods keeps working through ../tapcub_flutter.podspec; both point at the same sources.

import PackageDescription

let package = Package(
    name: "tapcub_flutter",
    platforms: [
        .iOS("13.0")
    ],
    products: [
        .library(name: "tapcub-flutter", targets: ["tapcub_flutter"])
    ],
    dependencies: [
        .package(name: "FlutterFramework", path: "../FlutterFramework"),
        // The native TapCub iOS SDK; SwiftPM fetches it, so apps need no Podfile line.
        .package(url: "https://github.com/tapcub/tapcub-ios.git", "0.1.0"..<"0.2.0")
    ],
    targets: [
        .target(
            name: "tapcub_flutter",
            dependencies: [
                .product(name: "FlutterFramework", package: "FlutterFramework"),
                .product(name: "TapCub", package: "tapcub-ios")
            ]
        )
    ]
)
