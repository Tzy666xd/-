// 内容层：座上宾、引荐信、牌谱、会员特权、贵客。
// 全部是数据 + 纯函数，新增一张卡不需要动引擎。命名与身份都是原创的维多利亚牌局人物，
// 刻意避开原版的小丑形象。
import type { Card, HandKind, Suit } from './hands.ts';
import { SUITS, SUIT_GLYPH, HANDS } from './hands.ts';
import type { Effect, PatronCtx, PatronDef, Rarity, EffectKind, Hook, Mods } from './effects.ts';
import type { GrowthDef } from './growth.ts';
import { tierOf } from './lengths.ts';
import type { TierId } from './lengths.ts';

const isRun = (k: HandKind) => k === 'straight' || k === 'sf' || k === 'royal';
const isFlushy = (k: HandKind) => k === 'flush' || k === 'sf' || k === 'royal' || k === 'flushhouse' || k === 'flushfive';
const isSecret = (k: HandKind) => k === 'five' || k === 'flushhouse' || k === 'flushfive';
// 给新机制用的小判定。都只看这手牌的形状，不引入任何新的分数种类
const distinctSuits = (cards: Card[]): number => new Set(cards.map((x) => x.suit)).size;
const scoredAll = (c: PatronCtx): boolean =>
  c.played.length > 0 && c.result.scoring.length === c.played.length;
const sealedCount = (cards: Card[]): number => cards.filter((x) => x.seal !== 'none').length;
const pairCount = (cards: Card[]): number => {
  const t: Record<number, number> = {};
  for (const x of cards) t[x.rank] = (t[x.rank] ?? 0) + 1;
  return Object.values(t).filter((n) => n >= 2).length;
};


export const PATRONS: PatronDef[] = [
  {
    id: 'hobbs', name: '管家霍布斯', role: '伺候了三代主人', monogram: 'H',
    rarity: 'common', cost: 5, kind: 'chips', hook: 'onCard',
    temperament: 'hand',
    blurb: '每张计入牌型的牌 +8 流水',
    apply: (c: PatronCtx): Effect | null =>
      (c.card ? { chips: 8, note: '侍立', onCard: c.card } : null),
  },
  {
    id: 'payne', name: '马夫佩恩', role: '替客人拴马', monogram: 'P',
    rarity: 'common', cost: 4, kind: 'economy', hook: 'onDiscard',
    temperament: 'hand',
    blurb: '每弃一张牌得 £1',
    apply: (): Effect => ({ money: 1 }),
  },
  {
    id: 'countess', name: '红裙伯爵夫人', role: '只看得见红心', monogram: 'C',
    rarity: 'common', cost: 6, kind: 'chips', hook: 'onCard',
    temperament: 'head',
    blurb: '打出的 ♥ 牌 +16 流水',
    apply: (c: PatronCtx): Effect | null =>
      (c.card && c.card.suit === 'h' ? { chips: 16, note: '♥', onCard: c.card } : null),
  },
  {
    id: 'clerk', name: '记账先生', role: '最恨浪费', monogram: 'L',
    rarity: 'common', cost: 5, kind: 'economy', hook: 'onRoundEnd',
    temperament: 'head',
    blurb: '若这夜一次牌都没弃过，付 £8',
    apply: (c: PatronCtx): Effect | null => (c.discardsUsed === 0 ? { money: 8 } : null),
  },
  {
    id: 'turf', name: '赛马记者', role: '专跑夜马', monogram: 'T',
    rarity: 'uncommon', cost: 7, kind: 'xmult', hook: 'independent',
    temperament: 'head',
    blurb: '牌型含顺子时 ×2 倍注',
    apply: (c: PatronCtx): Effect | null => (isRun(c.result.kind) ? { xmult: 2, note: '连号' } : null),
  },
  {
    id: 'rent', name: '收租人', role: '逢五上门', monogram: 'R',
    rarity: 'uncommon', cost: 7, kind: 'mult', hook: 'onCard',
    temperament: 'head',
    blurb: '计分的人头牌各 +7 倍注',
    apply: (c: PatronCtx): Effect | null =>
      (c.card && c.card.rank >= 11 && c.card.rank <= 13 ? { mult: 7, note: '人头', onCard: c.card } : null),
  },
  {
    id: 'odd', name: '独眼赌徒', role: '数到三就动手', monogram: 'O',
    rarity: 'uncommon', cost: 8, kind: 'xmult', hook: 'onCard',
    temperament: 'head',
    blurb: '每第 3 张计分的牌 ×2 倍注',
    apply: (c: PatronCtx): Effect | null =>
      (c.index !== undefined && (c.index + 1) % 3 === 0 ? { xmult: 2, note: '第三张', onCard: c.card } : null),
  },
  {
    id: 'almanac', name: '老报馆主', role: '头版留给你', monogram: 'A',
    rarity: 'uncommon', cost: 7, kind: 'mixed', hook: 'onPlayed',
    temperament: 'head',
    blurb: '每夜第一次出牌 +60 流水 +8 倍注',
    apply: (c: PatronCtx): Effect | null => (c.handIndex === 0 ? { chips: 60, mult: 8, note: '头一手' } : null),
  },
  {
    id: 'heiress', name: '女继承人', role: '钱庄里有她的名字', monogram: 'I',
    rarity: 'rare', cost: 9, kind: 'rule', hook: 'onRoundEnd',
    temperament: 'hand',
    blurb: '存钱利息上限 +£5',
    mods: (): Mods => ({ interestCap: 5 }),
  },
  {
    id: 'cousin', name: '守财的表亲', role: '方块不落空', monogram: 'V',
    rarity: 'common', cost: 5, kind: 'economy', hook: 'onHeld',
    temperament: 'head',
    blurb: '局末时每握着一张 ♦ 得 £1',
    apply: (c: PatronCtx): Effect | null => (c.card && c.card.suit === 'd' ? { money: 1 } : null),
  },
  {
    id: 'house', name: '牌桌老板', role: '抽水是他的规矩', monogram: '♠',
    rarity: 'rare', cost: 10, kind: 'xmult', hook: 'independent',
    temperament: 'head',
    blurb: '×3 倍注，但这夜的彩头抬高 20%',
    apply: (): Effect => ({ xmult: 3, note: '抽水' }),
    mods: (): Mods => ({ targetScale: 1.2 }),
  },
  {
    id: 'baronet', name: '醉醺醺的从男爵', role: '只喝同花的酒', monogram: 'B',
    rarity: 'rare', cost: 9, kind: 'chips', hook: 'independent',
    temperament: 'head',
    blurb: '同花类牌型 +180 流水',
    apply: (c: PatronCtx): Effect | null => (isFlushy(c.result.kind) ? { chips: 180, note: '同花' } : null),
  },
  {
    id: 'twins', name: '双生姐妹', role: '姐姐说什么都对', monogram: 'Ⅱ',
    rarity: 'rare', cost: 11, kind: 'rule', hook: 'independent',
    temperament: 'head',
    blurb: '把左边那位座上宾的效果再演一遍',
    copy: 'left',
  },
  {
    id: 'sharp', name: '老千', role: '他从不出错', monogram: '?',
    rarity: 'legendary', cost: 14, kind: 'xmult', hook: 'independent',
    temperament: 'head',
    blurb: '打出隐秘牌型时 ×4 倍注',
    apply: (c: PatronCtx): Effect | null => (isSecret(c.result.kind) ? { xmult: 4, note: '隐秘' } : null),
  },
  // ══ 签名宾扩充：每位一条**互不重复**的触发机制 ══════════════════
  // 设计纪律：一位客人只讲一句话讲得清（硬约束 2），且触发条件必须落在
  // "你已经做得出的决定"或"明说的概率"上，不许偷偷加第三种分数（硬约束 1）。
  // temperament 三档：head＝打得对才响、hand＝无条件干货、heart＝吃概率。
  {
    id: 'watchman', name: '值夜的更夫', role: '只在最后一刻敲梆', monogram: 'W',
    temperament: 'head',
    rarity: 'common', cost: 5, kind: 'xmult', hook: 'independent',
    blurb: '这是本夜最后一次出牌时 ×2 倍注',
    apply: (c: PatronCtx): Effect | null =>
      (c.handsLeft === 1 ? { xmult: 2, note: '最后一手' } : null),
  },
  {
    id: 'abacus', name: '算牌先生', role: '牌堆剩几张他全记得', monogram: 'X',
    temperament: 'head',
    rarity: 'uncommon', cost: 7, kind: 'mixed', hook: 'onPlayed',
    blurb: '牌堆只剩 15 张以内时 +70 流水 +10 倍注',
    apply: (c: PatronCtx): Effect | null =>
      (c.deckLeft !== undefined && c.deckLeft <= 15 ? { chips: 70, mult: 10, note: '牌堆将尽' } : null),
  },
  {
    id: 'paperer', name: '拾荒的裱糊匠', role: '别人扔的他拿来糊墙', monogram: 'F',
    temperament: 'head',
    rarity: 'uncommon', cost: 6, kind: 'xmult', hook: 'independent',
    blurb: '弃牌堆攒够 10 张时 ×1.8 倍注',
    apply: (c: PatronCtx): Effect | null =>
      (c.discardCount !== undefined && c.discardCount >= 10 ? { xmult: 1.8, note: '废物利用' } : null),
  },
  {
    id: 'rightseat', name: '只坐上座的人', role: '挨着门的那一位', monogram: 'R',
    temperament: 'head',
    rarity: 'uncommon', cost: 8, kind: 'xmult', hook: 'independent',
    blurb: '坐在最右边一位时 ×2.2 倍注（换座能挪出来）',
    apply: (c: PatronCtx): Effect | null =>
      (c.seatIndex !== undefined && c.seatCount !== undefined
        && c.seatIndex === c.seatCount - 1 ? { xmult: 2.2, note: '上座' } : null),
  },
  {
    id: 'critic', name: '见多识广的评论家', role: '讨厌重样', monogram: 'C',
    temperament: 'head',
    rarity: 'rare', cost: 10, kind: 'mult', hook: 'onPlayed',
    blurb: '本夜已用过 4 种以上牌型时 +26 倍注',
    apply: (c: PatronCtx): Effect | null =>
      (c.distinctKinds !== undefined && c.distinctKinds >= 4 ? { mult: 26, note: '看得多' } : null),
  },
  {
    id: 'regular', name: '二十年的老主顾', role: '来得越久越照顾', monogram: 'G',
    temperament: 'hand',
    rarity: 'uncommon', cost: 7, kind: 'xmult', hook: 'independent',
    blurb: '每过一夜多 ×1.15 倍注（第 8 夜约 ×3）',
    apply: (c: PatronCtx): Effect | null =>
      ({ xmult: Math.pow(1.15, Math.max(1, c.night ?? 1)), note: '老主顾' }),
  },
  {
    id: 'sparse', name: '喜欢清净的寡妇', role: '手里空她才安心', monogram: 'S',
    temperament: 'head',
    rarity: 'common', cost: 5, kind: 'xmult', hook: 'independent',
    blurb: '打完这手手里只剩 3 张以内时 ×2 倍注',
    apply: (c: PatronCtx): Effect | null =>
      (c.held.length <= 3 ? { xmult: 2, note: '清净' } : null),
  },
  {
    id: 'neat', name: '讲究整齐的女爵', role: '容不得废牌', monogram: 'N',
    temperament: 'head',
    rarity: 'rare', cost: 11, kind: 'mult', hook: 'onPlayed',
    blurb: '打出的 5 张全部计分（没一张落空）时 +22 倍注',
    apply: (c: PatronCtx): Effect | null =>
      (scoredAll(c) ? { mult: 22, note: '一张不浪费' } : null),
  },
  {
    id: 'broker', name: '放账的中人', role: '你越敢押他越来劲', monogram: 'B',
    temperament: 'head',
    rarity: 'rare', cost: 12, kind: 'xmult', hook: 'independent',
    blurb: '抬注每档多 ×1.35 倍注（与抬注同涨）',
    apply: (c: PatronCtx): Effect | null =>
      (c.raised > 0 ? { xmult: Math.pow(1.35, c.raised), note: '跟注' } : null),
  },
  {
    id: 'richuncle', name: '财大气粗的表叔', role: '兜里有钱才说话', monogram: 'U',
    temperament: 'head',
    rarity: 'common', cost: 4, kind: 'chips', hook: 'onPlayed',
    blurb: '身上带够 £30 时 +90 流水',
    apply: (c: PatronCtx): Effect | null =>
      (c.money >= 30 ? { chips: 90, note: '有底气' } : null),
  },
  {
    id: 'devotee', name: '专一的情人', role: '受不得三心二意', monogram: 'V',
    temperament: 'head',
    rarity: 'uncommon', cost: 6, kind: 'xmult', hook: 'independent',
    blurb: '打出的牌只用两门花色以内时 ×1.9 倍注',
    apply: (c: PatronCtx): Effect | null =>
      (distinctSuits(c.played) <= 2 && c.played.length >= 3
        ? { xmult: 1.9, note: '专一' } : null),
  },
  {
    id: 'waxman', name: '火漆收藏家', role: '专挑有封的看', monogram: 'K',
    temperament: 'head',
    rarity: 'common', cost: 5, kind: 'chips', hook: 'onCard',
    blurb: '每张带火漆的计分牌 +14 流水',
    apply: (c: PatronCtx): Effect | null =>
      (c.card && c.card.seal !== 'none' ? { chips: 14, note: '有封', onCard: c.card } : null),
  },
  {
    id: 'pairkeeper', name: '收藏对子的人', role: '手里成双他才笑', monogram: 'P',
    temperament: 'head',
    rarity: 'uncommon', cost: 6, kind: 'chips', hook: 'independent',
    blurb: '打完这手，手里每还剩一对同点数 +20 流水',
    apply: (c: PatronCtx): Effect | null =>
      (pairCount(c.held) > 0 ? { chips: 20 * pairCount(c.held), note: '成双' } : null),
  },
  {
    id: 'general', name: '破釜沉舟的将军', role: '不留退路', monogram: 'J',
    temperament: 'head',
    rarity: 'rare', cost: 9, kind: 'rule', hook: 'independent',
    blurb: '这夜少一次出牌，但 ×2.5 倍注',
    apply: (): Effect => ({ xmult: 2.5, note: '不留退路' }),
    mods: (): Mods => ({ hands: -1 }),
  },
  {
    id: 'hostess', name: '爱张罗的东道主', role: '座位永远多一把', monogram: 'H',
    temperament: 'hand',
    rarity: 'uncommon', cost: 8, kind: 'rule', hook: 'independent',
    blurb: '座位上限 +1，但自己不产生分数',
    apply: (): null => null,
    mods: (): Mods => ({ seats: 1 }),
  },
  // ── heart：把概率明写在脸上的一类 ═─────────────────────────
  {
    id: 'diceboy', name: '掷骰的浪子', role: '一把定音', monogram: 'D',
    temperament: 'heart',
    rarity: 'common', cost: 3, kind: 'xmult', hook: 'independent',
    blurb: '每手 1/6 机会 ×3 倍注',
    apply: (c: PatronCtx): Effect | null =>
      (c.roll?.(1 / 6) ? { xmult: 3, note: '掷骰命中' } : null),
  },
  {
    id: 'oracle', name: '占星婆婆', role: '看每张牌的脸色', monogram: 'Z',
    temperament: 'heart',
    rarity: 'uncommon', cost: 5, kind: 'mult', hook: 'onCard',
    blurb: '每张计分牌有 1/5 机会 +20 倍注',
    apply: (c: PatronCtx): Effect | null =>
      (c.card && c.roll?.(1 / 5) ? { mult: 20, note: '星位相合', onCard: c.card } : null),
  },
  {
    id: 'smuggler', name: '门口的走私商', role: '结清时才现身', monogram: 'M',
    temperament: 'heart',
    rarity: 'common', cost: 4, kind: 'economy', hook: 'onRoundEnd',
    blurb: '结清时 1/3 机会付 £15',
    apply: (c: PatronCtx): Effect | null => (c.roll?.(1 / 3) ? { money: 15 } : null),
  },
];

PATRONS.push(
  {id:'solicitor',name:'契约律师',role:'每个承诺都记在案',monogram:'CT',clubOnly:true,
    rarity:'uncommon',cost:7,kind:'mult',hook:'independent',temperament:'head',
    blurb:'每份已领取奖励的委托 +2 倍注，最多 +12',
    apply:c=>(c.contractsDone??0)>0?{mult:Math.min(12,2*(c.contractsDone??0)),note:'履约'}:null},
  {id:'archivist',name:'修复师艾达',role:'折角也是故事',monogram:'AD',clubOnly:true,
    rarity:'common',cost:5,kind:'chips',hook:'onCard',temperament:'head',
    blurb:'每张计分牌每层蓄力 +8 流水，最多 +32（债券的兑现次数不算蓄力）',
    apply:c=>c.card&&(c.card.special==='salvage'||c.card.special==='collector')&&(c.card.charge??0)>0?{chips:8*Math.min(4,c.card.charge??0),note:'修复'}:null},
  {id:'courier',name:'午夜邮差',role:'让下一位接上来',monogram:'MP',clubOnly:true,
    rarity:'common',cost:5,kind:'chips',hook:'onPlayed',temperament:'head',
    blurb:'出牌中至少有两张相邻同花色的牌，+35 流水',
    apply:c=>c.played.some((x,i)=>i>0&&x.suit===c.played[i-1].suit)?{chips:35,note:'接力'}:null},
  {id:'sponsor',name:'灰手套赞助人',role:'守信就值得投资',monogram:'GS',clubOnly:true,
    rarity:'uncommon',cost:7,kind:'economy',hook:'onRoundEnd',temperament:'head',
    blurb:'本夜已领取过委托奖励，之后每场结清额外 £4',
    apply:c=>(c.contractsTonight??0)>0?{money:4,note:'赞助'}:null},
);

// ── tag / 邻接共鸣 / 长进：三张附表按 id 挂到 PATRONS 上 ─────────
// 为什么不直接把字段写进那 14 个对象：这张表要能被逐条 review 与批量调整
// （"哪些人算一门"是内容决定，不是逻辑决定），而且新客人只要在这里加一行。
// 挂完之后 PatronDef 上就是普通字段，结算侧读法与内联写法完全一样。
const PATRON_TAGS: Record<string, string[]> = {
  solicitor:['law','quill'],archivist:['nerd','quill'],courier:['trade','blood'],sponsor:['court','newmoney'],
  hobbs: ['law', 'nerd'],
  payne: ['trade', 'blood'],
  countess: ['court', 'nerd'],
  clerk: ['law', 'quill'],
  turf: ['trade', 'quill'],
  rent: ['trade', 'newmoney'],
  odd: ['nerd', 'blood'],
  almanac: ['quill', 'trade'],
  heiress: ['court', 'newmoney'],
  cousin: ['law', 'blood'],
  house: ['trade', 'newmoney'],
  baronet: ['court', 'blood'],
  twins: ['blood', 'nerd'],
  sharp: ['law', 'newmoney'],
  // 新扩充的签名宾也一并入册：不挂 tag 的话他们进不了任何套装，
  // 开局抽到他们的玩家会在 tag 轴上被系统性亏待
  watchman: ['law', 'trade'],
  abacus: ['nerd', 'quill'],
  paperer: ['trade'],
  rightseat: ['court'],
  critic: ['quill', 'nerd'],
  regular: ['trade', 'blood'],
  sparse: ['blood'],
  neat: ['court', 'nerd'],
  broker: ['law', 'newmoney'],
  richuncle: ['blood', 'newmoney'],
  devotee: ['blood'],
  waxman: ['nerd', 'trade'],
  pairkeeper: ['nerd'],
  general: ['court'],
  hostess: ['court', 'trade'],
  diceboy: ['newmoney', 'nerd'],
  oracle: ['nerd', 'blood'],
  smuggler: ['trade', 'newmoney'],
};

// 邻接共鸣一律走**乘法或加倍注**：加法那一档换座不影响结果（加法可交换），
// 只有乘在已累积的倍注上，座位次序才会改变总分——"排序"这个决策才真实存在。
const PATRON_ADJACENCY: Record<string, Effect> = {
  countess: { xmult: 1.3, note: '门第相照' },
  baronet: { xmult: 1.3, note: '爵位相照' },
  heiress: { xmult: 1.4, note: '产业相照' },
  twins: { xmult: 1.25, note: '姊妹同席' },
  sharp: { xmult: 1.35, note: '契券相通' },
  clerk: { mult: 25, note: '账目相通' },
};

// 长进一律带上限：最后一档就是顶，XP 到顶后不再累加（growth.ts 的 grow 负责封顶）
const PATRON_GROWTH: Record<string, GrowthDef> = {
  hobbs: { xpPerUse: 1, note: '侍立渐熟', levels: [
    { requireXp: 3, effectDelta: { chips: 20 } },
    { requireXp: 6, effectDelta: { chips: 45 } },
  ] },
  rent: { xpPerUse: 1, note: '租约渐厚', levels: [
    { requireXp: 4, effectDelta: { mult: 5 } },
    { requireXp: 9, effectDelta: { mult: 12 } },
  ] },
  almanac: { xpPerUse: 1, note: '掌故渐笃', levels: [
    { requireXp: 5, effectDelta: { xmult: 1.15 } },
  ] },
};

for (const x of PATRONS) {
  if (PATRON_TAGS[x.id]) x.tags = PATRON_TAGS[x.id];
  if (PATRON_ADJACENCY[x.id]) x.adjacency = PATRON_ADJACENCY[x.id];
  if (PATRON_GROWTH[x.id]) x.growth = PATRON_GROWTH[x.id];
}

export const patronById = (id: string): PatronDef => {
  const p = PATRONS.find((x) => x.id === id);
  if (!p) throw new Error(`没有这位客人：${id}`);
  return p;
};

export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 60, uncommon: 32, rare: 7, legendary: 1,
};

// 声望决定货位能出现哪一档：牌局名气越大，来的客人越讲究
export const RARITY_MIN_REP: Record<Rarity, number> = {
  common: 0, uncommon: 0, rare: 2, legendary: 4,
};

// ── 引荐信（一次性，改牌）────────────────────────────────────────
export type LetterId =
  | 'gild' | 'vermilion' | 'lens' | 'will' | 'swap' | 'write' | 'strike'
  | 'wax' | 'echo' | 'twin' | 'purge' | 'fortune';

export interface LetterDef {
  id: LetterId; name: string; blurb: string; picks: number;
}
export const LETTERS: LetterDef[] = [
  { id: 'gild', name: '烫金令', blurb: '选中 1 张牌 → 记入牌型时 +30 流水', picks: 1 },
  { id: 'vermilion', name: '朱批', blurb: '选中 1 张牌 → 记入牌型时 +4 倍注', picks: 1 },
  { id: 'lens', name: '磨镜', blurb: '选中 1 张牌 → ×2 倍注，但有 1/4 概率在结算后碎掉', picks: 1 },
  { id: 'will', name: '遗嘱', blurb: '选中 1 张牌 → 这夜结束时若仍握在手里，付 £4', picks: 1 },
  { id: 'swap', name: '移花', blurb: '选中 1 张牌 → 花色改成手里最多那一门', picks: 1 },
  { id: 'strike', name: '销账', blurb: '永久移除选中 1 张牌，得 £5', picks: 1 },
  { id: 'write', name: '誊抄', blurb: '复制选中 1 张牌放进牌堆（隐秘牌型由此而来）', picks: 1 },
  { id: 'wax', name: '火漆匣', blurb: '选中 1 张牌 → 随机落一道火漆', picks: 1 },
  { id: 'echo', name: '复诵帖', blurb: '选中 1 张牌 → 红蜡封：这张牌计分两次', picks: 1 },
  { id: 'twin', name: '并蒂笺', blurb: '选中 2 张牌 → 右边那张改成与左边同点同花', picks: 2 },
  { id: 'purge', name: '涤生帖', blurb: '选中 1 张牌 → 洗掉它的强化与火漆，得 £3', picks: 1 },
  { id: 'fortune', name: '命签', blurb: '立刻得 £8–£20，签好签坏都走同一条随机流', picks: 0 },
];
export const letterById = (id: LetterId): LetterDef => {
  const l = LETTERS.find((x) => x.id === id);
  if (!l) throw new Error(`没有这封信：${id}`);
  return l;
};

// ── 牌谱（一次性，升牌型）────────────────────────────────────────
// 皇家同花顺与同花顺共用一本，跟原版一致；隐秘牌型的谱子由声望门槛挡住
export const BOOKS: { kind: HandKind; name: string }[] = (
  (Object.keys(HANDS) as HandKind[])
    .filter((k) => k !== 'royal')
    .map((k) => ({ kind: k, name: HANDS[k].book }))
);

// ── 会员特权（整局永久）────────────────────────────────────────
export interface VoucherDef {
  id: string; name: string; blurb: string; cost: number; mods: Mods;
  special?: 'library';
}
export const VOUCHERS: VoucherDef[] = [
  { id: 'membership', name: '正式会籍', blurb: '座位上限 +1', cost: 10, mods: { seats: 1 } },
  { id: 'ledger', name: '记账房', blurb: '存钱利息上限 +£5', cost: 10, mods: { interestCap: 5 } },
  { id: 'insider', name: '内场通行', blurb: '此后每夜的首次重掷免费', cost: 12, mods: { freeRerolls: 1 } },
  { id: 'discount', name: '熟客折牌', blurb: '铺子里一切都打八折（向下取整，最低 £1）', cost: 12, mods: { priceScale: 0.8 } },
  { id: 'cabinet', name: '信匣', blurb: '随身引荐信槽 +1', cost: 10, mods: { slots: 1 } },
  { id: 'conservatory', name: '暖房', blurb: '手牌上限 +2', cost: 14, mods: { handSize: 2 } },
  { id: 'postchaise', name: '驿站马车', blurb: '每场多一次弃牌', cost: 10, mods: { discards: 1 } },
  { id: 'library', name: '藏书阁', blurb: '每场结束，本场用得最多的牌型自动升一级', cost: 16, mods: {}, special: 'library' },
];

// ── 起手牌组（重玩性的主轴：开局就改写规矩）───────────────────────
export interface DeckDef {
  id: string; name: string; blurb: string;
  money?: number; mods?: Mods;
  grant?: 'uncommon' | 'rare';          // 开局白送一位某档客人
  interestFlat?: number;                // 直接钉死利息上限（高利贷的代价）
  /** 只在这一档局长里摆出来的专属牌组（2026-10-12 他定的"局长给独立奖励：按档位开专属牌组"）。
   *  不写就是每一档都能选。名字与数值都是**占位工作名**，等他试玩后定。 */
  tier?: TierId;
}
export const DECKS: DeckDef[] = [
  { id: 'standard', name: '标准牌局', blurb: '没有额外规矩，上手就是它' },
  { id: 'generous', name: '宽裕账本', blurb: '每场多一次弃牌，但起手少 £2', mods: { discards: 1 }, money: -2 },
  { id: 'steady', name: '从容座', blurb: '每场多一次出牌、少一次弃牌', mods: { hands: 1, discards: -1 } },
  { id: 'usurer', name: '高利贷', blurb: '起手 £24，但利息上限只有 £2', money: 20, interestFlat: 2 },
  { id: 'patrician', name: '名门', blurb: '开局白送一位稀客，但座位上限 −1', mods: { seats: -1 }, grant: 'uncommon' },
  // ── 五档局长的专属牌组：只有那一档摆出来，每副都在答"这一档在赌什么" ──
  { id: 'flash', name: '一手到位', tier: 'short', money: 4,
    blurb: '三到四夜限定：每场多一次出牌、起手多 £4，但少一次弃牌——短局没有慢慢换牌的余裕',
    mods: { hands: 1, discards: -1 } },
  { id: 'halfhouse', name: '半班底', tier: 'mid', money: -6,
    blurb: '五到七夜限定：多一个客人座位，但起手少 £6——位置给你，人得自己请',
    mods: { seats: 1 } },
  { id: 'book', name: '庄家账', tier: 'core',
    blurb: '八夜正局限定：利息上限 +£3、每场一次免费重掷，但铺子里的东西贵两成',
    mods: { interestCap: 3, freeRerolls: 1, priceScale: 1.2 } },
  { id: 'longstove', name: '长灶', tier: 'long', money: -8,
    blurb: '九到十一夜限定：手牌上限 +1、随身格 +1，但起手少 £8——摊子铺得开，本钱自己攒',
    mods: { handSize: 1, slots: 1 } },
  { id: 'watchman', name: '守夜人', tier: 'deep',
    blurb: '十二夜以上限定：每场多两次弃牌，但少一次出牌——马拉松靠的是不把一手牌打光',
    mods: { discards: 2, hands: -1 } },
];
/** 这一档局长能选哪些牌组：没绑档位的人人都能选，绑了档位的只在那一档出现 */
export const decksFor = (nights: number): DeckDef[] => {
  const t = tierOf(nights);
  return DECKS.filter((d) => !d.tier || d.tier === t);
};
/** 这副牌组在这一档局长里合不合法（开局与读档都问它，不各自抄一份规则） */
export const deckLegal = (id: unknown, nights: number): boolean => {
  const d = DECKS.find((x) => x.id === id);
  return !!d && (!d.tier || d.tier === tierOf(nights));
};
export const deckById = (id: string): DeckDef => {
  const d = DECKS.find((x) => x.id === id);
  return d ?? DECKS[0];
};

// ── 贵客（每底第三夜的不速之客）──────────────────────────────────
export interface BossDef {
  id: string; name: string; blurb: string;
  suitLock?: Suit; faceLock?: boolean; handSize?: number; hands?: number; taxDiscard?: number;
}
export const BOSSES: BossDef[] = [
  { id: 'picky', name: '挑剔的女伯爵', blurb: '♥ 在她面前不算数', suitLock: 'h' },
  { id: 'bailiff', name: '沉默的警长', blurb: '人头牌一律不计分', faceLock: true },
  { id: 'narrow', name: '窄桌', blurb: '手牌上限减 3', handSize: -3 },
  { id: 'miser', name: '吝啬的管家', blurb: '这夜少出一次牌', hands: -1 },
  { id: 'taxman', name: '税吏', blurb: '每弃一张牌被抽走 £2', taxDiscard: 2 },
];

export const SUIT_GLYPH_OF = (s: Suit): string => SUIT_GLYPH[s];

// 引荐信「移花」用的：手里数量最多的花色
export const majoritySuit = (cards: Card[]): Suit => {
  const tally: Record<Suit, number> = { s: 0, h: 0, d: 0, c: 0 };
  for (const c of cards) tally[c.suit] += 1;
  let best: Suit = SUITS[0];
  for (const s of SUITS) if (tally[s] > tally[best]) best = s;
  return best;
};
