// 状态机与经济。引擎是同步且权威的：play() 直接把分数入账并返回事件序列，
// UI 只是投影仪，不参与任何规则判定——这样"动画演到一半玩家乱点"不可能改坏账本。
//
// 经营闭环是原版没有的那条轴，落在三处咬合：
//   盈余转本金（打得越漂亮 → 越有钱构筑）
//   主动抬注（玩家自己放大下一场的风险换回报——原版只能被动接受彩头）
//   声望（活过抬注 + 击败贵客 → 解锁更高档的客人，回报再回来）
import type { Card, HandKind, Suit, Seal, Enh } from './hands.ts';
import { SUITS, SECRET_HANDS, RANK_LABEL, SUIT_NAME, SEAL_NAME } from './hands.ts';
import { evaluate, HANDS, handBase } from './hands.ts';
import { Rand } from './rng.ts';
import { score } from './scoring.ts';
import type { ScoreResult } from './scoring.ts';
import type { PatronDef, Mods, Seat, Edition } from './effects.ts';
import { EDITION_PREMIUM, EDITION_WEIGHT, EDITION_NAME } from './effects.ts';
import {
  PATRONS, patronById, RARITY_MIN_REP, RARITY_WEIGHT, LETTERS, BOOKS, VOUCHERS, BOSSES, DECKS,
  letterById, majoritySuit, deckById, deckLegal,
} from './content.ts';
import type { LetterDef, BossDef } from './content.ts';
import type { FeatureFlags } from './flags.ts';
import { FLAGS_OFF } from './flags.ts';
import type { ThresholdDef } from './thresholds.ts';
import { THRESHOLDS } from './thresholds.ts';
import { BETS, betFor, resolveBetMiss } from './bets.ts';
import type { BetDef } from './bets.ts';
import { setMods, activeSets } from './sets.ts';
import { BASE_TARGET, OVERFLOW_GROWTH, DEFAULT_NIGHTS, clampNights, nightScale } from './lengths.ts';
import { grow } from './growth.ts';
import { ENH_IDS, SEAL_IDS, materialById, sealById } from './layers.ts';
import type { EventDef, EventFacts, EventOp, EventScope } from './events.ts';
import {
  EVENTS, eventById, canFire, drawEvents, deriveEventRand, deriveFanRand, eventAtFor, autoPick, scopeName,
} from './events.ts';

export type Stage = 0 | 1 | 2;
export type StageKind = 'open' | 'feast' | 'boss';
export const STAGE_KIND: StageKind[] = ['open', 'feast', 'boss'];
export const STAGE_LABEL: Record<StageKind, string> = { open: '便宴', feast: '正宴', boss: '贵客局' };
export const STAGE_SCALE: Record<StageKind, number> = { open: 1, feast: 1.5, boss: 2 };
export const STAGE_REWARD: Record<StageKind, number> = { open: 3, feast: 4, boss: 5 };

// 一局打几夜由 core/lengths.ts 管：八夜是参照档，三到十五夜各有设计的终场彩头。
// FINAL_NIGHT 留着是给"默认八夜"这一个数用的旧名字（结算文案与自检都在读它）。
export const FINAL_NIGHT = DEFAULT_NIGHTS;

// 每位开局自带的"缓冲回合"数：打输本场可免费重做一次的兜底。
// 它是给所有玩家的保命符，与加注档的付费续命（betReprieve）正交——调平衡改这个数即可。
export const START_BUFFER = 1;

// ── 难度与模式 ───────────────────────────────────────────────
// 难度只通过既有的 Mods 通道生效，不新开任何结算分支：
// 这样"标准"档必须和调平衡那天的逐位一致，否则玩家改过一次难度就再也回不去基线。
export type Diff = 'gentle' | 'standard' | 'grudge';
export interface DiffDef {
  id: Diff; name: string; blurb: string;
  money: number;                 // 起手银钱的增减
  mods: Mods;
}
export const DIFFS: DiffDef[] = [
  {
    id: 'gentle', name: '手松', blurb: '彩头薄三成，起手多 £6，每场多一次出牌与弃牌，货价八五折',
    money: 6,
    mods: { hands: 1, discards: 1, interestCap: 2, targetScale: .72, priceScale: .85 },
  },
  {
    id: 'standard', name: '标准', blurb: '就是调平衡那一版，什么都没动',
    money: 0, mods: {},
  },
  {
    id: 'grudge', name: '苛刻', blurb: '彩头厚四成五，起手少 £2，少一次出牌与弃牌，利息封顶 £2，货价抬两成',
    money: -2,
    mods: { hands: -1, discards: -1, interestCap: -3, targetScale: 1.45, priceScale: 1.2 },
  },
];
export const diffById = (id: string): DiffDef => DIFFS.find((d) => d.id === id) ?? DIFFS[1];

export type Mode = 'run' | 'endless' | 'daily' | 'practice';
export interface ModeDef { id: Mode; name: string; blurb: string }
export const MODES: ModeDef[] = [
  { id: 'run', name: '经营', blurb: '打满你选的轮数就散场（默认八夜，可 3～15 夜）' },
  { id: 'endless', name: '无尽', blurb: '没有最后一夜，彩头一路翻倍，看你能撑到第几夜' },
  { id: 'daily', name: '每日一局', blurb: '当天固定种子、标准难度和牌组、八夜固定规则；可反复复盘' },
  { id: 'practice', name: '修行', blurb: '不会散场：牌权用完就补满，拿来试构筑' },
];
export const modeById = (id: string): ModeDef => MODES.find((m) => m.id === id) ?? MODES[0];

/** 由日期确定性生成种子：同一天在任何一台机器上都是同一局 */
export const dailySeed = (d = new Date()): number => {
  const y = d.getFullYear(), m = d.getMonth() + 1, day = d.getDate();
  return ((y * 10000 + m * 100 + day) % 999983) + 17;
};

const SEALS: readonly Seal[] = ['red', 'gold', 'purple', 'blue'];
export const MAX_DECK = 120;          // 誊抄可以造牌，但要给牌堆一个上界
export const MIN_DEALABLE = 5;        // 销账/碎牌不许把牌拆到发不出手为止

export type Consumable = { t: 'letter'; id: LetterDef['id'] } | { t: 'book'; id: HandKind };

export interface LedgerRow {
  night: number;
  stage: StageKind;
  label: string;
  target: number;
  best: number;
  reward: number;
  profit: number;
  money: number;
  raised: number;
  rep: number;
}

export interface ShopSlot {
  kind: 'patron' | 'consumable' | 'voucher';
  pid?: string;
  edition?: Edition;
  item?: Consumable;
  vid?: string;
  price: number;
  sold: boolean;
}

export interface GameState {
  seed: number;
  deckId: string;
  night: number;
  /** 这一局共几夜（3..15）。八夜是参照档；判胜、曲线系数、开局候选都读它 */
  nights: number;
  stage: Stage;
  status: 'playing' | 'cleared' | 'shop' | 'won' | 'lost';

  money: number;
  rep: number;
  raiseNext: number;      // 玩家在铺子里选的抬注层数，作用于下一场
  raisedHere: number;     // 本场实际生效的抬注层数

  deck: Card[];
  hand: Card[];
  table: Card[];
  chosen: number[];
  discardPile: Card[];

  seats: Seat[];
  consumables: Consumable[];
  books: Record<string, number>;
  handUse: Record<string, number>;
  vouchers: string[];
  bossId: string | null;

  handsLeft: number;
  discardsLeft: number;
  handIndex: number;
  discardsUsed: number;
  score: number;          // 本场累计流水——每手牌的得分是相加的，不是取最好一手

  shop: ShopSlot[];
  rerolls: number;
  ledger: LedgerRow[];
  discovered: HandKind[];
  settlement: SettleLine[];
  endless: boolean;
  diff: Diff;
  mode: Mode;
  log: string[];
  /** 这一局的功能开关快照。存档里必须带着走，否则同一局跨开关版本会读出"一半生效"的怪账 */
  flags: FeatureFlags;
  /** 本场已认领的阈值 id（span='stage' 的整场只认一次）。换场清空 */
  claimed: string[];
  /** 本场已经用过几次"失手续命"。加注档位的失败惩罚每场只给一次，用光就当场散局 */
  betReprieves: number;
  /** 缓冲回合：每位开局自带的"本场打输重做"兜底次数。免费、人人有，用光就照原样散局 */
  buffer: number;
  /** 开局选定的签名宾 id（没选就是 ''）。记进状态，重开与读档都要认它 */
  signature: string;
  /** 新手引导：这一局已经讲过/跳过的那几条 id。纯提示进度，玩法一律不读它 */
  tutorial: string[];
  /** 引导关进度。带 'on' 才是一局课；玩法不读它，所以"上不上课牌局逐位相同"可判据 */
  guide: string[];

  // ── 随机事件（flags.events 关着时这一整段一个都不许被碰）────────────
  /** 本夜第几次动作之后递事件（2 或 3，由派生流定，所以每夜不同但可复现） */
  eventAt: number;
  /** 本夜已经出牌与弃牌合计数 */
  nightActions: number;
  /** 待决的三选一候选 id。非空时不许出牌也不许弃牌——不选就停在原地 */
  pendingEvent: string[];
  /** 整局递过的事件，顺序即时间顺序。结算幕的「事件回顾」列的就是它 */
  events: EventRecord[];
  /** 生效中的事件修正：rule 那些进 limits()，eff 那些进 score() */
  eventMods: EventMod[];
}

/** 一次事件的存证：哪一夜、哪一条、实际发生了什么（抛硬币掷出哪面只有执行时才知道） */
export interface EventRecord {
  night: number;
  id: string;
  result: string;
}

/**
 * 一条挂着的修正。作用域到期规则：
 *   'hand' 剩几手（跨场一律作废）/ 'night' 记着发端于哪一夜（换了夜就作废）/ 'run' 一直挂着。
 * 到期判据只有一处（setupStage 与 play 的手尾），别在第二处再判一遍——两处会漂。
 */
export interface EventMod {
  from: string;
  scope: EventScope;
  night: number;
  hands?: number;
  rule?: Mods;
  eff?: { chips?: number; mult?: number; xmult?: number };
}

// 过关时的每一条进账，UI 照着逐行列举（"这 £8 是记账先生给的"必须看得见）
export interface SettleLine {
  label: string;
  amount: number;
  pid?: string;
}

let uid = 1;
const newCard = (rank: number, suit: Suit): Card => ({ id: uid++, rank, suit, enh: 'none', seal: 'none' });

export const mkSeat = (pid: string, edition: Edition = 'none'): Seat => ({ pid, edition });
export const seatIds = (s: GameState): string[] => s.seats.map((x) => x.pid);

export function freshDeck(rand: Rand): Card[] {
  const d: Card[] = [];
  for (const s of SUITS) for (let r = 2; r <= 14; r++) d.push(newCard(r, s));
  return rand.shuffle(d);
}

export const levelOf = (s: GameState, k: HandKind): number => s.books[k] ?? 1;

// 管道之外（onDiscard / onHeld / onRoundEnd）那三个挂载点的读数。
// roll 必须**惰性**传进去：只有客人的 apply 真去摇才消耗随机流，
// 而 mods()（改规矩的那批）绝不该摇骰子——limits() 一次渲染会被调用很多回。
const baseCtx = (s: GameState, rand?: Rand) => ({
  result: { kind: 'high' as HandKind, scoring: [] as Card[] },
  played: [] as Card[], held: [] as Card[], card: undefined, index: undefined,
  handIndex: s.handIndex, rep: s.rep, raised: s.raiseNext,
  discardsUsed: s.discardsUsed, money: s.money, suitLocked: null,
  handsLeft: s.handsLeft, deckLeft: s.deck.length, discardCount: s.discardPile.length,
  seatCount: s.seats.length, distinctKinds: Object.keys(s.handUse).length,
  night: s.night,
  // target 故意**不在这里算**：targetOf→limits→baseCtx 会打回原形无限递归。
  // 要彩头的调用方自己补一个 { target } 进来（discard/settle 三处就是这么做的）
  roll: rand ? (p: number): boolean => rand.chance(p) : undefined,
});

export const bossOf = (s: GameState): BossDef | null =>
  s.bossId ? BOSSES.find((b) => b.id === s.bossId) ?? null : null;

// 所有"改规矩"的来源汇成一份限额表——座位稀缺是构筑张力的来源，所以它必须由这一处统一算出
export function limits(s: GameState): Required<Mods> & { interestFlat: number } {
  const dk = deckById(s.deckId);
  const acc: Required<Mods> & { interestFlat: number } = {
    seats: 3, handSize: 8, hands: 4, discards: 3, slots: 2,
    interestCap: dk.interestFlat ?? 5, targetScale: 1, freeRerolls: 0, priceScale: 1,
    interestFlat: dk.interestFlat ?? 0,
  };
  const add = (m: Mods): void => {
    acc.seats += m.seats ?? 0;
    acc.handSize += m.handSize ?? 0;
    acc.hands += m.hands ?? 0;
    acc.discards += m.discards ?? 0;
    acc.slots += m.slots ?? 0;
    acc.interestCap += m.interestCap ?? 0;
    acc.freeRerolls += m.freeRerolls ?? 0;
    if (m.targetScale) acc.targetScale *= m.targetScale;
    if (m.priceScale) acc.priceScale *= m.priceScale;
  };
  // P1-1 套装：只改规矩（座位/槽/次数/价格系数），不碰分数。
  // 排在客人 mods 之前累加，所以"凑齐一套"与"某位客人自己改规矩"是两笔独立加项。
  if (s.flags.sets) add(setMods(s.seats.map((x) => patronById(x.pid))));
  // 局长曲线垫在最底下，和难度同一层：它按"第几夜"逐夜弯向该档的设计终点，
  // 八夜那一档每一夜都正好是 ×1，所以参照档的账与以前逐位相同。
  add({ targetScale: nightScale(s.nights, s.night) });
  // 难度垫在最底下：牌组/客人/特权都在它之后叠加，所以"标准"档必须是全 0 才不会挪动基线
  add(diffById(s.diff).mods);
  if (dk.mods) add(dk.mods);
  for (const seat of s.seats) {
    const p = patronById(seat.pid);
    if (p.mods) add(p.mods(baseCtx(s)));   // 不传 rand：改规矩的挂载点禁止摇骰
  }
  for (const v of s.vouchers) {
    const def = VOUCHERS.find((x) => x.id === v);
    if (def) add(def.mods);
  }
  // 随机事件改的规矩排在客人之后：它和"某位客人自己改规矩"是两笔独立加项，
  // 但必须排在贵客那两条之前——贵客的惩罚是压在最底下的最后一刀，不能被事件顶掉。
  // 到期判据在这里也要走一遍：'hand' 那类是 play() 里减 hands 计数的，
  // 只靠 setupStage 那道过滤的话，"下一手 +3 手牌"会一路挂着不出场。
  if (s.flags.events) {
    for (const m of s.eventMods) {
      if (!m.rule) continue;
      if (m.scope === 'hand' && (m.hands ?? 0) <= 0) continue;
      add(m.rule);
    }
  }
  acc.interestCap = Math.max(0, acc.interestCap);
  const boss = bossOf(s);
  if (boss) {
    if (boss.handSize) acc.handSize += boss.handSize;
    if (boss.hands) acc.hands += boss.hands;
  }
  // 座位容量本身不因版本改变；负片是"不占座"，由 seatedCount() 体现
  acc.slots = Math.max(0, acc.slots);
  // 高利贷牌组把利息上限压到 £2，苛刻档再 −£3 会变成负数——那等于每回合扣钱，
  // 而 moneyOf 里 Math.min(cap, …) 会照单全收，所以这里必须夹住

  return acc;
}

/** 真正占座的客人数——负片不占 */
export const seatedCount = (s: GameState): number =>
  s.seats.filter((x) => x.edition !== 'negative').length;

// 纯函数版彩头：铺子里"抬注之后是多少"要能在不改动状态的前提下预览
export function targetFor(night: number, stage: Stage, raised: number, scale: number, betTable = false): number {
  const kind = STAGE_KIND[stage];
  const base = night <= BASE_TARGET.length
    ? BASE_TARGET[night - 1]
    : Math.round(BASE_TARGET[BASE_TARGET.length - 1]
      * Math.pow(OVERFLOW_GROWTH, night - BASE_TARGET.length));
  // 关着走原来那行硬编码，开着走表。**表里的 targetMult 就是 1.5^tier**，
  // 所以两条路算出来的数一模一样——换的只是"能不能改数据"，不是数值本身。
  const mult = betTable ? betFor(raised).targetMult : Math.pow(1.5, raised);
  return Math.round(base * STAGE_SCALE[kind] * scale * mult / 10) * 10;
}

export function targetOf(s: GameState): number {
  return targetFor(s.night, s.stage, s.raisedHere, limits(s).targetScale, s.flags.bets);
}

/** 铺子预告按下一场的夜数与到期规则算，绝不消耗随机流或改变当前局。 */
export function nextTarget(s: GameState, raised: number): number {
  const stage = s.stage < 2 ? (s.stage + 1) as Stage : 0;
  const night = s.stage < 2 ? s.night : s.night + 1;
  const next: GameState = {
    ...s, stage, night, bossId: null, raisedHere: raised,
    eventMods: s.flags.events
      ? s.eventMods.filter((m) => m.scope === 'run' || (m.scope === 'night' && m.night === night))
      : [],
  };
  return targetOf(next);
}

export const stakeLabel = (s: GameState): string => {
  const kind = STAGE_KIND[s.stage];
  const b = bossOf(s);
  return kind === 'boss' && b ? b.name : STAGE_LABEL[kind];
};

export const stakeBlurb = (s: GameState): string => {
  const b = bossOf(s);
  return STAGE_KIND[s.stage] === 'boss' && b ? b.blurb : '';
};

function setupStage(s: GameState, rand: Rand): void {
  // 先定贵客再取限额：贵客会改手牌上限与出牌次数，顺序反了惩罚就整个落空
  s.bossId = s.stage === 2 ? rand.pick(BOSSES).id : null;
  // 随机事件的到期与换夜必须排在取限额**之前**：过期的那格还挂着，limits() 就会按旧的
  // 手牌上限多发几张，下一句 trimHand 再把多出来的丢掉——白摇一次随机流。
  // 'hand' 那类一律不跨场，'night' 那类换了夜就失效；换夜重新摇本夜触发点，
  // 用的是派生流，主随机流一步都不许多走。
  if (s.flags.events) {
    s.eventMods = s.eventMods.filter((m) =>
      m.scope === 'run' || (m.scope === 'night' && m.night === s.night));
    if (s.stage === 0) {
      s.nightActions = 0;
      s.eventAt = eventAtFor(deriveEventRand(s.seed, s.night, s.events.length));
    }
  }
  const lim = limits(s);
  s.handsLeft = lim.hands;
  s.discardsLeft = lim.discards;
  s.handIndex = 0;
  s.discardsUsed = 0;
  s.chosen = [];
  s.score = 0;
  s.handUse = {};
  s.raisedHere = s.raiseNext;
  s.raiseNext = 0;
  // 阈值认领账：carryOver=false 的那些换场清零（错过就没了才有取舍），
  // true 的保留。整场只认一次的那条靠这个列表挡住重复发奖。
  s.claimed = s.claimed.filter((id) => THRESHOLDS.find((d) => d.id === id)?.carryOver === true);
  s.betReprieves = 0;
  drawTo(s, lim.handSize, rand);
  // 修行档不该因为"牌堆空了"就散场：把整副收回牌堆重洗再发一次
  if (!s.hand.length && s.mode === 'practice') {
    rescueDeal(s, rand);
    drawTo(s, limits(s).handSize, rand);
  }
  // 无牌可发就直接判负，别让下一句 play() 因为没牌而永远返回 null
  if (!s.hand.length) s.status = 'lost';
  else s.status = 'playing';
}

/** 把弃牌堆 + 桌面 + 手牌全部收回牌堆并重洗。返回是否还有牌可发 */
function rescueDeal(s: GameState, rand: Rand): boolean {
  s.deck = rand.shuffle([
    ...s.deck, ...s.discardPile.splice(0), ...s.table.splice(0), ...s.hand.splice(0),
  ]);
  return s.deck.length > 0;
}

/** 修行档的"不会散场"：把判负就地改写成补满牌权继续。返回 true 表示已救回 */
function reprieve(g: Game): boolean {
  const s = g.state;
  if (s.mode !== 'practice') return false;
  const lim = limits(s);
  rescueDeal(s, g.rand);
  s.score = 0;
  s.handsLeft = lim.hands;
  s.discardsLeft = lim.discards;
  s.handIndex = 0;
  s.discardsUsed = 0;
  s.handUse = {};
  drawTo(s, lim.handSize, g.rand);
  g.note('修行局：牌权与牌堆补满，接着练');
  return true;
}

/** 无牌可打也无处可弃 —— 销账与碎牌可以把牌堆耗干，这时必须判负而不是把人卡在原地 */
function stranded(s: GameState): boolean {
  return s.status === 'playing' && !s.hand.length && !s.deck.length && !s.discardPile.length;
}

// ── 发牌 / 弃牌 ────────────────────────────────────────────────
function refill(s: GameState, rand: Rand): void {
  if (s.deck.length) return;
  if (!s.discardPile.length) return;
  s.deck = rand.shuffle(s.discardPile.splice(0, s.discardPile.length));
}

function drawTo(s: GameState, n: number, rand: Rand): void {
  for (let i = 0; i < n; i++) {
    if (s.hand.length >= limits(s).handSize) break;
    refill(s, rand);
    const c = s.deck.pop();
    if (!c) break;
    s.hand.push(c);
  }
}

export function toggleChosen(s: GameState, id: number): void {
  const i = s.chosen.indexOf(id);
  if (i >= 0) s.chosen.splice(i, 1);
  else if (s.chosen.length < 5) s.chosen.push(id);
}

export function chosenCards(s: GameState): Card[] {
  // 顺序按手牌从左到右，而不是按点选顺序——逐张计分要演的是牌桌上的位置
  return s.hand.filter((c) => s.chosen.includes(c.id));
}

/** 选牌预览：牌桌与引导都读这一份。带上基础流水/倍注，是为了能给第一次玩的人
 *  报出**此刻屏幕上那串真数字**（"对子：30 流水 × 2 倍注"），不是笼统一句"看牌型名"。 */
export function preview(s: GameState):
  { kind: HandKind; level: number; name: string; chips: number; mult: number } | null {
  const cs = chosenCards(s);
  if (!cs.length) return null;
  const r = evaluate(cs);
  const level = levelOf(s, r.kind);
  const base = handBase(r.kind, level);
  return { kind: r.kind, level, name: HANDS[r.kind].name, chips: base.chips, mult: base.mult };
}

// ── 出牌：入账 + 返回可重放的事件序列 ─────────────────────────
export function play(g: Game): ScoreResult | null {
  const s = g.state;
  // 待决事件没选就不许继续——"三选一"是决策点，可以慢慢想，但不能跳过它继续打牌把事绕过去
  if (s.pendingEvent.length) return null;
  if (s.status !== 'playing' || !s.chosen.length || s.handsLeft <= 0) return null;
  const rand = g.rand;
  const played = chosenCards(s);
  if (!played.length || played.length > 5) return null;
  const result = evaluate(played);

  // 上一手那几张已经打完：它们进弃牌堆（牌堆抽空时 refill 会把它洗回来接着发），
  // 不能等着被下一句 s.table = played 顶掉——顶掉就是每打一手有几张牌永久蒸发，
  // 一场四手下来整副要少十几张，而只有换场那次 recycle() 收得到最后一手的桌面。
  if (s.table.length) s.discardPile.push(...s.table.splice(0));
  s.table = played;
  s.hand = s.hand.filter((c) => !s.chosen.includes(c.id));

  const res = score({
    played, result, level: levelOf(s, result.kind), held: [...s.hand],
    seats: s.seats, boss: bossOf(s), rand,
    env: {
      handIndex: s.handIndex, rep: s.rep, raised: s.raisedHere,
      discardsUsed: s.discardsUsed, money: s.money,
    },
    // flag 关掉时传空数组：score() 里连判定都不会进，等于这个功能不存在
    thresholds: s.flags.thresholds ? THRESHOLDS : [],
    targetLine: targetOf(s),
    scoreBefore: s.score,
    claimed: s.claimed,
    adjacency: s.flags.adjacency,
    layers: s.flags.layers,
    growth: s.flags.growth,
    // 随机事件挂着的加项。空数组 == 这局没有事件在生效，管道里一笔都不多画
    events: s.flags.events ? activeEventCues(s) : [],
    // 局面读数：只读，供各家的触发条件用。
    // distinctKinds 取的是**这一手之前**本夜用过的牌型种数（handUse 在后面才自增），
    // 写机制时要知道这一点，否则"第 4 种牌型"会差一手
    scene: {
      handsLeft: s.handsLeft,
      deckLeft: s.deck.length,
      discardCount: s.discardPile.length,
      distinctKinds: Object.keys(s.handUse).length,
      night: s.night,
      target: targetOf(s),
    },
    // 吃概率的客人唯一的随机口。走同一条种子流，所以存档快进照样复现。
    roll: (p: number): boolean => rand.chance(p),
  });

  s.money += res.money;
  s.score += res.value;
  // P1-2 长进的记账：这一手里**真的触发过**的那几位才涨 XP。
  // 从事件流里取，而不是重新判一遍条件——这样"演出来的"和"记下来的"是同一件事。
  if (s.flags.growth) {
    const fired = new Set(res.events.filter((e) => e.t === 'patron').map((e) => e.pid));
    for (const seat of s.seats) {
      const def = patronById(seat.pid);
      if (!def.growth || !fired.has(seat.pid)) continue;
      seat.xp = grow(seat.xp ?? 0, def.growth);
    }
  }
  for (const id of res.claimedNow) {
    if (!s.claimed.includes(id)) s.claimed.push(id);
    const d = THRESHOLDS.find((x) => x.id === id);
    if (d) g.note(`够到「${d.name}」：${d.blurb}`);
  }
  s.handsLeft -= 1;
  s.handIndex += 1;
  // 事件的到期与本夜动作计数。'hand' 那类每过一手少一手，归零后不再进管道。
  // 关掉开关时这两件事一次都不做——新功能不留下任何足迹。
  if (s.flags.events) {
    s.nightActions += 1;
    for (const m of s.eventMods) if (m.scope === 'hand') m.hands = (m.hands ?? 1) - 1;
  }
  s.chosen = [];
  s.handUse[result.kind] = (s.handUse[result.kind] ?? 0) + 1;
  for (const id of res.shattered) {
    dropFromDeck(s, id);
    g.note(`玻璃牌碎了：${cardName(s, id) ?? '一张牌'}`);
  }
  drawTo(s, played.length, rand);
  if (stranded(s) && !reprieve(g)) { s.status = 'lost'; g.note('牌都打光了，再无一张可出'); }

  if (SECRET_HANDS.includes(result.kind) && !s.discovered.includes(result.kind)) {
    s.discovered.push(result.kind);
    g.note(`见过了 ${HANDS[result.kind].name}`);
  }

  if (s.score >= targetOf(s)) {
    settle(g);
    return res;
  }

  if (s.handsLeft <= 0) {
    // 牌打完了还没够彩头：这场输了（修行档除外）
    if (reprieve(g)) return res;
    // 缓冲回合：人人自带一次免费重做，先于加注续命——它不花银钱不请客，
    // 是给所有玩家的兜底；用光才轮到下面的加注专属续命与判负。
    if (bufferRound(g)) return res;
    // P0-1：抬过注的那几档买得起一次续命——失手不再是当场散局，而是付出代价本场重做。
    // 每场只给一次（betReprieves），用光就照原样判负，免得变成无限赖场。
    if (s.flags.bets && s.raisedHere > 0 && betReprieve(g)) return res;
    s.status = 'lost';
    g.note('彩头未足，满堂宾客散去');
  }
  maybeEvent(g);
  return res;
}

/**
 * P0-1 失手续命。按这一档的 failPenalty 付出代价，然后把本场分数清零重打一次。
 * 修行档在前面已经被 reprieve() 接走了，所以这里只处理正经局。
 */
function betReprieve(g: Game): boolean {
  const s = g.state;
  const bet: BetDef = betFor(s.raisedHere);
  const lim = limits(s);
  const verdict = resolveBetMiss(bet, {
    money: s.money, seats: s.seats.length, reprievesUsed: s.betReprieves, handsLeft: s.handsLeft,
  });
  if (verdict.resetScore !== true || verdict.kind === 'loseRunAsIs' || verdict.kind === 'none') return false;
  s.betReprieves += 1;
  s.money = Math.max(0, s.money + verdict.moneyDelta);
  let penaltyNote = verdict.note;
  for (let i = 0; i < -verdict.seatsDelta; i++) {
    // 请走最右边那位：不动玩家的构筑顺序，也不会把 copy:'left' 的依赖整个抽走
    if (s.seats.length > 0) {
      const out = s.seats[s.seats.length - 1];
      const index = s.seats.length - 1;
      if (strandingOnSeatLoss(s, index)) {
        const loss = Math.floor(s.money * 0.2);
        s.money -= loss;
        penaltyNote = `${patronById(out.pid).name}撑着随身格，改赔 £${loss}，物品保留，本场重做`;
      } else {
        removeSeat(s, index);
        g.note(`${patronById(out.pid).name} 被请了出去`);
      }
    }
  }
  s.score = 0;
  // lim 是**请客之前**算的：上面刚 pop 掉客人，照老 lim 补牌补次数就等于把走掉的人的手续留着。
  const after = limits(s);
  s.handsLeft = after.hands;
  s.discardsLeft = after.discards;
  s.handIndex = 0;
  s.discardsUsed = 0;
  s.handUse = {};
  s.claimed = s.claimed.filter((id) => THRESHOLDS.find((d) => d.id === id)?.carryOver === true);
  recycle(g);
  drawTo(s, after.handSize, g.rand);
  g.note(penaltyNote);
  return true;
}

/**
 * 缓冲回合：每位开局自带 START_BUFFER 次"这一场打输重做"的免费兜底，
 * 不花银钱、不请走客人。它与 betReprieve 正交——betReprieve 只在开过加注档时给
 * （还要付出代价），缓冲回合人人有、免费、且与加注无关，是给所有玩家的保命符。
 * 每个减一，用光就返回 false 让上层照原样判负（不会无限赖场）。
 * 重做只重洗本场、保留当前贵客与加注档，让"重来"确实是同一场牌。
 */
function bufferRound(g: Game): boolean {
  const s = g.state;
  if (s.buffer <= 0) return false;
  s.buffer -= 1;
  s.score = 0;
  const after = limits(s);
  s.handsLeft = after.hands;
  s.discardsLeft = after.discards;
  s.handIndex = 0;
  s.discardsUsed = 0;
  s.handUse = {};
  s.claimed = s.claimed.filter((id) => THRESHOLDS.find((d) => d.id === id)?.carryOver === true);
  recycle(g);
  drawTo(s, after.handSize, g.rand);
  if (!s.hand.length) { s.status = 'lost'; g.note('牌堆空了，缓冲回合也救不回'); return false; }
  s.status = 'playing';
  g.note(s.buffer === 0 ? '缓冲回合用掉了，这是最后一次兜底' : '缓冲回合：这一场免费重来');
  return true;
}

const RANK = (c: Card): string =>
  c.rank === 14 ? 'A' : c.rank === 13 ? 'K' : c.rank === 12 ? 'Q' : c.rank === 11 ? 'J' : String(c.rank);
const SUITSym = (s: Suit): string => ({ s: '♠', h: '♥', d: '♦', c: '♣' })[s];

function cardName(s: GameState, id: number): string | null {
  const all = [...s.hand, ...s.table, ...s.deck, ...s.discardPile];
  const c = all.find((x) => x.id === id);
  return c ? `${RANK(c)}${SUITSym(c.suit)}` : null;
}

function dropFromDeck(s: GameState, id: number): void {
  for (const list of [s.hand, s.table, s.deck, s.discardPile] as Card[][]) {
    const i = list.findIndex((c) => c.id === id);
    if (i >= 0) list.splice(i, 1);
  }
}

export function discard(g: Game): number {
  const s = g.state;
  if (s.pendingEvent.length) return 0;
  if (s.status !== 'playing' || !s.chosen.length || s.discardsLeft <= 0) return 0;
  const boss = bossOf(s);
  const ids = s.chosen;
  const gone = s.hand.filter((c) => ids.includes(c.id));
  s.hand = s.hand.filter((c) => !ids.includes(c.id));
  s.discardPile.push(...gone);
  s.chosen = s.chosen.filter((id) => s.hand.some((c) => c.id === id));
  s.discardsLeft -= 1;
  s.discardsUsed += 1;

  let money = 0;
  const lim = limits(s);
  for (const c of gone) {
    for (const seat of s.seats) {
      const p = patronById(seat.pid);
      if (p.hook !== 'onDiscard' || !p.apply) continue;
      const e = p.apply({ ...baseCtx(s, g.rand), card: c, target: targetOf(s) });
      if (e) money += (Array.isArray(e) ? e : [e]).reduce((a, x) => a + (x.money ?? 0), 0);
    }
    // 紫蜡封「留书」：被弃掉时换一封随机引荐信，随身满了就作数不发货
    if (c.seal === 'purple' && s.consumables.length < lim.slots) {
      s.consumables.push({ t: 'letter', id: g.rand.pick(LETTERS).id });
      g.note('留书火漆换来一封引荐信');
    }
  }
  if (boss?.taxDiscard) money -= boss.taxDiscard * gone.length;
  s.money = Math.max(0, s.money + money);

  drawTo(s, gone.length, g.rand);
  s.chosen = [];
  if (stranded(s) && !reprieve(g)) { s.status = 'lost'; g.note('牌都弃尽了，再无一张可出'); }
  // 弃牌也算"这一夜动过手"：触发判据数的是出牌与弃牌合起来的次数
  if (s.flags.events) s.nightActions += 1;
  maybeEvent(g);
  return money;
}

// ── 随机事件：触发、三选一、执行 ────────────────────────────────
//
// 这一段是**唯一**动 state 的事件代码。events.ts 只描述，界面只投影。
// 所有摇骰子都走 g.rand（主流）：事件真的改变了这一局，它消耗的步数就该记进
// (seed, calls) 的账里。唯一不碰主流的是"给你看哪三件事"（drawEvents 用派生流），
// 因为"看见什么"不该把发牌顺序挪位。

/** canFire 要的那份读数：事件系统读 state 的唯入口，别处不许另算一份 */
function eventFactsOf(s: GameState): EventFacts {
  const lim = limits(s);
  const all = [...s.deck, ...s.hand, ...s.discardPile, ...s.table];
  return {
    night: s.night, seats: seatedCount(s), seatCap: lim.seats, money: s.money,
    discardCount: s.discardPile.length, totalCards: totalCards(s), deckCap: MAX_DECK,
    marked: all.filter((c) => c.enh !== 'none' || c.seal !== 'none').length,
  };
}

/** 挂着的那几格加项进计分管道。'hand' 的靠 hands 计数到期，归零就不再进 */
function activeEventCues(s: GameState): {
  name: string; tid: string; chips?: number; mult?: number; xmult?: number;
}[] {
  const out: { name: string; tid: string; chips?: number; mult?: number; xmult?: number }[] = [];
  for (const m of s.eventMods) {
    if (!m.eff) continue;
    if (m.scope === 'hand' && (m.hands ?? 0) <= 0) continue;
    out.push({
      name: eventById(m.from)?.name ?? m.from, tid: m.from,
      chips: m.eff.chips, mult: m.eff.mult, xmult: m.eff.xmult,
    });
  }
  return out;
}

/** 每夜至多递一次，在本夜第 eventAt 次动作（出牌与弃牌合着数）之后 */
function maybeEvent(g: Game): void {
  const s = g.state;
  if (!s.flags.events) return;
  if (s.status !== 'playing' || s.pendingEvent.length) return;
  if (s.events.some((e) => e.night === s.night)) return;
  if (s.nightActions < s.eventAt) return;
  const fired = s.events.map((e) => e.id);
  const pool = EVENTS.filter((e) => canFire(e, eventFactsOf(s), fired));
  const cands = drawEvents(pool, s.seed, s.night, s.events.length);
  if (!cands.length) return;
  s.pendingEvent = cands.map((c) => c.id);
  g.note(`夜里有事：${cands.map((c) => c.name).join('、')} —— 得应一件`);
}

/** 界面上那三张卡读这个。候选 id 认不出来就当没有（存档是外部输入） */
export function eventChoices(g: Game): EventDef[] {
  const out: EventDef[] = [];
  for (const id of g.state.pendingEvent) {
    const d = eventById(id);
    if (d) out.push(d);
  }
  return out;
}

/**
 * 玩家拍板。三道门都要过：
 *   这局确实开着这个功能、确实在出牌中、这个 id 确实在候选里。
 * 少一道的话，"存档里塞一条待决事件"就能让一局关着功能的牌弹面板、
 * 或者让一个认不出的 id 把出牌与弃牌永远堵死（探针实测到的两条）。
 * drawn 是抽牌礼里玩家抽中的那张牌 id（不给就是 -1，等于没抽，账与原来逐位相同）。
 */
export function chooseEvent(g: Game, id: string, drawn = -1): string | null {
  const s = g.state;
  if (!s.flags.events || s.status !== 'playing') return null;
  const at = s.pendingEvent.indexOf(id);
  if (at < 0) return null;
  if (!eventById(id)) { s.pendingEvent.splice(at, 1); return null; }   // 假 id：摘掉这条，别堵着路
  return resolveEvent(g, id, drawn);
}

/** 「让牌局自决」：挑哪一条不摇骰（见 events.ts 的 autoPick），所以结果可断言。也不抽牌——自决就是让牌局自己挑 */
export function autoResolveEvent(g: Game): string | null {
  const s = g.state;
  if (!s.flags.events || s.status !== 'playing') return null;
  const hit = autoPick(eventChoices(g));
  if (!hit) { s.pendingEvent = []; return null; }   // 候选全是假 id：收掉待决，不许把牌局锁死
  return resolveEvent(g, hit.id);
}

/**
 * 这条事件要不要挑一张牌、可以从哪些牌里挑。算式只此一份：
 * 抽牌扇面（fanOffer）与执行器（applyEventOp）都读它，两处各写一遍迟早走样。
 * null = 这条 op 不挑牌；空数组 = 要挑但一张可挑的都没有（不摆扇面）。
 */
function pickPool(s: GameState, op: EventOp): Card[] | null {
  if (op.t === 'copyHand') return s.hand;
  if (op.t === 'mark') {
    const pool = op.where === 'hand' ? s.hand : s.deck;
    // 只在**还没这个花样**的牌里挑：全都有了就明说"没变化"，
    // 而不是把同一道玻璃再刷一遍、账上却记一笔"磨成玻璃牌"
    return op.what === 'enh'
      ? pool.filter((c) => (op.value === 'random' ? c.enh === 'none' : c.enh !== op.value))
      : pool.filter((c) => (op.value === 'random' ? c.seal === 'none' : c.seal !== op.value));
  }
  if (op.t === 'purge') {
    // 扫描顺序从牌堆起、把手牌放最后：事件"带走几张牌"不该顺手把玩家手里正用的牌抽走
    const all = [...s.deck, ...s.discardPile, ...s.table, ...s.hand];
    return op.what === 'random' ? all
      : all.filter((c) => op.what === 'enhanced' ? (c.enh !== 'none' || c.seal !== 'none') : c.seal !== 'none');
  }
  return null;
}

/** 一次事件只有一处由玩家说了算：抽来的那张给第一个候选池里含它的挑牌位用，用完就作废 */
interface DrawPick { id: number; spent: boolean }

function drawnAt(pick: DrawPick | null, pool: Card[]): number {
  if (!pick || pick.spent || pick.id < 0) return -1;
  const i = pool.findIndex((c) => c.id === pick.id);
  if (i < 0) return -1;                       // 抽的那张不在这一处：这不是它的挑牌位
  pick.spent = true;
  return i;
}

/** 扇面最多摆几张。牌堆级别的候选池（带走几张牌）摊不开，抽六张扣过来的牌就够做选择 */
export const FAN_SIZE = 6;

export interface FanOffer {
  /** 扣过来摆成一排的候选，顺序即扇面顺序 */
  cards: Card[];
  /** 这件事要挑的牌不止一张：抽来的那张只定头一张，其余仍由牌局摇。界面照这句说话，不许自己猜 */
  more: boolean;
}

/**
 * 这条事件要不要玩家抽一张牌：要就给出扣过来的那一排，不要就返回 null（界面直接落账）。
 * 只吃派生流，主随机流一根毫毛都不动（与 drawEvents 同一口径）。
 * 名字不叫 drawOffer：web 层已经从 draft.ts 引了同名的"抽签名宾候选"，两处撞名迟早点错外卖。
 */
export function fanOffer(g: Game, id: string): FanOffer | null {
  const s = g.state;
  if (!s.flags.events || s.status !== 'playing') return null;
  const def = eventById(id);
  if (!def || !s.pendingEvent.includes(id)) return null;
  // 只走顶层 op：抛硬币分支里挑的那一张要等骰子落地才知道走哪串，摆出来的扇面就是谎话
  const at = def.ops.findIndex((op) => { const p = pickPool(s, op); return !!p && p.length > 0; });
  if (at < 0) return null;
  let more = false;
  for (let k = at; k < def.ops.length; k++) {
    const pool = pickPool(s, def.ops[k]);
    if (!pool || !pool.length) continue;
    if (k > at || pickCount(def.ops[k]) > 1) { more = true; break; }
  }
  return { cards: fanOf(s, id, pickPool(s, def.ops[at])!), more };
}

/** 这一处要挑几张牌（挑牌的那三类 op 都带 n，其余为 0） */
function pickCount(op: EventOp): number {
  return op.t === 'copyHand' || op.t === 'mark' || op.t === 'purge' ? op.n : 0;
}

function fanOf(s: GameState, eventId: string, pool: Card[]): Card[] {
  const r = deriveFanRand(s.seed, s.night, eventId);
  const left = pool.slice();
  const out: Card[] = [];
  while (out.length < FAN_SIZE && left.length) out.push(left.splice(r.int(left.length), 1)[0]);
  return out;
}

function resolveEvent(g: Game, id: string, drawn = -1): string | null {
  const s = g.state;
  const def = eventById(id);
  if (!def || !s.pendingEvent.includes(id)) return null;
  const out: string[] = [];
  const pick: DrawPick | null = drawn >= 0 ? { id: drawn, spent: false } : null;
  for (const op of def.ops) applyEventOp(g, op, id, out, pick);
  s.pendingEvent = [];
  const result = out.join('，') || def.blurb;
  s.events.push({ night: s.night, id, result });
  // 事件可能把手牌换掉、带走、重发（河雾/梗犬/扫烟囱的）：选中项里那些已经不在手里的 id
  // 必须一起扫掉。留着的话，那张牌一旦重新发到手，就莫名其妙是"选中"状态。
  // trimHand 只在**超上限**时才做这件事，挡不住这条。
  s.chosen = s.chosen.filter((id) => s.hand.some((c) => c.id === id));
  // 事件可能把上限压低了（招灵会那种）：多出来的按既有规矩搁进弃牌堆，而不是硬留在手上
  trimHand(g);
  g.note(`${def.name}：${result}`);
  return result;
}

const signed = (n: number): string => `${n > 0 ? '+' : '−'}£${Math.abs(n)}`;

const MOD_LABEL: Record<keyof Mods, string> = {
  seats: '座位', handSize: '手牌上限', hands: '出牌次数', discards: '弃牌次数',
  slots: '随身位', interestCap: '利息上限', targetScale: '彩头', freeRerolls: '免费重掷',
  priceScale: '货价',
};
/** 系数类是乘的，其余是加减——文案别把 ×1.1 写成 +1.1 */
const SCALE_KEYS: (keyof Mods)[] = ['targetScale', 'priceScale'];

function modLine(m: Mods, scope: EventScope): string {
  const parts = (Object.keys(m) as (keyof Mods)[]).map((k) => {
    const v = m[k];
    if (v === undefined) return '';
    return SCALE_KEYS.includes(k) ? `${MOD_LABEL[k]} ×${v}` : `${MOD_LABEL[k]} ${v > 0 ? '+' : ''}${v}`;
  }).filter(Boolean);
  return `${scopeName(scope)}${parts.join('、')}`;
}

function cardLabel(c: Card): string {
  const mark = c.enh !== 'none' ? materialById(c.enh).name
    : c.seal !== 'none' ? sealById(c.seal).name : '';
  return `${SUIT_NAME[c.suit]}${RANK_LABEL(c.rank)}${mark ? `（${mark}）` : ''}`;
}

const LADDER: Edition[] = ['none', 'foil', 'holo', 'polychrome'];
const POOL_ENH = ENH_IDS.filter((x) => x !== 'none') as Enh[];
const POOL_SEAL = SEAL_IDS.filter((x) => x !== 'none') as Seal[];

/** 一条操作怎么落到 state 上。out 收的是"实际发生了什么"那句账，进事件回顾。 */
function applyEventOp(g: Game, op: EventOp, from: string, out: string[], pick: DrawPick | null = null): void {
  const s = g.state;
  if (op.t === 'money') {
    s.money = Math.max(0, s.money + op.n);
    out.push(`银钱 ${signed(op.n)}`);
    return;
  }
  if (op.t === 'rep') {
    s.rep = Math.max(0, s.rep + op.n);
    out.push(`声望 ${op.n > 0 ? '+' : '−'}${Math.abs(op.n)}`);
    return;
  }
  if (op.t === 'rule') {
    s.eventMods.push({
      from, scope: op.scope, night: s.night,
      hands: op.scope === 'hand' ? 1 : undefined, rule: op.m,
    });
    out.push(modLine(op.m, op.scope));
    return;
  }
  if (op.t === 'score') {
    // 只带流水/倍注/倍注乘：钱不许绕过分账走管道（见 events.ts 里那条注释）
    s.eventMods.push({
      from, scope: op.scope, night: s.night,
      hands: op.scope === 'hand' ? (op.hands ?? 1) : undefined,
      eff: { chips: op.e.chips, mult: op.e.mult, xmult: op.e.xmult },
    });
    const bits: string[] = [];
    if (op.e.chips) bits.push(`流水 ${op.e.chips > 0 ? '+' : ''}${op.e.chips}`);
    if (op.e.mult) bits.push(`倍注 ${op.e.mult > 0 ? '+' : ''}${op.e.mult}`);
    if (op.e.xmult && op.e.xmult !== 1) bits.push(`倍注 ×${op.e.xmult}`);
    out.push(`${scopeName(op.scope)}每手${bits.join('、')}`);
    return;
  }
  if (op.t === 'addCard') {
    for (const c of op.cards) {
      if (totalCards(s) >= MAX_DECK) { out.push('牌堆已满，加不下了'); return; }
      const card: Card = {
        id: uid++, rank: c.rank, suit: c.suit, enh: c.enh ?? 'none', seal: c.seal ?? 'none',
      };
      s.deck.push(card);
      g.rand.shuffle(s.deck);
      out.push(`${cardLabel(card)}进牌堆`);
    }
    return;
  }
  if (op.t === 'copyHand') {
    for (let i = 0; i < op.n; i++) {
      const pool = pickPool(s, op)!;
      if (!pool.length) return;
      if (totalCards(s) >= MAX_DECK) { out.push('牌堆已满，誊不出'); return; }
      const rolled = g.rand.int(pool.length);        // 有没有人抽都照旧摇这一位：抽牌只换"哪张"，不挪后面的牌序
      const at = drawnAt(pick, pool);                // 只认一次：抽中的那张用掉就作废
      const src = pool[at < 0 ? rolled : at];
      const copy: Card = { id: uid++, rank: src.rank, suit: src.suit, enh: src.enh, seal: src.seal };
      s.deck.push(copy);
      g.rand.shuffle(s.deck);
      out.push(`誊出${cardLabel(copy)}`);
    }
    return;
  }
  if (op.t === 'mark') {
    const raw = op.where === 'hand' ? s.hand : s.deck;
    for (let i = 0; i < op.n; i++) {
      if (!raw.length) return;
      const fresh = pickPool(s, op)!;
      // 挑一张**还没这个花样**的牌：全都有了就明说"没变化"，
      // 而不是把同一道玻璃再刷一遍、账上却记一笔"磨成玻璃牌"
      if (!fresh.length) { out.push('该落的花样已经都在了，没再动牌'); return; }
      const rolled = g.rand.int(fresh.length);
      const at = drawnAt(pick, fresh);
      const c = fresh[at < 0 ? rolled : at];
      if (op.what === 'enh') {
        c.enh = op.value === 'random' ? g.rand.pick(POOL_ENH) : (op.value as Enh);
        out.push(`${cardLabel(c)}`);
      } else {
        c.seal = op.value === 'random' ? g.rand.pick(POOL_SEAL) : (op.value as Seal);
        out.push(`${cardLabel(c)}`);
      }
    }
    return;
  }
  if (op.t === 'strip') {
    // 按列表顺序洗，不摇骰：洗多少张该是确定的，"随机洗净哪几张"没有意义
    const pool = op.where === 'hand' ? s.hand
      : [...s.deck, ...s.hand, ...s.table, ...s.discardPile];
    let k = 0;
    for (const c of pool) {
      if (k >= op.n) break;
      if (c.enh === 'none' && c.seal === 'none') continue;
      c.enh = 'none';
      c.seal = 'none';
      k += 1;
    }
    out.push(`洗净 ${k} 张牌的花样`);
    return;
  }
  if (op.t === 'purge') {
    // 'random' 那类必须真随机（文案写"谁也没看清是哪张"）——按列表顺序拿前几张是假的。
    // 挑哪几张、按什么顺序挑，全在 pickPool 那一个算式里（含把手牌排在最后的扫描顺序）
    const pool = pickPool(s, op)!;
    let gone = 0;
    let gain = 0;
    while (gone < op.n && pool.length) {
      // 和销账同一道下界：牌可以被带走，但不能被带到发不出手
      if (totalCards(s) <= MIN_DEALABLE) break;
      let at = 0;
      if (op.what === 'random') {
        const rolled = g.rand.int(pool.length);
        at = drawnAt(pick, pool);
        if (at < 0) at = rolled;
      }
      const c = pool.splice(at, 1)[0];
      dropFromDeck(s, c.id);
      gone += 1;
      if (op.per) gain += op.per;
    }
    if (gain) s.money = Math.max(0, s.money + gain);
    out.push(gone ? `带走 ${gone} 张牌${gain ? `，折 £${gain}` : ''}` : '一张也没带走');
    return;
  }
  if (op.t === 'returnDiscard') {
    const take = s.discardPile.splice(0, Math.min(op.n, s.discardPile.length));
    if (!take.length) { out.push('弃牌堆是空的'); return; }
    s.deck.push(...take);
    g.rand.shuffle(s.deck);
    out.push(`收回 ${take.length} 张弃牌`);
    return;
  }
  if (op.t === 'mulligan') {
    s.deck.push(...s.hand.splice(0));
    g.rand.shuffle(s.deck);
    drawTo(s, limits(s).handSize, g.rand);
    out.push('重发一手');
    return;
  }
  if (op.t === 'seat') {
    if (!s.seats.length) { out.push('桌上本来就没有人'); return; }
    if (op.what === 'leave') {
      // 随机挑一位**带走得起的**：有些位子是套装的随身格撑起来的，那种人带走了会把玩家的
      // 信凭空挤出去。全都带不走就谁也不走，把这句话摆在账里，而不是硬塞一个错误
      const safe = s.seats.map((x, i) => i).filter((i) => !strandingOnSeatLoss(s, i));
      if (!safe.length) { out.push('可带走的人人都撑着随身格，一位也没走'); return; }
      const seat = removeSeat(s, g.rand.pick(safe));
      if (op.refund) s.money = Math.max(0, s.money + op.refund);
      out.push(`${patronById(seat.pid).name}离席${op.refund ? `，补 £${op.refund}` : ''}`);
      return;
    }
    const cand = s.seats.filter((x) => x.edition !== 'polychrome' && x.edition !== 'negative');
    if (!cand.length) { out.push('没有还能再升版本的客人'); return; }
    const seat = g.rand.pick(cand);
    const at = LADDER.indexOf(seat.edition);
    seat.edition = LADDER[Math.min(at + 1, LADDER.length - 1)];
    out.push(`${patronById(seat.pid).name}升为${EDITION_NAME[seat.edition]}`);
    return;
  }
  if (op.t === 'grantSeat') {
    if (seatedCount(s) >= limits(s).seats) { out.push('座位已满，谁来也坐不下'); return; }
    const pool = PATRONS.filter((x) => x.rarity === op.rarity && !seatIds(s).includes(x.id));
    if (!pool.length) { out.push('名录上这一档已无生面孔'); return; }
    if (op.price > s.money) { out.push('银钱不够，名录合上了'); return; }
    const p = g.rand.pick(pool);
    if (op.price) s.money -= op.price;
    s.seats.push(mkSeat(p.id));
    out.push(`${p.name}入席`);
    return;
  }
  if (op.t === 'grantLetter') {
    if (s.consumables.length >= limits(s).slots) { out.push('随身已满，信没地方放'); return; }
    const l = op.id ? LETTERS.find((x) => x.id === op.id) : g.rand.pick(LETTERS);
    if (!l) { out.push('那封信没人认得'); return; }
    s.consumables.push({ t: 'letter', id: l.id });
    out.push(`得「${l.name}」`);
    return;
  }
  if (op.t === 'bookUp') {
    for (let i = 0; i < op.n; i++) {
      const k = op.kind ?? g.rand.pick(Object.keys(HANDS) as HandKind[]);
      s.books[k] = (s.books[k] ?? 1) + 1;
      out.push(`${HANDS[k].name}升到 ${s.books[k]} 级`);
    }
    return;
  }
  // 抛硬币：走主随机流。正反各执行一串，记下面朝上那一面
  if (g.rand.chance(op.p)) {
    out.push('掷骰成了');
    for (const sub of op.win) applyEventOp(g, sub, from, out, pick);
  } else {
    out.push('掷骰败了');
    for (const sub of op.lose) applyEventOp(g, sub, from, out, pick);
  }
}

// ── 过关结算：赏金 + 利息 + 盈余转本金 + 客人尾款 + 握在手里的金票 ──
export function settle(g: Game): void {
  const s = g.state;
  const lim = limits(s);
  const kind = STAGE_KIND[s.stage];
  const target = targetOf(s);
  const lines: SettleLine[] = [];

  const bet = betFor(s.raisedHere);
  const reward = Math.round(STAGE_REWARD[kind] * (s.flags.bets ? bet.rewardMult : 1 + 0.5 * s.raisedHere));
  const interest = Math.min(lim.interestCap, Math.floor(s.money / 5));
  const surplus = Math.max(0, s.score - target);
  // 盈余折现按彩头比例走，于是它随夜数自然放大而不会后期失真
  const profit = Math.min(12, Math.round((surplus / Math.max(1, target)) * 6) + (s.flags.bets ? bet.surplusBonus : s.raisedHere));

  lines.push({ label: '赏金', amount: reward });
  lines.push({ label: '存钱利息', amount: interest });
  lines.push({ label: '盈余折现', amount: profit });

  let gold = 0;
  for (const c of s.hand) if (c.enh === 'gold') gold += 4;
  if (gold) lines.push({ label: '手中金票', amount: gold });

  // 挂在"握于手中"和"局终结账"上的客人，尾款在这里付
  const defs = s.seats.map((x) => patronById(x.pid));
  for (const c of s.hand) {
    for (const p of defs) {
      if (p.hook !== 'onHeld' || !p.apply) continue;
      const e = p.apply({ ...baseCtx(s, g.rand), card: c, target: targetOf(s) });
      const amt = e ? (Array.isArray(e) ? e : [e]).reduce((a, x) => a + (x.money ?? 0), 0) : 0;
      if (amt) lines.push({ label: p.name, amount: amt, pid: p.id });
    }
  }
  for (const p of defs) {
    if (p.hook !== 'onRoundEnd' || !p.apply) continue;
    const e = p.apply({ ...baseCtx(s, g.rand), discardsUsed: s.discardsUsed, target: targetOf(s) });
    const amt = e ? (Array.isArray(e) ? e : [e]).reduce((a, x) => a + (x.money ?? 0), 0) : 0;
    if (amt) lines.push({ label: p.name, amount: amt, pid: p.id });
  }

  // 藏书阁：本场用得最多的牌型自动升一级
  if (s.vouchers.includes('library')) {
    const top = (Object.keys(s.handUse) as HandKind[])
      .sort((a, b) => (s.handUse[b] ?? 0) - (s.handUse[a] ?? 0))[0];
    if (top) {
      s.books[top] = levelOf(s, top) + 1;
      lines.push({ label: `藏书阁 · ${HANDS[top].name} 升一级`, amount: 0 });
    }
  }

  const total = lines.reduce((a, x) => a + x.amount, 0);
  s.settlement = lines;
  s.money += total;
  s.rep += (s.flags.bets ? bet.repBonus : s.raisedHere) + (kind === 'boss' ? 1 : 0);

  s.ledger.push({
    night: s.night, stage: kind, label: stakeLabel(s),
    target, best: s.score, reward: total,
    profit, money: s.money, raised: s.raisedHere, rep: s.rep,
  });
  s.chosen = [];
  s.status = 'cleared';
  // 不清 s.table：赢家那几张要留在桌面上让人看清，等下一场 setupStage 再收
  g.note(`${stakeLabel(s)} 结清，入账 £${total}`);
}

// ── 铺子 ───────────────────────────────────────────────────────
function rollEdition(rand: Rand): Edition {
  const total = Object.values(EDITION_WEIGHT).reduce((a, b) => a + b, 0);
  let x = rand.next() * total;
  for (const e of Object.keys(EDITION_WEIGHT) as Edition[]) {
    x -= EDITION_WEIGHT[e];
    if (x <= 0) return e;
  }
  return 'none';
}

function weightedPatron(rand: Rand, owned: string[], minRep: number): PatronDef | null {
  const pool = PATRONS.filter((p) => !owned.includes(p.id) && RARITY_MIN_REP[p.rarity] <= minRep);
  if (!pool.length) return null;
  const total = pool.reduce((a, p) => a + RARITY_WEIGHT[p.rarity], 0);
  let x = rand.next() * total;
  for (const p of pool) {
    x -= RARITY_WEIGHT[p.rarity];
    if (x <= 0) return p;
  }
  return pool[pool.length - 1];
}

/** 定价：版本溢价 + 会员折扣，向下取整但最低 £1 */
function priceOf(base: number, edition: Edition | undefined, scale: number): number {
  const raw = (base + (edition ? EDITION_PREMIUM[edition] : 0)) * scale;
  return Math.max(1, Math.floor(raw));
}

function rollConsumable(rand: Rand): Consumable {
  return rand.next() < 0.55
    ? { t: 'letter', id: rand.pick(LETTERS).id }
    : { t: 'book', id: rand.pick(BOOKS).kind };
}

export function restock(g: Game): void {
  const s = g.state;
  const rand = g.rand;
  const rep = s.rep + s.raisedHere;
  const scale = limits(s).priceScale;
  const slots: ShopSlot[] = [];
  // 逐个排除：两次都用同一份"已拥有"名单的话，同一位客人会被摆上两个货位
  const offered = [...seatIds(s)];
  for (let i = 0; i < 2; i++) {
    const p = weightedPatron(rand, offered, rep);
    if (p) {
      offered.push(p.id);
      const ed = rollEdition(rand);
      slots.push({ kind: 'patron', pid: p.id, edition: ed, price: priceOf(p.cost, ed, scale), sold: false });
    }
  }
  const item = rollConsumable(rand);
  slots.push({ kind: 'consumable', item, price: priceOf(3, undefined, scale), sold: false });
  const v = VOUCHERS.find((x) => !s.vouchers.includes(x.id));
  if (v) slots.push({ kind: 'voucher', vid: v.id, price: priceOf(v.cost, undefined, scale), sold: false });
  s.shop = slots;
  s.rerolls = 0;
  s.status = 'shop';
}

export const rerollPrice = (s: GameState): number => {
  const lim = limits(s);
  return s.rerolls < lim.freeRerolls ? 0 : 5 + s.rerolls;
};

export function reroll(g: Game): boolean {
  const s = g.state;
  const price = rerollPrice(s);
  if (s.money < price) return false;
  s.money -= price;
  s.rerolls += 1;
  const rand = g.rand;
  const rep = s.rep + s.raisedHere;
  const scale = limits(s).priceScale;
  s.shop = s.shop.map((slot) => {
    if (slot.sold) return slot;
    if (slot.kind === 'patron') {
      const p = weightedPatron(rand, seatIds(s), rep);
      if (!p) return slot;
      const ed = rollEdition(rand);
      return { ...slot, pid: p.id, edition: ed, price: priceOf(p.cost, ed, scale) };
    }
    if (slot.kind === 'consumable') {
      const item = rollConsumable(rand);
      return { ...slot, item, price: priceOf(3, undefined, scale) };
    }
    return slot;
  });
  return true;
}

export function buy(g: Game, i: number): boolean {
  const s = g.state;
  const slot = s.shop[i];
  if (!slot || slot.sold) return false;
  if (s.money < slot.price) return false;
  const lim = limits(s);
  if (slot.kind === 'patron') {
    // 负片不占座位，所以它不该被"座位已满"挡住——否则它的唯一卖点永远买不到
    if (slot.edition !== 'negative' && seatedCount(s) >= lim.seats) return false;
    if (seatIds(s).includes(slot.pid!)) return false;      // 同一位客人不请第二次
    const def = patronById(slot.pid!);
    s.seats.push(mkSeat(def.id, slot.edition ?? 'none'));
    g.note(`${def.name} 入了席`);
  } else if (slot.kind === 'consumable') {
    if (s.consumables.length >= lim.slots) return false;
    s.consumables.push(slot.item!);
  } else {
    s.vouchers.push(slot.vid!);
    g.note(`办下了${VOUCHERS.find((v) => v.id === slot.vid)!.name}`);
  }
  s.money -= slot.price;
  slot.sold = true;
  return true;
}

/**
 * P0-2 换座。把 from 位的客人挪到 to 位，花费 SWAP_COST 银钱。
 * 只在铺子阶段开放（演出中不许改账），且 flag 关掉时直接拒绝——
 * 关掉就该等于"座位次序不可操作"，而不是"能操作但没效果"。
 */
// ── P1-4 弃牌堆可操作 ────────────────────────────────────────
// 原来的弃牌堆是**只进不出**的：discard() 往里 push，换场时 recycle() 整堆洗回牌堆。
// 界面看不见它，玩家也不知道自己丢了什么。这里开两个口子：
//   peekDiscard —— 只是看，不花钱，任何时刻都能看
//   fishDiscard —— 花 FISH_COST 把一张捞回**牌堆底**，不是直接入手
// 为什么回牌堆底而不是回手牌：直接入手等于凭空多一张牌，会绕开"牌堆会打空"这个
// 压力源（fuzz 抓过的那条"牌只能被移出或复制，不能凭空多出来"）。
// 回底部则仍然要等它被抽上来，只是保证它一定会再来一次。
export const FISH_COST = 5;
export const PEEK_MAX = 8;

/** 最近弃掉的 n 张（新的在前）。纯读，不改状态 */
export function peekDiscard(s: GameState, n = PEEK_MAX): Card[] {
  const k = Math.max(0, Math.min(PEEK_MAX, n));
  return s.discardPile.slice(-k).reverse();
}

/** 弃牌堆里某张牌在不在。给界面判断"能不能捞" */
export const inDiscard = (s: GameState, id: number): boolean =>
  s.discardPile.some((c) => c.id === id);

/** 捞回牌堆底。只在铺子阶段开放，钱要够，牌必须真的在弃牌堆里 */
export function fishDiscard(g: Game, id: number): boolean {
  const s = g.state;
  if (!s.flags.discardOps) return false;
  if (s.status !== 'shop') return false;
  if (s.money < FISH_COST) return false;
  const i = s.discardPile.findIndex((c) => c.id === id);
  if (i < 0) return false;
  const [back] = s.discardPile.splice(i, 1);
  s.deck.push(back);                       // 底部：下一场洗牌后必然重新入场
  s.money -= FISH_COST;
  g.note(`从弃牌堆捞回一张（£${FISH_COST}）`);
  return true;
}

export const SWAP_COST = 2;

export function canReorderSeat(s: GameState): boolean {
  return s.flags.adjacency && s.status === 'shop';
}

export function reorderSeat(g: Game, from: number, to: number): boolean {
  const s = g.state;
  if (!canReorderSeat(s)) return false;
  if (from === to) return false;
  if (from < 0 || to < 0 || from >= s.seats.length || to >= s.seats.length) return false;
  if (s.money < SWAP_COST) return false;
  const [moved] = s.seats.splice(from, 1);
  s.seats.splice(Math.min(to, s.seats.length), 0, moved);
  s.money -= SWAP_COST;
  g.note(`${patronById(moved.pid).name} 换到了第 ${to + 1} 位（£${SWAP_COST}）`);
  return true;
}

/**
 * 请走一位撑着加手的客人之后，手里可能比新上限多出几张。
 * 不拦玩家卖人（那是他的构筑自由），改成把多出来的当场搁进弃牌堆：
 * 弃牌堆不是损失，下一场回收还会洗回来。
 */
function trimHand(g: Game): void {
  const s = g.state;
  const over = s.hand.length - limits(s).handSize;
  if (over <= 0) return;
  const cut = s.hand.splice(s.hand.length - over);
  s.discardPile.push(...cut);
  s.chosen = s.chosen.filter((id) => s.hand.some((c) => c.id === id));
  g.note(`手牌超了新上限 ${over} 张，先搁进弃牌堆`);
}

/**
 * 座位上没有了那位签名宾，`state.signature` 就该当场清空。
 * 存档读取路径本来有一条同样的清理（save.ts），但那只在读档时跑——
 * 玩家当场被事件请走、或者自己卖掉那位之后，图鉴与结算都还会宣称他在座。
 */
function syncSignature(s: GameState): void {
  if (s.signature && !s.seats.some((x) => x.pid === s.signature)) s.signature = '';
}

/** 三条离席路径共用同一项变更，签名宾标记与在座名单同步。容量先由调用方核对。 */
function removeSeat(s: GameState, index: number): Seat {
  const seat = s.seats.splice(index, 1)[0];
  syncSignature(s);
  return seat;
}

/**
 * 请走某位客人之后，随身格还装得下现有的信吗？
 * 套装的 +1 随身是**这两位都在场**才有的（`sets.ts` 的信匣/同乡那几套），所以卖掉或
 * 被事件带走其中一位，容量会当场缩一格。fuzz 抓到过一次"信匣还装着三封、客人一走
 * 就成超收"——容量是客人撑起来的，那就先腾开再谈退席，而不是把玩家的货凭空丢掉。
 */
function strandingOnSeatLoss(s: GameState, index: number): boolean {
  const after = limits({ ...s, seats: s.seats.filter((_, i) => i !== index) });
  return s.consumables.length > after.slots;
}

export function sellSeat(g: Game, index: number): boolean {
  const s = g.state;
  const seat = s.seats[index];
  if (!seat) return false;
  if (strandingOnSeatLoss(s, index)) {
    g.note(`${patronById(seat.pid).name}的位子撑着随身格，先把信用完再退席`);
    return false;
  }
  const p = patronById(seat.pid);
  s.money += Math.max(1, Math.floor((p.cost + EDITION_PREMIUM[seat.edition]) / 2));
  removeSeat(s, index);
  g.note(`${p.name} 离席`);
  trimHand(g);

  return true;
}

export function useConsumable(g: Game, index: number, targetIds: number[]): boolean {
  const s = g.state;
  const c = s.consumables[index];
  if (!c) return false;
  if (c.t === 'book') {
    s.books[c.id] = levelOf(s, c.id) + 1;
    g.note(`${HANDS[c.id].name} 升到 ${s.books[c.id]} 级`);
    s.consumables.splice(index, 1);
    return true;
  }
  const l = letterById(c.id);
  // 同一个 id 报两次不算两个目标：否则信被消耗掉却什么都没改
  const uniqIds = [...new Set(targetIds)];
  const picked = uniqIds.map((id) => s.hand.find((x) => x.id === id)).filter(Boolean) as Card[];
  if (picked.length !== l.picks) return false;

  // picks=0 的信（命签）没有目标牌，下面凡是取 picked[0] 的分支都不能碰
  const t = picked[0] as Card | undefined;

  switch (l.id) {
    case 'gild': t!.enh = 'bonus'; break;
    case 'vermilion': t!.enh = 'mult'; break;
    case 'lens': t!.enh = 'glass'; break;
    case 'will': t!.enh = 'gold'; break;
    case 'swap': t!.suit = majoritySuit(s.hand); break;
    case 'strike':
      // 销账是永久移除：不给下限的话，52 张牌可以被一路拆到无牌可发
      if (totalCards(s) <= MIN_DEALABLE) { g.note('牌已经不够拆了，这张得留着'); return false; }
      dropFromDeck(s, t!.id); s.money += 5; break;
    case 'purge': t!.enh = 'none'; t!.seal = 'none'; s.money += 3; break;
    case 'echo': t!.seal = 'red'; break;
    case 'wax': t!.seal = g.rand.pick(SEALS); break;
    case 'fortune': s.money += 8 + g.rand.int(13); break;
    case 'twin': {
      const a = picked[0];
      const b = picked[1];
      b.rank = a.rank;
      b.suit = a.suit;
      break;
    }
    case 'write': {
      if (totalCards(s) >= MAX_DECK) {
        g.note('牌堆已经挤不下了');
        return false;
      }
      const copy: Card = { id: uid++, rank: t!.rank, suit: t!.suit, enh: t!.enh, seal: t!.seal };
      s.deck.push(copy);
      g.rand.shuffle(s.deck);
      break;
    }
  }
  g.note(l.picks ? `${l.name} 用在了 ${RANK(t!)}${SUITSym(t!.suit)} 上` : `${l.name} 抽到了`);
  s.consumables.splice(index, 1);
  return true;
}

/** 全场牌数（含手牌与桌面），誊抄造牌要受它约束 */
export const totalCards = (s: GameState): number =>
  s.deck.length + s.hand.length + s.discardPile.length + s.table.length;

// 抬注：不花钱，纯风险决策。抬了就要面对更硬的彩头，但赏金、盈余、客档都跟着涨。
export function setRaise(g: Game, levels: number): void {
  g.state.raiseNext = Math.max(0, Math.min(4, levels));
}

function leaveShop(g: Game): void {
  const s = g.state;
  if (s.stage < 2) {
    s.stage = (s.stage + 1) as Stage;
  } else {
    if (s.night >= s.nights && !s.endless) { s.status = 'won'; return; }
    s.night += 1;
    s.stage = 0;
  }
  recycle(g);
  setupStage(s, g.rand);
}

export function continueEndless(g: Game): void {
  const s = g.state;
  s.status = 'cleared';
  s.endless = true;
  s.night += 1;
  s.stage = 0;
  recycle(g);
  setupStage(s, g.rand);
}

/** 换场回收：手里剩的、弃掉的、打在桌上没走的，全部回牌堆，新的一夜重新发满手。
 *  漏掉 s.table 会让每打一手就有几张牌永久蒸发；漏掉 s.hand 则上一夜剩的牌会挤占
 *  新一夜的手牌位，贵客压低手牌上限时直接失效。 */
function recycle(g: Game): void {
  const s = g.state;
  s.deck = g.rand.shuffle([...s.deck, ...s.discardPile.splice(0), ...s.table.splice(0), ...s.hand.splice(0)]);
}

export interface RunOpts {
  endless?: boolean; diff?: Diff; mode?: Mode;
  /** 一局几夜（3..15）。不给就是八夜参照档；越界与畸形值由 clampNights 落回八夜 */
  nights?: number;
  /** 不给就是全关：新功能默认不影响任何一局 */
  flags?: Partial<FeatureFlags>;
  /** 开局选的签名宾 id。空或认不出的一律忽略，等于没这个功能 */
  signature?: string;
}

export class Game {
  public state: GameState;
  public rand: Rand;
  public notes: string[] = [];

  constructor(seed: number, deckId = 'standard', opts: boolean | RunOpts = {}) {
    // 第三个参数收 bool 是为了让 75 处既有调用点不动（其中两处传 endless）
    const o: RunOpts = typeof opts === 'boolean' ? { endless: opts } : opts;
    const mode: Mode = modeById(o.mode ?? (o.endless ? 'endless' : 'run')).id;
    const diff: Diff = mode === 'daily' ? 'standard' : diffById(o.diff ?? 'standard').id;
    const df = diffById(diff);
    this.rand = new Rand(seed);
    uid = 1;
    const nights = mode === 'daily' ? DEFAULT_NIGHTS : clampNights(o.nights ?? DEFAULT_NIGHTS);
    // 每日一局的"同一副牌序"包含牌组与局长：锁标准局、锁八夜参照档，
    // 否则同一天两个人起手不一样、终点也不一样，"同一局"就只剩个名字。
    // 档位专属牌组对不上所选局长时落回标准局：带一副屏幕上根本选不到的牌组进局，
    // 比不锁更糟（与 signature 那条同一口径）
    const want = mode === 'daily' ? 'standard' : deckId;
    const dk = deckLegal(want, nights) ? deckById(want) : deckById('standard');
    this.state = {
      seed, deckId: dk.id, night: 1, nights,
      stage: 0, status: 'playing',
      money: 4, rep: 0, raiseNext: 0, raisedHere: 0,
      deck: freshDeck(this.rand), hand: [], table: [], chosen: [], discardPile: [],
      seats: [], consumables: [], books: {}, handUse: {}, vouchers: [], bossId: null,
      handsLeft: 4, discardsLeft: 3, handIndex: 0, discardsUsed: 0, score: 0,
      shop: [], rerolls: 0, ledger: [], discovered: [], settlement: [],
      endless: mode !== 'daily' && (mode === 'endless' || !!o.endless), diff, mode, log: [],
      flags: mode === 'daily' ? { ...FLAGS_OFF } : { ...FLAGS_OFF, ...(o.flags ?? {}) },
      claimed: [], betReprieves: 0, buffer: START_BUFFER, signature: '', tutorial: [], guide: [],
      eventAt: 0, nightActions: 0, pendingEvent: [], events: [], eventMods: [],
    };
    const s = this.state;
    s.money = Math.max(0, s.money + (dk.money ?? 0) + df.money);
    if (dk.grant) {
      const pool = PATRONS.filter((x) => x.rarity === dk.grant);
      if (pool.length) s.seats.push(mkSeat(this.rand.pick(pool).id));
    }
    // 签名宾：开局白送一位**玩家自己挑的**客人。
    // 这里绝不碰 this.rand——候选是界面侧用派生流抽的（draft.ts），
    // 主随机流一步都不许多消耗，否则发牌与铺子整体后移，老档快进就会落到别的牌上。
    if (s.flags.draft && o.signature) {
      const sig = PATRONS.find((x) => x.id === o.signature);
      if (sig && !seatIds(s).includes(sig.id)) {
        s.seats.push(mkSeat(sig.id));
        s.signature = sig.id;
      }
    }
    setupStage(s, this.rand);
  }

  /** 读档后要把自增 id 推到已有最大值之后，否则「誊抄」会造出与现有牌撞 id 的牌 */
  bumpUid(to: number): void {
    if (to > uid) uid = to;
  }

  note(text: string): void {
    this.notes.push(text);
    this.state.log.unshift(text);
    if (this.state.log.length > 40) this.state.log.pop();
  }

  // 铺子是"过关"之后的事，由 UI 在动画演完之后调用
  openShop(): void {
    restock(this);
  }

  next(): void {
    leaveShop(this);
  }

  target(): number {
    return targetOf(this.state);
  }
}

