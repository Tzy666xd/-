// 几尼 · macOS 外壳
// WKWebView 承载纯前端玩法内核；外壳只负责：自定义 scheme 提供 bundle 内资源、
// 菜单纯退出、以及无头抓图（--shot）用于视觉验证。
//
// 两条已知的平台坑，这里刻意避开：
//   ① 不用 .fullSizeContentView + 透明标题栏——顶部约 28px 的鼠标事件会被标题栏吃掉，
//      压在下面的网页控件点不动。所以窗口是普通的 titled。
//   ② 窗口被遮挡时 WebKit 会冻结 setTimeout，动画时间轴就停了；抓图时把 window.level
//      抬到 screenSaver 并 activate，保证定时器真的在跑。
import Cocoa
import WebKit
import UniformTypeIdentifiers

let SCHEME = "app"
var VERBOSE = false
let T0 = ProcessInfo.processInfo.systemUptime
// 牌桌深处的棕黑：页面首帧之前窗体就是这个颜色，不会闪一下白
let roomDark = NSColor(calibratedRed: 0.071, green: 0.043, blue: 0.020, alpha: 1.0)

func log(_ items: Any...) {
  guard VERBOSE else { return }
  let s = "[壳] \(String(format: "%5.2fs", ProcessInfo.processInfo.systemUptime - T0)) "
    + items.map { "\($0)" }.joined(separator: " ") + "\n"
  FileHandle.standardError.write(s.data(using: .utf8)!)
}

func mimeFor(_ ext: String) -> String {
  switch ext.lowercased() {
  case "html", "htm": return "text/html; charset=utf-8"
  case "js", "mjs": return "text/javascript; charset=utf-8"
  case "css": return "text/css; charset=utf-8"
  case "json": return "application/json; charset=utf-8"
  case "png": return "image/png"
  case "svg": return "image/svg+xml"
  default: return "application/octet-stream"
  }
}

/// file:// 下 ES Module 会被同源策略拦掉，所以用自定义 scheme 供资源。
final class ResourceHandler: NSObject, WKURLSchemeHandler {
  let webRoot: URL

  init(webRoot: URL) {
    self.webRoot = webRoot.standardizedFileURL
  }

  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    let url = task.request.url ?? URL(string: "\(SCHEME)://local/index.html")!
    var rel = url.path
    if rel.isEmpty || rel == "/" { rel = "/index.html" }
    let target = webRoot.appendingPathComponent(String(rel.dropFirst())).standardizedFileURL
    // 目录穿越防护：自定义 scheme 本身可读任意路径，必须圈在资源目录内
    guard target.path.hasPrefix(webRoot.path), let data = try? Data(contentsOf: target) else {
      log("资源未找到", target.path)
      respond(task, url: url, data: Data("404".utf8), mime: "text/plain", status: 404)
      return
    }
    respond(task, url: url, data: data, mime: mimeFor(target.pathExtension), status: 200)
  }

  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

  private func respond(_ task: WKURLSchemeTask, url: URL, data: Data, mime: String, status: Int) {
    // 必须是 HTTPURLResponse：模块脚本走自定义 scheme 时，WebKit 只按 HTTP 响应头判定状态，
    // 给普通 URLResponse 会被当成失败请求。
    let resp = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                               headerFields: [
                                 "Content-Type": mime,
                                 "Content-Length": String(data.count),
                                 "Cache-Control": "no-store",
                                 // 自定义 scheme 下加载 ES module 必须带这个头：
                                 // 模块脚本走的是 CORS 校验那条路径，缺头时主文档能导航完成、
                                 // 模块却永远不执行（App Sandbox 下必现，非沙盒有时反而宽容）。
                                 // 窗户壁纸那版壳子有这个头，搬过来时丢了，找了很久。
                                 "Access-Control-Allow-Origin": "*",
                               ])
    if let resp = resp {
      task.didReceive(resp)
    } else {
      task.didReceive(URLResponse(url: url, mimeType: mime, expectedContentLength: data.count,
                                  textEncodingName: mime.hasPrefix("text/") ? "utf-8" : nil))
    }
    task.didReceive(data)
    task.didFinish()
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKScriptMessageHandler {
  var window: NSWindow!
  var web: WKWebView!
  private var web_isInspectable = false

  private var probeBlank = false
  private var probeOut: String?
  private var shotPath: String?
  private var query = ""
  private var bootJS: String?
  private var uiTestPath: String?
  private var burstOffsets: [Int] = []
  private var animJS: String?
  private var tickMs = 0
  private var uiTestTimeout = 30.0
  private var delayMs = 900
  private var size: NSSize?
  private var shotTaken = false
  private var failed = false
  private var exportTestDir: String?
  private var sharePicker: NSSharingServicePicker?

  func configure(_ args: [String]) {
    func val(_ flag: String) -> String? {
      guard let i = args.firstIndex(of: flag), i + 1 < args.count else { return nil }
      return args[i + 1]
    }
    shotPath = val("--shot")
    probeOut = val("--probe-out")
    probeBlank = args.contains("--probe-blank")
    uiTestPath = val("--uitest")
    if uiTestPath != nil || shotPath != nil { exportTestDir = val("--export-dir") }
    burstOffsets = (val("--burst") ?? "").split(separator: ",").compactMap { Int($0) }
    animJS = val("--anim")
    tickMs = Int(val("--tick") ?? "") ?? 0
    if let t = val("--uitest-timeout"), let n = Double(t), n > 0 { uiTestTimeout = n }
    query = val("--query") ?? ""
    bootJS = val("--boot")
    if let d = val("--delay"), let n = Int(d) { delayMs = n }
    if let w = val("--window") {
      let parts = w.lowercased().split(separator: "x").compactMap { Double($0) }
      if parts.count == 2, parts[0] > 320, parts[1] > 320 { size = NSSize(width: parts[0], height: parts[1]) }
    }
    VERBOSE = shotPath != nil || uiTestPath != nil || ProcessInfo.processInfo.environment["HOUSE_DEBUG"] != nil
  }

  func applicationDidFinishLaunching(_ note: Notification) {
    // 二分用：探针模式下把 App 层差异全关掉（不建菜单、不设 autosave、不进全屏 Space），
    // 用来区分"沙盒拦的是 AppKit 配置还是 WebKit 本身"
    let bare = probeBlank
    if !bare { buildMenu() }
    let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web")
    log("资源目录", webRoot.path, FileManager.default.fileExists(atPath: webRoot.path) ? "存在" : "缺失")

    let config = WKWebViewConfiguration()
    // 测试的 clear()/fixture 只能影响临时数据，不能覆盖玩家的真实存档和偏好。
    if shotPath != nil || uiTestPath != nil || probeBlank { config.websiteDataStore = .nonPersistent() }
    config.setURLSchemeHandler(ResourceHandler(webRoot: webRoot), forURLScheme: SCHEME)
    config.userContentController.add(self, name: "guinea")
    if !probeBlank { config.userContentController.add(self, name: "log") }   // 二分：探针模式下不注册消息处理器
    // 只用公开 API：对私有键做 KVC 既是审核驳回点，在 App Sandbox 下还会让 WebKit 卡住。
    // 13.0–13.2 没有公开的可调试开关，那就退化成"不能调试"，不去碰私有键。
    web_isInspectable = VERBOSE
    if VERBOSE {
      config.userContentController.addUserScript(WKUserScript(source: """
        (function () {
          var send = function (level, text) {
            try { window.webkit.messageHandlers.log.postMessage(level + ': ' + String(text)); } catch (e) {}
          };
          ['log', 'warn', 'error'].forEach(function (k) {
            var orig = console[k];
            console[k] = function () { send(k, Array.prototype.join.call(arguments, ' ')); if (orig) orig.apply(console, arguments); };
          });
          window.addEventListener('error', function (e) {
            send('error', (e.message || '加载失败') + ' @ ' + (e.filename || '?') + ':' + (e.lineno || 0));
          }, true);
          window.addEventListener('unhandledrejection', function (e) {
            send('error', 'Promise: ' + ((e.reason && e.reason.message) || e.reason));
          });
        })();
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    if let boot = bootJS {
      config.userContentController.addUserScript(WKUserScript(
        source: boot, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }

    var frame = NSRect(x: 0, y: 0, width: 1440, height: 860)
    if let s = size { frame.size = s }
    // 小屏（或接了个 1280 宽的外设）上不能一开窗就超出可见区域，
    // 否则底部的手牌和键位提示直接落在屏幕外，看起来像界面坏了
    if let vis = NSScreen.main?.visibleFrame {
      frame.size.width = min(frame.width, vis.width - 40)
      frame.size.height = min(frame.height, vis.height - 40)
    }
    window = NSWindow(contentRect: frame,
                      styleMask: [.titled, .closable, .miniaturizable, .resizable],
                      backing: .buffered, defer: false)
    if bare { window.title = "probe" } else { window.title = "几尼 · 私人牌局" }
    window.minSize = NSSize(width: min(1080, frame.width), height: min(680, frame.height))
    if size == nil && !bare { window.setFrameAutosaveName("MainWindow") }
    window.tabbingMode = .disallowed
    if !bare { window.collectionBehavior.insert(.fullScreenPrimary) }
    if shotPath != nil || uiTestPath != nil {
      // 无头跑时防止被遮挡后定时器停摆
      window.level = .screenSaver
      window.collectionBehavior.insert(.stationary)
    }

    let wv = WKWebView(frame: frame, configuration: config)
    web = wv
    web.navigationDelegate = self
    // 只用公开 API：对私有键做 KVC（developerExtrasEnabled / drawsBackground）是上架审核的常见驳回点
    if #available(macOS 13.3, *) { web.isInspectable = web_isInspectable }
    web.allowsBackForwardNavigationGestures = false
    web.autoresizingMask = [.width, .height]
    // 首帧前不闪白：页面底色与窗体背景都用公开属性压成牌桌的深棕。
    // 私有键 drawsBackground 不再使用——WKWebView 是 layer-backed，公开地压它的 layer 就够了。
    web.underPageBackgroundColor = roomDark
    web.wantsLayer = true
    web.layer?.backgroundColor = roomDark.cgColor
    window.backgroundColor = roomDark
    window.contentView = web
    window.center()
    window.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)

    // 导航不完成过去是静默卡死（App Sandbox 下实测就是这样：进程活着、界面永远不出来）。
    // 超时就明确报错并退出，别让人对着一片黑猜。
    // 这条必须覆盖所有加载路径，包括 --probe-blank：早先它注册在 probeBlank 的 return 之后，
    // 于是"空白探针"永远不超时、永远不退出，那几次"看起来卡死"其实根本没被测到。
    let budget = probeOut != nil ? 10.0 : 12.0
    DispatchQueue.main.asyncAfter(deadline: .now() + budget) { [weak self] in
      guard let self = self, !self.navigated else { return }
      fputs("启动超时：\(Int(budget)) 秒内页面未完成导航。若刚用 App Sandbox 签名，这是已知不兼容（见 AGENTS.md 的\n"
          + "「上架可行性」一节）；去掉沙盒 entitlement 即可本机运行。\n", stderr)
      NSApp.terminate(nil)
    }

    if probeBlank {
      // 二分用：完全不碰自定义 scheme 也不碰 file://，只验证这个 App 里的 WKWebView 能不能完成导航
      web.loadHTMLString("<!doctype html><meta charset=utf-8><body>probe</body>", baseURL: nil)
      return
    }
    var urlStr = "\(SCHEME)://local/index.html"
    if !query.isEmpty { urlStr += "?" + query }
    log("载入", urlStr)
    web.load(URLRequest(url: URL(string: urlStr)!))
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }

  func userContentController(_ c: WKUserContentController, didReceive message: WKScriptMessage) {
    if message.name == "guinea" { handleShare(message); return }
    log("页面", message.body)
  }

  private func shareResult(_ id: Int, _ status: String, _ detail: String = "") {
    let obj: [String: Any] = ["id":id,"status":status,"detail":detail]
    guard let data = try? JSONSerialization.data(withJSONObject: obj), let json = String(data:data,encoding:.utf8) else { return }
    web.evaluateJavaScript("window.dispatchEvent(new CustomEvent('guinea-export',{detail:\(json)}));", completionHandler:nil)
  }

  private func handleShare(_ message: WKScriptMessage) {
    guard message.frameInfo.isMainFrame, message.frameInfo.securityOrigin.`protocol` == SCHEME,
      message.frameInfo.securityOrigin.host == "local", let body=message.body as? [String:Any],
      let id=body["id"] as? Int, let action=body["action"] as? String else { return }
    if action == "copy", let text=body["text"] as? String, text.utf8.count <= 20000 {
      if uiTestPath == nil && shotPath == nil { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(text,forType:.string) }
      shareResult(id,"copied"); return
    }
    guard action == "export" || action == "share", let encoded=body["png"] as? String, encoded.utf8.count <= 20000000,
      let data=Data(base64Encoded:encoded), data.starts(with:[137,80,78,71,13,10,26,10]),
      let image=NSImage(data:data), image.size.width <= 4096, image.size.height <= 4096 else {
      shareResult(id,"error","分享图片无效，请重试。"); return
    }
    if action == "share" {
      if uiTestPath == nil && shotPath == nil {
        let picker=NSSharingServicePicker(items:[image]); sharePicker=picker
        picker.show(relativeTo:NSRect(x:web.bounds.midX,y:web.bounds.midY,width:1,height:1),of:web,preferredEdge:.minY)
      }
      shareResult(id,"presented"); return
    }
    let supplied=body["name"] as? String ?? "几尼-对局分享.png"
    let name=String(supplied.filter { $0.isLetter || $0.isNumber || $0 == "-" || $0 == "." }.prefix(100))
    if let dir=exportTestDir {
      do {
        let folder=URL(fileURLWithPath:dir,isDirectory:true); try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true)
        let url=folder.appendingPathComponent(name.hasSuffix(".png") ? name : "几尼-对局分享.png")
        try data.write(to:url,options:.atomic); shareResult(id,"saved",url.path)
      } catch { shareResult(id,"error","图片保存失败，请重试。") }
      return
    }
    let panel=NSSavePanel(); panel.allowedContentTypes=[.png];panel.nameFieldStringValue=name;panel.title="保存对局分享图片"
    panel.beginSheetModal(for:window) { [weak self] response in
      guard let self=self else{return}
      guard response == .OK, let url=panel.url else{self.shareResult(id,"cancelled");return}
      do{try data.write(to:url,options:.atomic);self.shareResult(id,"saved",url.path)}
      catch{self.shareResult(id,"error","图片保存失败，请换一个位置重试。")}
    }
  }

  private var navigated = false

  func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
    navigated = true
    log("导航完成")
    // 二分用：只报"导航完成"，不碰 VERBOSE 那条注入 console user script 的路径
    if let out = probeOut {
      do { try "nav-ok\n".write(toFile: out, atomically: true, encoding: .utf8); exit(0) }
      catch { fputs("写探针文件失败：\(error.localizedDescription)\n", stderr); exit(1) }
    }
    guard let shot = shotPath else {
      if let js = uiTestPath {
        if tickMs > 0 { startHeartbeat() }
        DispatchQueue.main.asyncAfter(deadline: .now() + Double(delayMs) / 1000) { [weak self] in
          self?.runUITest(at: js)
        }
      }
      return
    }
    if !burstOffsets.isEmpty {
      let offs = burstOffsets
      let trig = animJS
      DispatchQueue.main.asyncAfter(deadline: .now() + Double(delayMs) / 1000) { [weak self] in
        self?.captureBurst(offsets: offs, trigger: trig)
      }
      return
    }
    DispatchQueue.main.asyncAfter(deadline: .now() + Double(delayMs) / 1000) { [weak self] in
      self?.capture(to: shot)
    }
  }

  /// 渲染心跳：WebKit 的动画时钟只在**真的画帧**时才走。
  /// 无头跑界面测试时窗口虽然上了屏（.screenSaver 层 + activate），却没人要求它重画，
  /// 于是 rAF 不触发、WAAPI 的 finished 永不兑现。实测后果：一次出牌卡在 `await landed`，
  /// busy 再也不放开，整档测试只能等超时——看着像产品软锁，其实是环境没喂帧。
  ///
  /// 两个实测教训写在这里，别改回去：
  /// ① 必须**等上一帧回来再排下一帧**。用 Timer 定频会堆积：一次整窗快照要 300–500ms，
  ///    90ms 定频排进去十几张，页面里的 setTimeout 被拖到 8 秒后才触发（探针实测）。
  /// ② 快照只取 1×1 像素。要的只是"逼 WebKit 走一次渲染更新"，不是要图；
  ///    整窗快照的编码与回传成本会直接吃掉被测的时间轴。
  private func startHeartbeat() {
    beat()
  }

  private var lastBeat = Date()

  private func beat() {
    // 心跳自己卡住时，页面里的 WAAPI 就会停在半路（动画时钟只在画帧时走）。
    // 不打这条的话，"测试卡了"和"产品软锁了"长得一模一样，只能靠猜。
    let gap = Date().timeIntervalSince(lastBeat) * 1000
    if gap > 600 { log("心跳卡了", "\(Int(gap))ms") }
    lastBeat = Date()
    let cfg = WKSnapshotConfiguration()
    cfg.rect = CGRect(x: 0, y: 0, width: 1, height: 1)
    cfg.snapshotWidth = NSNumber(value: 1)
    web.takeSnapshot(with: cfg) { [weak self] _, _ in
      guard let self = self else { return }
      DispatchQueue.main.asyncAfter(deadline: .now() + Double(self.tickMs) / 1000) { self.beat() }
    }
  }

  /// 无头行为测试：页面加载完在真实 WebKit 里跑一段 JS，把它的裁决打到 stdout。
  /// 界面层的 bug（快捷键抢输入、静音被音量冲掉、再开一局不换种子）内核自检看不见，
  /// 只能这样点真按钮、发真键盘事件来验。
  ///
  /// 两种脚本：同步的直接 return 裁决字符串；**要等真时间走完的**（演出能不能跳过、
  /// 动画有没有落定）不 return，改把裁决写进 window.__UITEST_RESULT，这里轮询取。
  /// evaluateJavaScript 拿不到 Promise，所以只能轮询——这是它的形状决定的。
  private func runUITest(at path: String) {
    guard let src = try? String(contentsOfFile: path, encoding: .utf8) else {
      fputs("读不到测试脚本：\(path)\n", stderr); exit(2)
    }
    web.evaluateJavaScript(src) { [weak self] result, error in
      if let error = error {
        fputs("UI 测试脚本执行失败：\(error.localizedDescription)\n", stderr)
        print("UITEST FAIL（脚本抛错，一条判据都没跑成）")
        exit(1)
      }
      if let text = result as? String, !text.isEmpty { self?.finishUITest(text); return }
      self?.pollStart = Date()
      self?.pollUITest()
    }
  }

  private var pollStart = Date()

  private func pollUITest() {
    let waited = Date().timeIntervalSince(pollStart)
    if waited > uiTestTimeout {
      print("UITEST FAIL（异步判据 \(Int(uiTestTimeout)) 秒没给出裁决：多半是页面里某个 await 卡死了）")
      exit(1)
    }
    web.evaluateJavaScript("window.__UITEST_RESULT || ''") { [weak self] r, _ in
      guard let self = self else { return }
      if let text = r as? String, !text.isEmpty { self.finishUITest(text); return }
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.08) { self.pollUITest() }
    }
  }

  private func finishUITest(_ text: String) {
    print(text)
    // 只有 "UITEST PASS" 开头才算过；其余（FAIL / 缺行）一律非零退出
    exit(text.hasPrefix("UITEST PASS") ? 0 : 1)
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    // 资源缺失时不能给玩家一个白屏：说清楚坏了，并且给出可操作的下一步
    let text = "牌局开不起来：\(error.localizedDescription)"
    fputs("加载失败：\(error.localizedDescription)\n", stderr)
    if shotPath != nil { exit(1) }
    webView.loadHTMLString("""
      <meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;
      background:#120b05;color:#e8d9b8;font-family:Georgia,serif;text-align:center">
      <div><div style="font-size:26px;letter-spacing:.2em">几 尼</div>
      <div style="margin-top:14px;opacity:.8">\(text)</div>
      <div style="margin-top:10px;font-size:12px;opacity:.55">重新安装 App，或从终端跑一次 build-app.sh</div></div>
      </body>
      """, baseURL: nil)
  }

  private func captureBurst(offsets: [Int], trigger: String?) {
    burstStart = Date()
    burstLeft = offsets.count
    if let js = trigger {
      web.evaluateJavaScript(js) { _, _ in self.scheduleBurst(offsets) }
    } else {
      scheduleBurst(offsets)
    }
  }

  private var burstStart = Date()
  private var burstLeft = 0

  private func scheduleBurst(_ offsets: [Int]) {
    for off in offsets {
      DispatchQueue.main.asyncAfter(deadline: .now() + Double(off) / 1000) { [weak self] in
        guard let self = self else { return }
        let real = Int(Date().timeIntervalSince(self.burstStart) * 1000)
        self.web.takeSnapshot(with: nil) { image, _ in
          let rep = image.flatMap { NSBitmapImageRep(data: $0.tiffRepresentation ?? Data()) }
          guard let rep = rep, let png = rep.representation(using: .png, properties: [:]) else {
            fputs("连拍快照失败\n", stderr); exit(1)
          }
          let path = (self.shotPath ?? "/tmp/burst-%d.png").replacingOccurrences(of: "%d", with: String(off))
          do { try png.write(to: URL(fileURLWithPath: path)) } catch {
            fputs("写出失败：\(error.localizedDescription)\n", stderr); exit(1)
          }
          self.burstLines.append("\(off)\t\(real)\t\(png.count)")
          self.burstLeft -= 1
          if self.burstLeft == 0 {
            print("BURST OK \(offsets.count) 帧  计划ms  实际ms  字节")
            print(self.burstLines.joined(separator: "\n"))
            exit(0)
          }
        }
      }
    }
  }

  private var burstLines: [String] = []

  private func capture(to path: String) {
    guard !shotTaken else { return }
    shotTaken = true
    // 抓完先冻结时间轴，避免快照过程中动画继续跑
    web.evaluateJavaScript("window.__H && (window.__H.speed = 40)") { _, _ in
      self.web.takeSnapshot(with: nil) { image, error in
        let rep = image.flatMap { NSBitmapImageRep(data: $0.tiffRepresentation ?? Data()) }
        guard let rep = rep, let png = rep.representation(using: .png, properties: [:]) else {
          self.failed = true
          fputs("快照失败：\(error?.localizedDescription ?? "无位图")\n", stderr)
          exit(1)
        }
        do {
          try png.write(to: URL(fileURLWithPath: path))
          print("SHOT OK \(path) \(png.count) bytes")
          exit(0)
        } catch {
          fputs("写出失败：\(error.localizedDescription)\n", stderr)
          exit(1)
        }
      }
    }
  }

  func buildMenu() {
    let main = NSMenu()
    let appItem = main.addItem(withTitle: "几尼", action: nil, keyEquivalent: "")
    let appMenu = NSMenu()
    appItem.submenu = appMenu
    appMenu.addItem(withTitle: "关于几尼", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
    appMenu.addItem(.separator())
    appMenu.addItem(withTitle: "退出几尼", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")

    let gameItem = main.addItem(withTitle: "牌局", action: nil, keyEquivalent: "")
    let gameMenu = NSMenu(title: "牌局")
    gameItem.submenu = gameMenu
    let newRun = gameMenu.addItem(withTitle: "新开局", action: #selector(menuNew), keyEquivalent: "n")
    newRun.target = self
    gameMenu.addItem(.separator())
    gameMenu.addItem(withTitle: "关闭窗口", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")

    let editItem = main.addItem(withTitle: "编辑", action: nil, keyEquivalent: "")
    let editMenu = NSMenu(title: "编辑")
    editItem.submenu = editMenu
    editMenu.addItem(withTitle: "全选", action: Selector(("selectAll:")), keyEquivalent: "a")

    let winItem = main.addItem(withTitle: "窗口", action: nil, keyEquivalent: "")
    let winMenu = NSMenu(title: "窗口")
    winItem.submenu = winMenu
    winMenu.addItem(withTitle: "最小化", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
    winMenu.addItem(withTitle: "缩放", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
    NSApp.windowsMenu = winMenu

    NSApp.mainMenu = main
  }

  @objc func menuNew() {
    web.evaluateJavaScript("window.__H && window.__H.start(\(Int(Date().timeIntervalSince1970) % 900000 + 1000))",
                           completionHandler: nil)
  }
}

let app = NSApplication.shared
let delegate = AppDelegate()
delegate.configure(CommandLine.arguments)
app.delegate = delegate
app.setActivationPolicy(CommandLine.arguments.contains("--probe-blank") ? .accessory : .regular)
app.run()
