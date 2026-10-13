// 新手引导：把"这牌局怎么运转"从标题页那段静态文字，变成**玩家正好站在那一步时**说的一句话。
//
// 三条设计约束（都是这个项目已有的尺子，不是新发明的）：
// 1. **一行可解释**。每条 body 一句话说完一件事，说不完就是这条还没想清楚。
// 2. **纯投影**。这一步说什么由 `stepFor(facts, seen)` 算，输入全是已经有的状态；
//    引导**不参与任何玩法计算**——所以"看不看教程，牌局一模一样"是有判据的，不是口头保证。
// 3. **可跳过、不拦人**。气泡永远在提示位，不吃点击；玩家不看它也能一路打完。
//
// 进度记在 `state.tutorial`（已 dismissed 的 id）里跟着存档走：
// 读档回到中途，不该把已经讲过的那条再弹一遍。

export type Anchor = 'scoreline' | 'tray' | 'patrons' | 'gauges' | 'shop' | 'raise';
// 注：'shop' 指的是**面板里的货位区**，不是顶栏那颗「铺子」按钮——
// 面板展开时按钮被压在下面，指着它的气泡也会一起被盖住（实测截图里就是看不见）。
/** 这一条什么时候该出现。全部取自局面上已经有的数，不额外记状态 */
export type When = 'boot' | 'beforePlay' | 'afterPlay' | 'afterClear' | 'inShop' | 'beforeBoss';
/** 玩家自己做到哪一步就算过去了（不点"知道了"也会走） */
export type Done = 'played' | 'cleared' | 'shop' | 'never';

export interface Step {
  id: string;
  when: When;
  anchor: Anchor;
  title: string;
  body: string;
  done: Done;
}

export interface Facts {
  started: boolean;
  played: number;
  cleared: number;
  inShop: boolean;
  bossNext: boolean;
}

/**
 * 顺序即优先级：第一条"该说且还没说"的就上桌，一次只说一件事。
 * 七条走完，玩家已经经历过：看分数线 → 选牌出牌 → 客人逐个结算 →
 * 盈余折现 → 铺子四件事 → 抬注这条本项目独有的规矩 → 头人夜的刁难。
 */
export const STEPS: Step[] = [
  {
    id: 'goal', when: 'boot', anchor: 'scoreline', done: 'never',
    title: '这一场的线',
    body: '彩头就是分数线：流水 × 倍注 做出它就算过。下面那条水位是进度。',
  },
  {
    id: 'play', when: 'beforePlay', anchor: 'tray', done: 'played',
    title: '出牌与弃牌',
    body: '选 1–5 张组成牌型，点「出 牌」打出（空格同）；「弃 牌」不判牌型，只把牌甩回牌堆。',
  },
  {
    id: 'patrons', when: 'afterPlay', anchor: 'patrons', done: 'never',
    title: '客人是逐个开口的',
    body: '从左到右一位一位触发，每次脉冲之后读数才动。这一手的账在拆解里逐行写着。',
  },
  {
    id: 'economy', when: 'afterClear', anchor: 'gauges', done: 'shop',
    title: '盈余会折成银钱',
    body: '超出彩头的部分按比例折现。银钱请座上宾，每位客人都改写你的算法。',
  },
  {
    id: 'shop', when: 'inShop', anchor: 'shop', done: 'never',
    title: '铺子里四件事',
    body: '请客人、买引荐信与牌谱、抬注、重掷货架。座位极少，收谁逐谁都是取舍。',
  },
  {
    id: 'raise', when: 'inShop', anchor: 'raise', done: 'never',
    title: '抬注：原版没有的规矩',
    body: '不花银钱，只押风险。下一场彩头逐档 ×1.5，赏金、盈余折现与声望同步加厚，失手有罚。',
  },
  {
    id: 'boss', when: 'beforeBoss', anchor: 'scoreline', done: 'never',
    title: '头人夜会改规矩',
    body: '贵客各有刁难（压手牌、锁花色、弃牌抽税…），进场前那一幕与账本都写着他怎么刁难你。',
  },
];

/** 认得的步骤 id 集合：存档清洗与穷举核对都拿它当白名单 */
export const STEP_IDS = new Set<string>(STEPS.map((x) => x.id));

export const stepById = (id: string): Step | null => STEPS.find((s) => s.id === id) ?? null;

/** 这条现在该不该说 */
function fires(s: Step, f: Facts): boolean {
  switch (s.when) {
    case 'boot': return f.started;
    // 出过牌之后这条该闭嘴，由 done:'played' 一处管；这里再写一遍 f.played === 0
    // 就是死条件（satisfied 已经先拦掉了），而多写的那半句会让注入测不出东西
    case 'beforePlay': return f.started;
    case 'afterPlay': return f.played >= 1;
    case 'afterClear': return f.cleared >= 1;
    case 'inShop': return f.inShop;
    case 'beforeBoss': return f.bossNext;
  }
}

/** 玩家做到对应动作后，那条自己走掉（不逼他点按钮） */
export function satisfied(s: Step, f: Facts): boolean {
  if (s.done === 'played') return f.played >= 1;
  if (s.done === 'cleared') return f.cleared >= 1;
  if (s.done === 'shop') return f.inShop || f.cleared >= 2;
  return false;
}

/** 当前该说的那一条；没有就返回 null（气泡收起） */
export function stepFor(f: Facts, seen: string[]): Step | null {
  for (const s of STEPS) {
    if (seen.includes(s.id) || !fires(s, f) || satisfied(s, f)) continue;
    return s;
  }
  return null;
}

/**
 * 记下"这一条讲过了"。id 为 null 表示整段跳过：把剩下的全部记掉，
 * 这样"全部跳过"真的是一次决定，而不是把这一条藏起来、下一夜又冒出来。
 * 纯函数 + 去重：界面层不许自己 push，否则重复 id 会一路攒进存档。
 */
export function markSeen(seen: string[], id: string | null): string[] {
  const add = id === null ? STEPS.map((x) => x.id) : [id];
  return [...new Set([...seen, ...add].filter((x) => STEP_IDS.has(x)))];
}

/** 讲完/跳过之后还剩下几条没讲——设置面板那行用它报告进度 */
export const remaining = (seen: string[]): number => STEPS.length - seen.length;

/** 全部走完（或被跳过）的判据 */
export const finished = (seen: string[]): boolean => seen.length >= STEPS.length;
