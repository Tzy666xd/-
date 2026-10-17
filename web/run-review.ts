// 散场复盘只汇总已发生的局面，不估算另一种打法能否获胜。
import type { GameState } from '../core/game.ts';
import { targetOf, limits } from '../core/game.ts';
import { BOSSES, patronById, letterById } from '../core/content.ts';
import { HANDS } from '../core/hands.ts';
import type { HandKind } from '../core/hands.ts';

export function runReview(s: GameState, won: boolean): {
  best: number; target: number; score: number; gap: number; tips: string[]; resources: string; context: string;
} {
  const last = s.ledger.at(-1);
  const target = won && last ? last.target : targetOf(s);
  const score = won && last ? last.best : s.score;
  const gap = Math.max(0, target - score);
  const best = Math.max(s.score, s.runStats.bestStage ?? 0, 0, ...s.ledger.map((r) => r.best));
  const tips: string[] = [];
  if (!won) {
    if (s.discardsLeft > 0) tips.push(`散场时还剩 ${s.discardsLeft} 次弃牌。下一局在出牌用尽前，用弃牌寻找主攻牌型。`);
    if (s.consumables.length) tips.push(`还留着 ${s.consumables.length} 件随身物品。下一局先看它们能否补强当前牌型，再打最后一手。`);
    if (s.seats.length < limits(s).seats) tips.push('座位还没坐满。进铺子时优先找能配合常用牌型的客人，持续补强计分。');
    if (s.raisedHere > 0) tips.push(`本场抬注 ${s.raisedHere} 档。下一局先对照账本里的场次流水，再决定是否抬注。`);
    if (!tips.length) tips.push('打开牌型图鉴与账本，检查主攻牌型的等级、客人触发条件和上一手的计分过程。');
  } else tips.push('继续经营会进入更高彩头的无尽牌局；也可以换一副起手牌组，尝试另一条构筑路线。');
  const uses = Object.entries(s.handUse).sort((a, b) => b[1] - a[1]);
  const usual = uses[0] ? `${HANDS[uses[0][0] as HandKind]?.name ?? uses[0][0]} ${uses[0][1]} 手` : '尚未出牌';
  const boss = BOSSES.find((b) => b.id === s.bossId);
  const guests = s.seats.map((seat) => patronById(seat.pid).name).join('、') || '无';
  const items = s.consumables.map((c) => c.t === 'letter' ? letterById(c.id).name : HANDS[c.id].book).join('、') || '无';
  return {
    best, target, score, gap, tips,
    resources: `本场已出 ${s.handIndex} 手 · 已弃 ${s.discardsUsed} 次 · 剩余弃牌 ${s.discardsLeft} 次 · 随身物品 ${s.consumables.length} 件（${items}）`,
    context: `本场常用牌型：${usual}。座上宾：${guests}。${boss ? `贵客规矩：${boss.name} · ${boss.blurb}` : ''}`,
  };
}
