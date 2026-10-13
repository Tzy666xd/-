// P1-3 牌的强化层级。项目里**本来就有两层**：`Card.enh`（强化）与 `Card.seal`（蜡封）
// 是两个互相正交的单值槽，注释就写着"一张牌可以同时是烫金 + 红蜡封"。
// 所以这里不新造维度，只把那两个写死的 enum 换成两张数据表：
//   maxLayers = 2 由类型保证（各只有一个字段，物理上叠不了第三层），
//   两张表各自可加行，加行不用动结算代码。
//
// 硬约束 2 的落点在 layerRows()：一张牌最多摊出两行，一层一行。
import type { Card, Enh, Seal } from './hands.ts';

export interface LayerDef {
  id: string;                 // 与现有 enum 值一一对应，保证行为不变
  name: string;               // 拆解里那一行的主语
  line: string;               // 一行说明
  chips?: number;             // 固定加流水
  mult?: number;              // 固定加倍注
  xmult?: number;             // 乘倍注
  moneyPerCard?: number;      // 每张计分给银钱
  repeat?: number;            // 这张牌计分的次数（红蜡封的"重诵"）
  breaksOn?: number;          // 计分后碎裂概率（玻璃牌）
  moneyOnSettle?: number;     // 只在结清时按手里剩的张数折现（金票）
}

/** 材质层：原来 enh 那一轴 */
export const MATERIALS: LayerDef[] = [
  { id: 'none',  name: '素牌',   line: '不作额外处理', },
  { id: 'bonus', name: '加成牌', line: '额外 +30 流水', chips: 30 },
  { id: 'mult',  name: '倍注牌', line: '额外 +4 倍注', mult: 4 },
  { id: 'glass', name: '玻璃牌', line: '倍注 ×2，计分后 25% 碎裂', xmult: 2, breaksOn: 0.25 },
  { id: 'gold',  name: '金票', line: '结清时每张手里剩的折 £4', moneyOnSettle: 4 },
];

/** 效果层：原来 seal 那一轴 */
export const SEAL_LAYERS: LayerDef[] = [
  { id: 'none',   name: '无封',   line: '没有火漆' },
  { id: 'red',    name: '火漆·重诵', line: '这张牌计分两次', repeat: 2 },
  { id: 'gold',   name: '火漆·赏金', line: '每计分一次得 £1', moneyPerCard: 1 },
  { id: 'purple', name: '火漆·留书', line: '被弃掉时换一封引荐信' },
  { id: 'blue',   name: '火漆·押账', line: '同组每有一张蓝封，本张 +25 流水' },
];

export const MAX_LAYERS = 2;

export const materialById = (id: Enh): LayerDef =>
  MATERIALS.find((m) => m.id === id) ?? MATERIALS[0];
export const sealById = (id: Seal): LayerDef =>
  SEAL_LAYERS.find((s) => s.id === id) ?? SEAL_LAYERS[0];

/** 这一手牌上实际存在的层数（两张表都算），用来把"最多两层"钉成可断言的数 */
export const layerCount = (c: Card): number =>
  (c.enh === 'none' ? 0 : 1) + (c.seal === 'none' ? 0 : 1);

/**
 * 蓝封"押账"要先看全组再算，所以它是唯一需要上下文的加成。
 * 其余层的数值都从表里取，结算侧不再出现写死的 30 / 4 / 2。
 */
export const BLUE_SEAL_CHIPS_PER = 25;

/** 一层摊成一行。返回空数组表示这层没有可写的内容。 */
export function layerRows(c: Card, blueCount: number, table: LayerDef[] = MATERIALS): { label: string; line: string }[] {
  const rows: { label: string; line: string }[] = [];
  const m = materialById(c.enh);
  if (c.enh !== 'none') rows.push({ label: m.name, line: m.line });
  const sl = sealById(c.seal);
  if (c.seal === 'blue' && blueCount > 1) {
    rows.push({ label: sl.name, line: `本组 ${blueCount} 张蓝封，加 ${blueCount * BLUE_SEAL_CHIPS_PER} 流水` });
  } else if (c.seal !== 'none') {
    rows.push({ label: sl.name, line: sl.line });
  }
  void table;
  return rows;
}

/** 由层定义算出这张牌在"逐张计分"里应得的加成（不含牌型基础分） */
export function layerChips(c: Card, blueCount: number): number {
  const m = materialById(c.enh);
  const sl = sealById(c.seal);
  return (m.chips ?? 0)
    + (c.seal === 'blue' ? (sl.id === 'blue' ? BLUE_SEAL_CHIPS_PER * blueCount : 0) : 0);
}
export function layerMult(c: Card): number {
  return materialById(c.enh).mult ?? 0;
}
export function layerXmult(c: Card): number {
  return materialById(c.enh).xmult ?? 1;
}
export function layerRepeat(c: Card): number {
  const sl = sealById(c.seal);
  return sl.repeat ?? 1;
}
export function layerMoney(c: Card): number {
  return (materialById(c.enh).moneyPerCard ?? 0) + (sealById(c.seal).moneyPerCard ?? 0);
}
export function layerBreaksOn(c: Card): number {
  return materialById(c.enh).breaksOn ?? 0;
}
export const ENH_IDS = MATERIALS.map((m) => m.id);
export const SEAL_IDS = SEAL_LAYERS.map((s) => s.id);
