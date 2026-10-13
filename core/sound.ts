// 音效谱面。与 music.ts 同一套纪律：**配方是数据，声音是现场合成的，不挂任何素材**。
//
// 为什么搬到 core：以前"哪一声长什么样"散在界面层的十几个方法里，
// 于是"阈值达成有没有专属音效""连击是不是真的在往上走""三层叠起来会不会削顶"
// 都只能靠戴着耳朵听。搬成表之后这些都能在 node 里逐条断言，
// 界面层退化成投影仪（ADR-0002），只负责把参数交给 WebAudio。
//
// 随机数一律不进这里：壁炉噼啪的"大小不一"用步数查表算出来，
// 这样同一局重放出来的音效序列是确定的，也免得 core 破了"不碰 Math.random"那条规矩。

/** 一声里的一个成分 */
export interface Layer {
  /** tone = 一根振荡器；noise = 一段过滤波的噪声 */
  k: 'tone' | 'noise';
  /** Hz。noise 声部里是滤波中心频率 */
  f: number;
  /** 秒 */
  dur: number;
  gain: number;
  /** 相对这一声起点的延迟（秒） */
  at?: number;
  type?: OscillatorType;
  /** 结束时滑到的频率（Hz），给"下滑/上滑"用 */
  glide?: number;
  /** noise 的谐振 */
  q?: number;
  /** tone 的失谐（音分），两把略微失谐比一把更"活" */
  detune?: number;
  /** 连击抬音高时这一层**不动**：纸面摩擦不该跟着链条一起往上尖 */
  noLift?: boolean;
  filter?: 'bandpass' | 'lowpass' | 'highpass';
}

export type Cue =
  | 'pick' | 'unpick' | 'card' | 'chips' | 'mult' | 'xmult' | 'bonus' | 'shatter' | 'total'
  | 'cash' | 'deal' | 'discard' | 'blocked' | 'seal' | 'fail' | 'clear'
  | 'seat' | 'leave' | 'swap' | 'fish' | 'raise' | 'set' | 'grow' | 'draft' | 'boss' | 'crackle'
  | 'event';

export interface Recipe {
  /** 中文名片段，报错与文档里直接读 */
  name: string;
  layers: Layer[];
  /** 每叠加一层抬多少半音：流水与落牌要"往上走"，不然是同一台打字机在敲 */
  lift?: number;
  /** 抬到第几次就封顶，免得一路尖到刺耳 */
  liftMax?: number;
  /** 按花色给的频率系数（4 个）：同一声"嗒"，黑桃闷、方块亮 */
  tint?: number[];
}

/** 半音 → 频率倍数 */
export const semitone = (n: number): number => Math.pow(2, n / 12);

const A4 = 440;
/** 用 MIDI 音号写音高，读谱面时一眼看得出是哪几个音 */
const hz = (midi: number): number => A4 * Math.pow(2, (midi - 69) / 12);

export const CUES: Record<Cue, Recipe> = {
  pick: {
    name: '选中一张牌',
    layers: [
      { k: 'noise', f: 2600, dur: 0.03, gain: 0.07, q: 1.1 },
      { k: 'tone', f: hz(88), dur: 0.06, gain: 0.035, type: 'triangle' },
    ],
  },
  unpick: {
    name: '放回一张牌',
    layers: [
      { k: 'noise', f: 1700, dur: 0.03, gain: 0.055, q: 1.1 },
      { k: 'tone', f: hz(81), dur: 0.07, gain: 0.03, type: 'triangle', glide: hz(74) },
    ],
  },
  // 牌落桌：木质钝击 + 纸面摩擦。音高随处理次序递增，花色决定亮暗
  card: {
    name: '牌落桌', lift: 1.4, liftMax: 9, tint: [0.86, 1.12, 1.0, 0.94],
    layers: [
      { k: 'noise', f: 1250, dur: 0.07, gain: 0.15, q: 1.4 },
      { k: 'tone', f: 300, dur: 0.1, gain: 0.055, type: 'triangle' },
      { k: 'noise', f: 5200, dur: 0.045, gain: 0.035, q: 0.8, at: 0.012, filter: 'highpass', noLift: true },
    ],
  },
  chips: {
    name: '流水加一档', lift: 1, liftMax: 14,
    layers: [{ k: 'tone', f: 1180, dur: 0.06, gain: 0.032, type: 'square' }],
  },
  mult: {
    name: '倍注加一档', lift: 1, liftMax: 10,
    layers: [
      { k: 'tone', f: hz(72), dur: 0.26, gain: 0.09, type: 'triangle' },
      { k: 'tone', f: hz(79), dur: 0.2, gain: 0.045, type: 'sine', at: 0.02, detune: 5 },
    ],
  },
  xmult: {
    name: '翻倍注', lift: 1, liftMax: 6,
    layers: [
      { k: 'tone', f: hz(43), dur: 0.7, gain: 0.15, type: 'sine', glide: hz(37) },
      { k: 'tone', f: hz(55), dur: 0.5, gain: 0.06, type: 'triangle', detune: -8 },
      { k: 'noise', f: 3200, dur: 0.16, gain: 0.05, q: 0.7, at: 0.005, filter: 'highpass' },
    ],
  },
  // P0-3 阈值达成：三枚往上走的银钱，最后那枚留长尾，像"叮——"的一声
  bonus: {
    name: '阈值达成',
    layers: [
      { k: 'tone', f: hz(84), dur: 0.09, gain: 0.07, type: 'sine' },
      { k: 'tone', f: hz(91), dur: 0.09, gain: 0.07, type: 'sine', at: 0.075 },
      { k: 'tone', f: hz(96), dur: 0.42, gain: 0.075, type: 'sine', at: 0.15 },
      { k: 'noise', f: 6200, dur: 0.1, gain: 0.03, q: 0.6, at: 0.15, filter: 'highpass' },
    ],
  },
  shatter: {
    name: '玻璃碎裂',
    layers: [
      { k: 'noise', f: 4200, dur: 0.05, gain: 0.09, q: 0.6, filter: 'highpass' },
      { k: 'noise', f: 6800, dur: 0.05, gain: 0.06, q: 0.6, at: 0.035, filter: 'highpass' },
      { k: 'noise', f: 3000, dur: 0.16, gain: 0.05, q: 0.9, at: 0.07, filter: 'bandpass' },
    ],
  },
  total: {
    name: '这一手收口',
    layers: [
      { k: 'tone', f: hz(50), dur: 0.34, gain: 0.1, type: 'sine' },
      { k: 'tone', f: hz(57), dur: 0.26, gain: 0.05, type: 'triangle', at: 0.01 },
      { k: 'tone', f: hz(69), dur: 0.2, gain: 0.03, type: 'sine', at: 0.03 },
    ],
  },
  cash: {
    name: '进账',
    layers: [
      { k: 'tone', f: hz(84), dur: 0.1, gain: 0.08, type: 'sine' },
      { k: 'tone', f: hz(91), dur: 0.16, gain: 0.06, type: 'sine', at: 0.07 },
      { k: 'noise', f: 5400, dur: 0.05, gain: 0.03, q: 0.7, at: 0.07, filter: 'highpass' },
    ],
  },
  deal: { name: '发牌', layers: [{ k: 'noise', f: 2100, dur: 0.05, gain: 0.1, q: 1.0 }] },
  discard: {
    name: '弃牌',
    layers: [
      { k: 'noise', f: 1500, dur: 0.13, gain: 0.09, q: 0.7, filter: 'lowpass' },
      { k: 'tone', f: hz(60), dur: 0.16, gain: 0.04, type: 'triangle', glide: hz(48) },
    ],
  },
  blocked: {
    name: '被拦下',
    layers: [
      { k: 'tone', f: 150, dur: 0.16, gain: 0.05, type: 'square' },
      { k: 'noise', f: 420, dur: 0.06, gain: 0.05, q: 2.2, filter: 'lowpass' },
    ],
  },
  seal: {
    name: '落蜡封',
    layers: [
      { k: 'noise', f: 210, dur: 0.16, gain: 0.26, q: 1.2 },
      { k: 'tone', f: 120, dur: 0.5, gain: 0.13, type: 'sine' },
      { k: 'tone', f: hz(96), dur: 0.7, gain: 0.045, type: 'sine', at: 0.07 },
    ],
  },
  fail: {
    name: '这一场失手',
    layers: [
      { k: 'tone', f: hz(67), dur: 0.5, gain: 0.11, type: 'sine', glide: hz(58) },
      { k: 'tone', f: hz(55), dur: 0.8, gain: 0.08, type: 'triangle', at: 0.1 },
    ],
  },
  clear: {
    name: '本场结清',
    layers: [
      { k: 'tone', f: hz(72), dur: 0.14, gain: 0.07, type: 'sine' },
      { k: 'tone', f: hz(76), dur: 0.14, gain: 0.07, type: 'sine', at: 0.11 },
      { k: 'tone', f: hz(79), dur: 0.2, gain: 0.07, type: 'sine', at: 0.22 },
      { k: 'tone', f: hz(60), dur: 0.5, gain: 0.09, type: 'triangle', at: 0.3 },
    ],
  },
  seat: {
    name: '客人入席',
    layers: [
      { k: 'noise', f: 300, dur: 0.12, gain: 0.1, q: 1.6 },
      { k: 'tone', f: hz(52), dur: 0.2, gain: 0.05, type: 'triangle' },
      { k: 'noise', f: 1800, dur: 0.06, gain: 0.04, q: 1.0, at: 0.1 },
    ],
  },
  leave: {
    name: '客人离席',
    layers: [
      { k: 'noise', f: 420, dur: 0.14, gain: 0.08, q: 1.4, filter: 'lowpass' },
      { k: 'tone', f: hz(57), dur: 0.26, gain: 0.05, type: 'triangle', glide: hz(45) },
    ],
  },
  // 换座：两声"咔哒"，第二声比第一声高——听得出是两个人对调，不是同一个人动了一下
  swap: {
    name: '换座',
    layers: [
      { k: 'noise', f: 1900, dur: 0.035, gain: 0.09, q: 1.6 },
      { k: 'noise', f: 2650, dur: 0.035, gain: 0.09, q: 1.6, at: 0.075 },
    ],
  },
  fish: {
    name: '从弃牌堆捞回',
    layers: [
      { k: 'tone', f: hz(50), dur: 0.3, gain: 0.07, type: 'sine', glide: hz(74) },
      { k: 'noise', f: 2400, dur: 0.06, gain: 0.05, q: 1.1, at: 0.26 },
    ],
  },
  // 加注：档位越高整串音越往上，风险要听得见
  raise: { name: '抬注', lift: 2, liftMax: 4, layers: [
    { k: 'tone', f: hz(74), dur: 0.1, gain: 0.06, type: 'square' },
    { k: 'tone', f: hz(81), dur: 0.18, gain: 0.05, type: 'sine', at: 0.08 },
  ] },
  set: {
    name: '凑成一套',
    layers: [
      { k: 'tone', f: hz(64), dur: 0.3, gain: 0.06, type: 'triangle' },
      { k: 'tone', f: hz(71), dur: 0.3, gain: 0.06, type: 'triangle', at: 0.005 },
      { k: 'tone', f: hz(76), dur: 0.36, gain: 0.06, type: 'sine', at: 0.01 },
      { k: 'noise', f: 5200, dur: 0.12, gain: 0.035, q: 0.6, at: 0.05, filter: 'highpass' },
    ],
  },
  // 长进升级：四音琶音，级数越高起点越高（同一句往上搬）
  grow: { name: '客人长进', lift: 1, liftMax: 6, layers: [
    { k: 'tone', f: hz(76), dur: 0.1, gain: 0.055, type: 'sine' },
    { k: 'tone', f: hz(83), dur: 0.1, gain: 0.055, type: 'sine', at: 0.08 },
    { k: 'tone', f: hz(88), dur: 0.26, gain: 0.06, type: 'sine', at: 0.16 },
  ] },
  draft: {
    name: '请定一位签名宾',
    layers: [
      { k: 'noise', f: 260, dur: 0.14, gain: 0.16, q: 1.3 },
      { k: 'tone', f: hz(48), dur: 0.3, gain: 0.07, type: 'triangle' },
      { k: 'noise', f: 3400, dur: 0.08, gain: 0.04, q: 0.8, at: 0.12, filter: 'highpass' },
    ],
  },
  // 头人夜：定音鼓滚奏 + 一记高音刺，进场就该有点不安
  boss: {
    name: '贵客进门',
    layers: [
      { k: 'tone', f: hz(36), dur: 0.9, gain: 0.14, type: 'sine' },
      { k: 'tone', f: hz(36), dur: 0.16, gain: 0.09, type: 'sine', at: 0.16 },
      { k: 'tone', f: hz(36), dur: 0.16, gain: 0.09, type: 'sine', at: 0.32 },
      { k: 'noise', f: 4600, dur: 0.4, gain: 0.04, q: 0.7, at: 0.05, filter: 'highpass' },
    ],
  },
  // 壁炉：步数查表给"大小不一"，不用随机数（见文件头）
  crackle: {
    name: '壁炉噼啪', lift: 0,
    layers: [
      { k: 'noise', f: 900, dur: 0.035, gain: 0.05, q: 1.8 },
      { k: 'noise', f: 2400, dur: 0.02, gain: 0.022, q: 1.2, at: 0.02 },
    ],
  },
  // 事件递入：两声下行的小号当"外头有人敲门"，后面一张纸抖开的沙沙当"念给你听"
  event: {
    name: '事件递入', lift: 0,
    layers: [
      { k: 'tone', f: hz(55), dur: 0.5, gain: 0.12, type: 'triangle' },
      { k: 'tone', f: hz(60), dur: 0.42, gain: 0.075, type: 'triangle', at: 0.09 },
      { k: 'noise', f: 2800, dur: 0.3, gain: 0.05, q: 0.8, at: 0.16, filter: 'highpass' },
    ],
  },
};

export const CUE_NAMES = Object.keys(CUES) as Cue[];

/** 结算事件 → 该响哪一声。放在 core 是为了能断言"每种事件都有音效"。
 *  card / patron 不在这里：那两种是"落桌一声 + 按效果再一声"，走 cueForEffect。 */
export const EVENT_CUE: Record<string, Cue> = {
  hand: 'total', blocked: 'blocked', bonus: 'bonus', shatter: 'shatter', total: 'total',
};
export const EFFECT_EVENTS = ['card', 'patron'];

/** 一条流水效果（加流水/加倍注/翻倍注）落到哪一声 */
export function cueForEffect(addChips: number, addMult: number, xmult: number): Cue {
  if (xmult && xmult !== 1) return 'xmult';
  if (addMult) return 'mult';
  if (addChips) return 'chips';
  return 'blocked';
}

/** 壁炉噼啪的"这一记多大"：查表而不是摇骰子，序列可复现 */
export function crackleSize(step: number): number {
  const TABLE = [0, 1, 0, 2, 1, 0, 2, 1];
  return TABLE[step % TABLE.length];
}

/**
 * 把配方落成具体的一串成分：连击抬升（lift）、花色明暗（tint）都在这里算。
 * 纯函数 ⇒ "第 3 张比第 2 张高""抬到第 10 次封顶"能被逐条断言。
 */
export function voice(cue: Cue, step = 0, tint = 0): Layer[] {
  const r = CUES[cue];
  const lift = (r.lift ?? 0) * Math.min(step, r.liftMax ?? 0);
  const mul = r.tint ? r.tint[Math.max(0, Math.min(3, tint))] : 1;
  // 噼啪的三档大小：0 小、1 中、2 是带火星的爆点（更长、更亮）
  const c = cue === 'crackle' ? crackleSize(step) : 0;
  const scale = c === 0 ? 0.55 : c === 1 ? 1 : 1.5;
  const k = (L: Layer): number => (L.noLift ? 1 : semitone(lift));
  return r.layers.map((L) => ({
    ...L,
    f: k(L) * (L.k === 'noise' ? mul : 1) * L.f,
    glide: L.glide === undefined ? undefined : k(L) * L.glide,
    dur: c === 2 ? L.dur * 2.4 : L.dur,
    gain: L.gain * (cue === 'crackle' ? scale : 1),
  }));
}

/**
 * 同一瞬间最多叠多少增益——超过这个数就一定削顶。
 * 按**时间重叠**算，不是把所有层加起来的总和：`clear` 那四颗音是依次落的，
 * 总和 0.28 但真正同时响的只有 0.09，按总和判会把本来就安全的配方误判成爆音。
 */
export function peakGain(cue: Cue, step = 0, tint = 0): number {
  const ls = voice(cue, step, tint);
  let peak = 0;
  for (const probe of ls) {
    const t = probe.at ?? 0;
    let sum = 0;
    for (const L of ls) {
      const s = L.at ?? 0;
      if (t >= s - 1e-9 && t < s + L.dur) sum += L.gain;
    }
    peak = Math.max(peak, sum);
  }
  return peak;
}
