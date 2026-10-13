// P1-1 套装（tag 构筑）。需求文档在这里立了一条规矩：**套装奖励不许直接乘倍率**，
// 只能给"新类型的收益"——额外座位、免费重掷、缓冲回合之类。
// 这正好把套装和 P0-2 邻接共鸣区分开：
//   邻接共鸣 = 同一条链上的乘法节点（改分数）
//   套装     = 改规矩（限 Mods），分数不直接动
// 两条轴都走 tag，但落点不同，凑在一起才是"围绕 tag 构筑"。
import type { Mods } from './effects.ts';
import type { PatronDef } from './effects.ts';

export interface SetDef {
  id: string;
  tag: string;            // 与 PatronDef.tags 里的字符串对齐
  count: number;          // 要在席几位才算凑齐
  name: string;
  blurb: string;          // 一行说明，进拆解与 UI
  reward: Mods;           // 只允许改规矩的字段，不含 chips/mult/xmult
}

// 10 条可直接跑的配置。tag 取自客人身上真实存在的那几类（见 content/patrons.ts 的 tags 列）
export const SETS: SetDef[] = [
  { id: 's-law',    tag: 'law',    count: 2, name: '律政一门',
    blurb: '两位法律界的人到场：随身多一格', reward: { slots: 1 } },
  { id: 's-law3',   tag: 'law',    count: 3, name: '律政满席',
    blurb: '三位法律界的人到场：每场多一次弃牌', reward: { discards: 1 } },
  { id: 's-trade',  tag: 'trade',  count: 2, name: '同行工会',
    blurb: '两位生意人到场：重掷免一次', reward: { freeRerolls: 1 } },
  { id: 's-trade3', tag: 'trade',  count: 3, name: '行会掌柜',
    blurb: '三位生意人到场：铺子一律九折', reward: { priceScale: 0.9 } },
  { id: 's-blood',  tag: 'blood',  count: 2, name: '同乡之谊',
    blurb: '两位同乡到场：多一个座位', reward: { seats: 1 } },
  { id: 's-court',  tag: 'court',  count: 2, name: '宫廷一脉',
    blurb: '两位与官府沾亲的到场：每场多一次出牌', reward: { hands: 1 } },
  { id: 's-court3', tag: 'court',  count: 3, name: '朝堂满堂',
    blurb: '三位官府中人到场：利息上限 +12', reward: { interestCap: 12 } },
  { id: 's-quill',  tag: 'quill',  count: 2, name: '笔墨之交',
    blurb: '两位执笔的到场：手牌上限 +1', reward: { handSize: 1 } },
  { id: 's-nerd',   tag: 'nerd',   count: 2, name: '同好雅集',
    blurb: '两位癖好古怪的到场：彩头降一成', reward: { targetScale: 0.9 } },
  { id: 's-newmoney', tag: 'newmoney', count: 2, name: '新钱结社',
    blurb: '两位新贵到场：重掷免一次、随身多一格', reward: { freeRerolls: 1, slots: 1 } },
];

export const setById = (id: string): SetDef | null => SETS.find((s) => s.id === id) ?? null;

/** tag 的全集，给界面与自检用 */
export const ALL_TAGS: string[] = [...new Set(SETS.map((s) => s.tag))];

/**
 * 这一桌凑齐了哪些套装。纯函数：给 defs（在座客人的定义）就出结果。
 * 同一 tag 上有多档（2 人 / 3 人）时**全部生效**，所以凑到三人是"再叠一层"，
 * 不是把两人档替换掉——这让"要不要补第三位"成为一个真决定。
 */
export function activeSets(defs: PatronDef[]): SetDef[] {
  const tally: Record<string, number> = {};
  for (const d of defs) for (const t of d.tags ?? []) tally[t] = (tally[t] ?? 0) + 1;
  return SETS.filter((s) => (tally[s.tag] ?? 0) >= s.count);
}

/** 套装给规矩带来的加项（与 Mods 同构，交给 limits() 累加） */
export function setMods(defs: PatronDef[]): Mods {
  const out: Mods = {};
  for (const s of activeSets(defs)) {
    for (const [k, v] of Object.entries(s.reward)) {
      const key = k as keyof Mods;
      if (key === 'priceScale' || key === 'targetScale') {
        (out[key] as number) = (out[key] as number ?? 1) * (v as number);
      } else {
        (out[key] as number) = (out[key] as number ?? 0) + (v as number);
      }
    }
  }
  return out;
}

/** 拆解/账本用的一行 */
export function setLine(s: SetDef): string {
  const parts = Object.entries(s.reward).map(([k, v]) => `${k} ${v > 0 && k !== 'priceScale' && k !== 'targetScale' ? '+' : ''}${v}`);
  return `套装「${s.name}」：${parts.join(' / ')}`;
}
