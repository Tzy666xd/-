// 座上宾的形象：代码画的**剪影肖像**，不挂任何外部素材（项目总纲：全代码画）。
//
// 为什么不是随机噪声拼脸：那会长成"一坨看不出关系的形状"，玩家记不住谁是谁。
// 这里每位客人是一条**手工设定的零件组合**（头形／帽／发／脸／领／手中之物＋底色），
// 摆在一张表上可以逐条 review——和 PATRON_TAGS 一样，美术方向是内容决定。
//
// 画布就是椭圆框自己的比例（96×44 ≈ 卡面 98×46 CSS px），**不做各向异性拉伸**。
// 早期版本按 64×64 正方形画再塞进横椭圆，横着被拉了 2.5 倍：
// 高帽压成一条、圆脸拉成面包，于是"三种帽子的人两两像素差 0.0"。
//
// 剪影法则是"奶油浮雕"：人是一片浅奶油色，底是暗色。所以
// ① 凡与轮廓**重叠**的记号（眉毛、胡子、单片镜圈）必须用**暗色刻线**才看得见，
//    用浅色等于在奶油上画奶油——原来整层脸谱就是这么白画掉的；
// ② 想让人一眼分开，靠的是**探出轮廓之外的体量**（帽檐、发绺、胡须、肩形）
//    和**头本身的长宽高**，不是多一个细节。
import type { PatronDef } from './effects.ts';

// 词表既是类型也是运行时数组：自检要能逐条查"零件拼错没有"，
// 只写 union 类型的话，擦完类型就什么都查不到了。
export const HATS = ['none', 'tophat', 'softcap', 'bonnet', 'veil', 'laurel', 'mobcap', 'tricorn',
  'nightcap', 'biretta', 'hood'] as const;
export const HAIRS = ['bald', 'short', 'bun', 'braid', 'curly', 'long', 'wig'] as const;
export const FACES = ['plain', 'monocle', 'spectacle', 'patch', 'pipe', 'moustache', 'beard', 'lorgnette', 'wink'] as const;
export const COLLARS = ['plain', 'bow', 'ruff', 'shawl', 'military', 'lace', 'hood'] as const;
export const PROPS = ['none', 'ledger', 'dice', 'cards', 'key', 'lantern', 'coin', 'quill', 'scales',
  'bell', 'whip', 'seal', 'crook', 'horn', 'spade', 'abacus', 'purse', 'orbit'] as const;
/** 头形是**最大的一块可区分面积**：同一顶帽子下面，圆脸和长脸是两个不同的人 */
export const HEADS = ['round', 'narrow', 'broad', 'long', 'egg', 'square', 'tilt'] as const;

export type Hat = typeof HATS[number];
export type Hair = typeof HAIRS[number];
export type Face = typeof FACES[number];
export type Collar = typeof COLLARS[number];
export type Prop = typeof PROPS[number];
export type Head = typeof HEADS[number];

export interface Portrait {
  hat: Hat; hair: Hair; head: Head; face: Face; collar: Collar; prop: Prop;
  /** 底色在同脾气色相窗内偏移的度数：把 24 位"靠脑子"的客人彼此再分开 */
  tone: number;
}

/** 每位一条。零件的取舍按 role/blurb 来，让"看见的形状"和"读到的身份"对得上 */
export const PORTRAITS: Record<string, Portrait> = {
  solicitor:{hat:'biretta',hair:'long',head:'narrow',face:'monocle',collar:'ruff',prop:'seal',tone:13},
  archivist:{hat:'mobcap',hair:'braid',head:'egg',face:'spectacle',collar:'shawl',prop:'cards',tone:-15},
  courier:{hat:'softcap',hair:'curly',head:'tilt',face:'moustache',collar:'military',prop:'quill',tone:16},
  sponsor:{hat:'tophat',hair:'long',head:'square',face:'lorgnette',collar:'lace',prop:'purse',tone:-16},
  hobbs:     { hat: 'none',    hair: 'short',  head: 'narrow', face: 'plain',     collar: 'bow',      prop: 'key',     tone: 8 },
  payne:     { hat: 'softcap', hair: 'short',  head: 'broad',  face: 'moustache', collar: 'plain',    prop: 'whip',    tone: -9 },
  countess:  { hat: 'veil',    hair: 'bun',    head: 'egg',    face: 'lorgnette', collar: 'lace',     prop: 'cards',   tone: -14 },
  clerk:     { hat: 'biretta', hair: 'bald',   head: 'square', face: 'spectacle', collar: 'plain',    prop: 'ledger',  tone: 5 },
  turf:      { hat: 'tricorn', hair: 'curly',  head: 'long',   face: 'pipe',      collar: 'shawl',    prop: 'quill',   tone: 15 },
  rent:      { hat: 'tophat',  hair: 'short',  head: 'narrow', face: 'moustache', collar: 'bow',      prop: 'coin',    tone: -5 },
  odd:       { hat: 'softcap', hair: 'short',  head: 'round',  face: 'patch',     collar: 'plain',    prop: 'dice',    tone: 12 },
  almanac:   { hat: 'biretta', hair: 'wig',    head: 'broad',  face: 'spectacle', collar: 'ruff',     prop: 'horn',    tone: -12 },
  heiress:   { hat: 'bonnet',  hair: 'bun',    head: 'round',  face: 'plain',     collar: 'lace',     prop: 'key',     tone: 14 },
  cousin:    { hat: 'nightcap',hair: 'bald',   head: 'square', face: 'wink',      collar: 'ruff',     prop: 'coin',    tone: -8 },
  house:     { hat: 'tophat',  hair: 'curly',  head: 'broad',  face: 'beard',     collar: 'military', prop: 'cards',   tone: 2 },
  baronet:   { hat: 'softcap', hair: 'curly',  head: 'narrow', face: 'pipe',      collar: 'bow',      prop: 'horn',    tone: -16 },
  twins:     { hat: 'none',    hair: 'braid',  head: 'tilt',   face: 'wink',      collar: 'lace',     prop: 'cards',   tone: 10 },
  sharp:     { hat: 'tricorn', hair: 'long',   head: 'egg',    face: 'monocle',   collar: 'shawl',    prop: 'spade',   tone: -2 },
  watchman:  { hat: 'nightcap',hair: 'short',  head: 'round',  face: 'moustache', collar: 'military', prop: 'bell',    tone: 16 },
  abacus:    { hat: 'mobcap',  hair: 'bald',   head: 'long',   face: 'spectacle', collar: 'bow',      prop: 'abacus',  tone: -10 },
  paperer:   { hat: 'mobcap',  hair: 'curly',  head: 'narrow', face: 'plain',     collar: 'plain',    prop: 'seal',    tone: 6 },
  rightseat: { hat: 'tophat',  hair: 'bun',    head: 'broad',  face: 'lorgnette', collar: 'ruff',     prop: 'key',     tone: -6 },
  critic:    { hat: 'biretta', hair: 'curly',  head: 'round',  face: 'monocle',   collar: 'lace',     prop: 'quill',   tone: 13 },
  regular:   { hat: 'softcap', hair: 'bald',   head: 'egg',    face: 'beard',     collar: 'shawl',    prop: 'coin',    tone: -3 },
  sparse:    { hat: 'veil',    hair: 'long',   head: 'long',   face: 'plain',     collar: 'hood',     prop: 'none',    tone: -15 },
  neat:      { hat: 'bonnet',  hair: 'bun',    head: 'square', face: 'spectacle', collar: 'ruff',     prop: 'cards',   tone: 3 },
  broker:    { hat: 'tophat',  hair: 'wig',    head: 'tilt',   face: 'monocle',   collar: 'lace',     prop: 'scales',  tone: -13 },
  richuncle: { hat: 'laurel',  hair: 'bald',   head: 'broad',  face: 'moustache', collar: 'shawl',    prop: 'purse',   tone: 7 },
  devotee:   { hat: 'laurel',  hair: 'long',   head: 'tilt',   face: 'wink',      collar: 'lace',     prop: 'key',     tone: -7 },
  waxman:    { hat: 'mobcap',  hair: 'short',  head: 'tilt',   face: 'pipe',      collar: 'bow',      prop: 'seal',    tone: 11 },
  pairkeeper:{ hat: 'none',    hair: 'curly',  head: 'round',  face: 'spectacle', collar: 'bow',      prop: 'cards',   tone: -11 },
  general:   { hat: 'tricorn', hair: 'bald',   head: 'long',   face: 'beard',     collar: 'military', prop: 'spade',   tone: 4 },
  hostess:   { hat: 'bonnet',  hair: 'curly',  head: 'egg',    face: 'wink',      collar: 'lace',     prop: 'bell',    tone: 1 },
  diceboy:   { hat: 'softcap', hair: 'short',  head: 'narrow', face: 'wink',      collar: 'plain',    prop: 'dice',    tone: -14 },
  oracle:    { hat: 'hood',    hair: 'long',   head: 'round',  face: 'plain',     collar: 'hood',     prop: 'orbit',   tone: 9 },
  smuggler:  { hat: 'tricorn', hair: 'curly',  head: 'broad',  face: 'patch',     collar: 'hood',     prop: 'lantern', tone: 15 },
};

/**
 * 首字母必须互不重复——它是肖像旁边那个刻印，撞了车就等于"两个人共用一张脸"。
 * 这里给撞车的几位换了可区分的双字母刻印；界面取不到这张表时退回 def.monogram。
 */
export const MONOGRAM: Record<string, string> = {
  solicitor:'CT',archivist:'AD',courier:'MP',sponsor:'GS',
  hobbs: 'H', payne: 'PY', countess: 'CO', clerk: 'CL', turf: 'T', rent: 'RE', odd: 'O',
  almanac: 'AL', heiress: 'I', cousin: 'V', house: '♠', baronet: 'B', twins: 'Ⅱ', sharp: '?',
  watchman: 'W', abacus: 'X', paperer: 'F', rightseat: 'RS', critic: 'CR', regular: 'G',
  sparse: 'S', neat: 'N', broker: 'BR', richuncle: 'U', devotee: 'DV', waxman: 'K',
  pairkeeper: 'PK', general: 'J', hostess: 'HO', diceboy: 'D', oracle: 'Z', smuggler: 'M',
};

/** 撞车检查用：返回重复的刻印（正常应为空数组） */
export function duplicateMonograms(): string[] {
  const seen: Record<string, number> = {};
  for (const m of Object.values(MONOGRAM)) seen[m] = (seen[m] ?? 0) + 1;
  return Object.keys(seen).filter((m) => seen[m] > 1);
}

/** 同脾气里彼此撞车的组合（脸形+帽+发+领+物）——量具与自检都盯这个 */
export function duplicatePortraits(defs: PatronDef[]): string[] {
  const key = (p: Portrait): string =>
    `${p.head}|${p.hat}|${p.hair}|${p.face}|${p.collar}|${p.prop}|${p.tone}`;
  const byTemp: Record<string, Record<string, number>> = {};
  for (const d of defs) {
    const p = PORTRAITS[d.id];
    if (!p) continue;
    const t = (byTemp[d.temperament] ??= {});
    t[key(p)] = (t[key(p)] ?? 0) + 1;
  }
  return Object.keys(byTemp).flatMap((t) =>
    Object.keys(byTemp[t]).filter((k) => byTemp[t][k] > 1).map((k) => `${t}:${k}`));
}

export interface Palette { ink: string; cut: string }

/** 罕见度只决定两件事：这片奶油有多暖，以及刻线有多暗 */
export const PALETTE: Record<PatronDef['rarity'], Palette> = {
  common: { ink: '#e8d6ae', cut: 'rgba(30,20,10,.78)' },
  uncommon: { ink: '#eef2f7', cut: 'rgba(18,26,34,.78)' },
  rare: { ink: '#f7e4b4', cut: 'rgba(38,26,6,.8)' },
  legendary: { ink: '#fff0d0', cut: 'rgba(44,30,8,.84)' },
};

/**
 * 脾气决定色相窗口：靠脑子＝冷青、稳吃＝暖褐、吃运气＝酒红。
 * 每一位再在自己的窗口里偏 tone 度——24 位都是冷青时，
 * 青绿／钢青／靛青的差别是整个椭圆都参与的，而零件的差别只有几个像素。
 */
export const FAMILY: Record<PatronDef['temperament'], { h: number; s: number }> = {
  head:  { h: 205, s: 40 },
  hand:  { h: 33,  s: 46 },
  heart: { h: 352, s: 44 },
};

export function portraitGround(temperament: PatronDef['temperament'], id = ''): string {
  const f = FAMILY[temperament] ?? FAMILY.head;
  const p = id ? PORTRAITS[id] : null;
  const tone = p ? p.tone : 0;
  const h = f.h + tone;
  const s = f.s + 8 + Math.round(Math.abs(tone) / 2);
  return `radial-gradient(circle at 50% 26%, hsl(${h} ${s}% 30%), hsl(${h} ${s - 4}% 7%) 76%)`;
}

// ── 肖像绘制（96×44 原生比例；取景见文件头）─────────────────
// 锚点：眼 y=19，嘴 y=26.5，头圈 x 37.5..58.5 / y 8.5..33.5，颈 x 44..52，肩线 y≈30。
const CX = 48;
const CY = 21;

/** 头形＝对同一颗头的缩放/倾斜，帽发脸都跟着走，所以它是"整体块面"的差异 */
const HEAD_XFORM: Record<Head, string> = {
  round:  '',
  narrow: `translate(${CX} ${CY}) scale(.82 1.1) translate(${-CX} ${-CY})`,
  broad:  `translate(${CX} ${CY}) scale(1.2 .88) translate(${-CX} ${-CY})`,
  long:   `translate(${CX} ${CY}) scale(.92 1.22) translate(${-CX} ${-CY})`,
  egg:    `translate(${CX} ${CY}) scale(1.04 1) rotate(-5 ${CX} ${CY + 8}) translate(${-CX} ${-CY})`,
  square: `translate(${CX} ${CY}) scale(1.08 1.04) translate(${-CX} ${-CY})`,
  tilt:   `rotate(-9 ${CX} 34)`,
};

const HAT_SVG: Record<Hat, string> = {
  none: '',
  tophat: '<path d="M40 11.5V2.5h16v9z" fill="currentColor"/><path d="M31 13h34v-2.4H31z" fill="currentColor"/>'
    + '<path d="M33 11h30" stroke="CUT" stroke-width="1.4"/>',
  softcap: '<path d="M33 11q15-11 30 0z" fill="currentColor"/><path d="M30 13.2h36v-2.4H30z" fill="currentColor" opacity=".9"/>'
    + '<path d="M35 9.6q13-6 26 0" stroke="CUT" stroke-width="1.2" fill="none"/>',
  bonnet: '<path d="M34 13q0-10 14-10t14 10z" fill="currentColor"/><circle cx="48" cy="2.6" r="3" fill="currentColor"/>'
    + '<path d="M34 13q14 3.5 28 0" stroke="CUT" stroke-width="1.6" fill="none"/>',
  veil: '<path d="M34 12q14-10 28 0v3q-14 5-28 0z" fill="currentColor" opacity=".55"/>'
    + '<path d="M34 12q14-10 28 0" stroke="CUT" stroke-width="2.4" fill="none"/>'
    + '<path d="M58 13.5q6.5 10 4 19.5h-5.6q3-9.5-.6-17.5z" fill="currentColor" opacity=".45"/>',
  laurel: '<path d="M35 13q13-12 26 0" fill="none" stroke="currentColor" stroke-width="3.4"/>'
    + '<path d="M39 4.5l3 5M57 4.5l-3 5M48 1.6v4.5" stroke="currentColor" stroke-width="2.6"/>',
  mobcap: '<path d="M32 12.5q0-9 16-9t16 9z" fill="currentColor"/><path d="M30 13.6h36" stroke="currentColor" stroke-width="4"/>'
    + '<path d="M36 6.5q6-3 12 0t12 0" stroke="CUT" stroke-width="1.3" fill="none"/>',
  tricorn: '<path d="M24 13q24-13 48 0z" fill="currentColor"/><path d="M24 13l10-9 14 5 14-5 10 9z" fill="currentColor" opacity=".85"/>'
    + '<path d="M28 12.4h40" stroke="CUT" stroke-width="1.4"/>',
  nightcap: '<path d="M35 12.5q11-12 26-4l3 4.5H36z" fill="currentColor"/><circle cx="67" cy="6.5" r="3.4" fill="currentColor"/>'
    + '<path d="M36 12.6h27" stroke="CUT" stroke-width="1.6"/>',
  biretta: '<path d="M34 9h28v4.2H34z" fill="currentColor"/><path d="M48 9V3.4" stroke="currentColor" stroke-width="2.6"/>'
    + '<circle cx="48" cy="2.4" r="2.6" fill="currentColor"/>',
  hood: '<path d="M32 22q0-18 16-18t16 18z" fill="currentColor" opacity=".72"/>'
    + '<path d="M32 22q16-7 32 0" stroke="CUT" stroke-width="2" fill="none"/>',
};

/** 发：只有"探出头圈之外"或"暗色刻线"两种存在形式，贴着头皮的浅色等于没画 */
const HAIR_SVG: Record<Hair, string> = {
  bald: '<path d="M40 11q8-3.5 16 0" stroke="CUT" stroke-width="1.1" fill="none" opacity=".5"/>',
  short: '<path d="M37 14.5q11-5 22 0" stroke="CUT" stroke-width="2.6" fill="none"/>'
    + '<path d="M57.6 14q3 3 2.6 7h-4q.6-4-1-6z" fill="currentColor"/>',
  bun: '<path d="M37 14.5q11-5 22 0" stroke="CUT" stroke-width="2.6" fill="none"/>'
    + '<circle cx="62" cy="12" r="5.2" fill="currentColor"/>',
  braid: '<path d="M37 14.5q11-5 22 0" stroke="CUT" stroke-width="2.6" fill="none"/>'
    + '<path d="M57 17q8 8 4 19" stroke="currentColor" stroke-width="5" fill="none" stroke-linecap="round"/>'
    + '<path d="M59 22q4 2 3 6" stroke="CUT" stroke-width="1.2" fill="none"/>',
  curly: '<circle cx="36" cy="16.5" r="4.6" fill="currentColor"/><circle cx="60" cy="16.5" r="4.6" fill="currentColor"/>'
    + '<circle cx="34" cy="22" r="3.8" fill="currentColor"/><circle cx="62" cy="22" r="3.8" fill="currentColor"/>'
    + '<path d="M38 13.5q10-4 20 0" stroke="CUT" stroke-width="2" fill="none"/>',
  long: '<path d="M38 13q-7 11-5 21h7q-4-11-1-19zM58 13q7 11 5 21h-7q4-11 1-19z" fill="currentColor"/>',
  wig: '<path d="M34 15h5.5v15h-5.5zM56.5 15H62v15h-5.5z" fill="currentColor"/>'
    + '<path d="M36.6 20h1M57.4 20h1M36.6 25h1M57.4 25h1" stroke="CUT" stroke-width="1.6"/>'
    + '<path d="M40 12.5q8-3.5 16 0" stroke="CUT" stroke-width="2.2" fill="none"/>',
};

const FACE_SVG: Record<Face, string> = {
  plain: '',
  monocle: '<circle cx="53" cy="19" r="4.4" fill="none" stroke="CUT" stroke-width="1.8"/>'
    + '<path d="M56 22.5l4 7" stroke="CUT" stroke-width="1.4"/>',
  lorgnette: '<circle cx="52.5" cy="19" r="4" fill="none" stroke="CUT" stroke-width="1.8"/>'
    + '<path d="M55.5 22l13 12" stroke="currentColor" stroke-width="2.2"/>'
    + '<circle cx="69" cy="34.5" r="2" fill="currentColor"/>',
  spectacle: '<circle cx="43" cy="19" r="3.8" fill="none" stroke="CUT" stroke-width="1.7"/>'
    + '<circle cx="53" cy="19" r="3.8" fill="none" stroke="CUT" stroke-width="1.7"/>'
    + '<path d="M46.8 19h2.4M39.2 18l-3-1M56.8 18l3-1" stroke="CUT" stroke-width="1.6"/>',
  patch: '<ellipse cx="43.6" cy="19.4" rx="4.8" ry="4.1" fill="CUT" transform="rotate(-14 43.6 19.4)"/>'
    + '<path d="M38.6 17.6l20-4.2" stroke="CUT" stroke-width="1.7"/>',
  pipe: '<path d="M50 26.5h9" stroke="CUT" stroke-width="1.8"/><path d="M58 23.5h7v6.5h-7z" fill="currentColor"/>'
    + '<path d="M61 22q-1.5-3 1.5-4.5" stroke="currentColor" stroke-width="1.8" fill="none"/>',
  moustache: '<path d="M40.5 26.5q7.5 5.5 15 0-4 4.5-7.5 4.5t-7.5-4.5z" fill="CUT"/>',
  beard: '<path d="M38 23q10 15 20 0 1 13-10 15T37 23z" fill="currentColor"/>'
    + '<path d="M42 27q6 4 12 0" stroke="CUT" stroke-width="1.6" fill="none"/>',
  wink: '<path d="M40.5 19h5" stroke="CUT" stroke-width="2"/><path d="M50 18.5q2.5-3 5 0" stroke="CUT" stroke-width="1.8" fill="none"/>'
    + '<path d="M44 27q4 2.5 8 0" stroke="CUT" stroke-width="1.6" fill="none"/>',
};

/** 领＝肩形。肩线横贯整个椭圆，是画面里最大的一块，所以七种领要有七种轮廓 */
const BUST_SVG: Record<Collar, string> = {
  plain: '<path d="M6 44q4-13 24-15h36q20 2 24 15z" fill="currentColor"/>'
    + '<path d="M30 33q18 5 36 0" stroke="CUT" stroke-width="1.6" fill="none"/>',
  bow: '<path d="M4 44q6-14 26-16h36q20 2 26 16z" fill="currentColor"/>'
    + '<path d="M36 29l12 9 12-9-5 15H41z" fill="CUT" opacity=".55"/>'
    + '<path d="M48 33.5l-7-4v8zM48 33.5l7-4v8z" fill="CUT"/><circle cx="48" cy="34" r="2.4" fill="CUT"/>',
  ruff: '<path d="M8 44q4-12 22-14h32q18 2 22 14z" fill="currentColor"/>'
    + '<path d="M28 30q5 7 10 2t10-1 10 1q-4 11-20 11T28 30z" fill="CUT" opacity=".5"/>'
    + '<path d="M30 31q4 5 9 1t9 0 9 2" stroke="CUT" stroke-width="1.8" fill="none"/>',
  shawl: '<path d="M2 44q8-15 30-17h32q22 2 30 17z" fill="currentColor"/>'
    + '<path d="M30 28l18 14 18-14-7 22H37z" fill="CUT" opacity=".45"/>'
    + '<path d="M34 31l14 11 14-11" stroke="CUT" stroke-width="2" fill="none"/>',
  military: '<path d="M2 44v-9q0-7 15-8h62q15 1 15 8v9z" fill="currentColor"/>'
    + '<path d="M10 30.5h15v5.5H10zM71 30.5h15v5.5H71z" fill="currentColor"/>'
    + '<path d="M40 30h16v9H40z" fill="CUT" opacity=".5"/>'
    + '<path d="M44 33.5h8M44 36.5h8" stroke="currentColor" stroke-width="1.6"/>',
  lace: '<path d="M10 44q6-13 26-16h24q20 3 26 16z" fill="currentColor"/>'
    + '<path d="M42 29h12l4 9-10 11-10-11z" fill="CUT" opacity=".6"/>'
    + '<path d="M44 32h8M43 36h10" stroke="currentColor" stroke-width="1.5"/>',
  hood: '<path d="M2 44q12-22 46-23 34 1 46 23z" fill="currentColor" opacity=".95"/>'
    + '<path d="M22 33q26-9 52 0" stroke="CUT" stroke-width="2.2" fill="none"/>',
};

/** 手中一物：胸口那块暗地上（x 63..85 / y 22..35，椭圆的这一侧还没被裁掉）。
 *  之前它们画在 y 40..55——那几行椭圆只剩中间一小条，等于大半件器物根本不在画面里。 */
const PROP_SVG: Record<Prop, string> = {
  none: '',
  ledger: '<path d="M64 22h17v13H64z" fill="currentColor"/><path d="M67 25.5h11M67 28.5h11M67 31.5h7" stroke="CUT" stroke-width="1.3"/>',
  dice: '<rect x="65" y="22" width="14" height="13.5" rx="2.6" fill="currentColor"/><circle cx="68.6" cy="25.6" r="1.8" fill="CUT"/>'
    + '<circle cx="75.6" cy="32.4" r="1.8" fill="CUT"/><circle cx="72.1" cy="29" r="1.8" fill="CUT"/>',
  cards: '<path d="M62 37l4-15 6 2-4 15z" fill="currentColor"/><path d="M70 38l5-14 6 2-5 14z" fill="currentColor" opacity=".72"/>',
  key: '<circle cx="69" cy="24.5" r="4.8" fill="none" stroke="currentColor" stroke-width="3"/>'
    + '<path d="M71.8 28.2l6.4 8.4M75.4 33.4l3.6-2M77.8 36.6l3.6-2" stroke="currentColor" stroke-width="2.6"/>',
  lantern: '<path d="M66 22h13l1.6 4v9.5h-16V26z" fill="currentColor"/><path d="M72.5 19.5v2.5" stroke="currentColor" stroke-width="2.2"/>'
    + '<path d="M69.4 27h6.6v5.5h-6.6z" fill="#fff" fill-opacity=".62"/>',
  coin: '<circle cx="72" cy="28.5" r="7.6" fill="currentColor"/><circle cx="72" cy="28.5" r="3.9" fill="none" stroke="CUT" stroke-width="1.7"/>',
  abacus: '<rect x="63" y="21.5" width="18.5" height="14" rx="1.8" fill="none" stroke="currentColor" stroke-width="2"/>'
    + '<path d="M63 26.5h18.5M63 31h18.5" stroke="currentColor" stroke-width="1.6"/>'
    + '<circle cx="68" cy="26.5" r="2.1" fill="currentColor"/><circle cx="76.5" cy="31" r="2.1" fill="currentColor"/>',
  purse: '<path d="M66 25.5q7-8 14 0t-7 12-7-12z" fill="currentColor"/><path d="M70 22h6" stroke="currentColor" stroke-width="2.4"/>',
  quill: '<path d="M84 19q-12 3-14 14t2 7q9-4 12-21z" fill="currentColor"/><path d="M72 38q4-8 9-11" stroke="CUT" stroke-width="1.4" fill="none"/>',
  scales: '<path d="M73 20v15M64 23.5h18" stroke="currentColor" stroke-width="2"/>'
    + '<path d="M64 23.5l-3.5 7h7zM82 23.5l-3.5 7h7z" fill="currentColor"/>',
  bell: '<path d="M67 23q6-5 12 0t1 12h-14q-2-7 1-12z" fill="currentColor"/><circle cx="73" cy="37.5" r="2.3" fill="currentColor"/>',
  whip: '<path d="M64 21q15 3 7 10t10 7" stroke="currentColor" stroke-width="3" fill="none"/>',
  seal: '<circle cx="73" cy="28.5" r="7.8" fill="currentColor"/><path d="M69 28.5h8M73 24.5v8" stroke="CUT" stroke-width="2"/>',
  crook: '<path d="M69 37V26q0-7 6-7t6 6" stroke="currentColor" stroke-width="3.4" fill="none"/>',
  horn: '<path d="M63 37q3-15 17-17l-2.5 7q-7 3.5-7 12z" fill="currentColor"/>',
  spade: '<path d="M73 20q9 9 9 13.5t-9 3.5-9-3.5T73 20z" fill="currentColor"/><path d="M70.5 35l2.5 5 2.5-5z" fill="currentColor"/>',
  orbit: '<circle cx="73" cy="27.5" r="4.8" fill="currentColor"/>'
    + '<ellipse cx="73" cy="27.5" rx="9.8" ry="3.5" fill="none" stroke="currentColor" stroke-width="1.9" transform="rotate(-22 73 27.5)"/>',
};

/** 只给自检查表用。剪影法则（见文件头）是"与头圈重叠的记号必须刻暗色"，
 *  这条只能查零件词表——查整张 SVG 会被肩线里本来就有的暗色刻线蒙过去。 */
export const LAYERS = { hat: HAT_SVG, hair: HAIR_SVG, face: FACE_SVG, bust: BUST_SVG, prop: PROP_SVG };

/**
 * 一位客人的肖像 SVG（内联，不引任何外部素材）。
 * viewBox 就是椭圆框的比例，所以零件在屏幕上按 1:1 呈现，不再被拉伸。
 */
export function portraitSvg(
  id: string, rarity: PatronDef['rarity'] = 'common',
): string {
  const p = PORTRAITS[id];
  if (!p) return '';
  const pal = PALETTE[rarity] ?? PALETTE.common;
  const xform = HEAD_XFORM[p.head];
  const head = '<ellipse cx="48" cy="21" rx="10.5" ry="12.5" fill="currentColor"/>'
    + (p.head === 'square' ? '<path d="M37.6 8.5h20.8v13q0 6.5-10.4 6.5T37.6 21.5z" fill="currentColor"/>' : '');
  const upper = `<g${xform ? ` transform="${xform}"` : ''}>`
    + head
    + '<path d="M44 28h8v9h-8z" fill="currentColor"/>'
    + HAIR_SVG[p.hair] + FACE_SVG[p.face] + HAT_SVG[p.hat] + '</g>';
  const art = BUST_SVG[p.collar] + upper + PROP_SVG[p.prop];
  return '<svg viewBox="0 0 96 44" aria-hidden="true" class="pf">'
    + `<g style="color:${pal.ink}">` + art.replaceAll('CUT', pal.cut) + '</g>'
    + '</svg>';
}
