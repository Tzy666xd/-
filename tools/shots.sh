#!/bin/bash
# 视觉验证：用真交付物（.app 里的 WKWebView）无头出图。
# 窗口没上屏时 WebKit 的动画时钟与 setTimeout 是冻结的，所以一律走 snap 模式：
# 关掉过渡、按结算事件的序号同步落定视觉状态，每一帧都可复现。
set -uo pipefail
cd "$(dirname "$0")/.."

APP="dist/几尼.app"
BIN="$APP/Contents/MacOS/Guinea"
OUT="${SHOT_OUT:-shots}"
W="${SHOT_WINDOW:-1500x900}"
mkdir -p "$OUT"

export NODE_NO_WARNINGS=1
node tools/build-web.mjs --quiet
rm -rf "$APP/Contents/Resources/web"
mkdir -p "$APP/Contents/Resources/web"
cp web/index.html web/styles.css "$APP/Contents/Resources/web/"
cp -R web/gen "$APP/Contents/Resources/web/gen"

fails=0
shot() {
  local name="$1" query="$2" delay="${3:-700}"
  local defaultBoot='try{localStorage.clear()}catch(e){}'
  local boot="${4:-$defaultBoot}"
  rm -f "$OUT/$name.png"
  # 每次抓图前清掉本机偏好：不然上一轮 uitest 留下的"暖皮革/减少动效"会串进样张
  "$BIN" --shot "$OUT/$name.png" --window "$W" --delay "$delay" \
    --boot "$boot" --query "$query" >/dev/null 2>/tmp/shot.err
  if [[ ! -f "$OUT/$name.png" ]]; then
    echo "  FAIL $name"; sed -n '1,3p' /tmp/shot.err; fails=$((fails + 1)); return
  fi
  echo "  ok   $name"
}

S="snap=1&seed=4242"
CASH="$S&seats=hobbs,rent,house&pick=3,6"

echo "抓帧："
# 标题页样张要的是牌桌本体：给它一份"已经上过课"的偏好，第一次开机那张课表卡就不拦路
PREF_TAUGHT='try{localStorage.clear();localStorage.setItem("guinea.prefs.v1",JSON.stringify({guide:true}))}catch(e){}'
shot 01-title   "seed=20261009"                    900 "$PREF_TAUGHT"
# 第一次开机的课表卡、以及第一节课的气泡：这两张给人判断「课上得清楚不清楚」
shot 20-intro    "snap=1&intro=1"                    900
shot 21-lesson   "snap=1&lesson=1"                   900
# 随机事件的面板平时不弹：要么 ?events=1 点名，要么真打到那一拍。
# 和课表卡同一类坑——靠 transition 淡入的东西在 snap 档里永远是透明的，
# 所以样式里给 .ev-card 补了一条静态终态（styles.css 的 data-snap 那一段）。
shot 22-events   "snap=1&events=1"                   1400
# 局长那一排：13 格要一行装下（装不下就把"入席"那颗顶到屏幕外），高亮必须落在真会跑的数上。
# 散场卡的"几夜通吃"跟着局长走，不许再写死八夜。
shot 23-lengths  "seed=20261009"  900 'try{localStorage.clear();localStorage.setItem("guinea.prefs.v1",JSON.stringify({guide:true,nights:15,flags:{draft:true}}))}catch(e){}'
shot 24-end-15n  "snap=1&seed=4242&end=win"  900 'try{localStorage.clear();localStorage.setItem("guinea.prefs.v1",JSON.stringify({guide:true,nights:15}))}catch(e){}'
# 档位专属牌组：选三夜就该只看见「一手到位」那一副（牌组一排随局长变）
shot 25-deck-3n  "seed=20261009"  900 'try{localStorage.clear();localStorage.setItem("guinea.prefs.v1",JSON.stringify({guide:true,nights:3,deck:"flash"}))}catch(e){}'
# 出牌与弃牌以前只有空格 / X 按得动：这张看两颗按钮在读数下面站得对不对（别压住牌、别顶掉提示行）
shot 26-actions  "$CASH"                           700
# 牌面审片：52 张一次摆出来看点位、人头双头与四套画法下的色（走的是生产那套 syncCard）
shot 27-cardsheet "snap=1&cards=1"  800 'try{localStorage.clear();localStorage.setItem("guinea.prefs.v1",JSON.stringify({guide:true,tutorial:false}))}catch(e){}'
shot 28-cards-eng "snap=1&cards=1"  800 'try{localStorage.clear();localStorage.setItem("guinea.prefs.v1",JSON.stringify({guide:true,tutorial:false,style:"engraving"}))}catch(e){}'
# 牌背审片：扣过来那一面（六张同屏顺带验"六份同名纹样"那类坑，所以纹样走 CSS 不走 SVG id）
PREF_PLAIN='try{localStorage.clear();localStorage.setItem("guinea.prefs.v1",JSON.stringify({guide:true,tutorial:false}))}catch(e){}'
shot 29-backs    "snap=1&backs=1"  800 "$PREF_PLAIN"
# 抽牌礼：三选一里要挑一张牌的那条，玩家先看见的是一排扣过来的牌（走的是点事件卡那一扇门）
shot 30-fan      "snap=1&events=1&fan=1"  1600
shot 02-dealt   "$S"
shot 03-seated  "$CASH"
shot 04-ev0     "$CASH&play=0"
shot 05-ev1     "$CASH&play=1"
shot 06-ev3     "$CASH&play=3"
shot 07-ev6     "$CASH&play=6"
shot 08-ev7     "$CASH&play=7"
shot 09-shop    "$CASH&play=-1"
shot 10-ledger  "$S&ledger=1"
shot 11-boss    "$S&seats=countess,rent&boss=picky&pick=3,6,1&play=-1"
shot 12-end     "$S&end=lose"
shot 13-axes    "$S&seats=hobbs:foil,rent:polychrome,house:negative&seal=0:red,2:blue,4:gold&enh=1:bonus,6:glass"
shot 14-deck-patrick "snap=1&seed=4242&deck=patrician"  600
shot 15-curtain   "$S&boss=picky&curtain=hold"  800
shot 16-codex     "$S&codex=1"                  800
shot 17-receipt   "$S&receipt=1&curtain=hold"  1000
shot 18-settings  "$S&settings=1"               800
shot 19-raise     "$S&shop=1&raise=3"           800

# 同一场景四种画法对照（风格切换只动 CSS 令牌层）
echo "风格样张："
STYLE_SCENE="snap=1&seed=4242&seats=hobbs,rent,house&pick=3,6&play=7"
for st in default deco engraving leather; do
  case $st in default) q="$STYLE_SCENE";; *) q="$STYLE_SCENE&style=$st";; esac
  shot "style-$st" "$q" 900
done
rm -f "$OUT/31-score-detail.png"
"$BIN" --shot "$OUT/31-score-detail.png" --window "$W" --delay 700 --burst 0 \
  --boot "$PREF_PLAIN" --query 'snap=1' \
  --anim "window.__H.start(4242);document.querySelector('#tray .card').click();document.querySelector('#btnPlay').click();document.querySelector('#btnLedger').click();document.querySelector('#ledgerBody details').open=true;" >/dev/null 2>/tmp/shot.err
[[ -s "$OUT/31-score-detail.png" ]] || { echo 'FAIL 31-score-detail'; fails=$((fails + 1)); }
scene() {
  local name="$1" script="$2" query="${3:-snap=1}"
  rm -f "$OUT/$name.png"
  "$BIN" --shot "$OUT/$name.png" --window "$W" --delay 700 --burst 0 \
    --boot "$PREF_PLAIN" --query "$query" --anim "$script" >/dev/null 2>/tmp/shot.err
  [[ -s "$OUT/$name.png" ]] || { echo "FAIL $name"; fails=$((fails + 1)); }
}
scene 32-start-options "document.documentElement.dataset.snap='1';window.__H.setPrefFlag('draft',true);document.querySelector('#startOptions').open=true;" 'seed=20261009'
scene 33-patrons "document.querySelector('#btnCodex').click();document.querySelector('[data-tab=patrons]').click();"
scene 34-deck "document.querySelector('#btnDeck').click();"
scene 35-loss-review "var H=window.__H;H.start(4242);document.querySelector('#tray .card').click();document.querySelector('#btnPlay').click();H.game.state.status='lost';H.game.state.handsLeft=0;H.showEnd(false);"
[[ $fails -eq 0 ]] || { echo "SHOTS FAIL：${fails} 张没生成"; exit 1; }
python3 tools/stylesheet.py "$OUT" || exit 1


python3 tools/sheet.py "$OUT" || exit 1
echo 'SHOTS OK：全部抓帧完成'
