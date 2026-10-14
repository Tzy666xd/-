// 引导关：第一课就是**一局真牌局**，不是幻灯片。
//
// 和 tutorial.ts 的分工很清楚：那边是"路过你旁边提醒一句"，这边是
// "站住，这一步做给我看，我再讲下一步"。两套用同一套锚点名，同一套气泡壳。
//
// 三条约束全部沿用这个项目已有的尺子：
// 1. **纯投影**。某一课该不该出现、算不算过，全由 `Lesson.open/done` 读已经算好的状态得出，
//    玩法一律不读 `state.guide`。所以"上不上课，牌局逐位相同"是有判据的，不是口头保证。
// 2. **一行可解释**。每节 body 一句话说完一件事，说不完就是这节课还没想清楚。
// 3. **不拦人**。课程不锁任何按钮，也不替你出牌——你没做这一步它就不往下走，
//    想做别的随时做；顶部常驻「退出引导」，一步就能回到普通牌桌。
//
// 窗口设计（`open`）是这门课不会卡死的关键：一节课只在"还讲得通"的那段局面里出现，
// 窗口一关就自动翻页。比如玩家一把就打穿了第 1 场，那"先弃两张"这节课直接跳过，
// 而不是等他下一场去弃牌——反正下一场要讲的是别的。

import { limits, preview, targetOf, bossOf } from './game.ts';
import type { Diff, GameState, Mode } from './game.ts';
import type { FeatureFlags } from './flags.ts';
import { MIN_NIGHTS } from './lengths.ts';
import { letterById } from './content.ts';
import { HANDS } from './hands.ts';

export type GuideAnchor =
  | 'scoreline' | 'tray' | 'patrons' | 'gauges' | 'shop' | 'raise' | 'center'
  | 'readout' | 'satchel';

/** 这一课要玩家亲手做到的那件事；'read' 表示只需看完点「知道了」 */
export type Req =
  | 'read' | 'discard' | 'pick' | 'play' | 'hire' | 'raise' | 'cascade' | 'buyItem';

export interface Lesson {
  id: string;
  req: Req;
  /** 气泡钉在哪个部件上；'center' 是牌桌正中的结业卡 */
  anchor: GuideAnchor;
  title: string;
  /** 静态正文：dyn 不在时用（自检也拿它当"这节课想清楚了吗"的那一句） */
  body: string;
  /** 有它就用它：把**此刻屏幕上的真数字**讲进正文里（第一次玩的人要的是"我这手到底几分"） */
  dyn?: (f: Facts) => string;
  /** 屏幕上那句"现在做这个"——动词开头，只说一个动作 */
  todo: string;
  /** 这段局面里讲得通吗（窗口） */
  open: (f: Facts) => boolean;
  /** 玩家做到了吗（只有 req !== 'read' 的课有） */
  done?: (f: Facts) => boolean;
}

/** 全部取自局面上已有的数：界面负责数，内核不负责记 */
export interface Facts {
  started: boolean;
  /** 手里选了几张 */
  chosen: number;
  /** 选牌预览报出的牌型名；没凑成型是 null */
  kind: string | null;
  /** 这一手此刻的基础流水与倍注（引导要说"30 × 2"，不是"看下面"） */
  kindChips: number;
  kindMult: number;
  /** **本场**打出去几手（换场会归零，所以复用同一条判据的课各自成立） */
  played: number;
  /** 这一局累计弃过几次牌 */
  discards: number;
  /** 已经结清几场 */
  cleared: number;
  inShop: boolean;
  seats: number;
  /** 抬注档位（下一场生效的那个数） */
  raised: number;
  /** 第几夜 / 这一局共几夜 / 这一夜第几场（0 便宴 1 正宴 2 贵客局） */
  night: number;
  nights: number;
  stage: number;
  /** 这一场要做出的彩头 */
  target: number;
  /** 已经由玩法内核入账的本场分数，剩余目标必须扣除它。 */
  score: number;
  gap: number;
  /** 这一场的头人（贵客局才有） */
  boss: string;
  bossWhy: string;
  /** 随身：几件、上限几格、货架上那件叫什么、多少钱 */
  consumables: number;
  slots: number;
  shopItem: string;
  shopItemPrice: number;
  money: number;
}

const HIGH = '高牌';
/** 货架上那格小东西叫什么（引荐信按名字报，牌谱按牌型报） */
const itemName = (t: string, id: string): string =>
  t === 'letter' ? letterById(id).name : `${HANDS[id].name} 牌谱`;

/**
 * 牌桌上看得见的部分：全部从 state 现算，一个字段都不另记。
 * `started`（玩家是否已经上桌）是界面才有的概念，所以由调用方补——
 * 界面与 tools/guide-check.mjs 共用这一份推导，两边不会各算一套然后飘走。
 */
export const stateFacts = (s: GameState): Omit<Facts, 'started'> => {
  const lim = limits(s);
  const p = preview(s);
  const slot = s.shop.find((x) => x.kind === 'consumable' && !x.sold);
  const b = bossOf(s);
  return {
    chosen: s.chosen.length,
    kind: p?.name ?? null,
    kindChips: p?.chips ?? 0,
    kindMult: p?.mult ?? 0,
    played: Math.max(0, lim.hands - s.handsLeft),
    discards: s.discardsUsed,
    cleared: s.ledger.length,
    inShop: s.status === 'shop',
    seats: s.seats.length,
    raised: s.raiseNext,
    night: s.night,
    nights: s.nights,
    stage: s.stage,
    target: targetOf(s),
    score: s.score,
    gap: Math.max(0, targetOf(s) - s.score),
    boss: b?.name ?? '',
    bossWhy: b?.blurb ?? '',
    consumables: s.consumables.length,
    slots: lim.slots,
    shopItem: slot ? itemName(slot.item!.t, slot.item!.id) : '',
    shopItemPrice: slot?.price ?? 0,
    money: s.money,
  };
};

export const guideFacts = (s: GameState, started: boolean): Facts =>
  ({ started, ...stateFacts(s) });
/** 还在第 1 场、还没进铺子——牌桌边那几节课的窗口 */
const firstStage = (f: Facts): boolean => f.started && f.cleared === 0 && !f.inShop;

/**
 * 顺序即课程表。十四节课走完，第一次玩的人已经知道：
 * 一场要做多少分 → 怎么凑牌型 → 怎么换牌 → 打出去那一眼账怎么读 →
 * 次数用完会散场 → 铺子里四件事 → 请客人与买应急的 → 随身物怎么用 →
 * 抬注押的是什么 → 客人逐个触发 → 头人怎么刁难 → 账本在哪 → 随时能退出续上。
 *
 * 窗口设计（`open`）是这门课不会卡死的关键：一节课只在"还讲得通"的那段局面里出现，
 * 窗口一关就自动翻页。玩家一把打穿第 1 场，"先弃两张"那节直接跳过而不是逼他
 * 去下一场找牌弃——反正下一场要讲的是别的。
 */
export const LESSONS: Lesson[] = [
  {
    id: 'board', req: 'read', anchor: 'scoreline',
    title: '这一场要做出多少分',
    body: '彩头线就是分数线：选牌打出「流水 × 倍注」，做出那个数就算过这一场。',
    dyn: (f) => `这一场要做 ${f.target} 分：选牌打出「流水 × 倍注」，漫过它就算过。`
      + `下面那条水位是你的进度，头顶写着「第 ${f.night} / ${f.nights} 夜」——一夜三场。`,
    todo: '看清头顶那条线和水位，点「知道了」',
    open: firstStage,
  },
  {
    id: 'tray', req: 'pick', anchor: 'tray',
    title: '先凑一个真牌型',
    body: '一次最多选 5 张；两张同点数是对子，五张连续点数是顺子，五张同花色是同花。牌谱用来升级牌型。',
    dyn: (f) => (f.kind && f.kind !== HIGH
      ? `现在这手是「${f.kind}」：${f.kindChips} 流水 × ${f.kindMult} 倍注，先记下这两个数。`
      : '一次最多选 5 张。先找两张同点数的牌凑对子；五张连续点数是顺子，五张同花色是同花。牌型靠牌谱升级。'),
    todo: '选两张同点数的牌，看牌桌报出「对子」',
    open: firstStage,
    done: (f) => f.chosen >= 2 && f.kind !== null && f.kind !== HIGH,
  },
  {
    id: 'swap', req: 'discard', anchor: 'tray',
    title: '不要的牌先换掉',
    body: '选中几张再点「弃 牌」（或按 X）：弃牌不判牌型，只把它们甩回牌堆、立刻补回同等数量。',
    dyn: (f) => `选中几张点「弃 牌」（或按 X）：不判牌型，甩回牌堆再补回同等数量。`
      + `每场弃牌有次数（右下角写着），用完就只剩出牌。`,
    todo: '选 2 张不用的牌，点「弃 牌」弃掉',
    open: firstStage,
    done: (f) => f.discards >= 1,
  },
  {
    id: 'cash', req: 'play', anchor: 'readout',
    title: '打出去，看这一手的账',
    body: '点「出 牌」：牌逐张加流水、客人逐位加倍注，拆解那一列一行行写着每一笔是谁给的。',
    todo: '保持选好的牌型，点「出 牌」出牌',
    open: firstStage,
    done: (f) => f.played >= 1,
  },
  {
    id: 'stage', req: 'read', anchor: 'scoreline',
    title: '一场要打好几手，用完次数就失手',
    body: '每手的分数累加。出牌用完还没过线就失手；开局有一次免费重做，用光才散场。过线后领取赏金、利息和盈余折现。',
    dyn: (f) => `已经做出 ${f.score} / ${f.target} 分，还差 ${f.gap} 分。每手分数累加，弃牌只换牌。`
      + '出牌用完还没过线就失手；开局有一次免费重做，用光才散场。过线后领取赏金、利息和盈余折现。',
    todo: '接着凑牌型接着打，直到水位漫过头顶那条线',
    open: (f) => f.started && !f.inShop,
    // 一把就打穿的那一手不需要这节课：它和上一节同时满足，自动翻页
    done: (f) => f.cleared >= 1,
  },
  {
    id: 'shop', req: 'read', anchor: 'shop',
    title: '货架上四件事',
    body: '两位客人、一件应急的小东西、一项会员特权，最后那颗是重掷货架——每一样都在改你后面的数。',
    dyn: (f) => `这里摆着：两位客人、一件「${f.shopItem || '应急的小东西'}」、一项会员特权，`
      + `外加重掷货架。你身上有 £${f.money}，座位极少，请谁逐谁都是取舍。`,
    todo: '认一认这四样，然后点「知道了」',
    open: (f) => f.inShop,
  },
  {
    id: 'hire', req: 'hire', anchor: 'shop',
    title: '请第一位客人入座',
    body: '客人不加分，客人改算法：点他脚下那张价签就把他请上座。',
    todo: '在铺子里请一位客人（点他那格的价签）',
    open: (f) => f.inShop,
    done: (f) => f.seats >= 1,
  },
  {
    id: 'satchel', req: 'buyItem', anchor: 'satchel',
    title: '顺手买一件应急的',
    body: '货架上那件小东西买了就进左边那格「随身」，用完占的格子会还回来。',
    dyn: (f) => `那件「${f.shopItem}」£${f.shopItemPrice}，买了它进左边那格随身`
      + `（现在 ${f.consumables} / ${f.slots} 格）。下一节课教你用它。`,
    todo: '买下货架上那件小东西',
    // 买不起、或者格子满了就不讲这一节：不许留一节玩家做不成的课
    open: (f) => f.inShop && f.shopItemPrice > 0 && f.consumables < f.slots
      && f.money >= f.shopItemPrice,
    done: (f) => f.consumables >= 1,
  },
  {
    id: 'raise', req: 'raise', anchor: 'raise',
    title: '抬注：原版没有的规矩',
    body: '抬注不花银钱，只押风险：下一场彩头逐档 ×1.5，赏金、盈余折现与声望同步加厚，失手有罚。',
    todo: '把「抬注」拨到 +1 档',
    open: (f) => f.inShop,
    done: (f) => f.raised >= 1,
  },
  {
    id: 'letter', req: 'read', anchor: 'satchel',
    title: '随身那件怎么用',
    body: '点它一下，它要几张牌就按字面要：选够数它才生效。应急换牌、给牌上花样都在这格里。',
    dyn: (f) => `左边那格现在放着「${f.shopItem || '你买的那件'}」：点它一下，`
      + `它要几张牌就按字面要，选够数才生效。想试就点，不试也不拦着。`,
    todo: '看清左边那格，点「知道了」（想试就点它一下）',
    open: (f) => !f.inShop && f.consumables >= 1 && f.started,
  },
  {
    id: 'pulse', req: 'cascade', anchor: 'patrons',
    title: '客人是逐个开口的',
    body: '带着新请的客人再打一手：他们从左到右一位一位触发，每位说完话读数才动一次。',
    todo: '选几张牌，点「出 牌」再打一手',
    open: (f) => f.cleared >= 1 && f.seats >= 1 && !f.inShop,
    done: (f) => f.played >= 1,
  },
  {
    id: 'boss', req: 'read', anchor: 'scoreline',
    title: '贵客局：这一场的头人会改规矩',
    body: '每一夜的第三场来一位头人，进场前那一幕与账本都写着他怎么刁难你。',
    dyn: (f) => (f.boss
      ? `这一场的头人是「${f.boss}」——${f.bossWhy}。这一场 ${f.target} 分，`
        + `顶栏「账本」里也写着他的规矩。`
      : `每一夜的第三场来一位头人改规矩。顶栏「账本」里写着他怎么刁难你。`),
    todo: '看清这一场的头人，再决定怎么打',
    open: (f) => f.started && !f.inShop && f.stage === 2,
  },
  {
    id: 'ledger', req: 'read', anchor: 'center',
    title: '账本与图鉴是给你复查用的',
    body: '顶栏「账本」记着每一场的流水、银钱与客人；「图鉴」写着每种牌型的等级与基础分。',
    todo: '有空点顶栏「账本」翻一页，看完关掉就接着打',
    // 要等**贵客局到了**才讲账本与往后：第 1 夜的贵客局是第 3 场，结清两场时正好站在它门口
    //（cleared>=2）。排在它前面的课都关了窗才轮到这条，所以它不会抢在头人之前开口。
    open: (f) => f.cleared >= 2 && f.seats >= 1 && !f.inShop,
  },
  {
    id: 'done', req: 'read', anchor: 'center',
    title: '课上完了，剩下的自己打',
    body: '往后每一夜三场：便宴、正宴、贵客局。打满你选的轮数就散场，中途随时关窗，回来点「继续上一局」接着打。',
    dyn: (f) => `往后每一夜三场（便宴、正宴、贵客局），这一局共 ${f.nights} 夜。`
      + `中途随时关窗口都不丢——牌局自动存档，回来点「继续上一局」接着打。`,
    todo: '点「知道了」，这一局接着打',
    // 与「账本」同一扇窗（都在贵客局门口）：结业课不许抢在头人之前发，
    // 那等于在玩家还不知道第三场会来什么人时就说「剩下的自己打」
    open: (f) => f.cleared >= 2 && f.seats >= 1 && !f.inShop,
  },
];

export const LESSON_IDS = new Set<string>(LESSONS.map((x) => x.id));

/** 标记位：`state.guide` 里有它才是一局课。普通局这个数组是空的，界面一行代码都不会走 */
export const MARKER = 'on';

export const inGuide = (seen: string[]): boolean => seen.includes(MARKER);

export const lessonById = (id: string): Lesson | null => LESSONS.find((x) => x.id === id) ?? null;

/** 这一课现在算不算过（read 课永远没算过，等玩家点掉） */
export const satisfied = (l: Lesson, f: Facts): boolean => l.done?.(f) === true;

/**
 * 当前该上哪一课：按课程表找第一节"开着窗、还没做到、又没被点掉"的。
 * 没有就返回 null——气泡收起，玩家自己打，不会有任何东西拦着。
 */
export function lessonFor(f: Facts, seen: string[]): Lesson | null {
  for (const l of LESSONS) {
    if (seen.includes(l.id) || !l.open(f) || satisfied(l, f)) continue;
    return l;
  }
  return null;
}

/** 第几课（1 起）：进度条那行用它，全部从当前课推导，不另记状态 */
export const position = (id: string | null): number => {
  const i = LESSONS.findIndex((x) => x.id === id);
  return i < 0 ? LESSONS.length : i + 1;
};

/**
 * 记下"这一课已经点掉了"。id 为 null 表示整门课退出：把十节全记掉，
 * 于是退出引导是真退出，下一场不会又冒出来。
 * 纯函数 + 去重 + 白名单：界面层不许自己 push，MARKER 也不会被这条挤掉。
 */
export function markLesson(seen: string[], id: string | null): string[] {
  const add = id === null ? LESSONS.map((x) => x.id) : [id];
  const kept = [...new Set([...seen, ...add])].filter((x) => x === MARKER || LESSON_IDS.has(x));
  return kept;
}

/** 还有几节课没点掉——设置面板那行用它报告进度 */
export const remaining = (seen: string[]): number =>
  LESSONS.length - seen.filter((x) => x !== MARKER).length;

/** 十节课全部走完（或被退出）的判据 */
export const finished = (seen: string[]): boolean => remaining(seen) === 0;

/**
 * 这局课的开局配置：固定种子 + 手松档 + 标准牌组 + **最短的三夜**。
 *
 * 锁死种子是因为这门课**讲的就是这一副牌**：第 1 场第一手必须打不穿彩头线，
 * 否则"先换牌、再凑型"两节课没有窗口；结清后铺子里必须有请得起的客人，
 * 否则第 6 节课卡住。这个数不是随手挑的，由 tools/guide-check.mjs 实测钉住——
 * 改内核任何影响发牌顺序的东西，那条脚本会红。
 *
 * 局长锁最短档（2026-10-12 他定的：引导关轮数少一些）：十节课最迟在第 2 夜就全翻完，
 * 后面的夜数只是让他在没学会之前先输一轮。第一夜的彩头线不分局长都是 300，
 * 所以第 1 节课讲的那条线照旧。
 */
export const GUIDE = {
  seed: 20261011, deckId: 'standard', diff: 'gentle' as Diff, mode: 'run' as Mode,
  nights: MIN_NIGHTS,
};

/**
 * 教学局一律不带随机事件。两个理由都是硬的：
 * 1. 这门课要证的判据是"上课的局与不上课的局牌序、流水、随机数步数逐位相同"，
 *    再叠一层三选一就多出一条讲不清的分支；
 * 2. 事件会改限额与牌组，钉住的那颗种子就不再是第 9 节里演的那副牌了。
 * 界面开局时过一道这里，规则本身留在内核，自检才钉得住。
 */
export const guideFlags = (f: FeatureFlags): FeatureFlags => ({ ...f, events: false });

/** 开一局课：把标记位钉进 state。玩法不读它，界面只读它 */
export const beginGuide = (s: GameState): void => { s.guide = [MARKER]; };

/** 退出引导：十节全记掉。留着标记位是因为存档要靠它认"这是一局课" */
export const quitGuide = (s: GameState): void => { s.guide = markLesson(s.guide, null); };
