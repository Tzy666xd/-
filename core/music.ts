// 背景乐。与音效同一条纪律：**不挂任何音频素材**，曲子是数据，声音是现场合成的。
//
// 拆成两层是故意的：
//   这一层是纯函数 plan()，把"第 N 个八分音符该响哪些声部"算成事件流；
//   界面层只是投影仪（和 ADR-0002 那条承重墙一样），所以音高、时值、循环长度、
//   加了多少层声部都能在 node 里逐条断言，不需要有人戴着耳朵去听有没有卡住。
//
// 曲子写成"级数"而不是绝对音高：mel 每小节一段字符串，一个字符 = 一个八分音符，
// '0'-'9' 是音阶级数（0 为主音），'.' 是休止。转调与移调只要改 tonic/scale。
//
// 声部从三个加到五个（旋律／低音／铺底 ＋ 分解和弦 arp ＋ 刷鼓 perc），
// 并让"局势"（heat）决定加不加层：最后一次牌权或头人夜时音乐自己变紧，
// 玩家不用看读数也知道"这手不能失手"——这是听觉版的正反馈。

export type Voice = 'mel' | 'bass' | 'chord' | 'arp' | 'perc';
/** 每首曲子自己的音色：八音盒／弦乐／簧风琴／竖琴。八首共用一把琴就会听成一首。
 *  词表同时是运行时的：拼错一个值会静默落回八音盒，只有查表才查得出来。 */
export const TIMBRES = ['box', 'strings', 'reed', 'harp'] as const;
export type Timbre = typeof TIMBRES[number];

export interface NoteEvent {
  /** perc 声部里这个数当"打击乐编号"用：36 低音鼓 / 38 刷鼓 / 42 踩镲 */
  midi: number;
  at: number;        // 相对本次 plan 起点的秒数
  dur: number;
  gain: number;
  voice: Voice;
}

export interface Tune {
  id: string;
  name: string;
  short: string;     // 设置面板上那颗按钮的字（两三个字，八首并排才放得下）
  blurb: string;
  scene: string;     // settings 里那一行的小注：这首适合什么时候放
  bpm: number;
  beats: number;     // 每小节几拍
  tonic: number;     // 主音的 MIDI 音号
  scale: number[];   // 音阶的半音偏移
  roots: string;     // 每小节一个字符：低音根音级数
  mel: string[];     // 每小节一段，长度须等于 beats*2
  timbre: Timbre;
  perc?: string[];   // 每小节一段，字符：K 低音鼓 / S 刷鼓 / h 踩镲 / . 空
}

export const MINOR = [0, 2, 3, 5, 7, 8, 10];
export const MAJOR = [0, 2, 4, 5, 7, 9, 11];

/** 级数 → MIDI：越过音阶的部分按八度叠上去（负数也成立） */
export function degreeToMidi(t: Tune, deg: number, octave = 0): number {
  const n = t.scale.length;
  const wrapped = ((deg % n) + n) % n;
  const oct = Math.floor(deg / n) + octave;
  return t.tonic + oct * 12 + t.scale[wrapped];
}

/** 一个八分音符的时长（秒） */
export const stepDur = (t: Tune): number => 60 / t.bpm / 2;

/** 一整圈有多少个八分音符 */
export const loopSteps = (t: Tune): number => t.beats * 2 * t.mel.length;

/** 一整圈多少秒——用来挡"这首曲子循环一次比一局还长"的谱面 */
export const loopSeconds = (t: Tune): number => loopSteps(t) * stepDur(t);

/** 低音八度：比主旋律低两个八度，和弦低一个八度，免得糊成一团 */
const BASS_OCT = -2;
const CHORD_OCT = -1;
const ARP_OCT = 0;
/** 谱面上的鼓点字母 → 打击乐编号（与 voice() 的分支一一对应） */
export const DRUM: Record<string, number> = { K: 36, S: 38, h: 42 };

/**
 * 排出从第 from 步起的 count 个八分音符。
 * 跨圈是连续的：plan(t, 0, N) 与 plan(t, N, N) 得到同样的音高序列。
 * 每第四圈把主旋律抬一个八度 —— 八小节死循环很容易被听穿，反复时换个声部就还活着。
 *
 * heat（0..2）是"局势"：
 *   1 → 叠一层分解和弦（arp），音乐开始动；
 *   2 → 再给主旋律加一个高八度的影子，刷鼓抬亮。
 * 只在层数与音量上做加法，**不改任何音高序列**，所以同一首曲子开不开 heat 都对得上拍。
 */
export function plan(t: Tune, from: number, count: number, heat = 0): NoteEvent[] {
  const out: NoteEvent[] = [];
  const sd = stepDur(t);
  const per = t.beats * 2;
  const total = loopSteps(t);
  const melOct = Math.floor(from / total) % 4 === 3 ? 1 : 0;
  for (let i = 0; i < count; i++) {
    const step = ((from + i) % total + total) % total;
    const bar = Math.floor(step / per);
    const pos = step % per;
    const at = i * sd;
    const root = Number(t.roots[bar]) || 0;
    // 低音在拍头（每拍的第 1 个八分），和弦填在拍腰，正好是"咚-哒"
    if (pos % 2 === 0) {
      out.push({ midi: degreeToMidi(t, root, BASS_OCT), at, dur: sd * 1.7, gain: .16, voice: 'bass' });
    } else {
      for (const third of [0, 2, 4]) {
        out.push({
          midi: degreeToMidi(t, root + third, CHORD_OCT),
          at, dur: sd * .9, gain: .04, voice: 'chord',
        });
      }
    }
    const p = t.perc?.[bar]?.[pos];
    if (p && DRUM[p] !== undefined) {
      out.push({ midi: DRUM[p], at, dur: sd * .5, gain: p === 'h' ? .02 : .05, voice: 'perc' });
    }
    const ch = t.mel[bar][pos];
    if (ch !== '.' && ch !== undefined) {
      // 连着的同音符合成一个长音，听起来才是句子而不是一串打字机
      let len = 1;
      while (pos + len < per && t.mel[bar][pos + len] === ch) len++;
      const midi = degreeToMidi(t, Number(ch), melOct);
      // 顶到最紧时把旋律让一点给高八度的影子：两层都拉满只会糊成一团，也听不出"多了什么"
      out.push({ midi, at, dur: sd * len * .92, gain: heat >= 2 ? .09 : .12, voice: 'mel' });
      if (heat >= 2) out.push({ midi: midi + 12, at, dur: sd * len * .7, gain: .035, voice: 'mel' });
    }
    if (heat >= 1 && pos % 2 === 1) {
      // 拍腰上滚一遍三和弦：铺底那层本来就响着同样的三个音，这里只是把它们拆开说
      const third = [0, 2, 4][step % 3];
      out.push({
        midi: degreeToMidi(t, root + third, ARP_OCT),
        at, dur: sd * .55, gain: .04, voice: 'arp',
      });
    }
  }
  return out;
}

// ── 八首曲子 ─────────────────────────────────────────────────
// 谱面纪律：每小节 mel 与 perc 的长度必须等于 beats*2（一个字符一个八分音符），
// '0'-'9' 是音阶级数，'.' 是休止；相邻两个相同数字会被 plan() 合成一个长音。
export const TUNES: Tune[] = [
  {
    id: 'waltz', name: '牌局圆舞', short: '圆舞', blurb: 'A 小调三拍子，慢，像有人在隔壁房间练琴',
    scene: '开局', bpm: 92, beats: 3, tonic: 69, scale: MINOR, timbre: 'box',
    roots: '00445340',
    mel: ['4..54.', '3..23.', '2..32.', '1...0.', '0.12..', '4.32..', '3.211.', '0.....'],
    perc: ['K..h.h', 'K..h.h', 'K..h.h', 'K..h.h', 'K..h.h', 'K..h.h', 'K..h.h', 'K..h.h'],
  },
  {
    id: 'hornpipe', name: '炉边号笛', short: '号笛', blurb: 'D 大调二拍子，亮，牌局开了三张桌的时候',
    scene: '牌局正酣', bpm: 116, beats: 2, tonic: 62, scale: MAJOR, timbre: 'reed',
    roots: '00340040',
    mel: ['0245', '7.54', '5420', '2.4.', '0245', '7.75', '6542', '0.00'],
    perc: ['KhSh', 'KhSh', 'KhSh', 'KhSh', 'KhSh', 'KhSh', 'KhSh', 'KhSh'],
  },
  {
    id: 'siciliano', name: '西西里', short: '西西里', blurb: 'G 小调六八拍，很轻，贵客上门那一夜压着放',
    scene: '贵客进门', bpm: 100, beats: 6, tonic: 67, scale: MINOR, timbre: 'harp',
    roots: '0034',
    mel: ['4..3..2..3..', '5..4..33....', '2..3..4..5..', '4..3..2..1..'],
  },
  {
    id: 'march', name: '散场进行曲', short: '进行曲', blurb: 'C 大调四拍子，收尾用，账算清了的时候',
    scene: '本场结清', bpm: 104, beats: 4, tonic: 72, scale: MAJOR, timbre: 'strings',
    roots: '00340040',
    mel: ['0.024.5.', '7.5.420.', '2.4.5.7.', '6.4.2.0.', '0.024.5.', '7.5.754.', '5.4.3.2.', '0.0.00..'],
    perc: ['K.h.S.h.', 'K.h.S.h.', 'K.h.S.h.', 'K.h.S.h.', 'K.h.S.h.', 'K.h.S.h.', 'K.h.S.h.', 'K.h.S.S.'],
  },
  {
    id: 'minuet', name: '厅堂小步舞', short: '小步舞', blurb: 'G 大调三拍子，端庄，客人还没坐满时的待客曲',
    scene: '开局', bpm: 100, beats: 3, tonic: 67, scale: MAJOR, timbre: 'harp',
    roots: '04003400',
    mel: ['4.321.', '2..10.', '0.245.', '4..32.', '6.543.', '5..32.', '1.234.', '0.....'],
  },
  {
    id: 'nocturne', name: '深夜厅堂', short: '夜曲', blurb: 'E 小调四拍子，很慢，第五夜之后只剩炉火',
    scene: '深夜／无尽', bpm: 66, beats: 4, tonic: 64, scale: MINOR, timbre: 'box',
    roots: '05240530',
    mel: ['4...2...', '3...1...', '2....0..', '1...0...', '4...5.6.', '5...3...', '4..32...', '0.......'],
  },
  {
    id: 'ragtime', name: '偏拍拉格', short: '拉格', blurb: 'C 大调四拍子，抢半拍，桌上开始加注的时候',
    scene: '加注', bpm: 132, beats: 4, tonic: 60, scale: MAJOR, timbre: 'reed',
    roots: '03040300',
    mel: ['0.2.4.5.', '7.6.4.2.', '0.2.4.6.', '7.5.4.2.', '4.2.0.2.', '3.1.0.1.', '2.4.5.7.', '0.00..0.'],
    perc: ['KhS.h.S.', 'KhS.h.S.', 'KhS.h.S.', 'KhS.hKS.', 'KhS.h.S.', 'KhS.h.S.', 'KhS.h.S.', 'KhS.h.S.'],
  },
  {
    id: 'chorale', name: '结账众赞', short: '众赞', blurb: 'D 大调四拍子，四个声部齐着走，八夜打满的时候',
    scene: '过关', bpm: 84, beats: 4, tonic: 62, scale: MAJOR, timbre: 'strings',
    roots: '04530400',
    mel: ['4.4.5.6.', '6.5.4.3.', '2.2.3.4.', '4.3.2.1.', '0.2.4.5.', '6.6.7.6.', '5.4.3.2.', '0.0.0...'],
  },
];

export const tuneById = (id: string): Tune | null => TUNES.find((x) => x.id === id) ?? null;
