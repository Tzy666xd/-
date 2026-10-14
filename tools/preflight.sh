#!/bin/bash
# 上架前自检：每一条都是能跑红的实测，不是给人看的清单。
# 用法：bash tools/preflight.sh          （检查本地构建）
#       CHANNEL=developer-id 或 CHANNEL=app-store 检查对应发布签名。
set -uo pipefail
cd "$(dirname "$0")/.."

APP="dist/几尼.app"
PLIST="$APP/Contents/Info.plist"
RES="$APP/Contents/Resources"
fails=0
pass_n=0

ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; pass_n=$((pass_n + 1)); }
no()   { printf '  \033[31m✗\033[0m %s\n' "$1"; fails=$((fails + 1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }

[[ -d $APP ]] || { echo "没有 ${APP}，先跑 build-app.sh"; exit 1; }

echo "包体结构"
[[ -f "$APP/Contents/MacOS/Guinea" ]] && ok "可执行文件在位" || no "缺可执行文件"
[[ -f "$PLIST" ]] && ok "Info.plist 在位" || no "缺 Info.plist"
[[ -f "$RES/AppIcon.icns" ]] && ok "AppIcon.icns 在位" || no "缺图标"
[[ -f "$RES/PrivacyInfo.xcprivacy" ]] && ok "隐私清单已入包" || no "缺 PrivacyInfo.xcprivacy（App Store 会拒）"
[[ -f "$RES/web/index.html" && -d "$RES/web/gen" ]] && ok "前端资源完整" || no "web 资源缺失"

echo
echo "Info.plist 关键字段"
plutil -lint "$PLIST" >/dev/null 2>&1 && ok "plist 语法合法" || no "plist 语法错"
for kv in CFBundleIdentifier CFBundleShortVersionString CFBundleVersion CFBundleIconFile \
          LSMinimumSystemVersion LSApplicationCategoryType ITSAppUsesNonExemptEncryption NSHumanReadableCopyright; do
  if plutil -extract "$kv" raw "$PLIST" >/dev/null 2>&1; then
    ok "$kv = $(plutil -extract "$kv" raw "$PLIST" 2>/dev/null)"
  else
    no "缺 $kv"
  fi
done
[[ "$(plutil -extract ITSAppUsesNonExemptEncryption raw "$PLIST" 2>/dev/null)" == "true" ]] \
  && warn "ITSAppUsesNonExemptEncryption 应为 false（本 App 不用加密）" \
  || ok "加密申报 = 非豁免加密 false（无需出口申报表格）"
[[ "$(plutil -extract CFBundleShortVersionString raw "$PLIST")" =~ ^[0-9]+\.[0-9]+(\.[0-9]+)?$ ]] \
  && ok "版本号是点分数字（App Store 不接受 alpha/beta 后缀）" || no "版本号格式不合规"

echo
echo "图标"
# .icns 要含全部常见尺寸；上架图要 1024 且真的没有 alpha 通道
# iconutil 解包要求输出目录以 .iconset 结尾，否则直接报参数错
ICOUT=/tmp/guinea-iconset.iconset
rm -rf "$ICOUT"
icns_sizes=$(iconutil -c iconset "$RES/AppIcon.icns" -o "$ICOUT" 2>/dev/null && ls "$ICOUT" 2>/dev/null | wc -l | tr -d ' ')
if [[ "${icns_sizes:-0}" -ge 10 ]]; then
  ok ".icns 含 $icns_sizes 个尺寸（16→512 及 @2x）"
else
  no ".icns 尺寸不足（${icns_sizes:-0}）"
fi
rm -rf "$ICOUT"
if [[ -f dist/icon-1024-opaque.png ]]; then
  read -r w h ct < <(${PY:-python3} -c "
import struct,sys
d=open('dist/icon-1024-opaque.png','rb').read(33)
W,H=struct.unpack('>II',d[16:24]); print(W,H,d[25])" 2>/dev/null)
  [[ "$w" == "1024" && "$h" == "1024" ]] && ok "上架图 1024×1024" || no "上架图尺寸 ${w}×${h}，要 1024×1024"
  [[ "$ct" == "2" ]] && ok "上架图无 alpha 通道（颜色类型 2 = RGB）" || no "上架图带 alpha（颜色类型 ${ct}），会被拒"
else
  no "缺 dist/icon-1024-opaque.png"
fi

echo
echo "隐私：不许有任何远程来源"
# 白名单：plist 的 DTD 声明与 SVG 命名空间，两者都不会产生网络请求
remote=$(grep -rEo 'https?://[^"'"'"' )]+' "$RES/web" 2>/dev/null \
  | grep -vE 'www\.w3\.org/2000/svg|purl\.org/dc/' | head -5)
if [[ -z $remote ]]; then ok "web 资源里没有远程 URL"; else no "发现远程 URL：$remote"; fi
csp=$(grep -c "Content-Security-Policy" "$RES/web/index.html" 2>/dev/null || echo 0)
[[ "$csp" -ge 1 ]] && ok "CSP 已声明" || no "缺 CSP"
con=$(grep -c "connect-src 'none'" "$RES/web/index.html" 2>/dev/null || echo 0)
[[ "$con" -ge 1 ]] && ok "CSP 禁止一切 fetch/XHR" || no "CSP 未禁 connect-src"
netapi=$(grep -rlE "fetch\(|XMLHttpRequest|WebSocket" "$RES/web" 2>/dev/null | head -3)
[[ -z "$netapi" ]] && ok "未使用任何网络 API" || no "代码里出现网络 API：$netapi"
ls_=$(grep -rlc "localStorage" "$RES/web" 2>/dev/null | head -1)
[[ -n "$ls_" ]] && ok "持久化只走 localStorage（沙盒容器内）" || warn "没找到 localStorage 用法"

echo
echo "上架结构"
# 重复键：手写 plist 最容易犯的错，plutil 不报，Xcode 也不会生成，审核工具会挑
dup=$(python3 - "$PLIST" <<'PY'
import re, sys, collections
t = open(sys.argv[1], encoding='utf-8').read()
keys = re.findall(r'<key>([^<]+)</key>', t)
print(','.join(sorted(k for k, n in collections.Counter(keys).items() if n > 1)))
PY
)
[[ -z "${dup:-}" ]] && ok "Info.plist 无重复键" || no "Info.plist 有重复键：$dup"
for kv in CFBundleDevelopmentRegion CFBundleLocalizations NSSupportsSuddenTermination NSSupportsAutomaticTermination; do
  if plutil -extract "$kv" raw "$PLIST" >/dev/null 2>&1 || plutil -extract "$kv" xml1 "$PLIST" >/dev/null 2>&1; then
    ok "$kv 已声明"
  else
    no "缺 $kv"
  fi
done
[[ "$(plutil -extract CFBundleDevelopmentRegion raw "$PLIST" 2>/dev/null)" == "zh_CN" ]] \
  && ok "开发区域 = zh_CN（与界面语言一致）" || warn "开发区域与界面语言不一致"
# plutil -extract 对布尔打的是 false/true 字样，不是 0/1
[[ "$(plutil -extract NSSupportsAutomaticTermination raw "$PLIST" 2>/dev/null)" == "false" ]] \
  && ok "不会被系统闲置退出（牌局中途不该被悄悄收走）" || no "NSSupportsAutomaticTermination 应为 false"
[[ "$(plutil -extract NSSupportsSuddenTermination raw "$PLIST" 2>/dev/null)" == "true" ]] \
  && ok "支持立即退出（存档每步同步写，收走最多丢一次动画）" || warn "NSSupportsSuddenTermination 未开"
for l in zh-Hans en; do
  f="$RES/$l.lproj/InfoPlist.strings"
  if [[ -f $f ]] && plutil -lint "$f" >/dev/null 2>&1; then
    nm=$(sed -n 's/^CFBundleDisplayName *= *"\(.*\)";.*/\1/p' "$f" | head -1)
    ok "$l.lproj 本地化显示名在位：$nm"
  else
    no "缺 $l.lproj/InfoPlist.strings（英文系统会看到中文串）"
  fi
done
cat_ok=$(plutil -extract LSApplicationCategoryType raw "$PLIST" 2>/dev/null)
case " public.app-category.card-games public.app-category.board-games public.app-category.games public.app-category.puzzle-games public.app-category.strategy-games " in
  *" $cat_ok "*) ok "分类合法（${cat_ok}）";;
  *) no "分类不在已知列表里：${cat_ok:-空}";;
esac
# 只查随包发布的 House 目标：SandboxProbe 是诊断工具，它存在的意义就是复现私有 KVC 那条路
priv=$(grep -rn "setValue(.*forKey:\|value(forKey:" shell/Sources/House 2>/dev/null | head -3)
[[ -z "$priv" ]] && ok "外壳没有对私有键做 KVC（审核驳回点）" || no "发现私有 KVC：$priv"
archs_all=$(lipo -archs "$APP/Contents/MacOS/Guinea" 2>/dev/null || echo "")
case "$archs_all" in
  *arm64*x86_64*|*x86_64*arm64*) ok "通用二进制（${archs_all}）";;
  *arm64*) warn "只有 arm64（${archs_all}）：Intel 机型装不上";;
  *) no "架构异常：${archs_all:-读不到}";;
esac

echo
echo "构建卫生"
if grep -rq "$HOME" "$RES/web" 2>/dev/null; then no "资源里泄漏了构建机绝对路径"; else ok "无构建机路径泄漏"; fi
archs=$(lipo -archs "$APP/Contents/MacOS/Guinea" 2>/dev/null || echo "")
case "$archs" in *arm64*) ok "含 arm64（${archs}）";; *) no "缺 arm64（实测：${archs:-读不到}）";; esac
sigout=$(codesign --verify --strict --verbose=2 "$APP" 2>&1 || true)
case "$sigout" in
  *"valid on disk"*|*"satisfies its Designated Requirement"*) ok "签名校验通过（strict）";;
  *) no "签名校验失败：$(echo "$sigout" | tail -1)";;
esac
[[ -d "$APP/Contents/_CodeSignature" ]] && ok "_CodeSignature 在位（资源已封进签名）" || no "缺 _CodeSignature：包是坏的"
siginfo=$(codesign -dvv "$APP" 2>&1 || true)
case "$siginfo" in
  *"Sealed Resources=none"*) no "Sealed Resources 为空，资源没进签名";;
  *"Sealed Resources"*) ok "Sealed Resources 已封入资源";;
  *) no "读不到 Sealed Resources 字段";;
esac
size=$(du -sk "$APP" | cut -f1)
[[ $size -lt 20480 ]] && ok "包体 ${size} KB（< 20 MB）" || warn "包体 ${size} KB 偏大"

echo
echo "内核门禁（上架前必须全绿）"
node core/selftest.ts >/dev/null 2>&1 && ok "selftest 通过" || no "selftest 失败"
node core/fuzz.ts >/dev/null 2>&1 && ok "不变量穷举通过" || no "穷举发现违反"
CHANNEL="${CHANNEL:-$(plutil -extract GuineaDistributionChannel raw "$PLIST" 2>/dev/null || echo local)}"
if [[ "${RELEASE:-0}" == "1" && "$CHANNEL" == "local" ]]; then CHANNEL=developer-id; fi
case "$CHANNEL" in local|developer-id|app-store) ;; *) no "未知分发渠道 ${CHANNEL}"; exit 1;; esac
ent=$(codesign -d --entitlements :- "$APP" 2>/dev/null || true)
sig=$(codesign -dvv "$APP" 2>&1 || true)
if [[ "$CHANNEL" != "local" ]]; then
  echo
  echo "发布模式附加检查"
  plutil -lint shell/House.entitlements >/dev/null 2>&1 && ok "entitlements 语法合法" || no "entitlements 语法错"
  case "$sig" in *runtime*) ok "硬化运行时已启用";; *) no "发布产物未开启硬化运行时";; esac
  if [[ "$CHANNEL" == "app-store" ]]; then
    case "$ent" in *app-sandbox*) ok "App Store 产物带沙盒 entitlement";; *) no "App Store 产物缺少沙盒";; esac
    case "$sig" in *"Authority=Apple Distribution"*|*"Authority=3rd Party Mac Developer Application"*) ok "App Store 分发签名";; *) no "App Store 分发签名不匹配";; esac
  else
    case "$ent" in *app-sandbox*) no "Developer ID 产物不应启用沙盒";; *) ok "Developer ID 产物未启用沙盒";; esac
    case "$sig" in *"Authority=Developer ID Application"*) ok "Developer ID 签名";; *) no "缺少 Developer ID Application 签名";; esac
  fi
fi

echo
echo "─────"
echo "通过 $pass_n 项，失败 $fails 项"
if [[ $fails -eq 0 ]]; then echo "PREFLIGHT OK：${CHANNEL} 构建检查通过（不代表公证或审核已完成）"; else echo "PREFLIGHT FAIL"; exit 1; fi
