// swift-tools-version:5.9
import PackageDescription

// 分层纪律和潮屿一致：core/ 与 web/ 是纯前端，Swift 侧只提供外壳与图标渲染。
// core 里绝不允许出现 AppKit/WebKit——自检才能在 node 里直接跑。
let package = Package(
  name: "Guinea",
  platforms: [.macOS(.v13)],
  targets: [
    .executableTarget(name: "House", path: "Sources/House"),
    .executableTarget(name: "IconRender", path: "Sources/IconRender"),
    .executableTarget(name: "SandboxProbe", path: "Sources/SandboxProbe"),
  ]
)
