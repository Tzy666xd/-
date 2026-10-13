// 贪心模拟器：不靠人试玩也能先知道"这局到底通不通"。
// 策略很笨：每次枚举手里所有 ≤5 张的组合，挑结算值最大的打；不够就弃最大的那组。
// 目的是给平衡一个下界——笨策略能走多远，真人只会更远。
import { Game, play, discard, buy, targetOf, limits, seatedCount, chosenCards, autoResolveEvent } from './game.ts';
import { FLAGS_OFF } from './flags.ts';
import { clampNights, lengthOf } from './lengths.ts';
import { evaluate } from './hands.ts';
import type { Card } from './hands.ts';
import { score } from './scoring.ts';

import { Rand } from './rng.ts';

function combos<T>(arr: T[], k: number): T[][] {
  const out: T[][] = [];
  const pick = (start: number, cur: T[]): void => {
    if (cur.length === k) { out.push([...cur]); return; }
    for (let i = start; i < arr.length; i++) { cur.push(arr[i]); pick(i + 1, cur); cur.pop(); }
  };
  pick(0, []);
  return out;
}

/** 用同一套规则算一遍候选组合的值，不改动状态。
 *  估值必须带上已入席的客人，否则机器人永远低估自己、不敢出牌。 */
function valueOf(g: Game, cards: Card[]): number {
  const result = evaluate(cards);
  const res = score({
    played: cards, result, level: g.state.books[result.kind] ?? 1,
    held: [], seats: g.state.seats, boss: null, rand: new Rand(1),
    env: { handIndex: 0, rep: 0, raised: 0, discardsUsed: 0, money: 0 },
  });
  return res.value;
}

function bestHand(g: Game): number[] {
  const hand = g.state.hand;
  let best: number[] = [];
  let bestVal = -1;
  for (let k = 1; k <= Math.min(5, hand.length); k++) {
    for (const c of combos(hand, k)) {
      const v = valueOf(g, c);
      if (v > bestVal) { bestVal = v; best = c.map((x) => x.id); }
    }
  }
  return best;
}

/** 要弃就弃最差的：早期版本把"当前最优组合"整组弃掉，方向正好反了，
 *  于是它每弃一次就把自己最好的牌扔掉，最后误判成游戏太难。 */
function worstHand(g: Game): number[] {
  const sorted = [...g.state.hand].sort((a, b) => a.rank - b.rank);
  return sorted.slice(0, Math.min(5, sorted.length)).map((c) => c.id);
}

// 默认关：这个机器人量的是"什么都不开"的下界。带 --events 才把随机事件放进去
const SIM_FLAGS = { ...FLAGS_OFF, events: process.argv.includes('--events') };
// --nights=N：这一局打几夜（不给就是八夜参照档）。局长只挪终点，不改机器人的笨策略，
// 所以这一档量出来的是"同一套下界在不同终点下能走多远"
const SIM_LENGTH = clampNights(Number(/--nights=(\S+)/.exec(process.argv.join(' '))?.[1]));
const rows: string[] = [];
const results: { nights: number; status: string }[] = [];
let clearedAll = 0;
for (let s = 0; s < 30; s++) {
  const seed = 1000 + s * 7;
  const g = new Game(seed, 'standard', { flags: SIM_FLAGS, nights: SIM_LENGTH });
  let guard = 0;
  while (g.state.status !== 'won' && g.state.status !== 'lost' && guard++ < 4000) {
    // --events：待决时交给"让牌局自决"那条规则代选。机器人不规划事件，
    // 所以这是"事件白送也不挑"的下界，比真人玩家选得差
    if (g.state.pendingEvent.length) { autoResolveEvent(g); continue; }
    if (g.state.status === 'playing') {
      const need = targetOf(g.state) - g.state.score;
      const c = bestHand(g);
      g.state.chosen = c;
      const v = c.length ? valueOf(g, chosenCards(g.state)) : 0;
      // 分数是累加的，所以判据是"按剩余手数折算的节奏线"，不是"这一把够不够"
      const pace = need / Math.max(1, g.state.handsLeft);
      if (v >= pace || g.state.handsLeft <= 1) play(g);
      else if (g.state.discardsLeft > 0) { g.state.chosen = worstHand(g); discard(g); }
      else play(g);
      if (g.state.status === 'cleared') g.openShop();
      // 不在这里 next()：开店后交给下面的 shop 分支，先买东西再离场。
      // 原来写完 openShop() 立刻 next()，等于每次路过铺子都不进店，构筑永远为空。
    } else if (g.state.status === 'shop') {
      // 会买东西：座位没满就买第一个买得起的客人，其次消耗品
      const lim = limits(g.state);
      const want = g.state.shop.findIndex((s) => !s.sold && s.price <= g.state.money
        && ((s.kind === 'patron' && seatedCount(g.state) < lim.seats)
          || (s.kind === 'consumable' && g.state.consumables.length < lim.slots)));
      if (want >= 0) buy(g, want);
      g.next();
    } else break;
  }
  const nights = g.state.ledger.length;
  results.push({ nights, status: g.state.status });
  if (g.state.status === 'won') clearedAll++;
  rows.push(`seed ${seed}  撑过 ${String(nights).padStart(2)} 场  状态 ${g.state.status}  最高流水 ${Math.max(0, ...g.state.ledger.map((r) => r.best))}`);
}
console.log(rows.join('\n'));
const hist = new Map<number, number>();
for (const r of results) hist.set(r.nights, (hist.get(r.nights) ?? 0) + 1);
const sorted = results.map((r) => r.nights).sort((a, b) => a - b);
console.log(`\n局长 ${SIM_LENGTH} 夜（终场贵客 ${lengthOf(SIM_LENGTH).finalTarget} 分）：打通 ${clearedAll}/${results.length}`);
console.log(`撑过场次分布：${[...hist.entries()].sort((a, b) => a[0] - b[0]).map(([k, v]) => `${k}场×${v}`).join('  ')}`);
console.log(`中位数 ${sorted[Math.floor(sorted.length / 2)]} 场，最差 ${sorted[0]} 场，最好 ${sorted[sorted.length - 1]} 场`);
console.log('注：这是"不规划构筑"的下界。第 1 夜便宴(300) 每个种子都过得去；');
console.log('    卡住的场次 = 该种子在不做体系的情况下能到的天花板，不代表真人难度。');
