// 功能开关。**关掉就必须等于这个功能不存在**——不是"读取了但不生效"，
// 而是新字段一次都不被碰。这样老代码路径、老存档、老种子才不受新功能影响。
//
// 为什么放在 core：内核不许碰 DOM，而开关是玩法决定（这一局到底有没有这套规则），
// 不是界面决定。存档里要带上这份快照（save.ts），否则同一局跨开关版本会读出
// "一半生效"的怪账。
export interface FeatureFlags {
  /** P0-3 回合阈值奖励 */
  thresholds: boolean;
  /** P0-1 加注：数据表档位与三档失败惩罚 */
  bets: boolean;
  /** P0-2 座位换序与邻接共鸣 */
  adjacency: boolean;
  /** P1-1 tag 套装 */
  sets: boolean;
  /** P1-2 成长型客人 */
  growth: boolean;
  /** P1-3 牌的材质/效果两层（关掉仍走原 enh/seal 两个 enum） */
  layers: boolean;
  /** P1-4 弃牌堆可查看与捞回 */
  discardOps: boolean;
  /** 开局选签名宾：抽五位候选，玩家挑一位入席开局 */
  draft: boolean;
  /** 随机事件：每夜递一次三选一，选下去的几条挂着改规矩、计分与牌组 */
  events: boolean;
  /** 经营奇遇：宾客委托与跨夜故事 */
  club: boolean;
}

export const FLAG_KEYS: (keyof FeatureFlags)[] = [
  'thresholds', 'bets', 'adjacency', 'sets', 'growth', 'layers', 'discardOps', 'draft', 'events', 'club',
];

/** 默认全关：新功能不批准进主线就不该影响任何一局 */
export const FLAGS_OFF: FeatureFlags = {
  thresholds: false, bets: false, adjacency: false, sets: false,
  growth: false, layers: false, discardOps: false, draft: false, events: false, club:false,
};

/** 全开：给试玩、模拟器和自检当"实验台"用 */
export const FLAGS_ALL: FeatureFlags = {
  thresholds: true, bets: true, adjacency: true, sets: true,
  growth: true, layers: true, discardOps: true, draft: true, events: true, club:true,
};

export const FLAG_LABEL: Record<keyof FeatureFlags, string> = {
  thresholds: '回合目标',
  bets: '加注',
  adjacency: '邻接共鸣',
  sets: '套装',
  growth: '客人长进',
  layers: '卡牌花样',
  discardOps: '弃牌堆可翻',
  draft: '开局选签名宾',
  events: '随机事件',
  club: '宾客委托与连锁故事',
};

/** 只认白名单里的键，其余丢掉：存档里的 flags 属于外部输入 */
export function sanitizeFlags(raw: unknown, base: FeatureFlags = FLAGS_OFF): FeatureFlags {
  const out: FeatureFlags = { ...base };
  if (typeof raw !== 'object' || raw === null) return out;
  const o = raw as Record<string, unknown>;
  for (const k of FLAG_KEYS) if (typeof o[k] === 'boolean') out[k] = o[k];
  return out;
}
