// P0-1 加注（风险押注）。原来这条轴是**硬编码**的：彩头 ×1.5^档、赏金 ×(1+0.5·档)、
// 失手就只有"输掉整局"一种下场。这里把它变成数据表，并补上需求要的三档失败惩罚。
//
// 决策点：抬到第几档。档越高彩头越硬，但赏金/盈余折现/来客档次同步加厚，
// 而且高档位**买得起一次续命**（失手不再是当场出局，而是付出代价再来一次）。
//
// 关键纪律：flag 关掉时 targetFor/reward 必须和改之前**逐位一致**，
// 老种子、老录像、老存档的分数不能变。所以这里的 targetMult 就是 1.5^tier，
// rewardBase 就是 1+0.5·tier，表只是把同一个式子写出来，不是换一套数。
export type FailPenalty = 'none' | 'loseMoney' | 'losePatron' | 'loseRound';

export interface BetDef {
  tier: number;
  name: string;
  blurb: string;
  /** 彩头倍率 */
  targetMult: number;
  /** 赏金倍率（乘在 STAGE_REWARD 上） */
  rewardMult: number;
  /** 盈余折现的加成分（沿用原来 +tier 的量级） */
  surplusBonus: number;
  /** 声望加成（沿用原来 +tier 的量级） */
  repBonus: number;
  /** 失手的下场 */
  failPenalty: FailPenalty;
  /** loseMoney 时扣掉现有银钱的比例 */
  moneyLoss: number;
  /** 界面要不要提前写明失手会怎样 */
  visibleHint: boolean;
}

// 0 档就是"不抬"：完全保持现状（×1 彩头、×1 赏金、失手就是输）
export const BETS: BetDef[] = [
  { tier: 0, name: '不抬', blurb: '稳过这一场，失手就是散局',
    targetMult: 1, rewardMult: 1, surplusBonus: 0, repBonus: 0,
    failPenalty: 'none', moneyLoss: 0, visibleHint: true },
  { tier: 1, name: '抬一手', blurb: '彩头 ×1.5，赏金 ×1.5；失手赔一笔银钱，本场还能再打',
    targetMult: 1.5, rewardMult: 1.5, surplusBonus: 1, repBonus: 1,
    failPenalty: 'loseMoney', moneyLoss: 0.25, visibleHint: true },
  { tier: 2, name: '抬两手', blurb: '彩头 ×2.25，赏金 ×2；失手请走一位客人',
    targetMult: 2.25, rewardMult: 2, surplusBonus: 2, repBonus: 2,
    failPenalty: 'losePatron', moneyLoss: 0, visibleHint: true },
  { tier: 3, name: '押重注', blurb: '彩头 ×3.38，赏金 ×2.5；失手本场作废、银钱折半',
    targetMult: 3.375, rewardMult: 2.5, surplusBonus: 3, repBonus: 3,
    failPenalty: 'loseRound', moneyLoss: 0.5, visibleHint: false },
  { tier: 4, name: '孤注一掷', blurb: '彩头 ×5.06，赏金 ×3；失手当场散局',
    targetMult: 5.0625, rewardMult: 3, surplusBonus: 4, repBonus: 4,
    failPenalty: 'loseRunAsIs', moneyLoss: 0, visibleHint: false },
];

/** 'loseRunAsIs' 是给 4 档留的"照原样判负"，不入 FailPenalty 主类型以免混淆 */
export type BetOutcomeKind = FailPenalty | 'loseRunAsIs' | 'reprieved';

export const betFor = (tier: number, maxTier = BETS.length - 1): BetDef => {
  const t = Math.max(0, Math.min(maxTier, Math.trunc(tier)));
  return BETS[t];
};

/**
 * 失手裁决。纯函数，不碰状态，所以每条都能单独断言。
 * 续命每场只给一次（reprievesUsed>=1 就直接判负），免得变成无限赖场。
 */
export function resolveBetMiss(
  bet: BetDef,
  ctx: { money: number; seats: number; reprievesUsed: number; handsLeft: number },
): { kind: BetOutcomeKind; moneyDelta: number; seatsDelta: number; resetScore: boolean; note: string } {
  if (ctx.reprievesUsed >= 1 || bet.failPenalty === 'none' || bet.failPenalty === 'loseRunAsIs') {
    return { kind: bet.failPenalty === 'none' ? 'none' : 'loseRunAsIs',
      moneyDelta: 0, seatsDelta: 0, resetScore: false, note: '' };
  }
  if (bet.failPenalty === 'loseMoney') {
    const loss = Math.floor(ctx.money * bet.moneyLoss);
    return { kind: 'loseMoney', moneyDelta: -loss, seatsDelta: 0, resetScore: true,
      note: `失手赔 £${loss}，本场重做` };
  }
  if (bet.failPenalty === 'losePatron') {
    if (ctx.seats <= 0) {
      const loss = Math.floor(ctx.money * 0.2);
      return { kind: 'loseMoney', moneyDelta: -loss, seatsDelta: 0, resetScore: true,
        note: `座上无人可请，改赔 £${loss}` };
    }
    return { kind: 'losePatron', moneyDelta: 0, seatsDelta: -1, resetScore: true,
      note: '失手请走一位客人，本场重做' };
  }
  // loseRound：本场作废——分数清零、银钱折半，还剩出牌次数就接着打这一场
  const loss = Math.floor(ctx.money * bet.moneyLoss);
  return { kind: 'loseRound', moneyDelta: -loss, seatsDelta: 0, resetScore: true,
    note: `本场作废，折掉 £${loss}` };
}

/** 界面/账本用的一行说明 */
export function betLine(bet: BetDef): string {
  if (bet.tier === 0) return '不抬注';
  const hint = bet.visibleHint ? `｜失手：${penaltyName(bet.failPenalty)}` : '｜失手后果不明';
  return `第 ${bet.tier} 档 彩头 ×${bet.targetMult} 赏金 ×${bet.rewardMult}${hint}`;
}
export const penaltyName = (p: FailPenalty): string =>
  p === 'none' ? '散局' : p === 'loseMoney' ? '赔银钱' : p === 'losePatron' ? '请走一位客人'
    : p === 'loseRound' ? '本场作废' : '散局';
