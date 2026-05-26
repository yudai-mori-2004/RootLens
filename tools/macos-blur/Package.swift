// swift-tools-version: 6.3

import PackageDescription

let package = Package(
    name: "MacOsBlur",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "MacOsBlur"
        ),
    ],
    swiftLanguageModes: [.v6]
)
