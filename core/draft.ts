// 开局选一位"签名宾"：抽五个候选，玩家挑一个入席开局。
//
// 决策点（硬约束 3 的答案）：这一局的整条构筑路线由开局这一选定调——
// 选「靠脑子的」就得全程围着它的条件打，选「吃运气的」等于把一部分分数交给骰子。
// 这是**开局一次、影响整局**的决定，不是每手多一次点击。
//
// 随机流单独开一条（deriveRand），理由写在下面：
// 候选池必须"同一种子给出同一批人"，但又**绝不能挤动主随机流**——
// 主流程一旦多消耗一次，发牌、铺子、玻璃碎裂全都往后挪一位，
// 老存档快进到的步数就落到别的牌上了（AGENTS.md 里那条复现性承诺会破）。
import type { PatronDef, Temperament } from './effects.ts';
import { RARITY_MIN_REP, RARITY_WEIGHT, PATRONS } from './content.ts';
import { Rand } from './rng.ts';
import { DEFAULT_NIGHTS } from './lengths.ts';

export const OFFER_SIZE = 5;

// 与主流错开的常数。改动它等于换一批候选，不影响已开局的老档（它们记着选中的 id）
const DRAFT_SALT = 0x51ee7;

/** 开局够不够格进候选池：声望门槛按常客/稀客/贵客/传说分档 */
export function draftPool(rep: number, owned: string[] = []): PatronDef[] {
  return PATRONS.filter((p) => !owned.includes(p.id) && RARITY_MIN_REP[p.rarity] <= rep);
}

// 局长对候选的偏置。**6..9 夜一律 1**：八夜是参照档，那一档的候选必须与现在逐位相同
// （引导关钉的种子也走这条路）。短局多给"今晚就能兑现"的，长局多给"要时间长大"的。
const SHORT = { growth: 0.45, legendary: 0.55, xmult: 0.7, chips: 1.3, mult: 1.2, hand: 1.3 };
const LONG = { growth: 1.8, legendary: 1.4, xmult: 1.5, chips: 0.8, mult: 0.85, hand: 0.75 };

/** 这位客人在这一档长度下的权重倍数（数据，不摇骰） */
export function lengthWeight(p: PatronDef, nights: number): number {
  if (nights >= 6 && nights <= 9) return 1;
  const t = nights <= 5 ? SHORT : LONG;
  let w = 1;
  if (p.growth) w *= t.growth;
  if (p.rarity === 'legendary') w *= t.legendary;
  if (p.kind === 'xmult') w *= t.xmult;
  if (p.kind === 'chips') w *= t.chips;
  if (p.kind === 'mult') w *= t.mult;
  if (p.temperament === 'hand') w *= t.hand;
  return w;
}

/**
 * 抽 OFFER_SIZE 个互不重复的候选。
 * 按稀有度权重取（和铺子同一套权重），所以"开局就抽到传说"是稀事而不是没有。
 * 池子不足 5 位时全给，不硬凑重复。
 *
 * 之后再过一道 ensureMix：光按权重抽会让候选清一色是"靠脑子的"
 * （实测 400 批里 head 出现 1381 次、heart 只有 262 次），
 * 那样"选一位"就退化成"在五张条件牌里挑一张"，路线差别没了。
 * 所以这里保证：只要池子里有，稳吃与吃运气各至少给一位。
 * 仍然只用同一条派生流，所以给定 (seed, rerolls) 结果照样唯一。
 */
export function drawOffer(seed: number, rep = 0, rerolls = 0, nights = DEFAULT_NIGHTS): PatronDef[] {
  const pool = draftPool(rep);
  if (pool.length <= OFFER_SIZE) return pool.slice();
  const rand = deriveRand(seed, rerolls);
  const picked = weightedDraw(pool, OFFER_SIZE, rand, nights);
  return ensureMix(picked, pool, rand);
}

/** 不放回的加权抽取。权重全同一档时等价于均匀抽 */
function weightedDraw(pool: PatronDef[], n: number, rand: Rand, nights = DEFAULT_NIGHTS): PatronDef[] {
  const left = pool.slice();
  const out: PatronDef[] = [];
  // 局长只改权重，不改抽法：同一 (seed, rerolls, nights) 永远同一批人
  const w = (p: PatronDef): number => RARITY_WEIGHT[p.rarity] * lengthWeight(p, nights);
  for (let i = 0; i < n && left.length; i++) {
    const total = left.reduce((a, p) => a + w(p), 0);
    let x = rand.next() * total;
    let hit = left.length - 1;
    for (let j = 0; j < left.length; j++) {
      x -= w(left[j]);
      if (x <= 0) { hit = j; break; }
    }
    out.push(left[hit]);
    left.splice(hit, 1);
  }
  return out;
}

const MUST_HAVE: Temperament[] = ['hand', 'heart'];

/**
 * 缺哪种脾气就从该脾气里补一位，补的位置换掉**重复脾气里最后抽到的那个**，
 * 这样 head 那类不会因为权重大而把五个位置全占掉。
 */
function ensureMix(picked: PatronDef[], pool: PatronDef[], rand: Rand): PatronDef[] {
  const out = picked.slice();
  for (const t of MUST_HAVE) {
    if (out.some((p) => p.temperament === t)) continue;
    const want = pool.filter((p) => p.temperament === t && !out.includes(p));
    if (!want.length) continue;                 // 池子里本来就没有，不硬造
    // 找一个"同脾气已经不止一个"的位置让出来；找不到就换掉最后一个非该脾气的
    const count: Record<string, number> = {};
    for (const p of out) count[p.temperament] = (count[p.temperament] ?? 0) + 1;
    const victim = out.map((p, i) => ({ p, i }))
      .filter((x) => x.p.temperament !== t && (count[x.p.temperament] ?? 0) > 1)
      .pop()
      ?? out.map((p, i) => ({ p, i })).filter((x) => x.p.temperament !== t).pop();
    if (!victim) continue;
    out[victim.i] = want[rand.int(want.length)];
  }
  return out;
}

/**
 * 派生一条**独立**随机流。seed 与 rerolls 决定一切，所以：
 * 同一 seed + 同一重掷次数 ⇒ 同一批候选，可复现、可断言。
 */
export function deriveRand(seed: number, rerolls: number): Rand {
  // 乘一个奇数再异或，避免 rerolls=0 时与主流同起点
  return new Rand(((seed >>> 0) ^ DRAFT_SALT) + rerolls * 7919);
}

/** 重掷次数 +1 ⇒ 换一批候选。不消耗主随机流 */
export const nextRerolls = (n: number): number => n + 1;

/** 这位在候选里怎么标一句：脾气 + 机制一句话 */
export function offerLine(p: PatronDef): string {
  return `${p.name}｜${temperamentName(p.temperament)}｜${p.blurb}`;
}

export const temperamentName = (t: Temperament): string =>
  t === 'head' ? '靠脑子' : t === 'hand' ? '稳吃' : '吃运气';

/** 候选里有没有覆盖到三种脾气——选单至少要给得出不同打法，否则"选一个"是假选择 */
export function temperamentsOf(list: PatronDef[]): Set<Temperament> {
  return new Set(list.map((p) => p.temperament));
}
