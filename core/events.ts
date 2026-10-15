// 随机事件（偶发局）。一夜打到一半，牌局外头递进来一件事：三个候选，选一个，
// 或者让管家替你选一个。它是**决策点**不是弹窗——每条都带价，收益越狠价越狠。
//
// 为什么是"数据表 + 执行器"而不是回调：
//   事件要能存档、能重放、能被自检逐条钉住。写成函数就变成"这局到底发生了什么"
//   没法从数据里读出来，反证注入也无从下手。所以本文件只有描述（ops），
//   真去动 state 的执行器在 core/game.ts——那边才拿得到 uid / MAX_DECK / 夹零那些把手。
//
// 为什么候选池走一条**派生**随机流（同 core/draft.ts）：
//   "给你看哪三件事"不该挤动主随机流——主流一多消耗一步，发牌、铺子、玻璃碎裂
//   全往后挪一位，老存档快进就落到别的牌上了（AGENTS.md 里那条复现性承诺）。
//   但事件**执行时**的运气（抛硬币、随机挑一张牌）必须走主流：那是这一局真的在发生的事，
//   本来就该被 (seed, 步数) 记进账里。
import type { Effect, Mods, Rarity, Temperament } from './effects.ts';
import type { Enh, HandKind, Seal, Suit } from './hands.ts';
import { Rand } from './rng.ts';
import type { SpecialKind } from './special-cards.ts';

/** 一条修正活多久：下一手 / 这一夜 / 这一局 */
export type EventScope = 'hand' | 'night' | 'run';

/** 事件赠牌保留现有强化与蜡封；稀奇牌身份另行记录，两个计分路径均支持。 */
export interface NewCard {
  rank: number;
  suit: Suit;
  enh?: Enh;
  seal?: Seal;
  special?: SpecialKind;
}

/** 一条操作。game.ts 的 applyEventOp 是它唯一的执行者，这里每加一种它就得接一种。 */
export type EventOp =
  /** 银钱。负数由执行器夹到 0——钱不会是负的，这是内核既有的规矩 */
  | { t: 'money'; n: number }
  /** 声望 */
  | { t: 'rep'; n: number }
  /** 改规矩：手牌上限 / 出牌次数 / 弃牌次数 / 座位 / 贵客槽 / 利息 / 彩头系数 / 货价 */
  | { t: 'rule'; m: Mods; scope: EventScope }
  /**
   * 进计分管道的加项。只许带 流水 / 倍注 / 倍注乘 —— **银钱不走这里**：
   * 管道里的 'bonus' 事件形没有 money 一格，硬塞等于造一条演不出来的账
   * （而 §10 第 3 条"跟钱有关的 hook 要不要拉进管道"还没定，不该由事件替它定）。
   * 钱要变就用 {t:'money'} 那一条。hands 只对 scope='hand' 有意义。
   */
  | { t: 'score'; e: Effect; scope: EventScope; hands?: number }
  /** 往牌堆里加牌（受 MAX_DECK 上界约束） */
  | { t: 'addCard'; cards: NewCard[]; to?: 'deck' | 'hand' }
  /** 复制手上的牌放进牌堆（誊抄那条路的公用件） */
  | { t: 'copyHand'; n: number }
  /** 给若干张牌落一道强化或火漆；value 写 'random' 就从现有那几种里摇 */
  | { t: 'mark'; what: 'enh' | 'seal'; value: Enh | Seal | 'random'; where: 'hand' | 'deck'; n: number }
  /** 洗掉强化与火漆 */
  | { t: 'strip'; where: 'hand' | 'deck'; n: number }
  /** 永久移除若干张牌并每张折银；what 决定挑哪几张 */
  | { t: 'purge'; what: 'enhanced' | 'sealed' | 'random'; n: number; per: number }
  /** 弃牌堆收回牌堆并重洗 */
  | { t: 'returnDiscard'; n: number }
  /** 手牌整把收回牌堆重洗，重新发满 */
  | { t: 'mulligan' }
  /** 客人：请走一位（补一笔钱），或给一位把版本升一级 */
  | { t: 'seat'; what: 'leave' | 'upgrade'; refund: number }
  /** 直接请进一位某档客人。price>0 从银钱里扣，钱不够就不请（不白给） */
  | { t: 'grantSeat'; rarity: Rarity; price: number }
  /** 给一封引荐信（不写 id 就随机一封） */
  | { t: 'grantLetter'; id?: string }
  /** 牌谱升一级（不写 kind 就随机升一门） */
  | { t: 'bookUp'; kind?: HandKind; n: number }
  /** 抛硬币：走主随机流，正反各执行一串 */
  | { t: 'coin'; p: number; win: EventOp[]; lose: EventOp[] };

/** 前置条件。也是数据：由 game.ts 现算一份读数传进来比，事件表自己不碰 state。 */
export type EventCond =
  | { t: 'seatsAtLeast'; n: number }
  | { t: 'seatsRoom' }
  | { t: 'moneyAtLeast'; n: number }
  | { t: 'discardAtLeast'; n: number }
  | { t: 'deckRoom' }
  | { t: 'hasMarked'; n: number };

/** canFire 要用的读数。game.ts 里 eventFactsOf() 是唯一生产者。 */
export interface EventFacts {
  night: number;
  seats: number;
  /** 座位容量（limits() 算完之后的） */
  seatCap: number;
  money: number;
  discardCount: number;
  totalCards: number;
  deckCap: number;
  /** 带强化或火漆的牌有几张 */
  marked: number;
}

export interface EventDef {
  id: string;
  /** 卡片抬头：这件事叫什么 */
  name: string;
  /** 一句话场景。玩家先读这句决定要不要点 */
  kicker: string;
  /** 后果的白话账。**必须与 ops 一致**——自检逐条对着 ops 核这句话里的数字 */
  blurb: string;
  /** 与签名宾同一套脾气词：靠脑子 / 稳吃 / 吃运气 */
  risk: Temperament;
  ops: EventOp[];
  /** 第几夜起才可能递进来（狠的那几条别在第一夜就砸到人） */
  minNight?: number;
  /** 整局只递一次 */
  once?: boolean;
  cond?: EventCond[];
}

/** 与 core/draft.ts 的 DRAFT_SALT 错开。改它等于换一批事件池，不影响已开局的档。 */
const EVENT_SALT = 0x3ea7_0ed;

/** 抽牌礼那条派生流的 salt：与事件候选错开（同一夜抽出的三件事与摆出的那排牌不许共用一段骰子） */
export const FAN_SALT = 0x5c19_31b7;

/** 候选张数。三选一：多了看不过来，少了是假选择。 */
export const EVENT_OFFER = 3;

/** 每夜第一次动作到第几次之间触发（2 或 3，由派生流定，所以每夜不一样但可复现） */
export const eventAtFor = (r: Rand): number => 2 + r.int(2);

// ── 五十条事件 ─────────────────────────────────────────────────
// 写法上的三条纪律：
// 1. 狠的必须带价。白给的收益会淹没构筑，"三选一"就退化成"三个都要"。
// 2. 稳吃那类不该只是"小钱"，它给的是**确定的节奏**（次数 / 上限 / 回收）。
// 3. 吃运气那类把概率写进文案明着告诉玩家，不做暗袋。
export const EVENTS: EventDef[] = [
  {
    id: 'gas-lamp', name: '煤气灯捻低了', kicker: '灯芯一矮，牌好认了，彩头也跟着高',
    blurb: '本夜每手 +20 流水；本夜彩头抬高一成', risk: 'head',
    ops: [{ t: 'score', e: { chips: 20 }, scope: 'night' },
      { t: 'rule', m: { targetScale: 1.1 }, scope: 'night' }],
  },
  {
    id: 'snake-oil', name: '卖药人的赌局', kicker: '一瓶说不清来历的药水，敢不敢一口干',
    blurb: '五五开：成则 £18，败则赔 £9', risk: 'heart',
    ops: [{ t: 'coin', p: 0.5, win: [{ t: 'money', n: 18 }], lose: [{ t: 'money', n: -9 }] }],
  },
  {
    id: 'butler-note', name: '管家的辞呈', kicker: '他今晚递上来，押着的是一位客人的名字',
    blurb: '随机一位客人离席，账上补 £8', risk: 'head',
    cond: [{ t: 'seatsAtLeast', n: 1 }],
    ops: [{ t: 'seat', what: 'leave', refund: 8 }],
  },
  {
    id: 'tailor', name: '裁缝夜访', kicker: '袖口缝宽一寸，手里就多一张',
    blurb: '付 £7：整局手牌上限 +1', risk: 'hand', once: true, minNight: 2,
    cond: [{ t: 'moneyAtLeast', n: 7 }],
    ops: [{ t: 'money', n: -7 }, { t: 'rule', m: { handSize: 1 }, scope: 'run' }],
  },
  {
    id: 'bitter-wine', name: '隔夜的波尔多', kicker: '闻着是奖，喝下去是罚',
    blurb: '下一手倍注 +8；本夜弃牌次数 −1', risk: 'head',
    ops: [{ t: 'score', e: { mult: 8 }, scope: 'hand' },
      { t: 'rule', m: { discards: -1 }, scope: 'night' }],
  },
  {
    id: 'loan-note', name: '高利贷的便条', kicker: '钱现在就给，往后的利息归他',
    blurb: '立刻 £30；整局利息上限 −£3', risk: 'head', once: true,
    ops: [{ t: 'money', n: 30 }, { t: 'rule', m: { interestCap: -3 }, scope: 'run' }],
  },
  {
    id: 'old-deed', name: '祖上的地契', kicker: '羊皮角上烧着一枚红蜡，比谁都旧',
    blurb: '一张黑桃 A 带「重诵」火漆进牌堆：它计分两次', risk: 'hand', once: true,
    cond: [{ t: 'deckRoom' }],
    ops: [{ t: 'addCard', cards: [{ rank: 14, suit: 's', seal: 'red' }] }],
  },
  {
    id: 'oyster-bill', name: '生蚝账单', kicker: '壳堆在银盘里，账写在主人名下',
    blurb: '付 £10；本夜每手 +30 流水', risk: 'hand',
    cond: [{ t: 'moneyAtLeast', n: 10 }],
    ops: [{ t: 'money', n: -10 }, { t: 'score', e: { chips: 30 }, scope: 'night' }],
  },
  {
    id: 'torn-letter', name: '断头的引荐信', kicker: '封口撕掉一半，落款没人认得',
    blurb: '得一封随机引荐信', risk: 'hand',
    ops: [{ t: 'grantLetter' }],
  },
  {
    id: 'candle-roll', name: '蜡烛点名', kicker: '吹熄一根，这一夜就少一次出牌',
    blurb: '本夜出牌次数 −1；本夜每手倍注 +5', risk: 'head',
    ops: [{ t: 'rule', m: { hands: -1 }, scope: 'night' },
      { t: 'score', e: { mult: 5 }, scope: 'night' }],
  },
  {
    id: 'river-fog', name: '河雾漫进来', kicker: '什么都看不清，索性重发一手',
    blurb: '手牌整把收回牌堆重洗，重新发满', risk: 'hand',
    ops: [{ t: 'mulligan' }],
  },
  {
    id: 'penny-dreadful', name: '便士惊悚小册', kicker: '读到第三页就烧了，钱倒是省下一笔',
    blurb: '立刻 £12；本夜彩头抬高半成', risk: 'head',
    ops: [{ t: 'money', n: 12 }, { t: 'rule', m: { targetScale: 1.05 }, scope: 'night' }],
  },
  {
    id: 'broken-mirror', name: '碎镜', kicker: '七年刑期，折算成一张玻璃牌',
    blurb: '随机一张手牌磨成玻璃牌：倍注 ×2，计分后四分之一概率碎掉', risk: 'heart',
    ops: [{ t: 'mark', what: 'enh', value: 'glass', where: 'hand', n: 1 }],
  },
  {
    id: 'widow-ring', name: '遗孀的戒指', kicker: '她当掉它，换你一夜好手气',
    blurb: '付 £6；下一手倍注 ×2', risk: 'head',
    cond: [{ t: 'moneyAtLeast', n: 6 }],
    ops: [{ t: 'money', n: -6 }, { t: 'score', e: { xmult: 2 }, scope: 'hand' }],
  },
  {
    id: 'coachman', name: '轿夫的赏钱', kicker: '他不催，但他会记着',
    blurb: '付 £5；本夜铺子货价八五折', risk: 'hand',
    cond: [{ t: 'moneyAtLeast', n: 5 }],
    ops: [{ t: 'money', n: -5 }, { t: 'rule', m: { priceScale: 0.85 }, scope: 'night' }],
  },
  {
    id: 'rail-share', name: '铁路股', kicker: '一张纸，赌一个时代会不会来',
    blurb: '十次里成三次：成则 £45，不成赔 £12', risk: 'heart', minNight: 3,
    ops: [{ t: 'coin', p: 0.3, win: [{ t: 'money', n: 45 }], lose: [{ t: 'money', n: -12 }] }],
  },
  {
    id: 'card-cabinet', name: '牌柜的钥匙', kicker: '柜里全是别人输掉的牌',
    blurb: '弃牌堆至多 5 张收回牌堆并重洗', risk: 'hand',
    cond: [{ t: 'discardAtLeast', n: 1 }],
    ops: [{ t: 'returnDiscard', n: 5 }],
  },
  {
    id: 'smuggler-trunk', name: '走私者的箱子', kicker: '撬开才知道是谁的',
    blurb: '随机一门牌谱升一级', risk: 'heart',
    ops: [{ t: 'bookUp', n: 1 }],
  },
  {
    id: 'dice-boy', name: '骰童', kicker: '他替你掷，账归你认',
    blurb: '五五开：成则本夜每手倍注 +12，不成赔 £8', risk: 'heart',
    ops: [{ t: 'coin', p: 0.5,
      win: [{ t: 'score', e: { mult: 12 }, scope: 'night' }],
      lose: [{ t: 'money', n: -8 }] }],
  },
  {
    id: 'critic', name: '评论家', kicker: '他写谁，谁就涨价',
    blurb: '随机一位在席客人的版本升一级', risk: 'head', minNight: 3,
    cond: [{ t: 'seatsAtLeast', n: 1 }],
    ops: [{ t: 'seat', what: 'upgrade', refund: 0 }],
  },
  {
    id: 'wrong-purse', name: '拿错的钱袋', kicker: '天亮之前会有人来讨，袋底还有一张牌',
    blurb: '立刻 £20；本夜每手流水 −15；一张方片 Q 带「赏金」火漆进牌堆', risk: 'head',
    cond: [{ t: 'deckRoom' }],
    ops: [{ t: 'money', n: 20 }, { t: 'score', e: { chips: -15 }, scope: 'night' },
      { t: 'addCard', cards: [{ rank: 12, suit: 'd', seal: 'gold' }] }],
  },
  {
    id: 'chimney-sweep', name: '扫烟囱的', kicker: '顺手带走几张最烂的牌',
    blurb: '永久移除至多 2 张随机牌，每张折 £4', risk: 'hand', minNight: 2,
    ops: [{ t: 'purge', what: 'random', n: 2, per: 4 }],
  },
  {
    id: 'seance', name: '招灵会', kicker: '问过下一张牌，就得让出一点别的',
    blurb: '本夜倍注 ×2；整局手牌上限 −1；桌上一张黑桃 7 带「重诵」火漆进牌堆',
    risk: 'head', once: true, minNight: 4, cond: [{ t: 'deckRoom' }],
    ops: [{ t: 'score', e: { xmult: 2 }, scope: 'night' },
      { t: 'rule', m: { handSize: -1 }, scope: 'run' },
      { t: 'addCard', cards: [{ rank: 7, suit: 's', seal: 'red' }] }],
  },
  {
    id: 'racing-form', name: '赛马小报', kicker: '马赢了，你分到一点点',
    blurb: '十次里成五次：成则 £22 且本夜每手 +20 流水，不成赔 £6', risk: 'heart',
    ops: [{ t: 'coin', p: 0.5,
      win: [{ t: 'money', n: 22 }, { t: 'score', e: { chips: 20 }, scope: 'night' }],
      lose: [{ t: 'money', n: -6 }] }],
  },
  {
    id: 'duel', name: '决斗', kicker: '他们要你先出一手',
    blurb: '下一手倍注 ×3；本夜出牌次数 −1', risk: 'head',
    ops: [{ t: 'score', e: { xmult: 3 }, scope: 'hand' },
      { t: 'rule', m: { hands: -1 }, scope: 'night' }],
  },
  {
    id: 'pawnbroker', name: '当铺', kicker: '先换钱，牌留在柜子里',
    blurb: '永久移除至多 2 张带强化或火漆的牌，每张折 £9', risk: 'hand',
    cond: [{ t: 'hasMarked', n: 1 }],
    ops: [{ t: 'purge', what: 'enhanced', n: 2, per: 9 }],
  },
  {
    id: 'opera-box', name: '歌剧院包厢', kicker: '声望换来的座，银钱烧掉的夜',
    blurb: '付 £14；声望 +1', risk: 'head',
    cond: [{ t: 'moneyAtLeast', n: 14 }],
    ops: [{ t: 'money', n: -14 }, { t: 'rep', n: 1 }],
  },
  {
    id: 'pickpocket', name: '扒手', kicker: '摸走的是你的筹码，留下的是别人的信',
    blurb: '赔 £10，换一封随机引荐信', risk: 'heart',
    cond: [{ t: 'moneyAtLeast', n: 10 }],
    ops: [{ t: 'money', n: -10 }, { t: 'grantLetter' }],
  },
  {
    id: 'bishop', name: '主教来访', kicker: '他祝福牌桌，讨厌牌上的花样',
    blurb: '整副牌的强化与火漆全部洗净；本夜每手 +25 流水', risk: 'head',
    once: true, minNight: 3, cond: [{ t: 'hasMarked', n: 1 }],
    ops: [{ t: 'strip', where: 'deck', n: 999 },
      { t: 'score', e: { chips: 25 }, scope: 'night' }],
  },
  {
    id: 'post-chaise', name: '驿车上的信', kicker: '寄信人已经在另一张牌桌上了',
    blurb: '立刻 £6；一张黑桃 Q 带「押账」火漆进牌堆', risk: 'hand',
    cond: [{ t: 'deckRoom' }],
    ops: [{ t: 'money', n: 6 }, { t: 'addCard', cards: [{ rank: 12, suit: 's', seal: 'blue' }] }],
  },
  {
    id: 'wager-seat', name: '棋手的赌约', kicker: '他不要钱，要你的一张座位',
    blurb: '随机请走一位客人；整局贵客槽位 +1', risk: 'head',
    once: true, minNight: 4, cond: [{ t: 'seatsAtLeast', n: 2 }],
    ops: [{ t: 'seat', what: 'leave', refund: 0 }, { t: 'rule', m: { slots: 1 }, scope: 'run' }],
  },
  {
    id: 'hearth-fire', name: '壁炉里的火', kicker: '烧掉什么，这一夜就暖和一点',
    blurb: '永久移除至多 3 张带火漆的牌，每张折 £3', risk: 'hand',
    cond: [{ t: 'hasMarked', n: 1 }],
    ops: [{ t: 'purge', what: 'sealed', n: 3, per: 3 }],
  },
  {
    id: 'leech-jar', name: '水蛭罐', kicker: '放一点血，换一夜清醒',
    blurb: '付 £8；本夜手牌上限 +2', risk: 'hand',
    cond: [{ t: 'moneyAtLeast', n: 8 }],
    ops: [{ t: 'money', n: -8 }, { t: 'rule', m: { handSize: 2 }, scope: 'night' }],
  },
  {
    id: 'back-stair', name: '后门的名录', kicker: '一位不该进来的客人自己进来了',
    blurb: '花 £20 请进一位稀客（钱不够就不请）', risk: 'head', minNight: 3,
    cond: [{ t: 'seatsRoom' }, { t: 'moneyAtLeast', n: 20 }],
    ops: [{ t: 'grantSeat', rarity: 'uncommon', price: 20 }],
  },
  {
    id: 'friend-deck', name: '亡友的牌堆', kicker: '他留了三张牌，和一句没说完的话',
    blurb: '三张 K 进牌堆，其中两张带「赏金」火漆', risk: 'hand', once: true, minNight: 2,
    cond: [{ t: 'deckRoom' }],
    ops: [{ t: 'addCard', cards: [
      { rank: 13, suit: 'h', seal: 'gold' }, { rank: 13, suit: 'd', seal: 'gold' },
      { rank: 13, suit: 'c' }] }],
  },
  {
    id: 'lottery', name: '彩票', kicker: '两镑一张，头奖总在别人家',
    blurb: '十次里成一次：成则 £60，不成就当那两镑扔了', risk: 'heart',
    cond: [{ t: 'moneyAtLeast', n: 2 }],
    ops: [{ t: 'coin', p: 0.1, win: [{ t: 'money', n: 60 }], lose: [{ t: 'money', n: -2 }] }],
  },
  {
    id: 'midnight-bell', name: '子夜钟', kicker: '过了子夜，规矩反着走',
    blurb: '本夜出牌 +1、弃牌 −1', risk: 'head',
    ops: [{ t: 'rule', m: { hands: 1, discards: -1 }, scope: 'night' }],
  },
  {
    id: 'wax-station', name: '火漆台', kicker: '他给牌盖章，不问用途',
    blurb: '随机 3 张手牌各落一道随机火漆', risk: 'heart',
    ops: [{ t: 'mark', what: 'seal', value: 'random', where: 'hand', n: 3 }],
  },
  {
    id: 'late-patron', name: '迟到的贵客', kicker: '他一坐下就把彩头抬高了',
    blurb: '下一手倍注 ×2；本夜彩头抬高 12%', risk: 'head', minNight: 3,
    ops: [{ t: 'score', e: { xmult: 2 }, scope: 'hand' },
      { t: 'rule', m: { targetScale: 1.12 }, scope: 'night' }],
  },
  {
    id: 'wake', name: '丧假', kicker: '牌局停一晚，钱倒是留住了',
    blurb: '立刻 £25；本夜出牌与弃牌各 −1', risk: 'hand',
    ops: [{ t: 'money', n: 25 }, { t: 'rule', m: { hands: -1, discards: -1 }, scope: 'night' }],
  },
  {
    id: 'silver-tongue', name: '说客', kicker: '他替你说，你替他欠',
    blurb: '付 £20；声望 +2', risk: 'head', minNight: 4,
    cond: [{ t: 'moneyAtLeast', n: 20 }],
    ops: [{ t: 'money', n: -20 }, { t: 'rep', n: 2 }],
  },
  {
    id: 'terrier', name: '梗犬', kicker: '它叼走一张牌，谁也没看清是哪张',
    blurb: '永久移除 1 张随机牌；本夜每手 +15 流水', risk: 'heart',
    ops: [{ t: 'purge', what: 'random', n: 1, per: 0 },
      { t: 'score', e: { chips: 15 }, scope: 'night' }],
  },
  {
    id: 'glass-case', name: '展示柜', kicker: '柜里那张牌谁都想要，谁都碰不得',
    blurb: '立刻 £15；一张红心 2 变成金票进牌堆', risk: 'head',
    cond: [{ t: 'deckRoom' }],
    ops: [{ t: 'money', n: 15 }, { t: 'addCard', cards: [{ rank: 2, suit: 'h', enh: 'gold' }] }],
  },
  {
    id: 'kidnap', name: '绑票', kicker: '他们要的不是你的钱，是你桌上的人',
    blurb: '五五开：成则 £40，不成随机一位客人被带走', risk: 'heart',
    once: true, minNight: 5, cond: [{ t: 'seatsAtLeast', n: 1 }],
    ops: [{ t: 'coin', p: 0.5,
      win: [{ t: 'money', n: 40 }],
      lose: [{ t: 'seat', what: 'leave', refund: 0 }] }],
  },
  {
    id: 'assay-office', name: '化验所', kicker: '他们把金子挑出来，别的都刮掉',
    blurb: '洗掉手上所有牌的强化与火漆', risk: 'hand',
    cond: [{ t: 'hasMarked', n: 1 }],
    ops: [{ t: 'strip', where: 'hand', n: 999 }],
  },
  {
    id: 'trembling-dealer', name: '发牌的手抖', kicker: '同一张牌发了两次，没人反对',
    blurb: '复制一张手上的牌放进牌堆', risk: 'hand', minNight: 2,
    cond: [{ t: 'deckRoom' }],
    ops: [{ t: 'copyHand', n: 1 }],
  },
  {
    id: 'fencing', name: '击剑课', kicker: '练一晚上，明天手上更有数',
    blurb: '本夜弃牌 +2；本夜彩头抬高 8%', risk: 'head',
    ops: [{ t: 'rule', m: { discards: 2, targetScale: 1.08 }, scope: 'night' }],
  },
  {
    id: 'forgery', name: '伪造的签名', kicker: '看不出来，出了事才看得出来',
    blurb: '十次里成四次：成则 £35，不成赔 £15；无论成不成，声望都 −1',
    risk: 'heart', minNight: 3,
    ops: [{ t: 'rep', n: -1 },
      { t: 'coin', p: 0.4, win: [{ t: 'money', n: 35 }], lose: [{ t: 'money', n: -15 }] }],
  },
  {
    id: 'honour', name: '一场体面的让步', kicker: '你把彩头让回去，他们记住你的名字',
    blurb: '本夜彩头 −12%；声望 +1', risk: 'hand', minNight: 4,
    ops: [{ t: 'rule', m: { targetScale: 0.88 }, scope: 'night' }, { t: 'rep', n: 1 }],
  },
  {
    id: 'cellar', name: '地窖的私藏', kicker: '酒还在，账主已经不在了',
    blurb: '付 £6；本夜每手倍注 +8', risk: 'hand',
    cond: [{ t: 'moneyAtLeast', n: 6 }],
    ops: [{ t: 'money', n: -6 }, { t: 'score', e: { mult: 8 }, scope: 'night' }],
  },
];

/** 已知 id 集合：存档与自检拿它验"档里不许出现没听说过的事件"。 */
EVENTS.push(
  { id:'visiting-card',name:'来客的名片',kicker:'一张带家纹的黑桃 K，留给你的牌局。',blurb:'付 £3，获得一张黑桃 K「会客牌」进入牌组。',risk:'head',once:true,cond:[{t:'moneyAtLeast',n:3},{t:'deckRoom'}],ops:[{t:'money',n:-3},{t:'addCard',cards:[{rank:13,suit:'s',special:'crest'}]}] },
  { id:'banknote',name:'旧账房的票据',kicker:'存得住钱，票据就替你撑住流水。',blurb:'付 £2，获得一张方片 8「账票牌」进入牌组。',risk:'head',once:true,cond:[{t:'moneyAtLeast',n:2},{t:'deckRoom'}],ops:[{t:'money',n:-2},{t:'addCard',cards:[{rank:8,suit:'d',special:'ledger'}]}] },
  { id:'embers',name:'壁炉里的余烬',kicker:'牌递到手中，越到后面越亮。',blurb:'获得一张红心 7「余烬牌」直接入手，本夜彩头 ×1.1。手满时原来最右一张进弃牌堆。',risk:'head',once:true,cond:[{t:'deckRoom'}],ops:[{t:'rule',m:{targetScale:1.1},scope:'night'},{t:'addCard',to:'hand',cards:[{rank:7,suit:'h',special:'ember'}]}] },
  { id:'looking-glass',name:'镜匠的礼物',kicker:'凑出同点数时，镜子才显出另一面。',blurb:'付 £3，获得一张梅花 Q「镜面牌」直接入手。手满时原来最右一张进弃牌堆。',risk:'head',once:true,cond:[{t:'moneyAtLeast',n:3},{t:'deckRoom'}],ops:[{t:'money',n:-3},{t:'addCard',to:'hand',cards:[{rank:12,suit:'c',special:'mirror'}]}] },
  { id:'captains-keepsake',name:'船长的压舱物',kicker:'留下余地，下一手才有分量。',blurb:'付 £2，获得一张黑桃 A「压舱牌」进入牌组。',risk:'hand',once:true,cond:[{t:'moneyAtLeast',n:2},{t:'deckRoom'}],ops:[{t:'money',n:-2},{t:'addCard',cards:[{rank:14,suit:'s',special:'anchor'}]}] },
  { id:'comet-letter',name:'彗星来信',kicker:'把最后一拍交给这张新牌。',blurb:'获得一张红心 10「彗尾牌」直接入手，本夜少 1 次弃牌。手满时原来最右一张进弃牌堆。',risk:'head',once:true,cond:[{t:'deckRoom'}],ops:[{t:'rule',m:{discards:-1},scope:'night'},{t:'addCard',to:'hand',cards:[{rank:10,suit:'h',special:'comet'}]}] },
);
export const EVENT_IDS = new Set(EVENTS.map((e) => e.id));

export const eventById = (id: string): EventDef | undefined =>
  EVENTS.find((e) => e.id === id);

/** 这条事件现在递不递得出来：夜次、整局是否已用过、前置读数 */
export function canFire(e: EventDef, f: EventFacts, fired: string[]): boolean {
  if (e.minNight && f.night < e.minNight) return false;
  if (e.once && fired.includes(e.id)) return false;
  for (const c of e.cond ?? []) {
    if (c.t === 'seatsAtLeast' && f.seats < c.n) return false;
    if (c.t === 'seatsRoom' && f.seats >= f.seatCap) return false;
    if (c.t === 'moneyAtLeast' && f.money < c.n) return false;
    if (c.t === 'discardAtLeast' && f.discardCount < c.n) return false;
    if (c.t === 'deckRoom' && f.totalCards >= f.deckCap) return false;
    if (c.t === 'hasMarked' && f.marked < c.n) return false;
  }
  return true;
}

/** 派生流：与 draft 那条错开，起点也不与主流相同（salt 见上） */
export const deriveEventRand = (seed: number, night: number, firedCount: number): Rand =>
  new Rand((((seed >>> 0) ^ EVENT_SALT) + night * 7919 + firedCount * 104729) >>> 0);

/** 短 id 的折叠值，只用来给派生流换起点，不当哈希用 */
const idFold = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
};

/** 抽牌礼那条派生流：扣过来摆成一排的候选与次序。叠上事件 id 是因为取消一次再点另一条时，牌不该原地不动摆在同一格 */
export const deriveFanRand = (seed: number, night: number, eventId: string): Rand =>
  new Rand((((seed >>> 0) ^ FAN_SALT) + night * 7919 + idFold(eventId)) >>> 0);

/**
 * 抽 EVENT_OFFER 个互不重复的候选。只吃派生流，一根毫毛都不动主随机流。
 * 池子不足 3 条时全给——宁可两张可选，也不硬凑重复的假选择。
 */
export function drawEvents(pool: EventDef[], seed: number, night: number, firedCount: number): EventDef[] {
  if (pool.length <= EVENT_OFFER) return pool.slice();
  const r = deriveEventRand(seed, night, firedCount);
  const left = pool.slice();
  const out: EventDef[] = [];
  for (let i = 0; i < EVENT_OFFER && left.length; i++) {
    out.push(left.splice(r.int(left.length), 1)[0]);
  }
  return out;
}

/**
 * 「让牌局自决」选哪一条：管家按"稳吃 → 靠脑子 → 吃运气"挑，同档取候选里排前面的那条。
 * 规则不摇骰，是为了让它**可断言**：同一批候选必须永远选出同一条。
 */
const AUTO_ORDER: Temperament[] = ['hand', 'head', 'heart'];

export function autoPick(cands: EventDef[]): EventDef | null {
  if (!cands.length) return null;
  for (const r of AUTO_ORDER) {
    const hit = cands.find((c) => c.risk === r);
    if (hit) return hit;
  }
  return cands[0];
}

export const scopeName = (s: EventScope): string =>
  s === 'hand' ? '下一手' : s === 'night' ? '本夜' : '整局';

/** 脾气词的另一种读法（界面角标用，与 draft.ts 的 temperamentName 同一套话） */
export const riskName = (t: Temperament): string =>
  t === 'head' ? '靠脑子' : t === 'hand' ? '稳吃' : '吃运气';

/**
 * 卡片上的分类角标。只从 ops 推导，不另存字段——存两处就会漂两处。
 * 顺带它也是"这条事件有没有真内容"的最小吃检查（返回空数组的卡片不该存在）。
 */
export function eventTags(e: EventDef): string[] {
  const out: string[] = [];
  const push = (s: string): void => { if (!out.includes(s)) out.push(s); };
  const walk = (ops: EventOp[]): void => {
    for (const op of ops) {
      if (op.t === 'money' || op.t === 'rep') push('银钱');
      else if (op.t === 'rule') push('规矩');
      else if (op.t === 'score') push('计分');
      else if (op.t === 'addCard') { push('牌组'); if(op.cards.some(c=>c.special))push('稀奇牌');if(op.to==='hand')push('入手'); }
      else if (op.t === 'copyHand' || op.t === 'mark' || op.t === 'strip'
        || op.t === 'purge' || op.t === 'returnDiscard' || op.t === 'mulligan') push('牌组');
      else if (op.t === 'seat' || op.t === 'grantSeat') push('客人');
      else if (op.t === 'grantLetter' || op.t === 'bookUp') push('货单');
      else if (op.t === 'coin') { push('运气'); walk(op.win); walk(op.lose); }
    }
  };
  walk(e.ops);
  return out;
}
