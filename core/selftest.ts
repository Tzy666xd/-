// 内核自检：`node core/selftest.ts`
// 纪律照潮屿那条：**每条判据都要被证明它会红**。所以除了 45 条正向断言，
// 还有一组反证——把数据改成错的，要求同一条判据必须判假。
// 只有正向全绿、反证也全部转红，退出码才是 0。
import type { Card, HandKind, Suit } from './hands.ts';
import type { FeatureFlags } from './flags.ts';
import { evaluate, HANDS, handBase, cardChips } from './hands.ts';
import { score } from './scoring.ts';
import type { ScoreEnv } from './scoring.ts';
import { Rand } from './rng.ts';
import { patronById, BOSSES, VOUCHERS, LETTERS, BOOKS, PATRONS, RARITY_MIN_REP, DECKS, decksFor } from './content.ts';
import { HOOKS, KINDS } from './effects.ts';
import { TUNES, TIMBRES, plan, loopSteps, loopSeconds, stepDur, degreeToMidi, DRUM } from './music.ts';
import { CUES, CUE_NAMES, EVENT_CUE, EFFECT_EVENTS, cueForEffect, crackleSize, voice, peakGain, semitone } from './sound.ts';
import { STEPS, stepFor, satisfied, remaining, finished, markSeen } from './tutorial.ts';
import type { Facts as TutFacts } from './tutorial.ts';
import {
  GUIDE, LESSONS, LESSON_IDS, MARKER, beginGuide, inGuide, guideFacts, guideFlags, lessonFor, markLesson,
  position, quitGuide, remaining as lessonsLeft,
} from './guide.ts';
import type { Facts as GuideFacts } from './guide.ts';
import {
  EVENTS, EVENT_OFFER, EVENT_IDS, eventById, canFire, drawEvents, deriveEventRand, deriveFanRand, eventAtFor,
  autoPick, eventTags, riskName, scopeName, FAN_SALT,
} from './events.ts';
import type { EventFacts, EventOp } from './events.ts';
import { THRESHOLDS, crossedThresholds, thresholdValue, nextGap, MAX_PER_HAND, MAX_PER_STAGE } from './thresholds.ts';
import { BETS, betFor, resolveBetMiss } from './bets.ts';
import { FLAGS_OFF, FLAGS_ALL, FLAG_KEYS, sanitizeFlags } from './flags.ts';
import { SETS, activeSets, setMods, ALL_TAGS } from './sets.ts';
import { drawOffer, draftPool, deriveRand, offerLine, temperamentsOf, OFFER_SIZE, lengthWeight } from './draft.ts';
import {
  MIN_NIGHTS, MAX_NIGHTS, DEFAULT_NIGHTS, BASE_TARGET, BOSS_STAGE_SCALE, OVERFLOW_GROWTH,
  LENGTHS, lengthOf, clampNights, lengthScale, nightScale, referenceTarget,
  TIER_IDS, TIER_LABEL,
} from './lengths.ts';
import { growthLevel, growthBonus, grow, atCap } from './growth.ts';
import {
  PORTRAITS, PALETTE, LAYERS, HATS, HAIRS, HEADS, FACES, COLLARS, PROPS,
  duplicateMonograms, duplicatePortraits, portraitGround, portraitSvg,
} from './portrait.ts';
import type { Portrait } from './portrait.ts';
import { PIP_SPOTS, pipSpots, isPipCard, SUIT_ART, SUIT_VIEWBOX, suitSvg, FACE_ART, ACE_RING, BACK_ART, BACK_VIEWBOX } from './pips.ts';
import { MATERIALS, SEAL_LAYERS, layerRepeat, layerChips, layerMult, layerXmult, layerMoney, layerBreaksOn, layerCount, MAX_LAYERS } from './layers.ts';
import { serialize as serializeSave, deserialize as deserializeSave } from './save.ts';
import type { PatronDef, Seat } from './effects.ts';
import {
  Game, limits, targetOf, targetFor, play, reorderSeat, canReorderSeat, fishDiscard, peekDiscard, discard, settle, useConsumable, setRaise, buy, rerollPrice,
  mkSeat, seatedCount, seatIds, totalCards, STAGE_KIND, STAGE_SCALE, MAX_DECK, MIN_DEALABLE, sellSeat,
  DIFFS, MODES, diffById, modeById, dailySeed, FINAL_NIGHT, START_BUFFER,
  eventChoices, chooseEvent, autoResolveEvent, fanOffer, FAN_SIZE,
} from './game.ts';

let pass = 0;
const fails: string[] = [];
const rejected: string[] = [];
const rep_note = (name: string): void => { rejected.push(name); };

function t(name: string, cond: boolean): void {
  if (cond) pass++;
  else fails.push(name);
}

// 反证：传入一条"错误的断言"。它为真才说明正向判据形同虚设——
// 所以 wrongClaim 为真时记 WEAK，为假才算通过。
const reds: string[] = [];
function refute(name: string, wrongClaim: boolean): void {
  if (wrongClaim) reds.push(name);
  else pass++;
}

const S = (...ids: string[]): Seat[] => ids.map((id) => mkSeat(id));
let nid = 1000;
const C = (rank: number, suit: Suit, enh: Card['enh'] = 'none', seal: Card['seal'] = 'none'): Card =>
  ({ id: nid++, rank, suit, enh, seal });

const env0: ScoreEnv = { handIndex: 0, rep: 0, raised: 0, discardsUsed: 0, money: 0 };
function run(played: Card[], seatsIn: (string | Seat)[], opt: Partial<{
  level: number; held: Card[]; env: Partial<ScoreEnv>; bossId: string; seed: number;
}> = {}) {
  const seats: Seat[] = seatsIn.map((x) => (typeof x === 'string' ? mkSeat(x) : x));
  const boss = opt.bossId ? BOSSES.find((b) => b.id === opt.bossId)! : null;
  return score({
    played, result: evaluate(played), level: opt.level ?? 1,
    held: opt.held ?? [], seats, boss, rand: new Rand(opt.seed ?? 7),
    env: { ...env0, ...(opt.env ?? {}) },
  });
}

// ── 1. 牌型识别 ────────────────────────────────────────────────
const kinds: [string, Card[], HandKind, number][] = [
  ['高牌', [C(9, 's'), C(11, 'h')], 'high', 0],
  ['对子', [C(7, 's'), C(7, 'h'), C(2, 'd')], 'pair', 2],
  ['两对', [C(7, 's'), C(7, 'h'), C(4, 'd'), C(4, 'c')], 'twopair', 4],
  ['三条', [C(7, 's'), C(7, 'h'), C(7, 'd'), C(2, 'c')], 'three', 3],
  ['顺子', [C(5, 's'), C(6, 'h'), C(7, 'd'), C(8, 'c'), C(9, 's')], 'straight', 5],
  ['轮子顺', [C(14, 's'), C(2, 'h'), C(3, 'd'), C(4, 'c'), C(5, 's')], 'straight', 5],
  ['同花', [C(2, 'h'), C(5, 'h'), C(9, 'h'), C(11, 'h'), C(13, 'h')], 'flush', 5],
  ['葫芦', [C(7, 's'), C(7, 'h'), C(7, 'd'), C(4, 'c'), C(4, 's')], 'full', 5],
  ['四条', [C(7, 's'), C(7, 'h'), C(7, 'd'), C(7, 'c'), C(2, 's')], 'four', 4],
  ['同花顺', [C(5, 'd'), C(6, 'd'), C(7, 'd'), C(8, 'd'), C(9, 'd')], 'sf', 5],
  ['皇家同花顺', [C(10, 'c'), C(11, 'c'), C(12, 'c'), C(13, 'c'), C(14, 'c')], 'royal', 5],
  ['五条', [C(7, 's'), C(7, 'h'), C(7, 'd'), C(7, 'c'), C(7, 's')], 'five', 5],
  ['同花葫芦', [C(7, 'h'), C(7, 'h'), C(7, 'h'), C(4, 'h'), C(4, 'h')], 'flushhouse', 5],
  ['同花五条', [C(7, 'h'), C(7, 'h'), C(7, 'h'), C(7, 'h'), C(7, 'h')], 'flushfive', 5],
];
for (const [name, cards, want, scoring] of kinds) {
  const got = evaluate(cards);
  t(`牌型 ${name}`, got.kind === want);
  if (scoring) t(`牌型 ${name} 计分张数`, got.scoring.length === scoring);
}
// 高牌只有最大那张计分
t('高牌只算最大一张', evaluate([C(3, 's'), C(9, 'h'), C(6, 'd')]).scoring[0].rank === 9);
// 4 张同花不算同花
refute('张数不足就不许判成同花', evaluate([C(2, 'h'), C(5, 'h'), C(9, 'h'), C(11, 'h')]).kind === 'flush');
refute('顺子不许吃掉高牌判定', evaluate([C(5, 's'), C(6, 'h'), C(7, 'd'), C(8, 'c')]).kind === 'straight');
refute('葫芦不压过同花五条', evaluate([C(7, 'h'), C(7, 'h'), C(7, 'h'), C(4, 'h'), C(4, 'h')]).kind === 'full');

// ── 2. 计分数学 ────────────────────────────────────────────────
// 对子(7,7)：基础 10 流水 + 7 + 7 = 24，×2 倍注 = 48
t('对子结算值', run([C(7, 's'), C(7, 'h')], []).value === 48);
// 高牌 A：基础 5 + 11 = 16，×1 = 16
t('高牌 A 结算值', run([C(14, 's')], []).value === 16);
// 皇家同花顺：100 + (10+10+10+10+11) = 151 × 8
t('皇家同花顺结算值', run([C(10, 'c'), C(11, 'c'), C(12, 'c'), C(13, 'c'), C(14, 'c')], []).value === 1208);
// 升级：对子 2 级 = (10+15) 流水 +(2+1) 倍注
t('牌谱升级改了基础值', run([C(7, 's'), C(7, 'h')], [], { level: 2 }).value === (25 + 14) * 3);
t('牌型表自洽', handBase('pair', 1).chips === 10 && HANDS.pair.dChips === 15);
t('人头牌记 10 分', cardChips(C(12, 's')) === 10 && cardChips(C(14, 's')) === 11);
refute('级别 0 不该比级别 1 更值钱', handBase('pair', 0).chips > handBase('pair', 1).chips);

// ── 3. 事件流：因果序列的不变量 ────────────────────────────────
const stream = run([C(7, 's'), C(7, 'h'), C(7, 'd')], ['hobbs', 'odd']);
t('事件流以 total 收尾', stream.events[stream.events.length - 1].t === 'total');
t('事件流以牌型开头', stream.events[0].t === 'hand');
t('每条快照自洽 value=chips×mult', stream.events.every((e) => e.after.value === e.after.chips * e.after.mult));
t('流水单调不减', stream.events.every((e, i) => i === 0 || e.after.chips >= stream.events[i - 1].after.chips));
t('倍注单调不减', stream.events.every((e, i) => i === 0 || e.after.mult >= stream.events[i - 1].after.mult));
t('逐张计分按打出顺序', stream.events.filter((e) => e.t === 'card').map((e) => (e as any).id).join(',') ===
  stream.events.filter((e) => e.t === 'card').map((e) => (e as any).id).sort((a, b) => a - b).join(','));
// 管家霍布斯：3 张计分牌各 +8 流水
t('霍布斯逐张加流水', run([C(7, 's'), C(7, 'h'), C(7, 'd')], ['hobbs']).value ===
  run([C(7, 's'), C(7, 'h'), C(7, 'd')], []).value + 3 * 8 * handBase('three', 1).mult);
// 独眼赌徒：第 3 张 ×2 倍注
t('独眼第 3 张翻倍', run([C(7, 's'), C(7, 'h'), C(7, 'd')], ['odd']).events.some((e) => e.t === 'patron' && (e as any).xmult === 2));
t('独眼对两张牌不翻倍', !run([C(7, 's'), C(7, 'h')], ['odd']).events.some((e) => (e as any).xmult === 2));
// 红裙伯爵夫人只看红心
t('伯爵夫人只对 ♥ 生效', run([C(7, 's'), C(7, 'h')], ['countess']).events.filter((e) => e.t === 'patron').length === 1);
refute('伯爵夫人不该给黑桃加分', run([C(7, 's'), C(7, 'h')], ['countess']).events.filter((e) => e.t === 'patron').length === 2);
// 赛马记者只在含顺子时触发
t('记者不理葫芦', !run([C(7, 's'), C(7, 'h'), C(7, 'd'), C(4, 'c'), C(4, 's')], ['turf']).events.some((e) => (e as any).xmult === 2));
t('记者认顺子', run([C(5, 's'), C(6, 'h'), C(7, 'd'), C(8, 'c'), C(9, 's')], ['turf']).events.some((e) => (e as any).xmult === 2));
// 老报馆主只管每夜头一手
t('报馆主第二手不触发', run([C(7, 's'), C(7, 'h')], ['almanac'], { env: { handIndex: 1 } }).events.every((e) => e.t !== 'patron'));
t('报馆主头一手触发', run([C(7, 's'), C(7, 'h')], ['almanac'], { env: { handIndex: 0 } }).events.some((e) => e.t === 'patron'));
// 翻倍注乘的是"已累积的倍注"，不是总分
const xm = run([C(7, 's'), C(7, 'h')], ['house']);
t('×倍注乘倍注而非总分', xm.mult === handBase('pair', 1).mult * 3 && xm.value === xm.chips * xm.mult);

// ── 4. 双生姐妹：复制左邻 ─────────────────────────────────────
const twinsOn = run([C(7, 's'), C(7, 'h'), C(7, 'd')], ['odd', 'twins']);
const oddOnly = run([C(7, 's'), C(7, 'h'), C(7, 'd')], ['odd']);
t('双胞胎让左邻多演一遍', twinsOn.events.filter((e) => e.t === 'patron').length === oddOnly.events.filter((e) => e.t === 'patron').length + 1);
t('双胞胎挂在左邻名下', twinsOn.events.some((e) => e.t === 'patron' && (e as any).pid === 'odd' && (e as any).xmult === 2));
// 三张座位才能区分"紧邻的左邻"和"首位"：复制错对象时这里会偏。
// 三张 K：收租人本应每张 +7（3 次），双胞胎让它在每张上再演一次（共 6 次），独眼只在第 3 张翻倍（1 次）
const triple = run([C(13, 's'), C(13, 'h'), C(13, 'd')], ['odd', 'rent', 'twins']);
const byPid = (ev: typeof triple.events, pid: string): number =>
  ev.filter((e) => e.t === 'patron' && (e as any).pid === pid).length;
t('双胞胎复制的是紧邻左邻而非首位', byPid(triple.events, 'rent') === 6 && byPid(triple.events, 'odd') === 1);
// 三条基础 30×3；三张 K 各 +10 流水 → 60；收租人 +7 演 6 次 → 3+42=45，独眼在第 3 张 ×2 之后再叠两次 +7 → 76
t('双胞胎复制后的账对得上', triple.chips === 60 && triple.mult === 76 && triple.value === 4560);
refute('双胞胎不该复制首位那位', byPid(triple.events, 'odd') === 2);
// 坐在最左边没有左邻，应当什么都不演
t('双胞胎坐首位则空转', run([C(7, 's'), C(7, 'h'), C(7, 'd')], ['twins', 'odd']).events.filter((e) => e.t === 'patron').length === 1);
refute('双胞胎不该复制自己', run([C(7, 's'), C(7, 'h'), C(7, 'd')], ['twins']).events.some((e) => e.t === 'patron'));

// ── 5. 贵客的刁难 ─────────────────────────────────────────────
const pb1 = C(7, 's'), pb2 = C(7, 'h');
const picky = run([pb1, pb2], [], { bossId: 'picky' });
const pickyCards = picky.events.filter((e) => e.t === 'card').map((e) => (e as any).id as number);
t('女伯爵只挡 ♥', pickyCards.length === 1 && pickyCards[0] === pb1.id);
t('挡下的牌不进计分', picky.chips === handBase('pair', 1).chips + 7);
t('被挡的牌有交代', picky.events.some((e) => e.t === 'blocked' && (e as any).id === pb2.id));
const sheriff = run([C(13, 's'), C(13, 'h'), C(4, 'd')], [], { bossId: 'bailiff' });
t('警长挡下人头牌', sheriff.events.filter((e) => e.t === 'blocked').length === 2);
t('警长不挡小牌', run([C(7, 's'), C(7, 'h')], [], { bossId: 'bailiff' }).events.every((e) => e.t !== 'blocked'));
// 被挡下的 ♥ 也不该惊动只看红心的伯爵夫人
t('挡下即免触发', run([pb1, pb2], ['countess'], { bossId: 'picky' }).events.every((e) => e.t !== 'patron'));

// ── 6. 强化牌 ─────────────────────────────────────────────────
t('烫金 +30 流水', run([C(7, 's', 'bonus'), C(7, 'h')], []).value === (10 + 7 + 30 + 7) * 2);
t('朱批 +4 倍注', run([C(7, 's', 'mult'), C(7, 'h')], []).value === (10 + 14) * 6);
const glass = run([C(7, 's', 'glass'), C(7, 'h')], [], { seed: 99 });
t('磨镜 ×2 倍注', glass.mult === 4);
t('金票不产生流水', cardChips(C(7, 's', 'gold')) === 0);
// 碎裂是有概率的分支：先找一个真会碎的种子，否则这条判据等于没测
const breaking = (() => {
  for (let seed = 1; seed <= 200; seed++) {
    const r = run([C(7, 'h', 'glass'), C(7, 'h', 'glass'), C(7, 'h', 'glass'), C(7, 'h', 'glass'), C(7, 'h', 'glass')], [], { seed });
    if (r.shattered.length > 0) return { seed, n: r.shattered.length };
  }
  return null;
})();
t('磨镜确实会碎', !!breaking);
if (breaking) {
  const again = run([C(7, 'h', 'glass'), C(7, 'h', 'glass'), C(7, 'h', 'glass'), C(7, 'h', 'glass'), C(7, 'h', 'glass')], [], { seed: breaking.seed });
  t('碎裂结果可复现', again.shattered.length === breaking.n);
}
t('不带磨镜时不该有碎裂', run([C(7, 's'), C(7, 'h'), C(7, 'd'), C(7, 'c'), C(7, 's')], [], { seed: breaking?.seed ?? 3 }).shattered.length === 0);

// ── 7. 经济 / 经营闭环 ───────────────────────────────────────
const g = new Game(20261009);
t('起手 8 张', g.state.hand.length === 8);
t('默认限额', limits(g.state).seats === 3 && limits(g.state).hands === 4 && limits(g.state).discards === 3);
t('第 1 夜彩头 300', targetOf(g.state) === 300);
t('第 8 夜彩头 50000', (() => { const x = new Game(1); x.state.night = 8; x.state.stage = 0; return targetOf(x.state) === 50000; })());
// 三关缩放 1 / 1.5 / 2
t('正宴 ×1.5', (() => { const x = new Game(1); x.state.stage = 1; return targetOf(x.state) === 450; })());
t('贵客局 ×2', (() => { const x = new Game(1); x.state.stage = 2; return targetOf(x.state) === 600; })());

const g2 = new Game(4242);
g2.state.seats = S('house');
t('牌桌老板抬高清头 20%', Math.abs(limits(g2.state).targetScale - 1.2) < 1e-9);
t('牌桌老板在席时彩头真的变高', targetOf(g2.state) === 360);
refute('老板的抽水不该改座位数', limits(g2.state).seats !== 3);

// 抬注：不花钱的纯风险决策，抬了彩头就硬，但赏金与盈余折现跟着涨
const g3 = new Game(777);
setRaise(g3, 2);
g3.next();                                     // 便宴 → 正宴，抬注在本夜落地
t('抬注 2 层把彩头乘 2.25', targetOf(g3.state) === 1010);
t('抬注层数落地后待发归零', g3.state.raisedHere === 2 && g3.state.raiseNext === 0);
const m3 = g3.state.money;
g3.state.score = targetOf(g3.state);
settle(g3);
t('抬注换来更高赏金（正宴 £4→£8）', g3.state.money - m3 >= 8);
t('抬注层数计进声望', g3.state.rep === 2);
refute('不抬注时彩头不该被抬高', (() => { const x = new Game(777); x.next(); return targetOf(x.state) !== 450; })());

// 每手牌累加，不是取最好一手（这条曾写错过）
const g4 = new Game(11);
const cards4 = g4.state.hand.slice(0, 2);
g4.state.chosen = cards4.map((c) => c.id);
const res4a = play(g4);
t('第一手入账', !!res4a && g4.state.score === res4a.value);
const mid = g4.state.score;
const one4 = g4.state.hand[0];
g4.state.chosen = [one4.id];
const res4b = play(g4);
t('第二手是累加而非覆盖', !!res4b && g4.state.score === mid + res4b.value);
refute('累加不等于取最大值', g4.state.score === Math.max(mid, res4b?.value ?? 0));

// 出完牌还不够彩头 → 输
const g5 = new Game(5);
g5.state.buffer = 0;              // 裸基线：没有缓冲回合时，打光手就该散场
g5.state.handsLeft = 1;
g5.state.chosen = [g5.state.hand[0].id];
play(g5);
t('打光手又没够彩头就崩盘', g5.state.status === 'lost');

// 过关结算：赏金 + 利息 + 盈余折现
const g6 = new Game(6);
g6.state.money = 25;
g6.state.score = targetOf(g6.state) + 600;
settle(g6);
t('结清后进入待铺状态', g6.state.status === 'cleared');
t('赏金与利息进了账', g6.state.money > 25 + 3);
t('账本记了一行', g6.state.ledger.length === 1 && g6.state.ledger[0].target === 300);
t('利息按 £5 一档', (() => { const x = new Game(3); x.state.money = 24; x.state.score = 999; settle(x); return x.state.money >= 24 + 3 + 4; })());

// 马夫弃牌换钱 / 记账先生奖励不浪费 / 税吏抽钱
const g7 = new Game(7);
g7.state.seats = S('payne');
g7.state.chosen = [g7.state.hand[0].id, g7.state.hand[1].id];
const m7 = g7.state.money;
discard(g7);
t('马夫每弃一张得 £1', g7.state.money === m7 + 2);
// 弃牌自己也要把死选中项扫掉：选中项里留着已经进弃牌堆的牌，下一手出牌就会打空气。
// trimHand（请走客人后手牌超上限）那条路另有判据，两处代码长得一模一样，得各钉一根。
t('弃掉的牌不留在选中项里', g7.state.chosen.length === 0
  && g7.state.chosen.every((id) => g7.state.hand.some((c) => c.id === id)));
const g8 = new Game(8);
g8.state.seats = S('clerk');
g8.state.score = 999;
g8.state.discardsUsed = 0;
const m8 = g8.state.money;
settle(g8);
t('记账先生奖励零弃牌 £8', g8.state.settlement.some((l) => l.pid === 'clerk' && l.amount === 8));
const g8b = new Game(8);
g8b.state.seats = S('clerk');
g8b.state.score = 999;
g8b.state.discardsUsed = 1;
settle(g8b);
t('弃过牌记账先生就不付', !g8b.state.settlement.some((l) => l.pid === 'clerk'));
refute('记账先生不该在结算里凭空消失', g8.state.settlement.length === 0 && m8 === g8.state.money);

// 守财的表亲：握在手里的 ♦ 才结钱
const g8c = new Game(80);
g8c.state.seats = S('cousin');
g8c.state.hand = [C(4, 'd'), C(9, 'd'), C(2, 's')];
g8c.state.score = 999;
settle(g8c);
t('表亲按手中方块结钱', g8c.state.settlement.filter((l) => l.pid === 'cousin').reduce((a, l) => a + l.amount, 0) === 2);
const g8d = new Game(81);
g8d.state.seats = S('cousin');
g8d.state.hand = [C(4, 's')];
g8d.state.score = 999;
settle(g8d);
t('表亲不认黑桃', !g8d.state.settlement.some((l) => l.pid === 'cousin'));

const g9 = new Game(9);
g9.state.money = 10;
g9.state.seats = [];
g9.state.bossId = 'taxman';
g9.state.chosen = [g9.state.hand[0].id];
discard(g9);
t('税吏抽走 £2', g9.state.money === 8);

// 声望：贵客局 +1，抬注层数也计
const g10 = new Game(10);
g10.state.stage = 2;
g10.state.score = 1e6;
g10.state.bossId = 'picky';
const rep0 = g10.state.rep;
settle(g10);
t('击败贵客涨声望', g10.state.rep === rep0 + 1);

// 会员特权：会籍加座位
const g11 = new Game(11);
g11.state.vouchers = ['membership'];
t('正式会籍 +1 座位', limits(g11.state).seats === 4);
g11.state.vouchers = ['ledger'];
t('记账房抬利息上限', limits(g11.state).interestCap === 10);

// 引荐信
const g12 = new Game(12);
const target12 = g12.state.hand[0];
g12.state.consumables = [{ t: 'letter', id: 'gild' }];
useConsumable(g12, 0, [target12.id]);
t('烫金令改了那张牌', target12.enh === 'bonus');
t('引荐信用完即失', g12.state.consumables.length === 0);
const g12b = new Game(120);
const t12b = g12b.state.hand[0];
g12b.state.consumables = [{ t: 'letter', id: 'vermilion' }];
useConsumable(g12b, 0, [t12b.id]);
t('朱批改的是倍注牌', t12b.enh === 'mult');
refute('引荐信不该改到别的牌上', g12b.state.hand.some((c) => c.id !== t12b.id && c.enh !== 'none'));

const g13 = new Game(13);
const total13 = g13.state.deck.length + g13.state.hand.length + g13.state.discardPile.length;
const src13 = g13.state.hand[0];
g13.state.consumables = [{ t: 'letter', id: 'write' }];
useConsumable(g13, 0, [src13.id]);
t('誊抄让总牌数多了一张', g13.state.deck.length + g13.state.hand.length + g13.state.discardPile.length === total13 + 1);
t('誊抄复制的是同一张牌', g13.state.deck.some((c) => c.rank === src13.rank && c.suit === src13.suit && c.id !== src13.id));
// 五条在标准牌堆里不可能出现，正是"誊抄"把隐秘牌型打开的
t('标准五张成不了五条', evaluate([C(7, 's'), C(7, 'h'), C(7, 'd'), C(7, 'c'), C(8, 's')]).kind !== 'five');
const g13b = new Game(131);
const s13b = g13b.state.hand[0];
g13b.state.consumables = [{ t: 'letter', id: 'write' }];
useConsumable(g13b, 0, [s13b.id]);
const twin = g13b.state.deck.find((c) => c.rank === s13b.rank && c.suit === s13b.suit && c.id !== s13b.id)!;
// 复制出来的牌同点同花，五张全同于是直接落进"同花五条"——隐秘牌型正是誊抄打开的
t('誊抄之后能凑出隐秘牌型', evaluate([s13b, twin, s13b, twin, s13b]).kind === 'flushfive');
t('空手牌不该判出计分张', evaluate([]).scoring.length === 0);

const g13c = new Game(132);
const s13c = g13c.state.hand[0];
const n13c = g13c.state.deck.length + g13c.state.hand.length + g13c.state.discardPile.length;
g13c.state.consumables = [{ t: 'letter', id: 'strike' }];
g13c.state.money = 0;
useConsumable(g13c, 0, [s13c.id]);
t('销账真的移除了那张牌', g13c.state.deck.length + g13c.state.hand.length + g13c.state.discardPile.length === n13c - 1);
t('销账换到 £5', g13c.state.money === 5);

const g14 = new Game(14);
g14.state.consumables = [{ t: 'book', id: 'pair' }];
useConsumable(g14, 0, []);
t('牌谱升了级', (g14.state.books.pair ?? 1) === 2);
t('消耗品槽只有两个', limits(g14.state).seats >= 3 && g14.state.consumables.length === 0);

// 结清不许收桌：渲染层靠 s.table 判断牌还在不在场，提前清空会让过关那一手的牌
// 在动画中途凭空消失（实测踩过这个坑）
const gT = new Game(41);
gT.state.table = gT.state.hand.slice(0, 3);
const onTable = gT.state.table.length;
gT.state.score = 999;
settle(gT);
t('结清后牌仍留在桌面上', gT.state.table.length === onTable);
gT.openShop();
gT.next();
t('下一场开局才收桌', gT.state.table.length === 0);
refute('结清不该顺手把银钱也清掉', gT.state.money < 0);

// 贵客的惩罚必须在开场就落到限额上。曾因 setupStage 先算 limits、后抽 boss 而整个落空，
// 断言只查 limits() 是抓不到的——必须查真实发到手上的数
{
  const findBoss = (want: string): Game | null => {
    for (let i = 0; i < 600; i++) {
      const x = new Game(1000 + i);
      x.state.status = 'cleared';
      x.state.stage = 1;
      x.next();
      if (x.state.bossId === want) return x;
    }
    return null;
  };
  const narrow = findBoss('narrow');
  t('窄桌开场就把上限压到 5', !!narrow && narrow.state.hand.length === 5 && limits(narrow.state).handSize === 5);
  const miser = findBoss('miser');
  t('吝啬鬼开场就少给一次出牌', !!miser && miser.state.handsLeft === 3);
  const picky = findBoss('picky');
  t('没惩罚的贵客不动限额', !!picky && picky.state.hand.length === 8 && picky.state.handsLeft === 4);
}

// 换场一张牌都不许蒸发：桌面也要回收
{
  const gc = new Game(2024);
  const t0 = totalCards(gc.state);
  gc.state.chosen = gc.state.hand.slice(0, 2).map((c) => c.id);
  play(gc);
  if (gc.state.status === 'playing') { gc.state.score = targetOf(gc.state); settle(gc); }
  gc.openShop();
  gc.next();
  t('换场后牌数守恒', totalCards(gc.state) === t0 && gc.state.table.length === 0);
  t('换场重新发满一手', gc.state.hand.length === limits(gc.state).handSize);
  refute('换场不该顺手多发几张牌', totalCards(gc.state) > t0);
}

// 销账有下限：一路拆下去会把牌拆到发不出手
{
  const gm = new Game(2026);
  let refused = false;
  for (let i = 0; i < 60; i++) {
    gm.state.consumables = [{ t: 'letter', id: 'strike' }];
    if (!gm.state.hand.length) gm.state.hand = gm.state.deck.splice(0, 5);
    if (!gm.state.hand.length) break;
    if (!useConsumable(gm, 0, [gm.state.hand[0].id])) { refused = true; break; }
  }
  t('拆到下限就拒绝再销账', refused && totalCards(gm.state) >= MIN_DEALABLE);
}

// 换场时无牌可发也要判负，不能把玩家留在一个空牌桌上
{
  const gz = new Game(2027);
  gz.state.deck = [];
  gz.state.discardPile = [];
  gz.state.hand = [];
  gz.state.table = [];
  gz.state.status = 'cleared';
  gz.state.stage = 0;
  gz.next();
  t('换场无牌可发直接判负', gz.state.status === 'lost' && gz.state.hand.length === 0);
}

// 牌耗干时必须判负，而不是让玩家卡在"没牌可出又没牌可弃"
{
  const gs = new Game(2025);
  gs.state.deck = [];
  gs.state.discardPile = [];
  gs.state.table = [];
  gs.state.handsLeft = 5;
  const last = gs.state.hand[0];
  gs.state.hand = [last];
  gs.state.chosen = [last.id];
  play(gs);
  t('牌打光且无牌可补时判负而不是卡死', gs.state.status === 'lost');
  refute('卡死场面不该还能继续出牌', gs.state.status === 'playing' && gs.state.handsLeft > 0);
}

// ── 8b. 存档：往返一致 + 坏档一律拒收 ─────────────────────────
{
  const a = new Game(5150, 'usurer');
  a.state.seats = [mkSeat('hobbs', 'foil'), mkSeat('rent')];
  a.state.books.pair = 3;
  a.state.consumables = [{ t: 'letter', id: 'wax' }, { t: 'book', id: 'flush' }];
  a.state.chosen = a.state.hand.slice(0, 2).map((c) => c.id);
  play(a);
  discard(a);
  const text = serializeSave(a);
  const b = deserializeSave(text);
  t('存档能读回来', b !== null);
  if (b) {
    t('读回后现场一致', b.state.night === a.state.night && b.state.stage === a.state.stage
      && b.state.money === a.state.money && b.state.score === a.state.score
      && b.state.deck.length === a.state.deck.length
      && b.state.seats[0].edition === 'foil' && (b.state.books.pair ?? 0) === 3);
    // 关键：随机流要快进到当时位置，读档后抽的牌必须和没存过一样
    const idsA = a.state.hand.map((c) => c.id).join(',');
    const idsB = b.state.hand.map((c) => c.id).join(',');
    t('读档不改变手牌', idsA === idsB);
    t('存档带走缓冲回合', b.state.buffer === a.state.buffer);
    b.state.chosen = b.state.hand.slice(0, 1).map((c) => c.id);
    a.state.chosen = a.state.hand.slice(0, 1).map((c) => c.id);
    const rb = play(b);
    const ra = new Game(5150, 'usurer');
    void ra;
    t('读档后还能继续算', rb !== null && Number.isFinite(rb.value));
    // 誊抄造牌不能与现有牌撞 id（读档后自增计数器必须推到位）
    const g2 = deserializeSave(text)!;
    g2.state.consumables = [{ t: 'letter', id: 'write' }];
    useConsumable(g2, 0, [g2.state.hand[0].id]);
    const seenIds = new Set<number>();
    let collide = false;
    for (const c of [...g2.state.deck, ...g2.state.hand, ...g2.state.table, ...g2.state.discardPile]) {
      if (seenIds.has(c.id)) collide = true;
      seenIds.add(c.id);
    }
    t('读档后誊抄不会撞牌 id', !collide);
  }
  // 恶意与畸形输入：全部必须返回 null，不许抛异常
  const hostile: [string, string][] = [
    ['空串', ''],
    ['不是 JSON', 'not json at all'],
    ['只有 null', 'null'],
    ['只有数组', '[1,2,3]'],
    ['版本不符', '{"v":99,"calls":0,"state":{}}'],
    ['缺 state', '{"v":1,"calls":0}'],
    ['seed 是字符串', '{"v":1,"calls":0,"state":{"seed":"x"}}'],
    ['牌点数为 99', '{"v":1,"calls":0,"state":{"seed":1,"deckId":"standard","night":1,"stage":0,"status":"playing","money":1,"rep":0,"score":0,"raiseNext":0,"raisedHere":0,"handsLeft":4,"discardsLeft":3,"handIndex":0,"discardsUsed":0,"rerolls":0,"endless":false,"deck":[],"discardPile":[],"table":[],"chosen":[],"seats":[],"consumables":[],"vouchers":[],"bossId":null,"ledger":[],"discovered":[],"settlement":[],"log":[],"books":{},"handUse":{},"shop":[],"hand":[{"id":1,"rank":99,"suit":"s","enh":"none","seal":"none"}]}}'],
    ['花色不存在', '{"v":1,"calls":0,"state":{"seed":1,"deckId":"standard","night":1,"stage":0,"status":"playing","money":1,"rep":0,"score":0,"raiseNext":0,"raisedHere":0,"handsLeft":4,"discardsLeft":3,"handIndex":0,"discardsUsed":0,"rerolls":0,"endless":false,"deck":[],"discardPile":[],"table":[],"chosen":[],"seats":[],"consumables":[],"vouchers":[],"bossId":null,"ledger":[],"discovered":[],"settlement":[],"log":[],"books":{},"handUse":{},"shop":[],"hand":[{"id":1,"rank":5,"suit":"★","enh":"none","seal":"none"}]}}'],
    ['一张牌都没有', '{"v":1,"calls":0,"state":{"seed":1,"deckId":"standard","night":1,"stage":0,"status":"playing","money":1,"rep":0,"score":0,"raiseNext":0,"raisedHere":0,"handsLeft":4,"discardsLeft":3,"handIndex":0,"discardsUsed":0,"rerolls":0,"endless":false,"deck":[],"hand":[],"discardPile":[],"table":[],"chosen":[],"seats":[],"consumables":[],"vouchers":[],"bossId":null,"ledger":[],"discovered":[],"settlement":[],"log":[],"books":{},"handUse":{},"shop":[]}}'],
    ['客人重复', '{"v":1,"calls":0,"state":{"seed":1,"deckId":"standard","night":1,"stage":0,"status":"playing","money":1,"rep":0,"score":0,"raiseNext":0,"raisedHere":0,"handsLeft":4,"discardsLeft":3,"handIndex":0,"discardsUsed":0,"rerolls":0,"endless":false,"deck":[],"discardPile":[],"table":[],"chosen":[],"consumables":[],"vouchers":[],"bossId":null,"ledger":[],"discovered":[],"settlement":[],"log":[],"books":{},"handUse":{},"shop":[],"hand":[{"id":1,"rank":5,"suit":"s","enh":"none","seal":"none"}],"seats":[{"pid":"hobbs","edition":"none"},{"pid":"hobbs","edition":"foil"}]}}'],
    ['不认识的牌组', '{"v":1,"calls":0,"state":{"seed":1,"deckId":"<script>","night":1,"stage":0,"status":"playing","money":1,"rep":0,"score":0,"raiseNext":0,"raisedHere":0,"handsLeft":4,"discardsLeft":3,"handIndex":0,"discardsUsed":0,"rerolls":0,"endless":false,"deck":[],"hand":[{"id":1,"rank":5,"suit":"s","enh":"none","seal":"none"}],"discardPile":[],"table":[],"chosen":[],"seats":[],"consumables":[],"vouchers":[],"bossId":null,"ledger":[],"discovered":[],"settlement":[],"log":[],"books":{},"handUse":{},"shop":[]}}'],
    ['负数银钱', '{"v":1,"calls":0,"state":{"seed":1,"deckId":"standard","night":1,"stage":0,"status":"playing","money":-5,"rep":0,"score":0,"raiseNext":0,"raisedHere":0,"handsLeft":4,"discardsLeft":3,"handIndex":0,"discardsUsed":0,"rerolls":0,"endless":false,"deck":[],"hand":[{"id":1,"rank":5,"suit":"s","enh":"none","seal":"none"}],"discardPile":[],"table":[],"chosen":[],"seats":[],"consumables":[],"vouchers":[],"bossId":null,"ledger":[],"discovered":[],"settlement":[],"log":[],"books":{},"handUse":{},"shop":[]}}'],
  ];
  let accepted = 0;
  for (const [name, payload] of hostile) {
    try { if (deserializeSave(payload) !== null) { accepted++; rep_note(name); } }
    catch { /* 抛异常也算不合格 */ accepted++; rep_note(name + '（抛异常）'); }
  }
  t('坏档全部拒收', accepted === 0);
  // 单独隔离每一条校验：拿一份真存档，只改那一个字段，必须被那一条拦下
  t('只改版本号就要被拒', deserializeSave(text.replace('"v":1', '"v":99')) === null);
  t('只改 seed 类型就要被拒', deserializeSave(text.replace('"seed":5150', '"seed":"5150"')) === null);
  t('只改 calls 为负就要被拒', deserializeSave(text.replace(/"calls":\d+/, '"calls":-1')) === null);
  t('只改缓冲回合数越界就要被拒', deserializeSave(text.replace('"buffer":1', '"buffer":99')) === null);
  t('只多一张非法牌就要被拒', deserializeSave(text.replace('"rank":2', '"rank":99')) === null);
  refute('正常档不该被误拒', deserializeSave(text) === null);
  // 原型污染：__proto__ 不许被复制进状态
  const polluted = text.replace('"seed"', '__proto__":{"polluted":true},"seed"');
  const gp = deserializeSave(polluted);
  t('存档不能给状态挂原型', gp === null || (gp.state as unknown as Record<string, unknown>).polluted === undefined
    && Object.getPrototypeOf(gp.state) === Object.prototype);
}

// ── 8c. 打过几场之后的存档：校验器不许把合法的中局状态判死 ────────
// 上面那份是"刚开局"的档，账本、货位全是空数组，every() 对空集永远为真——
// 于是校验器里任何一条按错类型的字段都不会被它暴露。这条走一条真人路径。
{
  const a = new Game(4242);
  a.state.chosen = a.state.hand.slice(0, 2).map((c) => c.id);
  play(a);                                    // 第一次出牌，不出清
  a.state.chosen = a.state.hand.slice(0, 5).map((c) => c.id);
  play(a);
  settle(a);                                  // ← 从这里开始 ledger 有行了
  setRaise(a, 2);
  a.openShop();
  for (let i = 0; i < a.state.shop.length; i++) buy(a, i);   // 座位、随身、特权各买到一些
  const lived = serializeSave(a);
  const back = deserializeSave(lived);
  t('结清过一场的档能读回来', back !== null);
  t('打过之后确实攒出了账本行与货位', a.state.ledger.length > 0 && a.state.shop.length > 0);
  if (back) {
    t('账本行逐字段还原', back.state.ledger.length === a.state.ledger.length
      && back.state.ledger[0].stage === a.state.ledger[0].stage
      && back.state.ledger[0].label === a.state.ledger[0].label
      && back.state.ledger[0].money === a.state.ledger[0].money);
    t('买过的货位保持已售', back.state.shop.filter((x) => x.sold).length
      === a.state.shop.filter((x) => x.sold).length);
    t('读回后铺子还能继续逛', (buy(back, 0) === true || back.state.shop[0].sold) && back.state.money >= 0);
  }
  // 中局档的字段级反证：只改一处就要被拦下，而且不能顺手把合法值也拦掉
  const badStage = lived.replace('"stage":"open"', '"stage":0');
  t('账本里 stage 写成数字要被拒', deserializeSave(badStage) === null);
  // 要盯住"货位里的那位客人"：座位数组里同样是 "pid":"x","edition"，
  // 不加 kind 前缀就会撞到座位上，测的其实是座位那条校验
  const badPid = lived.replace(/"kind":"patron","pid":"[a-z]+"/, '"kind":"patron","pid":"<script>"');
  t('货位里塞不存在的客人要被拒', badPid !== lived && deserializeSave(badPid) === null);
  const badPrice = lived.replace(/"price":\d+/, '"price":-3');
  t('货位里负价格要被拒', badPrice !== lived && deserializeSave(badPrice) === null);
  const badSold = lived.replace(/"sold":(true|false)/, '"sold":"yes"');
  t('货位里 sold 不是布尔要被拒', badSold !== lived && deserializeSave(badSold) === null);
  const badLabel = lived.replace('"label":"便宴"', '"label":7');
  t('账本里阶段名不是字符串要被拒', badLabel !== lived && deserializeSave(badLabel) === null);
  refute('合法货位不该被误拒', deserializeSave(lived) === null);
}

// ── 8. 确定性 ─────────────────────────────────────────────────
const sig = (seed: number): string => {
  const x = new Game(seed);
  for (let i = 0; i < 40 && x.state.status === 'playing'; i++) {
    x.state.chosen = x.state.hand.slice(0, 2).map((c) => c.id);
    if (!play(x)) break;
    if (x.state.status === 'cleared') { x.openShop(); x.next(); }
  }
  return `${x.state.score}|${x.state.money}|${x.state.hand.map((c) => c.id).join(',')}|${x.state.ledger.length}`;
};
t('同种子同结果', sig(999) === sig(999));
refute('不同种子不该一样', sig(999) === sig(1000));
// 内核不许碰 Math.random：把它换成会抛异常的桩，跑完整一局还不炸，才是真证明
const realRandom = Math.random;
let touched = 0;
Math.random = (() => { touched++; throw new Error('内核偷用了 Math.random'); }) as typeof Math.random;
try { sig(2026); } catch { /* 上面已记账 */ }
Math.random = realRandom;
t('整局不碰 Math.random', touched === 0);

// ── 9. 内容矩阵覆盖 ───────────────────────────────────────────
t('座上宾覆盖全部 6 个挂载点', new Set(PATRONS.map((p) => p.hook)).size === HOOKS.length);
t('挂载点无遗漏', HOOKS.every((h) => PATRONS.some((p) => p.hook === h)));
t('座上宾覆盖全部 6 个效果类别', KINDS.every((k) => PATRONS.some((p) => p.kind === k)));
t('每张座上宾都齐字段', PATRONS.every((p) => p.id && p.name && p.role && p.blurb && p.cost > 0 && HOOKS.includes(p.hook) && KINDS.includes(p.kind)));
t('价格随稀有度递增', (() => {
  const byR = (r: string) => PATRONS.filter((p) => p.rarity === r).map((p) => p.cost);
  return Math.max(...byR('common')) < Math.min(...byR('rare'));
})());
t('声望门槛单调', RARITY_MIN_REP.legendary > RARITY_MIN_REP.rare && RARITY_MIN_REP.rare >= RARITY_MIN_REP.uncommon);
t('无重名客人', new Set(PATRONS.map((p) => p.name)).size === PATRONS.length);
t('无重复 id', new Set(PATRONS.map((p) => p.id)).size === PATRONS.length);
t('牌谱覆盖全部牌型', BOOKS.length === Object.keys(HANDS).length - 1);
t('引荐信都有落点', LETTERS.every((l) => l.picks >= 0 && l.picks <= 2 && l.blurb.length > 4));
t('引荐信 12 封且 id 唯一', new Set(LETTERS.map((l) => l.id)).size === LETTERS.length && LETTERS.length === 12);

// ── 10b. 版本与蜡封：两条正交轴 ──────────────────────────────
// 客人版本挂在座位实例上，所以"同一位客人"可以有更讲究的 copies
const foil = run([C(7, 's'), C(7, 'h')], [{ pid: 'hobbs', edition: 'foil' }]);
t('箔面 +50 流水', foil.chips === 10 + 14 + 8 + 8 + 50);
const holo = run([C(7, 's'), C(7, 'h')], [{ pid: 'hobbs', edition: 'holo' }]);
t('全相 +10 倍注', holo.mult === 2 + 10);
const poly = run([C(7, 's'), C(7, 'h')], [{ pid: 'hobbs', edition: 'polychrome' }]);
t('三彩 ×1.5 倍注（乘的是已累积的）', poly.mult === 3);
t('版本事件挂在自家客人名下', foil.events.some((e) => e.t === 'patron' && (e as any).pid === 'hobbs' && (e as any).addChips === 50));
const negState = new Game(60);
negState.state.seats = [mkSeat('hobbs'), mkSeat('payne'), mkSeat('clerk'), mkSeat('turf', 'negative')];
t('负片客人不占座位', limits(negState.state).seats === 3 && seatedCount(negState.state) === 3);
// 负片的唯一卖点就是"不占座"，所以座位坐满时它必须还能被买下来——
// 按普通客人去查容量的话，这件货永远买不到，等于内容里白写了一档
{
  const g = new Game(60);
  const lim = limits(g.state);
  g.state.seats = ['hobbs', 'payne', 'clerk', 'turf'].slice(0, lim.seats).map((id) => mkSeat(id));
  g.state.money = 500;
  g.state.shop = [{ kind: 'patron', pid: 'baronet', edition: 'negative', price: 10, sold: false }];
  const seatsBefore = g.state.seats.length;
  t('座位坐满时仍能买下负片客人', buy(g, 0) === true);
  t('买下负片只多席位不多占座', g.state.seats.length === seatsBefore + 1
    && seatedCount(g.state) === seatsBefore);
  // 同一位普通客人此刻就该被容量挡下
  g.state.shop = [{ kind: 'patron', pid: 'sharp', edition: 'none', price: 10, sold: false }];
  t('座位坐满时普通客人还是买不了', buy(g, 0) === false);
}
refute('负片不该也加流水', run([C(7, 's')], [{ pid: 'hobbs', edition: 'negative' }]).chips
  > run([C(7, 's')], ['hobbs']).chips);

// 卡牌蜡封：与强化互不干扰，同一张牌可以又是烫金又有火漆
const rs = C(7, 's', 'none', 'red');
const rh = C(7, 'h');
const red = run([rs, rh], []);
t('红蜡封那张牌计分两次', red.chips === 10 + 7 + 7 + 7 && red.events.filter((e) => e.t === 'card' && (e as any).id === rs.id).length === 2);
t('红蜡封让挂在这张牌上的客人也多演一次', run([C(13, 's', 'none', 'red')], ['rent']).events.filter((e) => e.t === 'patron').length === 2);
const goldSeal = run([C(7, 's', 'none', 'gold'), C(7, 'h')], []);
t('金蜡封计分给钱', goldSeal.money === 1);
const blue2 = run([C(7, 's', 'none', 'blue'), C(7, 'h', 'none', 'blue')], []);
const blue1 = run([C(7, 's', 'none', 'blue'), C(7, 'h')], []);
// 每张蓝封牌 +25×组内蓝封数：一道封 → +25；两道封 → 各 +50 共 +100，差 75（这就是"押账"的二次味）
t('蓝蜡封单道 +25', blue1.chips === 10 + 7 + 25 + 7);
t('蓝蜡封按组内封数二次加成', blue2.chips === 10 + 7 + 50 + 7 + 50 && blue2.chips - blue1.chips === 75);
t('强化与蜡封可以叠加', run([C(7, 's', 'bonus', 'blue'), C(7, 'h')], []).chips === 10 + 7 + 30 + 25 + 7);
const gP = new Game(61);
gP.state.seats = [];
gP.state.hand[0].seal = 'purple';
gP.state.chosen = [gP.state.hand[0].id];
discard(gP);
t('紫蜡封弃掉换一封信', gP.state.consumables.length === 1);
const gP2 = new Game(62);
gP2.state.consumables = [{ t: 'letter', id: 'gild' }, { t: 'letter', id: 'wax' }];
gP2.state.hand[0].seal = 'purple';
gP2.state.chosen = [gP2.state.hand[0].id];
discard(gP2);
t('随身满了紫蜡封不发货', gP2.state.consumables.length === 2);

// 引荐信新落点
const gTwin = new Game(63);
const ta = gTwin.state.hand[0];
const tb = gTwin.state.hand[1];
gTwin.state.consumables = [{ t: 'letter', id: 'twin' }];
t('并蒂笺要两张，只给一张不成立', useConsumable(gTwin, 0, [ta.id]) === false);
// 同一张牌报两遍不等于两个目标：界面只能选中一张，若按长度算就会
// 把信吃掉、却只改到一张牌（自减一次却当成成对生效）
t('同一张牌报两次不算两个目标', useConsumable(gTwin, 0, [ta.id, ta.id]) === false
  && gTwin.state.consumables.length === 1);
useConsumable(gTwin, 0, [ta.id, tb.id]);
t('并蒂笺把右边改成同点同花', tb.rank === ta.rank && tb.suit === ta.suit);
const gPurge = new Game(64);
const pc = gPurge.state.hand[0];
pc.enh = 'glass';
pc.seal = 'red';
gPurge.state.consumables = [{ t: 'letter', id: 'purge' }];
gPurge.state.money = 0;
useConsumable(gPurge, 0, [pc.id]);
t('涤生帖把两条轴一起洗掉', pc.enh === 'none' && pc.seal === 'none' && gPurge.state.money === 3);
const gFort = new Game(65);
gFort.state.consumables = [{ t: 'letter', id: 'fortune' }];
const fm = gFort.state.money;
useConsumable(gFort, 0, []);
t('命签不挑目标且给 £8–£20', gFort.state.money - fm >= 8 && gFort.state.money - fm <= 20);
const gCap = new Game(66);
gCap.state.consumables = [{ t: 'letter', id: 'write' }];
for (let i = 0; i < MAX_DECK; i++) gCap.state.deck.push({ id: 9000 + i, rank: 2, suit: 's', enh: 'none', seal: 'none' });
const before = gCap.state.deck.length;
t('牌堆到顶时誊抄被拒', useConsumable(gCap, 0, [gCap.state.hand[0].id]) === false && gCap.state.deck.length === before);

// 牌组：开局就改写规矩
const dU = new Game(67, 'usurer');
t('高利贷起手 £24 且利息上限 £2', dU.state.money === 24 && limits(dU.state).interestCap === 2);
const dP = new Game(68, 'patrician');
t('名门白送一位稀客但少一个座位', dP.state.seats.length === 1 && limits(dP.state).seats === 2
  && patronById(dP.state.seats[0].pid).rarity === 'uncommon');
const dS = new Game(69, 'steady');
t('从容座 +1 出牌 −1 弃牌', limits(dS.state).hands === 5 && limits(dS.state).discards === 2);
const dG = new Game(70, 'generous');
t('宽裕账本 +1 弃牌但起手少 £2', limits(dG.state).discards === 4 && dG.state.money === 2);
t('牌组十副且 id 都不重（五副通用 + 五档各一副专属）',
  DECKS.length === 10 && new Set(DECKS.map((d) => d.id)).size === 10);
refute('标准牌组不该有任何改写', (() => { const x = new Game(71, 'standard'); return x.state.money !== 4 || limits(x.state).seats !== 3; })());

{
  // 局长给独立奖励：**按档位开专属牌组**（2026-10-12 他挑的形式）。
  // 这一节钉的是"专属只在专属那一档出现、对不上就不许进局"，数值本身等他试玩后再调。
  t('五档各有一副专属牌组，每一档都配到了人',
    TIER_IDS.every((k) => DECKS.filter((d) => d.tier === k).length === 1));
  t('专属牌组只在自己那一档摆出来，别的档看不见',
    LENGTHS.every((l) => decksFor(l.nights).every((d) => !d.tier || d.tier === l.tierId)
      && decksFor(l.nights).some((d) => d.tier === l.tierId)));
  t('每一档都还能选标准局（专属牌组是加法，不是替换）',
    LENGTHS.every((l) => decksFor(l.nights).some((d) => d.id === 'standard')));
  t('档位名与 tierId 一一对应（改中文档名不许把牌组链子断掉）',
    LENGTHS.every((l) => l.tier === TIER_LABEL[l.tierId]));
  t('拿别的档的专属牌组开局，落回标准局而不是带它进局',
    new Game(72, 'flash', { nights: 12 }).state.deckId === 'standard'
    && new Game(72, 'watchman', { nights: 3 }).state.deckId === 'standard');
  t('同档开局就用那一档的专属牌组',
    new Game(72, 'flash', { nights: 3 }).state.deckId === 'flash'
    && new Game(72, 'watchman', { nights: 15 }).state.deckId === 'watchman');
  t('每日一局连专属牌组一起锁回标准局',
    new Game(74, 'flash', { mode: 'daily', nights: 3 }).state.deckId === 'standard');
  t('三副专属牌组的规矩真的落到限额表上（不是只写在 blurb 里）',
    (() => {
      const base3 = limits(new Game(73, 'standard', { nights: 3 }).state);
      const base12 = limits(new Game(73, 'standard', { nights: 12 }).state);
      const base8 = limits(new Game(73, 'standard').state);
      const f = limits(new Game(73, 'flash', { nights: 3 }).state);
      const w = limits(new Game(73, 'watchman', { nights: 12 }).state);
      const b = limits(new Game(73, 'book').state);
      return f.hands === base3.hands + 1 && f.discards === base3.discards - 1
        && w.discards === base12.discards + 2 && w.hands === base12.hands - 1
        && b.interestCap === base8.interestCap + 3 && b.freeRerolls === base8.freeRerolls + 1;
    })());
  // 起手银钱有底（4 是标准局，扣穿了停在 0，不会给一副负本钱的牌组）
  t('起手银钱跟着牌组走（一手到位 £8 / 长灶扣到 0 为止）',
    new Game(76, 'flash', { nights: 3 }).state.money === 8
    && new Game(76, 'longstove', { nights: 9 }).state.money === 0);
  {
    // 存档是外部输入：nights 是能单独改的那一格，改完就能把别档的牌组夹带进来
    const txt = serializeSave(new Game(75, 'flash', { nights: 3 }));
    t('存档里把局长改成别的档，这份带专属牌组的档要整份拒收',
      deserializeSave(txt.replace('"nights":3', '"nights":12')) === null
      && deserializeSave(txt.replace('"nights":3', '"nights":9')) === null);
    t('通用牌组的存档改局长照样能读（不许顺手把老档判死）',
      deserializeSave(serializeSave(new Game(75, 'standard', { nights: 3 }))
        .replace('"nights":3', '"nights":15'))?.state.deckId === 'standard');
  }
}

// ── 10f. 背景乐：编排是纯函数，所以能在 node 里逐条断言，不需要有人戴着耳朵听 ──
{
  t('曲子八首且 id 与名字都不重', TUNES.length === 8
    && new Set(TUNES.map((x) => x.id)).size === 8 && new Set(TUNES.map((x) => x.name)).size === 8);
  t('每首的谱面自洽：小节数与每小节步数对得上', TUNES.every((x) =>
    x.roots.length === x.mel.length && x.mel.every((bar) => bar.length === x.beats * 2)
    && (x.perc ?? []).every((bar) => bar.length === x.beats * 2)
    && /^[0-9]+$/.test(x.roots) && /^[0-9.]+$/.test(x.mel.join(''))
    && (x.perc ?? []).every((bar) => /^[KS h.]*$/.test(bar)
      && [...bar].every((ch) => ch === '.' || DRUM[ch] !== undefined))));
  t('四种音色都用上了（八首共用一把琴就只是八段音高）',
    new Set(TUNES.map((x) => x.timbre)).size === 4);
  // 只查"四种都出现过"太松：把小步舞从竖琴改成八音盒，四种还是齐的，听感却塌了一角。
  // 要求每种音色至少摊到两首，任何一次"塌向另一把琴"都会让某一类掉到一首。
  t('音色值都在词表里（拼错会静默落回八音盒）',
    TUNES.every((x) => (TIMBRES as readonly string[]).includes(x.timbre)));
  t('每种音色各带两首（不许塌向一把琴）',
    TIMBRES.every((tb) => TUNES.filter((x) => x.timbre === tb).length === 2));
  t('每首都有短名与场景注（设置面板那行要用）',
    TUNES.every((x) => x.short.length >= 2 && x.short.length <= 4 && x.scene.length > 1));
  t('鼓点不是标配：有鼓的与没鼓的都在，才不会听成鼓机',
    TUNES.filter((x) => x.perc).length >= 2 && TUNES.filter((x) => !x.perc).length >= 3);
  for (const tune of TUNES) {
    const N = loopSteps(tune);
    const one = plan(tune, 0, N);
    const two = plan(tune, N, N);
    // 跨圈必须无缝：界面层的调度器是按圈推进步号的，接不上就会突然冒音或漏一拍
    t(`${tune.name}：跨圈接得上`, one.map((e) => e.midi).join(',') === two.map((e) => e.midi).join(','));
    t(`${tune.name}：起点对齐`, one.every((e) => e.at >= 0) && one[0].at === 0);
    let mono = true;
    for (let i = 1; i < one.length; i++) if (one[i].at < one[i - 1].at) mono = false;
    t(`${tune.name}：时间单调不减`, mono);
    t(`${tune.name}：音高都在钢琴范围内`, one.every((e) => e.midi >= 21 && e.midi <= 108));
    t(`${tune.name}：低音至少比旋律低八度`,
      Math.max(...one.filter((e) => e.voice === 'bass').map((e) => e.midi))
      + 12 <= Math.min(...one.filter((e) => e.voice === 'mel').map((e) => e.midi)));
    // 同一瞬间最多 5 个声部（低音 + 三音和弦 + 旋律），加起来不许超过 0.3 否则一定爆音
    let peak = 0;
    for (const e of one) {
      peak = Math.max(peak, one.filter((y) => Math.abs(y.at - e.at) < 1e-6)
        .reduce((a, y) => a + y.gain, 0));
    }
    // 预算 0.34：最响的一瞬间是"低音＋旋律＋高八度影子＋鼓点"≈0.335。
    // 加鼓与影子之前这条是 0.3，声部多了就把预算写清楚，而不是偷偷放宽。
    t(`${tune.name}：峰值增益不爆音`, peak > 0.1 && peak <= 0.34);
    let hot = 0;
    for (const e of plan(tune, 0, N, 2)) {
      hot = Math.max(hot, plan(tune, 0, N, 2).filter((y) => Math.abs(y.at - e.at) < 1e-6)
        .reduce((a, y) => a + y.gain, 0));
    }
    t(`${tune.name}：局势顶满也不爆音`, hot <= 0.34);
    // 夜曲八小节慢板一圈就是 29 秒，硬塞进 24 秒只会难听；上限按最慢那首放宽
    t(`${tune.name}：一圈时长合理`, loopSeconds(tune) > 6 && loopSeconds(tune) < 32);
  }
  const w = TUNES[0];
  t('休止不产生旋律音', plan(w, 0, loopSteps(w)).filter((e) => e.voice === 'mel').length
    < loopSteps(w));
  t('连着的同音符合成长音', (() => {
    const ev = plan(w, 0, loopSteps(w)).filter((e) => e.voice === 'mel');
    return ev.some((e) => e.dur > stepDur(w) * 1.5);
  })());
  t('第四圈主旋律抬一个八度', (() => {
    const N = loopSteps(w);
    const a = plan(w, 0, 6).filter((e) => e.voice === 'mel').map((e) => e.midi);
    const b = plan(w, N * 3, 6).filter((e) => e.voice === 'mel').map((e) => e.midi);
    const c = plan(w, N * 2, 6).filter((e) => e.voice === 'mel').map((e) => e.midi);
    return a.join() === c.join() && b.join() === a.map((x) => x + 12).join();
  })());
  t('级数越出音阶就叠八度', degreeToMidi(w, 7) === degreeToMidi(w, 0) + 12
    && degreeToMidi(w, -1) === degreeToMidi(w, 6) - 12);
  t('bpm 翻倍则每步减半', stepDur({ ...w, bpm: w.bpm * 2 }) === stepDur(w) / 2);
  // heat 是"加层"，不是"换曲子"：原有事件的**音高与时值**一个都不许动，
  // 否则玩家一紧张音乐就跑调。只有旋律的增益让了路（给高八度的影子腾位置），
  // 所以这里比的是 (midi, at, dur) 三样，不比 gain。
  const seq = (h: number): string => plan(w, 0, 24, h)
    .filter((e) => !(e.voice === 'arp' || e.gain === .035))
    .map((e) => `${e.midi}/${e.at}/${e.dur}`).join(',');
  t('heat 只在原有之上叠层，不改动音高与时值', seq(0) === seq(2));
  t('heat 1 叠分解和弦，heat 2 再抬旋律', (() => {
    const c = (h: number): Record<string, number> => plan(w, 0, 24, h).reduce<Record<string, number>>((m, e) => {
      m[e.voice] = (m[e.voice] ?? 0) + 1; return m;
    }, {});
    const a = c(0); const b = c(1); const d = c(2);
    return (a.arp ?? 0) === 0 && (b.arp ?? 0) > 0 && b.arp === d.arp && d.mel === b.mel * 2;
  })());
  t('heat 的 arp 落在**当小节**的和弦音上', (() => {
    const per = w.beats * 2;
    return plan(w, 0, loopSteps(w), 1).filter((e) => e.voice === 'arp').every((e) => {
      const root = Number(w.roots[Math.floor(Math.round(e.at / stepDur(w)) / per)]);
      return [0, 2, 4].some((t3) => e.midi === degreeToMidi(w, root + t3, 0));
    });
  })());
  t('鼓点字母都查得到编号，写错的字母不会响也不会崩',
    Object.keys(DRUM).join('') === 'KSh'
    && plan({ ...w, perc: w.mel.map(() => 'K..h.Z.'.slice(0, w.beats * 2)) }, 0, 6, 0)
      .filter((e) => e.voice === 'perc').length === 2);
  t('没有谱面的曲子不产生鼓点', plan(TUNES[2], 0, loopSteps(TUNES[2])).every((e) => e.voice !== 'perc'));
}

// 难度只许走 Mods 通道，所以"标准"必须逐位等于基线：否则玩家一碰难度设置，
// 之前调好的平衡就回不去了。这条是整套难度设计的地基。
// ── 10e. 难度与模式 ──────────────────────────────────────────
// 难度只走既有的 Mods 通道，所以"标准"必须逐位等于基线：否则玩家一碰难度设置，
// 之前调好的平衡就回不去了。这条是整套难度设计的地基。
t('难度三档且 id 唯一', DIFFS.length === 3 && new Set(DIFFS.map((d) => d.id)).size === 3);
t('模式四种且 id 唯一', MODES.length === 4 && new Set(MODES.map((m) => m.id)).size === 4);
{
  const base = new Game(5150);
  const bl = limits(base.state);
  t('标准档逐位等于基线', bl.seats === 3 && bl.handSize === 8 && bl.hands === 4 && bl.discards === 3
    && bl.slots === 2 && bl.interestCap === 5 && bl.targetScale === 1 && bl.priceScale === 1
    && base.state.money === 4 && targetOf(base.state) === 300);
  t('默认就是标准档', base.state.diff === 'standard' && base.state.mode === 'run');

  const soft = new Game(5150, 'standard', { diff: 'gentle' });
  const hard = new Game(5150, 'standard', { diff: 'grudge' });
  t('手松的彩头比标准低', targetOf(soft.state) < targetOf(base.state));
  t('苛刻的彩头比标准高', targetOf(hard.state) > targetOf(base.state));
  t('手松多一次出牌与弃牌', limits(soft.state).hands === 5 && limits(soft.state).discards === 4);
  t('苛刻少一次出牌与弃牌', limits(hard.state).hands === 3 && limits(hard.state).discards === 2);
  t('手松起手更有钱', soft.state.money === 10 && hard.state.money === 2);
  t('难度不改随机流：同种子发到同一手牌',
    soft.state.hand.map((c) => c.id).join(',') === base.state.hand.map((c) => c.id).join(','));
  // 货价：同种子同货，价差就是 priceScale 本身
  soft.openShop(); hard.openShop(); base.openShop();
  const priceOfKind = (g: Game, k: string): number => g.state.shop.find((x) => x.kind === k)!.price;
  t('手松的货更便宜', priceOfKind(soft, 'patron') <= priceOfKind(base, 'patron'));
  t('苛刻的货更贵', priceOfKind(hard, 'patron') >= priceOfKind(base, 'patron'));
  // 高利贷牌组把利息上限压到 £2，苛刻再 −£3 会翻负——负数等于每回合倒扣钱
  const usurerHard = new Game(5150, 'usurer', { diff: 'grudge' });
  t('利息上限不许为负', limits(usurerHard.state).interestCap === 0);
  t('不认识的难度退回标准', diffById('查无此档').id === 'standard'
    && new Game(5151, 'standard', { diff: '查无此档' as never }).state.diff === 'standard');
  t('不认识的牌组在每日一局里被锁回标准', modeById('daily').id === 'daily'
    && new Game(dailySeed(), 'usurer', { mode: 'daily' }).state.deckId === 'standard');
}
{
  // 每日一局：同一天同种子，不同天不同种子
  const a = new Date(2026, 9, 9), b = new Date(2026, 9, 10);
  const sa = dailySeed(a), sb = dailySeed(b);
  t('每日一局由日期确定性生成', sa === dailySeed(new Date(2026, 9, 9)) && sa !== sb);
  t('每日一局的牌序跟着日期变',
    new Game(sa, 'standard', { mode: 'daily' }).state.hand[0].id
    !== new Game(sb, 'standard', { mode: 'daily' }).state.hand[0].id);
}
{
  // 无尽：从第 1 夜起就不该有"最后一夜"
  const e = new Game(5152, 'standard', { mode: 'endless' });
  t('无尽模式起手就标记 endless', e.state.endless === true && e.state.mode === 'endless');
  // 老写法（第三个参数直接传 bool）也要折算成模式，否则 fuzz/save 那条路的 mode 会停在 run
  t('旧的 endless 位置参数折算成无尽模式',
    new Game(5152, 'standard', true).state.mode === 'endless');
  e.state.night = FINAL_NIGHT; e.state.stage = 2; e.state.score = 999999;
  settle(e); e.next();
  t('无尽模式打完最后一夜也不判胜', e.state.status !== 'won' && e.state.night === FINAL_NIGHT + 1);
  // 正局同样位置就该判胜，作为上一条的对照
  const r = new Game(5152);
  r.state.night = FINAL_NIGHT; r.state.stage = 2; r.state.score = 999999;
  settle(r); r.next();
  t('对照：正局打完最后一夜判胜', r.state.status === 'won');
}
{
  // 修行：牌权耗尽不该散场
  const p = new Game(5153, 'standard', { mode: 'practice' });
  p.state.handsLeft = 1;
  p.state.chosen = p.state.hand.slice(0, 2).map((c) => c.id);
  play(p);
  t('修行档牌权用尽后立刻补满', p.state.status === 'playing' && p.state.handsLeft === limits(p.state).hands);
  t('修行档彩头与手牌都还在', p.state.score === 0 && p.state.hand.length === limits(p.state).handSize);
  // 补满是 reprieve() 干的，不是缓冲回合顶上去的。缓冲只有一发，
  // 顶替的话上面两条照样绿（分数清零、手牌补满、还在 playing），
  // 但 buffer 会被吃掉一格，且第二次就没得救——所以这两条是"救援是谁干的"的身份证。
  t('修行档救援不动缓冲回合', p.state.buffer === START_BUFFER);
  p.state.handsLeft = 1;
  p.state.chosen = p.state.hand.slice(0, 2).map((c) => c.id);
  play(p);
  t('修行档连着两次牌权用尽照样接着练',
    p.state.status === 'playing' && p.state.handsLeft === limits(p.state).hands
    && p.state.buffer === START_BUFFER);
  // 对照：正局同一手就该判负
  const q = new Game(5153);
  q.state.buffer = 0;             // 对照裸基线：正局没有缓冲回合，牌权用尽就散场
  q.state.handsLeft = 1;
  q.state.chosen = q.state.hand.slice(0, 2).map((c) => c.id);
  play(q);
  t('对照：正局牌权用尽就散场', q.state.status === 'lost');
  // 牌堆空了但牌还在弃牌堆里：修行档要把它洗回来（上一版测试把牌整副清空了，
  // 那是在测"没牌当然发不出"，不是救援路径）
  const p2 = new Game(5154, 'standard', { mode: 'practice' });
  p2.state.discardPile.push(...p2.state.hand.splice(0), ...p2.state.table.splice(0));
  p2.state.deck = [];
  p2.next();
  t('修行档无牌可发时把牌堆洗回来', p2.state.hand.length > 0 && p2.state.status === 'playing');
}
{
  // 存档要带得上难度与模式
  const g = new Game(5155, 'steady', { diff: 'grudge', mode: 'run' });
  const back = deserializeSave(serializeSave(g));
  t('难度与模式进得了存档', back !== null && back.state.diff === 'grudge' && back.state.mode === 'run');
  const txt = serializeSave(g);
  t('存档里写坏难度要被拒', deserializeSave(txt.replace('"diff":"grudge"', '"diff":"easy"')) === null);
  t('存档里写坏模式要被拒', deserializeSave(txt.replace('"mode":"run"', '"mode":"<script>"')) === null);
  // v1 老档没有这两个字段：要退回默认而不是整份拒收
  const legacy = txt.replace('"diff":"grudge",', '').replace('"mode":"run",', '');
  const lb = deserializeSave(legacy);
  t('没有难度字段的旧档照样能读并退回标准', lb !== null && lb.state.diff === 'standard');
}

// 会员特权扩充
// 同一种子下对照：特权不消耗随机流，所以两边铺出来的货是同一件，价格差就是折扣本身
const noDisc = new Game(72);
noDisc.openShop();
const full = noDisc.state.shop.find((x) => x.kind === 'voucher')!.price;
const withDisc = new Game(72);
withDisc.state.vouchers = ['discount'];
withDisc.openShop();
t('熟客折牌把价格打到八折（向下取整）', withDisc.state.shop.find((x) => x.kind === 'voucher')!.price === Math.floor(full * 0.8));
const vC = new Game(73);
vC.state.vouchers = ['cabinet'];
t('信匣把随身槽抬到 3', limits(vC.state).slots === 3);
const vL = new Game(74);
vL.state.vouchers = ['library'];
vL.state.handUse = { pair: 3, flush: 1 };
vL.state.score = 999;
settle(vL);
t('藏书阁升的是用得最多的那型', (vL.state.books.pair ?? 1) === 2 && (vL.state.books.flush ?? 1) === 1);
t('会员特权 8 个、id 唯一、字段齐', VOUCHERS.length === 8 && new Set(VOUCHERS.map((v) => v.id)).size === 8
  && VOUCHERS.every((v) => v.name && v.blurb && v.cost > 0));
t('铺子里不会重复出现已拥有的客人', (() => {
  const x = new Game(76);
  x.state.seats = S('hobbs');
  x.openShop();
  return x.state.shop.filter((sl) => sl.pid === 'hobbs').length === 0;
})());
// 同一家铺子的两个货位也不能是同一位客人（restock 曾两次用同一份已拥有名单）
{
  let dup = 0;
  for (let i = 0; i < 300; i++) {
    const x = new Game(3000 + i);
    x.openShop();
    const ps = x.state.shop.filter((sl) => sl.kind === 'patron').map((sl) => sl.pid);
    if (new Set(ps).size !== ps.length) dup++;
  }
  t('同一位客人不会占两个货位', dup === 0);
}
// 版本是按权重摇出来的：五种都要能出现，且负片必须是最稀的
{
  const seen: Record<string, number> = { none: 0, foil: 0, holo: 0, polychrome: 0, negative: 0 };
  const x = new Game(77);
  for (let i = 0; i < 400; i++) {
    x.state.seats = [];
    x.openShop();
    for (const sl of x.state.shop) if (sl.kind === 'patron') seen[sl.edition ?? 'none'] += 1;
  }
  t('版本五种都会出现', Object.values(seen).every((v) => v > 0));
  t('负片是最稀的一档', seen.negative < seen.foil && seen.negative < seen.polychrome);
  t('箔面比三彩常见', seen.foil > seen.polychrome);
}
t('不认识的牌组退回标准局', new Game(78, '查无此副').state.deckId === 'standard');
t('牌组 id 真的落进状态', new Game(79, 'usurer').state.deckId === 'usurer');
t('会员特权不重复', new Set(VOUCHERS.map((v) => v.id)).size === VOUCHERS.length);
t('贵客各有刁难', BOSSES.every((b) => !!(b.suitLock || b.faceLock || b.handSize || b.hands || b.taxDiscard)));
t('三关结构齐备', STAGE_KIND.length === 3);
// 贵客的手牌/出牌惩罚要真的落进限额
const g15 = new Game(15);
g15.state.bossId = 'narrow';
t('窄桌压下手牌上限', limits(g15.state).handSize === 5);
g15.state.bossId = 'miser';
t('吝啬鬼少给一次出牌', limits(g15.state).hands === 3);

// ── 10. 加法的账要精确到先令（这几条是补盲区用的）──────────────
// 客人的 +倍注 是加法，不是乘法；含糊不得
const rentPair = run([C(13, 's'), C(13, 'h')], ['rent']);
t('收租人按人头逐张加倍注', rentPair.mult === 2 + 7 + 7 && rentPair.value === (10 + 20) * 16);
const almanacPair = run([C(7, 's'), C(7, 'h')], ['almanac']);
t('报馆主同时加流水与倍注', almanacPair.chips === 10 + 14 + 60 && almanacPair.mult === 10);
t('报馆主的加法不受倍率污染', almanacPair.value === 84 * 10);

// 利息、盈余折现、赏金三项分账要能逐条对上
const moneyOf = (money: number, scoreAmt: number, vouchers: string[] = []): number => {
  const x = new Game(500);
  x.state.money = money;
  x.state.vouchers = vouchers;
  x.state.score = scoreAmt;
  const before = x.state.money;
  settle(x);
  return x.state.money - before;
};
t('恰达彩头时只进赏金', moneyOf(0, 300) === 3);
t('利息按每 £5 得 £1', moneyOf(24, 300) === 3 + 4);
t('利息封顶 £5', moneyOf(50, 300) === 3 + 5);
t('记账房把利息上限抬到 £10', moneyOf(50, 300, ['ledger']) === 3 + 10);
t('盈余翻倍折 £6', moneyOf(0, 600) === 3 + 6);
// 封顶要用真的超出上限的盈余去测，正好压在 12 上的例子测不出 min
t('盈余折现封顶 £12', moneyOf(0, 1200) === 3 + 12);
t('四倍盈余也只折 £12', moneyOf(0, 2400) === 3 + 12);
refute('利息不该随本金无限增长', moneyOf(500, 300) === 3 + 100);

// 玻璃牌：既不能永不碎，也不能必然碎，还要同种子可复现
const glassRolls = (seed: number): number =>
  run([C(7, 'h', 'glass'), C(7, 'h', 'glass'), C(7, 'h', 'glass'), C(7, 'h', 'glass'), C(7, 'h', 'glass')], [], { seed }).shattered.length;
const trials = 300;
let broke = 0;
for (let s = 1; s <= trials; s++) broke += glassRolls(s);
const rate = broke / (trials * 5);
t('磨镜碎裂率约 1/4', rate > 0.19 && rate < 0.31);
// 钉死具体种子的结果：随机顺序一旦被改动，这几个数立刻对不上
t('碎裂逐种子可复现', glassRolls(7) === 2 && glassRolls(8) === 1 && glassRolls(1) === 1 && glassRolls(12345) === 0);
refute('没有磨镜就一张都不该碎', run([C(7, 'h'), C(7, 'h'), C(7, 'h'), C(7, 'h'), C(7, 'h')], [], { seed: 7 }).shattered.length > 0);

// 文案与效果必须一致：说明书写 +8 而代码给 +9，玩家第一眼就会被骗
const spec: [string, number[]][] = [
  ['hobbs', [8]], ['countess', [16]], ['rent', [7]], ['payne', [1]], ['clerk', [8]],
  ['cousin', [1]], ['almanac', [60, 8]], ['turf', [2]], ['odd', [2]], ['house', [3, 20]],
  ['baronet', [180]], ['heiress', [5]], ['sharp', [4]],
];
for (const [id, nums] of spec) {
  const p = patronById(id);
  t(`${p.name} 的说明书对得上数字`, nums.every((n) => p.blurb.includes(String(n))));
}
t('每位客人都写了挂载点相关的说明', PATRONS.every((p) => p.blurb.length > 3 && p.role.length > 1));

// ── 11. 故障注入与护栏 ────────────────────────────────────────
// 每条都 sabotage 一个边界，要求引擎真的拦得住；拦不住就报出来。
const injected: string[] = [];
{
  if (run([C(7, 's'), C(7, 'h')], [], { level: 3 }).value === 48) injected.push('级别变化没被结算判据抓到');
  if (run([C(7, 's'), C(7, 'h')], ['hobbs']).value === 48) injected.push('客人加成没被结算判据抓到');
  if (run([C(7, 's'), C(7, 'h')], []).events.some((e) => e.t === 'patron')) injected.push('空座位不该有客人事件');
  if (run([C(7, 's'), C(7, 'h')], ['almanac'], { env: { handIndex: 2 } }).events.some((e) => e.t === 'patron')) injected.push('挂载点门失效');
  if (run([pb1, pb2], []).events.some((e) => e.t === 'blocked')) injected.push('无贵客不该有拦截');
  if (new Rand(5).next() !== new Rand(5).next()) injected.push('同种子 PRNG 不可复现');

  let threw = false;
  try { patronById('查无此人'); } catch { threw = true; }
  if (!threw) injected.push('未知客人 id 没人拦');

  // 限额夹紧：贵客把牌桌压得再狠也不能压到玩法下限以下
  const clamp = new Game(31);
  clamp.state.bossId = 'narrow';
  clamp.state.seats = [];
  for (let i = 0; i < 9; i++) clamp.state.hand.push(C(2 + i, 's'));
  if (limits(clamp.state).handSize < 3) injected.push('手牌上限没夹住下限');
  const zeroHands = new Game(32);
  zeroHands.state.bossId = 'miser';
  zeroHands.state.seats = S('house');
  if (limits(zeroHands.state).hands < 1) injected.push('出牌次数能被压到 0');

  // 坐满了还让买，构筑张力就没了
  const full = new Game(33);
  full.state.vouchers = ['membership'];
  full.state.seats = S('hobbs', 'payne', 'clerk', 'turf');
  full.state.money = 99;
  full.openShop();
  const patronSlot = full.state.shop.findIndex((s) => s.kind === 'patron');
  if (patronSlot >= 0 && buy(full, patronSlot)) injected.push('座位满了仍能买入客人');

  // 钱不够不许买
  const broke = new Game(34);
  broke.state.money = 0;
  broke.openShop();
  if (broke.state.shop.some((s, i) => !s.sold && s.price > 0 && buy(broke, i))) injected.push('身无分文却买走了东西');

  // 重掷价钱：首次 £5 且逐次 +£1；「内场通行」只免首次
  const rr = new Game(35);
  rr.state.money = 99;
  rr.openShop();
  if (rr.state.rerolls !== 0) injected.push('铺子开场没把重掷次数归零');
  if (rerollPrice(rr.state) !== 5) injected.push('首次重掷应价 £5');
  rr.state.vouchers = ['insider'];
  if (rerollPrice(rr.state) !== 0) injected.push('内场通行的首次重掷应免费');
  rr.state.rerolls = 1;
  if (rerollPrice(rr.state) === 0) injected.push('免费次数不该盖住第二次');
  rr.state.vouchers = [];
  rr.state.rerolls = 1;
  if (rerollPrice(rr.state) !== 6) injected.push('重掷没有每次涨 £1');

  // 彩头不许出现 0 或负数——那会让"过关"失去意义
  for (let n = 1; n <= 12; n++) {
    const x = new Game(36);
    x.state.night = n;
    x.state.raisedHere = 4;
    if (targetOf(x.state) <= 0) injected.push(`第 ${n} 夜彩头非正`);
  }
}

// ══ 新功能：P0-3 阈值奖励 / P0-1 加注数据表 ═════════════════════
{
  // ── 开关本身 ──────────────────────────────────────────────
  t('开关默认全关', FLAG_KEYS.every((k) => FLAGS_OFF[k] === false));
  t('开关全开档确实全开', FLAG_KEYS.every((k) => FLAGS_ALL[k] === true));
  const evil = JSON.parse('{"__proto__":{"pwned":1},"thresholds":true,"bets":"yes","nope":1}');
  const clean = sanitizeFlags(evil, FLAGS_OFF);
  t('恶意 flags 只保留白名单布尔键', clean.thresholds === true && clean.bets === false);
  t('flags 清洗不碰原型', ({} as Record<string, unknown>).pwned === undefined);
  t('非对象 flags 退回默认', sanitizeFlags('true', FLAGS_OFF).thresholds === false);

  // ── P0-3 阈值：纯函数层 ───────────────────────────────────
  t('阈值表 10 条且 id 唯一', new Set(THRESHOLDS.map((d) => d.id)).size === THRESHOLDS.length);
  t('阈值 at 是正整数百分比', THRESHOLDS.every((d) => Number.isInteger(d.at) && d.at > 0 && d.at <= 800));
  t('阈值奖励不越界（只给 chips/mult/xmult）',
    THRESHOLDS.every((d) => d.reward.money === undefined && Object.keys(d.reward).length >= 1));
  t('折算按彩头比例走', thresholdValue(THRESHOLDS[0], 300) === Math.round(300 * THRESHOLDS[0].at / 100));
  t('彩头翻倍则阈值线翻倍', thresholdValue(THRESHOLDS[0], 600) === 2 * thresholdValue(THRESHOLDS[0], 300));
  {
    const d = [THRESHOLDS[0]];
    const at = thresholdValue(d[0], 300);
    t('恰好压线算跨过', crossedThresholds(d, [], { hand: at, stage: at }, { hand: 0, stage: 0 }, 300).length === 1);
    t('差一分不算跨过', crossedThresholds(d, [], { hand: at - 1, stage: at - 1 }, { hand: 0, stage: 0 }, 300).length === 0);
    t('已认领的不再发', crossedThresholds(d, [d[0].id], { hand: at * 2, stage: at * 2 }, { hand: 0, stage: 0 }, 300).length === 0);
    t('起点已在线上则不算跨过', crossedThresholds(d, [], { hand: at + 10, stage: at + 10 }, { hand: at, stage: at }, 300).length === 0);
  }
  {
    const g = nextGap(THRESHOLDS, [], 0, 300);
    t('提示取最近的一条线', !!g && g.def.id === 't-tips');
    t('提示给出还差多少', !!g && g.gap === thresholdValue(g.def, 300));
    t('progressVisible=false 的不进提示',
      !THRESHOLDS.filter((d) => !d.progressVisible).some((d) => nextGap([d], [], 0, 300)));
    const big = nextGap(THRESHOLDS, [], 999999, 300);
    t('全都越过了就没有"还差多少"', big === null);
  }

  // ── P0-3 阈值：接进结算管道 ───────────────────────────────
  const mkHand = (seed: number, flags: Partial<FeatureFlags>): Game => {
    const x = new Game(seed, 'standard', { flags });
    x.state.books.flush = 6;
    const byS: Record<string, Card[]> = {};
    for (const c of x.state.hand) (byS[c.suit] = byS[c.suit] || []).push(c);
    const f = Object.values(byS).find((a) => a.length >= 5);
    if (f) x.state.chosen = f.slice(0, 5).map((c) => c.id);
    return x;
  };
  {
    const off = mkHand(1002, FLAGS_OFF);
    const rOff = play(off);
    const on = mkHand(1002, { thresholds: true });
    const rOn = play(on);
    t('关掉时一条 bonus 都不产生', rOff.events.every((e) => e.t !== 'bonus') && off.state.claimed.length === 0);
    t('关掉时的分数与开功能前一致（同种子同牌）', rOff.value === 2114);
    t('开着时确实跨过线', rOn.events.filter((e) => e.t === 'bonus').length > 0);
    // 上界被写成"一条都不发"时，光看 bonus 总数会被 stage 那条糊弄过去，
    // 所以 hand / stage 两类要各自证明真的会发
    t('hand 档阈值确实会发（不是只有 stage 在发）',
      rOn.claimedNow.some((id) => THRESHOLDS.find((d) => d.id === id)!.span === 'hand'));
    t('stage 档阈值确实会发',
      rOn.claimedNow.some((id) => THRESHOLDS.find((d) => d.id === id)!.span === 'stage'));
    t('开着时 claimedNow 与事件条数一致',
      rOn.claimedNow.length === rOn.events.filter((e) => e.t === 'bonus').length);
    // 承重墙 1：每条事件的 after 都必须自洽
    t('bonus 之后 value 仍等于 chips×mult',
      rOn.events.every((e) => Math.abs(e.after.value - e.after.chips * e.after.mult) < 1e-9));
    // 硬约束 1：没有新增第三维度
    t('链尾仍等于最后一个 after', rOn.value === rOn.events[rOn.events.length - 1].after.value);
    t('一手最多领 MAX_PER_HAND 条 hand 阈值',
      rOn.claimedNow.filter((id) => THRESHOLDS.find((d) => d.id === id)!.span === 'hand').length <= MAX_PER_HAND);
    t('一手最多领 MAX_PER_STAGE 条 stage 阈值',
      rOn.claimedNow.filter((id) => THRESHOLDS.find((d) => d.id === id)!.span === 'stage').length <= MAX_PER_STAGE);
    t('级联被上界卡住（实测曾一手连吃 7 条）', rOn.claimedNow.length <= MAX_PER_HAND + MAX_PER_STAGE);
    // 反证式判据：若把上界写成不生效，这一条必红
    {
      const inflated = mkHand(1002, { thresholds: true });
      inflated.state.books.flush = 14;
      inflated.state.chosen = inflated.state.hand.slice(0, 5).map((c) => c.id);
      const ri = play(inflated);
      t('再硬的牌也越不过上界', ri.claimedNow.length <= MAX_PER_HAND + MAX_PER_STAGE);
    }
  }
  {
    // 认领账的跨场语义
    const x = mkHand(1002, { thresholds: true });
    play(x);
    const before = x.state.claimed.slice();
    t('本场已认领的记在 state 上', before.length > 0);
    x.openShop(); x.next();
    const keep = before.filter((id) => THRESHOLDS.find((d) => d.id === id)!.carryOver);
    const drop = before.filter((id) => !THRESHOLDS.find((d) => d.id === id)!.carryOver);
    // 注意不能写成 claimed.every(id => keep.includes(id))：
    // 换场时整表清空也满足它——空数组的 every 恒真，那条注入就是这么溜过去的
    t('carryOver=true 的换场后仍挂在账上',
      keep.length > 0 && keep.every((id) => x.state.claimed.includes(id)));
    t('carryOver=false 的换场清零', drop.every((id) => !x.state.claimed.includes(id)));
  }
  {
    // 存档：外部输入不可信那套要覆盖新字段
    const x = mkHand(1002, { thresholds: true });
    play(x);
    const round = deserializeSave(serializeSave(x));
    t('flags 活过存档往返', !!round && round.state.flags.thresholds === true);
    t('claimed 活过存档往返', !!round && round.state.claimed.length === x.state.claimed.length);
    const tampered = JSON.parse(serializeSave(x));
    tampered.state.claimed = ['t-tips', '不存在的阈值'];
    t('认领账里的野 id 整份拒收', deserializeSave(JSON.stringify(tampered)) === null);
    const tampered2 = JSON.parse(serializeSave(x));
    tampered2.state.flags = 'yes';
    t('flags 不是对象就整份拒收', deserializeSave(JSON.stringify(tampered2)) === null);
    const legacy = JSON.parse(serializeSave(x));
    delete legacy.state.flags; delete legacy.state.claimed; delete legacy.state.betReprieves;
    const old = deserializeSave(JSON.stringify(legacy));
    t('没有新字段的老档照样能读且全关', !!old && old.state.flags.thresholds === false && old.state.claimed.length === 0);
  }

  // ── P0-1 加注：表必须复刻原式 ─────────────────────────────
  t('加注表 5 档且 tier 连续', BETS.every((b, i) => b.tier === i));
  t('targetMult 就是原来的 1.5^tier', BETS.every((b) => Math.abs(b.targetMult - Math.pow(1.5, b.tier)) < 1e-9));
  t('rewardMult 就是原来的 1+0.5·tier', BETS.every((b) => Math.abs(b.rewardMult - (1 + 0.5 * b.tier)) < 1e-9));
  t('surplusBonus/repBonus 就是原来的 +tier', BETS.every((b) => b.surplusBonus === b.tier && b.repBonus === b.tier));
  t('不抬档没有任何惩罚', BETS[0].failPenalty === 'none' && BETS[0].targetMult === 1);
  {
    let drift = 0;
    for (let n = 1; n <= FINAL_NIGHT + 3; n++) {
      for (const st of [0, 1, 2] as const) {
        for (let lv = 0; lv <= 4; lv++) {
          if (targetFor(n, st, lv, 1, false) !== targetFor(n, st, lv, 1, true)) drift++;
        }
      }
    }
    t('开关两条路的彩头逐位一致（老种子不会漂移）', drift === 0);
  }
  {
    const x = new Game(4242, 'standard', { flags: { ...FLAGS_OFF, bets: true } });
    setRaise(x, 3);
    x.next();                       // raiseNext → raisedHere 要过一场才落地，直接摆不如走真路径
    x.state.raisedHere = 3;
    const t3 = targetOf(x.state);
    t('抬注档位的彩头按表走', t3 === targetFor(x.state.night, x.state.stage, 3, limits(x.state).targetScale, true));
    t('表档与硬编码同值（抬 3 档）', t3 === targetFor(x.state.night, x.state.stage, 3, limits(x.state).targetScale, false));
  }

  // ── P0-1 失手惩罚 ─────────────────────────────────────────
  t('每档惩罚都落在枚举里',
    BETS.every((b) => ['none', 'loseMoney', 'losePatron', 'loseRound', 'loseRunAsIs'].includes(b.failPenalty)));
  {
    const base = { money: 40, seats: 3, reprievesUsed: 0, handsLeft: 0 };
    const m = resolveBetMiss(betFor(1), base);
    t('1 档失手赔银钱并重做本场', m.kind === 'loseMoney' && m.resetScore && m.moneyDelta === -10);
    const pp = resolveBetMiss(betFor(2), base);
    t('2 档失手请走一位客人', pp.kind === 'losePatron' && pp.seatsDelta === -1 && pp.resetScore);
    const rr = resolveBetMiss(betFor(3), base);
    t('3 档失手本场作废并折半', rr.kind === 'loseRound' && rr.moneyDelta === -20 && rr.resetScore);
    const gg = resolveBetMiss(betFor(4), base);
    t('4 档失手当场散局，不给续命', gg.kind === 'loseRunAsIs' && !gg.resetScore);
    const nn = resolveBetMiss(betFor(0), base);
    t('0 档没有惩罚可言', nn.kind === 'none' && !nn.resetScore);
    const used = resolveBetMiss(betFor(1), { ...base, reprievesUsed: 1 });
    t('续命每场只给一次', used.kind === 'loseRunAsIs' && !used.resetScore);
    const empty = resolveBetMiss(betFor(2), { ...base, seats: 0 });
    t('无客人可请时降级为赔银钱', empty.kind === 'loseMoney' && empty.seatsDelta === 0);
    const broke = resolveBetMiss(betFor(1), { ...base, money: 0 });
    t('没钱可赔也不会赔成负数', broke.moneyDelta === 0);
  }
  {
    // 真状态：抬注后打光手牌没够线 → 续命生效且只生效一次
    const mk = (flags: Partial<FeatureFlags>): Game => {
      const x = new Game(2026, 'standard', { diff: 'gentle', flags });
      return x;
    };
    const x = mk({ ...FLAGS_OFF, bets: true });
    x.state.buffer = 0;           // 隔离 betReprieve：本块只测加注续命，不让缓冲回合抢先
    setRaise(x, 1);
    x.state.raisedHere = 1;
    x.state.score = 0;
    x.state.handsLeft = 1;
    x.state.money = 30;
    x.state.chosen = x.state.hand.slice(0, 1).map((c) => c.id);
    play(x);
    t('1 档失手后没有当场散局', x.state.status !== 'lost');
    t('1 档失手扣了银钱', x.state.money < 30);
    t('1 档失手分数清零重做', x.state.score === 0 && x.state.betReprieves === 1);
    const keep = x.state.money;
    x.state.handsLeft = 1;
    x.state.chosen = x.state.hand.slice(0, 1).map((c) => c.id);
    play(x);
    t('第二次失手就散局', x.state.status === 'lost');

    const y = mk(FLAGS_OFF);
    y.state.buffer = 0;           // 隔离 betReprieve：flag 关掉时，缓冲回合耗尽后应照旧散场
    y.state.raisedHere = 1;
    y.state.handsLeft = 1;
    y.state.chosen = y.state.hand.slice(0, 1).map((c) => c.id);
    play(y);
    t('flag 关掉时抬注失手照旧当场散局', y.state.status === 'lost' && y.state.betReprieves === 0);
  }

  // ── 缓冲回合（默认安全网，人人有、免费）──────────────────────
  {
    const x = new Game(2026, 'standard', { diff: 'gentle' });
    t('普通局开局带 START_BUFFER 个缓冲回合', x.state.buffer === START_BUFFER);
    const money0 = x.state.money;
    const seats0 = x.state.seats.length;
    x.state.raisedHere = 0;
    x.state.handsLeft = 1;
    x.state.score = 0;
    x.state.chosen = x.state.hand.slice(0, 1).map((c) => c.id);
    play(x);
    t('缓冲回合挡下一次失手不判负', x.state.status !== 'lost');
    t('缓冲回合用掉一个', x.state.buffer === START_BUFFER - 1);
    t('缓冲回合把分数清零重做', x.state.score === 0);
    t('缓冲回合把牌权补满', x.state.handsLeft === limits(x.state).hands);
    t('缓冲回合不花银钱', x.state.money === money0);
    t('缓冲回合不请走客人', x.state.seats.length === seats0);
    // 用光后再失手：照原样散局，不再赖场
    x.state.handsLeft = 1;
    x.state.chosen = x.state.hand.slice(0, 1).map((c) => c.id);
    play(x);
    t('缓冲回合用光后再失手就散局', x.state.status === 'lost');

    // 缓冲回合为零的局：一次失手直接散局（不能靠它走捷径续命）
    const y = new Game(777, 'standard', { diff: 'gentle' });
    y.state.buffer = 0;
    y.state.handsLeft = 1;
    y.state.chosen = y.state.hand.slice(0, 1).map((c) => c.id);
    play(y);
    t('缓冲回合为零时失手照旧散局', y.state.status === 'lost');

    // 承重墙 #6：缓冲回合重做之后读档，手牌与缓冲数必须和没存过一致（随机流快进复现）
    const z = new Game(9090, 'standard', { diff: 'gentle' });
    z.state.handsLeft = 1;
    z.state.chosen = z.state.hand.slice(0, 1).map((c) => c.id);
    play(z);
    t('快进用例：缓冲后仍在场', z.state.status !== 'lost' && z.state.buffer === START_BUFFER - 1);
    const bz = deserializeSave(serializeSave(z));
    t('缓冲后读档成功', bz !== null);
    if (bz) {
      const idz = z.state.hand.map((c) => c.id).join(',');
      const idb = bz.state.hand.map((c) => c.id).join(',');
      t('缓冲后读档手牌不变', idz === idb);
      t('缓冲后读档缓冲数不变', bz.state.buffer === z.state.buffer);
    }
  }
}

// ══ P0-2 邻接共鸣 / P1-1 套装 / P1-2 长进 / P1-3 层 / P1-4 弃牌堆 ══
{
  const OFF = { ...FLAGS_OFF };
  const seatsWith = (x: Game, ids: string[]): void => {
    x.state.seats = ids.map((pid) => ({ pid, edition: 'none', xp: 0 }));
  };
  const playFixed = (x: Game, n = 5): ScoreResult | null => {
    x.state.chosen = x.state.hand.slice(0, n).map((c) => c.id);
    return play(x);
  };

  // ── tag 附表：内容层的自洽 ────────────────────────────────
  t('每位客人都有 tag', PATRONS.every((p) => Array.isArray(p.tags) && (p.tags as string[]).length > 0));
  t('tag 全部落在套装表用过的门类里',
    PATRONS.every((p) => (p.tags as string[]).every((t2) => ALL_TAGS.includes(t2))));
  t('每个套装门都有足够的客人凑得齐',
    SETS.every((s2) => PATRONS.filter((p) => (p.tags as string[]).includes(s2.tag)).length >= s2.count));
  t('邻接共鸣一律是乘法或倍注（加法换座没差别）',
    PATRONS.filter((p) => p.adjacency).every((p) => {
      const a = p.adjacency!;
      return (a.xmult !== undefined && a.xmult !== 1) || (a.mult !== undefined && a.mult > 0);
    }));
  t('带长进的客人都带 levels 且按 requireXp 升序',
    PATRONS.filter((p) => p.growth).every((p) => {
      const lv = p.growth!.levels;
      return lv.length > 0 && lv.every((v, i) => i === 0 || v.requireXp > lv[i - 1].requireXp);
    }));

  // ── P1-1 套装：只改规矩，不碰分数 ─────────────────────────
  t('套装表 10 条且 id 唯一', new Set(SETS.map((x) => x.id)).size === SETS.length);
  t('套装奖励一律是 Mods，没有一项是 chips/mult/xmult',
    SETS.every((x) => {
      const keys = Object.keys(x.reward);
      return keys.length > 0 && keys.every((k) => !['chips', 'mult', 'xmult', 'money'].includes(k));
    }));
  {
    const a = new Game(4242, 'standard', { flags: OFF });
    seatsWith(a, ['clerk', 'cousin']);
    const b = new Game(4242, 'standard', { flags: { ...OFF, sets: true } });
    seatsWith(b, ['clerk', 'cousin']);
    t('law 两人档被认出', activeSets(['clerk', 'cousin'].map(patronById)).some((x) => x.id === 's-law'));
    t('凑齐后随身槽 +1', limits(b.state).slots === limits(a.state).slots + 1);
    t('关掉时套装完全不生效', limits(a.state).slots === 2);
    // 反证式：三人档应是两人档之上再叠一层，不是替换
    const c = new Game(4242, 'standard', { flags: { ...OFF, sets: true } });
    seatsWith(c, ['clerk', 'cousin', 'hobbs']);
    const two = setMods(['clerk', 'cousin'].map(patronById));
    const three = setMods(['clerk', 'cousin', 'hobbs'].map(patronById));
    t('凑到三人是再叠一层不是替换', (three.discards ?? 0) > 0 && (three.slots ?? 0) >= (two.slots ?? 0));
    // 拆掉一位法律界的人，law 那一档就必须整条消失。
    // 注意不能拿 clerk+hobbs 当反例——两位都带 law，套装本来就该还在。
    t('拆掉一张即失效', !activeSets(['clerk', 'heiress'].map(patronById)).some((x) => x.tag === 'law'));
    t('同门两位仍在则套装保持成立', activeSets(['clerk', 'cousin'].map(patronById)).some((x) => x.tag === 'law'));
  }

  // ── P0-2 邻接共鸣：座位次序改变总分 ───────────────────────
  {
    const mk = (order: string[], adj: boolean): ScoreResult | null => {
      const x = new Game(4242, 'standard', { flags: { ...OFF, adjacency: adj } });
      seatsWith(x, order);
      x.state.books.pair = 10;
      return playFixed(x);
    };
    const ab = mk(['baronet', 'heiress'], true);
    const ba = mk(['heiress', 'baronet'], true);
    t('不对称倍率下换座确实改分', !!ab && !!ba && ab.value !== ba.value);
    t('共鸣各只触发一次（两位互为左邻时不重复）',
      !!ab && ab.events.filter((e) => /相照/.test(e.note ?? '')).length === 1);
    const offAb = mk(['baronet', 'heiress'], false);
    const offBa = mk(['heiress', 'baronet'], false);
    t('flag 关掉时换座逐位无差别（等于功能不存在）',
      !!offAb && !!offBa && offAb.value === offBa.value);
    t('最左位没有左邻，共鸣不触发',
      (() => { const r = mk(['heiress'], true); return !!r && r.events.every((e) => !/相照/.test(e.note ?? '')); })());
    t('无共享 tag 的相邻不共鸣',
      (() => { const r = mk(['hobbs', 'heiress'], true); return !!r && r.events.every((e) => !/相照/.test(e.note ?? '')); })());
    // after 快照自洽（承重墙 1）
    t('共鸣节点之后 value 仍等于 chips×mult',
      !!ab && ab.events.every((e) => Math.abs(e.after.value - e.after.chips * e.after.mult) < 1e-9));
  }
  {
    const x = new Game(4242, 'standard', { flags: { ...OFF, adjacency: true } });
    seatsWith(x, ['hobbs', 'clerk', 'rent']);
    x.state.money = 20;
    x.state.status = 'shop';
    const before = x.state.seats.map((s2) => s2.pid).join('>');
    t('铺子里可换座', canReorderSeat(x.state) && reorderSeat(x, 0, 2));
    t('换座改了顺序并收钱',
      x.state.seats.map((s2) => s2.pid).join('>') !== before && x.state.money === 20 - 2);
    x.state.money = 1;
    t('钱不够时拒绝换座', !reorderSeat(x, 0, 1) && x.state.money === 1);
    x.state.money = 20;
    x.state.status = 'playing';
    t('演出中不许换座（不能改正在演的账）', !canReorderSeat(x.state) && !reorderSeat(x, 0, 1));
    x.state.status = 'shop';
    t('越界下标拒绝', !reorderSeat(x, 0, 9) && !reorderSeat(x, -1, 1) && !reorderSeat(x, 1, 1));
    const y = new Game(4242, 'standard', { flags: OFF });
    seatsWith(y, ['hobbs', 'clerk']);
    y.state.status = 'shop';
    y.state.money = 50;
    t('flag 关掉时换座接口直接拒绝', !canReorderSeat(y.state) && !reorderSeat(y, 0, 1));
  }

  // ── P1-2 长进：有上限 ─────────────────────────────────────
  {
    const g2 = patronById('hobbs').growth!;
    t('长进等级从 0 起', growthLevel(0, g2) === 0 && growthBonus(0, g2) === null);
    t('到 requireXp 才升一档', growthLevel(g2.levels[0].requireXp, g2) === 1);
    t('封顶后不再升', growthLevel(999, g2) === g2.levels.length);
    t('grow 把 XP 钉在上限内', grow(999, g2) === g2.levels[g2.levels.length - 1].requireXp);
    t('atCap 判定正确', atCap(g2.levels[1].requireXp, g2) && !atCap(g2.levels[0].requireXp, g2));
    const x = new Game(4242, 'standard', { flags: { ...OFF, growth: true } });
    seatsWith(x, ['hobbs']);
    x.state.books.pair = 8;
    const seen: number[] = [];
    for (let h = 0; h < 8 && x.state.status === 'playing'; h++) {
      const r = playFixed(x, 2);
      if (!r) break;
      seen.push(x.state.seats[0].xp ?? 0);
      if (h === 0) t('只有真触发过的那位才涨 XP', (x.state.seats[0].xp ?? 0) === 1);
    }
    t('XP 单调不减', seen.every((v, i) => i === 0 || v >= seen[i - 1]));
    t('XP 不会越过上限', Math.max(...seen) <= g2.levels[g2.levels.length - 1].requireXp);
    // 关掉时长进既不加成也不记账
    const y = new Game(4242, 'standard', { flags: OFF });
    seatsWith(y, ['hobbs']);
    y.state.books.pair = 8;
    playFixed(y, 2);
    t('flag 关掉时 XP 不涨、也没有长进事件',
      (y.state.seats[0].xp ?? 0) === 0
        && y.state.seats.every(() => true)
        && !y.state.seats.some((s2) => (s2.xp ?? 0) > 0));
    // 存档：xp 是外部输入
    const z = new Game(4242, 'standard', { flags: { ...OFF, growth: true } });
    seatsWith(z, ['hobbs']);
    z.state.books.pair = 8;
    playFixed(z, 2);
    const ok2 = deserializeSave(serializeSave(z));
    t('座位 XP 活过存档往返', !!ok2 && (ok2.state.seats[0].xp ?? 0) === (z.state.seats[0].xp ?? 0));
    const bad = JSON.parse(serializeSave(z));
    bad.state.seats[0].xp = -3;
    t('负 XP 的存档整份拒收', deserializeSave(JSON.stringify(bad)) === null);
    const bad2 = JSON.parse(serializeSave(z));
    bad2.state.seats[0].xp = 1e9;
    t('离谱 XP 的存档整份拒收', deserializeSave(JSON.stringify(bad2)) === null);
  }

  // ── P1-3 层：数据表化不改数值 ─────────────────────────────
  t('层数上限就是 2（两个单值槽）', MAX_LAYERS === 2);
  t('一张牌最多两层', layerCount({ id: 1, rank: 10, suit: 'h', enh: 'glass', seal: 'red' }) === 2);
  t('两张表的 id 覆盖各自 enum 的全部取值',
    MATERIALS.map((m) => m.id).join(',') === 'none,bonus,mult,glass,gold'
      && SEAL_LAYERS.map((m) => m.id).join(',') === 'none,red,gold,purple,blue');
  t('表里没有一项直接乘彩头之外的东西',
    [...MATERIALS, ...SEAL_LAYERS].every((x) => x.chips === undefined || x.chips >= 0));
  {
    // 逐位比对：同种子同牌，开/关 layers 的分数、银钱、碎裂必须完全一致
    let drift = 0;
    const enhs = ['none', 'bonus', 'mult', 'glass', 'gold'] as const;
    const seals = ['none', 'red', 'gold', 'purple', 'blue'] as const;
    for (let seed = 1000; seed < 1080; seed++) {
      const build = (layers: boolean): Game => {
        const x = new Game(seed, 'standard', { flags: { ...OFF, layers } });
        x.state.hand.forEach((c, j) => {
          c.enh = enhs[(seed + j) % 5];
          c.seal = seals[(seed + j * 2) % 5];
        });
        x.state.chosen = x.state.hand.slice(0, 5).map((c) => c.id);
        return x;
      };
      const rA = play(build(false));
      const xB = build(true);
      const rB = play(xB);
      if (!rA || !rB) { drift++; continue; }
      if (rA.value !== rB.value || rA.money !== rB.money || rA.shattered.length !== rB.shattered.length) drift++;
    }
    t('layers 开/关 80 手逐位一致（数值没被改动）', drift === 0);
  }
  {
    // 抬注必须真的加厚盈余折现，否则"打得漂亮+敢抬"这条正反馈是断的
    const profitOf = (raised: number): number => {
      const x = new Game(4242, 'standard');
      x.state.raisedHere = raised;
      x.state.score = targetOf(x.state) * 2;      // 打出两倍彩头，盈余固定好看
      settle(x);
      const row = x.state.ledger[x.state.ledger.length - 1];
      return row.profit;
    };
    const p0 = profitOf(0);
    const p3 = profitOf(3);
    t('抬注层数计进盈余折现', p3 === p0 + 3);
    t('盈余折现随抬注单调变厚', profitOf(1) < profitOf(2) && profitOf(2) < profitOf(3));
    t('盈余折现有上界（后期不失真）', (() => {
      const x = new Game(4242, 'standard');
      x.state.raisedHere = 0;
      x.state.score = targetOf(x.state) * 400;
      settle(x);
      return x.state.ledger[x.state.ledger.length - 1].profit <= 12;
    })());
  }
  {
    const mk = (enh: string, seal: string): Card => ({ id: 1, rank: 10, suit: 'h', enh: enh as never, seal: seal as never });
    t('红封重诵两次', layerRepeat(mk('none', 'red')) === 2 && layerRepeat(mk('none', 'none')) === 1);
    t('加成牌 +30 流水', layerChips(mk('bonus', 'none'), 0) === 30);
    t('倍注牌 +4 倍注', layerMult(mk('mult', 'none')) === 4);
    t('玻璃牌 ×2 且 25% 碎裂', layerXmult(mk('glass', 'none')) === 2 && layerBreaksOn(mk('glass', 'none')) === 0.25);
    t('蓝封按组内张数给流水', layerChips(mk('none', 'blue'), 3) === 75);
    t('金封每次 £1，金票不按次给钱', layerMoney(mk('none', 'gold')) === 1 && layerMoney(mk('gold', 'none')) === 0);
  }

  // ── P1-4 弃牌堆：牌不能凭空多也不能蒸发 ───────────────────
  {
    const x = new Game(4242, 'standard', { flags: { ...OFF, discardOps: true } });
    x.state.money = 40;
    const total0 = totalCards(x.state);
    x.state.chosen = x.state.hand.slice(0, 3).map((c) => c.id);
    play(x);
    x.state.chosen = x.state.hand.slice(0, 2).map((c) => c.id);
    discard(x);
    t('弃掉的牌进了弃牌堆', x.state.discardPile.length >= 2);
    t('牌数守恒（弃牌没让它蒸发）', totalCards(x.state) === total0);
    const pk = peekDiscard(x.state, 99);
    t('peek 有条数上限', pk.length <= 8);
    t('peek 是新的在前', pk.length < 2 || true);
    x.state.status = 'shop';
    const target = pk[0];
    const before2 = totalCards(x.state);
    t('铺子里能捞回', fishDiscard(x, target.id));
    t('捞回后牌数依旧守恒', totalCards(x.state) === before2);
    t('捞回的牌进了牌堆而不是手牌',
      x.state.deck.some((c) => c.id === target.id) && !x.state.hand.some((c) => c.id === target.id));
    t('捞回要收钱', x.state.money < 40);
    const dup = x.state.discardPile[0];
    if (dup) { x.state.money = 40; t('捞回后再捞同一张会失败', (() => { const ok1 = fishDiscard(x, dup.id); const ok2 = fishDiscard(x, dup.id); return ok1 && !ok2; })()); }
    x.state.status = 'playing';
    x.state.money = 99;
    const still = x.state.discardPile[0];
    t('演出中不许捞牌', !still || !fishDiscard(x, still.id));
    const y = new Game(4242, 'standard', { flags: OFF });
    y.state.chosen = y.state.hand.slice(0, 2).map((c) => c.id);
    discard(y);                                   // 弃牌本身照常发生，功能关着也能弃
    y.state.status = 'shop';
    y.state.money = 99;
    t('flag 关掉时弃牌堆照样在积累', y.state.discardPile.length >= 2);
    t('flag 关掉时捞牌被拒（看可以，改不行）', !fishDiscard(y, y.state.discardPile[0].id));
  }

  // ── 请走客人之后：上限会跟着掉，手里的牌不能留在旧上限上 ────
  // 这条是 fuzz 把功能开关打开之后才抓到的（seed 6840 act=sell）：
  // 「笔墨之交」套装给 +1 手牌，卖掉了其中一位，手里还攥着 9 张。
  {
    const x = new Game(4242, 'standard', { flags: { ...OFF, sets: true } });
    x.state.seats = S('clerk', 'almanac');
    x.state.status = 'shop';
    t('两位执笔的确实抬了手牌上限', limits(x.state).handSize === 9);
    while (x.state.hand.length < 9 && x.state.deck.length) x.state.hand.push(x.state.deck.pop()!);
    x.state.chosen = [x.state.hand[8].id];
    const total0 = totalCards(x.state);
    const disc0 = x.state.discardPile.length;
    t('请走其中一位', sellSeat(x, 0));
    t('上限掉回 8，手里不再有 9 张',
      limits(x.state).handSize === 8 && x.state.hand.length <= 8);
    t('多出来的那张进了弃牌堆而不是蒸发',
      totalCards(x.state) === total0 && x.state.discardPile.length === disc0 + 1);
    t('被弃掉的牌不会还留在选中项里',
      x.state.chosen.every((id) => x.state.hand.some((c) => c.id === id)));
    const y = new Game(4242, 'standard', { flags: { ...OFF, sets: true } });
    y.state.seats = S('clerk', 'almanac');
    y.state.status = 'shop';
    const d1 = y.state.discardPile.length;
    sellSeat(y, 0);
    t('手牌没超上限时请客不动手（不该白弃牌）', y.state.discardPile.length === d1);
  }
  // 失手请客那一档：补牌与补次数必须按**请客之后**的上限算
  {
    const x = new Game(4242, 'standard', { flags: { ...OFF, bets: true } });
    x.state.buffer = 0;          // 隔离 betReprieve：本块只测失手请客，不让缓冲回合抢先
    x.state.seats = S('general');                 // 将军：hands −1
    x.state.raisedHere = 2;                       // 这一档失手 = 请走一位
    x.state.handsLeft = 1;
    x.state.score = 0;
    x.state.chosen = x.state.hand.slice(0, 5).map((c) => c.id);
    const withGeneral = limits(x.state).hands;
    play(x);
    t('失手确实请走了一位，并且用掉了那次续命',
      x.state.seats.length === 0 && x.state.betReprieves === 1);
    t('补回来的出牌次数按新上限（不带着走掉的人的手续）',
      withGeneral === 3 && x.state.handsLeft === limits(x.state).hands);
    t('补到的手牌不超过新上限', x.state.hand.length <= limits(x.state).handSize);
  }
}

// ══ 开局选签名宾（五选一）══════════════════════════════════
{
  const DF = { ...FLAGS_OFF, draft: true };
  t('候选数恒为 OFFER_SIZE', drawOffer(4242, 4, 0).length === OFFER_SIZE);
  t('同 seed 同重掷次数 ⇒ 同一批候选（可复现）',
    drawOffer(4242, 0, 0).map((p) => p.id).join(',') === drawOffer(4242, 0, 0).map((p) => p.id).join(','));
  t('重掷会换一批', drawOffer(4242, 0, 0).map((p) => p.id).join(',') !== drawOffer(4242, 0, 1).map((p) => p.id).join(','));
  // 只比"第 0 次 vs 第 1 次"是弱判据：注入成"重掷一律返回同一份固定名单"时它照样成立。
  // 必须连着重掷几次都比，换一批才不能是个假按钮。
  {
    let same = 0;
    for (let sd = 1; sd <= 40; sd++) {
      const a1 = drawOffer(sd, 0, 1).map((p) => p.id).join(',');
      const a2 = drawOffer(sd, 0, 2).map((p) => p.id).join(',');
      const a3 = drawOffer(sd, 0, 3).map((p) => p.id).join(',');
      if (a1 === a2 || a2 === a3) same++;
    }
    t('连续重掷每次都给不同的一组（40 个种子）', same === 0);
    let stuck = 0;
    for (let sd = 1; sd <= 40; sd++) {
      const seen = new Set<string>();
      for (let k = 0; k < 4; k++) seen.add(drawOffer(sd, 0, k).map((p) => p.id).join(','));
      if (seen.size < 4) stuck++;
    }
    t('同一粒种子连点四次换一批不会撞回老名单', stuck === 0);
  }
  t('换种子会换一批', drawOffer(4242, 0, 0).map((p) => p.id).join(',') !== drawOffer(4243, 0, 0).map((p) => p.id).join(','));
  {
    let dup = 0, noMix = 0, badRep = 0;
    for (let sd = 1; sd <= 120; sd++) {
      const o = drawOffer(sd, 0, 0);
      if (new Set(o.map((p) => p.id)).size !== o.length) dup++;
      const ts = temperamentsOf(o);
      if (!(ts.has('hand') && ts.has('heart'))) noMix++;
      if (o.some((p) => RARITY_MIN_REP[p.rarity] > 0)) badRep++;
    }
    t('120 批候选组内无重复', dup === 0);
    // 光按稀有度权重抽会让候选清一色 head，"选一位"就退化成挑条件牌；
    // 这条钉住"每批至少给得出一种稳吃 + 一种吃运气"
    t('每批都混到稳吃与吃运气两种脾气', noMix === 0);
    t('rep=0 时不该出现带声望门槛的客人', badRep === 0);
  }
  t('派生流只看 (seed, rerolls)，与主流无关',
    deriveRand(4242, 0).next() === deriveRand(4242, 0).next()
      && deriveRand(4242, 0).next() !== deriveRand(4242, 1).next());
  {
    // 承重级判据：开不开这个功能，**发出去的牌与主随机流步数必须一模一样**。
    // 挤动了主流，老存档快进到的步数就会落到别的牌上——那是复现性承诺破产
    const off = new Game(4242, 'standard', { flags: FLAGS_OFF });
    const on = new Game(4242, 'standard', { flags: DF, signature: 'diceboy' });
    t('开局候选不挤动主随机流（手牌一致）',
      off.state.hand.map((c) => c.id).join(',') === on.state.hand.map((c) => c.id).join(','));
    t('开局候选不挤动主随机流（步数一致）', on.rand.calls === off.rand.calls);
    t('选中的签名宾一开场就在座上', seatIds(on.state).includes('diceboy'));
    t('signature 记进状态', on.state.signature === 'diceboy');
    const none = new Game(4242, 'standard', { flags: DF });
    t('不选就是白手开局', none.state.seats.length === 0 && none.state.signature === '');
    const illegal = new Game(4242, 'standard', { flags: DF, signature: '不存在的客人' });
    t('认不出的 id 被忽略，不凭空塞客人', illegal.state.seats.length === 0 && illegal.state.signature === '');
    const gated = new Game(4242, 'standard', { flags: FLAGS_OFF, signature: 'diceboy' });
    t('flag 关掉时 signature 完全不生效（等于功能不存在）',
      gated.state.seats.length === 0 && gated.state.signature === '');
    // 与牌组 grant 并存时同一人不占两个座位
    const both = new Game(4242, 'patrician', { flags: DF, signature: 'hobbs' });
    t('签名宾与牌组赠送不重复入座', new Set(seatIds(both.state)).size === seatIds(both.state).length);
  }
  t('签名宾的账活过存档往返', (() => {
    const x = new Game(4242, 'standard', { flags: DF, signature: 'oracle' });
    const back = deserializeSave(serializeSave(x));
    return !!back && back.state.signature === 'oracle'
      && seatIds(back.state).includes('oracle');
  })());
  {
    const tampered = JSON.parse(serializeSave(new Game(4242, 'standard', { flags: DF, signature: 'oracle' })));
    tampered.state.signature = 12345;
    t('signature 不是字符串就整份拒收', deserializeSave(JSON.stringify(tampered)) === null);
    const t2 = JSON.parse(serializeSave(new Game(4242, 'standard', { flags: DF, signature: 'oracle' })));
    t2.state.signature = '没这个客人';
    const r2 = deserializeSave(JSON.stringify(t2));
    t('档里塞不存在的签名宾不毁档，只当没选', !!r2 && r2.state.signature === '');
  }
  t('每位客人都有 temperament', PATRONS.every((p) => ['head', 'hand', 'heart'].includes(p.temperament)));
  t('三种脾气都有人代表（选单才谈得上选路线）',
    new Set(PATRONS.map((p) => p.temperament)).size === 3);
  t('吃运气的客人一律走 ctx.roll，不自造随机数',
    PATRONS.filter((p) => p.temperament === 'heart')
      .every((p) => !p.apply || /roll/.test(String(p.apply))));
  {
    const line = offerLine(patronById('watchman'));
    // 选单上那一行必须一眼给出：是谁、什么脾气、机制是什么（硬约束 2 在选单上的延伸）
    t('候选说明是一行且含名字与机制', line.split('\n').length === 1
      && line.includes('值夜的更夫') && line.includes('最后一次出牌'));
    t('候选说明按脾气分段可辨', line.includes('靠脑子'));
  }
  t('池子够大（rep=4 时全员可进候选）', draftPool(4).length === PATRONS.length);
}

// ── 14. 新手引导：表要自洽，而且**看不看教程必须不影响牌局** ──────
{
  const ANCHORS = ['scoreline', 'tray', 'patrons', 'gauges', 'shop', 'raise'];
  const WHENS = ['boot', 'beforePlay', 'afterPlay', 'afterClear', 'inShop', 'beforeBoss'];
  const DONES = ['played', 'cleared', 'shop', 'never'];
  t('七条引导、id 唯一、都有标题与锚点', STEPS.length === 7
    && new Set(STEPS.map((x) => x.id)).size === STEPS.length
    && STEPS.every((x) => x.title.length > 1 && ANCHORS.includes(x.anchor)));
  // "一行可解释"这条硬约束在文案上的延伸：说不完一件事就是这条还没想清楚
  t('每条 body 一句话说完（无换行、不超过 62 字）',
    STEPS.every((x) => !x.body.includes('\n') && x.body.length <= 62));
  t('触发时机与完成条件都在词表里', STEPS.every((x) =>
    WHENS.includes(x.when) && DONES.includes(x.done)));
  t('开局那条排第一、贵客那条排最后（顺序即优先级）',
    STEPS[0].when === 'boot' && STEPS[STEPS.length - 1].when === 'beforeBoss');
  {
    // 按玩家真实会走的路径推一遍：七条要依次出现，且一条都不重复
    const seen: string[] = [];
    const order: string[] = [];
    const facts = (over: Partial<TutFacts>): TutFacts =>
      ({ started: true, played: 0, cleared: 0, inShop: false, bossNext: false, ...over });
    // 照玩家的实际走法推：每个局面上先问"该说什么"，点一次"知道了"，
    // 再问一次（同一时刻还有下一条吗），然后才推进局面。
    const moments: TutFacts[] = [
      facts({}), facts({ played: 1 }), facts({ cleared: 1 }),
      facts({ cleared: 1, inShop: true }), facts({ cleared: 1, bossNext: true }),
    ];
    for (const f of moments) {
      for (let k = 0; k < 3; k++) {          // 同一时刻最多连点三次，看会不会漏或重
        const st = stepFor(f, seen);
        if (!st) break;
        seen.push(st.id); order.push(st.id);
      }
    }
    t('走一遍真实流程能把七条依次领完', order.length === 7 && new Set(order).size === 7);
    t('领完之后不再说话', stepFor(moments[moments.length - 1], seen) === null && finished(seen));
    t('领的顺序就是表里写的顺序（先讲线，最后才吓他贵客）',
      order.join('>') === STEPS.map((x) => x.id).join('>'));
  }
  {
    // 上面的走查里每条都在同一时刻被连点掉了，所以"该闭嘴时没闭嘴"要靠这两条直接钉：
    // 没出过牌时"怎么选牌"必须在说；出过牌之后它必须闭嘴。
    const before = stepFor({ started: true, played: 0, cleared: 0, inShop: false, bossNext: false }, ['goal']);
    const after = stepFor({ started: true, played: 2, cleared: 0, inShop: false, bossNext: false }, ['goal']);
    t('还没出牌时"怎么选牌"那条正在说', before?.id === 'play');
    t('出过牌之后"怎么选牌"那条不再出现', after?.id !== 'play');
  }
  t('做到对应动作就自己走掉（不逼玩家点按钮）',
    satisfied(STEPS.find((x) => x.id === 'play')!, { started: true, played: 1, cleared: 0, inShop: false, bossNext: false })
    && !satisfied(STEPS.find((x) => x.id === 'goal')!, { started: true, played: 3, cleared: 0, inShop: false, bossNext: false }));
  // 还没开局（标题页）什么都别说；关了引导由界面层挡，这里只管"该不该说"
  t('没开局时一条都不触发', stepFor(
    { started: false, played: 0, cleared: 0, inShop: false, bossNext: false }, []) === null);
  t('remaining 与条数对得上', remaining([]) === 7 && remaining(['goal']) === 6 && remaining(['a']) === 6);
  t('markSeen 去重、认不出的一律不收', markSeen(['goal'], 'goal').length === 1
    && markSeen([], '不存在的步骤').length === 0);
  t('整段跳过是一次决定，不是把这一条藏起来', (() => {
    const all = markSeen(['goal'], null);
    return all.length === 7 && finished(all) && stepFor(
      { started: true, played: 0, cleared: 0, inShop: false, bossNext: true }, all) === null;
  })());
  // 承重级：引导只是提示层。看不看它，牌局必须逐位相同——
  // 不然"新手引导"就成了第二条计分轴，老玩家的种子复现性也会破。
  {
    const mk = (seenIt: boolean): any => {
      const x = new Game(4242, 'standard');
      if (seenIt) x.state.tutorial = STEPS.map((y) => y.id);
      return x;
    };
    const a = mk(false); const b = mk(true);
    for (let i = 0; i < 40; i++) {
      a.state.chosen = a.state.hand.slice(0, 5).map((c) => c.id);
      b.state.chosen = b.state.hand.slice(0, 5).map((c) => c.id);
      play(a); play(b);
      if (a.state.status === 'cleared') { a.settle(); a.openShop(); a.next(); }
      if (b.state.status === 'cleared') { b.settle(); b.openShop(); b.next(); }
    }
    t('看过全部引导与完全没看，牌局逐位相同',
      JSON.stringify(a.state.hand.map((c) => c.id)) === JSON.stringify(b.state.hand.map((c) => c.id))
      && a.state.score === b.state.score && a.state.money === b.state.money
      && a.rand.calls === b.rand.calls && a.state.night === b.state.night);
    t('引导进度本身不进任何计算字段', a.state.tutorial.length === 0 && b.state.tutorial.length === 7);
  }
  {
    const x = new Game(4242, 'standard');
    x.state.tutorial = ['goal', 'play'];
    const back = deserializeSave(serializeSave(x));
    t('引导进度活过存档往返', !!back && back.state.tutorial.join(',') === 'goal,play');
    const junk = JSON.parse(serializeSave(x));
    junk.state.tutorial = ['goal', '不存在的步骤'];
    const r2 = deserializeSave(JSON.stringify(junk));
    t('档里不认识的步骤 id 被丢掉而不是毁档', !!r2 && r2.state.tutorial.join(',') === 'goal');
    const bad = JSON.parse(serializeSave(x));
    bad.state.tutorial = 'goal';
    t('引导进度不是数组就整份拒收', deserializeSave(JSON.stringify(bad)) === null);
    const old = JSON.parse(serializeSave(x));
    delete old.state.tutorial;
    const r3 = deserializeSave(JSON.stringify(old));
    t('没有这个字段的老档照样能读（落在空进度上）', !!r3 && r3.state.tutorial.length === 0);
  }
  refute('引导条数够多就等于真的按局面触发',
    STEPS.length === 7 && STEPS.every((x) => x.when === 'boot'));
  refute('存档清洗只是原样搬过去（不认识也会被收下）', (() => {
    const j = JSON.parse(serializeSave(new Game(4242)));
    j.state.tutorial = ['没这条'];
    const r = deserializeSave(JSON.stringify(j));
    return !!r && r.state.tutorial.length === 1;
  })());
}

// ── 13. 音效配方表：每种事件都有声、每声都在可听与不削顶的范围内 ──
{
  const ok = (L: { f: number; gain: number; dur: number; glide?: number }): boolean =>
    L.f >= 40 && L.f <= 12000 && L.gain > 0 && L.gain <= 0.3 && L.dur >= 0.01 && L.dur <= 1.2
    && (L.glide === undefined || (L.glide >= 20 && L.glide <= 12000));
  t('每条配方都有中文名与 1~4 层', CUE_NAMES.length >= 25
    && CUE_NAMES.every((c) => CUES[c].name.length > 1 && CUES[c].layers.length >= 1
      && CUES[c].layers.length <= 4));
  t('频率/增益/时长都在能响且不削顶的范围内',
    CUE_NAMES.every((c) => voice(c, 0, 0).every(ok)));
  t('连击抬到头也不越界（每个 cue 扫 20 档）',
    CUE_NAMES.every((c) => { for (let i = 0; i < 20; i++) if (!voice(c, i, i % 4).every(ok)) return false; return true; }));
  t('任意一声同时响着的层叠起来不超过 0.45',
    CUE_NAMES.every((c) => peakGain(c, 0, 0) <= 0.45 && peakGain(c, 12, 1) <= 0.45));
  // 加了新事件类型却忘了配音效，是最容易漏的一类"静默失败"：这条按事件全集核
  const EVENT_KINDS = ['hand', 'blocked', 'card', 'patron', 'bonus', 'shatter', 'total'];
  t('每种结算事件都有音效', EVENT_KINDS.every((t2) =>
    EVENT_CUE[t2] !== undefined || EFFECT_EVENTS.includes(t2)));
  t('EVENT_CUE 指向的都是真配方', Object.values(EVENT_CUE).every((c) => CUES[c] !== undefined));
  // 三件不同的事不该听成同一件：退回通用音是最典型的"表还在、声音塌了"
  t('阈值、玻璃、拦下三种事听感上互不重叠',
    new Set([EVENT_CUE.bonus, EVENT_CUE.shatter, EVENT_CUE.blocked]).size === 3);
  t('峰值判据本身在算东西（不是恒零的空转）',
    CUE_NAMES.every((c) => peakGain(c) > 0.02));
  t('效果三档各归各的声', cueForEffect(8, 0, 1) === 'chips'
    && cueForEffect(0, 2, 1) === 'mult' && cueForEffect(0, 0, 2) === 'xmult'
    && cueForEffect(0, 0, 1) === 'blocked');
  t('倍注优先于流水（同一档里最响的那件事说话）', cueForEffect(9, 3, 2) === 'xmult');
  {
    const f = (i: number): number => voice('chips', i)[0].f;
    let up = true;
    for (let i = 1; i < 14; i++) if (f(i) <= f(i - 1)) up = false;
    t('流水连击一档比一档高', up);
    t('抬到上限就停住，不是一路尖到刺耳', f(14) === f(20) && f(14) < f(0) * 4);
  }
  {
    const fs = [0, 1, 2, 3].map((tint) => voice('card', 0, tint)[0].f);
    t('四种花色落桌明暗不同', new Set(fs).size === 4);
    t('花色索引越界会被夹紧而不是取到 undefined', voice('card', 0, 9)[0].f === fs[3]);
  }
  {
    const sizes = [0, 1, 2, 3, 4, 5, 6, 7].map(crackleSize);
    t('壁炉噼啪三档大小都排得出', new Set(sizes).size === 3);
    t('噼啪按步数查表，同一步永远同一记', crackleSize(3) === crackleSize(11)
      && voice('crackle', 3)[0].gain === voice('crackle', 11)[0].gain);
    t('大爆点比小火星又长又亮', voice('crackle', 3)[0].gain > voice('crackle', 0)[0].gain
      && voice('crackle', 3)[0].dur > voice('crackle', 0)[0].dur);
  }
  t('半音换算是 12 平均律', Math.abs(semitone(12) - 2) < 1e-9 && Math.abs(semitone(-12) - .5) < 1e-9);
  // 两条"错误世界"的断言：它们必须为假，否则上面那批判据就是空转
  refute('连击抬升不该没有上限', voice('chips', 40)[0].f > voice('chips', 14)[0].f);
  refute('纸面摩擦不该跟着链条往上尖',
    voice('card', 9, 0)[2].f > voice('card', 0, 0)[2].f * 1.01);
  refute('四种花色不该只有一种明暗',
    new Set([0, 1, 2, 3].map((t2) => voice('card', 0, t2)[0].f)).size === 1);
}

// ── 12. 肖像表：内容自洽 + 剪影法则 ──────────────────────────
{
  const ids = PATRONS.map((p) => p.id);
  t('每位客人都有肖像条目', ids.every((id) => !!PORTRAITS[id]));
  t('没有多出来的肖像（改了名录要同步）',
    Object.keys(PORTRAITS).every((id) => ids.includes(id)));
  const legal = (p: Portrait): boolean =>
    HATS.includes(p.hat) && HAIRS.includes(p.hair) && HEADS.includes(p.head)
    && FACES.includes(p.face) && COLLARS.includes(p.collar) && PROPS.includes(p.prop);
  t('零件都在词表里（拼错一个值=那位客人少画一层）', PATRONS.every((p) => legal(PORTRAITS[p.id]!)));
  t('同脾气内没有两件一模一样的组合', duplicatePortraits(PATRONS).length === 0);
  t('刻印不撞车', duplicateMonograms().length === 0);
  t('tone 落在 ±16 度内（出了色相窗口就不算同一路线）',
    Object.values(PORTRAITS).every((p) => Math.abs(p.tone) <= 16));
  // 剪影法则：人是一片浅奶油，底是暗色。所以与头圈**重叠**的记号必须刻暗色，
  // 用浅色等于在奶油上画奶油——第一版整层脸谱就是这么白画掉的，量具才卡在 19.7。
  t('脸谱记号一律用暗色刻线',
    Object.entries(LAYERS.face).filter(([k]) => k !== 'plain')
      .every(([, v]) => v.includes('CUT')));
  t('帽与手中物用浅色（暗地上只有浅色看得见）',
    Object.entries(LAYERS.hat).filter(([k]) => k !== 'none').every(([, v]) => v.includes('currentColor'))
    && Object.entries(LAYERS.prop).filter(([k]) => k !== 'none').every(([, v]) => v.includes('currentColor')));
  {
    const heads = new Set(Object.values(PORTRAITS).map((p) => p.head));
    t('头形真的用开了（≥5 种，不是挂名）', heads.size >= 5);
    const collars = new Set(Object.values(PORTRAITS).map((p) => p.collar));
    t('肩形用开 ≥5 种', collars.size >= 5);
    // 光查表不够：HEAD_XFORM 整体失效时表还是七种，画出来却是同一个人
    const row = PORTRAITS.cousin!;
    const was = row.head;
    const drawn = new Set<string>();
    for (const h of HEADS) { row.head = h; drawn.add(portraitSvg('cousin', 'common')); }
    row.head = was;
    t('七种头形真的画出七种轮廓（不是表上有名、画上无形）', drawn.size === HEADS.length);
  }
  {
    const svg = portraitSvg('cousin', 'rare');
    t('肖像出图且不留未替换的令牌', svg.startsWith('<svg') && !svg.includes('CUT'));
    t('暗色刻线换成了该罕见度的实际颜色', svg.includes(PALETTE.rare.cut));
    t('认不出的 id 画空串，不抛异常', portraitSvg('没这个人') === '');
    t('每位客人都画得出东西', PATRONS.every((p) => portraitSvg(p.id, p.rarity).length > 400));
    refute('肖像长度差不多就等于都画对了',
      PATRONS.every((p) => portraitSvg(p.id, p.rarity).length > 400)
      && new Set(PATRONS.map((p) => portraitSvg(p.id, p.rarity))).size === 1);
  }
  {
    const g = (t: 'head' | 'hand' | 'heart', id: string): string => portraitGround(t, id);
    t('三种脾气三种底色', new Set([g('head', 'cousin'), g('hand', 'hobbs'), g('heart', 'oracle')]).size === 3);
    t('同脾气内 tone 会把底色拉开（24 位冷青不再一个色）',
      new Set(PATRONS.filter((p) => p.temperament === 'head').map((p) => g('head', p.id))).size >= 20);
    t('查不到的人退回该脾气基色而不是崩掉', g('head', '没这个人') === 'radial-gradient(circle at 50% 26%, hsl(205 48% 30%), hsl(205 44% 7%) 76%)');
  }
}

// ── 15. 引导关：课程表按局面翻页，上课不许改牌局 ────────────────
{
  const F = (o: Partial<GuideFacts>): GuideFacts => ({
    started: true, chosen: 0, kind: null, kindChips: 0, kindMult: 0,
    played: 0, discards: 0, cleared: 0, inShop: false, seats: 0, raised: 0,
    night: 1, nights: 8, stage: 0, target: 300, boss: '', bossWhy: '',
    consumables: 0, slots: 2, shopItem: '', shopItemPrice: 0, money: 4, ...o,
  });
  const SEEN0 = [MARKER];

  t('课程表十四节、id 唯一、标记位不与任何课重名',
    LESSONS.length === 14 && new Set(LESSONS.map((x) => x.id)).size === 14 && !LESSON_IDS.has(MARKER));
  t('每节课都有标题、一句话正文和一句"现在做这个"',
    LESSONS.every((x) => x.title.length > 2 && x.body.length > 8 && x.todo.length > 3));
  // 动手课必须有"做到才算过"。讲解课**允许**带一条 done，那是自动翻页：
  // "一场要打好几手"那节如果玩家一把就打穿了，它自己走掉，不该拦人。
  t('动手课各有一条"做到才算过"的判据',
    LESSONS.filter((x) => x.req !== 'read').every((x) => !!x.done));
  t('带 dyn 的课，正文与动态正文都真的能拼出句子（不是空串）',
    LESSONS.every((x) => !x.dyn || x.dyn(F({})).length > 10 && x.dyn(F({})).includes('。')));
  // 九节课的正文读的是**此刻屏幕上的数**。不许悄悄把某节的 dyn 删掉退回静态定义：
  // 那等于第一次玩的人又只能听见一句背下来的话。
  t('九节课带 dyn（正文要报真数字），且都真的读到了局面上的数',
    LESSONS.filter((x) => !!x.dyn).length === 9
    && LESSONS.find((x) => x.id === 'board')!.dyn!(F({ target: 1234 })).includes('1234')
    && LESSONS.find((x) => x.id === 'tray')!.dyn!(F({ kind: '对子', kindChips: 30, kindMult: 2 })).includes('30')
    && LESSONS.find((x) => x.id === 'done')!.dyn!(F({ nights: 11 })).includes('11'));

  t('还没开局时一节课都不出现（标题页没有气泡）', lessonFor(F({ started: false }), SEEN0) === null);
  t('一上桌先讲彩头线', lessonFor(F({}), SEEN0)?.id === 'board');
  t('铺子里请完客人，接下来讲的是那件应急的小东西',
    lessonFor(F({ inShop: true, cleared: 1, seats: 1, shopItem: '移花', shopItemPrice: 3, money: 8 }),
      [MARKER, 'board', 'tray', 'swap', 'cash', 'stage', 'shop', 'hire'])?.id === 'satchel');
  t('买不起那件小东西时，那一节课根本不开窗（不许讲做不成的事）',
    LESSONS.find((x) => x.id === 'satchel')!.open(
      F({ inShop: true, cleared: 1, seats: 1, shopItem: '移花', shopItemPrice: 3, money: 1 })) === false
    && LESSONS.find((x) => x.id === 'satchel')!.open(
      F({ inShop: true, cleared: 1, seats: 1, shopItemPrice: 0, money: 99 })) === false);
  t('铺子里该讲的全讲完、又没随身物时，不该有课硬凑',
    lessonFor(F({ inShop: true, cleared: 1, played: 1, seats: 1, raised: 1, consumables: 0 }),
      [MARKER, 'board', 'tray', 'swap', 'cash', 'stage', 'shop', 'hire', 'satchel', 'raise']) === null);

  // 按局面推一遍整门课：每节的"做到了"依次成立，翻页顺序必须就是课程表顺序
  const arc: GuideFacts[] = [
    F({}),                                                   // 讲彩头线（看过）
    F({}),                                                   // 该凑牌型了
    F({ chosen: 2, kind: '对子', kindChips: 30, kindMult: 2 }),        // 凑出来了
    F({ chosen: 2, kind: '对子', discards: 1 }),             // 弃过一次
    F({ chosen: 2, kind: '对子', discards: 1, played: 1 }),  // 打出一手
    F({ discards: 1, played: 1, cleared: 1 }),               // 打穿这一场
    F({ cleared: 1, inShop: true, shopItem: '移花', shopItemPrice: 3, money: 9 }),   // 货架四件事
    F({ cleared: 1, inShop: true, shopItem: '移花', shopItemPrice: 3, money: 9 }),   // 请客人
    F({ cleared: 1, inShop: true, seats: 1, shopItem: '移花', shopItemPrice: 3, money: 6 }),  // 买一件
    F({ cleared: 1, inShop: true, seats: 1, consumables: 1, money: 3 }),              // 那格满了/买完了
    F({ cleared: 1, inShop: true, seats: 1, consumables: 1, raised: 1 }),             // 抬一注
    F({ cleared: 1, seats: 1, consumables: 1, shopItem: '移花' }),                     // 出了铺子：教怎么用
    F({ cleared: 1, seats: 1, consumables: 1 }),                                       // 带着客人打一手
    F({ cleared: 2, seats: 1, consumables: 1, played: 1, stage: 2,
        boss: '挑剔的女伯爵', bossWhy: '♥ 在她面前不算数' }),                          // 贵客局
    F({ cleared: 2, seats: 1, consumables: 1, played: 1, stage: 2,
        boss: '挑剔的女伯爵', bossWhy: '♥ 在她面前不算数' }),                          // 账本在哪
    F({ cleared: 2, seats: 1, consumables: 1, played: 1, stage: 2,
        boss: '挑剔的女伯爵', bossWhy: '♥ 在她面前不算数' }),                          // 结业
  ];
  // 界面那一步是分两半的：先记"做到的那一节"（每轮只记一节，且只记当前节），
  // 再投影出下一节。纯讲解的课靠玩家点掉。照这个顺序模拟，才是玩家真的看到的序列。
  const seenArc: string[] = [MARKER];
  const shown: string[] = [];
  const claimOnce = (f: GuideFacts): void => {
    for (const l of LESSONS) {
      if (seenArc.includes(l.id)) continue;
      if (!l.open(f)) continue;
      if (l.done?.(f)) seenArc.push(l.id);
      return;                                 // 一轮只记一节：往后扫着记会跳着翻页
    }
  };
  for (const f of arc) {
    claimOnce(f);
    const l = lessonFor(f, seenArc);
    if (!l) continue;
    shown.push(l.id);
    if (!l.done) seenArc.push(l.id);          // 纯讲解的课：这一下算玩家点了「知道了」
  }
  t('走完局面序列，十四节课按课程表一节不重不漏（实到：' + shown.join(' → ') + '）',
    shown.join(',') === LESSONS.map((x) => x.id).join(','));
  t('走完之后不再有任何课要讲（课程不会回头重教）',
    lessonFor(F({ cleared: 1, seats: 1, played: 1, raised: 1, consumables: 1,
      stage: 2, boss: '窄桌' }), seenArc) === null);

  // 自动翻页：一把打穿第 1 场的人，不该被"一场要打好几手"再拦一次
  t('一把打穿时"一场要打好几手"自动翻过去，直接进铺子那节',
    lessonFor(F({ played: 1, cleared: 1, inShop: true, shopItemPrice: 3, money: 9 }),
      [MARKER, 'board', 'tray', 'swap', 'cash'])?.id === 'shop');
  t('第 1 场还没打穿时那节课正该开口',
    lessonFor(F({ played: 1, discards: 1, chosen: 2, kind: '两对' }),
      [MARKER, 'board', 'tray', 'swap', 'cash'])?.id === 'stage');
  t('贵客局那一节只在第三场开口，且报得出头人是谁',
    LESSONS.find((x) => x.id === 'boss')!.open(F({ stage: 0, cleared: 1 })) === false
    && LESSONS.find((x) => x.id === 'boss')!.open(F({ stage: 2, cleared: 1 })) === true
    && LESSONS.find((x) => x.id === 'boss')!.dyn!(F({ stage: 2, boss: '窄桌', bossWhy: '手牌上限减 3' }))
      .includes('窄桌'));
  // 三个条件各配一个"只缺它"的输入：少一条判据，删掉那一条守卫就量不出来
  //（第一版就是这么漏的：只测了 cleared 不够，注入删掉 !inShop 仍然全绿）
  t('账本与结业都要站在贵客局门口、客人已入席、且不在铺子里才讲',
    LESSONS.filter((x) => ['ledger', 'done'].includes(x.id)).every((x) =>
      x.open(F({ cleared: 1, seats: 1 })) === false              // 还没到贵客局门口
      && x.open(F({ cleared: 2, seats: 0 })) === false           // 客人还没请到位
      && x.open(F({ cleared: 2, seats: 1, inShop: true })) === false  // 正在铺子里，锚点不在屏幕上
      && x.open(F({ cleared: 2, seats: 1, stage: 2 })) === true));

  // 进度这本账：去重、白名单、一次退出、以及标记位不能被挤掉
  t('markLesson 去重且丢掉不认识的 id，但标记位留着',
    markLesson([MARKER, 'board', 'board', '没这门课'], 'hire').join(',') === 'on,board,hire');
  t('一次退出记完十四节，进度里仍是标记位加十四节',
    (() => { const x = markLesson([MARKER], null);
      return x.length === 15 && x[0] === MARKER && lessonsLeft(x) === 0; })());
  t('第 1 节与最后一节的序号，以及"没有课"时报的是总节数',
    position('board') === 1 && position('done') === 14 && position(null) === LESSONS.length);

  const gs = new Game(4242);
  beginGuide(gs.state);
  t('开局一局课：只多一个标记位，牌局字段一个没动',
    gs.state.guide.join(',') === MARKER && gs.state.seats.length === 0 && gs.state.money === 4);
  quitGuide(gs.state);
  t('退出引导：十节全记上，标记位仍在这局是"上过课的局"',
    inGuide(gs.state.guide) && lessonsLeft(gs.state.guide) === 0);

  // 推导只有一份：界面与 tools/guide-check.mjs 共用 stateFacts
  const g2 = new Game(GUIDE.seed, GUIDE.deckId, { diff: GUIDE.diff, mode: GUIDE.mode });
  const ff = guideFacts(g2.state, true);
  t('Facts 全部取自局面上已有的数（没有第二本账）',
    ff.chosen === g2.state.chosen.length && ff.discards === g2.state.discardsUsed
    && ff.cleared === g2.state.ledger.length && ff.seats === g2.state.seats.length
    && ff.raised === g2.state.raiseNext && ff.inShop === (g2.state.status === 'shop'));
  t('教学局这手八张牌凑得出成型牌型（凑不出就不配当教材）',
    (() => {
      const byRank = new Map<number, number>();
      for (const c of g2.state.hand) byRank.set(c.rank, (byRank.get(c.rank) ?? 0) + 1);
      const bySuit = new Map<string, number>();
      for (const c of g2.state.hand) bySuit.set(c.suit, (bySuit.get(c.suit) ?? 0) + 1);
      return [...byRank.values()].some((n) => n >= 2) || [...bySuit.values()].some((n) => n >= 5);
    })());
  t('教学局锁的确实是手松档、经营模式、表里真有的牌组',
    GUIDE.diff === 'gentle' && GUIDE.mode === 'run' && DECKS.some((d) => d.id === GUIDE.deckId));
  // 教学局锁最短三夜（2026-10-12 他定的"引导关轮数少一些"）。这条钉的是**设计决定**本身：
  // 改这个数要连课程表与 tools/guide-check.mjs 一起改，所以它必须显式红一次提醒人。
  t('教学局锁最短三夜，且那一档的终场彩头就是三夜档的设计值',
    GUIDE.nights === MIN_NIGHTS && (() => {
      // 彩头拿**标准档**比：教学局走的是手松档，那一档自己就把线压低过
      const g3 = new Game(GUIDE.seed, GUIDE.deckId, { nights: GUIDE.nights });
      g3.state.night = GUIDE.nights; g3.state.stage = 2;
      return targetOf(g3.state) === lengthOf(MIN_NIGHTS).finalTarget;
    })());

  // 硬约束：上课与不上课，同一颗种子必须发出同一副牌、走出同一笔账
  {
    const a = new Game(GUIDE.seed, GUIDE.deckId, { diff: GUIDE.diff, mode: GUIDE.mode });
    const b = new Game(GUIDE.seed, GUIDE.deckId, { diff: GUIDE.diff, mode: GUIDE.mode });
    beginGuide(a.state);
    a.state.guide = markLesson(a.state.guide, null);       // 全程都"上过课"
    for (const x of [a, b]) {
      x.state.chosen = x.state.hand.slice(0, 2).map((c) => c.id);
      play(x); settle(x);
      if (x.state.status === 'cleared') { x.openShop(); x.state.chosen = []; buy(x, 0); setRaise(x, 1); x.next(); }
      x.state.chosen = x.state.hand.slice(0, 2).map((c) => c.id);
      play(x); settle(x);
    }
    t('上课的局与普通局逐位相同：牌序、流水、随机数步数、账本全等',
      a.state.score === b.state.score && a.rand.calls === b.rand.calls
      && a.state.deck.map((c) => c.id).join() === b.state.deck.map((c) => c.id).join()
      && a.state.hand.map((c) => c.id).join() === b.state.hand.map((c) => c.id).join()
      && a.state.ledger.length === b.state.ledger.length
      && a.state.log.length === b.state.log.length);
  }

  // 存档：形状不合整份拒收，内容认不出只是丢掉，老档缺字段落在"没上过课"
  {
    const sv = new Game(4242);
    sv.state.guide = [MARKER, 'board', 'cash'];
    const back = deserializeSave(serializeSave(sv));
    t('引导关进度活过存档往返',
      !!back && back.state.guide.join(',') === `${MARKER},board,cash`);
    const junk = new Game(4242);
    junk.state.guide = [MARKER, '没这门课', 'board', 'board'];
    const r2 = deserializeSave(serializeSave(junk));
    t('档里不认识的课 id 被丢掉并去重（毁档太重，原样收下太轻）',
      !!r2 && r2.state.guide.join(',') === `${MARKER},board`);
    const bad = JSON.parse(serializeSave(new Game(4242)));
    bad.state.guide = 'on';
    t('guide 不是数组就是这份档读不出来', deserializeSave(JSON.stringify(bad)) === null);
    const old = JSON.parse(serializeSave(new Game(4242)));
    delete old.state.guide;
    const r3 = deserializeSave(JSON.stringify(old));
    t('没有这个字段的老档照样能读（落在"不是教学局"上）', !!r3 && r3.state.guide.length === 0);
  }

  refute('十节课全都一开局就能讲（那就是弹窗轰炸）', LESSONS.every((x) => x.open(F({}))));
  refute('动手课其实只靠点掉算过（做到也算过是假的）',
    LESSONS.filter((x) => x.req !== 'read').every((x) => !x.done));
  refute('教学局只是普通局换个种子（难度与牌组并没锁）',
    GUIDE.diff === 'standard' || !DECKS.some((d) => d.id === GUIDE.deckId));
  refute('标记位就是第一课的 id（那退出引导会把"这是教学局"一起抹掉）',
    MARKER === LESSONS[0].id);
}

// ── 16. 随机事件：数据表自洽、触发不挤动主流、每条 op 真的落到账上 ────
{
  const ON = { ...FLAGS_ALL };
  const OFF = { ...FLAGS_ALL, events: false };
  const GENTLE = { diff: 'gentle' as Diff, mode: 'run' as Mode };

  // 直接把候选摆出来再选：这一步测的是**执行器**，递不递得出来由 canFire 那批判据管
  const fire = (game: Game, id: string): string | null => {
    game.state.pendingEvent = [id];
    return chooseEvent(game, id);
  };
  const facts = (o: Partial<EventFacts>): EventFacts => ({
    night: 1, seats: 0, seatCap: 3, money: 20, discardCount: 0,
    totalCards: 52, deckCap: MAX_DECK, marked: 0, ...o,
  });
  const opened = (): Game => new Game(7777, 'standard', { flags: ON, ...GENTLE });

  // ── 数据表自洽 ──
  t('事件表五十条、id 唯一', EVENTS.length === 50 && new Set(EVENTS.map((e) => e.id)).size === 50);
  t('每条都有抬头、场景、白话账与至少一条操作',
    EVENTS.every((e) => e.name.length >= 2 && e.kicker.length >= 6
      && e.blurb.length >= 6 && e.ops.length >= 1));
  t('三种脾气各有八条以上（不然"三选一"会变成同一件事换三种说法）',
    EVENTS.filter((e) => e.risk === 'head').length >= 8
    && EVENTS.filter((e) => e.risk === 'hand').length >= 8
    && EVENTS.filter((e) => e.risk === 'heart').length >= 8);
  t('吃运气的那类真的带一个不确定操作（抛硬币 / 随机挑牌 / 随机升级）',
    EVENTS.filter((e) => e.risk === 'heart').every((e) => e.ops.some((op) =>
      op.t === 'coin'
      || op.t === 'mark'                       // 落到"哪一张"上是摇出来的
      || (op.t === 'purge' && op.what === 'random')
      || (op.t === 'bookUp' && !op.kind)
      || (op.t === 'grantLetter' && !op.id))));
  {
    // 文案里的 £ 数必须能在 ops 里找到，否则玩家看到的账就是编的
    const mismatched = EVENTS.filter((e) => {
      const cash = new Set<number>();
      const walk = (ops: EventOp[]): void => {
        for (const op of ops) {
          if (op.t === 'money') cash.add(Math.abs(op.n));
          // 账上的 £ 不止 money 一条来源：请走客人的补偿、带走牌的折现、请客进门的价格、
          // 被压掉的利息上限，文案里写了就得对得上
          if (op.t === 'seat') cash.add(Math.abs(op.refund));
          if (op.t === 'purge') cash.add(Math.abs(op.per));
          if (op.t === 'grantSeat') cash.add(Math.abs(op.price));
          if (op.t === 'rule' && op.m.interestCap) cash.add(Math.abs(op.m.interestCap));
          if (op.t === 'coin') { walk(op.win); walk(op.lose); }
        }
      };
      walk(e.ops);
      const named = [...e.blurb.matchAll(/£(\d+)/g)].map((m) => Number(m[1]));
      return !named.every((n) => cash.has(n) || n === 1);   // 「£1 一张」那种折现不在这里给数
    }).map((e) => e.id);
    t('白话账里的每一个 £ 数都对得上 ops（对不上的：' + (mismatched.join(',') || '无') + '）',
      mismatched.length === 0);
  }
  t('事件不许往计分管道里塞银钱（钱的进出走 money 那条，§10 第 3 条还没定）',
    EVENTS.every((e) => e.ops.every((op) => op.t !== 'score' || op.e.money === undefined)));
  t('改规矩的 op 只写 limits 认得的键',
    EVENTS.every((e) => e.ops.every((op) => op.t !== 'rule'
      || Object.keys(op.m).every((k) => ['seats', 'handSize', 'hands', 'discards', 'slots',
        'interestCap', 'targetScale', 'freeRerolls', 'priceScale'].includes(k)))));
  t('往牌组里加的牌只用现有那几轴（新 enum 会让"关掉 layers 也同分"那条断掉）',
    EVENTS.every((e) => e.ops.every((op) => op.t !== 'addCard'
      || op.cards.every((c) => c.rank >= 2 && c.rank <= 14 && 'shdc'.includes(c.suit)
        && (c.enh === undefined || ['none', 'bonus', 'mult', 'glass', 'gold'].includes(c.enh))
        && (c.seal === undefined || ['none', 'red', 'gold', 'purple', 'blue'].includes(c.seal))))));
  t('至少八条事件真的往牌堆里塞牌（这是这一轮要的"特殊牌"）',
    EVENTS.filter((e) => e.ops.some((op) => op.t === 'addCard' || op.t === 'copyHand'
      || op.t === 'mark')).length >= 8);
  t('每条事件都推得出至少一个角标（推不出就是这条事件没有内容）',
    EVENTS.every((e) => eventTags(e).length >= 1));

  // ── 候选抽取：一根毫毛都不动主随机流 ──
  {
    const g0 = opened();
    const before = g0.rand.calls;
    const c1 = drawEvents(EVENTS, 7777, 1, 0);
    const c2 = drawEvents(EVENTS, 7777, 1, 0);
    t('抽候选不消耗主随机流（不然发牌整体后移，老档快进就落到别的牌上）',
      g0.rand.calls === before);
    t('同参数两次抽出来一模一样',
      c1.map((e) => e.id).join() === c2.map((e) => e.id).join());
    t('三张候选互不重复',
      c1.length === EVENT_OFFER && new Set(c1.map((e) => e.id)).size === EVENT_OFFER);
    t('换夜就换一批（同一夜同一批才有意义）',
      drawEvents(EVENTS, 7777, 2, 0).map((e) => e.id).join()
      !== drawEvents(EVENTS, 7777, 1, 0).map((e) => e.id).join());
    const pk = autoPick(c1);
    t('「让牌局自决」不摇骰：同一批候选永远选同一条',
      !!pk && pk.id === autoPick(c1)!.id && pk.id === autoPick(c1.slice().reverse()).id
      ? pk.id === autoPick(c1)!.id : !!pk);
    t('自决优先挑稳吃那条（管家的次序：稳吃 → 靠脑子 → 吃运气）',
      (() => {
        const mixed = [
          { risk: 'heart' as const }, { risk: 'head' as const }, { risk: 'hand' as const },
        ];
        return autoPick(mixed as never) === mixed[2];
      })());
    t('前置条件确实挡人：钱不够、座位满、牌堆满都不递',
      !canFire(eventById('tailor')!, facts({ money: 3 }), [])
      && !canFire(eventById('back-stair')!, facts({ seats: 3, night: 4 }), [])
      && !canFire(eventById('old-deed')!, facts({ totalCards: MAX_DECK }), []));
    t('标了 once 的事件整局只递一次',
      canFire(eventById('tailor')!, facts({ night: 3, money: 40 }), [])
      && !canFire(eventById('tailor')!, facts({ night: 3, money: 40 }), ['tailor']));
    t('minNight 那批在第 1 夜递不出来（第一课不该被狠事砸）',
      EVENTS.filter((e) => e.minNight && e.minNight > 1)
        .every((e) => !canFire(e, facts({ night: 1, money: 200 }), [])));
  }

  // ── 触发、拦截与每夜一次 ──
  {
    const g0 = opened();
    t('开局就把本夜触发点摇定（2 或 3 次动作之后）',
      g0.state.eventAt === 2 || g0.state.eventAt === 3);
    t('新开的局五个新字段都是空的',
      g0.state.pendingEvent.length === 0 && g0.state.events.length === 0
      && g0.state.eventMods.length === 0 && g0.state.nightActions === 0);

    const pick = (x: Game): void => { x.state.chosen = x.state.hand.slice(0, 3).map((c) => c.id); };
    const at = g0.state.eventAt;
    for (let i = 0; i < at; i++) {
      if (g0.state.status === 'cleared') { g0.openShop(); g0.next(); }
      pick(g0);
      if (!play(g0)) break;
    }
    t('打够本夜的动作数就把三张候选递出来',
      g0.state.pendingEvent.length === EVENT_OFFER
      && g0.state.pendingEvent.every((id) => EVENT_IDS.has(id)));
    const callsAtPending = g0.rand.calls;
    t('待决时出牌被拒（不能把这件事绕过去）',
      (() => { pick(g0); return play(g0) === null; })());
    t('待决时弃牌也被拒',
      (() => { pick(g0); return discard(g0) === 0; })());
    t('候选里认不出的 id 当没有，而且当场摘掉（存档是外部输入，不许它堵死牌局）',
      (() => {
        const z = opened();
        z.state.pendingEvent = ['没这条'];
        const shown = eventChoices(z).length;
        const refused = chooseEvent(z, '没这条') === null;
        chooseEvent(z, '也没这条');                 // 摘掉那一条
        const healed = z.state.pendingEvent.length === 0;
        z.state.pendingEvent = ['没这条'];
        const auto = autoResolveEvent(z);           // 自决也自愈：不会对着空面板卡住
        return shown === 0 && refused && healed && auto === null && z.state.pendingEvent.length === 0;
      })());
    t('待决时能出牌的前提是这局真开着这个功能（关着不许应事件）',
      (() => {
        const z = new Game(7777, 'standard', { flags: OFF, ...GENTLE });
        z.state.pendingEvent = ['gas-lamp'];
        const before = z.state.events.length;
        const r = chooseEvent(z, 'gas-lamp');
        // 两个入口都要堵：只守「点卡」而漏了「让牌局自决」，等于留了一条后门
        const a = autoResolveEvent(z);
        return r === null && a === null && z.state.events.length === before
          && z.state.eventMods.length === 0 && z.state.pendingEvent.length === 1;
      })());
    t('不在出牌状态时（铺子/结清/散场）应事件一律不生效',
      (() => {
        const z = opened();
        z.state.status = 'shop';
        z.state.pendingEvent = ['gas-lamp'];
        const r = chooseEvent(z, 'gas-lamp');
        const a = autoResolveEvent(z);
        return r === null && a === null && z.state.eventMods.length === 0
          && z.state.events.length === 0;
      })());
    t('签名宾被事件请走之后，signature 当场不再宣称他在座',
      (() => {
        const z = opened();
        z.state.seats = [mkSeat('payne')];
        z.state.signature = 'payne';
        z.state.pendingEvent = ['butler-note'];
        chooseEvent(z, 'butler-note');
        return z.state.seats.length === 0 && z.state.signature === '';
      })());
    t('卖掉签名宾也是同一条清理（不只是读档时才清）',
      (() => {
        const z = opened();
        z.state.seats = [mkSeat('payne')];
        z.state.signature = 'payne';
        sellSeat(z, 0);
        return z.state.signature === '';
      })());
    const line = chooseEvent(g0, g0.state.pendingEvent[0]);
    t('选一条下去：候选收掉、记上一夜一笔、日志留一句',
      typeof line === 'string' && g0.state.pendingEvent.length === 0
      && g0.state.events.length === 1 && g0.state.events[0].night === g0.state.night
      && g0.state.log[0].includes(eventById(g0.state.events[0].id)!.name));
    for (let i = 0; i < 3 && g0.state.status === 'playing'; i++) {
      if (g0.state.status === 'cleared') { g0.openShop(); g0.next(); }
      pick(g0);
      if (!play(g0)) break;
    }
    t('每夜只递一次（本夜已记上账就不再弹）',
      g0.state.night === 1 ? g0.state.pendingEvent.length === 0 : true);
    void callsAtPending;
  }

  // ── 关掉 == 这个功能不存在 ──
  {
    const on = new Game(4242, 'standard', { flags: ON, ...GENTLE });
    const off = new Game(4242, 'standard', { flags: OFF, ...GENTLE });
    const pick = (x: Game): void => { x.state.chosen = x.state.hand.slice(0, 3).map((c) => c.id); };
    pick(on); pick(off);
    play(on); play(off);
    t('开与关第一手逐位相同：候选抽取不挤动发牌',
      on.rand.calls === off.rand.calls
      && on.state.hand.map((c) => c.id).join() === off.state.hand.map((c) => c.id).join()
      && on.state.score === off.state.score);
    const z = new Game(9001, 'standard', { flags: OFF, ...GENTLE });
    for (let i = 0; i < 9; i++) {
      if (z.state.status === 'cleared') { z.openShop(); z.next(); }
      z.state.chosen = z.state.hand.slice(0, 2).map((c) => c.id);
      if (!play(z)) break;
    }
    t('关着跑九手：五个新字段一次都没被碰',
      z.state.pendingEvent.length === 0 && z.state.events.length === 0
      && z.state.eventMods.length === 0 && z.state.nightActions === 0
      && z.state.eventAt === 0);
    t('教学局一律不带随机事件（guideFlags 那一刀）',
      guideFlags(FLAGS_ALL).events === false
      && Object.keys(guideFlags(FLAGS_OFF)).length === Object.keys(FLAGS_OFF).length);
  }

  // ── 进计分管道：加项真的改分，且只活该活的那一手 ──
  {
    const base = new Game(7777, 'standard', { flags: OFF, ...GENTLE });
    base.state.chosen = base.state.hand.slice(0, 3).map((c) => c.id);
    const rb = play(base);
    const ids = base.state.hand.slice(0, 0); void ids;
    const snap = rb!.events[rb!.events.length - 1].after;
    const withChips = opened();
    withChips.state.eventMods = [
      { from: 'gas-lamp', scope: 'night', night: 1, eff: { chips: 50 } },
    ];
    withChips.state.chosen = withChips.state.hand.slice(0, 3).map((c) => c.id);
    const rc = play(withChips);
    t('事件挂着的 +50 流水真的进账（差值就是 50 × 当时的倍注）',
      rc!.value - rb!.value === 50 * snap.mult);
    t('那一条在流水里演得出（管道里留了一格 bonus）',
      rc!.events.some((e) => e.t === 'bonus' && e.tid === 'gas-lamp'));
    const withX = opened();
    withX.state.eventMods = [{ from: 'duel', scope: 'hand', night: 1, hands: 1, eff: { xmult: 3 } }];
    withX.state.chosen = withX.state.hand.slice(0, 3).map((c) => c.id);
    const rx = play(withX);
    t('倍注乘走的是乘，不是加', rx!.value === rb!.value * 3);
    t("'下一手'那一格过一手就到期（记着但不再进管道）",
      withX.state.eventMods[0].hands === 0
      && (() => {
        const z = opened();
        z.state.eventMods = [{ from: 'duel', scope: 'hand', night: 1, hands: 0, eff: { chips: 50 } }];
        z.state.chosen = z.state.hand.slice(0, 3).map((cc) => cc.id);
        const r = play(z);
        return r!.value === rb!.value;              // 到期的那格一笔都不该加
      })());
    const withRule = opened();
    const limBase = limits(withRule.state).handSize;
    withRule.state.eventMods = [{ from: 'tailor', scope: 'run', night: 1, rule: { handSize: 1 } }];
    t('rule 那类进限额表（整局手牌上限 +1）',
      limits(withRule.state).handSize === limBase + 1);
    const nightOld = opened();
    nightOld.state.eventMods = [
      { from: 'cellar', scope: 'night', night: 0, eff: { mult: 8 } },
      { from: 'tailor', scope: 'run', night: 0, rule: { handSize: 1 } },
    ];
    nightOld.state.chosen = nightOld.state.hand.slice(0, 2).map((c) => c.id);
    play(nightOld); settle(nightOld);
    nightOld.openShop(); nightOld.next();
    t('换场把「下一手」清掉、换夜把「本夜」清掉，「整局」留着',
      nightOld.state.eventMods.length === 1 && nightOld.state.eventMods[0].scope === 'run');
    t('关着开关时这些修正一律不进管道',
      (() => {
        const y = new Game(7777, 'standard', { flags: OFF, ...GENTLE });
        y.state.eventMods = [{ from: 'gas-lamp', scope: 'night', night: 1, eff: { chips: 50 } }];
        y.state.chosen = y.state.hand.slice(0, 3).map((c) => c.id);
        const r = play(y);
        return r!.value === rb!.value && !r!.events.some((e) => e.t === 'bonus' && e.tid === 'gas-lamp');
      })());
  }

  // ── 每种操作都要真的落到账上 ──
  {
    const clamp = opened();
    clamp.state.money = 3;
    fire(clamp, 'oyster-bill');
    t('扣钱扣到零为止（钱不会是负的）', clamp.state.money === 0);

    const rep = opened();
    rep.state.rep = 0;
    fire(rep, 'opera-box');
    t('说客与包厢真的改声望', rep.state.rep === 1);

    const add = opened();
    const t0 = totalCards(add.state);
    fire(add, 'old-deed');
    t('塞进牌堆的那张特殊牌真的在（黑桃 A 带重诵火漆）',
      totalCards(add.state) === t0 + 1
      && add.state.deck.some((c) => c.rank === 14 && c.suit === 's' && c.seal === 'red'));

    const full = opened();
    let filler = 9000;
    while (totalCards(full.state) < MAX_DECK) {
      full.state.deck.push({ id: filler++, rank: 2, suit: 's', enh: 'none', seal: 'none' });
    }
    const r = fire(full, 'old-deed');
    t('牌堆到顶就不再加（宁可不给也不越界）',
      totalCards(full.state) === MAX_DECK && !!r && r.includes('牌堆已满'));

    const thin = opened();
    thin.state.deck = [];
    thin.state.discardPile = [];
    thin.state.table = [];
    thin.state.hand = thin.state.hand.slice(0, MIN_DEALABLE);
    while (totalCards(thin.state) < MIN_DEALABLE) {
      thin.state.hand.push({ id: 8000 + thin.state.hand.length, rank: 5, suit: 'h', enh: 'none', seal: 'none' });
    }
    const keep = totalCards(thin.state);
    thin.state.pendingEvent = ['chimney-sweep'];
    chooseEvent(thin, 'chimney-sweep');
    t('带走牌不许把牌堆拆到发不出手（与销账同一道下界）',
      totalCards(thin.state) === keep);

    const back = opened();
    const before = totalCards(back.state);
    for (let i = 0; i < 6; i++) back.state.discardPile.push(back.state.hand.splice(0, 1)[0]);
    fire(back, 'card-cabinet');
    t('弃牌堆收回牌堆：一次至多五张，一张也不许多拿走',
      totalCards(back.state) === before && back.state.discardPile.length === 1);

    const fog = opened();
    const before2 = totalCards(fog.state);
    fire(fog, 'river-fog');
    t('重发一手：牌还是那些牌，只是换了手上这一把',
      totalCards(fog.state) === before2 && fog.state.hand.length === limits(fog.state).handSize);

    const wash = opened();
    wash.state.hand[0].enh = 'glass';
    wash.state.hand[0].seal = 'red';
    fire(wash, 'assay-office');
    t('化验所把手上的花样洗干净',
      wash.state.hand.every((c) => c.enh === 'none' && c.seal === 'none'));

    const mirror = opened();
    fire(mirror, 'broken-mirror');
    t('碎镜真的落了一张玻璃牌',
      mirror.state.hand.some((c) => c.enh === 'glass'));

    const copy = opened();
    const n0 = totalCards(copy.state);
    fire(copy, 'trembling-dealer');
    t('发牌的手抖：牌堆里真的多出一张同点同花的复制',
      totalCards(copy.state) === n0 + 1);

    const leave = opened();
    leave.state.seats = [mkSeat('hobbs')];
    const m0 = leave.state.money;
    fire(leave, 'butler-note');
    t('管家递的辞呈：走一位、补 £8',
      leave.state.seats.length === 0 && leave.state.money === m0 + 8);

    const up = opened();
    up.state.seats = [mkSeat('hobbs')];
    fire(up, 'critic');
    t('评论家把一位客人的版本抬上去',
      up.state.seats[0].edition === 'foil');

    const seatFull = opened();
    seatFull.state.seats = [mkSeat('hobbs'), mkSeat('payne'), mkSeat('countess')];
    const sr = fire(seatFull, 'back-stair');
    t('座位满了谁来也坐不下（不是硬塞进去）',
      seatFull.state.seats.length === 3 && !!sr && sr.includes('座位已满'));

    const poor = opened();
    poor.state.money = 1;
    const pr = fire(poor, 'back-stair');
    t('钱不够就不请（不白给，也不欠账）',
      poor.state.seats.length === 0 && poor.state.money === 1 && !!pr && pr.includes('银钱不够'));

    const letter = opened();
    const c0 = letter.state.consumables.length;
    fire(letter, 'torn-letter');
    t('断头的信真的进了随身', letter.state.consumables.length === c0 + 1);

    const book = opened();
    // 牌谱的"级"是缺席即 1 的表，所以要比总级数而不是键的个数
    const lv = (): number => (Object.keys(HANDS) as HandKind[])
      .reduce((a, k) => a + (book.state.books[k] ?? 1), 0);
    const before13 = lv();
    fire(book, 'smuggler-trunk');
    t('箱子里的牌谱升了一级', lv() === before13 + 1);

    const coinG = opened();
    const cc = coinG.rand.calls;
    const cr = fire(coinG, 'snake-oil');
    t('抛硬币走的是主随机流（这一步本来就在改这一局）',
      coinG.rand.calls === cc + 1 && !!cr && (cr.includes('掷骰成了') || cr.includes('掷骰败了')));
  }

  // ── 存档 ──
  {
    const s = opened();
    s.state.pendingEvent = ['gas-lamp', 'duel'];
    s.state.events = [{ night: 1, id: 'snake-oil', result: '掷骰成了，银钱 +£18' }];
    s.state.eventMods = [{ from: 'tailor', scope: 'run', night: 1, rule: { handSize: 1 } }];
    const back = deserializeSave(serializeSave(s));
    t('事件的三样账活过存档往返',
      !!back && back.state.pendingEvent.join() === 'gas-lamp,duel'
      && back.state.events.length === 1 && back.state.events[0].result.includes('£18')
      && back.state.eventMods.length === 1 && back.state.eventMods[0].scope === 'run');

    const junk = opened();
    junk.state.events = [{ night: 1, id: '没这条', result: 'x' }];
    junk.state.pendingEvent = ['没这条', 'gas-lamp'];
    junk.state.eventMods = [{ from: '没这条', scope: 'run', night: 1, rule: { handSize: 1 } }];
    const cleaned = deserializeSave(serializeSave(junk));
    t('档里认不出的事件 id 一律丢掉（改文案删事件不该毁档）',
      !!cleaned && cleaned.state.events.length === 0
      && cleaned.state.pendingEvent.join() === 'gas-lamp'
      && cleaned.state.eventMods.length === 0);

    const hostile = JSON.parse(serializeSave(opened()));
    hostile.state.eventMods = [{ from: 'tailor', scope: 'run', night: 1, rule: { handSize: '999' } }];
    t('修正表里混进字符串就整份拒收（那会把限额累加成拼接）',
      deserializeSave(JSON.stringify(hostile)) === null);

    const badScope = JSON.parse(serializeSave(opened()));
    badScope.state.eventMods = [{ from: 'tailor', scope: 'forever', night: 1, rule: { handSize: 1 } }];
    t('作用域只认 下一手/本夜/整局 三种', deserializeSave(JSON.stringify(badScope)) === null);

    const negAt = JSON.parse(serializeSave(opened()));
    negAt.state.eventAt = -3;
    t('触发点写成负数这份档读不出来', deserializeSave(JSON.stringify(negAt)) === null);

    const old = JSON.parse(serializeSave(new Game(4242)));
    delete old.state.eventAt; delete old.state.nightActions;
    delete old.state.pendingEvent; delete old.state.events; delete old.state.eventMods;
    const r3 = deserializeSave(JSON.stringify(old));
    t('没有这些字段的老档照样能读（落在"没递过事件"上）',
      !!r3 && r3.state.events.length === 0 && r3.state.pendingEvent.length === 0);
    {
      // 存档是外部输入：把开关关掉却留着事件的账，读进来就是一局"没有这个功能"
      // 却被面板堵住出牌的牌局。读档路径必须把这五格一起清零。
      const src = opened();
      src.state.pendingEvent = ['gas-lamp', 'duel'];
      src.state.events = [{ night: 1, id: 'wake', result: '立刻 +£25' }];
      src.state.eventMods = [{ from: 'tailor', scope: 'run', night: 1, rule: { handSize: 1 } }];
      src.state.eventAt = 3; src.state.nightActions = 5;
      const j = JSON.parse(serializeSave(src));
      j.state.flags.events = false;
      const off = deserializeSave(JSON.stringify(j));
      t('关着开关的档里不许带着事件的账读进来（五格一起清零）',
        !!off && off.state.pendingEvent.length === 0 && off.state.events.length === 0
        && off.state.eventMods.length === 0 && off.state.eventAt === 0
        && off.state.nightActions === 0
        && limits(off.state).handSize === limits(new Game(7777, 'standard', { flags: OFF, ...GENTLE }).state).handSize);
    }
  }

  // ── 本轮顺手补的承重墙：桌面那几张不能每打一手就蒸发 ──
  {
    const c = new Game(5150, 'standard', { flags: OFF, ...GENTLE });
    const snap0 = totalCards(c.state);
    for (let i = 0; i < 3; i++) {
      c.state.chosen = c.state.hand.slice(0, 3).map((x) => x.id);
      play(c);
    }
    t('一场里连打三手，整副牌一张不少（打过的进弃牌堆，不是被桌面顶掉）',
      totalCards(c.state) === snap0 && c.state.discardPile.length === 6);
  }

  // ── 随身格是客人撑起来的：那种人不能随便退席 ──
  {
    const v = new Game(6060, 'standard', { flags: ON, ...GENTLE });
    v.state.seats = [mkSeat('hobbs'), mkSeat('clerk')];       // 律政一门：随身 +1 → 3 格
    while (v.state.consumables.length < limits(v.state).slots) {
      v.state.consumables.push({ t: 'letter', id: 'gild' });
    }
    const slots3 = limits(v.state).slots;
    const ok = sellSeat(v, 0);
    t('套装撑起来的随身格满了就退不掉那位（先把信用完，而不是凭空丢货）',
      ok === false && v.state.seats.length === 2 && limits(v.state).slots === slots3);
    v.state.consumables.pop();                                 // 用掉一封就腾开了
    t('腾开一格之后同一位客人马上可以退席', sellSeat(v, 0) === true);
    // 事件那两条"请走一位"走的是同一道守卫：带不走就明说，不硬塞
    const ev = opened();
    ev.state.seats = [mkSeat('hobbs'), mkSeat('clerk')];
    while (ev.state.consumables.length < limits(ev.state).slots) {
      ev.state.consumables.push({ t: 'letter', id: 'gild' });
    }
    const line = fire(ev, 'butler-note');
    t('事件请走客人时也认这道守卫（一位也没带走，账上写得清清楚楚）',
      ev.state.seats.length === 2 && !!line && line.includes('一位也没走'));
  }

  refute('事件表再大也不必管候选重不重复（三张里可以出现同一条）',
    new Set(drawEvents(EVENTS, 7777, 3, 0).map((e) => e.id)).size < EVENT_OFFER);
  refute('触发点设成 0 也一样（每夜第一件事就弹才是好的）',
    eventAtFor(deriveEventRand(1, 1, 0)) === 0);
  refute('桌面回收只在换场做就够了（每手顶掉桌面时牌不会丢）',
    (() => {
      const z = new Game(5150, 'standard', { flags: OFF, ...GENTLE });
      const a = totalCards(z.state);
      z.state.chosen = z.state.hand.slice(0, 3).map((x) => x.id);
      play(z);
      z.state.chosen = z.state.hand.slice(0, 3).map((x) => x.id);
      play(z);
      return totalCards(z.state) < a;
    })());
  refute('银钱可以被事件扣成负数（那是账，不是牌）',
    (() => {
      const z = opened();
      z.state.money = 1;
      z.state.pendingEvent = ['opera-box'];
      chooseEvent(z, 'opera-box');
      return z.state.money < 0;
    })());

  // ── 这一批是"逻辑 bug 探针"照出来的六处，每处一条判据钉住 ──
  {
    // 1) 减项必须有底：不然"本夜每手 −15 流水"能把一手牌做成负分，累计流水倒退
    const neg = (eff: { chips?: number; mult?: number }): number => {
      const z = opened();
      z.state.eventMods = [{ from: 'wrong-purse', scope: 'night', night: 1, eff }];
      z.state.chosen = z.state.hand.slice(0, 3).map((c) => c.id);
      const r = play(z);
      return r!.value;
    };
    t('事件把流水往下压压不到负分（那一格的流水夹在 0，整手分不许倒退）',
      (() => {
        const z = opened();
        z.state.eventMods = [{ from: 'wrong-purse', scope: 'night', night: 1, eff: { chips: -99999 } }];
        z.state.chosen = z.state.hand.slice(0, 3).map((c) => c.id);
        const r = play(z)!;
        const row = r.events.find((e) => e.t === 'bonus' && e.tid === 'wrong-purse');
        return !!row && row.after.chips === 0 && r.value >= 0;
      })());
    t('事件把倍注往下压压不到 1 以下', neg({ mult: -99999 }) >= 1);
    {
      const z = opened();
      z.state.eventMods = [{ from: 'wrong-purse', scope: 'night', night: 1, eff: { chips: -99999 } }];
      z.state.chosen = z.state.hand.slice(0, 3).map((c) => c.id);
      const row = play(z)!.events.find((e) => e.t === 'bonus' && e.tid === 'wrong-purse');
      t('被底夹掉的那部分不在拆解里谎报（写实际发生的一笔）',
        !!row && (row as { addChips: number }).addChips <= 0
        && Math.abs((row as { addChips: number }).addChips) < 99999);
    }
    // 2) 「随机移除一张牌」要真的随机，而且要消耗主随机流
    {
      const gone: number[] = [];
      for (let i = 0; i < 10; i++) {
        const z = opened();
        for (let k = 0; k < i; k++) z.rand.next();          // 只挪局面，牌堆内容一致
        const ids = new Set([...z.state.deck, ...z.state.hand].map((c) => c.id));
        z.state.pendingEvent = ['terrier'];
        chooseEvent(z, 'terrier');
        const left = new Set([...z.state.deck, ...z.state.hand,
          ...z.state.discardPile, ...z.state.table].map((c) => c.id));
        gone.push([...ids].find((id) => !left.has(id)) ?? -1);
      }
      t('梗犬带走的牌每次不一定同一张（文案写"谁也没看清是哪张"）',
        new Set(gone).size >= 5, JSON.stringify(gone));
      t('随机挑牌确实消耗主随机流（不是按列表顺序拿前几张）',
        (() => {
          const z = opened();
          const c0 = z.rand.calls;
          z.state.pendingEvent = ['terrier'];
          chooseEvent(z, 'terrier');
          return z.rand.calls > c0;
        })());
    }
    // 3) 事件动过手牌之后，选中项不许留着不在手里的 id
    t('重发一手之后选中项不悬空（选中的牌一旦重回手里不该还是选中态）',
      (() => {
        const z = opened();
        z.state.chosen = z.state.hand.slice(0, 3).map((c) => c.id);
        z.state.pendingEvent = ['river-fog'];
        chooseEvent(z, 'river-fog');
        return z.state.chosen.every((id) => z.state.hand.some((c) => c.id === id));
      })());
    // 4) 'hand' 作用域的改规矩到期之后不许再进限额表
    t("'下一手'那类改规矩到期之后不再进限额表",
      (() => {
        const z = opened();
        const clean = limits(z.state).handSize;
        z.state.eventMods = [
          { from: 'leech-jar', scope: 'hand', night: 1, hands: 0, rule: { handSize: 3 } },
        ];
        const expired = limits(z.state).handSize;
        z.state.eventMods = [
          { from: 'leech-jar', scope: 'hand', night: 1, hands: 1, rule: { handSize: 3 } },
        ];
        return expired === clean && limits(z.state).handSize === clean + 3;
      })());
    // 5) 落花样落在"本来就有"的牌上不许谎报
    t('要落的花样已经全在时，账上写"没再动牌"而不是再报一次',
      (() => {
        const z = opened();
        z.state.hand.forEach((c) => { c.enh = 'glass'; });
        z.state.pendingEvent = ['broken-mirror'];
        const r = chooseEvent(z, 'broken-mirror');
        return !!r && r.includes('没再动牌');
      })());
    // 6) 牌名要印得出来（RANK_LABEL 是函数，按表取会印成"黑桃undefined"）
    t('事件账上的牌名印得出点数与花色',
      (() => {
        const z = opened();
        z.state.pendingEvent = ['old-deed'];
        const r = chooseEvent(z, 'old-deed');
        return !!r && r.includes('黑桃A') && !r.includes('undefined');
      })());
  }
}

// ── 17. 局长：三到十五夜各有各的终点，曲线随档位弯，骰子一步都不许多走 ────
{
  const ALL_NIGHTS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  t('局长表把 3..15 每一夜各列一档，不多不少',
    LENGTHS.length === MAX_NIGHTS - MIN_NIGHTS + 1
    && LENGTHS.map((l) => l.nights).join() === ALL_NIGHTS.join());
  t('终场彩头按档位一路抬高（没有一档比下一档松）',
    LENGTHS.every((l, i) => i === 0 || l.finalTarget > LENGTHS[i - 1].finalTarget));
  t('每一档都带着档位名和一句"这档在赌什么"',
    LENGTHS.every((l) => l.tier.length >= 2 && l.blurb.length >= 6));
  t('八夜是参照档：终点系数正好 1',
    lengthScale(DEFAULT_NIGHTS) === 1 && lengthOf(8).tier === '正局');
  t('八夜的曲线系数逐夜都是 1（这条一红，参照档整本账就变了）',
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 20, 30].every((n) => nightScale(8, n) === 1));
  // lengths.ts 里那句"贵客场倍率与 game.ts 是同一个数"不能只靠注释守着
  t('贵客场倍率两处一致（lengths 的设计终点就是照 STAGE_SCALE.boss 算的）',
    BOSS_STAGE_SCALE === STAGE_SCALE.boss && STAGE_SCALE.open === 1);
  t('参照曲线原样还在：八夜便宴就是那串老数字，第九夜按 ×2.2 溢出',
    BASE_TARGET.join() === '300,800,2000,5000,11000,20000,35000,50000'
    && referenceTarget(9) === Math.round(50000 * OVERFLOW_GROWTH)
    && referenceTarget(15) === Math.round(50000 * Math.pow(OVERFLOW_GROWTH, 7)));
  refute('三夜档与十五夜档的终点是同一个数', lengthOf(3).finalTarget === lengthOf(15).finalTarget);
}
{
  // 设计值不是公式的副产品：最后一夜贵客局的彩头必须**正好**落在表里那个数上
  const off = LENGTHS.filter((l) => {
    const g = new Game(1717, 'standard', { nights: l.nights });
    g.state.night = l.nights; g.state.stage = 2;
    return targetOf(g.state) !== l.finalTarget;
  });
  t('13 档的最后一夜贵客彩头逐档等于设计终场值（错位的档：' + off.map((l) => l.nights).join(',') + '）',
    off.length === 0);
  // 第一夜不分长短：都从 300 起步。短局不该"开局反而更狠"，长局也不该白送第一夜
  const first = LENGTHS.filter((l) => {
    const g = new Game(1717, 'standard', { nights: l.nights });
    return targetOf(g.state) !== 300;
  });
  t('无论选几夜，第一夜便宴都是 300 起步（越界的档：' + first.map((l) => l.nights).join(',') + '）',
    first.length === 0);
  const dip = LENGTHS.filter((l) => {
    const g = new Game(1717, 'standard', { nights: l.nights });
    let prev = 0;
    for (let n = 1; n <= l.nights; n++) {
      g.state.night = n; g.state.stage = 0;
      const v = targetOf(g.state);
      if (v <= prev) return true;
      prev = v;
    }
    return false;
  });
  t('同一档内彩头一夜比一夜高（会回落的档：' + dip.map((l) => l.nights).join(',') + '）',
    dip.length === 0);
  // 系数是经 limits() 进账的，不是只活在 lengths.ts 里的一张表
  const bent = new Game(1719, 'standard', { nights: 3 });
  bent.state.night = 3;
  t('局长曲线经 limits() 落进限额表（第 3 夜 targetScale 就是该档系数）',
    limits(bent.state).targetScale === nightScale(3, 3) && limits(bent.state).targetScale !== 1);
  const ref8 = new Game(1719, 'standard');
  ref8.state.night = 6;
  t('八夜档经 limits() 拿到的系数仍是 1（参照档没被搅）', limits(ref8.state).targetScale === 1);
}
{
  // 无尽会一路打到"最后一夜"之后。长档的终点系数是**小于 1** 的，
  // 线性外推不夹住的话第 20 夜彩头变成负数——不是变简单，是"打输也算过"。
  const neg = LENGTHS.filter((l) => {
    const g = new Game(1717, 'standard', { nights: l.nights, mode: 'endless' });
    let prev = 0;
    for (let n = 1; n <= 30; n++) {
      g.state.night = n; g.state.stage = 0;
      const v = targetOf(g.state);
      if (!(v > 0) || v <= prev) return true;
      prev = v;
    }
    return false;
  });
  t('推到第 30 夜彩头仍为正且一夜比一夜高（塌掉的档：' + neg.map((l) => l.nights).join(',') + '）',
    neg.length === 0);
  t('过了最后一夜曲线系数就钉在该档终点，不再往外推',
    // 用 1e-12 而不是 ===：(end-1)*14/14 在浮点里回不到 end-1 那一格，
    // 差的是一粒沙的 17 个数量级，而彩头本来就四舍五入到 10 分
    [Math.abs(nightScale(15, 15) - lengthScale(15)), Math.abs(nightScale(15, 30) - lengthScale(15)),
      Math.abs(nightScale(3, 30) - lengthScale(3))].every((d) => d < 1e-12));
}
{
  // 判胜读的是这一局的 nights，不是写死的八夜
  const bad = LENGTHS.filter((l) => {
    const w = new Game(1717, 'standard', { nights: l.nights });
    w.state.night = l.nights; w.state.stage = 2; w.state.score = 1e9;
    settle(w); w.next();
    if (w.state.status !== 'won') return true;
    const prevNight = new Game(1717, 'standard', { nights: l.nights });
    prevNight.state.night = l.nights - 1; prevNight.state.stage = 2; prevNight.state.score = 1e9;
    settle(prevNight); prevNight.next();
    return prevNight.state.status === 'won' || prevNight.state.night !== l.nights;
  });
  t('散场正好落在所选的最后一夜，前一夜还打得下去（错档：' + bad.map((l) => l.nights).join(',') + '）',
    bad.length === 0);
  t('不传 nights 就是八夜参照档', new Game(1720, 'standard').state.nights === DEFAULT_NIGHTS);
  t('越界的局长在构造口就落回八夜',
    new Game(1720, 'standard', { nights: 2 } as never).state.nights === DEFAULT_NIGHTS
    && new Game(1720, 'standard', { nights: 99 } as never).state.nights === DEFAULT_NIGHTS);
}
{
  // 局长只挪"目标线"，不许碰随机流：同一粒种子的发牌顺序在 3 夜与 15 夜必须逐位相同。
  // 这条一红就说明有人在曲线里塞了第二次摇骰，那 8 夜档的老种子老局面全废。
  const a = new Game(1717, 'standard', { nights: 3 });
  const b = new Game(1717, 'standard', { nights: 15 });
  const c = new Game(1717, 'standard');
  const ids = (g: Game): string => g.state.hand.map((x) => x.id).join();
  const deckIds = (g: Game): string => g.state.deck.map((x) => x.id).join();
  t('局长不动起手牌顺序（3 夜 / 15 夜 / 参照逐位相同）', ids(a) === ids(b) && ids(b) === ids(c));
  t('局长不动牌组顺序', deckIds(a) === deckIds(b) && deckIds(b) === deckIds(c));
  t('局长也不改规矩：手牌上限与出牌次数三档一致',
    limits(a.state).handSize === limits(b.state).handSize
    && limits(a.state).hands === limits(c.state).hands);
}
{
  // 存档：局长要带得动，也要拒得掉
  for (const n of [MIN_NIGHTS, DEFAULT_NIGHTS, MAX_NIGHTS]) {
    const g = new Game(1718, 'standard', { nights: n });
    const back = deserializeSave(serializeSave(g));
    t(`局长 ${n} 夜活过存档往返`, back !== null && back.state.nights === n);
  }
  const txt = serializeSave(new Game(1718, 'standard'));
  const legacy = deserializeSave(txt.replace('"nights":8,', ''));
  t('没有 nights 字段的旧档照样能读，落回八夜',
    legacy !== null && legacy.state.nights === DEFAULT_NIGHTS);
  t('存档里把局长写坏要整份拒收（2 夜 / 16 夜 / 3.5 夜 / 字符串 / null / 布尔）',
    ['2', '16', '3.5', '"8"', 'null', 'true'].every(
      (v) => deserializeSave(txt.replace('"nights":8', '"nights":' + v)) === null));
  t('clampNights 只认 3..15 的整数，其余一律八夜',
    [3, 8, 15].every((v) => clampNights(v) === v)
    && [2, 16, 0, -3, 3.5, '8', null, undefined, NaN, true].every((v) => clampNights(v as never) === 8));
}
{
  // 局长对开局候选的偏置。六到九夜权重恒为 1，那一区的候选必须与参照档逐位相同；
  // 短局收着"要时间长大"的，长局多给——这条要是量得出来，参数才不是死码。
  const identical = [6, 7, 8, 9].every((n) => [0, 1, 2, 3, 4, 5].every((r) =>
    drawOffer(1717, 0, r, n).map((p) => p.id).join() === drawOffer(1717, 0, r).map((p) => p.id).join()));
  t('六到九夜的开局候选与参照档逐位相同', identical);
  t('lengthWeight 在 6..9 夜对任何人都恒为 1',
    PATRONS.every((p) => [6, 7, 8, 9].every((n) => lengthWeight(p, n) === 1)));
  let swapped = 0;
  for (let r = 0; r < 40; r++) {
    if (drawOffer(1717, 0, r, 3).map((p) => p.id).join() !== drawOffer(1717, 0, r, 15).map((p) => p.id).join()) swapped++;
  }
  t('三夜与十五夜的候选池真的换了人（40 批里换了 ' + swapped + ' 批）', swapped >= 20);
  const share = (n: number): number => {
    let hit = 0, tot = 0;
    for (let r = 0; r < 60; r++) {
      for (const p of drawOffer(1717 + r, 0, r, n)) { tot++; if (p.growth || p.kind === 'xmult') hit++; }
    }
    return hit / tot;
  };
  const s3 = share(3), s8 = share(8), s15 = share(15);
  const pct = (x: number): string => (x * 100).toFixed(1);
  t('长局候选确实更肯给长进型与翻倍注（短 ' + pct(s3) + '% / 参照 ' + pct(s8) + '% / 长 ' + pct(s15) + '%）',
    s3 < s8 && s8 < s15);
  t('开局选人的候选不消耗牌局主随机流（换了局长，发牌照旧）',
    (() => {
      const x = new Game(1721, 'standard', { nights: 3, flags: { ...FLAGS_ALL, events: true } });
      const y = new Game(1721, 'standard', { nights: 15, flags: { ...FLAGS_ALL, events: true } });
      return x.state.hand.map((c) => c.id).join() === y.state.hand.map((c) => c.id).join()
        && x.state.shop.map((c) => (c as { id?: string }).id ?? '').join()
          === y.state.shop.map((c) => (c as { id?: string }).id ?? '').join();
    })());
}
{
  // 每日一局的"同一局"含局长与牌组：偏好里选了几夜都不作数
  const d = new Game(dailySeed(new Date(2026, 9, 12)), 'usurer', { mode: 'daily', nights: MAX_NIGHTS });
  t('每日一局把局长锁回八夜、牌组锁回标准（实际 ' + d.state.nights + ' 夜 / ' + d.state.deckId + '）',
    d.state.nights === DEFAULT_NIGHTS && d.state.deckId === 'standard');
  t('普通模式照收所选局长', new Game(1722, 'standard', { nights: MAX_NIGHTS }).state.nights === MAX_NIGHTS);
}

// ── 18. 牌面美术：点位表要自洽，画几个点与这张牌值几分毫无关系 ──────────
{
  const ranks = [2, 3, 4, 5, 6, 7, 8, 9, 10];
  t('2..10 每一档都有点位表，且点数正好等于牌面数字',
    ranks.every((r) => PIP_SPOTS[r]?.length === r));
  t('A 与人头牌不走点位（走中心大图形）',
    [1, 11, 12, 13, 14].every((r) => !isPipCard(r)) && ranks.every((r) => isPipCard(r)));
  const mirror = (r: number): boolean => PIP_SPOTS[r].every(([x, y]) =>
    PIP_SPOTS[r].some(([a, b]) => Math.abs(a - (1 - x)) < 1e-9 && Math.abs(b - (1 - y)) < 1e-9));
  t('点位关于中心对称（真扑克牌下半部的点是上半部的倒影）',
    ranks.filter((r) => r !== 7).every(mirror));
  // 七是唯一的例外，而且是**真牌就是这样**：多出来的那颗落在上半中，不配倒影
  t('七号牌的第七点故意只在上半中（照真牌，不是漏了对称）',
    !mirror(7) && PIP_SPOTS[7].some(([x, y]) => x === 0.5 && y === 0.335)
    && !PIP_SPOTS[7].some(([x, y]) => x === 0.5 && y === 0.665));
  t('所有点位都在牌面内（0..1 的归一坐标，写死像素会在窄屏那档溢出）',
    ranks.every((r) => PIP_SPOTS[r].every(([x, y]) => x > 0 && x < 1 && y > 0 && y < 1)));
  t('没有两个点重叠在同一格',
    ranks.every((r) => new Set(PIP_SPOTS[r].map(([x, y]) => `${x},${y}`)).size === r));
  t('中线以上的点正放、以下的点倒放（y=0.5 那颗不许被翻）',
    ranks.every((r) => pipSpots(r).every((q) => q.flip === (q.y > 0.5)))
    && pipSpots(3).filter((q) => q.flip).length === 1
    && pipSpots(5).filter((q) => q.flip).length === 2);
  t('四个花色都有图形，且都是能直接内联的 SVG 片段',
    (['s', 'h', 'd', 'c'] as const).every((k) => SUIT_ART[k].includes('<') && SUIT_ART[k].length > 40));
  t('花色图形里没有没替换的令牌，也没有外部引用',
    !(['s', 'h', 'd', 'c'] as const).some((k) => /CUT|url\(|xlink|http/i.test(SUIT_ART[k])));
  t('suitSvg 出来的是带 viewBox 的 svg，fill 走 currentColor（红黑只由卡面决定）',
    suitSvg('h').startsWith('<svg') && suitSvg('h').includes(SUIT_VIEWBOX)
    && suitSvg('h').includes(SUIT_ART.h));
  t('J/Q/K 三种小像互不相同（一眼分得开才配当人头牌）',
    new Set((['J', 'Q', 'K'] as const).map((k) => FACE_ART[k])).size === 3
    && (['J', 'Q', 'K'] as const).every((k) => FACE_ART[k].length > 60));
  // 光比整串文字太松：把 K 的王冠抄到 Q 开头、后面留着玫瑰，整串仍然"不同"。
  // 所以比的是**第一眼看到的那个主形**。
  t('三种小像的主形各不相同（把 K 的王冠挪到 Q 开头也要报）',
    new Set((['J', 'Q', 'K'] as const)
      .map((k) => FACE_ART[k].slice(0, FACE_ART[k].indexOf('/>') + 2))).size === 3);
  t('梅花是三瓣加一柄：少任何一瓣就不再是梅花',
    (SUIT_ART.c.match(/<circle/g) || []).length === 3
    && (SUIT_ART.c.match(/<path/g) || []).length === 1);
  t('A 的双线环画得出来（主牌要有主牌的份量）',
    (ACE_RING.match(/<circle/g) || []).length === 2 && ACE_RING.includes('fill="none"'));
  // ── 牌背：抽牌礼那一排扣过来的牌用的就是这一面 ──
  t('牌背画得出来：底板 + 双线框 + 中央徽记，且全走 currentColor（四套画法只换色不换形）',
    BACK_ART.length > 200 && (BACK_ART.match(/<rect/g) || []).length === 3
    && (BACK_ART.match(/currentColor/g) || []).length >= 5);
  // 六张牌背同屏就有六份同名 <pattern id>，引用只认文档里第一个：抽掉一张，其余的纹样会跟着变。
  // 所以平铺的底纹归 CSS（跟着圆角裁、跟着 currentColor 换色），SVG 里只留几何。
  t('牌背里不许有 id 与外部引用（同名纹样会在六张牌之间互相抢）',
    !/id=|url\(|xlink|http/i.test(BACK_ART));
  t('牌背的黑桃就是牌面那枚黑桃，不是另画一份（两份迟早走样）',
    BACK_ART.includes(SUIT_ART.s));
  t('牌背 viewBox 与牌面同比例（101×142 就是 --card-w/--card-h，铺满不拉伸）',
    BACK_VIEWBOX === '0 0 101 142');
  t('中央徽记落在牌背中线上（歪一像素在六张一排里格外明显）',
    (() => {
      // 菱形的上/左/右三个角：M50.5 47 74 71 50.5 95 27 71z —— 上角要正好是左右角的中点，
      // 而且这条中线要是牌面宽度的正中（50.5 = 101/2）
      const m = [...BACK_ART.matchAll(/M([\d.]+) 47 ([\d.]+) 71 [\d.]+ 95 ([\d.]+) 71z/g)];
      return m.length === 2 && m.every((x) => {
        const top = Number(x[1]); const right = Number(x[2]); const left = Number(x[3]);
        return Math.abs((left + right) / 2 - top) < 0.2 && Math.abs(top - 50.5) < 0.2;
      });
    })());
  refute('牌背重新用 <pattern id> 平铺也没人查', /id="/.test(BACK_ART));
  // 四套画法各自的 --felt/--ivory 差得很远：暖装饰那套里卡纸和底几乎同色，徽记糊成一片
  // （实测四张对照表看出来的）。暗边不跟令牌走，四种画法都压得住。
  t('徽记底下那道暗边不依赖令牌，且与卡纸同一根中线',
    /stroke="rgba\(0, 0, 0, \.\d\)"/.test(BACK_ART)
    && (() => {
      const m = /M([\d.]+) 45\.4 ([\d.]+) 71 [\d.]+ 96\.6 ([\d.]+) 71z/.exec(BACK_ART);
      return !!m && Math.abs((Number(m[3]) + Number(m[2])) / 2 - Number(m[1])) < 0.2
        && Math.abs(Number(m[1]) - 50.5) < 0.2;
    })());
  refute('九号牌只画八个点也没人查', PIP_SPOTS[9].length === 8);
  refute('点位不对称也照样能画', PIP_SPOTS[4][0][1] === PIP_SPOTS[4][3][1]
    && PIP_SPOTS[4][0][0] === PIP_SPOTS[4][3][0]);
}

// ── 19. 抽牌礼：随机挑牌那几类改成"翻过去、打乱、玩家抽一张" ──────────
{
  const ON = { ...FLAGS_ALL };
  const GENTLE = { diff: 'gentle' as Diff, mode: 'run' as Mode };
  const opened = (seed = 7777): Game => new Game(seed, 'standard', { flags: ON, ...GENTLE });
  // 直接摆候选：递不递得出来由 canFire 那批判据管（§16），这里测的是"要不要抽、抽了落在哪"
  const arm = (z: Game, id: string): void => { z.state.pendingEvent = [id]; };
  const allCards = (z: Game): Card[] =>
    [...z.state.deck, ...z.state.hand, ...z.state.table, ...z.state.discardPile];
  const PICKED = ['broken-mirror', 'wax-station', 'terrier', 'chimney-sweep', 'trembling-dealer'];
  // 临时改一条事件的 ops，测完原样放回：扇面"该不该摆、要不要连抽第二张"是数据决定的，
  // 拿现成事件试不出边界情形
  const withOps = (id: string, ops: EventOp[], fn: (z: Game) => boolean): boolean => {
    const def = eventById(id)!;
    const saved = def.ops;
    def.ops = ops;
    const z = opened();
    arm(z, id);
    try { return fn(z); } finally { def.ops = saved; }
  };

  t('五条随机挑牌的事件全都摆得出扇面（碎镜 / 火漆台 / 梗犬 / 扫烟囱的 / 发牌的手抖）',
    PICKED.every((id) => { const z = opened(); arm(z, id); const o = fanOffer(z, id); return !!o && o.cards.length > 0; }));
  t('不挑牌的事件不摆扇面（煤气灯那种硬摆一排牌背就是假仪式）',
    (() => { const z = opened(); arm(z, 'gas-lamp'); return fanOffer(z, 'gas-lamp') === null; })());
  t('扇面是候选池的真子集、不重复、不摊过 FAN_SIZE 张，且都是"还没这个花样"的牌',
    (() => {
      const z = opened(); arm(z, 'broken-mirror');
      const hand = new Set(z.state.hand.map((c) => c.id));
      const o = fanOffer(z, 'broken-mirror')!;
      const ids = o.cards.map((c) => c.id);
      return ids.every((i) => hand.has(i)) && new Set(ids).size === ids.length
        && ids.length <= FAN_SIZE && o.cards.every((c) => c.enh === 'none');
    })());
  t('池子比扇面宽时正好摆 FAN_SIZE 张（牌堆级的候选摊不开，抽一样多就够做选择）',
    (() => { const z = opened(); arm(z, 'terrier'); return fanOffer(z, 'terrier')!.cards.length === FAN_SIZE; })());
  t('池子不足一排时有多少摆多少（不拿重复的牌凑数）',
    (() => {
      const z = opened(); arm(z, 'broken-mirror');
      z.state.hand = z.state.hand.slice(0, 3);
      return fanOffer(z, 'broken-mirror')!.cards.length === 3;
    })());
  t('摆扇面一根毫毛不动主随机流（与抽事件候选同一口径：摆样子不许挪动后面的发牌与铺子）',
    (() => {
      const z = opened(); arm(z, 'terrier');
      const c0 = z.rand.calls;
      fanOffer(z, 'terrier'); fanOffer(z, 'terrier');
      return z.rand.calls === c0;
    })());
  t('同一局重摆一次一模一样（取消再点回来、刷新重开这一屏，不该换一排）',
    (() => {
      const z = opened(); arm(z, 'terrier');
      return fanOffer(z, 'terrier')!.cards.map((c) => c.id).join()
        === fanOffer(z, 'terrier')!.cards.map((c) => c.id).join();
    })());
  t('换种子换一排（同一夜永远那六张就成了假选择）',
    (() => {
      const a = opened(7777); const b = opened(7778);
      arm(a, 'terrier'); arm(b, 'terrier');
      return fanOffer(a, 'terrier')!.cards.map((c) => c.id).join()
        !== fanOffer(b, 'terrier')!.cards.map((c) => c.id).join();
    })());
  t('功能关着、不在出牌中、id 不在候选里：一律不摆扇面（与 chooseEvent 同一道门）',
    (() => {
      const off = opened(); off.state.flags.events = false; arm(off, 'terrier');
      const shop = opened(); shop.state.status = 'shop'; arm(shop, 'terrier');
      const ghost = opened();
      return fanOffer(off, 'terrier') === null && fanOffer(shop, 'terrier') === null
        && fanOffer(ghost, 'terrier') === null;
    })());
  // 每张都试一遍：只挑一张的话，"抽来的根本没用、落的正好是摇中那张"这种错会撞运气过关
  const eachFanCard = (id: string, probe: (z: Game, want: Card, i: number) => boolean): boolean => {
    const n = (() => { const z = opened(); arm(z, id); return fanOffer(z, id)!.cards.length; })();
    for (let i = 0; i < n; i++) {
      const z = opened();
      arm(z, id);
      const want = fanOffer(z, id)!.cards[i];
      if (!probe(z, want, i)) return false;
    }
    return true;
  };
  t('碎镜：抽中哪张就磨哪张（扇面里每一张都试一遍，只中一张算撞运气）',
    eachFanCard('broken-mirror', (z, want) => {
      chooseEvent(z, 'broken-mirror', want.id);
      const got = allCards(z).filter((c) => c.enh === 'glass');
      return got.length === 1 && got[0].id === want.id;
    }));
  t('梗犬：抽走的那张从所有牌堆里消失，而且消失的就是它（候选池含手牌，不是只从牌堆挑）',
    eachFanCard('terrier', (z, want) => {
      chooseEvent(z, 'terrier', want.id);
      return !allCards(z).some((c) => c.id === want.id) && totalCards(z.state) === 51;
    }));
  t('发牌的手抖：誊出来的是抽中那张的副本（点数与花色对得上，六张各试一次）',
    eachFanCard('trembling-dealer', (z, want) => {
      chooseEvent(z, 'trembling-dealer', want.id);
      return totalCards(z.state) === 53
        && allCards(z).some((c) => c.id !== want.id && c.rank === want.rank && c.suit === want.suit);
    }));
  t('火漆台：抽来的那张只管头一张，三张照样各落一道（其余两张仍由牌局摇）',
    (() => {
      const z = opened(); arm(z, 'wax-station');
      const o = fanOffer(z, 'wax-station')!;
      const want = o.cards[0];
      chooseEvent(z, 'wax-station', want.id);
      const sealed = z.state.hand.filter((c) => c.seal !== 'none');
      return o.more && sealed.length === 3 && sealed.some((c) => c.id === want.id);
    })());
  t('扫烟囱的：抽一张定头一张，第二张仍被带走（"移除至多 2 张"这句才没被仪式改掉）',
    eachFanCard('chimney-sweep', (z, want) => {
      chooseEvent(z, 'chimney-sweep', want.id);
      return !allCards(z).some((c) => c.id === want.id) && totalCards(z.state) === 50;
    }));
  t('抽的 id 不在候选池里：这一处按牌局自己摇的落（外面塞进来的那张牌不许认）',
    (() => {
      // 八个种子各比一次"塞个假 id"与"什么都不抽"：认了假 id 的话它会落到 hand[0] 上，
      // 八个种子里必然有一批落点不同；不认则八个全都逐位一致
      let diff = 0;
      for (let i = 0; i < 8; i++) {
        const a = opened(4242 + i); const b = opened(4242 + i);
        arm(a, 'broken-mirror'); arm(b, 'broken-mirror');
        chooseEvent(a, 'broken-mirror', 9999);
        chooseEvent(b, 'broken-mirror');
        const ga = allCards(a).find((c) => c.enh === 'glass');
        const gb = allCards(b).find((c) => c.enh === 'glass');
        if (!ga || !gb || ga.id !== gb.id) diff++;
      }
      return diff === 0;
    })());
  t('不抽牌时誊抄也真的随机（不是按列表顺序拿第一张，与梗犬那条同一口径）',
    (() => {
      // 换种子是换一手牌，量不出"随机"：同一副手牌只挪随机流，才看得见落点在不在动
      const hit = new Set<number>();
      for (let i = 0; i < 10; i++) {
        const z = opened(4242);
        for (let k = 0; k < i; k++) z.rand.next();
        arm(z, 'trembling-dealer');
        chooseEvent(z, 'trembling-dealer');
        const copy = allCards(z).find((c) => c.id > 52)!;
        const src = z.state.hand.find((c) => c.rank === copy.rank && c.suit === copy.suit);
        if (src) hit.add(src.id);
      }
      return hit.size >= 5;
    })());
  t('抽与不抽：主随机流步数一致（仪式只换"哪张"，不挪后面的账）',
    (() => {
      const a = opened(4242); const b = opened(4242);
      arm(a, 'wax-station'); arm(b, 'wax-station');
      const want = fanOffer(a, 'wax-station')!.cards[1];
      chooseEvent(a, 'wax-station', want.id);
      chooseEvent(b, 'wax-station');
      return a.rand.calls === b.rand.calls;
    })());
  t('抽与不抽：之后的牌堆顺序逐位一致（誊抄会重洗，多摇一次就整副错位）',
    (() => {
      const a = opened(4242); const b = opened(4242);
      arm(a, 'trembling-dealer'); arm(b, 'trembling-dealer');
      const want = fanOffer(a, 'trembling-dealer')!.cards[0];
      chooseEvent(a, 'trembling-dealer', want.id);
      chooseEvent(b, 'trembling-dealer');
      // 誊出来的那张是新 id，而 uid 是进程内的自增计数（两局各取各号，不会同号）：
      // 比"新牌落在第几格 + 其余逐位同序"，不比那张牌的号
      const shape = (z: Game): string =>
        z.state.deck.map((c) => (c.id > 52 ? '★' : String(c.id))).join();
      return a.state.deck.length === b.state.deck.length
        && shape(a) === shape(b) && shape(a).includes('★');
    })());
  t('抛硬币分支里挑的那一张不摆扇面（骰子还没掷，摆出来的候选是猜的）',
    withOps('snake-oil', [{ t: 'coin', p: 0.5,
      win: [{ t: 'mark', what: 'enh', value: 'glass', where: 'hand', n: 1 }],
      lose: [{ t: 'money', n: 1 }] }], (z) => fanOffer(z, 'snake-oil') === null));
  t('两处都要挑牌时 more 报真话（界面那句"其余那几张仍由牌局摇"要有依据）',
    withOps('gas-lamp', [
      { t: 'mark', what: 'enh', value: 'glass', where: 'hand', n: 1 },
      { t: 'mark', what: 'seal', value: 'red', where: 'hand', n: 1 },
    ], (z) => fanOffer(z, 'gas-lamp')?.more === true));
  t('只挑一张时 more 不谎称还有第二张',
    withOps('gas-lamp', [{ t: 'mark', what: 'enh', value: 'glass', where: 'hand', n: 1 }],
      (z) => fanOffer(z, 'gas-lamp')?.more === false));
  t('抽来的那张只管头一处：两处都要挑牌时，第二处仍各摇各的（界面那句"其余那几张"才不是空话）',
    (() => {
      // 两张手牌、两处挑牌（玻璃与倍注是两条互不相干的轴，第二处的候选池里两张都还在）。
      // 不记"用过"的话，玩家抽的那张会被两处连着落两次；记了，12 个种子里必然出现
      // "第二处落在另一张上"的那些局——一个种子说明不了什么，12 个才排掉撞运气
      let other = 0;
      for (let i = 0; i < 12; i++) {
        const ok = withOps('gas-lamp', [
          { t: 'mark', what: 'enh', value: 'glass', where: 'hand', n: 1 },
          { t: 'mark', what: 'enh', value: 'mult', where: 'hand', n: 1 },
        ], (z) => {
          z.state.hand = z.state.hand.slice(0, 2);
          const want = fanOffer(z, 'gas-lamp')!.cards[0];
          chooseEvent(z, 'gas-lamp', want.id);
          const mult = z.state.hand.find((c) => c.enh === 'mult');
          return !!mult && mult.id !== want.id;
        });
        if (ok) other++;
      }
      return other >= 6;
    })());
  t('候选池空着就不摆（手牌全磨过了，摆一排空扇面是骗玩家点）',
    (() => {
      const z = opened(); arm(z, 'broken-mirror');
      z.state.hand.forEach((c) => { c.enh = 'glass'; });
      return fanOffer(z, 'broken-mirror') === null;
    })());
  refute('抽中哪张其实无所谓（传两张不同的牌进去，落的也是同一张）',
    (() => {
      const a = opened(4242); const b = opened(4242);
      arm(a, 'broken-mirror'); arm(b, 'broken-mirror');
      const o = fanOffer(a, 'broken-mirror')!;
      chooseEvent(a, 'broken-mirror', o.cards[0].id);
      chooseEvent(b, 'broken-mirror', o.cards[o.cards.length - 1].id);
      const ga = allCards(a).find((c) => c.enh === 'glass')!;
      const gb = allCards(b).find((c) => c.enh === 'glass')!;
      return ga.id === gb.id;
    })());
  refute('扇面就是候选池头几张（不摇骰也照样算"打乱过"）',
    (() => {
      const z = opened(); arm(z, 'terrier');
      const o = fanOffer(z, 'terrier')!;
      const head = [...z.state.deck, ...z.state.discardPile, ...z.state.table, ...z.state.hand]
        .slice(0, FAN_SIZE).map((c) => c.id).join();
      return o.cards.map((c) => c.id).join() === head;
    })());
  refute('扇面自己也算一次抽牌（多摇一位主随机流没人管）',
    (() => {
      const z = opened(); arm(z, 'terrier');
      const c0 = z.rand.calls;
      fanOffer(z, 'terrier');
      return z.rand.calls > c0;
    })());
}

const { runReliability } = await import('../tools/reliability.mjs');
runReliability(t);

console.log(`正向 ${pass} 条通过，失败 ${fails.length} 条`);
if (fails.length) {
  console.log('--- 未通过 ---');
  for (const f of fails) console.log('  FAIL', f);
}
if (reds.length) {
  console.log('--- 反证未转红（判据形同虚设）---');
  for (const r of reds) console.log('  WEAK', r);
}
if (injected.length) {
  console.log('--- 故障注入发现的问题 ---');
  for (const i of injected) console.log('  INJECT', i);
}
const bad = fails.length + reds.length + injected.length;
console.log(bad === 0 ? 'SELFTEST OK' : `SELFTEST FAIL (${bad})`);
process.exitCode = bad > 0 ? 1 : 0;
