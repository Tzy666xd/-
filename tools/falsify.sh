#!/bin/bash
# 证明自检真的会红：往内核里注入一处具体破坏，跑自检，要求它失败。
# 哪条注入之后仍然全绿，就说明那块地方根本没在被测——那比不过测更糟，因为它是假的安全感。
#
# 字段分隔用 ||| （内核里不存在这个三连），空替换写 Ø。
# 早先用单个 | 分隔，凡是模式里带 || 的条目都被切碎成错的字段：
# 注入实际上改坏了语法，自检因为"文件跑不起来"而失败，也被记成 caught——
# 那是假绿。所以现在额外要求：必须真的报出 FAIL/WEAK 才算被断言抓到。
#
# 锚点里可以写 \n 当真换行：同一行文本在文件里出现多处时（弃牌与 trimHand 的选中项
# 清理就是一字不差的两行），单行锚点永远只能打到第一处，删掉第二处也量不出。
# 命中多处时会打「锚点有多处」的提示——那不是通过，是提醒这条只覆盖到一处。
#
# 已删掉的一条：`s.chosen = s.chosen.filter(...)` 的单行删除（弃牌那条路）。
# 它在 discard() 里是**天生盲区**——同一函数末尾还有 `s.chosen = []` 把同一件事又做一遍，
# 删掉任何一处，外面看到的都是"选中项空了"。留着只会让盲区计数永远非零。
# 真需要钉的是 trimHand 那一处（请走客人后手牌超上限），上面那条多行锚点管的就是它。
#
# 两条和 falsify-ui.sh 对称的规矩（2026-10-12 补）：
# - 跑之前先量一次**未注入的基线**，红就直接收工。否则"每条注入都让自检红"是空判据：
#   环境本来就红，破坏根本没被执行也照样记账成 caught。
# - ONLY=说明里的关键词（逗号分隔）只复验那几条。盲区修完没必要 143 条全跑一遍。
#   ONLY 匹配到 0 条直接退出非零——关键词拼错不该变成"0 盲区 OK"的假绿。
set -uo pipefail
cd "$(dirname "$0")/.."

# 注入只发生在临时副本，强制终止也不会把破坏留在正式源码。
if [[ "${GUINEA_INJECTION_COPY:-0}" != "1" ]]; then
  RUN_COPY=$(mktemp -d "${TMPDIR:-/tmp}/guinea-core-injection.XXXXXX")
  trap 'rm -rf "$RUN_COPY"' EXIT
  cp -R core web tools "$RUN_COPY/" || exit 2
  GUINEA_INJECTION_COPY=1 bash "$RUN_COPY/tools/falsify.sh"
  exit $?
fi

CORE=core
BAK=$(mktemp -d)
cp -R $CORE/. "$BAK/"
[[ -f "$BAK/selftest.ts" ]] || { echo "备份失败，拒绝运行"; exit 2; }
# 只覆盖回写，不做整目录删除——避免备份出问题时把源码一起带走
cleanup() { cp -R "$BAK/." "$CORE/"; }
trap 'cleanup; rm -rf "$BAK"' EXIT

# 文件 ||| 原样 ||| 改成 ||| 这条注入本该被哪类判据抓到
INJ=(
  "game.ts|||  s.runStats.bestStage = Math.max(s.runStats.bestStage, s.score);|||  s.runStats.bestStage = 0;|||分享新牌：重做抹掉整局最高流水"
  "special-cards.ts|||chips=12*Math.min(4,seats)|||chips=12*Math.min(3,seats)|||分享新牌：会客封顶错误"
  "special-cards.ts|||Math.floor(money)|||Math.ceil(money)|||分享新牌：账票碎银也算整镑"
  "special-cards.ts|||2*(handIndex+1)|||2*handIndex|||分享新牌：余烬首手不发倍注"
  "special-cards.ts|||x.id!==c.id&&x.rank===c.rank|||x.rank===c.rank|||分享新牌：镜面对自己触发"
  "special-cards.ts|||if(held.length>=3)|||if(held.length>=2)|||分享新牌：压舱少留一张也触发"
  "special-cards.ts|||index===live.length-1|||index===0|||分享新牌：彗尾首张触发"
  "game.ts|||  s.runStats.bestHand = Math.max(s.runStats.bestHand, res.value);|||  s.runStats.bestHand = 0;|||分享新牌：最佳单手没入账"
  "game.ts|||if (op.to === 'hand') {|||if (false) {|||分享新牌：直接赠牌仍进待抽堆"
  "game.ts|||  g.record('event', \`\${def.name}：\${result}\`);|||Ø|||分享新牌：事件选择没记录"
  "save.ts|||if (!isNum(g.score) || (g.score as number) < 0) return null;|||if (!isInt(g.score, 0)) return null;|||分享新牌：小数流水合法存档被拒"
  "run-summary.ts|||bestStage:Math.max(0,s.score,s.runStats.bestStage??0,...s.ledger.map((r)=>r.best))|||bestStage:Math.max(0,...s.ledger.map((r)=>r.best))|||分享新牌：战报最高漏当前失手"
  "run-summary.ts|||r.curve.length<=45|||r.curve.length<=450|||分享新牌：恶意战报无限曲线"
  "rng.ts|||Math.imul(calls >>> 0, 0x6d2b79f5)|||Math.imul((calls + 1) >>> 0, 0x6d2b79f5)|||可靠性：恢复随机流多走一步"
  "game.ts|||const night = s.stage < 2 ? s.night : s.night + 1;|||const night = s.night;|||可靠性：跨夜抬注预告仍用旧夜数"
  "game.ts|||      if (strandingOnSeatLoss(s, index)) {|||      if (false) {|||可靠性：加注惩罚绕过随身容量保护"
  "game.ts|||      flags: mode === 'daily' ? { ...FLAGS_OFF } : { ...FLAGS_OFF, ...(o.flags ?? {}) },|||      flags: { ...FLAGS_OFF, ...(o.flags ?? {}) },|||可靠性：每日模式能夹带实验规则"
  "save.ts|||if (!isInt(o.calls, 51, Number.MAX_SAFE_INTEGER)) return null;|||if (!isInt(o.calls, 0, Number.MAX_SAFE_INTEGER)) return null;|||可靠性：随机步数早于开局仍被接收"
  "save.ts|||if (!ids.every(Number.isSafeInteger) || new Set(ids).size !== ids.length) return null;|||if (!ids.every(Number.isSafeInteger)) return null;|||可靠性：跨牌区重复ID不拒收"
  "save.ts|||    || !selected.every((id) => handIds.has(id))) return null;|||    || false) return null;|||可靠性：不存在的选中牌不拒收"
  "scoring.ts|||mult = base.mult;|||mult = base.mult + 1;|||牌型基础倍注漂了"
  "hands.ts|||if (sizes[0] === 4) return { kind: 'four'|||if (sizes[0] === 3) return { kind: 'four'|||四条识别退化成三条"
  "hands.ts|||const hi = [...cards].sort((a, b) => b.rank - a.rank)[0];|||const hi = cards[0];|||高牌不再挑最大"
  "scoring.ts|||mult += e.mult ?? 0|||mult += 0|||客人的加法倍率失效"
  "scoring.ts|||chips += e.chips ?? 0|||chips += 0|||客人的加法流水失效"
  "scoring.ts|||if (e.xmult && e.xmult !== 1) mult *= e.xmult|||if (e.xmult) mult += e.xmult|||翻倍注被改成加法"
  "scoring.ts|||chips += addChips;|||chips += addChips + 1;|||逐张筹码漂了"
  "scoring.ts|||const live: Card[] = [];|||const live: Card[] = result.scoring;|||贵客拦截被整体绕过"
  "scoring.ts|||const left = i > 0 ? roster[i - 1] : null;|||const left = roster[0];|||双生姐妹的复制对象错了"
  "scoring.ts|||if (d.span === 'hand') { if (handRoom > 0) { handRoom--; take.push(d); } }|||if (d.span === 'hand') { take.push(d); }|||P0-3 每手上界失效，一手连吃七条"
  "bets.ts|||if (ctx.reprievesUsed >= 1 || bet.failPenalty === 'none' || bet.failPenalty === 'loseRunAsIs') {|||if (bet.failPenalty === 'none' || bet.failPenalty === 'loseRunAsIs') {|||P0-1 续命不限次，可以一直赖在同一场"
  "bets.ts|||targetMult: 1.5, rewardMult: 1.5|||targetMult: 1.6, rewardMult: 1.5|||P0-1 表与硬编码 1.5^tier 漂移，老种子会改分"
  "bets.ts|||return { kind: 'loseMoney', moneyDelta: -loss, seatsDelta: 0, resetScore: true,|||return { kind: 'loseMoney', moneyDelta: loss, seatsDelta: 0, resetScore: true,|||P0-1 失手反而给钱"
  "growth.ts|||return Math.min(cap, xp + g.xpPerUse);|||return xp + g.xpPerUse;|||P1-2 XP 不封顶，后期无脑强"
  "scoring.ts|||const shared = left ? mine.filter((t) => (left.def.tags ?? []).includes(t)) : [];|||const shared = left ? mine : [];|||P0-2 邻接共鸣不看左邻的 tag，谁来都共鸣"
  "scoring.ts|||if (adj && input.adjacency) {|||if (adj) {|||P0-2 邻接开关失效，关掉照旧触发"
  "game.ts|||if (!canReorderSeat(s)) return false;|||if (!s.flags.adjacency) return false;|||P0-2 演出中也能换座，正在演的账被中途改掉"
  "game.ts|||if (s.money < SWAP_COST) return false;|||void 0;|||P0-2 换座不收钱"
  "game.ts|||s.deck.push(back);|||s.hand.push(back);|||P1-4 捞牌直接进手，绕开牌堆消耗压力"
  "game.ts|||const i = s.discardPile.findIndex((c) => c.id === id);|||const i = s.hand.findIndex((c) => c.id === id);|||P1-4 捞牌找错列表，捞回后牌数不守恒"
  "sets.ts|||blurb: '两位法律界的人到场：随身多一格', reward: { slots: 1 } },|||blurb: '两位法律界的人到场：随身多一格', reward: { mult: 3 } },|||P1-1 套装奖励直接乘倍率，越过硬约束"
  "game.ts|||if (s.flags.sets) add(setMods(s.seats.map((x) => patronById(x.pid))));|||void 0;|||P1-1 套装根本不参与限额累加"
  "scoring.ts|||addChips += layerChips(c, blueCount);|||addChips += 30;|||P1-3 层表读数被换回写死值，开/关两条路不再同分"
  "save.ts|||return r.xp === undefined || isInt(r.xp, 0, 64);|||return true;|||P1-2 座位上的 XP 不再校验，负数与天文数字都能读进来"
  "flags.ts|||if (typeof o[k] === 'boolean') out[k] = o[k];|||out[k] = Boolean(o[k]);|||flags 清洗把字符串当开，恶意 prefs 能强行打开功能"
  "draft.ts|||  if (pool.length <= OFFER_SIZE) return pool.slice();|||  if (pool.length <= OFFER_SIZE || rerolls > 0) return pool.slice(0, OFFER_SIZE);|||签名宾重掷不换人，换一批是假按钮"
  "draft.ts|||    left.splice(hit, 1);|||    void 0;|||签名宾候选允许同一个人出现两次"
  "draft.ts|||  return ensureMix(picked, pool, rand);|||  return picked;|||签名宾候选清一色同一种脾气，选路线变成假选择"
  "draft.ts|||  return PATRONS.filter((p) => !owned.includes(p.id) && RARITY_MIN_REP[p.rarity] <= rep);|||  return PATRONS.filter((p) => !owned.includes(p.id));|||签名宾无视声望门槛，传说开局就能白拿"
  "game.ts|||      const sig = PATRONS.find((x) => x.id === o.signature);|||      const sig = PATRONS.find((x) => x.id === o.signature) ?? PATRONS[0];|||签名宾认不出时凭空塞一位客人进局"
  "game.ts|||    if (s.flags.draft && o.signature) {|||    if (o.signature) {|||关掉开关签名宾照样入座，等于关不掉"
  "game.ts|||        s.seats.push(mkSeat(sig.id));|||        s.seats.push(mkSeat(sig.id)), this.rand.next();|||签名宾挤动了主随机流，老档快进会落到别的牌上"
  "save.ts|||  if (g.state.signature && !g.state.seats.some((x) => x.pid === g.state.signature)) g.state.signature = '';|||  void 0;|||档里伪造的签名宾 id 不再被认回"
  "game.ts|||s.score += res.value;|||s.score = res.value;|||每手累加退化成取最后一手"
  "game.ts|||const interest = Math.min(lim.interestCap, Math.floor(s.money / 5));|||const interest = Math.floor(s.money / 5);|||利息上限失效"
  "game.ts|||if (slot.edition !== 'negative' && seatedCount(s) >= lim.seats) return false;|||if (seatedCount(s) >= lim.seats) return false;|||座位坐满时连不占座的负片也买不到"
  "game.ts|||if (slot.edition !== 'negative' && seatedCount(s) >= lim.seats) return false;|||if (false) return false;|||座位满了还能买客"
  "game.ts|||return s.rerolls < lim.freeRerolls ? 0 : 5 + s.rerolls;|||return 0;|||重掷永远免费"
  "game.ts|||s.status = 'cleared';|||s.table = []; s.status = 'cleared';|||结清时顺手清桌会让动画中途丢牌"
  "game.ts|||s.raiseNext = 0;|||s.raiseNext = s.raiseNext;|||抬注落地后没有清零"
  "rng.ts|||return this.next() < p;|||return true;|||概率判定永远成立"
  "content.ts|||{ chips: 8, note: '侍立', onCard: c.card }|||{ chips: 9, note: '侍立', onCard: c.card }|||霍布斯效果与说明书背离"
  "content.ts|||blurb: '每张计入牌型的牌 +8 流水'|||blurb: '每张计入牌型的牌 +9 流水'|||说明书改了而代码没改"
  "content.ts|||mult: 7, note: '人头'|||mult: 9, note: '人头'|||收租人倍注漂了"
  "scoring.ts|||if (c.seal === 'blue') addChips += BLUE_SEAL_CHIPS * blueCount;|||Ø|||蓝蜡封的押账失效"
  "scoring.ts|||if (c.seal === 'gold') money += 1;|||Ø|||金蜡封不给钱"
  "scoring.ts|||const ed = editionEffect(row.seat.edition);|||const ed = null;|||客人版本完全不生效"
  "effects.ts|||if (e === 'foil') return { chips: 50, note: '箔面' };|||if (e === 'foil') return { chips: 60, note: '箔面' };|||箔面数值漂了"
  "effects.ts|||if (e === 'polychrome') return { xmult: 1.5, note: '三彩' };|||if (e === 'polychrome') return { mult: 1.5, note: '三彩' };|||三彩从乘法变成加法"
  "game.ts|||s.seats.filter((x) => x.edition !== 'negative').length|||s.seats.length|||负片开始占座位"
  "game.ts|||if (c.seal === 'purple' && s.consumables.length < lim.slots) {|||if (false) {|||紫蜡封留书失效"
  "game.ts|||if (picked.length !== l.picks) return false;|||Ø|||引荐信不再核对目标张数"
  "game.ts|||const uniqIds = [...new Set(targetIds)];|||const uniqIds = targetIds;|||同一张牌报两遍被当成两个目标"
  "game.ts|||if (totalCards(s) >= MAX_DECK) {|||if (false) {|||牌堆上界失守"
  "game.ts|||return Math.max(1, Math.floor(raw));|||return Math.max(1, Math.floor(base + (edition ? EDITION_PREMIUM[edition] : 0)));|||会员折扣不再影响价格"
  "effects.ts|||  none: 82, foil: 8, holo: 6, polychrome: 3, negative: 1,|||  none: 82, foil: 8, holo: 6, polychrome: 3, negative: 0,|||负片变成永远摇不出来"
  "content.ts|||{ id: 'cabinet', name: '信匣', blurb: '随身引荐信槽 +1', cost: 10, mods: { slots: 1 } },|||{ id: 'cabinet', name: '信匣', blurb: '随身引荐信槽 +1', cost: 10, mods: {} },|||信匣不加槽"
  "content.ts|||{ id: 'usurer', name: '高利贷', blurb: '起手 £24，但利息上限只有 £2', money: 20, interestFlat: 2 },|||{ id: 'usurer', name: '高利贷', blurb: '起手 £24，但利息上限只有 £2', money: 20 },|||高利贷的利息惩罚消失"
  "game.ts|||s.deck = g.rand.shuffle([...s.deck, ...s.discardPile.splice(0), ...s.table.splice(0), ...s.hand.splice(0)]);|||s.deck = g.rand.shuffle([...s.deck, ...s.discardPile.splice(0)]);|||换场不再回收桌面与手牌，牌会蒸发"
  "game.ts|||      offered.push(p.id);|||Ø|||同一位客人可以占两个货位"
  "game.ts|||if (totalCards(s) <= MIN_DEALABLE) { g.note('牌已经不够拆了，这张得留着'); return false; }|||Ø|||销账可以把牌拆到发不出手"
  "game.ts|||if (!s.hand.length) s.status = 'lost';|||if (false) s.status = 'lost';|||空牌桌可以把玩家卡死"
  "game.ts|||    if (boss.handSize) acc.handSize += boss.handSize;|||    if (false) acc.handSize += boss.handSize;|||窄桌的手牌惩罚没进限额表"
  "game.ts|||s.handsLeft = lim.hands;|||s.handsLeft = 4;|||吝啬鬼的出牌惩罚失效"
  "save.ts|||if (o.v !== SAVE_VERSION) return null;|||if (false) return null;|||旧版/异版存档被照单全收"
  "save.ts|||&& isInt(x.rank, 2, 14)|||&& isInt(x.rank)|||牌点数的界不再校验"
  "save.ts|||if (total < 1 || total > MAX_DECK) return null;|||if (false) return null;|||空牌堆或超过上限的存档能进来"
  "save.ts|||if (new Set((g.seats as unknown[]).map((x) => (x as { pid: string }).pid)).size !== (g.seats as unknown[]).length) return null;|||Ø|||手改存档可以塞重复客人"
  "save.ts|||    if (!isStr(r.kind) || !isNum(r.price) || (r.price as number) < 0) return false;|||    if (!isStr(r.kind)) return false;|||货位价格不查类型与界"
  "save.ts|||      if (!isStr(r.pid) || !PID_SET.has(r.pid)) return false;|||      if (false) return false;|||货位里不存在的客人进得来"
  "save.ts|||    if (typeof r.sold !== 'boolean') return false;|||    if (false) return false;|||货位不再核对 sold 类型"
  "save.ts|||    return isInt(r.night, 1) && isStr(r.stage) && KIND_NAME_SET.has(r.stage)|||    return isInt(r.night, 1) && isInt(r.stage, 0, 2)|||账本 stage 按数字校验，打过一场的合法档被整份拒收"
  "save.ts|||      && isStr(r.label) && isNum(r.target) && isNum(r.money)|||      && isNum(r.target) && isNum(r.money)|||账本行的阶段名不再核对白名单"
  "game.ts|||  add(diffById(s.diff).mods);|||Ø|||难度那一层根本没叠进限额表"
  "game.ts|||    money: 6,|||    money: 0,|||手松档的起手银钱没给"
  "game.ts|||    mods: { hands: 1, discards: 1, interestCap: 2, targetScale: .72, priceScale: .85 },|||    mods: { hands: 1, discards: 1, interestCap: 2, priceScale: .85 },|||手松档的彩头没变薄"
  "game.ts|||  acc.interestCap = Math.max(0, acc.interestCap);|||Ø|||苛刻+高利贷把利息上限压成负数"
  "game.ts|||    const mode: Mode = modeById(o.mode ?? (o.endless ? 'endless' : 'run')).id;|||    const mode: Mode = o.mode ?? 'run';|||endless 参数不再折算成模式"
  "game.ts|||      endless: mode !== 'daily' && (mode === 'endless' || !!o.endless), diff, mode, log: [],|||      endless: false, diff, mode, log: [],|||无尽模式开局就被标成正局"
  "game.ts|||  return ((y * 10000 + m * 100 + day) % 999983) + 17;|||  return 17;|||每日一局的种子不再随日期变"
  "game.ts|||  if (s.mode !== 'practice') return false;|||  return true;|||非修行档也被无限续命"
  "game.ts|||s.claimed = s.claimed.filter((id) => THRESHOLDS.find((d) => d.id === id)?.carryOver === true);|||s.claimed = [];|||P0-3 carryOver=true 的换场没保留"
  "game.ts|||s.claimed = s.claimed.filter((id) => THRESHOLDS.find((d) => d.id === id)?.carryOver === true);|||s.claimed = s.claimed.slice();|||P0-3 carryOver=false 的换场没清零，白送第二次奖励"
  "scoring.ts|||if (d.span === 'hand') { if (handRoom > 0) { handRoom--; take.push(d); } }|||if (d.span === 'hand') { if (false) { take.push(d); } }|||P0-3 hand 阈值一条都不发"
  "game.ts|||const reward = Math.round(STAGE_REWARD[kind] * (s.flags.bets ? bet.rewardMult : 1 + 0.5 * s.raisedHere));|||const reward = Math.round(STAGE_REWARD[kind]);|||抬注不再换赏金"
  "game.ts|||const profit = Math.min(12, Math.round((surplus / Math.max(1, target)) * 6)|||const profit = Math.max(12, Math.round((surplus / Math.max(1, target)) * 6)|||盈余折现上限失效"
  "game.ts|||+ (s.flags.bets ? bet.surplusBonus : s.raisedHere));|||+ 0);|||盈余折现整个废掉"
  "game.ts|||s.rep += (s.flags.bets ? bet.repBonus : s.raisedHere) + (kind === 'boss' ? 1 : 0);|||s.rep += (kind === 'boss' ? 1 : 0);|||声望不再增长"
  "scoring.ts|||const times = L ? layerRepeat(c) : 1 + (c.seal === 'red' ? 1 : 0);|||const times = 1;|||红蜡封不再重诵"
  "game.ts|||if (reprieve(g)) return res;|||if (false) return res;|||修行档牌权用尽不再补满"
  "game.ts|||s.buffer -= 1;|||s.buffer -= 0;|||缓冲回合不递减，失手可以无限赖场"
  "portrait.ts|||  const tone = p ? p.tone : 0;|||  const tone = 0;|||肖像底色不再分人，24 位冷青共用一块背景"
  "portrait.ts|||  moustache: '<path d=\"M40.5 26.5q7.5 5.5 15 0-4 4.5-7.5 4.5t-7.5-4.5z\" fill=\"CUT\"/>',|||  moustache: '<path d=\"M40.5 26.5q7.5 5.5 15 0-4 4.5-7.5 4.5t-7.5-4.5z\" fill=\"currentColor\"/>',|||脸谱记号改用浅色＝奶油上画奶油，那层白画"
  "portrait.ts|||  watchman:  { hat: 'nightcap',hair: 'short',  head: 'round',  face: 'moustache', collar: 'military', prop: 'bell',    tone: 16 },|||  watchman:  { hat: 'nightcap',hair: 'bald',   head: 'square', face: 'wink',      collar: 'ruff',     prop: 'coin',    tone: -8 },|||同脾气里两件完全一样的组合没人管"
  "portrait.ts|||  waxman:    { hat: 'mobcap',  hair: 'short',  head: 'tilt',   face: 'pipe',      collar: 'bow',      prop: 'seal',    tone: 11 },|||  waxman:    { hat: 'mobcap',  hair: 'short',  head: 'tilt',   face: 'pipes',     collar: 'bow',      prop: 'seal',    tone: 11 },|||零件名拼错，那位客人少画一层脸"
  "portrait.ts|||  pairkeeper: 'PK', general: 'J',|||  pairkeeper: 'B', general: 'J',|||刻印撞车（两个人共用一个字母）"
  "portrait.ts|||  if (!p) return '';|||  if (!p) return '<svg viewBox=\"0 0 96 44\"></svg>';|||认不出的 id 不再画空，留一个空框上屏"
  "portrait.ts|||art.replaceAll('CUT', pal.cut)|||art|||暗色刻线没被替换，SVG 里带着字面量 CUT 上屏"
  "portrait.ts|||  coin: '<circle cx=\"72\" cy=\"28.5\" r=\"7.6\" fill=\"currentColor\"/>|||  coin: '<circle cx=\"72\" cy=\"28.5\" r=\"7.6\" fill=\"none\"/>|||手中物不再用浅色，暗地上看不见"
  "portrait.ts|||  const xform = HEAD_XFORM[p.head];|||  const xform = '';|||头形杠杆整体失效，七种头形画成同一个人"

  "music.ts|||      if (heat >= 2) out.push({ midi: midi + 12, at, dur: sd * len * .7, gain: .035, voice: 'mel' });|||Ø|||局势顶满时不抬旋律，"变紧"是假的"
  "music.ts|||    if (heat >= 1 && pos % 2 === 1) {|||    if (false) {|||heat 1 的分解和弦根本不响"
  "music.ts|||      const third = [0, 2, 4][step % 3];|||      const third = [0, 1, 2][step % 3];|||arp 不再落在和弦音上，听着就是弹错"
  "music.ts|||    if (p && DRUM[p] !== undefined) {|||    if (p) {|||写错的鼓点字母也照样响"
  "music.ts|||gain: p === 'h' ? .02 : .05, voice: 'perc'|||gain: .3, voice: 'perc'|||鼓点增益失控，一脚踩爆音"
  "music.ts|||  const melOct = Math.floor(from / total) % 4 === 3 ? 1 : 0;|||  const melOct = 0;|||第四圈不再抬八度，八小节死循环不换气"
  "music.ts|||    scene: '开局', bpm: 100, beats: 3, tonic: 67, scale: MAJOR, timbre: 'harp',|||    scene: '开局', bpm: 100, beats: 3, tonic: 67, scale: MAJOR, timbre: 'box',|||八首曲子塌成三种音色"
  "music.ts|||    mel: ['4..3..2..3..', '5..4..33....', '2..3..4..5..', '4..3..2..1..'],|||    mel: ['4..3..2..3.', '5..4..33....', '2..3..4..5..', '4..3..2..1..'],|||谱面少一个八分音符，那一小节会漏半拍"

  "game.ts|||  trimHand(g);\n\n  return true;|||  return true;|||请走加手的客人后，手牌还留在旧上限之上（必须是多行锚点：2026-10-12 加了事件之后 resolveEvent 里也有一次 trimHand(g)，而且排在更前面，单行锚点会被它抢走）"
  "game.ts|||  const over = s.hand.length - limits(s).handSize;|||  const over = 0;|||trimHand 变成空转，超的手牌没人管"
  "game.ts|||  s.discardPile.push(...cut);\n  s.chosen = s.chosen.filter((id) => s.hand.some((c) => c.id === id));|||  s.discardPile.push(...cut);|||请走客人后被搁进弃牌堆的那张还留在选中项里（trimHand 那一处，和弃牌里那行长得一模一样，只能靠多行锚点区分）"
  "game.ts|||  s.handsLeft = after.hands;|||  s.handsLeft = lim.hands;|||失手请客之后仍按旧上限补出牌次数"
  "game.ts|||  const [back] = s.discardPile.splice(i, 1);|||  const back = s.discardPile[s.discardPile.length - 1];|||捞牌没从弃堆摘除，同一张牌出现在两堆里"
  "sound.ts|||      { k: 'noise', f: 5200, dur: 0.045, gain: 0.035, q: 0.8, at: 0.012, filter: 'highpass', noLift: true },|||      { k: 'noise', f: 5200, dur: 0.045, gain: 0.035, q: 0.8, at: 0.012, filter: 'highpass' },|||纸面摩擦跟着连击往上尖，抬到第 9 档就出了可听范围"
  "sound.ts|||  const lift = (r.lift ?? 0) * Math.min(step, r.liftMax ?? 0);|||  const lift = (r.lift ?? 0) * step;|||连击抬升没有上限，一路尖到刺耳"
  "sound.ts|||  if (xmult && xmult !== 1) return 'xmult';|||  if (xmult && xmult !== 1) return 'chips';|||翻倍注响成流水，最该有重音的地方最没重音"
  "sound.ts|||  const TABLE = [0, 1, 0, 2, 1, 0, 2, 1];|||  const TABLE = [1, 1, 1, 1, 1, 1, 1, 1];|||壁炉噼啪全是一个大小，听着像节拍器不像火"
  "sound.ts|||    name: '牌落桌', lift: 1.4, liftMax: 9, tint: [0.86, 1.12, 1.0, 0.94],|||    name: '牌落桌', lift: 1.4, liftMax: 9, tint: [1, 1, 1, 1],|||四种花色落桌声一模一样"
  "sound.ts|||  hand: 'total', blocked: 'blocked', bonus: 'bonus', shatter: 'shatter', total: 'total',|||  hand: 'total', blocked: 'blocked', bonus: 'chips', shatter: 'blocked', total: 'total',|||阈值与玻璃退回通用音，事件种类听不出来了"
  "sound.ts|||    if (t >= s - 1e-9 && t < s + L.dur) sum += L.gain;|||    if (false) sum += L.gain;|||峰值增益恒为 0，爆音判据空转"
  "tutorial.ts|||  if (s.done === 'played') return f.played >= 1;|||  if (s.done === 'played') return false;|||做到动作也不走，引导赖在屏幕上"
  "tutorial.ts|||  return [...new Set([...seen, ...add].filter((x) => STEP_IDS.has(x)))];|||  return [...seen, ...add];|||记进度不去重不清洗，脏 id 一路攒进存档"
  "tutorial.ts|||  const add = id === null ? STEPS.map((x) => x.id) : [id];|||  const add = id === null ? [] : [id];|||「全部跳过」只是把这一条藏起来，下一夜又冒出来"
  "tutorial.ts|||    case 'inShop': return f.inShop;|||    case 'inShop': return false;|||铺子里那两条永远不出现，走完只剩五条"
  "save.ts|||  g.state.tutorial = [...new Set((g.state.tutorial ?? []).filter((id) => STEP_IDS.has(id)))];|||  void 0;|||档里伪造的步骤 id 不再被认回"
  "game.ts|||      claimed: [], betReprieves: 0, buffer: START_BUFFER, signature: '', tutorial: [],|||      claimed: [], betReprieves: 0, buffer: START_BUFFER, signature: '', tutorial: ['goal', 'goal'],|||开局就带着脏的引导进度"
  "guide.ts|||if (seen.includes(l.id) || !l.open(f) || satisfied(l, f)) continue;|||if (seen.includes(l.id)) continue;|||课程不看局面也不看做到没有，第一节课永远挂在屏上"
  "guide.ts|||const firstStage = (f: Facts): boolean => f.started && f.cleared === 0 && !f.inShop;|||const firstStage = (): boolean => true;|||牌桌边那几节课在没开局时、在铺子里也照讲"
  "guide.ts|||done: (f) => f.seats >= 1,|||done: () => true,|||请客人那节课没做到也自动算过"
  "guide.ts|||done: (f) => f.cleared >= 1,|||done: () => false,|||一把打穿时那节「一场要打好几手」不肯翻页"
  "guide.ts|||done: (f) => f.discards >= 1,|||done: (f) => f.discards >= 99,|||弃一次牌不算过，弃牌课永远讲不完"
  "guide.ts|||const kept = [...new Set([...seen, ...add])].filter((x) => x === MARKER || LESSON_IDS.has(x));|||const kept = [...new Set([...seen, ...add])].filter((x) => LESSON_IDS.has(x));|||标记位被 markLesson 挤掉：这局不再认自己是教学局"
  "guide.ts|||const add = id === null ? LESSONS.map((x) => x.id) : [id];|||const add = id === null ? [LESSONS[0].id] : [id];|||退出引导只记第一节课，后面八节还会回来"
  "guide.ts|||export const beginGuide = (s: GameState): void => { s.guide = [MARKER]; };|||export const beginGuide = (s: GameState): void => { void s; };|||开一局课没钉标记位：整门课根本不出现"
  "guide.ts|||export const quitGuide = (s: GameState): void => { s.guide = markLesson(s.guide, null); };|||export const quitGuide = (s: GameState): void => { s.guide = []; };|||退出引导把标记位一起清了，存档再也认不出这是上过课的局"
  "guide.ts|||    discards: s.discardsUsed,|||    discards: s.discardsLeft,|||弃过几次牌被读成还剩几次：课程判据拿反了账"
  "guide.ts|||  seed: 20261011, deckId: 'standard', diff: 'gentle' as Diff, mode: 'run' as Mode,|||  seed: 20261011, deckId: 'standard', diff: 'standard' as Diff, mode: 'run' as Mode,|||教学局没锁手松档：彩头线抬高，第一课就讲不完（2026-10-12 GUIDE 换成多行对象，锚点跟着换）"
  "guide.ts|||  nights: MIN_NIGHTS,|||  nights: 15,|||教学局被改成长夜：课还没上完就先在长夜里输掉（十节课最迟在第 2 夜翻完）"
  "guide.ts|||export const position = (id: string | null): number => {|||export const position = (id: string | null): number => { if (id === null) return 1;|||没有课要讲时进度条谎报第 1 课"
  # ── 引导关扩到十四节：新课的窗口与"做到才算过" ──────────────
  "guide.ts|||    open: (f) => f.inShop && f.shopItemPrice > 0 && f.consumables < f.slots\n      && f.money >= f.shopItemPrice,|||    open: (f) => f.inShop && f.shopItemPrice > 0 && f.consumables < f.slots,|||买不起那件小东西时也硬讲这一节（讲完玩家点不动，课卡死）"
  "guide.ts|||    open: (f) => f.inShop && f.shopItemPrice > 0 && f.consumables < f.slots\n      && f.money >= f.shopItemPrice,|||    open: (f) => f.inShop,|||随身那节课在铺子里任何时候都开：抢在请客人之前开口"
  "guide.ts|||    done: (f) => f.consumables >= 1,|||    done: () => true,|||「买一件应急的」没做到也算过：动手课变成空话"
  "guide.ts|||    open: (f) => f.started && !f.inShop && f.stage === 2,|||    open: (f) => f.started && !f.inShop,|||头人那节课在便宴就开口（那时根本没有贵客局可讲）"
  "guide.ts|||    open: (f) => f.cleared >= 2 && f.seats >= 1 && !f.inShop,|||    open: (f) => f.cleared >= 1 && f.seats >= 1 && !f.inShop,|||结业与账本抢在贵客局之前发（玩家还不知道第三场会来什么人）"
  "guide.ts|||    open: (f) => f.cleared >= 2 && f.seats >= 1 && !f.inShop,|||    open: (f) => f.cleared >= 2,|||账本那节在铺子里也开口：锚点根本不在屏幕上（账本与结业两行一字不差，这条只改到第一处，第二处见下面那条多行锚点）"
  "guide.ts|||    // 那等于在玩家还不知道第三场会来什么人时就说「剩下的自己打」\n    open: (f) => f.cleared >= 2 && f.seats >= 1 && !f.inShop,|||    // 那等于在玩家还不知道第三场会来什么人时就说「剩下的自己打」\n    open: (f) => f.cleared >= 2 && !f.inShop,|||结业那节不看客人请没请到位：一位客人都没请就宣布「课上完了」"
  # ── 牌面美术：点位表与花色图形 ──────────────────────────────
  "pips.ts|||  9: [[.27, .14], [.73, .14], [.27, .38], [.73, .38], [.5, .5], [.27, .62], [.73, .62],|||  9: [[.27, .14], [.73, .14], [.27, .38], [.73, .38], [.27, .62], [.73, .62],|||九号牌少画一个点：牌面数字与点位对不上"
  "pips.ts|||  8: [[.27, .17], [.73, .17], [.5, .335],|||  8: [[.27, .17], [.73, .17], [.5, .29],|||点位不再关于中心对称：下半部不再是上半部的倒影"
  "pips.ts|||  2: [[.5, .17], [.5, .83]],|||  2: [[.5, .17], [.5, 1.05]],|||点位跑到牌面外（窄屏那档会直接溢出边框）"
  "pips.ts|||({ x, y, flip: y > 0.5 })|||({ x, y, flip: y >= 0.5 })|||正中央那颗也被倒过来（真牌只有下半部倒）"
  "pips.ts|||export const isPipCard = (rank: number): boolean => rank >= 2 && rank <= 10;|||export const isPipCard = (rank: number): boolean => rank >= 2 && rank <= 11;|||J 也被当成数字牌铺点位：人头牌的小像没了"
  "pips.ts|||  c: '<circle cx=\"10\" cy=\"5.6\" r=\"3.5\" /><circle cx=\"5.2\" cy=\"11.2\" r=\"3.5\" />|||  c: '<circle cx=\"10\" cy=\"5.6\" r=\"3.5\" />|||梅花掉一瓣：三瓣变两瓣，整张梅花牌变形"
  "pips.ts|||  Q: '<circle cx=\"20\" cy=\"13\" r=\"5.4\" />|||  Q: '<path d=\"M6 26 6 12 13 18 20 8 27 18 34 12 34 26z\" />|||Q 的主形被换成 K 的王冠：人头牌分不开"
  "game.ts|||      claimed: [], betReprieves: 0, buffer: START_BUFFER, signature: '', tutorial: [], guide: [],|||      claimed: [], betReprieves: 0, buffer: START_BUFFER, signature: '', tutorial: [], guide: ['on'],|||每局开局都被当成教学局"
  "save.ts|||  'flags', 'claimed', 'betReprieves', 'buffer', 'signature', 'tutorial', 'guide',|||  'flags', 'claimed', 'betReprieves', 'buffer', 'signature', 'tutorial',|||引导关进度不在存档白名单里：读档就丢"
  "save.ts|||  g.state.guide = [...new Set((g.state.guide ?? []).filter((id) => id === MARKER || LESSON_IDS.has(id)))];|||  g.state.guide = [...new Set(g.state.guide ?? [])];|||档里不认识的课 id 被原样收下，下一次读档拿它当进度"
  "save.ts|||  if (g.guide !== undefined) {|||  if (false) {|||guide 写成字符串也照样接收，读回来那句 join 当场炸"
  # ── 随机事件（第 9 个开关）─────────────────────────────────
  "game.ts|||  if (s.table.length) s.discardPile.push(...s.table.splice(0));|||Ø|||上一手打过的牌被这一手的 s.table 顶掉，一场四手要蒸发十几张（牌堆守恒那条）"
  "scoring.ts|||  for (const ev of input.events ?? []) {|||  for (const ev of []) {|||事件挂着的加项根本没进计分管道，+50 流水那条判据要红"
  "game.ts|||  if (s.pendingEvent.length) return null;|||  if (false) return null;|||待决的三选一被绕过去：没选也能继续出牌"
  "game.ts|||  if (s.events.some((e) => e.night === s.night)) return;|||  if (false) return;|||同一夜反复递事，弹窗轰炸（每夜至多一次那条）"
  "game.ts|||      add(m.rule);|||Ø|||事件改的规矩没叠进限额表：手牌上限 +1 那条判据要红（锚点换过：加到期判据之后原来那行单行写法已经不在源码里了）"
  "game.ts|||    s.money = Math.max(0, s.money + op.n);|||    s.money += op.n;|||事件能把银钱扣成负数（钱不会是负的那条夹零判据）"
  "game.ts|||  if (strandingOnSeatLoss(s, index)) {|||  if (false) {|||卖掉撑着随身格的那位客人：套装散掉之后信比格子多"
  "game.ts|||      const safe = s.seats.map((x, i) => i).filter((i) => !strandingOnSeatLoss(s, i));|||      const safe = s.seats.map((x, i) => i);|||事件请走客人时不看随身格，同一条守卫在事件这条路上失效"
  "game.ts|||      if (totalCards(s) <= MIN_DEALABLE) break;|||      if (false) break;|||带走牌可以把整副牌拆到发不出手（与销账同一道下界那条）"
  "game.ts|||      if (totalCards(s) >= MAX_DECK) { out.push('牌堆已满，加不下了'); return; }|||      if (false) { out.push('牌堆已满，加不下了'); return; }|||往牌堆塞牌可以无限堆（牌堆上界那条）"
  "game.ts|||  if (!s.flags.events) return;|||  if (false) return;|||关掉开关还在递事件：五个新字段被碰，等于功能关不掉"
  "game.ts|||    s.eventMods = s.eventMods.filter((m) =>\n      m.scope === 'run' || (m.scope === 'night' && m.night === s.night));|||    s.eventMods = s.eventMods.filter(() => true);|||到期判定没了：本夜/下一手的修正会一路挂着（单行锚点不够唯一，这里用多行）"
  "game.ts|||    if (!m.eff) continue;\n    if (m.scope === 'hand' && (m.hands ?? 0) <= 0) continue;|||    if (!m.eff) continue;|||'下一手'那一格过完一手还在加分（到期后不该再进管道。锚点必须带上一行：limits() 里那条到期判断把它当子串包含）"
  "game.ts|||    const take = s.discardPile.splice(0, Math.min(op.n, s.discardPile.length));|||    const take = s.discardPile.splice(0, 0);|||弃牌堆收回牌堆变成假操作（数量守恒那条）"
  "events.ts|||export const eventAtFor = (r: Rand): number => 2 + r.int(2);|||export const eventAtFor = (r: Rand): number => 1 + r.int(1);|||触发点恒等于 1：开局第一手就弹，'摇在 2 或 3'那条判据要红"
  "guide.ts|||export const guideFlags = (f: FeatureFlags): FeatureFlags => ({ ...f, events: false });|||export const guideFlags = (f: FeatureFlags): FeatureFlags => ({ ...f });|||教学局没关掉随机事件：十节课那局会被别的事打断"
  "save.ts|||    if (!isStr(r.from) || !isStr(r.scope) || !SCOPE_SET.has(r.scope) || !isInt(r.night, 1)) return false;|||    if (!isStr(r.from) || !isStr(r.scope) || !isInt(r.night, 1)) return false;|||作用域写成别的词也照收（'只认下一手/本夜/整局'那条）"
  "save.ts|||      if (!Object.values(m as Record<string, unknown>).every(isNum)) return false;|||      if (false) return false;|||修正表里混进字符串也放过：limits 的累加会变成字符串拼接"
  # ── 逻辑 bug 探针照出来的那六处修复，每处一根钉子 ─────────────
  "scoring.ts|||    if (chips < 0) chips = 0;|||Ø|||事件把流水压成负数没人夹：一手牌做负分，累计流水倒退"
  "scoring.ts|||    if (mult < 1) mult = 1;|||Ø|||事件把倍注压到 1 以下：倍注变 0 甚至负数"
  "game.ts|||        at = drawnAt(pick, pool);\n        if (at < 0) at = rolled;|||        at = 0;|||「随机带走一张牌」其实按列表顺序拿最前面几张（也不消耗随机流）——2026-10-13 抽牌礼把这一段改成了 rolled/at 两行，锚点跟着走"
  "game.ts|||      if (m.scope === 'hand' && (m.hands ?? 0) <= 0) continue;|||Ø|||'下一手'那类改规矩到期之后还在改限额（只有 setupStage 那道过滤的话，跨场之间它一直生效）"
  "game.ts|||      if (!fresh.length) { out.push('该落的花样已经都在了，没再动牌'); return; }|||      if (false) { out.push('该落的花样已经都在了，没再动牌'); return; }|||落花样落在本来就有该花样的牌上，账上照报一次"改过了"（谎报）"
  "game.ts|||  return \`\${SUIT_NAME[c.suit]}\${RANK_LABEL(c.rank)}\${mark ? \`（\${mark}）\` : ''}\`;|||  return \`\${SUIT_NAME[c.suit]}\${String(c.rank)}\${mark ? \`（\${mark}）\` : ''}\`;|||牌名把 RANK_LABEL 当表取（A/K/Q/J 全印成数字），事件账上写「黑桃undefined」"
  "game.ts|||  s.chosen = s.chosen.filter((id) => s.hand.some((c) => c.id === id));\n  // 事件可能把上限压低了（招灵会那种）：多出来的按既有规矩搁进弃牌堆，而不是硬留在手上|||  // 事件可能把上限压低了（招灵会那种）：多出来的按既有规矩搁进弃牌堆，而不是硬留在手上|||事件换过手牌之后选中项里留着不在手里的 id（那张牌重回手里就莫名其妙是选中态）"
  # ── 第二轮探针（存档边界与状态守卫）─────────────────────────
  "game.ts|||  if (!s.flags.events || s.status !== 'playing') return null;\n  const at = s.pendingEvent.indexOf(id);|||  const at = s.pendingEvent.indexOf(id);|||关着功能、或者不在出牌状态时照样能应事件（手改的存档能让面板弹在一局没有这个功能的牌局上）"
  "game.ts|||  if (!s.flags.events || s.status !== 'playing') return null;\n  const hit = autoPick(eventChoices(g));|||  const hit = autoPick(eventChoices(g));|||「让牌局自决」不看状态与开关"
  "game.ts|||  if (!eventById(id)) { s.pendingEvent.splice(at, 1); return null; }|||  if (false) { s.pendingEvent.splice(at, 1); return null; }|||认不出的候选 id 不摘掉：它会一直堵着出牌与弃牌（死局）"
  "game.ts|||  if (!hit) { s.pendingEvent = []; return null; }|||  if (!hit) { return null; }|||自决遇到全是假 id 的候选时不清待决，牌局就此锁死"
  "game.ts|||  const seat = s.seats.splice(index, 1)[0];\n  syncSignature(s);|||  const seat = s.seats.splice(index, 1)[0];|||离席后签名宾标记残留（卖出、事件与惩罚共用）"
  "save.ts|||  if (!g.state.flags.events) {\n    g.state.eventAt = 0;|||  if (false) {\n    g.state.eventAt = 0;|||关着开关的存档照样带着事件的账读进来（五格没清零）"
  # ── 局长（3～15 夜）：曲线、判胜、候选偏置、存档边界 ───────────
  "lengths.ts|||  const n = Math.min(Math.max(night, 1), nights);|||  const n = night;|||无尽推到最后一夜之后，长档的曲线外推成负数彩头"
  "lengths.ts|||  return 1 + (end - 1) * (n - 1) / (nights - 1);|||  return end;|||整条曲线一起缩放：第一夜不再是人人相同的 300"
  "lengths.ts|||  return l.finalTarget / (referenceTarget(l.nights) * BOSS_STAGE_SCALE);|||  return l.finalTarget / referenceTarget(l.nights);|||终点系数漏乘贵客局倍率：最后一夜要做到设计值的两倍"
  "lengths.ts|||    ? v : DEFAULT_NIGHTS;|||    ? v : MIN_NIGHTS;|||认不出的局长落回三夜而不是八夜（旧档与偏好会被悄悄改长度）"
  "lengths.ts|||  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_NIGHTS && v <= MAX_NIGHTS|||  return typeof v === 'number' && v >= MIN_NIGHTS && v <= MAX_NIGHTS|||3.5 夜这种非整数局长被当成合法值"
  "game.ts|||    const nights = mode === 'daily' ? DEFAULT_NIGHTS : clampNights(o.nights ?? DEFAULT_NIGHTS);|||    const nights = clampNights(o.nights ?? DEFAULT_NIGHTS);|||每日一局被人选的局长搅了，「同一天同一局」就不成立（构造口换成 nights/want 两行之后锚点跟着走）"
  "game.ts|||    if (s.night >= s.nights && !s.endless) { s.status = 'won'; return; }|||    if (s.night >= FINAL_NIGHT && !s.endless) { s.status = 'won'; return; }|||判胜还写死八夜：三夜档赢不了，十五夜档提前散场"
  "game.ts|||  add({ targetScale: nightScale(s.nights, s.night) });|||  void 0;|||局长曲线根本没进限额表（选几夜都是一个难度）"
  "save.ts|||      nights: s.nights,|||Ø|||局长存不出去：读档回到八夜"
  "save.ts|||  if (g.nights !== undefined && (!isInt(g.nights, 3, 15) || g.nights !== clampNights(g.nights))) return null;|||  if (false) return null;|||存档里写坏的局长被照单全收"
  "save.ts|||  'eventAt', 'nightActions', 'pendingEvent', 'events', 'eventMods', 'nights',|||  'eventAt', 'nightActions', 'pendingEvent', 'events', 'eventMods',|||nights 不在读档白名单里：这一格读回来就被丢掉"
  "draft.ts|||  if (nights >= 6 && nights <= 9) return 1;|||  if (false) return 1;|||参照档（六到九夜）的开局候选被局长偏置搅动，老种子不再是老局面"
  "draft.ts|||  const t = nights <= 5 ? SHORT : LONG;|||  const t = nights <= 5 ? LONG : SHORT;|||局长偏置方向反了：短局塞满长进型，长局只给一手到位"
  "draft.ts|||  const w = (p: PatronDef): number => RARITY_WEIGHT[p.rarity] * lengthWeight(p, nights);|||  const w = (p: PatronDef): number => RARITY_WEIGHT[p.rarity];|||局长对候选的偏置整个不生效（这个参数是死码）"
  # ── 局长奖励：五档专属起手牌组 ───────────────────────────────
  "content.ts|||  return DECKS.filter((d) => !d.tier || d.tier === t);|||  return DECKS.slice();|||别的档的专属牌组也摆进这一档（限定成了空话）"
  "content.ts|||  return !!d && (!d.tier || d.tier === tierOf(nights));|||  return !!d;|||牌组与局长的配档校验整个不做"
  "game.ts|||    const want = mode === 'daily' ? 'standard' : deckId;|||    const want = deckId;|||每日一局没锁牌组，连限定牌组也能夹带进局"
  "game.ts|||    const dk = deckLegal(want, nights) ? deckById(want) : deckById('standard');|||    const dk = deckById(want);|||错配的牌组被直接带进局（界面上选不到它）"
  "save.ts|||  if (!deckLegal(g.deckId, clampNights(g.nights))) return null;|||  if (false) return null;|||改一格 nights 就能把别档的专属牌组夹带进档"
  "lengths.ts|||  { nights: 4, tierId: 'short',|||  { nights: 4, tierId: 'mid',|||某一夜的档位归属被改：中文档名与 tierId 断链，专属牌组跟着错一档"
  "content.ts|||    blurb: '三到四夜限定：每场多一次出牌、起手多 £4，但少一次弃牌——短局没有慢慢换牌的余裕',\n    mods: { hands: 1, discards: -1 } },|||    blurb: '三到四夜限定：每场多一次出牌、起手多 £4，但少一次弃牌——短局没有慢慢换牌的余裕', },|||专属牌组的规矩只写在文案里，限额表根本没收到"
  # ── 抽牌礼：随机挑牌那几类由玩家抽一张 ─────────────────────────
  # 三个挑牌位（誊抄 / 落花样 / 带走牌）各两条：一条问"认不认抽来的那张"，一条问"有没有照旧摇那一位"。
  # 锚点只取行首一段（不带行尾注释），三处靠缩进与变量名分开，唯一命中。
  "game.ts|||      const at = drawnAt(pick, pool);|||      const at = -1;|||誊抄那一处不认玩家抽来的那张（抽中谁都白抽）"
  "game.ts|||      const at = drawnAt(pick, fresh);|||      const at = -1;|||落花样那一处不认玩家抽来的那张"
  "game.ts|||        at = drawnAt(pick, pool);|||        at = -1;|||带走牌那一处不认玩家抽来的那张"
  "game.ts|||      const rolled = g.rand.int(pool.length);        //|||      const rolled = 0;        //|||誊抄那一处不摇位（抽与不抽之后的牌序分叉）：行尾注释把这一处与带走牌那一处分开"
  "game.ts|||      const rolled = g.rand.int(fresh.length);|||      const rolled = 0;|||落花样那一处不摇位（省一次骰子，后面的发牌与铺子整体错位）"
  "game.ts|||        const rolled = g.rand.int(pool.length);\n        at = drawnAt(pick, pool);|||        const rolled = 0;\n        at = drawnAt(pick, pool);|||带走牌那一处不摇位：随机退化成按列表顺序拿"
  "game.ts|||  if (i < 0) return -1;|||  if (i < 0) return 0;|||外面塞进来的牌 id 被当成抽中的那张（落错牌）"
  "game.ts|||  pick.spent = true;|||Ø|||抽来的那张管了每一处：一次事件两处都由它定（界面那句「其余仍由牌局摇」成了空话）"
  "game.ts|||  if (!s.flags.events || s.status !== 'playing') return null;\n  const def = eventById(id);|||  const def = eventById(id);|||功能关着、或者不在出牌中也摆扇面"
  "game.ts|||  if (!def || !s.pendingEvent.includes(id)) return null;\n  // 只走顶层 op|||  if (!def) return null;\n  // 只走顶层 op|||id 不在候选里也摆扇面（存档能给任意一条事件凑一排牌）：下一行注释把它与 resolveEvent 那处分开"
  "game.ts|||  while (out.length < FAN_SIZE && left.length)|||  while (left.length)|||扇面不限量：牌堆级的候选池摊出五十张牌"
  "game.ts|||out.push(left.splice(r.int(left.length), 1)[0])|||out.push(left.shift()!)|||扇面就是候选池头几张（「打乱」是假的）"
  "game.ts|||  const r = deriveFanRand(s.seed, s.night, eventId);|||  const r = new Rand((performance.now() * 1000) >>> 0);|||扇面每次重摇：取消再点回来换了一排，玩家刚记住的位置作废（派生流的用处就在这）"
  "pips.ts|||  + '<path d=\"M10 1.8C10 1.8 2.6 7.4 2.6 11.6c0 2.5|||  + '<path d=\"M10 1.8C10 1.8 2.7 7.4 2.6 11.6c0 2.5|||牌背的黑桃另画了一份（与牌面那枚走样）"
  "pips.ts|||  '<rect x=\"3\" y=\"3\" width=\"95\" height=\"136\" rx=\"5\" fill=\"currentColor\" opacity=\".16\" />'|||  '<rect x=\"3\" y=\"3\" width=\"95\" height=\"136\" rx=\"5\" fill=\"url(#guinea-lattice)\" opacity=\".16\" />'|||牌背又用回带 id 的平铺引用（六张牌抢同一份纹样）"
  "pips.ts|||  + '<path d=\"M50.5 45.4 76.4 71 50.5 96.6 24.6 71z\" fill=\"none\" stroke=\"rgba(0, 0, 0, .3)\" |||  + '<path d=\"M51.5 45.4 77.4 71 51.5 96.6 25.6 71z\" fill=\"none\" stroke=\"rgba(0, 0, 0, .3)\" |||徽记那道暗边从卡纸上滑开（暖装饰那套里就压不住了）"
  "pips.ts|||  + '<path d=\"M50.5 47 74 71 50.5 95 27 71z\" fill=\"var(--ivory)\" opacity=\".92\" />'|||  + '<path d=\"M52.5 47 74 71 52.5 95 27 71z\" fill=\"var(--ivory)\" opacity=\".92\" />'|||徽记从牌背中线上挪开"
)

blind=0
noise=0
bad=0
crashed=0
skipped=0
total=${#INJ[@]}

# 基线：还没动手时自检必须是全绿的。跳过它就等于给空气记账——
# 环境本来就红的话，下面每条注入都会"被抓到"。
if [[ -n "${SKIP_BASELINE:-}" ]]; then
  echo "  跳过基线（SKIP_BASELINE=1）：只在刚量过全绿、且用 ONLY 复验几条时才该这么跑"
elif ! node core/selftest.ts > /tmp/falsify-baseline.out 2>&1; then
  echo "FALSIFY 拒绝运行：还没注入，自检就已经红了。先修红的那几条再跑反证。"
  grep -E '^  (FAIL|WEAK|INJECT) ' /tmp/falsify-baseline.out | head -8 | sed 's/^/  /'
  exit 2
else
  echo "基线：未注入的自检全绿，开始逐条注入。"
fi

for entry in "${INJ[@]}"; do
  why=${entry##*'|||'}          # 最后一段就是"该被什么抓到"，条目里 ||| 只出现在字段边界
  if [[ -n "${ONLY:-}" ]]; then
    hit=0
    IFS=',' read -ra pats <<< "$ONLY"
    for pat in "${pats[@]}"; do [[ "$why" == *"$pat"* ]] && hit=1; done
    if [[ $hit -eq 0 ]]; then skipped=$((skipped + 1)); continue; fi
  fi
  python3 - "$CORE" "$entry" <<'PY'
import sys
core, entry = sys.argv[1], sys.argv[2]
parts = entry.split('|||')
if len(parts) != 4:
    sys.exit(4)                     # 条目本身写坏了
path, frm, to, _why = parts
if to == 'Ø':
    to = ''
# 条目里写 \n 就当真换行用：同一行文本在文件里出现两处时（弃牌与 trimHand 的选中项
# 清理就一模一样），单行锚点永远只能打到第一处，第二处删了也量不出——多行锚点是唯一的出路。
frm = frm.replace('\\n', '\n')
to = to.replace('\\n', '\n')
p = f'{core}/{path}'
s = open(p).read()
if frm not in s:
    sys.exit(3)                     # 模式失配 = 盲区
n = s.count(frm)
open(p, 'w').write(s.replace(frm, to, 1))
sys.exit(5 if n > 1 else 0)         # 5 = 注入了，但锚点不唯一，改的是第一处
PY
  code=$?
  dup=0
  [[ $code -eq 5 ]] && { dup=1; code=0; }   # 注入生效了，只是锚点在文件里不止一处
  if [[ $code -eq 3 ]]; then
    echo "  SKIP  注入模式没匹配上：$entry"
    blind=$((blind + 1))
    cleanup; continue
  elif [[ $code -ne 0 ]]; then
    echo "  BAD   注入条目写坏了（字段数不是 4）：$entry"
    bad=$((bad + 1))
    cleanup; continue
  fi
  node core/selftest.ts > /tmp/falsify.out 2>&1
  code=$?
  hit=$(grep -m1 -E '^  (FAIL|WEAK|INJECT) ' /tmp/falsify.out | sed 's/^ *//')
  if [[ $code -eq 0 ]]; then
    echo "  BLIND $why —— 自检全绿$([[ $dup -eq 1 ]] && echo "（锚点有多处，改的是第一处）")"
    blind=$((blind + 1))
  elif grep -qE 'SyntaxError|ERR_UNKNOWN_FILE_EXTENSION|err_require_esm' /tmp/falsify.out; then
    # 注入把语法改坏了：自检因为"文件跑不起来"而失败，这不算被断言抓到
    echo "  NOISE 注入产出的是语法错误，不是行为破坏：$entry"
    noise=$((noise + 1))
  elif [[ -n "$hit" ]]; then
    echo "  caught  $why → $hit"
  else
    # 自检没跑到底就抛了：也算发现，但只有崩溃没有具名判据，值得单独看见
    echo "  caught* $why → 运行时抛错 $(grep -m1 -oE '[A-Za-z]*Error: [^\n]{0,44}' /tmp/falsify.out)"
    crashed=$((crashed + 1))
  fi
  cleanup
done

echo "----"
echo "注入 $((total - skipped)) 条：盲区 ${blind}，语法噪声 ${noise}，坏条目 ${bad}，仅靠运行时崩溃发现的 $crashed"
if [[ -n "${ONLY:-}" ]]; then
  echo "（ONLY 过滤：表里共 $total 条，跳过 $skipped 条——这不是全量门禁）"
  if [[ $((total - skipped)) -eq 0 ]]; then
    echo "FALSIFY FAIL：ONLY 一个都没匹配上，关键词拼错了吧"
    exit 1
  fi
fi
if [[ $blind -eq 0 && $noise -eq 0 && $bad -eq 0 ]]; then
  echo "FALSIFY OK：每条破坏都被自检抓到（其中 $crashed 条以抛错形式暴露）"
else
  echo "FALSIFY FAIL"; exit 1
fi
