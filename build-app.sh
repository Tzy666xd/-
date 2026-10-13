#!/bin/bash
# 打成一个能双击的 .app，并同步到桌面。
# 每一步都要能在命令行里复现：build-web → swift build → 组装 bundle → 图标 → ad-hoc 签名 → 拷桌面。
set -euo pipefail
cd "$(dirname "$0")"

APP_NAME="几尼"
BUNDLE_ID="local.guinea.app"
EXE="Guinea"
VERSION="1.0"
BIN_NAME="House"
DIST="dist"
APP="$DIST/$APP_NAME.app"
WEB_SRC="web"

export NODE_NO_WARNINGS=1

echo "① 前端打包（类型擦除，零依赖）"
node tools/build-web.mjs

echo "② Swift 外壳"
# 通用二进制：Intel 与 Apple Silicon 都装得上。macOS 27 SDK 会警告 x86_64 已弃用，
# 但产物仍被接受；万一编不动就退回 arm64-only（也合规，只是不覆盖 Intel 机型）。
ARCHS=(--arch arm64 --arch x86_64)
if ! (cd shell && swift build -c release "${ARCHS[@]}" >/dev/null 2>&1); then
  echo "   通用构建失败，退回 arm64-only"
  ARCHS=(--arch arm64)
fi
(cd shell && swift build -c release "${ARCHS[@]}")
BIN="$(cd shell && swift build -c release "${ARCHS[@]}" --show-bin-path)/$BIN_NAME"
ICON_BIN="$(cd shell && swift build -c release "${ARCHS[@]}" --show-bin-path)/IconRender"

echo "③ 组装 bundle"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/$EXE"
printf 'APPL????' > "$APP/Contents/PkgInfo"

# 资源：index.html + styles.css + gen/*.js（gen/ 里只有擦过类型的 JS）
mkdir -p "$APP/Contents/Resources/web"
cp "$WEB_SRC/index.html" "$WEB_SRC/styles.css" "$APP/Contents/Resources/web/"
cp -R "$WEB_SRC/gen" "$APP/Contents/Resources/web/gen"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$APP_NAME</string>
  <key>CFBundleDisplayName</key><string>$APP_NAME</string>
  <key>CFBundleExecutable</key><string>$EXE</string>
  <key>CFBundleIdentifier</key><string>$BUNDLE_ID</string>
  <key>CFBundleShortVersionString</key><string>$VERSION</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <!-- 本地化：界面只有中文，但英文系统下 Finder/Dock 也该看到一个读得懂的名字 -->
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleLocalizations</key>
  <array><string>zh-Hans</string><string>en</string></array>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.card-games</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
  <key>NSHumanReadableCopyright</key><string>所有运算都在本机，无网络依赖，不收集任何数据。</string>
  <key>ITSAppUsesNonExemptEncryption</key><false/>
  <!-- 存档是每步同步写的，被系统直接收走最多丢一次发牌动画；
       但"闲置就被自动退出"对牌局是错的，所以只开 sudden、不开 automatic -->
  <key>NSSupportsSuddenTermination</key><true/>
  <key>NSSupportsAutomaticTermination</key><false/>
</dict>
</plist>
PLIST

# 本地化后的显示名（Finder / Dock / 关于框）。没写 .lproj 的话英文系统会看到中文串。
mkdir -p "$APP/Contents/Resources/zh-Hans.lproj" "$APP/Contents/Resources/en.lproj"
cat > "$APP/Contents/Resources/zh-Hans.lproj/InfoPlist.strings" <<'STRINGS'
CFBundleDisplayName = "几尼";
CFBundleName = "几尼";
NSHumanReadableCopyright = "所有运算都在本机，无网络依赖，不收集任何数据。";
STRINGS
cat > "$APP/Contents/Resources/en.lproj/InfoPlist.strings" <<'STRINGS'
CFBundleDisplayName = "Guinea";
CFBundleName = "Guinea";
NSHumanReadableCopyright = "Everything runs on this machine. No network, no data collected.";
STRINGS

echo "④ 图标（代码画的，不用外部图稿）"
"$ICON_BIN" "$DIST/icon-source.png" 1024
ICONSET="$DIST/AppIcon.iconset"
rm -rf "$ICONSET"; mkdir -p "$ICONSET"
for s in 16 32 64 128 256 512; do
  sips -z $s $s "$DIST/icon-source.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  d=$((s * 2))
  sips -z $d $d "$DIST/icon-source.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
rm -rf "$ICONSET"

echo "⑤ 隐私清单与上架图"
cp shell/Resources/PrivacyInfo.xcprivacy "$APP/Contents/Resources/"
# 上架图要 1024 且真的没有 alpha 通道（App Store Connect 会拒带 alpha 的）
"$ICON_BIN" "$DIST/icon-1024-opaque.png" 1024 opaque

echo "⑥ 签名"
# 必须在所有资源都进包之后再签：先签后拷会让 _CodeSignature 不含新资源，
# codesign --verify 报 "code has no resources but signature indicates they must be present"
if [[ "${RELEASE:-0}" == "1" && -n "${SIGN_IDENTITY:-}" ]]; then
  codesign --force --options runtime --timestamp \
    --entitlements shell/House.entitlements --sign "$SIGN_IDENTITY" "$APP"
else
  codesign --force --sign - "$APP"
fi
# 签名失败必须当场炸，不能带着坏包继续往下拷到桌面
codesign --verify --strict --verbose=2 "$APP" 2>&1 | tail -1
[[ -d "$APP/Contents/_CodeSignature" ]] || { echo "签名没产出 _CodeSignature，包是坏的"; exit 1; }
codesign -dvv "$APP" 2>&1 | grep -q "Sealed Resources=none" && { echo "Sealed Resources 为空，资源没进签名"; exit 1; } || true

echo "⑦ 同步到桌面"
rm -rf "$HOME/Desktop/$APP_NAME.app"
cp -R "$APP" "$HOME/Desktop/"

echo "打好了：$APP"
echo "桌面版：$HOME/Desktop/$APP_NAME.app"
echo "抓图：'$APP/Contents/MacOS/$EXE' --shot /tmp/s.png --delay 1200 --window 1500x900 --query 'autostart=1'"

# ── 发布模式（上架用）───────────────────────────────────────────
# 默认构建是 ad-hoc 且不沙盒：保证双击就能玩。
# RELEASE=1 时套上 App Sandbox entitlements 并用真实证书签名，产出可提交的 zip。
# 沙盒 + ad-hoc 在部分 macOS 上会导致容器建不出来、启动即退，所以本地模式刻意不开沙盒。
if [[ "${RELEASE:-0}" == "1" ]]; then
  IDENTITY="${SIGN_IDENTITY:-}"
  if [[ -z $IDENTITY ]]; then
    echo "RELEASE=1 需要 SIGN_IDENTITY（例如 \"Developer ID Application: 名字 (TEAMID)\"）"
    echo "本机可用身份："; security find-identity -v -p codesigning 2>/dev/null | sed 's/^/  /'
    exit 2
  fi
  echo "⑧ 发布签名（沙盒 + 完整资源）"
  codesign --force --options runtime --timestamp \
    --entitlements shell/House.entitlements --sign "$IDENTITY" "$APP"
  codesign --verify --deep --strict --verbose=2 "$APP" 2>&1 | tail -2
  spctl --assess --type execute --verbose "$APP" 2>&1 | tail -1 || true

  echo "⑨ 打包待提交物"
  ZIP="$DIST/$APP_NAME-$VERSION-universal.zip"
  rm -f "$ZIP"
  ditto -c -k --sequesterRsrc --keepParent "$APP" "$ZIP"
  echo "  $ZIP"
  echo "  公证（需要 notarytool profile 或 App Store Connect API key）："
  echo "    xcrun notarytool store-credentials guinea --apple-id <你> --team-id <TEAMID> --password <app专用密码>"
  echo "    xcrun notarytool submit '$ZIP' --keychain-profile guinea --wait"
  echo "    xcrun stapler staple '$APP'"
fi
