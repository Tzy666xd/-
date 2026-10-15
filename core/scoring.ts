// 结算引擎：把一次出牌摊成**一串带前后快照的因果事件**。
// 这是整个架构里最贵也最值钱的一条决定。原版最核心的手感是"客人严格从左到右逐个触发，
// 每个配一次脉冲、暂停、再更新累计值"，约 300ms 一场——复合乘法被演成因果剧，等于免写了教程。
// 要播得出这场戏，计分就不能是一次算完的一个数，而必须是可重放的序列。
// UI 只管照着事件播、把 after 快照贴到屏幕上，自己不做任何算术。
import type { Card, HandKind, HandResult } from './hands.ts';
import { cardChips, handBase } from './hands.ts';
import type { Effect, PatronCtx, PatronDef, Seat } from './effects.ts';
import { editionEffect } from './effects.ts';
import type { BossDef } from './content.ts';
import { patronById } from './content.ts';
import { specialEffect } from './special-cards.ts';
import type { Rand } from './rng.ts';
import type { ThresholdDef } from './thresholds.ts';
import { crossedThresholds, MAX_PER_HAND, MAX_PER_STAGE } from './thresholds.ts';
import { growthBonus } from './growth.ts';
import {
  layerChips, layerMult, layerXmult, layerRepeat, layerMoney, layerBreaksOn,
  BLUE_SEAL_CHIPS_PER,
} from './layers.ts';

export interface Snap {
  chips: number;
  mult: number;
  value: number;
}

export type ScoreEvent =
  | { t: 'hand'; kind: HandKind; level: number; after: Snap }
  | { t: 'blocked'; id: number; why: string; after: Snap }
  | { t: 'card'; id: number; addChips: number; addMult: number; xmult: number; note?: string; after: Snap }
  | { t: 'patron'; pid: string; addChips: number; addMult: number; xmult: number; note: string; cardId: number | null; after: Snap }
  // P0-3 阈值达成。走的是同一条 chips/mult 链，所以它只是链上的一个节点，不是新维度
  | { t: 'bonus'; source: string; tid: string; addChips: number; addMult: number; xmult: number; after: Snap }
  | { t: 'shatter'; id: number; after: Snap }
  | { t: 'total'; after: Snap };

export interface ScoreEnv {
  handIndex: number;
  rep: number;
  raised: number;
  discardsUsed: number;
  money: number;
}

export interface ScoreInput {
  played: Card[];
  result: HandResult;
  level: number;
  held: Card[];
  seats: Seat[];
  env: ScoreEnv;
  boss?: BossDef | null;
  rand: Rand;
  /** P0-3：本局启用的阈值（feature flag 关掉就传空数组，一次都不判） */
  thresholds?: ThresholdDef[];
  /** 阈值折算基准＝本场彩头。表里存的是百分比，所以这里要给出绝对值 */
  targetLine?: number;
  /** 本场累计（不含这一手），span='stage' 用它换算 */
  scoreBefore?: number;
  /** 已经认领过的阈值 id：span='stage' 的整场只认一次 */
  claimed?: string[];
  /** P0-2 邻接共鸣开关。关掉时座位次序完全不参与结算 */
  adjacency?: boolean;
  /** P1-3 把 enh/seal 两个 enum 换成两张数据表读数。关掉走原来写死的那几行 */
  layers?: boolean;
  /** P1-2 成长型客人：按座位上的 XP 追加一档加成 */
  growth?: boolean;
  /**
   * 随机事件挂着的加项。和 thresholds 同一形状：**空数组就等于这个功能不存在**
   * （不进分支、不摇骰、不产生事件），所以关掉开关的老判据一根汗毛都不会动。
   * 只带流水/倍注/倍注乘：银钱不在这里走（§10 第 3 条还没定，不由事件替它定）。
   */
  events?: { name: string; tid: string; chips?: number; mult?: number; xmult?: number }[];
  /**
   * 局面读数。只给**只读**信息，让客人能有各自的触发条件（"牌堆快空了""这是最后一手"
   * "座位最右边"），而不是多加一种分数。缺省就省略，机制自动退化为不触发。
   * roll 是吃概率的客人唯一能用的随机口，走的是同一条种子流。
   */
  scene?: {
    handsLeft?: number; deckLeft?: number; discardCount?: number;
    distinctKinds?: number; night?: number; target?: number;
  };
  /** 摇概率。必须由内核传进来，界面不许自己摇——否则演出重放会对不上账 */
  roll?: (p: number) => boolean;
}

export interface ScoreResult {
  events: ScoreEvent[];
  value: number;
  chips: number;
  mult: number;
  shattered: number[];
  money: number;
  /** 这一手新认领的阈值 id，由调用方并进场级账上 */
  claimedNow: string[];
}

const GLASS_BREAK = 0.25;
const BLUE_SEAL_CHIPS = BLUE_SEAL_CHIPS_PER;

// 一次结算里，某位客人在某个挂载点上要演什么。
// 'copy: left' 把戏交给左邻——事件挂的是**左邻的 pid**，所以屏幕上脉冲的是那位，看得懂。
// index 是座位序号（P0-2 的拆解要写"第 2 位 · 共鸣 ×1.3"）
type Cue = { pid: string; effect: Effect; index?: number };

interface Row { seat: Seat; def: PatronDef }

function cuesFor(row: Row, hook: PatronDef['hook'], roster: Row[], pc: PatronCtx, depth = 0): Cue[] {
  if (depth > 2) return [];
  const { seat, def } = row;
  if (def.copy === 'left') {
    const i = roster.indexOf(row);
    const left = i > 0 ? roster[i - 1] : null;
    if (!left || left.def.copy) return [];
    return cuesFor(left, hook, roster, pc, depth + 1);
  }
  if (def.hook !== hook || !def.apply) return [];
  const e = def.apply(pc);
  if (!e) return [];
  const list = Array.isArray(e) ? e : [e];
  return list.filter(Boolean).map((one) => ({ pid: seat.pid, effect: one }));
}

export function score(input: ScoreInput): ScoreResult {
  const { played, result, held, env, boss, rand } = input;
  const roster: Row[] = input.seats.map((s) => ({ seat: s, def: patronById(s.pid) }));
  const kind = result.kind;
  const level = Math.max(1, input.level);

  let chips = 0;
  let mult = 1;
  let money = 0;
  const events: ScoreEvent[] = [];
  const shattered: number[] = [];

  // P0-3 阈值：盯的是"这条链做到哪儿了"，所以判定时机挂在每条事件落地之后。
  // 这样达标那一行落在它该落的那一拍上（演出节奏对），而不是整手打完统一补一笔。
  const before = input.scoreBefore ?? 0;
  const ths = input.thresholds ?? [];
  const line = input.targetLine ?? 0;
  const claimed = [...(input.claimed ?? [])];
  const fired: string[] = [];

  const snap = (): Snap => ({ chips, mult, value: chips * mult });

  const settleThresholds = (fromHand: number, fromStage: number): void => {
    let ph = fromHand;
    let ps = fromStage;
    // 一发 bonus 自己也可能把下一条阈值顶过去，所以要能连着判几轮。
    // 给个上界：阈值表最多十条，八轮之后再没新东西就是表本身写错了。
    for (let guard = 0; guard < 8; guard++) {
      const nh = chips * mult;
      const ns = before + nh;
      const hit = crossedThresholds(ths, claimed, { hand: nh, stage: ns }, { hand: ph, stage: ps }, line);
      if (!hit.length) return;
      // 上界从这里生效（见 thresholds.ts 的 MAX_PER_HAND 注释）。
      // 取 at 最小的几条：同一刻跨过多条时，先给低的那条，结果可复现可断言。
      hit.sort((a, b) => a.at - b.at);
      const handUsed = fired.filter((id) => ths.find((d) => d.id === id)?.span === 'hand').length;
      const stageUsed = claimed.filter((id) => ths.find((d) => d.id === id)?.span === 'stage').length;
      const take: ThresholdDef[] = [];
      let handRoom = Math.max(0, MAX_PER_HAND - handUsed);
      let stageRoom = Math.max(0, MAX_PER_STAGE - stageUsed);
      for (const d of hit) {
        if (d.span === 'hand') { if (handRoom > 0) { handRoom--; take.push(d); } }
        else if (stageRoom > 0) { stageRoom--; take.push(d); }
      }
      if (!take.length) return;
      for (const d of take) {
        chips += d.reward.chips ?? 0;
        mult += d.reward.mult ?? 0;
        if (d.reward.xmult && d.reward.xmult !== 1) mult *= d.reward.xmult;
        claimed.push(d.id);
        fired.push(d.id);
        events.push({
          t: 'bonus', source: d.name, tid: d.id,
          addChips: d.reward.chips ?? 0, addMult: d.reward.mult ?? 0, xmult: d.reward.xmult ?? 1,
          after: { chips, mult, value: chips * mult },
        });
      }
      ph = chips * mult;
      ps = before + ph;
    }
  };

  const push = (e: Omit<ScoreEvent, 'after'>): void => {
    const prevValue = events.length ? events[events.length - 1].after.value : 0;
    events.push({ ...(e as object), after: snap() } as ScoreEvent);
    if (ths.length) settleThresholds(prevValue, before + prevValue);
  };

  // 1) 牌型自身
  const base = handBase(kind, level);
  chips = base.chips;
  mult = base.mult;
  push({ t: 'hand', kind, level });

  // 1.5) 随机事件挂着的加项。走的是阈值同一格的 bonus 事件形（带 after 快照），
  // 所以渲染层一行都不用改就能把它演出来；没有事件时这个数组是空的，一笔都不多画。
  // 顺序钉在"牌型之后、逐张计分之前"：它是这手牌整体的修正，不属于任何一张。
  for (const ev of input.events ?? []) {
    const c0 = chips;
    const m0 = mult;
    const xm = ev.xmult && ev.xmult !== 1 ? ev.xmult : 1;
    chips += ev.chips ?? 0;
    mult += ev.mult ?? 0;
    if (xm !== 1) mult *= xm;
    // 减项有底：流水最低到 0、倍注最低到 1。
    // 不夹的话"本夜每手 −15 流水"这种事件能把一手牌做成负分，累计流水倒退，
    // fuzz 的"累计流水非法"当场就红（2026-10-12 实测）。夹在这里而不是夹在 s.score，
    // 是为了让 after 快照与演出来的账一致——界面不许看见一个数、内核记另一个数。
    if (chips < 0) chips = 0;
    if (mult < 1) mult = 1;
    // 行标签写**实际发生的那一笔**：被底夹掉的部分不该再报"−15"
    push({
      t: 'bonus', source: ev.name, tid: ev.tid,
      addChips: chips - c0, addMult: mult - m0, xmult: xm,
    });
  }

  // 贵客的刁难：被挡下的牌既不产生流水，也不惊动座上的客人
  const blockedWhy = (c: Card): string | null => {
    if (boss?.suitLock && c.suit === boss.suitLock) return boss.name;
    if (boss?.faceLock && c.rank >= 11 && c.rank <= 13) return boss.name;
    return null;
  };
  const live: Card[] = [];
  for (const c of result.scoring) {
    const why = blockedWhy(c);
    if (why) push({ t: 'blocked', id: c.id, why });
    else live.push(c);
  }

  const seatIndexOf = (pid: string): number =>
    roster.findIndex((r) => r.seat.pid === pid);

  const ctx = (card?: Card, index?: number, pid?: string): PatronCtx => ({
    result, played, held, card, index,
    handIndex: env.handIndex, rep: env.rep, raised: env.raised,
    discardsUsed: env.discardsUsed, money: env.money,
    suitLocked: boss?.suitLock ?? null,
    handsLeft: input.scene?.handsLeft,
    deckLeft: input.scene?.deckLeft,
    discardCount: input.scene?.discardCount,
    seatCount: roster.length,
    seatIndex: pid ? seatIndexOf(pid) : undefined,
    distinctKinds: input.scene?.distinctKinds,
    night: input.scene?.night,
    target: input.scene?.target,
    roll: input.roll,
  });

  const run = (hook: PatronDef['hook'], card?: Card, index?: number): Cue[] => {
    const out: Cue[] = [];
    // ctx 带上 pid：机制里想知道"我坐第几位"的（换座管家那类），靠这个才拿得到
    for (const row of roster) out.push(...cuesFor(row, hook, roster, ctx(card, index, row.seat.pid)));
    return out;
  };

  const applyCue = (cue: Cue, card: Card | null): void => {
    const { effect: e } = cue;
    chips += e.chips ?? 0;
    mult += e.mult ?? 0;
    if (e.xmult && e.xmult !== 1) mult *= e.xmult;
    if (e.money) money += e.money;
    push({
      t: 'patron', pid: cue.pid, note: e.note ?? '',
      addChips: e.chips ?? 0, addMult: e.mult ?? 0, xmult: e.xmult ?? 1,
      cardId: card ? card.id : (e.onCard ? e.onCard.id : null),
    });
  };

  // 2) 出牌时
  for (const cue of run('onPlayed')) applyCue(cue, null);

  // 蓝蜡封是"押账"：一组里蓝封越多，每张蓝封越值钱——所以它要先看全组再算
  const blueCount = live.filter((c) => c.seal === 'blue').length;

  // 3) 逐张计分：左到右，每张牌之后紧跟挂在这张牌上的客人
  live.forEach((c, i) => {
    // 关着时用原来写死的那几行；开着时一律从两张层表读数。
    // 表里的数值就是照原样抄的（重诵 ×2、加成 +30、倍注 +4、玻璃 ×2/25%、
    // 蓝封每张 +25×组内张数、金封每次 £1），所以**两条路算出来的分数一模一样**——
    // 换的只是"改数值要不要动代码"。有判据逐位钉这件事。
    const L = input.layers;
    const times = L ? layerRepeat(c) : 1 + (c.seal === 'red' ? 1 : 0);
    for (let pass = 0; pass < times; pass++) {
      let addChips = cardChips(c);
      let addMult = 0;
      let xmult = 1;
      if (L) {
        addChips += layerChips(c, blueCount);
        addMult += layerMult(c);
        xmult *= layerXmult(c);
      } else {
        if (c.enh === 'bonus') addChips += 30;
        if (c.enh === 'mult') addMult += 4;
        if (c.enh === 'glass') xmult *= 2;
        if (c.seal === 'blue') addChips += BLUE_SEAL_CHIPS * blueCount;
      }
      const rare = specialEffect(c, live, held, env.money, roster.length, env.handIndex, i);
      addChips += rare.chips; addMult += rare.mult; xmult *= rare.xmult;
      chips += addChips;
      mult += addMult;
      if (xmult !== 1) mult *= xmult;
      push({ t: 'card', id: c.id, addChips, addMult, xmult, ...(rare.note ? { note:rare.note } : {}) });
      if (L) money += layerMoney(c);
      else if (c.seal === 'gold') money += 1; 

      for (const cue of run('onCard', c, i)) applyCue(cue, c);
    }

    const brk = L ? layerBreaksOn(c) : (c.enh === 'glass' ? GLASS_BREAK : 0);
    if (brk > 0 && rand.chance(brk)) {
      shattered.push(c.id);
      push({ t: 'shatter', id: c.id });
    }
  });

  // 4) 入局即算——翻倍注的主力在这里收口，所以它乘的是已累积的倍注。
  //    客人版本也在这一档结算，紧跟在自家效果后面。
  //    P0-2 邻接共鸣同样在这一档、同样按座位左→右判定：因为这一档是乘法，
  //    换座就会改变复合顺序，总分随之变化。加法那一档怎么换都一样，
  //    所以"排序"这个决策只在乘法上成立——这一点必须有判据钉住。
  roster.forEach((row, i) => {
    for (const cue of cuesFor(row, 'independent', roster, ctx(undefined, undefined, row.seat.pid))) {
      applyCue({ ...cue, index: i }, null);
    }
    const ed = editionEffect(row.seat.edition);
    if (ed) applyCue({ pid: row.seat.pid, index: i, effect: ed }, null);
    // P1-2 长进：按座位上记的 XP 追加一档。紧跟自家效果与版本之后，位置可预期
    if (input.growth && row.def.growth) {
      const gb = growthBonus(row.seat.xp ?? 0, row.def.growth);
      if (gb) applyCue({ pid: row.seat.pid, index: i,
        effect: { ...gb, note: `${row.def.growth.note} 第 ${(row.seat.xp ?? 0) >= 6 ? 2 : 1} 档` } }, null);
    }
    const adj = row.def.adjacency;
    if (adj && input.adjacency) {
      const left = i > 0 ? roster[i - 1] : null;
      const mine = row.def.tags ?? [];
      const shared = left ? mine.filter((t) => (left.def.tags ?? []).includes(t)) : [];
      if (left && shared.length) {
        applyCue({ pid: row.seat.pid, index: i,
          effect: { ...adj, note: `${adj.note ?? '共鸣'} · 与${left.def.name}同${shared[0]}` } }, null);
      }
    }
  });

  push({ t: 'total' });

  const last = events[events.length - 1].after;
  return {
    events, value: last.value, chips: last.chips, mult: last.mult,
    shattered, money, claimedNow: fired,
  };
}
