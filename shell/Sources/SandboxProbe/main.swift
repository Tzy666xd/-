// 沙盒兼容性探针：把"WKWebView 在 App Sandbox 下到底哪一环不行"拆成四个可独立验证的变量。
// 用法：SandboxProbe <blank|file|scheme> [--nokvc]
// 输出 NAV OK / NAV FAIL，配合不同签名方式跑，就能定位到底是沙盒、file://、
// 自定义 scheme 还是对私有键的 KVC 造成的。
import Cocoa
import WebKit

let mode = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "blank"
let useKVC = !CommandLine.arguments.contains("--nokvc")

final class Handler: NSObject, WKURLSchemeHandler {
  /// 真实 App 的路径：从 bundle 里读文件、带目录穿越防护、要连续响应 html/css/js 多个请求
  let readFromDisk: Bool
  let webRoot: URL?
  init(readFromDisk: Bool = false, webRoot: URL? = nil) {
    self.readFromDisk = readFromDisk
    self.webRoot = webRoot
  }
  func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
    let url = task.request.url ?? URL(string: "app://local/index.html")!
    if readFromDisk, let root = webRoot {
      var rel = url.path
      if rel.isEmpty || rel == "/" { rel = "/index.html" }
      let target = root.appendingPathComponent(String(rel.dropFirst())).standardizedFileURL
      guard target.path.hasPrefix(root.path), let disk = try? Data(contentsOf: target) else {
        print("NAV FAIL 读不到 \(target.path)")
        exit(1)
      }
      let ext = target.pathExtension.lowercased()
      let mime = ext == "css" ? "text/css" : (ext == "js" ? "text/javascript" : "text/html; charset=utf-8")
      var headers = ["Content-Type": mime, "Content-Length": String(disk.count)]
      if ProcessInfo.processInfo.environment["PROBE_CORS"] != nil {
        headers["Access-Control-Allow-Origin"] = "*"
      }
      let r = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)
      if let r = r { task.didReceive(r) }
      task.didReceive(disk)
      task.didFinish()
      return
    }
    let body = "<!doctype html><meta charset=utf-8><body><h1>SCHEME OK</h1></body>".data(using: .utf8)!
    let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                               headerFields: ["Content-Type": "text/html; charset=utf-8",
                                              "Content-Length": String(body.count)])
    if let resp = resp { task.didReceive(resp) }
    task.didReceive(body)
    task.didFinish()
  }
  func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class Del: NSObject, WKNavigationDelegate {
  var done = false
  func webView(_ w: WKWebView, didFinish n: WKNavigation!) {
    done = true
    print("NAV OK mode=\(mode) kvc=\(useKVC)")
    NSApp.terminate(nil)
  }
  func webView(_ w: WKWebView, didFail n: WKNavigation!, withError e: Error) {
    print("NAV FAIL \(e.localizedDescription)")
    exit(1)
  }
  func webView(_ w: WKWebView, didFailProvisionalNavigation n: WKNavigation!, withError e: Error) {
    print("NAV FAIL(provisional) \(e.localizedDescription)")
    exit(1)
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let cfg = WKWebViewConfiguration()
let handler: Handler?
switch mode {
case "scheme": handler = Handler()
case "schemefile", "schemefile-css":
  handler = Handler(readFromDisk: true,
                    webRoot: Bundle.main.resourceURL?.appendingPathComponent("web"))
default: handler = nil
}
if let h = handler { cfg.setURLSchemeHandler(h, forURLScheme: "app") }

let frame = NSRect(x: 0, y: 0, width: 700, height: 460)
let win = NSWindow(contentRect: frame, styleMask: [.titled, .closable], backing: .buffered, defer: false)
let web = WKWebView(frame: frame, configuration: cfg)
let del = Del()
web.navigationDelegate = del
if useKVC { web.setValue(false, forKey: "drawsBackground") }
win.contentView = web
win.makeKeyAndOrderFront(nil)
NSApp.activate(ignoringOtherApps: true)

switch mode {
case "file":
  // 把测试页写进沙盒允许的位置再 loadFileURL
  let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
  let sub = dir.appendingPathComponent("guinea-probe", isDirectory: true)
  try? FileManager.default.createDirectory(at: sub, withIntermediateDirectories: true)
  let page = sub.appendingPathComponent("p.html")
  try? "<!doctype html><meta charset=utf-8><body><h1>FILE OK</h1></body>".write(to: page, atomically: true, encoding: .utf8)
  web.loadFileURL(page, allowingReadAccessTo: sub)
case "scheme":
  web.load(URLRequest(url: URL(string: "app://local/index.html")!))
case "schemefile":
  web.load(URLRequest(url: URL(string: "app://local/index.html")!))
case "schemefile-css":
  // 页面里带 <link rel=stylesheet>，会再发一次 app:// 子请求
  web.load(URLRequest(url: URL(string: "app://local/page.html")!))
default:
  web.loadHTMLString("<!doctype html><meta charset=utf-8><body><h1>BLANK OK</h1></body>", baseURL: nil)
}

DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
  if !del.done { print("NAV TIMEOUT mode=\(mode) kvc=\(useKVC)"); exit(2) }
}
app.run()
