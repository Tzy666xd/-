// P1-2 成长型客人。**必须有上限**：需求文档点명"后期不会无脑强"，所以这里
// 同时锁三层——每档要多少 XP、最多升到第几级、以及每级加成的绝对值。
//
// 记账落在**座位实例**上（Seat.xp），不是客人定义上：同一位客人在 A 局升到顶，
// 不该让 B 局也捡到满级客人。这也和版本（edition）一样是实例属性。
//
// 结算侧只**读**等级、不写 XP；XP 由 play() 在结算之后统一累加。
// 这样 score() 保持无副作用，同一个输入重放两次结果一模一样（承重墙 1 的前提）。
import type { Effect } from './effects.ts';

export interface GrowthLevel {
  /** 累计到多少 XP 升到这一档 */
  requireXp: number;
  /** 这一档给什么。与自家效果同构，仍然只动 chips/mult/xmult */
  effectDelta: Effect;
}

export interface GrowthDef {
  xpPerUse: number;        // 每次触发给多少 XP
  levels: GrowthLevel[];   // 按 requireXp 升序；最后一档就是上限
  note: string;            // 拆解里那一行的主语
}

/** 当前 XP 落在第几档（0 = 还没长进）。纯函数，可逐条断言。 */
export function growthLevel(xp: number, g: GrowthDef): number {
  let lv = 0;
  for (let i = 0; i < g.levels.length; i++) if (xp >= g.levels[i].requireXp) lv = i + 1;
  return lv;
}

/** 这一档的加成品。没升级就是 null，结算里一条事件都不产生。 */
export function growthBonus(xp: number, g: GrowthDef): Effect | null {
  const lv = growthLevel(xp, g);
  return lv === 0 ? null : g.levels[lv - 1].effectDelta;
}

/** 升到顶之后 XP 就不该再涨——留着它只会让存档变大、判据变复杂。 */
export function grow(xp: number, g: GrowthDef): number {
  const cap = g.levels[g.levels.length - 1].requireXp;
  return Math.min(cap, xp + g.xpPerUse);
}

export const atCap = (xp: number, g: GrowthDef): boolean =>
  xp >= g.levels[g.levels.length - 1].requireXp;

/** 界面上的一行："这位已经长到第 2 档，还差 3 次到顶" */
export function growthLabel(xp: number, g: GrowthDef): string {
  const lv = growthLevel(xp, g);
  if (lv === 0) return `尚无长进（每次触发 +${g.xpPerUse}）`;
  if (atCap(xp, g)) return `已长到顶 · 第 ${lv} 档`;
  const next = g.levels[lv].requireXp - xp;
  const times = Math.max(1, Math.ceil(next / g.xpPerUse));
  return `第 ${lv} 档 · 还差 ${times} 次`;
}
