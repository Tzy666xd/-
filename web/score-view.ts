import type { ScoreResult, ScoreEvent } from '../core/scoring.ts';
import { HANDS } from '../core/hands.ts';
import { patronById } from '../core/content.ts';

/** 玩家账本与验证接口读同一份事件流；这里只格式化 after，不重新计算分数。 */
export function scoreText(res: ScoreResult | null, cardName: (id: number) => string): string {
  if (!res) return '还没有可回看的计分记录。下一次出牌后，会在这里列出每一笔计分。';
  const num = (n: number): string => Math.round(n).toLocaleString('en-US');
  const rows: string[] = [];
  for (const e of res.events as ScoreEvent[]) {
    const a = e.after;
    const tail = `流水 ${num(a.chips)} × 倍注 ${a.mult} = ${num(a.value)}`;
    switch (e.t) {
      case 'hand': rows.push(`${HANDS[e.kind].name}（${e.level} 级）起手 → ${tail}`); break;
      case 'blocked': rows.push(`${cardName(e.id)} 被${e.why}挡下 → ${tail}`); break;
      case 'card': rows.push(`${cardName(e.id)}：+${e.addChips} 流水${e.addMult ? ` +${e.addMult} 倍注` : ''}${e.xmult !== 1 ? ` ×${e.xmult}` : ''} → ${tail}`); break;
      case 'patron': rows.push(`${patronById(e.pid).name}${e.note ? `「${e.note}」` : ''}：+${e.addChips} 流水 +${e.addMult} 倍注 ×${e.xmult} → ${tail}`); break;
      case 'bonus': rows.push(`★ 阈值「${e.source}」：+${e.addChips} 流水 +${e.addMult} 倍注 ×${e.xmult} → ${tail}`); break;
      case 'shatter': rows.push(`${cardName(e.id)} 碎了 → ${tail}`); break;
      case 'total': rows.push(`收口 → ${tail}`); break;
    }
  }
  rows.push(`本手入账 ${num(res.value)}，银钱 ${res.money >= 0 ? '+' : ''}${res.money}`);
  return rows.join('\n');
}
