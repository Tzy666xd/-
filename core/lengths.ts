// 局长：一局打几夜。八夜是**参照档**（曲线一切照旧），三夜到十五夜各有各的终场彩头。
//
// 为什么是"整条曲线乘一个系数"而不是"每档重写一条曲线"：
//   曲线的**形状**是这个游戏的手感（前段陡、后段缓，贵客局翻倍），长度只是把终点挪个位置。
//   重写形状会让八夜之外每一档都变成另一个游戏，平衡也没法比对。
//   所以这里只钉两件事：这一档最后一夜的贵客局要做到多少分（设计值），
//   以及换算出来的那个系数。八夜那一格必须正好等于参照值 ⇒ 系数 1 ⇒ 逐位不变（有判据）。
//
// 终场彩头是**设计值**，不是公式的副产品：三夜到十五夜每一档都按约 1.65 倍递增，
// 短局不是"随便玩玩"，长局也不是"堆时间"，各有一档该难到哪里去。
export const MIN_NIGHTS = 3;
export const MAX_NIGHTS = 15;
export const DEFAULT_NIGHTS = 8;

/** 八夜参照曲线（原来写死在 game.ts，搬过来只为让"局长"和"曲线"住在一起） */
export const BASE_TARGET = [300, 800, 2000, 5000, 11000, 20000, 35000, 50000];
/** 第八夜之后原来那串 ×2.2 的溢出增长，保留是为了让无尽与深推进照旧 */
export const OVERFLOW_GROWTH = 2.2;
/** 贵客局的场倍率。与 game.ts 的 STAGE_SCALE.boss 是同一个数——两处各自写死会漂，
 *  所以自检有一条专门盯着它们相等 */
export const BOSS_STAGE_SCALE = 2;

/** 第 n 夜「便宴」那一场的参照彩头（八夜之后按溢出增长往上推） */
export function referenceTarget(n: number): number {
  return n <= BASE_TARGET.length
    ? BASE_TARGET[n - 1]
    : Math.round(BASE_TARGET[BASE_TARGET.length - 1] * Math.pow(OVERFLOW_GROWTH, n - BASE_TARGET.length));
}

/** 五档的稳定 id：牌组按它绑定，所以不能用中文档名当键（改文案会悄悄断链） */
export type TierId = 'short' | 'mid' | 'core' | 'long' | 'deep';
export const TIER_IDS: TierId[] = ['short', 'mid', 'core', 'long', 'deep'];
export const TIER_LABEL: Record<TierId, string> = {
  short: '短局', mid: '中局', core: '正局', long: '长局', deep: '深夜局',
};

export interface LengthDef {
  nights: number;
  /** 档位 id（专属牌组绑这一格） */
  tierId: TierId;
  /** 档位名：短局 / 中局 / 正局 / 长局 / 深夜局 */
  tier: string;
  /** 一句"这一档在赌什么"，标题页选中时读给玩家 */
  blurb: string;
  /** 终场彩头：最后一夜贵客局要做到的分 */
  finalTarget: number;
}

export const LENGTHS: LengthDef[] = [
  { nights: 3, tierId: 'short', tier: '短局', blurb: '三夜定输赢：开局就得成型，长进型客人来不及长大', finalTarget: 8_000 },
  { nights: 4, tierId: 'short', tier: '短局', blurb: '四夜：只有一次铺子的余裕，讲究一手到位', finalTarget: 13_000 },
  { nights: 5, tierId: 'mid', tier: '中局', blurb: '五夜：构筑刚开始咬合就该收尾了', finalTarget: 22_000 },
  { nights: 6, tierId: 'mid', tier: '中局', blurb: '六夜：够凑半套班底，贵客还来不及堆叠', finalTarget: 36_000 },
  { nights: 7, tierId: 'mid', tier: '中局', blurb: '七夜：差一夜的八夜，曲线收紧一点', finalTarget: 60_000 },
  { nights: 8, tierId: 'core', tier: '正局', blurb: '八夜正局：这一版曲线就是照它定的', finalTarget: 100_000 },
  { nights: 9, tierId: 'long', tier: '长局', blurb: '九夜：翻倍注与长进型客人开始兑现', finalTarget: 165_000 },
  { nights: 10, tierId: 'long', tier: '长局', blurb: '十夜：贵客一场接一场，牌堆要经得起反复拆', finalTarget: 270_000 },
  { nights: 11, tierId: 'long', tier: '长局', blurb: '十一夜：没有一套咬合的班底撑不到后半夜', finalTarget: 450_000 },
  { nights: 12, tierId: 'deep', tier: '深夜局', blurb: '十二夜：上限、回收、利息这些不起眼的东西开始值钱', finalTarget: 740_000 },
  { nights: 13, tierId: 'deep', tier: '深夜局', blurb: '十三夜：每一夜都是三场硬仗，容错比爆发重要', finalTarget: 1_220_000 },
  { nights: 14, tierId: 'deep', tier: '深夜局', blurb: '十四夜：牌堆会被拆开重洗十几遍', finalTarget: 2_020_000 },
  { nights: 15, tierId: 'deep', tier: '深夜局', blurb: '十五夜马拉松：赌的是这套班底能不能长到最后', finalTarget: 3_330_000 },
];

export const lengthOf = (nights: number): LengthDef =>
  LENGTHS.find((l) => l.nights === nights) ?? LENGTHS[DEFAULT_NIGHTS - MIN_NIGHTS];

/** 这一档属于哪一档（专属牌组、以后的档位奖章都读它） */
export const tierOf = (nights: number): TierId => lengthOf(nights).tierId;

/** 只认 3..15 的整数，其余一律落回八夜：存档与偏好都是外部输入 */
export function clampNights(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= MIN_NIGHTS && v <= MAX_NIGHTS
    ? v : DEFAULT_NIGHTS;
}

/**
 * 这一档的"终点系数"：把参照曲线的终点挪到设计终场彩头上。
 * nights=8 时分子分母同为 100000 ⇒ 正好 1。
 */
export function lengthScale(nights: number): number {
  const l = lengthOf(nights);
  return l.finalTarget / (referenceTarget(l.nights) * BOSS_STAGE_SCALE);
}

/**
 * 第 night 夜在这一档长度下该乘的系数：**第一夜永远是 1，最后一夜刚好是终点系数，
 * 中间线性过渡**。
 *
 * 为什么不是"整条曲线乘一个数"（试过，数字很丑）：八夜参照曲线本身已经是很陡的几何增长，
 * 直接整体缩放会把两端都拧坏——十五夜的第一夜只剩 40 分（白送一夜），
 * 三夜的第一夜却要 600 分（短局反而更狠，与"短局是场遭遇战"相反）。
 * 让大家都从同一个 300 起步、越往后越弯向各自的设计终点，
 * 才是"长度不同、目标不同"而不是"长度不同、开局也不同"。
 *
 * night 要夹在 [1, nights] 内：无尽局会一路打到最后一夜之后，而长档的终点系数是**小于 1**
 * 的（十五夜要把 1249 万的参照终点压到 333 万）。不夹的话线性外推会一路走成负数，
 * 第 20 夜的彩头变成负的——不但不难，反而"打输"了。过了终点就固定按终点系数弯，
 * 后面交给溢出增长（×2.2/夜）继续抬。
 *
 * nights 由 clampNights 保证在 3..15，所以这里不再防"只有一夜"那种除零的输入。
 */
export function nightScale(nights: number, night: number): number {
  const end = lengthScale(nights);
  const n = Math.min(Math.max(night, 1), nights);
  return 1 + (end - 1) * (n - 1) / (nights - 1);
}
