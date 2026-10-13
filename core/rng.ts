// 随机数：种子化的确定性 PRNG。
// 整局只用这一条流，任何一次抽取都可被 (seed, 步数) 复现——
// 自检和 '--shot' 抓图要靠它，所以内核里绝不允许出现 Math.random()。

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rand {
  private r: () => number;
  public calls = 0;

  constructor(seed: number) {
    this.r = mulberry32(seed);
  }

  next(): number {
    this.calls += 1;
    return this.r();
  }

  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }

  // Fisher–Yates：就地打乱，返回同一个数组便于链式
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  // 概率判定，但走同一条流——玻璃牌碎裂这类"运气"也要能复现
  chance(p: number): boolean {
    return this.next() < p;
  }
}
