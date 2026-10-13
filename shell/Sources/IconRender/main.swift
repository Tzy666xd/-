// 用代码画 App 图标，不用外部图稿：可复现、几何准、没有水印，
// 换配色只要改这里几行。产物交给 sips/iconutil 出 .icns。
// 用法：IconRender <输出.png> [边长]
import AppKit

let args = CommandLine.arguments
let outPath = args.count > 1 ? args[1] : "icon.png"
let S = args.count > 2 ? (Int(args[2]) ?? 1024) : 1024
// opaque 模式：满幅方形、无透明通道，App Store Connect 要的正是这一张
// （本机 .icns 用默认模式，四角透明才不会被系统再套一层圆角）
let opaque = args.count > 3 && args[3] == "opaque"

guard let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil, pixelsWide: S, pixelsHigh: S,
  bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
  colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
) else {
  fputs("建不出位图\n", stderr); exit(1)
}
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

let u = CGFloat(S) / 1024.0
func v(_ n: CGFloat) -> CGFloat { n * u }

// 角半径按 Apple 图标的比例（约 0.223）
let rect = NSRect(x: 0, y: 0, width: CGFloat(S), height: CGFloat(S))
let tile = opaque
  ? NSBezierPath(rect: rect)
  : NSBezierPath(roundedRect: rect, xRadius: v(228), yRadius: v(228))
if opaque {
  NSColor(calibratedRed: 0.05, green: 0.17, blue: 0.10, alpha: 1).setFill()
  rect.fill()
}

// ① 牌桌绿呢底
let felt = NSGradient(colors: [
  NSColor(calibratedRed: 0.16, green: 0.40, blue: 0.24, alpha: 1),
  NSColor(calibratedRed: 0.05, green: 0.17, blue: 0.10, alpha: 1),
])
tile.setClip()
felt?.draw(in: rect, angle: -90)

// ② 顶部那团烛光
NSGraphicsContext.current?.cgContext.saveGState()
NSGraphicsContext.current?.cgContext.setBlendMode(.plusLighter)
let glow = NSGradient(colors: [
  NSColor(calibratedRed: 1.0, green: 0.86, blue: 0.60, alpha: 0.42),
  NSColor(calibratedRed: 1.0, green: 0.86, blue: 0.60, alpha: 0.0),
])
glow?.draw(fromCenter: NSPoint(x: v(512), y: v(900)), radius: 0,
           toCenter: NSPoint(x: v(512), y: v(900)), radius: v(660))
NSGraphicsContext.current?.cgContext.restoreGState()

// ③ 木色内框 + 一圈黄铜
let wood = opaque
  ? NSBezierPath(rect: NSRect(x: v(34), y: v(34), width: v(956), height: v(956)))
  : NSBezierPath(roundedRect: NSRect(x: v(34), y: v(34), width: v(956), height: v(956)),
                 xRadius: v(198), yRadius: v(198))
wood.lineWidth = v(26)
NSColor(calibratedRed: 0.20, green: 0.12, blue: 0.07, alpha: 0.95).setStroke()
wood.stroke()
wood.lineWidth = v(6)
NSColor(calibratedRed: 0.82, green: 0.66, blue: 0.28, alpha: 1).setStroke()
wood.stroke()

// ④ 火漆印：暗红圆盘 + 黄铜外圈
let seal = NSBezierPath(ovalIn: NSRect(x: v(268), y: v(214), width: v(488), height: v(488)))
NSColor(calibratedRed: 0.42, green: 0.09, blue: 0.14, alpha: 1).setFill()
seal.fill()
seal.lineWidth = v(14)
NSColor(calibratedRed: 0.86, green: 0.70, blue: 0.32, alpha: 1).setStroke()
seal.stroke()

// ⑤ 象牙黑桃：两个下叶 + 一个上三角 + 一截柄（同色叠画即为并集）
let ivory = NSColor(calibratedRed: 0.96, green: 0.93, blue: 0.85, alpha: 1)
ivory.setFill()

NSBezierPath(ovalIn: NSRect(x: v(318), y: v(404), width: v(236), height: v(236))).fill()
NSBezierPath(ovalIn: NSRect(x: v(470), y: v(404), width: v(236), height: v(236))).fill()

let crown = NSBezierPath()
crown.move(to: NSPoint(x: v(512), y: v(742)))
crown.line(to: NSPoint(x: v(352), y: v(556)))
crown.curve(to: NSPoint(x: v(512), y: v(496)),
            controlPoint1: NSPoint(x: v(410), y: v(500)),
            controlPoint2: NSPoint(x: v(470), y: v(496)))
crown.curve(to: NSPoint(x: v(672), y: v(556)),
            controlPoint1: NSPoint(x: v(554), y: v(496)),
            controlPoint2: NSPoint(x: v(614), y: v(500)))
crown.close()
crown.fill()

let stem = NSBezierPath()
stem.move(to: NSPoint(x: v(512), y: v(512)))
stem.curve(to: NSPoint(x: v(452), y: v(346)),
           controlPoint1: NSPoint(x: v(496), y: v(440)),
           controlPoint2: NSPoint(x: v(470), y: v(380)))
stem.line(to: NSPoint(x: v(572), y: v(346)))
stem.curve(to: NSPoint(x: v(512), y: v(512)),
           controlPoint1: NSPoint(x: v(554), y: v(380)),
           controlPoint2: NSPoint(x: v(528), y: v(440)))
stem.close()
stem.fill()

NSGraphicsContext.current?.flushGraphics()
NSGraphicsContext.restoreGraphicsState()

// 上架图必须真的没有 alpha 通道（带着全 255 的 alpha 也会被 App Store Connect 拒）。
// 用 CGContext 以 alphaInfo = .none 重画一遍最可靠：
// NSBitmapImageRep.draw(in:) 那条路实测合成出来是一张近黑图。
let png: Data
if opaque {
  // 用 24 位无 alpha 的 CGContext 重画一遍。注意 makeImage() 必须在 draw/flush 之后取，
  // 提前取会拿到空图，整条分支静默退回带 alpha 的那张（踩过）。
  guard let src = rep.cgImage,
        let cs = CGColorSpace(name: CGColorSpace.sRGB),
        // 32 位 XRGB（noneSkipLast）：CGContext 不接受 24 位无 alpha 的配置，
        // 而 PNG 编码时 noneSkipLast 会落成颜色类型 2 = 真 RGB
        let ctx = CGContext(data: nil, width: S, height: S, bitsPerComponent: 8,
                            bytesPerRow: S * 4, space: cs,
                            bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)
  else { fputs("建不出无 alpha 上下文\n", stderr); exit(1) }
  ctx.draw(src, in: CGRect(x: 0, y: 0, width: CGFloat(S), height: CGFloat(S)))
  ctx.flush()
  guard let flat = ctx.makeImage() else { fputs("重画失败\n", stderr); exit(1) }
  let flatRep = NSBitmapImageRep(cgImage: flat)
  guard let data = flatRep.representation(using: .png, properties: [:]) else {
    fputs("出不了 PNG\n", stderr); exit(1)
  }
  png = data
} else {
  guard let data = rep.representation(using: .png, properties: [:]) else {
    fputs("出不了 PNG\n", stderr); exit(1)
  }
  png = data
}

try! png.write(to: URL(fileURLWithPath: outPath))
print("ICON OK \(outPath) \(S)x\(S) \(png.count) bytes")
