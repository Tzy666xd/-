// P0-3 回合阈值奖励。**不是第六个计分维度**：奖励仍然是一条 Effect（流水/倍注/翻倍注），
// 挂在计分管道里"级联进行中"的那个时刻上，所以它天然就是 筹码×倍率 链上的一个节点，
// 也天然能在拆解里占一行（硬约束 1、2）。
//
// 决策点（硬约束 3 的答案）：阈值盯的是**这一手做到多少分**，不是本场累计。
// 于是玩家要决定"这手就冲线把奖励拿了，还是留强牌给后面几手"。
// 保留资源的价值来自 carryOver=false 时进度每手清零——错过就没了。
import type { Effect } from './effects.ts';

export type ThresholdSpan = 'hand' | 'stage';

export interface ThresholdDef {
  id: string;
  name: string;
  blurb: string;              // 一行说明，直接进拆解与 UI
  /**
   * 达标线，**整数百分比**：相对本场彩头（targetOf）。at=60 表示"做到彩头的 60%"。
   * 为什么不用绝对分数：彩头从第 1 夜的 300 一路涨到第 8 夜的上万，
   * 写死 180 这种数到了后期就是白送——实测同花 6 级一手从 2114 涨到 4878（+131%），
   * 而且每一手都拿得到，"冲哪条线"这个决策当场消失。
   * 用百分比则整局都在同一难度上，仍然是一个整数（需求文档要 threshold: int）。
   */
  at: number;
  /** hand＝每手各判一次；stage＝整场只判一次（盯本场累计） */
  span: ThresholdSpan;
  reward: Effect;
  /** 关掉就不在界面提示"还差多少"（留给"未知阈值"那类内容用） */
  progressVisible: boolean;
  /** true＝进度跨场保留；false＝换场清零 */
  carryOver: boolean;
}

/** 把百分比换算成绝对分。line 是本场的折算基准（hand 用彩头，stage 也用彩头） */
export const thresholdValue = (d: ThresholdDef, line: number): number =>
  Math.round(line * d.at / 100);

// 10 条可直接跑的配置。`at` 是**本场彩头的整数百分比**，所以同一套表在第 1 夜和
// 第 8 夜给出同等难度的线：低档要一手还行的牌才够到，高档要一手漂亮牌才够到。
export const THRESHOLDS: ThresholdDef[] = [
  { id: 't-tips',    name: '打赏罐',   blurb: '这一手做到彩头 40%，侍者多给一层',
    at: 40,  span: 'hand',  reward: { chips: 30 }, progressVisible: true, carryOver: false },
  { id: 't-brasa',   name: '银盘一响', blurb: '这一手做到彩头 65%，倍注加 4',
    at: 65,  span: 'hand',  reward: { mult: 4 }, progressVisible: true, carryOver: false },
  { id: 't-cellar',  name: '开一坛',   blurb: '这一手做到彩头 90%，倍注 ×1.25',
    at: 90,  span: 'hand',  reward: { xmult: 1.25, note: '开坛' }, progressVisible: true, carryOver: false },
  { id: 't-hearth',  name: '炉火正旺', blurb: '这一手做到彩头 140%，流水 +120',
    at: 140, span: 'hand',  reward: { chips: 120 }, progressVisible: true, carryOver: false },
  { id: 't-clock',   name: '打点',     blurb: '这一手做到彩头 200%，倍注 +10',
    at: 200, span: 'hand',  reward: { mult: 10 }, progressVisible: true, carryOver: false },
  { id: 't-ledger',  name: '记账',     blurb: '本场累计做到彩头 120%，流水 +90',
    at: 120, span: 'stage', reward: { chips: 90 }, progressVisible: true, carryOver: true },
  { id: 't-stand',   name: '撑住场子', blurb: '本场累计做到彩头 250%，倍注 +8',
    at: 250, span: 'stage', reward: { mult: 8 }, progressVisible: true, carryOver: true },
  { id: 't-blind',   name: '暗彩',     blurb: '这一手做到彩头 110%，倍注 ×1.5（界面不提示还差多少）',
    at: 110, span: 'hand',  reward: { xmult: 1.5, note: '暗彩' }, progressVisible: false, carryOver: false },
  { id: 't-quiet',   name: '静账',     blurb: '本场累计做到彩头 400%，流水 +400',
    at: 400, span: 'stage', reward: { chips: 400 }, progressVisible: true, carryOver: false },
  { id: 't-grand',   name: '满堂',     blurb: '这一手做到彩头 320%，倍注 ×2',
    at: 320, span: 'hand',  reward: { xmult: 2, note: '满堂' }, progressVisible: true, carryOver: true },
];

export const thresholdById = (id: string): ThresholdDef | null =>
  THRESHOLDS.find((x) => x.id === id) ?? null;

/**
 * 一手牌最多能认领几条阈值。**必须有上界**：
 * 一条 bonus 会把链推高，于是它自己又跨过下一条阈值，形成级联。实测
 * 同花 6 级一手连吃 7 条，1540 分滚到 17062 分（×11），难度直接没了，
 * 而且"我该冲哪条线"这个决策也消失了——反正全都拿到。
 * 收紧到 2 是为了让取舍重新变锋利：一手只够到一两条，必须挑。
 */
export const MAX_PER_HAND = 2;
export const MAX_PER_STAGE = 1;

/**
 * 从待认领的阈值里挑出"这条链刚跨过"的那些。
 * 纯函数：不看也不改任何状态，跨没跨过由调用方传的 now/prev 与折算基准 line 决定，
 * 所以每条都能被逐条断言。span='hand' 走 prevHand/nowHand，span='stage' 走 prevStage/nowStage。
 */
export function crossedThresholds(
  defs: ThresholdDef[],
  claimed: string[],
  now: { hand: number; stage: number },
  prev: { hand: number; stage: number },
  line: number,
): ThresholdDef[] {
  return defs.filter((d) => {
    if (claimed.includes(d.id)) return false;
    const at = thresholdValue(d, line);
    return d.span === 'hand'
      ? prev.hand < at && now.hand >= at
      : prev.stage < at && now.stage >= at;
  });
}

/** 界面上那句"还差多少"。取最近一个未达标且可见的 hand 阈值；没有就给 null */
export function nextGap(
  defs: ThresholdDef[],
  claimed: string[],
  handValue: number,
  line: number,
): { def: ThresholdDef; gap: number } | null {
  let best: { def: ThresholdDef; gap: number } | null = null;
  for (const d of defs) {
    if (d.span !== 'hand' || !d.progressVisible || claimed.includes(d.id)) continue;
    const gap = thresholdValue(d, line) - handValue;
    if (gap <= 0) continue;
    if (!best || gap < best.gap) best = { def: d, gap };
  }
  return best;
}
