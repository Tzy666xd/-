// 牌型识别与牌型表。
// 保留扑克牌型当"输入器"是有意的：组合识别的认知成本已经被原版付掉了，
// 玩家一眼看得懂自己构筑在干什么。这一层不许碰 DOM，也不许碰随机。

export type Suit = 's' | 'h' | 'd' | 'c';
export const SUITS: readonly Suit[] = ['s', 'h', 'd', 'c'];
export const SUIT_GLYPH: Record<Suit, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const SUIT_NAME: Record<Suit, string> = { s: '黑桃', h: '红心', d: '方片', c: '梅花' };

export type Enh = 'none' | 'bonus' | 'mult' | 'glass' | 'gold';
// 蜡封是与强化正交的一轴：一张牌可以同时是"烫金 + 红蜡封"
export type Seal = 'none' | 'red' | 'gold' | 'purple' | 'blue';

export const SEAL_NAME: Record<Seal, string> = {
  none: '', red: '火漆·重诵', gold: '火漆·赏金', purple: '火漆·留书', blue: '火漆·押账',
};
export const SEAL_BLURB: Record<Seal, string> = {
  none: '',
  red: '这张牌计分两次',
  gold: '这张牌每计分一次得 £1',
  purple: '这张牌被弃掉时换一封随机引荐信',
  blue: '打出的一组里每有一道蓝蜡封，蓝封牌各 +25 流水',
};

export interface Card {
  id: number;
  rank: number; // 2..14（11=J 12=Q 13=K 14=A）
  suit: Suit;
  enh: Enh;
  seal: Seal;
  special?: import('./special-cards.ts').SpecialKind;
  /** 收藏/拾遗的蓄力（0..4），债券已兑现次数（0..3）。缺省为 0 */
  charge?: number;
}

export type HandKind =
  | 'high' | 'pair' | 'twopair' | 'three' | 'straight' | 'flush' | 'full'
  | 'four' | 'sf' | 'royal' | 'five' | 'flushhouse' | 'flushfive';

export interface HandDef {
  kind: HandKind;
  name: string;
  chips: number;   // 1 级基础流水
  mult: number;    // 1 级基础倍注
  dChips: number;  // 每升一级加的流水
  dMult: number;   // 每升一级加的倍注
  book: string;    // 对应「牌谱」的名字
}

// 层级从高到低：判定要按这个顺序取第一个成立的，高级牌型永远压过低级
export const HAND_ORDER: readonly HandKind[] = [
  'flushfive', 'flushhouse', 'five', 'royal', 'sf', 'four', 'full',
  'flush', 'straight', 'three', 'twopair', 'pair', 'high',
];

export const HANDS: Record<HandKind, HandDef> = {
  high:       { kind: 'high',       name: '高牌',     chips: 5,   mult: 1,  dChips: 10, dMult: 1, book: '入门牌谱' },
  pair:       { kind: 'pair',       name: '对子',     chips: 10,  mult: 2,  dChips: 15, dMult: 1, book: '对子谱' },
  twopair:    { kind: 'twopair',    name: '两对',     chips: 20,  mult: 2,  dChips: 20, dMult: 1, book: '两对谱' },
  three:      { kind: 'three',      name: '三条',     chips: 30,  mult: 3,  dChips: 20, dMult: 2, book: '三条谱' },
  straight:   { kind: 'straight',   name: '顺子',     chips: 30,  mult: 4,  dChips: 30, dMult: 3, book: '顺子谱' },
  flush:      { kind: 'flush',      name: '同花',     chips: 35,  mult: 4,  dChips: 15, dMult: 2, book: '同花谱' },
  full:       { kind: 'full',       name: '葫芦',     chips: 40,  mult: 4,  dChips: 25, dMult: 2, book: '葫芦谱' },
  four:       { kind: 'four',       name: '四条',     chips: 60,  mult: 7,  dChips: 30, dMult: 3, book: '四条谱' },
  sf:         { kind: 'sf',         name: '同花顺',   chips: 100, mult: 8,  dChips: 40, dMult: 4, book: '同花顺谱' },
  royal:      { kind: 'royal',      name: '皇家同花顺', chips: 100, mult: 8, dChips: 40, dMult: 4, book: '同花顺谱' },
  five:       { kind: 'five',       name: '五条',     chips: 120, mult: 12, dChips: 35, dMult: 3, book: '奇门牌谱' },
  flushhouse: { kind: 'flushhouse', name: '同花葫芦', chips: 140, mult: 14, dChips: 40, dMult: 4, book: '秘传牌谱' },
  flushfive:  { kind: 'flushfive',  name: '同花五条', chips: 160, mult: 16, dChips: 50, dMult: 3, book: '禁本牌谱' },
};

// 隐藏牌型要先"见过"一次才进图鉴；原版是永久解锁，这里照搬
export const SECRET_HANDS: readonly HandKind[] = ['five', 'flushhouse', 'flushfive'];

export const RANK_LABEL = (r: number): string =>
  r === 14 ? 'A' : r === 13 ? 'K' : r === 12 ? 'Q' : r === 11 ? 'J' : String(r);

export const isFace = (r: number): boolean => r >= 11 && r <= 13;

// 牌本身的筹码值：2..10 按点数，人头牌 10，A 按 11（原版 A 既是 11 又能成顺）
export const cardChips = (c: Card): number => {
  if (c.enh === 'gold') return 0;
  if (c.rank === 14) return 11;
  if (c.rank >= 11) return 10;
  return c.rank;
};

export interface HandResult {
  kind: HandKind;
  // 只有牌型里的那几张参与计分——这是玩家"选哪几张打出去"的全部技巧所在
  scoring: Card[];
}

function counts(cards: Card[]): Map<number, Card[]> {
  const m = new Map<number, Card[]>();
  for (const c of cards) {
    const g = m.get(c.rank);
    if (g) g.push(c);
    else m.set(c.rank, [c]);
  }
  return m;
}

function isFlush(cards: Card[]): boolean {
  return cards.length === 5 && cards.every((c) => c.suit === cards[0].suit);
}

// 顺子：5 张互不相同且连续；A2345 这种轮子算
function straightLow(cards: Card[]): number | null {
  if (cards.length !== 5) return null;
  const set = new Set(cards.map((c) => c.rank));
  if (set.size !== 5) return null;
  const rs = [...set].sort((a, b) => a - b);
  for (let i = 1; i < 5; i++) if (rs[i] !== rs[i - 1] + 1) {
    // 唯一的例外：10 J Q K A 已在上面成立，这里只再认 A 2 3 4 5
    const wheel = rs.join(',') === '2,3,4,5,14';
    return wheel ? 1 : null;
  }
  return rs[0];
}

export function evaluate(cards: Card[]): HandResult {
  // 空手牌不是"高牌"，它就没有牌型——UI 靠这个短路，别让它拿到 undefined
  if (!cards.length) return { kind: 'high', scoring: [] };
  const byRank = counts(cards);
  const groups = [...byRank.values()].sort((a, b) => b.length - a.length || b[0].rank - a[0].rank);
  const sizes = groups.map((g) => g.length);
  const flush = isFlush(cards);
  const low = straightLow(cards);
  const hasRun = low !== null;

  const top = (n: number) => groups.slice(0, n).flat();

  if (flush && sizes[0] === 5) return { kind: 'flushfive', scoring: cards };
  if (flush && sizes[0] === 3 && sizes[1] === 2) return { kind: 'flushhouse', scoring: cards };
  if (sizes[0] === 5) return { kind: 'five', scoring: groups[0] };
  if (flush && hasRun && low === 10) return { kind: 'royal', scoring: cards };
  if (flush && hasRun) return { kind: 'sf', scoring: cards };
  if (sizes[0] === 4) return { kind: 'four', scoring: groups[0] };
  if (sizes[0] === 3 && sizes[1] === 2) return { kind: 'full', scoring: top(2) };
  if (flush) return { kind: 'flush', scoring: cards };
  if (hasRun) return { kind: 'straight', scoring: cards };
  if (sizes[0] === 3) return { kind: 'three', scoring: groups[0] };
  if (sizes[0] === 2 && sizes[1] === 2) return { kind: 'twopair', scoring: top(2) };
  if (sizes[0] === 2) return { kind: 'pair', scoring: groups[0] };
  // 高牌只算最大的那一张——其余牌躺在手里不产生流水
  const hi = [...cards].sort((a, b) => b.rank - a.rank)[0];
  return { kind: 'high', scoring: [hi] };
}

export const handBase = (kind: HandKind, level: number): { chips: number; mult: number } => {
  const d = HANDS[kind];
  const n = Math.max(1, level) - 1;
  return { chips: d.chips + d.dChips * n, mult: d.mult + d.dMult * n };
};

export const rankHandNames = (kind: HandKind): string => HANDS[kind].name;
