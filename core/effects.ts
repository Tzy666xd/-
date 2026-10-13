// 效果系统的两张表：**6 个挂载点 × 6 个效果类别**。
// 座上宾不是一段段 if，而是这张矩阵里的格子——内容能量产、又能被自检穷举的前提就在这里。
import type { Card, HandResult, Suit } from './hands.ts';

export type Hook = 'independent' | 'onCard' | 'onHeld' | 'onDiscard' | 'onPlayed' | 'onRoundEnd';
export type EffectKind = 'chips' | 'mult' | 'xmult' | 'mixed' | 'economy' | 'rule';
export type Rarity = 'common' | 'uncommon' | 'rare' | 'legendary';

export const HOOKS: readonly Hook[] = [
  'independent', 'onCard', 'onHeld', 'onDiscard', 'onPlayed', 'onRoundEnd',
];
export const KINDS: readonly EffectKind[] = [
  'chips', 'mult', 'xmult', 'mixed', 'economy', 'rule',
];

export const HOOK_LABEL: Record<Hook, string> = {
  independent: '入局即算',
  onCard: '逐张计分',
  onHeld: '握于手中',
  onDiscard: '弃牌时',
  onPlayed: '出牌时',
  onRoundEnd: '局终结账',
};
export const KIND_LABEL: Record<EffectKind, string> = {
  chips: '添流水',
  mult: '加注',
  xmult: '翻倍注',
  mixed: '兼而有之',
  economy: '银钱',
  rule: '改规矩',
};
export const RARITY_LABEL: Record<Rarity, string> = {
  common: '常客',
  uncommon: '稀客',
  rare: '贵客',
  legendary: '传说',
};

// 客人版本：同一位客人可能有更讲究的copies，于是"重掷铺子"这件事本身有了意义
export type Edition = 'none' | 'foil' | 'holo' | 'polychrome' | 'negative';
import type { GrowthDef } from './growth.ts';
export const EDITION_NAME: Record<Edition, string> = {
  none: '', foil: '箔面', holo: '全相', polychrome: '三彩', negative: '负片',
};
export const EDITION_BLURB: Record<Edition, string> = {
  none: '',
  foil: '+50 流水',
  holo: '+10 倍注',
  polychrome: '×1.5 倍注',
  negative: '不占座位',
};
export const EDITION_PREMIUM: Record<Edition, number> = {
  none: 0, foil: 1, holo: 2, polychrome: 3, negative: 4,
};
export const EDITION_WEIGHT: Record<Edition, number> = {
  none: 82, foil: 8, holo: 6, polychrome: 3, negative: 1,
};

// 座位是实例，不是 id：版本与长进都挂在实例上。
// xp 是可选的——老存档里没有这个字段，读出来就是 undefined，按 0 处理。
export interface Seat {
  pid: string;
  edition: Edition;
  xp?: number;
}

// 改规矩的东西：座位、手牌、出牌/弃牌次数、随身槽、利息上限、彩头缩放、免费重掷、折扣
export interface Mods {
  seats?: number;
  handSize?: number;
  hands?: number;
  discards?: number;
  slots?: number;
  interestCap?: number;
  targetScale?: number;
  freeRerolls?: number;
  priceScale?: number;
}

// 版本在"入局即算"阶段收口，效果就是这一条
export function editionEffect(e: Edition): Effect | null {
  if (e === 'foil') return { chips: 50, note: '箔面' };
  if (e === 'holo') return { mult: 10, note: '全相' };
  if (e === 'polychrome') return { xmult: 1.5, note: '三彩' };
  return null;   // 负片只改座位，不产生计分事件
}

export interface Effect {
  chips?: number;
  mult?: number;
  xmult?: number;
  money?: number;
  // 显示用的注记，例如 "♥" / "K" / "第 3 张"
  note?: string;
  onCard?: Card;
}

//  temperament：这位是**靠你打得对**还是**靠运气**吃饭。
//  开局五选一的选单要能一眼看出脾气，不然玩家是在比数值而不是比打法。
//  head＝脑子（条件由你的选择决定）、hand＝稳（无条件的干货）、heart＝胆（吃概率）。
export type Temperament = 'head' | 'hand' | 'heart';

export const TEMPERAMENT_LABEL: Record<Temperament, string> = {
  head: '靠脑子', hand: '稳吃', heart: '吃运气',
};

export interface PatronCtx {
  result: HandResult;
  played: Card[];
  held: Card[];
  card?: Card;
  index?: number;         // onCard：当前是第几张计分牌
  handIndex?: number;     // 本夜已出的第几手
  suitLocked?: Suit | null;
  rep: number;
  raised: number;
  discardsUsed: number;
  money: number;
  // ── 下面是只读的局面读数：给"独特机制"用，不引入新的计分维度 ──
  /** 本夜还能出几次牌（含这一手） */
  handsLeft?: number;
  /** 牌堆里还剩几张可抽 */
  deckLeft?: number;
  /** 弃牌堆张数 */
  discardCount?: number;
  /** 在座几位客人（含自己） */
  seatCount?: number;
  /** 座位序号，最左为 0；不知道就省略 */
  seatIndex?: number;
  /** 本夜用过的不同牌型种数 */
  distinctKinds?: number;
  /** 第几夜 */
  night?: number;
  /** 本场彩头 */
  target?: number;
  /**
   * 吃概率的效果用这个摇，**不要自己造随机数**。
   * 它走内核那一条种子流，所以同一 seed 同一 calls 摇出的结果一定一样，
   * 存档快进也照样复现。关掉功能时没人调用它，随机流一步都不多吃。
   */
  roll?: (p: number) => boolean;
}

export interface PatronDef {
  id: string;
  name: string;
  role: string;           // 一行身份，画在肖像框下面
  monogram: string;       // 肖像框里的刻字
  rarity: Rarity;
  cost: number;
  kind: EffectKind;
  hook: Hook;
  /** 脾气：开局选一位时要按这个分类摆 */
  temperament: Temperament;
  blurb: string;
  repGate?: number;       // 声望门槛
  copy?: 'left';          // 复制左邻：由结算引擎特殊处理，自己不产生事件
  apply?: (ctx: PatronCtx) => Effect | Effect[] | null;
  mods?: (ctx: PatronCtx) => Mods;
  /** P1-1 构筑轴：与"效果类别"正交。kind 说的是给什么，tags 说的是属于哪路人 */
  tags?: string[];
  /**
   * P0-2 邻接共鸣：左邻与自己共享任一 tag 时，额外来这一发。
   * 在"入局即算"那一档按座位左→右判定，所以**换座位会改变翻倍注的复合顺序**，
   * 总分随之变化——这才是"排序"这个决策存在的理由（加法可交换，只有乘序才看得见差别）。
   */
  adjacency?: Effect;
  /** P1-2 长进：按触发次数升档，有上限。定义在"人"上，进度记在座位上 */
  growth?: GrowthDef;
}
