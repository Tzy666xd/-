// 不变量穷举：随机策略乱按，每一步都核对账本。
// 目标是抓"编译过、断言也绿，但某条路径会把游戏打死"的那类问题——
// 特别是销账与玻璃碎裂会把牌永久移出，能不能把牌堆耗干到无牌可打。
import {
  Game, play, discard, buy, reroll, setRaise, useConsumable, sellSeat, settle, continueEndless,
  limits, targetOf, seatedCount, totalCards, MAX_DECK, reorderSeat, fishDiscard, peekDiscard,
  chooseEvent, autoResolveEvent,
} from './game.ts';
import type { GameState } from './game.ts';
import { evaluate } from './hands.ts';
import { PATRONS, LETTERS, BOSSES } from './content.ts';
import { FLAG_KEYS, FLAGS_ALL, FLAGS_OFF } from './flags.ts';
import { THRESHOLDS } from './thresholds.ts';
import { STEPS as TUT_STEPS, markSeen, STEP_IDS } from './tutorial.ts';
import { LESSONS as GUIDE_LESSONS, LESSON_IDS, MARKER as GUIDE_ON, beginGuide, inGuide, markLesson } from './guide.ts';
import type { FeatureFlags } from './flags.ts';
import type { Card } from './hands.ts';

const RUNS = Number(process.argv[2] ?? 60);
const STEPS = 4000;

interface Report { runs: number; onRuns: number; steps: number; worst: string[]; notes: Map<string, number> }

const rep: Report = { runs: 0, onRuns: 0, steps: 0, worst: [], notes: new Map() };
const seen = new Map<string, number>();
const bump = (k: string): void => seen.set(k, (seen.get(k) ?? 0) + 1);

let rngState = 12345;
function rnd(): number {
  rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
  return rngState / 0x7fffffff;
}
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length) % a.length];

/**
 * 每个随机局自己抽一份功能开关。
 * 七个新功能全部默认关，所以不这么干的话：穷举跑一万步也一步都没走进新功能——
 * 那比不测更糟，因为 fuzz 的绿灯会被读成"新玩法也没事"。
 */
function randomFlags(): FeatureFlags {
  const f: FeatureFlags = { ...FLAGS_OFF };
  const r = rnd();
  if (r < 0.15) return f;                       // 留一些全关的局当对照
  if (r < 0.3) return { ...FLAGS_ALL };         // 也留一些全开的局，逼它们互相搅
  for (const k of FLAG_KEYS) if (rnd() < 0.55) f[k] = true;
  return f;
}
/** 开局那一刻的 flags 快照。一局之内不许变：存档与结算都按它算账 */
const flagSig = (f: FeatureFlags): string => FLAG_KEYS.map((k) => (f[k] ? '1' : '0')).join('');

const finite = (n: number): boolean => Number.isFinite(n);

/** 每一步之后都要成立的事。任何一条破了就记下来，带上当时的场面 */
function check(s: GameState, ctx: string): void {
  const lim = limits(s);
  const bad = (name: string, cond: boolean): void => { if (!cond) rep.worst.push(`${name} — ${ctx}`); };

  bad('银钱为负或非法', finite(s.money) && s.money >= 0);
  bad('手牌超过上限', s.hand.length <= lim.handSize);
  bad('手牌为负', s.hand.length >= 0);
  bad('声望非法', finite(s.rep) && s.rep >= 0);
  bad('累计流水非法', finite(s.score) && s.score >= 0);
  bad('彩头非正', targetOf(s) > 0 && finite(targetOf(s)));
  bad('出牌次数为负', s.handsLeft >= 0);
  bad('弃牌次数为负', s.discardsLeft >= 0);
  bad('随身超槽', s.consumables.length <= lim.slots);
  bad('座位超员', seatedCount(s) <= lim.seats);
  bad('客人重复', new Set(s.seats.map((x) => x.pid)).size === s.seats.length);
  bad('牌总数超过上界', totalCards(s) <= MAX_DECK);
  bad('牌总数为负', totalCards(s) >= 0);
  bad('状态字非法', ['playing', 'cleared', 'shop', 'won', 'lost'].includes(s.status));
  bad('抬注层数越界', s.raiseNext >= 0 && s.raiseNext <= 4 && s.raisedHere >= 0 && s.raisedHere <= 4);
  for (const c of [...s.hand, ...s.table, ...s.deck, ...s.discardPile]) {
    if (!finite(c.rank) || c.rank < 2 || c.rank > 14) { rep.worst.push(`牌面点数非法 — ${ctx} ${JSON.stringify(c)}`); break; }
  }
  // ── 新功能带进来的那几份状态 ────────────────────────────────
  bad('已领阈值有不存在的 id 或重复领',
    s.claimed.every((id) => THRESHOLDS.some((d) => d.id === id))
    && new Set(s.claimed).size === s.claimed.length);
  bad('加注续命次数非法', s.betReprieves === 0 || s.betReprieves === 1);
  bad('客人长进的 XP 非法', s.seats.every((x) => x.xp === undefined
    || (Number.isInteger(x.xp) && x.xp >= 0 && x.xp <= 400)));
  bad('选了签名宾却不在座上', !s.signature || s.seats.some((x) => x.pid === s.signature));
  // 捞牌最典型的错法：同一张牌既留在弃堆又被塞进牌堆
  const ids = [...s.hand, ...s.table, ...s.deck, ...s.discardPile].map((c) => c.id);
  bad('同一张牌出现在两堆里', new Set(ids).size === ids.length);
  // 引导进度只是提示账，但它也在存档里走一圈：脏了就等于给下一次读档埋雷
  bad('引导进度非法（未知 id / 重复 / 不是数组）',
    Array.isArray(s.tutorial) && s.tutorial.every((x) => STEP_IDS.has(x))
    && new Set(s.tutorial).size === s.tutorial.length);
  // 引导关进度同一本账：标记位 + 认得的课 id，且不许重复
  bad('引导关进度非法（未知课 id / 重复 / 不是数组）',
    Array.isArray(s.guide) && s.guide.every((x) => x === GUIDE_ON || LESSON_IDS.has(x))
    && new Set(s.guide).size === s.guide.length);

  // 死局：手里没牌、牌堆与弃牌堆也空，就再也点不动了
  if (s.status === 'playing' && !s.hand.length && !s.deck.length && !s.discardPile.length) {
    rep.worst.push(`软锁死局：无牌可打也无处可弃 — ${ctx}`);
  }
}

function snapshotFor(g: Game): string {
  return `seed${g.state.seed} 夜${g.state.night}/${g.state.stage} 手${g.state.hand.length} 堆${g.state.deck.length} 弃堆${g.state.discardPile.length} 桌${g.state.table.length} 客${g.state.seats.length} 信${g.state.consumables.length} £${g.state.money}`;
}

/** 完全不留情的随机策略：什么都按，专挑破坏性动作 */
function randomAct(g: Game): string {
  const s = g.state;
  if (s.status === 'shop') {
    const r = rnd();
    if (r < 0.45) { const i = Math.floor(rnd() * s.shop.length); buy(g, i); return 'buy'; }
    if (r < 0.6) { reroll(g); return 'reroll'; }
    if (r < 0.7 && s.seats.length) { sellSeat(g, Math.floor(rnd() * s.seats.length)); return 'sell'; }
    if (r < 0.68) { setRaise(g, Math.floor(rnd() * 6)); return 'raise'; }   // 故意越界试夹紧
    // P0-2 换座 / P1-4 捞牌：只在铺子里有动作，不补进来等于从没被测过
    if (r < 0.76 && s.seats.length > 1) {
      const k = s.seats.length + 2;
      reorderSeat(g, Math.floor(rnd() * k) - 1, Math.floor(rnd() * k) - 1);   // 故意越界试夹紧
      return 'reorder';
    }
    if (r < 0.82) {
      const d = s.discardPile.length ? s.discardPile[Math.floor(rnd() * s.discardPile.length)] : null;
      fishDiscard(g, d ? d.id : -1);
      return 'fish';
    }
    if (r < 0.84) { peekDiscard(s, 1 + Math.floor(rnd() * 20)); return 'peek'; }
    if (r < 0.87) {
      // 玩家会点"知道了"，也会一次点"全部跳过"——两条都要在真流程里被走过
      s.tutorial = markSeen(s.tutorial, rnd() < 0.25 ? null : pick(TUT_STEPS).id);
      return 'tutor';
    }
    if (r < 0.90) {
      // 引导关：先有"这是一局课"，再一节节点掉或者整门退出。
      // 随机顺序点掉是故意的——界面那边的记账必须经得起玩家不按课程表点。
      if (!inGuide(s.guide)) { beginGuide(s); return 'guide-on'; }
      s.guide = markLesson(s.guide, rnd() < 0.2 ? null : pick(GUIDE_LESSONS).id);
      return 'guide';
    }
    g.next();
    return 'leave';
  }
  if (s.status !== 'playing') return 'idle';
  if (s.pendingEvent.length) {
    // 待决期间内核拒绝出牌也拒绝弃牌（这是设计），所以跑局器必须**替玩家应一件事**——
    // 不然整局原地空转，"不变量全过"是刷出来的（2026-10-12 就这么假绿过一次）。
    // 一半走自决、一半随机点一张：两条路都要被走过。
    if (rnd() < 0.5) autoResolveEvent(g);
    else chooseEvent(g, s.pendingEvent[Math.floor(rnd() * s.pendingEvent.length)]);
    return 'event';
  }
  const r = rnd();
  const n = 1 + Math.floor(rnd() * 6);          // 故意试过选 6 张
  s.chosen = s.hand.slice(0, n).map((c: Card) => c.id);
  if (r < 0.12 && s.consumables.length) {
    const i = Math.floor(rnd() * s.consumables.length);
    const c = s.consumables[i];
    const need = c.t === 'letter' ? LETTERS.find((l) => l.id === c.id)!.picks : 0;
    useConsumable(g, i, s.hand.slice(0, need).map((x) => x.id));
    return 'use';
  }
  if (r < 0.3 && s.discardsLeft > 0) { discard(g); return 'discard'; }
  if (r < 0.36 && !s.seats.length) { s.seats.push({ pid: pick(PATRONS).id, edition: 'none' }); return 'cheat-seat'; }
  play(g);
  if (s.status === 'cleared') { g.openShop(); return 'cleared'; }
  return 'play';
}

for (let i = 0; i < RUNS; i++) {
  const seed = 1 + i * 977;
  const deckId = i % 5 === 0 ? 'usurer' : i % 7 === 0 ? 'patrician' : 'standard';
  const flags = randomFlags();
  const sig = flagSig(flags);
  const g = new Game(seed, deckId, { flags });
  rep.runs++;
  if (FLAG_KEYS.some((k) => flags[k])) rep.onRuns++;
  for (let step = 0; step < STEPS; step++) {
    const act = randomAct(g);
    rep.steps++;
    bump(act);
    const ctx = `${snapshotFor(g)} @step${step} act=${act}`;
    check(g.state, ctx);
    if (flagSig(g.state.flags) !== sig) rep.worst.push(`一局之内 flags 被改了 — ${ctx}`);
    if (g.state.status === 'won') { bump('打通 8 夜'); break; }
    if (g.state.status === 'lost') {
      if (!g.state.hand.length && !g.state.deck.length && !g.state.discardPile.length) { bump('真·牌尽而亡'); break; }
      // 续命：随机策略本来就不会打牌，让它死就探不到后期状态。
      // 强行结清继续走，才能覆盖到深夜数、无尽、大量用信、牌堆逼近上界这些场面。
      bump('崩过一次(已续命)');
      g.state.status = 'playing';
      g.state.score = targetOf(g.state);
      g.state.handsLeft = 1;
      play(g);
      if (g.state.status === 'cleared') { g.openShop(); }
      else continue;
    }
    if (step === STEPS - 1) bump('步数耗尽(未分胜负)');
  }
}

// ── 破坏性专项：把牌永久移出，看会不会走到无牌可打的死局 ──────────
{
  const g = new Game(31337);
  for (let i = 0; i < 200; i++) {
    g.state.consumables = [{ t: 'letter', id: 'strike' }];
    if (!g.state.hand.length) { g.state.hand = g.state.deck.splice(0, 5); }
    if (!g.state.hand.length) break;
    useConsumable(g, 0, [g.state.hand[0].id]);
    check(g.state, `销账第 ${i} 次后 ${snapshotFor(g)}`);
  }
  bump(`破坏性销账后剩余牌数 ${totalCards(g.state)}`);
  // 牌全被移光之后，引擎必须给出一个能脱身的判定，而不是让玩家卡在原地
  if (!g.state.hand.length && !g.state.deck.length && !g.state.discardPile.length) {
    const before = g.state.status;
    g.state.chosen = [];
    play(g);
    check(g.state, `空牌堆出牌后 status=${before}→${g.state.status}`);
    bump(`空牌堆场景 status=${g.state.status}`);
  }
}

// ── 深夜数与无尽：数字要合法，且不能大到显示层摆不下 ───────────────
{
  let widest = 0;
  for (let n = 1; n <= 40; n++) {
    const g = new Game(5, 'standard', true);
    g.state.night = n;
    g.state.stage = 2;
    g.state.raisedHere = 4;
    const t = targetOf(g.state);
    if (!finite(t) || t <= 0) rep.worst.push(`第 ${n} 夜彩头非法：${t}`);
    widest = Math.max(widest, Math.round(t).toString().length);
  }
  bump(`最宽彩头 ${widest} 位`);
  if (widest > 22) rep.worst.push(`彩头宽到 ${widest} 位，显示层要溢出`);
}

// ── 深推进：一路打到无尽，覆盖后期状态（随机策略自己到不了那么远）──
{
  const g = new Game(909);
  g.state.seats = PATRONS.slice(0, 3).map((p) => ({ pid: p.id, edition: 'none' as const }));
  for (let round = 0; round < 40; round++) {
    g.state.chosen = g.state.hand.slice(0, 5).map((c) => c.id);
    play(g);
    if (g.state.status === 'playing') { g.state.score = targetOf(g.state); settle(g); }
    check(g.state, `深推进 夜${g.state.night}/${g.state.stage} round${round}`);
    if (g.state.status === 'cleared') { g.openShop(); buy(g, 0); g.next(); }
    check(g.state, `深推进换场后 夜${g.state.night}/${g.state.stage}`);
    if (g.state.status === 'won') {
      bump('打到 8 夜终局');
      continueEndlessProbe(g);
      break;
    }
  }
  bump(`深推进最远到第 ${g.state.night} 夜（无尽=${g.state.endless}）`);
  if (g.state.night < 8) rep.worst.push(`深推进只到第 ${g.state.night} 夜，后期没被覆盖`);
}

function continueEndlessProbe(g: Game): void {
  // 终局之后必须还能继续经营，且第 9 夜起彩头按指数走
  const before = g.state.status;
  g.state.status = 'cleared';
  continueEndless(g);
  check(g.state, `无尽开场 status=${before}→${g.state.status}`);
  if (g.state.night !== 9) rep.worst.push(`无尽没有推进到第 9 夜而是 ${g.state.night}`);
  for (let i = 0; i < 6; i++) {
    g.state.score = targetOf(g.state);
    settle(g);
    g.openShop();
    g.next();
    check(g.state, `无尽第 ${g.state.night} 夜`);
  }
}

// 结算事件流的自洽性也要在乱按中核对一遍
{
  const g = new Game(4242);
  g.state.seats = PATRONS.slice(0, 6).map((p) => ({ pid: p.id, edition: 'foil' as const }));
  for (let i = 0; i < 8; i++) {
    g.state.chosen = g.state.hand.slice(0, 5).map((c) => c.id);
    const res = play(g);
    if (!res) break;
    for (const e of res.events) {
      if (e.after.value !== e.after.chips * e.after.mult) rep.worst.push(`事件快照不自洽 ${evaluate([]).kind}`);
      if (!finite(e.after.value) || e.after.value < 0) rep.worst.push(`事件快照非法值 ${e.after.value}`);
    }
    if (g.state.status === 'cleared') { g.openShop(); g.next(); }
  }
}

// 绿灯要有资格：新功能的动作一次都没发生，就等于这条路根本没走过，
// 报"全绿"是假的安全感——所以把覆盖率本身也变成一条不变量。
if (rep.onRuns * 2 < rep.runs) {
  rep.worst.push(`只有 ${rep.onRuns}/${rep.runs} 局开了新功能，七条路覆盖不到`);
}
for (const k of ['reorder', 'fish', 'peek', 'guide', 'guide-on', 'event']) {
  if (!(seen.get(k) ?? 0)) rep.worst.push(`动作 ${k} 一次都没发生（新功能的入口没被走到）`);
}

console.log(`穷举 ${rep.runs} 局 / ${rep.steps} 步（${rep.onRuns} 局至少开了一个新功能）`);
console.log('动作分布：', [...seen.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join('  '));
const byName = new Map<string, string>();
for (const w of rep.worst) { const k = w.split(' — ')[0]; if (!byName.has(k)) byName.set(k, w); }
const uniq = [...byName.values()];
if (uniq.length) {
  console.log(`\n违反 ${rep.worst.length} 次，去重后 ${uniq.length} 类：`);
  for (const w of uniq.slice(0, 25)) console.log('  ✗', w);
} else {
  console.log('\nFUZZ OK：所有不变量在每一之后都成立');
}
process.exitCode = uniq.length ? 1 : 0;

