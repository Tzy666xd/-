#!/bin/bash
# 证明界面门禁不是假绿：往界面层注入一处具体破坏，重构建，跑 uitest，要求它失败。
# 和 tools/falsify.sh 同一个道理，只是那边管内核，这边管 DOM 行为。
#
# ONLY=说明里的关键词（逗号分隔）可以只跑那几条：盲区修完想复验时没必要 68 条全跑，
# 每条注入都要起一遍无头 App，全量跑一次就是几十个窗口。ONLY 匹配到 0 条直接退出非零——
# 拼错关键词不该变成"0 条盲区，OK"的假绿。
set -uo pipefail
cd "$(dirname "$0")/.."
export STOP_FAIL=1   # 每条注入只问红没红，第一档红就收工（见 uitest.sh）

SRC=web/main.ts
BAK=$(mktemp -d)
cp -R web/. "$BAK/"
[[ -f "$BAK/main.ts" ]] || { echo "备份失败，拒绝运行"; exit 2; }
restore() { cp -R "$BAK/." web/; node tools/build-web.mjs --quiet >/dev/null; }
trap 'restore; rm -rf "$BAK"' EXIT

# ||| 分隔：文件 原样 改成 说明
INJ=(
  "web/main.ts|||refreshResume();\n// 第一次玩的话|||void 0;\n// 第一次玩的话|||启动时不查存档：续局按钮永远不出现"
  "web/main.ts|||  savePrefs();\n}|||  void 0;\n}|||设置改完不落盘：改完音量/画法重启就全丢"
  "web/main.ts|||  if (tag === 'INPUT' || tag === 'TEXTAREA') {|||  if (false) {|||快捷键在输入框里照样抢按键"
  "web/main.ts|||sfx.muted = prefs.muted || prefs.vol === 0;|||sfx.muted = prefs.vol === 0;|||改音量把手动静音冲掉"
  "web/main.ts|||  const next = dailyLocked() ? dailySeed() : 1000 + Math.floor(Math.random() * 899900);|||  const next = g.state.seed;|||再开一局 replay 同一个种子"
  "web/main.ts|||        prefs[key] = item.id as never;|||Ø|||选的牌组留不到下一次"
  "web/main.ts|||pickedDeck = prefs.deck;|||pickedDeck = 'standard';|||下次启动不认上次选的牌组"
  "web/main.ts|||  speedMul = Math.max(0.05, prefs.speed);|||  void 0;|||节奏那一排按下去什么都不改"
  "web/main.ts|||  paintSoundBtn();|||  void 0;|||静音按钮的文案与实际状态脱节"
  "web/main.ts|||    if (ff) break;|||    if (false) break;|||按了跳过，级联照旧一条条演完"
  "web/main.ts|||    if (busy) { requestSkip(); return; }|||    if (busy) { return; }|||演出中按空格什么也不做（键盘玩家没有跳过）"
  "web/main.ts|||need('#board').addEventListener('click', () => requestSkip());|||need('#board').addEventListener('click', () => { void 0; });|||演出中点牌桌不能跳过（鼠标玩家没有跳过）"
  "web/main.ts|||  if (ff) { applyEventsSync(res, played, -1); ff = false; }|||  if (ff) { ff = false; }|||跳过之后读数停在半路，和内核记的账对不上"
  "web/main.ts|||  if (!busy) return;\n  ff = true;|||  ff = true;|||没在演出时也置跳过标记，下一手被无声吃掉"
  "web/main.ts|||if (!alive.has(id)) { n.remove(); cardEls.delete(id); }|||if (!alive.has(id)) n.remove();|||打过的牌永远挂在 cardEls 上（连 click 闭包一起）"
  "web/main.ts|||      if (lp) drop(lp);|||Ø|||中提琴那声的低通没从音频图上摘下来，越放越重"
  "web/main.ts|||  renderThresholdMarks();|||  void 0;|||P0-3 水位条上不画阈值刻度，玩家看不见还有几条线"
  'web/main.ts|||  if (!gap) { if (note) note.remove(); return; }|||  if (false) { if (note) note.remove(); return; }|||P0-3 够不着线时旧的"还差多少"赖在屏上不消失'
  "web/main.ts|||  if (!draftEligible()) { box.classList.add('hidden'); return; }|||  if (false) { box.classList.add('hidden'); return; }|||关掉签名宾开关后候选框还杵在标题页"
  "web/main.ts|||  draftRerolls = nextRerolls(draftRerolls);|||  void 0;|||签名宾「换一批」是假按钮"
  "web/main.ts|||      prefs.signature = prefs.signature === p.id ? '' : p.id;|||      void 0;|||点候选卡选不上人"
  "web/main.ts|||    signature: prefs.flags.draft ? prefs.signature : '',|||    signature: '',|||选好的签名宾没带进局里"
  "web/main.ts|||  draftRerolls = 0;\n  renderDraft();\n});\nneed('#btnReroll')|||  draftRerolls = 0;\n});\nneed('#btnReroll')|||换种子之后候选框不重画，屏幕上留着上一批人"
  "web/main.ts|||  c.dataset.pid = p.id;|||  void 0;|||候选卡认不出是谁，选中状态与开局入座都会错位"
  "web/main.ts|||      n.append(shift);|||      void 0;|||P0-2 铺子里根本没有换座箭头"
  "web/main.ts|||    const oldShift = q<HTMLElement>('.shift', n);|||    const oldShift = null;|||P0-2 换座箭头在缓存的节点上一路累加，回到牌桌还留着"
  "web/main.ts|||    tagChip.textContent = (g.state.flags.adjacency || g.state.flags.sets)|||    tagChip.textContent = (true)|||P1-1/P0-2 关掉开关 tag 还刻在客人身上，等于没关掉"
  "web/main.ts|||  if (g.state.flags.sets) {|||  if (false) {|||P1-1 凑齐了套装铺子里不报告，构筑没有正反馈"
  "web/main.ts|||  if (g.state.flags.discardOps) {|||  if (false) {|||P1-4 铺子里看不见弃牌堆"
  "web/main.ts|||      case 'bonus': {\n        // P0-3 阈值达成|||      case 'nothing-here': {\n        // P0-3 阈值达成|||P0-3 达标那一行在演出里被跳过，玩家看不见奖励是哪儿来的"
  "web/main.ts|||      case 'bonus': {\n        // 跳过/抓帧路径|||      case 'nothing-here': {\n        // 跳过/抓帧路径|||P0-3 跳过路径不结算 bonus，读数停在半路"
  "web/main.ts|||        + (g.state.flags.bets ?|||        + (false ?|||P0-1 抬注档上不写失手后果，风险决策变成盲押"
  "web/main.ts|||  lastChain = res;|||  void 0;|||拆解视图在跳过/抓帧后拿到空账"

  "web/main.ts|||  setHeat(v: number): void { this.heat = Math.max(0, Math.min(2, Math.round(v))); }|||  setHeat(v: number): void { void v; }|||局势写不进播放器，音乐永远不紧张"
  "web/main.ts|||  music.setHeat(heat);|||  void 0;|||算出来的局势没交给播放器"
  "web/main.ts|||      const evs = plan(this.tune, this.step, 1, this.heat);|||      const evs = plan(this.tune, this.step, 1, 0);|||调度器排音时根本不带上局势，加层是假的"
  "web/main.ts|||      + (s.handsLeft <= 1 ? 1 : 0) + (s.raisedHere > 0 ? 1 : 0))|||      + (s.raisedHere > 0 ? 1 : 0))|||只剩一次牌权不再算紧张"
  "web/main.ts|||    if (hint) b.title = hint;|||    void 0;|||曲名按钮没有场景提示，八首只看得懂第一首"
  "web/main.ts|||      TUNES.map((x, i) => [x.short, i + 1,|||      TUNES.slice(0, 4).map((x, i) => [x.short, i + 1,|||加了曲子但选单没跟着长，表里有、点上没有"
  "web/main.ts|||      if (extra) drop(extra);|||Ø|||鼓点的滤波器没从音频图上摘下来，越放越重"
  "web/styles.css|||.patron.empty .cameo { display: grid; place-items: center; }|||.patron.empty .cameo { display: block; }|||虚席的加号被推到椭圆外面，等于没有提示"
  "web/main.ts|||        sfx.play('bonus');|||Ø|||P0-3 跨过阈值那一行没有声音反馈"
  "web/main.ts|||  sfx.play(on ? 'pick' : 'unpick');|||Ø|||选牌与放回没有声音"
  "web/main.ts|||    this.fired[cue] = (this.fired[cue] ?? 0) + 1;|||Ø|||音效日志失效，响过哪些声根本没记"
  "web/main.ts|||    // 记账与摘线绑在一起：只增计数不真摘，pending 就量不出漏（背景乐那边踩过）\n    this.made += 1 + (extra ? 1 : 0);|||    // 记账与摘线绑在一起：只增计数不真摘，pending 就量不出漏（背景乐那边踩过）\n    this.made += 1;|||噪声层的滤波器没记进回收账，漏了也量不出"
  "web/main.ts|||    if (names.some((n) => !seenSets.includes(n))) sfx.play('set');|||    void 0;|||P1-1 新凑成一套没有声音反馈"
  "web/main.ts|||    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, L.gain), t0 + 0.01);|||    g.gain.exponentialRampToValueAtTime(0.0002, t0 + 0.01);|||包络写死成静音值：参数全合法，一个样本都不响"
  "web/main.ts|||    src.stop(t0 + L.dur + 0.03);|||    src.stop(t0 + 0.0004);|||声源刚起就被掐掉，只剩咔一声底"
  "web/main.ts|||    const oc = new OfflineAudioContext(1, Math.ceil(sr * span), sr);|||    const oc = new OfflineAudioContext(1, 64, sr);|||离线渲染只取一样长的窗，量不到真实峰值"
  "web/main.ts|||  coach.dataset.step = card.id;|||  void 0;|||「知道了」永远只关第一条，后面的条目赖着不走"
  "web/main.ts|||  g.state.tutorial = markSeen(g.state.tutorial, id);|||  void 0;|||讲过的没记进进度，下一条永远出不来"
  "web/main.ts|||  gauges: '#gauges', shop: '#shopBody .slots', raise: '.raise',|||  gauges: '#gauges', shop: '#btnShop', raise: '.raise',|||铺子那条指回被面板盖住的顶栏按钮，气泡看不见"
  "web/main.ts|||  // 那这个开关看着就是坏的——它是唯一一处改了偏好却没人重投影的地方\n  refreshTutorial();|||  // 那这个开关看着就是坏的——它是唯一一处改了偏好却没人重投影的地方\n  void 0;|||关掉引导要等下一次别处渲染才见效（开关看着是坏的）"
  "web/styles.css|||  pointer-events: none;\n  background: linear-gradient(180deg, rgba(52, 34, 16, .96), rgba(26, 15, 7, .96));|||  pointer-events: auto;\n  background: linear-gradient(180deg, rgba(52, 34, 16, .96), rgba(26, 15, 7, .96));|||气泡拦住点击，教程反过来挡住玩家第一次操作"
  "web/main.ts|||  claimGuide();|||  void 0;|||做到的课不记进进度：牌一打出去气泡就退回上一节"
  "web/main.ts|||  body.append(foot);\n  refreshTutorial();|||  body.append(foot);|||铺子里点完请客人/抬注不重投影：那两节课做完了还挂在屏上"
  "web/main.ts|||  if (!inGuide(g.state.guide) || busy) return null;|||  if (busy) return null;|||普通局也被当成教学局：每局开局都弹第一课"
  "web/main.ts|||  if (!prefs.tutorial || busy || inGuide(g.state.guide)) return null;|||  if (!prefs.tutorial || busy) return null;|||上完课之后路过提醒又冒出来，和引导抢同一个气泡"
  "web/main.ts|||  prefs.guide = true;\n  savePrefs();\n  hideIntro();\n}|||  prefs.guide = true;\n  hideIntro();\n}|||点「我自己开一局」没落盘：下次开机又被课表拦一次（必须带收尾那行 }：startGuide 里也有同样三行，不带就会注到错的那处）"
  "web/main.ts|||refreshIntro();|||void 0;|||第一次开机不递课表：引导关根本没有入口"
  "web/main.ts|||  beginGuide(g.state);|||  void 0;|||开了一局课却没钉标记位：十节课一节都不会出现"
  "web/main.ts|||  start(GUIDE.seed, GUIDE.deckId, {\n    diff: GUIDE.diff, mode: GUIDE.mode, flags: guideFlags(prefs.flags),|||  start(GUIDE.seed, GUIDE.deckId, {|||教学局不锁难度与模式：钉住的种子讲的不是那副牌（2026-10-12 加了 nights 一行，旧锚点里的收尾两行失配，改成前两行）"
  "web/main.ts|||  coach.dataset.kind = kind;|||  void 0;|||气泡忘了自己是在上课：点「知道了」记到教程那本账上，课永远停在第一节"
  "web/main.ts|||  top = Math.max(10, Math.min(innerHeight - box.height - 10, top));|||  void 0;|||气泡只夹横不夹竖：请客人那节课被推出屏幕外"
  "web/main.ts|||  need('.ch-n', coach).textContent = card.n ?? '';|||  need('.ch-n', coach).textContent = '';|||进度那行序号不印到屏幕上，玩家不知道一共几节课"
  "web/main.ts|||      ok: l.done ? '这一步我先跳过' : '知道了',|||      ok: '知道了',|||动手的课也写「知道了」：玩家不知道要点的是跳过这一步"
  "web/main.ts|||  need('.ch-do', coach).textContent = card.todo ?? '';|||  need('.ch-do', coach).textContent = '';|||「现在做这个」那一行没印出来，课只讲了道理没讲动作"
  "web/main.ts|||  need<HTMLButtonElement>('.ch-skip', coach).textContent = kind === 'lesson' ? '退出引导' : '全部跳过';|||  need<HTMLButtonElement>('.ch-skip', coach).textContent = '全部跳过';|||上课时的退出键还是「全部跳过」：看不出退出的是整门课"
  "web/main.ts|||  center: '#board',|||  center: '#no-such-node',|||结业那节课的锚点不存在：气泡整个不出现，课发不出去"
  # ── 随机事件的选项卡 ────────────────────────────────────────
  "web/main.ts|||  refreshTutorial();\n  // 待决事件也是牌桌状态的一部分：它挂在 state 上，投影就该在这里跟着一变\n  renderEventPick();|||  refreshTutorial();|||事件递出来了但界面从不投影：玩家根本看不见那三张卡"
  "web/main.ts|||  if (!cands.length) { box.classList.add('hidden'); return; }|||  if (false) { box.classList.add('hidden'); return; }|||没有待决事件时面板也摊在屏幕上（开局就该是收着的）"
  "web/main.ts|||    need('.ev-glyph', c).innerHTML = eventGlyph(e);|||Ø|||卡面上那只画出来的记号没印：三张卡看着像同一件事"
  "web/main.ts|||    c.addEventListener('click', () => takeEvent(e.id));|||Ø|||卡点不动：三选一变成只能看不能选"
  "web/main.ts|||  const line = chooseEvent(g, id);|||  const line: string | null = null;|||点卡之后内核那边没被调用：账上记不进来，面板也不收"
  "web/main.ts|||  const line = autoResolveEvent(g);|||  const line: string | null = null;|||「让牌局自决」是假按钮"
  "web/main.ts|||  const fired = g.state.flags.events ? g.state.events : [];|||  const fired: typeof g.state.events = [];|||结算卡的「事件回顾」永远是空的（这一局到底发生过什么没人记得）"
  # ── 抽牌礼：要挑一张牌的事件先摆一排扣过来的牌 ──────────────────
  "web/main.ts|||  if (openFan(id)) { sfx.play('deal'); return; }|||  if (false) { sfx.play('deal'); return; }|||抽牌礼整个不出现：要挑一张牌的事也是闷声落账（玩家的手没接到）"
  "web/main.ts|||    n.innerHTML = '<span class=\"backart\"><svg viewBox=\"' + BACK_VIEWBOX + '\" aria-hidden=\"true\">'\n      + BACK_ART + '</svg></span>';|||    n.innerHTML = '<span class=\"backart\"></span>';|||扣过来的那一面没画出来：一排空白卡"
  "web/main.ts|||    n.dataset.card = String(c.id);|||Ø|||扇面上的每张对不上内核给的候选（判据量不到\"抽谁落谁\"）"
  "web/main.ts|||  need('#drawFan').classList.remove('hidden');|||  void 0;|||扇面摆出来了却始终看不见（看不见的一排等于没有仪式）"
  "web/main.ts|||  const line = chooseEvent(g, from, cardId);|||  const line = chooseEvent(g, from);|||抽来的那张没交给内核：落哪张还是摇出来的，抽牌是假的"
  "web/main.ts|||    setTimeout(() => { syncCard(hit.card, hit.node); }, flip);|||    void 0;|||抽的那张不翻开：玩家看不见自己抽到了什么"
  "web/main.ts|||  setTimeout(() => { closeFan(); renderAll(); setBusy(false); }, done);|||  void 0;|||翻面演完扇面不收、busy 不落下（牌局被按着头停在原地）"
  "web/main.ts|||  closeFan();          // 换局时|||  void 0;          // 换局时|||换一局上一排牌背还摊着"
  # ── 局长（3～15 夜）：标题页那一排、真正跑起来的夜数、随局长的文案 ───
  "web/main.ts|||    nights: over?.nights ?? nightsForRun(),|||    nights: over?.nights ?? DEFAULT_NIGHTS,|||标题页选的轮数没传进内核：整局还是八夜（散场卡与牌桌读数跟着一起说谎）"
  "web/main.ts|||const nightsForRun = (): number => (dailyLocked() ? DEFAULT_NIGHTS : prefs.nights);|||const nightsForRun = (): number => prefs.nights;|||每日一局跟着偏好里的轮数走，「同一天同一局」在界面上就破了"
  "web/main.ts|||      if (dailyLocked()) return;|||      void 0;|||每日一局还能改轮数：那一排的选择器锁了个寂寞"
  "web/main.ts|||      prefs.nights = l.nights;|||      void 0;|||点轮数药丸什么都不选（假按钮）"
  "web/main.ts|||  const shownNights = nightsForRun();|||  const shownNights = prefs.nights;|||每日一局高亮的是偏好里那个数，不是真会跑的数"
  "web/main.ts|||    b.textContent = String(l.nights);|||    b.textContent = l.tier;|||轮数那一排印的是档位名，看不出选的是几夜"
  "web/main.ts|||  need('#night').textContent = g.state.endless|||  need('#night').textContent = false|||无尽局也挂上分母：屏幕上凭空多出一个假终点"
  "web/main.ts|||    nights: GUIDE.nights,\n  });|||  });|||教学局跟着玩家选的夜数走：课表与 guide-check 都是按锁死的那三夜排的"
  "web/main.ts|||  const offer = decksFor(nightsForRun());|||  const offer = DECKS.slice();|||牌组那一排不随局长变：别的档的限定牌组也点得动"
  "web/main.ts|||    prefs.deck = 'standard';\n    pickedDeck = 'standard';\n    savePrefs();|||    savePrefs();|||换档之后旧选择还留着：一个点得动、进不去的假选项"
  # ── 鼠标可点：出牌 / 弃牌 / 跳过 / 幕布「继 续」 ──────────────
  "web/main.ts|||need('#btnPlay').addEventListener('click', () => { void doPlay(); });|||Ø|||「出 牌」是颗假按钮：鼠标玩家打不出牌"
  "web/main.ts|||need('#btnDiscard').addEventListener('click', () => { void doDiscard(); });|||Ø|||「弃 牌」是颗假按钮：只能靠 X 键"
  "web/main.ts|||need('#btnSkip').addEventListener('click', () => { requestSkip(); });|||Ø|||那颗「跳 过」点不动：演出中只能等或点牌桌"
  "web/main.ts|||  syncActions();\n}|||}\n|||出牌/弃牌两颗按钮的禁用态与理由根本不刷新（永远停在 HTML 里那个样）"
  "web/main.ts|||  disc.disabled = !!why || s.discardsLeft <= 0;|||  disc.disabled = !!why;|||弃牌用完了按钮还亮着：点了没反应也不解释"
  "web/main.ts|||  need<HTMLElement>('#btnSkip').hidden = !busy;|||  need<HTMLElement>('#btnSkip').hidden = false;|||不在演出时也挂着「跳 过」：一个按了什么都不会发生的按钮"
  "web/main.ts|||        const one = el('span', 'pip' + (q.flip ? ' flip' : ''));|||        const one = el('span', 'pip');|||下半部的点不再倒过来：牌面看着就不是真扑克牌"
  "web/index.html|||    <button class=\"brass-btn big curtain-ok\" id=\"btnCurtainOk\" title=\"接着往下打（空格）\">继 续</button>|||Ø|||幕布上那颗「继 续」没了：只剩整块幕布可点，看不见落点"
  "web/main.ts|||  renderTray();\n  renderReadout();\n  syncActions();|||  renderTray();\n  renderReadout();|||真点牌那条路不刷新按钮：选完牌「出 牌」还灰着（测试走 H.select 时量不出来，就是这么漏的）"
  # ── 引导关：正文读真数字 + 两个新锚点 ────────────────────────
  "web/main.ts|||      body: l.dyn ? l.dyn(f) : l.body,|||      body: l.body,|||气泡念的是背下来的定义，不是此刻屏幕上的数（第一节报不出这一场要做几分）"
  "web/main.ts|||  readout: '#readout', satchel: '#consumables',|||Ø|||两个新锚点没了：出牌那节与随身那两节永远不开窗（找不到可指的部件）"
)

blind=0
bad=0
skipped=0
total=${#INJ[@]}

# 两道前置，少一道这份报告就是假的：
# ① 显示器必须醒着。uitest 里「跳过演出/性能与泄漏」两档要等 WAAPI 自然跑完，
#    显示器睡着时 WKWebView 不合成帧，finished 永不兑现 → 那两档恒红。
# ② 未注入的基线必须先绿一次。本脚本的判据是"注入后要求变红"，
#    环境本身已经红的时候每条注入都会"被抓到"，16/16 是空判据。
#    2026-10-10 就是这么拿到过一个 FALSIFY-UI OK 的假结论。
# 显示器睡着不再直接拒绝：uitest.js 会代打时钟（?vclock=1）把动画推到落点，
# 七档现在能给结论。真正兜住空判据的是下面那条**基线必须绿**——
# 环境要是把 uitest 打成红的，基线就先挡住，注入判据不会被空跑。
if [[ "$(python3 -c "
import ctypes
h = ctypes.CDLL('/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics')
d = h.CGMainDisplayID()
print(int(h.CGDisplayIsAsleep(d)) or int(not h.CGDisplayIsActive(d)))" 2>/dev/null || echo 1)" == "1" ]]; then
  echo "提示：显示器睡着/未激活，uitest 走代打时钟；耗时类门限会被记成「未评」而不是通过。"
fi

echo "基线（未注入）应当全绿："
if [[ -n "${ONLY:-}" && -n "${SKIP_BASELINE:-}" ]]; then
  echo "  跳过基线（SKIP_BASELINE=1）：只复验指定几条，环境刚绿过。"
  echo "  ⚠ 基线要是不绿，下面每条都会「被抓到」——那是空判据，别拿它当结论。"
elif ! bash tools/uitest.sh >/tmp/falsify-ui-baseline.log 2>&1; then
  echo "FALSIFY-UI 拒绝结论：基线就没绿，"
  grep -E "^  FAIL" /tmp/falsify-ui-baseline.log | sed 's/^/  /'
  echo "  （先修界面或环境，再谈注入判据——否则下面的「被抓到」全是空判据）"
  exit 1
fi
echo "  基线全绿，继续注入"
for entry in "${INJ[@]}"; do
  why=${entry##*'|||'}
  if [[ -n "${ONLY:-}" ]]; then
    hit=0
    IFS=',' read -ra pats <<< "$ONLY"
    for pat in "${pats[@]}"; do [[ "$why" == *"$pat"* ]] && hit=1; done
    if [[ $hit -eq 0 ]]; then skipped=$((skipped + 1)); continue; fi
  fi
  python3 - "$entry" <<'PY'
import sys
parts = sys.argv[1].split('|||')
if len(parts) != 4:
    sys.exit(4)
path, frm, to, _ = parts
# 条目里的 \n 是真换行：单行模式在界面层经常不够唯一
frm = frm.replace('\\n', '\n')
to = to.replace('\\n', '\n')
if to == 'Ø':
    to = ''
s = open(path).read()
if frm not in s:
    sys.exit(3)
open(path, 'w').write(s.replace(frm, to, 1))
PY
  code=$?
  if [[ $code -ne 0 ]]; then
    # 退出码要按 python 真返回的那个数判。早先写成 `if ! python3 …` 之后再读 $?，
    # 读到的是被取反过的状态，于是"锚点失配"(3) 与"条目写坏"(4) 全印成 BAD——
    # 而这两种的修法正好相反：前者是源码改了要回去追锚点，后者是这一行本身没写对。
    if [[ $code -eq 3 ]]; then
      echo "  SKIP  模式失配（源码改了，锚点要跟着走）：$entry"
    else
      echo "  BAD   条目写坏：$entry"
    fi
    blind=$((blind + 1)); continue
  fi
  node tools/build-web.mjs --quiet >/dev/null 2>&1
  out=$(bash tools/uitest.sh 2>&1)
  if [[ $? -eq 0 ]]; then
    echo "  BLIND $why —— 界面门禁全绿"
    blind=$((blind + 1))
  else
    echo "  caught  $why → $(printf '%s' "$out" | grep -m1 -A1 'FAIL ' | tr '\n' ' ' | cut -c1-120)"
  fi
  restore
done

echo "----"
echo "注入 $total 条，盲区/坏条目 $blind 条"
if [[ -n "${ONLY:-}" ]]; then
  echo "（ONLY 过滤：跳过 $skipped 条，只跑了 $((total - skipped)) 条——这不是全量门禁）"
  if [[ $((total - skipped)) -eq 0 ]]; then
    echo "FALSIFY-UI FAIL：ONLY 一个都没匹配上，关键词拼错了吧"
    exit 1
  fi
fi
if [[ $blind -eq 0 ]]; then echo "FALSIFY-UI OK：每条界面破坏都被门禁抓到"; else echo "FALSIFY-UI FAIL"; exit 1; fi