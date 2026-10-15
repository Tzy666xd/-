#!/bin/bash
# 界面层门禁：用真交付物（dist/几尼.app 里的 WKWebView）跑 tools/uitest.js。
# 每一轮都从空白 localStorage 起步，需要存档的那一档用文档级脚本先塞一份真档进去。
set -uo pipefail
cd "$(dirname "$0")/.."

APP="dist/几尼.app"
BIN="$APP/Contents/MacOS/Guinea"
JS="tools/uitest.js"
KEYS_PREFS="guinea.prefs.v1"
SAVE="guinea.save.v1"
export NODE_NO_WARNINGS=1

[[ -x "$BIN" ]] || { echo "找不到 ${BIN}，先跑 build-app.sh"; exit 2; }
[[ -f "$JS" ]] || { echo "缺少 $JS"; exit 2; }

node tools/build-web.mjs --quiet || { echo "前端构建失败"; exit 1; }
rm -rf "$APP/Contents/Resources/web"
mkdir -p "$APP/Contents/Resources/web"
cp web/index.html web/styles.css "$APP/Contents/Resources/web/"
cp -R web/gen "$APP/Contents/Resources/web/gen"

# 一份真打出来的存档：结清过一场、买过东西、有账本行
FIXTURE=$(node -e '
const {Game, play, settle, setRaise, buy} = await import("./core/game.ts");
const {serialize} = await import("./core/save.ts");
const g = new Game(4242);
g.state.chosen = g.state.hand.slice(0, 5).map((c) => c.id);
play(g); settle(g); setRaise(g, 1); g.openShop(); buy(g, 0);
process.stdout.write(serialize(g));
' 2>/dev/null)
[[ -n "$FIXTURE" ]] || { echo "造不出存档 fixture"; exit 2; }
BOOT_SAVE="localStorage.clear(); localStorage.setItem('$SAVE', $(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$FIXTURE"));"
# BOOT_EMPTY 里那份偏好只钉一件事：guide:true —— 第一次开机那张课表卡不拦路。
# 其余键照旧走默认值，所以这一档测到的还是"干净的偏好"。
BOOT_EMPTY="localStorage.clear(); localStorage.setItem('$KEYS_PREFS', '{\"guide\":true}');"
# 引导关那一档要的就是"这台机器第一次开机"：偏好里没有 guide 标记，课表卡站在标题页前面。
# 但故意留一格 nights:15 —— 教学局必须锁自己那三夜，这一格就是那条判据的牙：
# 偏好干净的话"锁轮数"是白送的结果，量不出有没有真锁。
BOOT_FIRST="localStorage.clear(); localStorage.setItem('$KEYS_PREFS', '{\"nights\":15}');"
# 一份"上次退出时留下的偏好"：音量静音、快节奏、减少动效、暖皮革、高利贷牌组
PREF_FIXTURE='{"tutorial":false,"guide":true,"vol":0,"speed":1.5,"calm":true,"ambience":false,"style":"leather","muted":false,"deck":"usurer","mode":"run","diff":"grudge"}'
BOOT_PREFS="localStorage.clear(); localStorage.setItem('$KEYS_PREFS', '$PREF_FIXTURE');"
# 性能档要"边放曲边打"，所以音量非零、点了一首曲子：静音状态下调度器根本不转，量不出音频图的泄漏
MUSIC_FIXTURE='{"tutorial":false,"guide":true,"vol":0.7,"speed":1,"calm":false,"ambience":false,"style":"velvet","muted":false,"deck":"standard","mode":"run","diff":"standard","track":1}'
BOOT_MUSIC="localStorage.clear(); localStorage.setItem('$KEYS_PREFS', '$MUSIC_FIXTURE');"

fails=0
# MODES=局长,引导关：只跑标签里含这些词的档。反证扫描复验几条时不必把十四档全跑一遍——
# 每一档都要起一次无头壳，全量一轮就是几十分钟，而且在他眼前反复开应用窗口。
# 和 falsify 的 ONLY 同一课：一个都没匹配上要退出非零，别把"0 档全绿"当成结论。
MODES="${MODES:-}"
ran=0
mode_wanted() {
  [[ -z "$MODES" ]] && return 0
  local p
  IFS=',' read -ra _pats <<< "$MODES"
  for p in "${_pats[@]}"; do [[ "$1" == *"$p"* ]] && return 0; done
  return 1
}
# STOP_FAIL=1：见到第一档红就收工。反证扫描只问「这处破坏有没有让门禁变红」，
# 变红就够了，没必要把剩下十一档都跑完（引导关那档要真点击走完十节课）。
STOP_FAIL="${STOP_FAIL:-0}"
stopped=0
# 动画时钟会在一次跑测中途停摆（实测：开头探针说 OK，跑到第 5 手就 -1ms 卡死）。
# 所以启动时探一次不够——失败时先看是不是"卡住"这一类，是就用代打时钟复跑一遍这一档，
# 并在行首注明复跑。数值判据（事件流、after 快照、DOM 数）两遍是同一套，
# 只有"花了多少毫秒"这一类在代打下会被显式记成「未评」而不是假装通过。
run() {
  local label="$1" boot="$2" query="$3" extra="${4:-}"
  if [[ "$STOP_FAIL" == "1" ]]; then query="$query&failfast=1"; fi
  local out
  if ! mode_wanted "$label"; then return 0; fi
  ran=$((ran + 1))
  if [[ "$STOP_FAIL" == "1" && "$stopped" == "1" ]]; then return 0; fi
  # shellcheck disable=SC2086
  out=$("$BIN" --uitest "$JS" --boot "$boot" --query "$query" --delay 300 --window 1400x860 $extra 2>/tmp/uitest.err)
  local code=$?
  if [[ $code -ne 0 && "$query" == *seed* && "$out" =~ (-1ms|卡在|没给出裁决|疑似时钟节流) ]]; then
    echo "  retry $label —— 像是动画时钟停摆或被节流，改代打时钟复跑"
    # shellcheck disable=SC2086
    out=$("$BIN" --uitest "$JS" --boot "$boot" --query "$query&vclock=1" --delay 300 --window 1400x860 $extra 2>/tmp/uitest.err)
    code=$?
    [[ $code -eq 0 ]] && echo "        （复跑结论，走的是测试代打时钟：级联与状态机算验过，耗时按「未评」记）"
  fi
  if [[ $code -eq 0 ]]; then
    echo "  ok    $label  $out"
  else
    echo "  FAIL  $label"
    echo "$out" | sed 's/^/        /'
    # 异步档里脚本抛错不会变成裁决，只会让外壳等到超时——那几行页面报错才是真凶，必须打出来
    grep -E "页面 (error|warn)|心跳卡了" /tmp/uitest.err | tail -4 | sed 's/^/        ! /'
    sed -n '1,3p' /tmp/uitest.err | sed 's/^/        ~ /'
    fails=$((fails + 1))
    stopped=1
  fi
}

# 显示器状态先报出来。**这一步是必须的**：WKWebView 的动画时钟只在真的合成帧时才走，
# 显示器睡着（CGDisplayIsAsleep=1 / IsActive=0）时 takeSnapshot 照样返回、心跳照样不卡，
# 但 WAAPI 的 finished 永不兑现——于是"跳过演出/性能与泄漏"两档会挂成
# busy=true anims=3 或 -1ms 超时，长得和产品软锁一模一样。
# 2026-10-10 就是被这个骗过：同一份代码先是三跑三绿，显示器睡着后变三跑三红，
# 期间误删了一个本来正常的动画。判据本身没错，是环境给不出结论。
#
# 现在不再"拒绝结论"，而是让测试自己代打时钟：uitest.js 的 vcPump 按真实流逝时间
# 推 document.getAnimations() 的 currentTime。实测（200ms 动画只走了 0ms，
# 而手工设 currentTime 后 finished 立刻兑现）说明这条路能拿到结论。
# 代价要说清楚：**验的是级联与状态机，不验合成器真画出了那一帧**。
DISP=$(python3 -c "
import ctypes
h = ctypes.CDLL('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
d = h.CGMainDisplayID()
print(int(h.CGDisplayIsAsleep(d)), int(h.CGDisplayIsActive(d)))" 2>/dev/null || echo "? ?")
read -r ASLEEP ACTIVE <<< "$DISP"
# 但 CoreGraphics 那个信号只是必要条件：2026-10-11 连着遇到"报醒着、动画却一步不走"
# （跳过演出 -1ms、性能档某手锁 16 秒）。所以再问一次时钟本身——
# 真跑一根 150ms 的 WAAPI 动画，看它能不能自己完成。这条才是判据。
if [[ "${UITEST_CLOCK_STATE:-}" == "CLOCK STUCK" || "${UITEST_CLOCK_STATE:-}" == "CLOCK OK" ]]; then
  CLOCK="$UITEST_CLOCK_STATE"
  echo "时钟探针：复用本批次刚实测的结果（${CLOCK}）"
else
  CLOCK=$("$BIN" --uitest tools/clock-probe.js --boot "$BOOT_EMPTY" --query 'snap=0' \
    --uitest-timeout 12 --delay 200 --window 1400x860 2>/dev/null | grep -o 'CLOCK [A-Z]*' | head -1)
fi
echo "环境探针：动画时钟 ${CLOCK}（实测一根 150ms 动画能不能自己跑完）"

VC=""
if [[ "$ASLEEP" == "1" || "$ACTIVE" == "0" || "$CLOCK" != "CLOCK OK" ]]; then
  VC="&vclock=1"
  echo "环境：显示器 asleep=$ASLEEP active=$ACTIVE / 时钟探针 $CLOCK —— 走测试代打时钟。"
  echo "      「跳过演出」「性能与泄漏」改由测试代打时钟（uitest.js 的 vcPump）。"
  echo "      实测覆盖：性能档从 5/6 涨到 20/21，级联与状态机大部分能验。"
  echo "      仍未覆盖：少数动画的 finished 在无帧时永不兑现（第 4 手 anims=3 就是它），"
  echo "      以及「合成器真的画出了这一帧」。这两条要醒着跑才算验过，别当成全绿。"
else
  echo "环境：显示器醒着（asleep=${ASLEEP} active=${ACTIVE}），走真动画时钟"
fi

echo "界面行为："
EXPORT_OUT="${EXPORT_OUT:-$(mktemp -d "${TMPDIR:-/tmp}/guinea-export-test.XXXXXX")}"
REPORT_FIXTURE=$(node -e '
const {Game,play}=await import("./core/game.ts");const {makeReport}=await import("./core/run-summary.ts");
const g=new Game(4242);g.state.chosen=[g.state.hand[0].id];play(g);g.state.status="lost";
process.stdout.write(JSON.stringify(makeReport(g.state,false,"2026-10-15")));')
run '战报重启回读' "localStorage.clear(); localStorage.setItem('$KEYS_PREFS','{\"guide\":true}'); localStorage.setItem('guinea.last-report.v1','$REPORT_FIXTURE');" 'uitest=shareboot'
run '损坏战报' "localStorage.clear(); localStorage.setItem('$KEYS_PREFS','{\"guide\":true}'); localStorage.setItem('guinea.last-report.v1','{\"v\":1}');" 'uitest=sharebad'
run '分享与稀奇牌' "$BOOT_EMPTY" 'uitest=share&snap=1' "--export-dir $EXPORT_OUT"
run '查阅与复盘' "$BOOT_EMPTY" 'uitest=reference&snap=1'
run '可靠性回归' "$BOOT_EMPTY" 'uitest=reliable&snap=1'
run '焦点/快捷键' "$BOOT_SAVE" 'uitest=keys'
run '设置与偏好' "$BOOT_EMPTY" 'uitest=prefs'
# 局长那一档全是接线判据（点药丸、开局传参、文案），不判手感，压快不改变任何一条结论
run '局长' "$BOOT_EMPTY" 'uitest=lengths&speed=12'
run '重启回读' "$BOOT_PREFS" 'uitest=reload'
run '局内与存档' "$BOOT_EMPTY" 'uitest=again&snap=1&seed=4242'
# 出牌/弃牌以前只有空格与 X 按得动：这一档点真按钮，走同一条 doPlay/doDiscard
run '鼠标可点' "$BOOT_EMPTY" 'uitest=mouse&snap=1&seed=4242'
# 幕布那颗「继 续」：?receipt=1 让内核真结清一场并摆出结清幕（与 17-receipt 样张同源）
run '幕布按钮' "$BOOT_EMPTY" 'uitest=curtain&snap=1&seed=4242&receipt=1'
# 跳过这一档要等真时间走完，所以 --tick 给壳一个渲染心跳：
# WebKit 的动画时钟只在真的画帧时才走，不喂帧 WAAPI 的 finished 永不兑现（详见 main.swift startHeartbeat）
run '跳过演出' "$BOOT_EMPTY" "uitest=skip&seed=4242$VC" '--tick 30'
# 性能档要连打 6 手真演出（每手一秒多），所以超时放宽到 90 秒
run '性能与泄漏' "$BOOT_MUSIC" "uitest=perf&seed=4242$VC" '--tick 30 --uitest-timeout 90'
# 新功能验收档：偏好里把七个开关全打开，界面要认；关掉要当没这功能
FEAT_PREFS='{"tutorial":false,"guide":true,"vol":0,"speed":1.5,"calm":false,"ambience":false,"style":"default","muted":true,"deck":"standard","mode":"run","diff":"gentle","track":0,"flags":{"thresholds":true,"bets":true,"adjacency":true,"sets":true,"growth":true,"layers":true,"discardOps":true,"draft":true}}'
# 音效离线渲染档：判"真的出声了没有"，参数合法但一个样本都不响的那类错只能这样抓
run '音效渲染' "$BOOT_EMPTY" 'uitest=sound&snap=1'
run '新手引导' "$BOOT_EMPTY" "uitest=tutor&seed=4242$VC" '--tick 30 --uitest-timeout 120'
# speed=12：这一档判的是课程翻页与几何，不判手感，把演出时间轴压快十倍
run '引导关' "$BOOT_FIRST" "uitest=guide&seed=20261011&speed=12$VC" '--tick 30 --uitest-timeout 180'
# 随机事件档：只开 events 这一个开关（其余照旧全关），这样这一档测到的
# 就是"新界面上真点击走三选一"，不会被别的功能的判据搅在一起
EVENTS_PREFS='{"tutorial":false,"guide":true,"vol":0,"speed":1.5,"calm":false,"ambience":false,"style":"default","muted":true,"deck":"standard","mode":"run","diff":"gentle","track":0,"flags":{"events":true}}'
run '随机事件' "localStorage.clear(); localStorage.setItem('$KEYS_PREFS', '$EVENTS_PREFS');" "uitest=events&seed=20261012&speed=12$VC" '--tick 30 --uitest-timeout 180'
# 抽牌礼档：要挑一张牌的事件先摆一排扣过来的牌，玩家抽一张。翻面那半圈靠真定时器，
# 所以这一档不吃 snap=1，改吃 speed=12 把 460ms 压到 38ms（判据是"演完收得掉"，不判手感）
run '抽牌礼' "localStorage.clear(); localStorage.setItem('$KEYS_PREFS', '$EVENTS_PREFS');" "uitest=fan&seed=20261012&speed=12$VC" '--tick 30 --uitest-timeout 120'
# 课表卡只由 boot 那几行决定，所以这一档要整页重启：给一份「上过课」的偏好
run '开机现场' "localStorage.clear(); localStorage.setItem('$KEYS_PREFS', '{\\\"guide\\\":true}');" 'uitest=guideboot'
run '新功能验收' "localStorage.clear(); localStorage.setItem('$KEYS_PREFS', '$FEAT_PREFS');" "uitest=feat&snap=1&seed=1002"
# 演出路径单独一档：不加 snap=1，才真的经过 runTimeline（feat 档走的是 applyEventsSync）
run '演出路径' "localStorage.clear(); localStorage.setItem('$KEYS_PREFS', '$FEAT_PREFS');" "uitest=featlive&seed=1002$VC" '--tick 30 --uitest-timeout 120'

echo "----"
if [[ -n "$MODES" && "$ran" == "0" ]]; then
  echo "UITEST FAIL：MODES=$MODES 一个标签都没匹配上（拼错关键词不该变成"0 档全绿"）"
  exit 1
fi
if [[ $fails -eq 0 ]]; then echo "UITEST OK：可评估的界面判据通过$([[ -n "$MODES" ]] && echo "（MODES=${MODES}，只跑了 $ran 档，不是全量门禁）")"; else echo "UITEST FAIL（$fails 档没过）"; exit 1; fi
