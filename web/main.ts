// 渲染层：只做投影，不做算术。所有数字一律取自结算事件的 after 快照，
// 所以"演出来的账"不可能和"内核记的账"不一致——这是把动效做复杂而不做错的唯一前提。
import {
  Game, play, discard, settle, limits, targetOf, targetFor, nextTarget, stakeLabel, stakeBlurb, levelOf, preview,
  chosenCards, toggleChosen, buy, reroll, rerollPrice, setRaise, sellSeat, useConsumable,
  continueEndless, seatedCount, mkSeat, STAGE_LABEL, STAGE_KIND,
  eventChoices, chooseEvent, autoResolveEvent, fanOffer,
  DIFFS, MODES, diffById, modeById, dailySeed,
  acceptCommission, skipCommission, claimCommission, chooseStory, storyChapter,
} from './core/game.ts';
import type { Stage, Mode, Diff } from './core/game.ts';
import { eventTags, riskName, eventById } from './core/events.ts';
import type { EventDef } from './core/events.ts';
import { TUNES, tuneById, plan, loopSteps, stepDur } from './core/music.ts';
import { voice } from './core/sound.ts';
import type { Cue, Layer } from './core/sound.ts';
import { markSeen, stepFor, remaining } from './core/tutorial.ts';
import type { Anchor, Facts, Step } from './core/tutorial.ts';
import {
  GUIDE, LESSONS, beginGuide, finished, guideFacts, guideFlags, inGuide, lessonFor, markLesson, position, quitGuide, remaining as lessonsLeft,
} from './core/guide.ts';
import type { Facts as GuideFacts, GuideAnchor, Lesson } from './core/guide.ts';
import type { Tune, NoteEvent } from './core/music.ts';
import type { ScoreEvent, ScoreResult } from './core/scoring.ts';
import type { Card, HandKind, Suit } from './core/hands.ts';
import { HANDS, SUIT_GLYPH, RANK_LABEL, isFace, handBase, SEAL_NAME, SECRET_HANDS } from './core/hands.ts';
import { suitSvg, pipSpots, isPipCard, FACE_ART, ACE_RING, SUIT_ART, SUIT_VIEWBOX, BACK_ART, BACK_VIEWBOX } from './core/pips.ts';
import { patronById, letterById, VOUCHERS, BOOKS, DECKS, PATRONS, deckById, decksFor } from './core/content.ts';
import { HOOK_LABEL, KIND_LABEL, RARITY_LABEL, EDITION_NAME, EDITION_BLURB, EDITION_PREMIUM } from './core/effects.ts';
import type { PatronDef, Edition, Seat } from './core/effects.ts';
import { serialize as dumpSave, deserialize as loadSave, summarize as sumSave, SAVE_KEY } from './core/save.ts';
import { createSaveStore } from './persistence.ts';
import { scoreText } from './score-view.ts';
import { handExample, renderCatalog, renderDeck } from './reference.ts';
import { runReview } from './run-review.ts';
import { renderClub } from './club-view.ts';
import { makeReport } from './core/run-summary.ts';
import type { RunReport } from './core/run-summary.ts';
import { drawReport, nativeShare, loadReport, saveReport, clearReport } from './share-card.ts';
import { SPECIALS, specialById, specialProgress } from './core/special-cards.ts';
import { THRESHOLDS, thresholdValue, nextGap } from './core/thresholds.ts';
import { drawOffer, offerLine, nextRerolls, OFFER_SIZE } from './core/draft.ts';
import { LENGTHS, DEFAULT_NIGHTS, clampNights, lengthOf } from './core/lengths.ts';
import { portraitSvg, portraitGround, MONOGRAM } from './core/portrait.ts';
import type { PatronDef } from './core/effects.ts';
import { TEMPERAMENT_LABEL } from './core/effects.ts';
import { SETS, activeSets, setLine, ALL_TAGS } from './core/sets.ts';
import { growthLabel, growthLevel } from './core/growth.ts';
import { peekDiscard, fishDiscard, reorderSeat, canReorderSeat, FISH_COST, SWAP_COST, totalCards } from './core/game.ts';
import { BETS, betFor, betLine, penaltyName } from './core/bets.ts';
import { materialById, sealById, layerRows, MAX_LAYERS } from './core/layers.ts';
import { FLAG_KEYS, FLAG_LABEL, FLAGS_OFF, sanitizeFlags } from './core/flags.ts';
import type { FeatureFlags } from './core/flags.ts';

/** 设置页那一行的说明。写"这个功能让玩家多做了什么决定"，不写实现细节 */
const FEATURE_BLURB: Record<keyof FeatureFlags, string> = {
  club:'宾客委托与连锁故事：每夜选一份目标，让经营选择在之后的夜晚收到回信',
  thresholds: '回合目标：水位条上多几条线，决定这手是冲线拿奖励还是留强牌',
  bets: '加注：把抬注的档位与失手的罚则交给数据表，不再只有一档"输整场"',
  adjacency: '邻接共鸣：在铺子里用左右箭头换座，每次 £2，让同类客人相邻',
  sets: '套装：凑齐同一 tag 的几位客人换一条规矩（多一个座位/多一次重掷）',
  growth: '客人长进：同一位客人用多了会升一档，但有上限',
  layers: '卡牌花样：一张牌可同时带一种强化和一道蜡封',
  discardOps: '弃牌堆：可以翻开看，花 £5 把一张捞回牌堆底',
  draft: '开局从五位客人里请一位入座：靠脑子的、稳吃的、吃运气的，路线完全不同',
  events: '随机事件：每夜递进来一件事，三件里应一件（也可以让牌局自决），选下去的那条会改往后的账',
};

// ── 小工具 ───────────────────────────────────────────────────
const q = <T extends HTMLElement = HTMLElement>(sel: string, from: ParentNode = document): T | null =>
  (from.querySelector(sel) as T) ?? null;
const need = <T extends HTMLElement = HTMLElement>(sel: string, from: ParentNode = document): T => {
  const e = q<T>(sel, from);
  if (!e) throw new Error(`缺元素：${sel}`);
  return e;
};
const el = (tag: string, cls = ''): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
};
const num = (n: number): string => Math.round(n).toLocaleString('en-US');
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let speedMul = 1;                       // 截图时把时间放慢，逐帧观察衔接
/** 演出中的飞行动画：按"跳过"时要能立刻落定 */
const liveAnims = new Set<Animation>();
/** 玩家按了跳过：剩下的 wait 全部立刻返回，读数一次性跳到终值。
 *  snap 模式下窗口没上屏，setTimeout 是冻结的——任何 await 都会死锁，所以一律立即返回 */
let ff = false;
const wait = (ms: number): Promise<void> =>
  (SNAP || ff ? Promise.resolve() : sleep(Math.round(ms / speedMul)));

// ── 黄铜机械计数器 ───────────────────────────────────────────
class Reel {
  private cols: (HTMLElement | null)[] = [];
  private len = -1;
  private root: HTMLElement;
  constructor(root: HTMLElement) { this.root = root; }

  set(v: number): void {
    const chars = Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',').split('');
    if (chars.length !== this.len) this.build(chars);
    chars.forEach((c, i) => {
      const col = this.cols[i];
      if (!col) return;
      col.style.transitionDelay = `${i * 34}ms`;
      col.style.transform = `translateY(${-Number(c)}em)`;
    });
  }

  private build(chars: string[]): void {
    this.len = chars.length;
    this.cols = [];
    this.root.textContent = '';
    for (const c of chars) {
      if (!/\d/.test(c)) {
        const sep = el('span', 'digit sep');
        sep.textContent = c;
        this.root.append(sep);
        this.cols.push(null);
        continue;
      }
      const digit = el('span', 'digit');
      const col = el('span', 'col');
      for (let i = 0; i < 10; i++) {
        const b = document.createElement('b');
        b.textContent = String(i);
        col.append(b);
      }
      digit.append(col);
      this.root.append(digit);
      this.cols.push(col);
    }
  }
}

// ── 声音：配方在 core/sound.ts，这里只是把参数交给 WebAudio ────
class Sfx {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;
  private bus: GainNode | null = null;
  private amb: { src: AudioBufferSourceNode; gain: GainNode; lfo: OscillatorNode } | null = null;
  public volume = 0.7;
  public muted = false;
  /** 建过多少个"要手动摘"的节点 / 摘了多少个。差值一直涨就是音频图在漏 */
  private made = 0;
  private freed = 0;
  /** 音效日志：无头判据要的是"这一手真的响过哪几声"，不是"代码里写了一句 play" */
  private fired: Record<string, number> = {};

  private ac(): AudioContext | null {
    if (this.muted) return null;
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch { return null; }
  }

  private buf(c: BaseAudioContext): AudioBuffer {
    if (!this.noise) {
      const n = Math.floor(c.sampleRate * 0.22);
      this.noise = c.createBuffer(1, n, c.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    }
    return this.noise;
  }

  /**
   * 总线：声音 → bus →（房间混响 →）master → 压限 → 扬声器。
   * 混响只喂 bus，背景乐接的是 master（见 audio()），所以它不会被这里再湿一遍。
   * 压限器是"三层叠一起也不削顶"的兜底——配方表里的 peakGain 判据管的是设计值，
   * 真到连击十几张时叠不叠得起来，靠这个才说得上话。
   */
  private chain(c: AudioContext): void {
    if (this.master) return;
    const m = c.createGain();
    m.gain.value = this.volume;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;
    m.connect(comp).connect(c.destination);
    const bus = c.createGain();
    const n = Math.floor(c.sampleRate * 0.45);
    const ir = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
    }
    const verb = c.createConvolver();
    verb.buffer = ir;
    const wet = c.createGain();
    wet.gain.value = 0.14;
    bus.connect(m);
    bus.connect(verb).connect(wet).connect(m);
    this.bus = bus;
    this.master = m;
  }

  /** 音效声部落点（带房间） */
  private dest(c: AudioContext): AudioNode { this.chain(c); return this.bus!; }
  /** 背景乐声部落点（它自带一间厅，不再过这层混响） */
  private masterOut(c: AudioContext): AudioNode { this.chain(c); return this.master!; }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.value = v;
  }

  /** 把一层配方落到某个上下文上。live 的那份要记账并定时摘线，离线渲染那份不用 */
  private spawn(c: BaseAudioContext, L: Layer, bus: AudioNode, t0: number, live: boolean): void {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, L.gain), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + L.dur);
    let extra: AudioNode | null = null;
    let src: AudioScheduledSourceNode;
    if (L.k === 'tone') {
      const o = c.createOscillator();
      o.type = L.type ?? 'sine';
      o.frequency.setValueAtTime(L.f, t0);
      if (L.glide !== undefined) o.frequency.exponentialRampToValueAtTime(Math.max(20, L.glide), t0 + L.dur);
      if (L.detune) o.detune.value = L.detune;
      o.connect(g);
      src = o;
    } else {
      const s = c.createBufferSource();
      s.buffer = this.buf(c);
      const f = c.createBiquadFilter();
      f.type = L.filter ?? 'bandpass';
      f.frequency.value = Math.max(40, L.f);
      f.Q.value = L.q ?? 1.2;
      s.connect(f).connect(g);
      extra = f;
      src = s;
    }
    g.connect(bus);
    src.start(t0);
    src.stop(t0 + L.dur + 0.03);
    if (!live) return;
    // 记账与摘线绑在一起：只增计数不真摘，pending 就量不出漏（背景乐那边踩过）
    this.made += 1 + (extra ? 1 : 0);
    const drop = (x: AudioNode): void => { x.disconnect(); this.freed += 1; };
    window.setTimeout(() => { drop(g); if (extra) drop(extra); }, (t0 + L.dur + 0.09 - c.currentTime) * 1000);
  }

  /** 按配方响一声。step = 连击第几档（抬音高），tint = 花色（改明暗） */
  play(cue: Cue, step = 0, tint = 0): void {
    this.fired[cue] = (this.fired[cue] ?? 0) + 1;
    const c = this.ac();
    if (!c || this.volume <= 0) return;
    const bus = this.dest(c);
    const at0 = c.currentTime + 0.001;
    for (const L of voice(cue, step, tint)) this.spawn(c, L, bus, at0 + (L.at ?? 0), true);
  }

  /**
   * **离线渲染**这一声，返回波形峰值。
   * 为什么要它：配方表能查出"频率在范围内、增益不为零"，但那还是纸面——
   * 一个写错的包络、一层永远不 start 的音，全部判据都照样绿。
   * 这条量的是"真的出声了没有"：0.002 ≤ peak ≤ 1，且噼啪的大档必须比小档响。
   * 不占真实设备，所以显示器睡着也量得到。
   */
  async renderPeak(cue: Cue, step = 0, tint = 0): Promise<number> {
    const sr = 44100;
    const ls = voice(cue, step, tint);
    const span = ls.reduce((a, L) => Math.max(a, (L.at ?? 0) + L.dur), 0) + 0.12;
    const oc = new OfflineAudioContext(1, Math.ceil(sr * span), sr);
    for (const L of ls) this.spawn(oc, L, oc.destination, L.at ?? 0, false);
    const buf = await oc.startRendering();
    const d = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
    return peak;
  }

  /** 房间底噪：一层会"呼吸"的低通噪声 + 大小不一的壁炉噼啪。没有它，牌局太安静了 */
  ambienceOn(): void {
    const c = this.ac();
    if (!c || this.amb) return;
    const src = c.createBufferSource();
    src.buffer = this.buf(c);
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    const g = c.createGain();
    g.gain.value = 0.02;
    // 极慢的一圈 LFO：底噪如果纹丝不动，听久了就知道那是台机器而不是一个房间
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = c.createGain();
    depth.gain.value = 70;
    lfo.connect(depth).connect(lp.frequency);
    src.connect(lp).connect(g).connect(this.dest(c));
    src.start(); lfo.start();
    this.amb = { src, gain: g, lfo };
  }
  ambienceOff(): void {
    if (!this.amb) return;
    try { this.amb.src.stop(); this.amb.lfo.stop(); } catch { /* 已经停了 */ }
    this.amb = null;
  }
  /** 壁炉：步数决定这一记多大（查表，不摇骰子） */
  crackle(step: number): void { this.play('crackle', step); }
  /** 浏览器要求首个用户手势里才能起 AudioContext */
  unlock(): void { this.ac(); music?.kick(); }
  /** 背景乐共用这一个 AudioContext：两个上下文会在同一台机器上抢设备 */
  audio(): { ctx: AudioContext; out: AudioNode } | null {
    const c = this.ac();
    return c ? { ctx: c, out: this.masterOut(c) } : null;
  }
  get debug(): { pending: number; fired: Record<string, number>; ctx: string } {
    return { pending: this.made - this.freed, fired: { ...this.fired },
      ctx: this.ctx ? this.ctx.state : 'none' };
  }
  /** 测试用：清空"响过哪些声"的账，好按手比 */
  resetLog(): void { this.fired = {}; }
}

// ── 背景乐：谱面在 core/music.ts，这里只负责把它弹响 ───────────
/** 花色给落牌声的明暗：黑桃闷、红桃亮。同一只手连打五张时听得出花色序列 */
const SUIT_TINT: Record<Suit, number> = { s: 0, h: 1, d: 2, c: 3 };
function suitTint(cardId: number): number {
  const all = [...g.state.table, ...g.state.hand, ...g.state.discardPile];
  const c = all.find((x) => x.id === cardId);
  return c ? SUIT_TINT[c.suit] : 0;
}

let music: MusicPlayer | null = null;

class MusicPlayer {
  private tune: Tune | null = null;
  private timer: number | null = null;
  /** 建过多少个音频节点 / 摘下来多少个。差值一直涨就是图在漏（见 voice() 收尾那段） */
  private made = 0;
  private freed = 0;
  private step = 0;
  private nextAt = 0;
  private bus: GainNode | null = null;
  private verb: ConvolverNode | null = null;
  private level = 0;
  /** 局势：0 平常，1 该紧张了（叠分解和弦），2 一步不能让（旋律再抬八度）。见 core/music.ts 的 plan() */
  private heat = 0;
  /** 调度器**真的排进音频图**的加层声部数（分解和弦 + 高八度影子，累计）。
   *  探针必须读排出来的事件，不能读 this.heat：只记意图的话，
   *  把 plan 的实参改成 0 也照样"看起来传了"——falsify-ui 就是这么抓到一条 BLIND 的。 */
  private appliedLayers = 0;

  /** 音量：0 就等于停，省得空转一个调度器 */
  setLevel(v: number): void {
    this.level = Math.max(0, Math.min(1, v));
    if (this.bus) this.bus.gain.value = this.level;
  }

  setHeat(v: number): void { this.heat = Math.max(0, Math.min(2, Math.round(v))); }

  select(id: string | null): void {
    const t = id ? tuneById(id) : null;
    if (t?.id === this.tune?.id) return;
    this.tune = t;
    this.step = 0;
    if (!t) { this.halt(); return; }
    this.kick();
  }

  /** 无头行为测试要看接线：曲名、音量、局势、调度器有没有真的转起来 */
  get debug(): { tune: string | null; level: number; heat: number; layers: number; ticking: boolean; ctx: string; pending: number } {
    const host = sfx.audio();
    return {
      tune: this.tune?.id ?? null, level: this.level, heat: this.heat, layers: this.appliedLayers,
      ticking: this.timer !== null, ctx: host ? host.ctx.state : 'none',
      pending: this.made - this.freed,
    };
  }

  /** 首个用户手势之后 AudioContext 才真正跑起来，所以这里可以被反复叫 */
  kick(): void {
    if (!this.tune || this.level <= 0 || SNAP) return;
    const host = sfx.audio();
    if (!host || host.ctx.state !== 'running') return;
    this.build(host);
    if (this.timer !== null) return;
    this.nextAt = host.ctx.currentTime + 0.08;
    this.timer = window.setInterval(() => this.tick(), 40);
  }

  private halt(): void {
    if (this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    if (this.bus) {
      const host = sfx.audio();
      if (host) this.bus.gain.setTargetAtTime(0, host.ctx.currentTime, 0.25);
    }
  }

  /** 房间混响也是现场算的：一段指数衰减的白噪声当脉冲响应 */
  private build(host: { ctx: AudioContext; out: AudioNode }): void {
    if (this.bus) return;
    const c = host.ctx;
    this.bus = c.createGain();
    this.bus.gain.value = this.level;
    this.bus.connect(host.out);
    const n = Math.floor(c.sampleRate * 1.1);
    const ir = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6);
    }
    this.verb = c.createConvolver();
    this.verb.buffer = ir;
    const wet = c.createGain();
    wet.gain.value = 0.28;
    this.bus.connect(this.verb).connect(wet).connect(c.destination);
  }

  private tick(): void {
    if (!this.tune) return;
    const host = sfx.audio();
    if (!host || host.ctx.state !== 'running') return;
    const sd = stepDur(this.tune);
    const horizon = host.ctx.currentTime + 0.5;
    if (this.nextAt < host.ctx.currentTime) this.nextAt = host.ctx.currentTime + 0.02;
    while (this.nextAt < horizon) {
      const evs = plan(this.tune, this.step, 1, this.heat);
      this.appliedLayers += evs.filter((e) => e.voice === 'arp' || e.gain === .035).length;
      for (const e of evs) this.voice(host.ctx, e, this.nextAt + e.at, sd);      this.step = (this.step + 1) % loopSteps(this.tune);
      this.nextAt += sd;
    }
  }

  private voice(c: AudioContext, e: NoteEvent, at: number, sd: number): void {
    const bus = this.bus;
    if (!bus) return;
    if (e.voice === 'perc') { this.percHit(c, e, at, bus); return; }
    const g = c.createGain();
    const oscs: OscillatorNode[] = [];
    let lp: BiquadFilterNode | null = null;
    const mk = (type: OscillatorType, mult: number, detune = 0): void => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = 440 * Math.pow(2, (e.midi + mult - 69) / 12);
      o.detune.value = detune;
      o.connect(g);
      oscs.push(o);
    };
    const filt = (hz: number): BiquadFilterNode => {
      const f = c.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = hz;
      g.connect(f).connect(bus);
      return f;
    };
    const attack = (to: number, sec: number): void => {
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(e.gain, at + sec);
    };
    if (e.voice === 'mel') {
      // 一把琴一种弹法：四首曲子共用一把八音盒，听起来就只是一首曲子换了音高
      switch (this.tune?.timbre ?? 'box') {
        case 'harp':            // 拨弦：起振极快、尾巴短，留得出低音的位置
          mk('sine', 0); mk('triangle', 12, 3);
          attack(e.gain, 0.004);
          g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.16, e.dur * .8));
          break;
        case 'reed':            // 簧风琴：方波加锯齿过一层低通，起振有"风"的斜坡
          mk('square', 0, -5); mk('sawtooth', 0, 6);
          lp = filt(1900);
          attack(e.gain, 0.05);
          g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.2, e.dur * 1.1));
          break;
        case 'strings':         // 弦乐：两把略微失谐的锯齿，慢起慢收
          mk('sawtooth', 0, -7); mk('sawtooth', 0, 7);
          lp = filt(1500);
          attack(e.gain, 0.09);
          g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.24, e.dur * 1.35));
          break;
        default:                // 八音盒：基音 + 一个低八度的泛音，起振快、衰减长
          mk('triangle', 0); mk('sine', -12, 4);
          attack(e.gain, 0.008);
          g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.12, e.dur * 1.5));
      }
    } else if (e.voice === 'arp') {
      mk('sine', 0); mk('triangle', 12, -4);
      attack(e.gain, 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.1, e.dur * .9));
    } else if (e.voice === 'bass') {
      mk('sine', 0);
      mk('triangle', 0, -6);
      attack(e.gain, 0.014);
      g.gain.exponentialRampToValueAtTime(0.0001, at + e.dur);
    } else {
      // 中提琴铺底：两把略微失谐的锯齿过一层低通，慢起慢收
      mk('sawtooth', 0, -7);
      mk('sawtooth', 0, 7);
      lp = filt(1150);
      attack(e.gain, sd * 0.6);
      g.gain.exponentialRampToValueAtTime(0.0001, at + e.dur * 1.2);
    }
    if (!lp) g.connect(bus);
    const end = at + Math.max(0.2, e.dur * 1.6) + 0.05;
    for (const o of oscs) { o.start(at); o.stop(end); }
    // 收尾要把这一声**自己建的、需要手动摘的**节点全从图上摘下来。只 disconnect 增益节点不够：
    // 中提琴那声还串了个低通，它挂在 bus 的输入表上就永远不会被回收，
    // WebKit 每个 128 采样的渲染块都要去拉一遍这个静音滤波器——放一小时就是上万个。
    // 振荡器不计数：stop() 到点之后它自己会被释放（规范如此），不需要手动摘。
    // made/freed 只统计"真的调了 disconnect 的"，所以少摘一个就会在 pending 上涨出来。
    this.made += 1 + (lp ? 1 : 0);
    // 记账和摘线绑在同一个动作里：只增计数不真摘，pending 就量不出漏了（falsify-ui 注出来过）
    const drop = (n: AudioNode): void => { n.disconnect(); this.freed += 1; };
    window.setTimeout(() => {
      drop(g);
      if (lp) drop(lp);
    }, (end - c.currentTime) * 1000 + 120);
  }

  /** 一件共享的白噪声：刷鼓与踩镲都从这里读，不必每次新建 buffer */
  private noise: AudioBuffer | null = null;
  private noiseBuf(c: AudioContext): AudioBuffer {
    if (this.noise) return this.noise;
    const n = Math.floor(c.sampleRate * 0.5);
    const b = c.createBuffer(1, n, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    this.noise = b;
    return b;
  }

  /** 鼓点：低音鼓是一根快速下滑的正弦，另外两件是不同滤波下的噪声短促 */
  private percHit(c: AudioContext, e: NoteEvent, at: number, bus: GainNode): void {
    const g = c.createGain();
    let extra: AudioNode | null = null;
    let end: number;
    if (e.midi === 36) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(132, at);
      o.frequency.exponentialRampToValueAtTime(46, at + 0.11);
      g.gain.setValueAtTime(e.gain, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 0.17);
      end = at + 0.2;
      o.start(at); o.stop(end);
    } else {
      const s = c.createBufferSource();
      s.buffer = this.noiseBuf(c);
      s.playbackRate.value = e.midi === 42 ? 1.6 : 1;
      const f = c.createBiquadFilter();
      f.type = e.midi === 42 ? 'highpass' : 'bandpass';
      f.frequency.value = e.midi === 42 ? 7200 : 1900;
      f.Q.value = e.midi === 42 ? 0.7 : 1.1;
      s.connect(f).connect(g);
      extra = f;
      g.gain.setValueAtTime(e.gain, at);
      g.gain.exponentialRampToValueAtTime(0.0001, at + (e.midi === 42 ? 0.04 : 0.1));
      end = at + (e.midi === 42 ? 0.06 : 0.13);
      s.start(at); s.stop(end);   // 源在 stop() 之后自行释放，不进 made/freed（与 voice() 同一本账）
    }
    g.connect(bus);
    this.made += 1 + (extra ? 1 : 0);
    const drop = (n: AudioNode): void => { n.disconnect(); this.freed += 1; };
    window.setTimeout(() => {
      drop(g);
      if (extra) drop(extra);
    }, (end - c.currentTime) * 1000 + 120);
  }
}

// ── 运行时状态 ───────────────────────────────────────────────
const params = new URLSearchParams(location.search);
// snap=1：无头抓帧模式。关掉一切过渡与动画，状态改动立刻落到像素上，
// 因为窗口没上屏时 WebKit 的动画时钟和 setTimeout 都是冻结的。
const SNAP = params.get('snap') === '1';
let g: Game = new Game(20261009);
let busy = false;
/** busy 只有一个写入口：出牌/弃牌的禁用态与那颗「跳过」必须跟着它一起变，
 *  散在各处赋值迟早漏一处，漏的就是"演出早结束了还挂着跳过按钮"。 */
function setBusy(v: boolean): void { busy = v; syncActions(); }
// 引荐信的选靶状态：picks 可以是 0/1/2，所以"要几张、已点几张"必须显式记着
let armed: { index: number; need: number; got: number[] } | null = null;
let lastTotal = 0;
// 最近一次结算的事件流。给计分拆解视图与 __H.chain() 用——
// "一行可解释"这条硬约束要有能跑出来的文本，不能只写在文档里。
let lastChain: ScoreResult | null = null;
const RANK_CHAR = (r: number): string =>
  r === 14 ? 'A' : r === 13 ? 'K' : r === 12 ? 'Q' : r === 11 ? 'J' : String(r);
function cardNameOf(id: number): string {
  const all = [...g.state.hand, ...g.state.table, ...g.state.discardPile, ...g.state.deck];
  const c = all.find((x) => x.id === id);
  return c ? `${RANK_CHAR(c.rank)}${SUIT_GLYPH[c.suit]}` : `牌#${id}`;
}
const sfx = new Sfx();
music = new MusicPlayer();   // applyPrefs 在开场就会被叫到，它得先存在
const chipsReel = new Reel(need('#chipsReel'));
const multReel = new Reel(need('#multReel'));
const totalReel = new Reel(need('#totalReel'));
const cardEls = new Map<number, HTMLElement>();
const PROBE_SEATS = PATRONS.slice(0, 3).map((p) => mkSeat(p.id));
const patronEls = new Map<string, HTMLElement>();
/** "上一次看到"的构筑里程碑：只有**新达成**的那一次才响一声。
 *  没有这两张表，套装与长进的音效会在每次重渲染时重复播，反馈就变成噪音。
 *  seenSets 初值是 null：刚进铺子就把已有的套装报一遍，等于把"里程碑"播成"清单"。 */
const seenGrowth = new Map<string, number>();
let seenSets: string[] | null = null;
let toastTimer = 0;

function toast(text: string): void {
  const n = need('#notice');
  n.textContent = text;
  n.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => n.classList.remove('show'), Math.round(2100 / speedMul));
}

// ── 牌面 ─────────────────────────────────────────────────────
function syncCard(c: Card, node: HTMLElement): void {
  const chosen = g.state.chosen.includes(c.id);
  const target = armed !== null && armed.got.includes(c.id);
  node.dataset.id = String(c.id);
  node.setAttribute('role', 'button');
  node.tabIndex = g.state.hand.some((x) => x.id === c.id) ? 0 : -1;
  node.setAttribute('aria-label', `${RANK_LABEL(c.rank)}${SUIT_GLYPH[c.suit]}${c.enh !== 'none' ? `，${materialById(c.enh).name}` : ''}${c.seal !== 'none' ? `，${SEAL_NAME[c.seal]}` : ''}`);
  node.setAttribute('aria-pressed', String(chosen || target));
  const rare = specialById(c.special);
  if (rare) { node.setAttribute('aria-label',`${node.getAttribute('aria-label')}，${rare.name}，${rare.blurb}，${specialProgress(c)}`); node.title=[rare.blurb,specialProgress(c)].filter(Boolean).join(' · '); }
  else node.removeAttribute('title');
  node.className = 'card'
    + (c.suit === 'h' || c.suit === 'd' ? ' red' : '')
    + (c.enh !== 'none' ? ` e-${c.enh}` : '')
    + (c.seal !== 'none' ? ` s-${c.seal}` : '')
    + (c.special ? ` rare-${c.special}` : '')
    + (chosen ? ' chosen' : '')
    + (target ? ' target' : '');
  const stamp = `${c.rank}${c.suit}${c.enh}${c.seal}${c.special??''}${c.charge??0}`;
  if (node.dataset.built !== stamp) {
    node.dataset.built = stamp;
    node.textContent = '';
    // 角标：数字仍是字（衬线数字在这个尺寸最清楚），花色改成与点位同一套矢量图形，
    // 否则"角上是字体给的♥、中间是我画的♥"会露出两套笔触
    for (const pos of ['tl', 'br']) {
      const corner = el('span', `corner ${pos}`);
      const r = el('span', 'r');
      r.textContent = RANK_LABEL(c.rank);
      const g = el('span', 's');
      g.innerHTML = suitSvg(c.suit);
      corner.append(r, g);
      node.append(corner);
    }
    if (isPipCard(c.rank)) {
      // 2..10：按真实扑克牌排点位，下半部的点倒过来
      const field = el('span', 'pips' + (c.rank >= 9 ? ` r${c.rank}` : ''));
      for (const q of pipSpots(c.rank)) {
        const one = el('span', 'pip' + (q.flip ? ' flip' : ''));
        one.style.left = `${(q.x * 100).toFixed(1)}%`;
        one.style.top = `${(q.y * 100).toFixed(1)}%`;
        one.innerHTML = suitSvg(c.suit);
        field.append(one);
      }
      node.append(field);
    } else if (isFace(c.rank)) {
      // J/Q/K：真牌是"双头牌"，所以上下各半、下半部旋转 180°
      const face = el('span', 'face');
      for (const half of ['up', 'down']) {
        const h = el('span', `fh ${half}`);
        // 字母是主读（100px 的牌面上先要认得出是谁），纹章压在它下面当花饰
        const l = el('span', 'ltr');
        l.textContent = RANK_LABEL(c.rank);
        const crest = el('span');
        crest.innerHTML = `<svg class="suit-svg coat" viewBox="0 0 40 34" aria-hidden="true">`
          + FACE_ART[RANK_LABEL(c.rank) as 'J' | 'Q' | 'K'] + '</svg>';
        h.append(l, crest);
        face.append(h);
      }
      node.append(face);
    } else {
      // A：一枚放大花色 + 一圈双线环（铜版画里 A 就是主牌）
      const ace = el('span', 'pip ace');
      ace.innerHTML = `<svg class="suit-svg big" viewBox="${SUIT_VIEWBOX}" aria-hidden="true">`
        + ACE_RING + SUIT_ART[c.suit] + '</svg>';
      node.append(ace);
    }
    if (c.seal !== 'none') {
      const seal = el('span', 'sealdot');
      seal.textContent = '❖';
      seal.title = SEAL_NAME[c.seal];
      node.append(seal);
    }
    if (rare) {
      const badge=el('span','rare-badge');badge.textContent=`${rare.glyph} ${rare.name}${specialProgress(c)?` ${c.charge??0}/${c.special==='bond'?3:4}`:''}`;badge.style.setProperty('--rare-color',rare.color);node.append(badge);
    }
  }
}

function cardNode(c: Card): HTMLElement {
  let node = cardEls.get(c.id);
  if (!node) {
    node = el('div', 'card');
    cardEls.set(c.id, node);
    const ref = node;
    node.addEventListener('click', () => onCardClick(c.id, ref));
    node.addEventListener('keydown', (ev) => {
      if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); onCardClick(c.id, ref); }
    });
  }
  syncCard(c, node);
  return node;
}

/** 带 FLIP 的摆位。牌可以从手牌区走到牌桌，轨迹仍然连续 */
function place(container: HTMLElement, list: Card[]): void {
  const tracked = [...cardEls.values()].filter((n) => n.isConnected);
  const before = new Map<HTMLElement, DOMRect>();
  for (const n of tracked) before.set(n, n.getBoundingClientRect());

  for (const c of list) container.append(cardNode(c));

  // 只有"既不在手里也不在桌上、也不是这次要摆的"牌才真正离场。
  // 摘下来还要把 map 里的记账一起删掉：留着的话每张打过的牌都永久挂在 cardEls 上
  // （连它那个 click 闭包一起），而且 place() 每次都要遍历这堆死账——实测 6 手就积了 18 张。
  // 为什么还要并上 list：上一局的动画还在飞时换局（点「再开一局」、测试里重开），
  // g.state 已经换成新的一局，只按 hand+table 算存活会把**正要摆上桌的那几张**当场删掉，
  // 下一句 `cardEls.get(c.id)!` 就拿到 undefined（实测崩在 place 的 forEach 里）。
  const alive = new Set([...g.state.hand, ...g.state.table, ...list].map((c) => c.id));
  for (const [id, n] of cardEls) if (!alive.has(id)) { n.remove(); cardEls.delete(id); }

  list.forEach((c, i) => {
    const n = cardEls.get(c.id)!;
    if (container.id === 'tray') {
      const mid = (list.length - 1) / 2;
      const d = i - mid;
      n.style.setProperty('--rot', `${(d * 2.5).toFixed(2)}deg`);
      n.style.setProperty('--base', `${(Math.abs(d) ** 2 * 1.35).toFixed(2)}px`);
      n.style.setProperty('--i', String(i));
      n.style.zIndex = String(10 + i);
    } else {
      n.style.removeProperty('--rot');
      n.style.removeProperty('--base');
      n.style.zIndex = '';
    }
  });

  // 读相一次做完，再一次性写，最后只强制回流一次。
  // 原来每张牌"读 rect → 写 transform → 回流"交替进行，8 张牌就是 8 次同步布局。
  const moved: [HTMLElement, number, number][] = [];
  for (const c of list) {
    const node = cardEls.get(c.id)!;
    const prev = before.get(node);
    if (!prev) {
      node.classList.add('dealing');
      setTimeout(() => node.classList.remove('dealing'), Math.round(380 / speedMul));
      continue;
    }
    const now = node.getBoundingClientRect();
    const dx = prev.left - now.left;
    const dy = prev.top - now.top;
    if (Math.abs(dx) < 0.6 && Math.abs(dy) < 0.6) continue;
    node.style.transition = 'none';
    node.style.translate = `${dx}px ${dy}px`;
    moved.push([node, dx, dy]);
  }
  if (moved.length) {
    // 一次容器级回流提交所有起点，而不是 rAF 收尾：
    // 窗口没上屏时 rAF 不回调，牌会永远停在"平移回旧位置"那一帧，看着像凭空消失。
    void container.offsetWidth;
    for (const [node] of moved) {
      node.style.transition = '';
      node.style.translate = '0px 0px';
    }
  }
}

// ── 座上宾 ───────────────────────────────────────────────────
function patronNode(p: PatronDef): HTMLElement {
  let node = patronEls.get(p.id);
  if (!node) {
    node = el('div', `patron r-${p.rarity}`);
    patronEls.set(p.id, node);
    node.innerHTML =
      '<span class="hookchip"></span><button class="sell" title="请出去">✕</button>'
      + '<span class="cameo"><span class="pf-w"></span><span class="mono"></span><i class="ed"></i></span>'
      + '<span class="pname"></span><span class="prole"></span><span class="blurb"></span>';
    // 肖像不是一件素材，是每次按零件现拼的内联 SVG（core/portrait.ts）
    need('.cameo', node).style.background = portraitGround(p.temperament, p.id);
    need('.pf-w', node).innerHTML = portraitSvg(p.id, p.rarity);
    need('.mono', node).textContent = MONOGRAM[p.id] ?? p.monogram;
    need('.pname', node).textContent = p.name;
    need('.prole', node).textContent = p.role;
    need('.blurb', node).textContent = p.blurb;
    need('.hookchip', node).textContent = `${HOOK_LABEL[p.hook]} · ${KIND_LABEL[p.kind]}`;
    // tag 挂在定义上（构筑轴），长进挂在座位上（实例轴）——所以两者都要在每次渲染时重画
    const tagChip = el('span', 'tagchip');
    tagChip.textContent = (p.tags ?? []).filter((t) => ALL_TAGS.includes(t)).join(' · ');
    node.append(tagChip);
    const growChip = el('span', 'growchip');
    node.append(growChip);
    node.dataset.pid = p.id;
    node.title = `${p.name}｜${RARITY_LABEL[p.rarity]}\n${p.blurb}`;
    need('.sell', node).addEventListener('click', (ev) => {
      ev.stopPropagation();
      if (busy) return;
      const i = g.state.seats.findIndex((x) => x.pid === p.id);
      if (i < 0) return;
      const seat = g.state.seats[i];
      const back = Math.max(1, Math.floor((p.cost + (EDITION_PREMIUM[seat.edition] ?? 0)) / 2));
      if (sellSeat(g, i)) {
        saveNow();
        sfx.play('leave');
        node.classList.add('leaving');
        flyMoney(back, node);
        setTimeout(() => { renderAll(); saveNow(); }, Math.round(460 / speedMul));
        toast(`${p.name} 离席，收回 £${back}`);
      }
    });
  }
  return node;
}

/** 版本挂在座位实例上，所以每次渲染都要把它同步到牌面 */
function syncPatron(node: HTMLElement, seat: Seat): void {
  const def = patronById(seat.pid);
  // tag 是邻接共鸣与套装两件事共用的数据轴。两个开关都关掉时这一行必须空掉——
  // 留着它就不是"关掉等于不存在"，而是"关掉还看得见一排没人能触发的字"。
  const tagChip = q<HTMLElement>('.tagchip', node);
  if (tagChip) {
    tagChip.textContent = (g.state.flags.adjacency || g.state.flags.sets)
      ? (def.tags ?? []).filter((t) => ALL_TAGS.includes(t)).join(' · ')
      : '';
  }
  const growChip = q<HTMLElement>('.growchip', node);
  if (growChip) {
    if (g.state.flags.growth && def.growth) {
      const lv = growthLevel(seat.xp ?? 0, def.growth);
      growChip.textContent = growthLabel(seat.xp ?? 0, def.growth);
      growChip.style.display = '';
      // 只在"刚升上去"那一刻响。每次重渲染都响一遍的话，它就变成背景噪音而不是反馈
      if ((seenGrowth.get(seat.pid) ?? lv) < lv) sfx.play('grow', lv);
      seenGrowth.set(seat.pid, lv);
    } else {
      growChip.textContent = '';
      growChip.style.display = 'none';
    }
  }
  node.classList.toggle('ed-foil', seat.edition === 'foil');
  node.classList.toggle('ed-holo', seat.edition === 'holo');
  node.classList.toggle('ed-polychrome', seat.edition === 'polychrome');
  node.classList.toggle('ed-negative', seat.edition === 'negative');
  const badge = need('.ed', node);
  badge.textContent = seat.edition === 'none' ? '' : EDITION_NAME[seat.edition];
  const p = patronById(seat.pid);
  node.title = seat.edition === 'none'
    ? `${p.name}｜${RARITY_LABEL[p.rarity]}\n${p.blurb}`
    : `${p.name}｜${RARITY_LABEL[p.rarity]}｜${EDITION_NAME[seat.edition]}\n${p.blurb}\n${EDITION_BLURB[seat.edition]}`;
}

function renderPatrons(): void {
  const box = need('#patrons');
  box.textContent = '';
  const lim = limits(g.state);
  for (const seat of g.state.seats) {
    const p = patronById(seat.pid);
    const n = patronNode(p);
    syncPatron(n, seat);
    const sell = q<HTMLElement>('.sell', n);
    if (sell) sell.style.display = g.state.status === 'shop' ? '' : 'none';
    // P0-2：铺子阶段才允许换座，一次 £2。左右两个箭头比拖拽好测也好点（鼠标玩家不必按住拖动）。
    // 这一行**每次渲染都要先拆掉重建**：patronEls 缓存的是同一个 DOM 节点，
    // 只在创建时挂一次的话，切到牌桌那些箭头还留在上面（uitest 抓到过）。
    const oldShift = q<HTMLElement>('.shift', n);
    if (oldShift) oldShift.remove();
    if (g.state.flags.adjacency && g.state.status === 'shop' && g.state.seats.length > 1) {
      const i = g.state.seats.findIndex((x) => x.pid === p.id);
      const shift = el('span', 'shift');
      for (const [label, delta, title] of [['◀', -1, '往前挪一位'], ['▶', 1, '往后挪一位']] as [string, number, string][]) {
        const b = el('button', 'mv');
        b.textContent = label;
        b.title = `${title}（£${SWAP_COST}）`;
        const to = i + delta;
        b.disabled = to < 0 || to >= g.state.seats.length || g.state.money < SWAP_COST;
        b.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (busy || !reorderSeat(g, i, to)) { toast(`换座要 £${SWAP_COST}`); return; }
          sfx.play('swap');
          renderAll();
          renderShop();
          saveNow();
        });
        shift.append(b);
      }
      n.append(shift);
    }
    box.append(n);
  }
  for (let i = seatedCount(g.state); i < lim.seats; i++) {
    const n = el('div', 'patron empty');
    n.innerHTML = '<span class="cameo"><span>+</span></span><span class="pname">虚席</span>'
      + '<span class="prole">等一位客人</span><span class="blurb">在铺子里请人入席</span>';
    box.append(n);
  }
}

// ── 区域渲染 ─────────────────────────────────────────────────
const ROMAN: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
function roman(n: number): string {
  let out = '';
  let v = n;
  for (const [k, s] of ROMAN) while (v >= k) { out += s; v -= k; }
  return out || 'I';
}

function renderScoreline(): void {
  const target = targetOf(g.state);
  need('#scoreFill').style.width = `${Math.min(100, (g.state.score / Math.max(1, target)) * 100)}%`;
  need('#scoreVal').textContent = num(g.state.score);
  need('#scoreOf').textContent = `/ ${num(target)}`;
  renderThresholdMarks();
}

function renderMarquee(): void {
  const kind = STAGE_KIND[g.state.stage];
  // 分母跟着局长走：选了 3 夜或 15 夜的人得知道终点挪到哪了。
  // 无尽没有"最后一夜"，那里不许挂分母——挂上就是一个假终点。
  need('#night').textContent = g.state.endless
    ? `第 ${roman(g.state.night)} 夜`
    : `第 ${roman(g.state.night)} / ${roman(g.state.nights)} 夜`;
  const sk = need('#stakeKind');
  sk.textContent = kind === 'boss' ? stakeLabel(g.state) : STAGE_LABEL[kind];
  sk.classList.toggle('boss', kind === 'boss');
  need('#stakeBlurb').textContent = stakeBlurb(g.state);
  need('#targetVal').textContent = num(targetOf(g.state));
  renderScoreline();
}

function renderGauges(): void {
  const box = need('#gauges');
  const hands = q<HTMLElement>('.gauge:nth-child(1)', box);
  const discards = q<HTMLElement>('.gauge:nth-child(2)', box);
  need('#gHands').textContent = String(g.state.handsLeft);
  need('#gDiscards').textContent = String(g.state.discardsLeft);
  if (hands) hands.classList.toggle('spent', g.state.handsLeft <= 0);
  if (discards) discards.classList.toggle('spent', g.state.discardsLeft <= 0);
  need('#purseVal').textContent = `£${g.state.money}`;
  need('#repVal').textContent = String(g.state.rep);
  need<HTMLButtonElement>('#btnShop').disabled = g.state.status !== 'shop';
  syncActions();
}

/**
 * 出牌与弃牌以前只有键盘（空格 / X）按得动，这里给它们真按钮。
 * 禁用态不许只留一个灰块：为什么现在不能按，要写在 title 里，鼠标玩家才不必猜。
 */
function syncActions(): void {
  const s = g.state;
  const picked = s.chosen.length;
  const why = busy ? '演出中，再按一次是跳过'
    : s.pendingEvent.length ? '先应下递来的那件事'
      : s.status !== 'playing' ? '这一场不在牌局里'
        : picked === 0 ? '先选 1–5 张牌' : '';
  const play = need<HTMLButtonElement>('#btnPlay');
  const disc = need<HTMLButtonElement>('#btnDiscard');
  play.disabled = !!why;
  play.title = why || `打出这 ${picked} 张（空格）`;
  disc.disabled = !!why || s.discardsLeft <= 0;
  disc.title = why || (s.discardsLeft <= 0 ? '这一夜的弃牌用完了' : `弃掉这 ${picked} 张（X）`);
  need<HTMLElement>('#btnSkip').hidden = !busy;
}

function renderTray(): void {
  place(need('#tray'), g.state.hand);
}

function renderSatchel(): void {
  const box = need('#consumables');
  box.textContent = '';
  const lim = limits(g.state);
  const cap = document.createElement('div');
  cap.className = 'satchel-cap';
  cap.textContent = `随身 ${g.state.consumables.length} / ${lim.slots}`;
  box.append(cap);
  if (!g.state.consumables.length) {
    const n = el('div', 'empty-note');
    n.textContent = '随身无物';
    box.append(n);
    return;
  }
  g.state.consumables.forEach((c, i) => {
    const n = el('div', `item ${c.t}`);
    if (armed && armed.index === i) n.classList.add('armed');
    const k = el('span', 'kind');
    k.textContent = c.t === 'letter' ? '引荐信' : '牌谱';
    const nm = el('span');
    nm.textContent = c.t === 'letter'
      ? letterById(c.id).name
      : `${HANDS[c.id].name} → ${levelOf(g.state, c.id) + 1} 级`;
    n.append(k, nm);
    n.title = c.t === 'letter' ? letterById(c.id).blurb : `使用后 ${HANDS[c.id].name} 升一级`;
    n.addEventListener('click', () => onConsumable(i));
    box.append(n);
  });
}

function renderReadout(): void {
  const p = preview(g.state);
  const box = need('#readout');
  box.classList.toggle('idle', !p);
  if (p) {
    const b = handBase(p.kind, p.level);
    chipsReel.set(b.chips);
    multReel.set(b.mult);
    totalReel.set(b.chips * b.mult);
    lastTotal = b.chips * b.mult;
  }
}

/**
 * 局势进音乐：头人夜、只剩一次牌权、这一场抬过注——任两样成立就把曲子顶紧。
 * 玩家不用回头去看读数也知道"这手不能失手"，这是听觉版的正反馈；
 * 它只加声部不改音高序列（core/music.ts 的 plan 保证了这点），所以不会听着跑调。
 */
function syncMusicHeat(): void {
  const s = g.state;
  const heat = s.status === 'playing'
    ? Math.min(2, (STAGE_KIND[s.stage] === 'boss' ? 1 : 0)
      + (s.handsLeft <= 1 ? 1 : 0) + (s.raisedHere > 0 ? 1 : 0))
    : 0;
  music.setHeat(heat);
}

/**
 * 新手引导的投影层。说什么、什么时候说，全在 core/tutorial.ts 那张表里；
 * 这里只做三件事：把局面读成 Facts、把气泡贴到对应区域旁边、记下"讲过哪几条"。
 *
 * 三条硬规矩（都有判据）：
 * ① 气泡**不吃点击**（容器 pointer-events:none，只有它自己的按钮要手），
 *    否则它会盖在牌桌或出牌键上，把玩家第一次操作挡掉——那比没教程更糟；
 * ② 元素只建一次、常驻复用。每次渲染都新建/删除一个节点的话，
 *    性能档那套"22 次重渲染后节点差不超过 5"的账就会被一个提示气泡搅浑；
 * ③ 玩法一律不读 state.tutorial。看不看教程，发牌、结算、铺子必须一模一样。
 */
const ANCHOR_SEL: Record<Anchor | GuideAnchor, string> = {
  scoreline: '.scoreline', tray: '#tray', patrons: '#patrons',
  gauges: '#gauges', shop: '#shopBody .slots', raise: '.raise',
  // 结业那一课讲"往后怎么办"，没有具体部件可指，钉在牌桌正中
  center: '#board',
  // 拆账那一课要指着读数说，随身那两课指着左边那一格——都是玩家眼睛正在看的地方
  readout: '#readout', satchel: '#consumables',
};
let coach: HTMLElement | null = null;

/** 玩家是否已经上桌：标题页还开着的时候，一节课都不该讲 */
const atTable = (): boolean => q('#title')?.classList.contains('hidden') === true;

function tutorialFacts(): Facts {
  const s = g.state;
  const lim = limits(s);
  const cleared = s.ledger.length;
  const playedThisStage = lim.hands - s.handsLeft;
  return {
    started: atTable(),
    played: cleared > 0 ? 1 : Math.max(0, playedThisStage),
    cleared,
    inShop: s.status === 'shop',
    bossNext: s.status === 'playing' && STAGE_KIND[s.stage] === 'boss',
  };
}

/** 把这一局课的局面读成 Facts；界面与 tools/guide-check.mjs 用的是同一份推导 */
const guideFactsNow = (): GuideFacts => guideFacts(g.state, atTable());

/** 这一局课现在该上哪一节；不在上课、还在动画里、锚点不在屏幕上，都返回 null。
 *  facts 由调用方传进来（同一帧里正文也要用它，不必把局面重算第二遍） */
function currentLesson(f?: GuideFacts): Lesson | null {
  if (!inGuide(g.state.guide) || busy) return null;
  const l = lessonFor(f ?? guideFactsNow(), g.state.guide);
  if (!l) return null;
  const host = document.querySelector(ANCHOR_SEL[l.anchor]);
  if (!host || !host.getBoundingClientRect().width) return null;
  return l;
}

/** 当前该说的那条；引导关了、讲完了、或者锚点不在屏幕上，都返回 null */
function currentStep(): Step | null {
  // 上课的时候让位：一门课的话只由气泡说一次，两套同时投就会互相盖
  if (!prefs.tutorial || busy || inGuide(g.state.guide)) return null;
  const st = stepFor(tutorialFacts(), g.state.tutorial);
  if (!st) return null;
  const host = document.querySelector(ANCHOR_SEL[st.anchor]);
  if (!host || !host.getBoundingClientRect().width) return null;   // 面板没打开 / 元素被藏起来
  return st;
}

/** 气泡壳两种用法共用一套：'tip' 是路过提醒一句，'lesson' 是引导关正在上的这一节课 */
interface CoachCard {
  id: string; title: string; body: string; anchor: Anchor | GuideAnchor;
  todo?: string; n?: string; ok?: string;
}

function showCoach(card: CoachCard, kind: 'tip' | 'lesson'): void {
  if (!coach) {
    coach = el('div', 'coach');
    coach.innerHTML = '<i class="ch-n"></i><b class="ch-t"></b><span class="ch-b"></span>'
      + '<em class="ch-do"></em>'
      + '<span class="ch-act"><button class="ch-ok">知道了</button>'
      + '<button class="ch-skip">全部跳过</button></span>';
    document.body.append(coach);
    // 只给按钮要手：气泡本体压在谁身上都不该拦住那一下点击
    coach.addEventListener('pointerdown', (e) => e.stopPropagation());
    // 按钮在创建时只绑一次，所以它**不能**闭包捕获当时那条 step——
    // 那样"知道了"永远只关掉第一条，后面的条目怎么点都赖着不走。
    // 目标要从元素自己身上的 dataset 读，那才是此刻在显示的这条。
    q('.ch-ok', coach)!.addEventListener('click', () => {
      const id = coach!.dataset.step ?? null;
      if (coach!.dataset.kind === 'lesson') dismissLesson(id); else dismissTutorial(id);
    });
    q('.ch-skip', coach)!.addEventListener('click', () => {
      if (coach!.dataset.kind === 'lesson') dismissLesson(null); else dismissTutorial(null);
    });
  }
  need('.ch-t', coach).textContent = card.title;
  need('.ch-b', coach).textContent = card.body;
  need('.ch-do', coach).textContent = card.todo ?? '';
  need('.ch-n', coach).textContent = card.n ?? '';
  // 上课的时候那两颗字得改口：「知道了」不等于做到了，「全部跳过」等于退出这门课
  // 纯讲解的课点掉就是点掉；要动手的那节得说清"跳过的是这一步"，不是"这课我看过了"
  need<HTMLButtonElement>('.ch-ok', coach).textContent = card.ok ?? '知道了';
  need<HTMLButtonElement>('.ch-skip', coach).textContent = kind === 'lesson' ? '退出引导' : '全部跳过';
  coach.classList.toggle('lesson', kind === 'lesson');
  coach.classList.remove('hidden');
  coach.dataset.step = card.id;
  coach.dataset.kind = kind;
  placeCoach(card.anchor);
}

/** 贴到锚点旁边：上半屏就往下放，下半屏就往上放，横向夹在视口内 */
function placeCoach(anchor: Anchor | GuideAnchor): void {
  if (!coach) return;
  const host = document.querySelector(ANCHOR_SEL[anchor]);
  if (!host) return;
  const r = host.getBoundingClientRect();
  const box = coach.getBoundingClientRect();
  const below = r.top + r.height / 2 < innerHeight / 2;
  let top = below ? r.bottom + 10 : r.top - box.height - 10;
  // 纵向也要夹：铺子的货位区很高，"往下放"会把气泡推出屏幕外——
  // 玩家看不见的气泡等于没有气泡，还占着一个 z-index
  top = Math.max(10, Math.min(innerHeight - box.height - 10, top));
  const left = Math.max(10, Math.min(innerWidth - box.width - 10, r.left + r.width / 2 - box.width / 2));
  coach.style.top = `${Math.round(top)}px`;
  coach.style.left = `${Math.round(left)}px`;
  coach.dataset.anchor = anchor;
  coach.dataset.below = below ? '1' : '0';   // 决定那根小尾巴朝上还是朝下
}

/** 气泡与锚点的几何关系：提醒和上课两套投影共用这一份量法 */
function coachGeom(anchor: Anchor | GuideAnchor): { covers: boolean; inView: boolean; inPanel: boolean } {
  const out = { covers: false, inView: false, inPanel: false };
  const host = document.querySelector(ANCHOR_SEL[anchor]);
  if (!host || !coach || coach.classList.contains('hidden')) return out;
  const a = host.getBoundingClientRect();
  const b = coach.getBoundingClientRect();
  // 重叠才判 covers：气泡飘到锚点边上可以，压住锚点就等于替玩家把按钮挡了
  out.covers = !(b.bottom <= a.top || b.top >= a.bottom || b.right <= a.left || b.left >= a.right);
  out.inView = b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight;
  out.inPanel = !!host.closest('.panel.open');
  return out;
}

/**
 * "不吃点击"的直接量法：拿气泡自己中心点做一次命中测试，
 * 命中的必须不是气泡或它的子孙（容器 pointer-events:none 才会被跳过）。
 * 位置无关，所以气泡挪到哪都还测得到这条。
 */
function coachEatsClicks(): boolean {
  if (!coach || coach.classList.contains('hidden')) return false;
  const b = coach.getBoundingClientRect();
  const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
  return !!hit && (hit === coach || coach.contains(hit));
}

/** id 为 null 表示"全部跳过"：一次记下剩下的所有条，别在后面的局里再烦他 */
function dismissTutorial(id: string | null): void {
  g.state.tutorial = markSeen(g.state.tutorial, id);
  saveNow();
  refreshTutorial();
}

/** 上一节课。id 为 null 是「退出引导」：十节一次记完，这局从此是普通局（标记位留着） */
function dismissLesson(id: string | null): void {
  if (id === null) quitGuide(g.state);
  else g.state.guide = markLesson(g.state.guide, id);
  // 上过课这件事记进偏好：开场卡只在第一次玩拦路，第二局不该再问
  prefs.guide = true;
  savePrefs();
  const over = id !== null && finished(g.state.guide);
  saveNow();
  refreshTutorial();
  if (over) toast('课上完了 · 这一局接着打，规矩都写在牌桌边上');
}

/**
 * 做到的课记进进度。这一步不能省：多数课的 done 读的是**瞬时**状态（选了哪几张、
 * 铺子开没开），牌一打出去选择就清空、一关面板就不在铺子里了——不记下来的话
 * 气泡会退回上一节，教完的课再教第二遍。记了也只是记 id：玩法照样不读它。
 *
 * 只能记**当前这一节**：往后扫着记会把第 8 课"带着客人再打一手"提前记掉，
 * 因为它那条判据（本场出过牌）在第 1 场就成立了。
 */
function claimGuide(): boolean {
  if (!inGuide(g.state.guide)) return false;
  const f = guideFactsNow();
  for (const l of LESSONS) {
    if (g.state.guide.includes(l.id)) continue;
    if (!l.open(f)) continue;                       // 窗口没开过的课自动翻页，不记
    if (l.done?.(f)) { g.state.guide = markLesson(g.state.guide, l.id); return true; }
    return false;                                   // 开着窗还没做到：课程就停在这一节
  }
  return false;
}

/** 把该说的话投到气泡上：一门课优先，其次才是路过提醒 */
function refreshTutorial(): void {
  if (need('#codex').classList.contains('open')) {
    if (coach) { coach.classList.add('hidden'); delete coach.dataset.step; delete coach.dataset.kind; }
    return;
  }
  if (claimGuide()) saveNow();
  const f = guideFactsNow();
  const l = currentLesson(f);
  if (l) {
    showCoach({
      id: l.id, title: l.title,
      // 带 dyn 的课把**此刻屏幕上的真数字**讲进正文（"这一场要做 300 分"、
      // "现在这手是对子：30 流水 × 2 倍注"），第一次玩的人要的是自己那一手，不是定义
      body: l.dyn ? l.dyn(f) : l.body,
      anchor: l.anchor, todo: l.todo,
      n: `第 ${position(l.id)} / ${LESSONS.length} 课`,
      ok: l.done ? '这一步我先跳过' : '知道了',
    }, 'lesson');
    return;
  }
  const st = currentStep();
  if (!st) {
    if (coach) { coach.classList.add('hidden'); delete coach.dataset.step; delete coach.dataset.kind; }
    return;
  }
  showCoach({ id: st.id, title: st.title, body: st.body, anchor: st.anchor }, 'tip');
}

function renderAll(): void {
  const clubButton=need<HTMLButtonElement>('#btnClub');clubButton.hidden=!g.state.flags.club;
  const ready=g.state.club?.contract?.status==='ready';
  clubButton.textContent=ready?'委托 · 领奖':storyChapter(g.state)?'委托 · 来信':'委托簿';
  clubButton.classList.toggle('club-alert',ready||!!storyChapter(g.state));
  renderMarquee();
  renderPatrons();
  renderTray();
  renderGauges();
  renderSatchel();
  renderReadout();
  syncMusicHeat();
  refreshTutorial();
  // 待决事件也是牌桌状态的一部分：它挂在 state 上，投影就该在这里跟着一变
  renderEventPick();
  if(need('#club').classList.contains('open'))renderClubPanel();
  if (need('#codex').classList.contains('open')) {
    if (codexTab === 'deck') {
      const filters = ['deckZone', 'deckSuit', 'deckSort'].map((id) => [id, need<HTMLSelectElement>(`#${id}`).value]);
      renderCodex();
      for (const [id, value] of filters) need<HTMLSelectElement>(`#${id}`).value = value;
      need('#deckZone').dispatchEvent(new Event('change'));
    } else if (codexTab === 'hands') renderCodex();
  }
}

// ── 交互 ─────────────────────────────────────────────────────
function onCardClick(id: number, node: HTMLElement): void {
  if (busy || g.state.status !== 'playing') return;
  if (armed) {
    const i = armed.got.indexOf(id);
    if (i >= 0) armed.got.splice(i, 1);
    else if (armed.got.length < armed.need) armed.got.push(id);
    if (armed.got.length === armed.need) commitConsumable();
    else { renderTray(); renderSatchel(); }
    return;
  }
  toggleChosen(g.state, id);
  const on = g.state.chosen.includes(id);
  sfx.play(on ? 'pick' : 'unpick');
  node.classList.toggle('chosen', on);
  renderTray();
  renderReadout();
  syncActions();   // 真点牌这条路只重画手牌与读数，不刷按钮的话「出 牌」会永远停在灰着
}

function commitConsumable(): void {
  if (!armed) return;
  const { index, got } = armed;
  armed = null;
  if (useConsumable(g, index, got)) { sfx.play('draft'); toast(g.state.log[0] ?? ''); }
  else toast('这封信用不上');
  renderAll();
  saveNow();
}

function onConsumable(i: number): void {
  if (busy || g.state.status !== 'playing') return;
  const c = g.state.consumables[i];
  if (!c) return;
  if (c.t === 'book') {
    if (useConsumable(g, i, [])) { sfx.play('grow'); toast(g.state.log[0] ?? ''); }
    renderAll();
    saveNow();
    return;
  }
  if (armed && armed.index === i) { armed = null; toast('收回了引荐信'); renderAll(); return; }
  const need = letterById(c.id).picks;
  armed = { index: i, need, got: [] };
  if (need === 0) commitConsumable();
  else { toast(`点 ${need} 张手牌作为对象`); renderSatchel(); }
}

async function doPlay(): Promise<void> {
  if (busy || g.state.status !== 'playing' || !g.state.chosen.length) return;
  setBusy(true);
  armed = null;
  const played = chosenCards(g.state);
  const res = play(g);
  // 这里**不能**先 renderTray()：play() 里 drawTo 已把手牌补满，
  // 先重排会让打出的两张和新发的两张同时出现在手里，飞行也就失去了起点。
  renderGauges();
  if (!res) { setBusy(false); return; }
  saveNow();            // 内核已入账，动画中退出也应恢复到这一步
  // 拆解文本要在**两条路**上都拿得到：演出走完是一条，跳过/抓帧是另一条。
  // 只写在 runTimeline 里的话，snap 模式与跳过之后 chain() 会空着——
  // 而"一行可解释"这条硬约束恰恰要求跳过路径也给得出同一份账。
  lastChain = res;
  if (SNAP) { applyEventsSync(res, played, -1); setBusy(false); return; }
  await runTimeline(res, played);
}

async function doDiscard(): Promise<void> {
  if (busy || g.state.status !== 'playing' || !g.state.chosen.length) return;
  if (g.state.discardsLeft <= 0 || g.state.pendingEvent.length) return;
  setBusy(true);
  const activeGame = g;
  const gone = chosenCards(g.state);
  const got = discard(g);
  saveNow();
  sfx.play('discard');
  if (!SNAP) {
    // 弃牌要"先拈起来再甩出去"：直接向下平移 + 线性淡出，读起来像牌被吸尘器吸走
    const mid = (gone.length - 1) / 2;
    const jobs = gone.map((c, i) => {
      const n = cardEls.get(c.id);
      if (!n) return Promise.resolve();
      const side = i - mid;
      const a = n.animate([
        { transform: 'translate(0px, 0px) rotate(0deg) scale(1)', opacity: 1, offset: 0,
          easing: 'cubic-bezier(.3,.02,.66,.24)' },
        { transform: `translate(${(side * 9).toFixed(1)}px, -20px) rotate(${(side * 4).toFixed(1)}deg) scale(1.05)`,
          opacity: 1, offset: .3, easing: 'cubic-bezier(.2,.72,.3,1)' },
        { transform: `translate(${(side * 30).toFixed(1)}px, 104px) rotate(${(side * 15).toFixed(1)}deg) scale(.88)`,
          opacity: 0, offset: 1 },
      ], { duration: Math.round(440 / speedMul), delay: Math.round(i * 54 / speedMul), fill: 'both' });
      liveAnims.add(a);
      return a.finished.then(() => {}, () => {}).finally(() => { liveAnims.delete(a); a.cancel(); });
    });
    await Promise.all(jobs);
  }
  if (g !== activeGame) return;
  for (const c of gone) { cardEls.get(c.id)?.remove(); cardEls.delete(c.id); }
  toast(got === 0 ? `弃 ${gone.length} 张` : `弃 ${gone.length} 张 · £${got > 0 ? '+' : ''}${got}`);
  setBusy(false);
  renderAll();
}

/** 把打出的牌甩上桌：从手里的抬起姿态起手，走弧线、过冲、逐张错帧。
 *  为什么不能直接 place()：#tableCards .card 的 transform 规则会把扇形姿态瞬间清零，
 *  牌先在手里塌下去、再瞬移到落点（逐帧采样看到的"洞"就是这个）。 */
function flyToTable(played: Card[]): Promise<void> {
  const table = need('#tableCards');
  const from = played.map((c) => {
    const n = cardEls.get(c.id)!;
    return { n, r: n.getBoundingClientRect(), rot: parseFloat(getComputedStyle(n).getPropertyValue('--rot')) || 0 };
  });
  // 读数区先定型再量落点：否则牌落定后整排会跟着它从 idle 变可见又平移一次
  need('#readout').classList.remove('idle');
  for (const f of from) table.append(f.n);
  void table.offsetWidth;
  const jobs = from.map((f, i) => {
    const t = f.n.getBoundingClientRect();
    const dx = f.r.left - t.left;
    const dy = f.r.top - t.top;
    f.n.style.zIndex = String(40 + i);
    const a = f.n.animate([
      { transform: `translate(${dx}px, ${dy}px) rotate(${f.rot}deg) scale(1.06)`,
        offset: 0, easing: 'cubic-bezier(.3,.02,.62,.3)' },
      { transform: `translate(${(dx * .42).toFixed(1)}px, ${(dy * .42 - 38).toFixed(1)}px) rotate(${(f.rot * .35).toFixed(2)}deg) scale(1.13)`,
        offset: .46, easing: 'cubic-bezier(.18,.74,.28,1)' },
      { transform: 'translate(0px, 7px) rotate(0deg) scale(1.035)',
        offset: .84, easing: 'cubic-bezier(.3,1.5,.5,1)' },
      { transform: 'translate(0px, 0px) rotate(0deg) scale(1)', offset: 1 },
    ], {
      duration: Math.round((470 + i * 26) / speedMul),
      delay: Math.round(i * 72 / speedMul),
      fill: 'both',
    });
    liveAnims.add(a);
    // fulfilled 和 rejection **两条路都要销账**。被 cancel 掉的动画（元素被摘走、
    // 或别处调了 cancel）会让 finished 走拒绝分支；原来这里只写了成功分支，
    // 于是被取消的动画永久留在 liveAnims 里：Animation 对象一直被引着不放，
    // 而且「没有在飞的动画残留」那条判据长期是假的（实测第 4 手停在 anims=3）。
    const settle = (): void => { a.cancel(); liveAnims.delete(a); f.n.style.zIndex = ''; };
    return a.finished.then(settle, settle);
  });
  renderTray();
  return Promise.all(jobs).then(() => undefined);
}

// ── 因果级联：把结算事件一条一条演出来 ───────────────────────
/** 跳过演出：正在飞的牌立刻落定，剩下的事件一次性结算到终值。
 *  一次最简出牌就要锁 1.5 秒，中局三五位客人能锁四五秒——没有跳过就是"按了没反应" */
function requestSkip(): void {
  if (!busy) return;
  ff = true;
  for (const a of liveAnims) { try { a.finish(); } catch { /* 已经结束了 */ } }
}

async function runTimeline(res: ScoreResult, played: Card[], activeGame=g): Promise<void> {
  const landed = flyToTable(played);
  let cardIdx = 0;
  // 连锁第几档：流水/倍注的音效按它往上爬，一路"叮叮叮"越叮越高，
  // 而不是同一颗音符敲十五遍（那听着像坏钟，不像一手好牌）
  let chainStep = 0;
  // 牌还没落定就先不出数字：让观众先看清"打出去的是哪几张"
  await landed;
  if(g!==activeGame)return;

  for (const ev of res.events as ScoreEvent[]) {
    if(g!==activeGame)return;
    if (ff) break;
    switch (ev.t) {
      case 'hand': {
        chipsReel.set(ev.after.chips);
        multReel.set(ev.after.mult);
        totalReel.set(ev.after.value);
        lastTotal = ev.after.value;
        bump('chips'); bump('mult');
        sfx.play('chips');
        await wait(300);
        break;
      }
      case 'blocked': {
        const n = cardEls.get(ev.id);
        if (n) n.classList.add('blocked');
        sfx.play('blocked');
        await wait(180);
        break;
      }
      case 'card': {
        const n = cardEls.get(ev.id);
        if (n) {
          n.classList.add('hop');
          setTimeout(() => n.classList.remove('hop'), Math.round(420 / speedMul));
        }
        chipsReel.set(ev.after.chips);
        if (ev.addMult || ev.xmult !== 1) multReel.set(ev.after.mult);
        totalReel.set(ev.after.value);
        lastTotal = ev.after.value;
        bump('chips');
        sfx.play('card', cardIdx++, suitTint(ev.id));
        await wait(150);
        break;
      }
      case 'patron': {
        // 先让客人欠身，停一拍，数字才动——观众能看清这笔账是谁给的
        const node = patronEls.get(ev.pid);
        if (node) {
          const cls = ev.xmult !== 1 ? 'pulse-x' : 'pulse';
          node.classList.remove('pulse', 'pulse-x');
          void node.offsetWidth;
          node.classList.add(cls);
          setTimeout(() => node.classList.remove(cls), Math.round(620 / speedMul));
        }
        await wait(190);
        if(g!==activeGame)return;
        if (ev.addChips) { chipsReel.set(ev.after.chips); bump('chips'); sfx.play('chips', chainStep); }
        if (ev.addMult) { multReel.set(ev.after.mult); bump('mult'); sfx.play('mult', chainStep); }
        if (ev.xmult !== 1) { multReel.set(ev.after.mult); bump('mult'); sfx.play('xmult', chainStep); }
        chainStep += 1;
        totalReel.set(ev.after.value);
        lastTotal = ev.after.value;
        if (ev.addChips || ev.addMult || ev.xmult !== 1) {
          const touched = ev.cardId != null ? cardEls.get(ev.cardId) : null;
          if (touched) {
            touched.classList.add('gain');
            setTimeout(() => touched.classList.remove('gain'), Math.round(500 / speedMul));
          }
        }
        await wait(ev.xmult !== 1 ? 300 : 180);
        break;
      }
      case 'bonus': {
        // P0-3 阈值达成：这一行要看得见"是哪条线被跨过"，不能只是数字又涨了
        if (ev.addChips) { chipsReel.set(ev.after.chips); bump('chips'); }
        if (ev.addMult || ev.xmult !== 1) { multReel.set(ev.after.mult); bump('mult'); }
        totalReel.set(ev.after.value);
        lastTotal = ev.after.value;
        cueLabel(ev.source, ev.xmult !== 1 ? 'x' : '+');
        // 阈值达成要有自己的一声：只播「流水又涨了」，玩家分不清是客人给的还是跨过线了
        sfx.play('bonus');
        await wait(240);
        break;
      }
      case 'shatter': {
        const n = cardEls.get(ev.id);
        if (n) n.classList.add('shatter');
        sfx.play('shatter');
        await wait(340);
        break;
      }
      case 'total': {
        // 流水与倍注已在每一步如实更新，这里只给结果一个收口的重音
        totalReel.set(ev.after.value);
        lastTotal = ev.after.value;
        need('.readout .total .reel').classList.add('pop');
        setTimeout(() => q('.readout .total .reel')?.classList.remove('pop'), Math.round(520 / speedMul));
        bump('total');
        sfx.play('total');
        await wait(140);
        break;
      }
    }
  }

  // 跳过演出：读数直接跳到终值。事件流里每条都自带 after 快照，
  // 所以"补完"不需要重算一遍——这正是 ADR-0002 那条架构白送的能力
  if(g!==activeGame)return;
  if (ff) { applyEventsSync(res, played, -1, false); ff = false; }

  renderScoreline();
  await afterScore(res,activeGame);
}

/** 一手的收尾：过关就开铺子，打完还没够就散场。动画路径和抓帧路径共用这一段 */
async function afterScore(res: ScoreResult, activeGame=g): Promise<void> {
  if(g!==activeGame)return;
  const target = targetOf(g.state);
  const mag = res.value / Math.max(1, target);
  renderScoreline();
  renderGauges();
  void mag;
  flare(res.value / Math.max(1, target));

  if (g.state.status === 'cleared') {
    await wait(200);
    if(g!==activeGame)return;
    need('.felt', need('#board')).classList.add('cleared');
    sfx.play('seal');
    sfx.play('clear');
    await wait(850);
    if(g!==activeGame)return;
    // 结清幕：把这一场的进账一条条念完再进铺子。钱不是凭空多出来的
    await showCurtain({
      kicker: '本场结清',
      title: stakeLabel(g.state),
      blurb: `彩头 ${num(targetOf(g.state))}，做出 ${num(g.state.score)}`,
      lines: g.state.settlement.map((l) => ({ label: l.label, amount: l.amount })),
      sum: '1',
    });
    if(g!==activeGame)return;
    const gained = g.state.settlement.reduce((a, l) => a + l.amount, 0);
    g.openShop();
    setBusy(false);
    renderAll();
    renderShop();
    openPanel('shop');
    saveNow();
    flyMoney(gained);
  } else if (g.state.status === 'lost') {
    sfx.play('fail');
    await wait(520);
    if(g!==activeGame)return;
    setBusy(false);
    STORE.del();
    refreshResume();
    showEnd(false);
  } else {
    setBusy(false);
    renderAll();
  }
}

/** 抓帧路径：把前 n 个事件一次性落成视觉状态，不依赖任何计时器 */
function applyEventsSync(res: ScoreResult, played: Card[], n: number, finish=true): void {
  place(need('#tableCards'), played);
  need('#readout').classList.remove('idle');
  const upto = n < 0 ? res.events.length : Math.min(n, res.events.length);
  for (const pid of patronEls.values()) pid.classList.remove('cue');
  for (let i = 0; i < upto; i++) {
    const ev = res.events[i];
    switch (ev.t) {
      case 'hand':
        chipsReel.set(ev.after.chips);
        multReel.set(ev.after.mult);
        break;
      case 'blocked':
        cardEls.get(ev.id)?.classList.add('blocked');
        break;
      case 'card':
        chipsReel.set(ev.after.chips);
        if (ev.addMult || ev.xmult !== 1) multReel.set(ev.after.mult);
        break;
      case 'patron': {
        if (ev.addChips) chipsReel.set(ev.after.chips);
        if (ev.addMult || ev.xmult !== 1) multReel.set(ev.after.mult);
        const node = patronEls.get(ev.pid);
        if (node) {
          for (const pid of patronEls.values()) pid.classList.remove('cue');
          node.classList.add('cue');
        }
        break;
      }
      case 'bonus': {
        // 跳过/抓帧路径也照样要把这条落进读数——after 快照就是权威值
        if (ev.addChips) chipsReel.set(ev.after.chips);
        if (ev.addMult || ev.xmult !== 1) multReel.set(ev.after.mult);
        break;
      }
      case 'shatter':
        cardEls.get(ev.id)?.classList.add('gone');
        break;
      case 'total':
        break;
    }
    // 每一步都把三个数落到当前快照，抓帧才可能拍到"演到第几步"的真实状态
    totalReel.set(ev.after.value);
    lastTotal = ev.after.value;
  }
  if (finish && upto >= res.events.length) void afterScore(res);
}

function bump(which: 'chips' | 'mult' | 'total'): void {
  const r = need(`.readout .${which}`);
  r.classList.remove('bump');
  void r.offsetWidth;
  r.classList.add('bump');
}

/** 阈值达成时飘出来的那条名字。硬约束 2 要的是"一行可解释"——
 *  只看见数字又涨了不算解释，得写明是哪条线被跨过。 */
let cueTimer = 0;
// 飘出来过几条"跨过哪条线"。演出路径有没有真的把 bonus 演出来，靠这个数才能确定地验——
// 只看最后读数不行：total 那条事件本来就会把终值补上，注入掉 bonus 分支也照样"对"。
let cueCount = 0;
function cueLabel(text: string, mark: '+' | 'x'): void {
  cueCount += 1;
  if (SNAP || prefs.calm) return;
  const box = need('#readout');
  const n = el('span', 'cue-pop');
  n.textContent = `${mark === 'x' ? '× ' : '+ '}${text}`;
  box.append(n);
  setTimeout(() => n.remove(), Math.round(1100 / speedMul));
}

/** 水位条上"还差多少"的那道刻度与提示（progressVisible=false 的阈值不进这里） */
function renderThresholdMarks(): void {
  const track = q('.scoreline .track');
  if (!track) return;
  track.querySelectorAll('.tmark').forEach((n) => n.remove());
  if (!g.state.flags.thresholds) { q('#gapNote')?.remove(); return; }
  const line = targetOf(g.state);
  const handValue = lastTotal;
  for (const d of THRESHOLDS) {
    if (d.span !== 'hand' || !d.progressVisible) continue;
    if (g.state.claimed.includes(d.id)) continue;
    const v = thresholdValue(d, line);
    const pct = Math.min(100, (v / Math.max(1, line)) * 100);
    const tick = el('i', 'tmark');
    tick.style.left = `${pct.toFixed(2)}%`;
    tick.title = d.blurb;
    track.append(tick);
  }
  const gap = nextGap(THRESHOLDS, g.state.claimed, handValue, line);
  const note = q('#gapNote');
  if (!gap) { if (note) note.remove(); return; }
  const n = note ?? el('div', 'gap-note');
  if (!note) need('.scoreline').append(n);
  n.id = 'gapNote';
  n.textContent = `还差 ${num(gap.gap)} 够到「${gap.def.name}」`;
}

/** 古典英伦的"震屏"是烛光一晃与牌桌一沉，不是镜头抖动 */
function flare(mag: number): void {
  const l = need('#light');
  l.classList.remove('flare');
  void l.offsetWidth;
  l.classList.add('flare');
  setTimeout(() => l.classList.remove('flare'), Math.round(900 / speedMul));
  if (mag > 1.3) {
    const felt = need('.felt', need('#board'));
    felt.classList.remove('settle');
    void felt.offsetWidth;
    felt.classList.add('settle');
  }
}

// ── 存档 ─────────────────────────────────────────────────────
// localStorage 在隐私模式或被禁用时会抛，所以整条路都要包起来：
// 存不了不能影响玩，只是没有"继续上一局"。
const STORE = createSaveStore(() => localStorage);
function saveNow(): void {
  const ended = g.state.status === 'won' || g.state.status === 'lost';
  const reportSaved=!ended||saveReport(makeReport(g.state,g.state.status==='won',new Date().toLocaleDateString('sv-SE')));
  const saved = ended&&reportSaved ? STORE.del() : STORE.set(dumpSave(g));
  const note = need('#saveStatus');
  note.textContent = saved ? '' : '进度暂未保存，请保留窗口并重试';
  note.classList.toggle('failed', !saved);
  refreshResume();
}
window.addEventListener('pagehide', () => { if (atTable()) saveNow(); });

function refreshResume(): void {
  const btn = need<HTMLButtonElement>('#btnResume');
  const note = need('#resumeNote');
  const sum = (() => { const t = STORE.get(); return t ? sumSave(t) : null; })();
  if (!sum || sum.status === 'won' || sum.status === 'lost') {
    btn.hidden = true;
    note.hidden = true;
    return;
  }
  btn.hidden = false;
  note.hidden = false;
  note.textContent = `上一局：第 ${sum.night} 夜 · ${STAGE_LABEL[STAGE_KIND[sum.stage]]} · £${sum.money} · ${sum.seats} 位客人`;
}

// ── 第一次开机：先递课表 ──────────────────────────────────
/**
 * 只在"这台机器从没上过课、手上又没有半局存档"时拦路。
 * 有存档说明已经在打了，这时候弹一张要不要上课，会把「续上第 N 夜」那一下点击挡在门外；
 * 抓帧档（?snap=1）也不弹：那是给人看牌桌的，半路插一张卡会把样张毁掉。
 */
function refreshIntro(): void {
  const t = STORE.get();
  const sum = t ? sumSave(t) : null;
  // 抓帧要能把它钉住看一眼：?intro=1 明说「我就是来看这张卡的」，绕开 snap 的静默规则
  const first = !prefs.guide && !sum && (!SNAP || params.get('intro') === '1');
  need('#guideIntro').classList.toggle('hidden', !first);
}

const hideIntro = (): void => { need('#guideIntro').classList.add('hidden'); };

/** 不开课直接开局：这张卡的任务只是"第一次别懵"，选错了不该有第二次后果 */
function skipIntro(): void {
  prefs.guide = true;
  savePrefs();
  hideIntro();
}

// ── 设置与偏好 ────────────────────────────────────
// 音量、动画速度、减少动效、环境音。存不下来也不能影响玩。
interface Prefs { vol: number; speed: number; calm: boolean; ambience: boolean; style: string; muted: boolean; deck: string; mode: Mode; diff: Diff; track: number; flags: FeatureFlags; signature: string; tutorial: boolean; guide: boolean; nights: number }
const PREF_KEY = 'guinea.prefs.v1';
const DEFAULT_PREFS: Prefs = {
  vol: 0.7, speed: 1, calm: false, ambience: true, style: 'default', muted: false,
  deck: 'standard', mode: 'run', diff: 'standard', track: 0, flags: { ...FLAGS_OFF },
  // 新手引导默认开：新装的人第一眼就该被领一下。老玩家可在 设置 → 新手引导 关掉，
  // 或按一次「全部跳过」——那会把这一局剩下的条目一次性记成讲过。
  tutorial: true,
  // guide 记的是"第一课还拦不拦路"：false 才是第一次玩，开机先递一张课表。
  // 点过 either 按钮（上课 / 我自己开）就置 true，以后再启动不再拦。
  guide: false,
  signature: '',
  // 局长默认八夜：这一版曲线就是照它定的，选不选都该先落在参照档上
  nights: DEFAULT_NIGHTS,
};
const STYLES: [string, string][] = [['default', '维多利亚'], ['deco', '装饰艺术'], ['engraving', '铜版画'], ['leather', '暖皮革']];
let prefs: Prefs = DEFAULT_PREFS;

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const o = JSON.parse(raw) as Partial<Prefs>;
    const num = (v: unknown, lo: number, hi: number, d: number): number =>
      typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
    return {
      vol: num(o.vol, 0, 1, DEFAULT_PREFS.vol),
      speed: num(o.speed, 0.5, 2, DEFAULT_PREFS.speed),
      calm: o.calm === true,
      ambience: o.ambience !== false,
      style: typeof o.style === 'string' && STYLES.some(([k]) => k === o.style) ? o.style : 'default',
      muted: o.muted === true,
      deck: typeof o.deck === 'string' && DECKS.some((d) => d.id === o.deck) ? o.deck : 'standard',
      mode: MODES.some((m) => m.id === o.mode) ? o.mode as Mode : 'run',
      diff: DIFFS.some((d) => d.id === o.diff) ? o.diff as Diff : 'standard',
      track: typeof o.track === 'number' && Number.isInteger(o.track) ? num(o.track, 0, TUNES.length, 0) : 0,
      // 偏好里的 flags 也是外部输入：走同一个清洗，缺省落在"全关"上
      flags: sanitizeFlags(o.flags, { ...FLAGS_OFF }),
      // 签名宾只认表里真有的 id；认不出就当没选过，不凭空塞一位客人进新局
      signature: typeof o.signature === 'string' && PATRONS.some((x) => x.id === o.signature)
        ? o.signature : '',
      // 引导开关：只有明确写了 false 才关。缺键（老偏好）落在默认的开上
      tutorial: o.tutorial !== false,
      // 第一课：只有明确写了 true 才算上过。缺键（这份偏好早于引导关）就当第一次玩，
      // 开机递一张课表让他自己选——拦一次不丢人，漏掉一门课才可惜
      guide: o.guide === true,
      // 局长也是外部输入：偏好里躺着 2、16、"八" 都不奇怪，一律走内核同一把夹子
      nights: clampNights(o.nights),
    };
  } catch { return { ...DEFAULT_PREFS }; }
}
function savePrefs(): void {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(prefs)); } catch { /* 存不下就算了 */ }
}
function applyPrefs(): void {
  document.documentElement.dataset.calm = prefs.calm ? '1' : '0';
  document.documentElement.dataset.style = prefs.style === 'default' ? '' : prefs.style;
  // 节奏这一排要真的改到时间轴上，否则它只是一个会亮的按钮
  speedMul = Math.max(0.05, prefs.speed);
  // 音量与"手动静音"是两件事：改音量不该把玩家按下去的静音冲掉
  sfx.setVolume(prefs.vol);
  sfx.muted = prefs.muted || prefs.vol === 0;
  if (prefs.ambience && !SNAP) sfx.ambienceOn(); else sfx.ambienceOff();
  // 引导开关要立刻见效：不重画一次的话，按下关闭之后气泡还挂在屏幕上，
  // 那这个开关看着就是坏的——它是唯一一处改了偏好却没人重投影的地方
  refreshTutorial();
  // 背景乐跟着总音量与静音走，但留一档自己的比例：曲子盖过落牌声就很难受
  music.setLevel(prefs.muted || prefs.vol === 0 ? 0 : prefs.vol * 0.42);
  music.select(prefs.track > 0 && !SNAP ? TUNES[prefs.track - 1].id : null);
  // 静音的真实状态可能被音量改掉，按钮文案要跟着走，否则会出现"♪ 但其实没声"
  paintSoundBtn();
  // 每一排设置都走这条路生效，所以落盘也放在这里：
  // 之前只有静音按钮自己 savePrefs，音量/节奏/画法/底噪改完重启就全丢了
  savePrefs();
}

// ── 银钱进账的飞币 ───────────────────────────────────────────
/** 钱不是悄悄变多的：一枚几尼从进账处飞进右上角钱袋 */
function flyMoney(amount: number, from?: HTMLElement | null): void {
  if (SNAP || prefs.calm || amount === 0) return;
  const purse = q('#purseVal');
  if (!purse) return;
  const dst = purse.getBoundingClientRect();
  const src = from ? from.getBoundingClientRect()
    : new DOMRect(dst.left, dst.top + 40, 0, 0);
  const token = el('span', 'fly');
  token.textContent = '£';
  token.style.left = `${src.left + src.width / 2 - 13}px`;
  token.style.top = `${src.top + src.height / 2 - 13}px`;
  token.style.setProperty('--dx0', '0px');
  token.style.setProperty('--dy0', '0px');
  token.style.setProperty('--dx1', `${dst.left + dst.width / 2 - src.left - src.width / 2}px`);
  token.style.setProperty('--dy1', `${dst.top + dst.height / 2 - src.top - src.height / 2}px`);
  document.body.append(token);
  const ms = 820 / speedMul;   // 与 .fly 的 keyframes 时长对齐，别提前把硬币摘掉
  setTimeout(() => token.remove(), ms + 60);
  sfx.play('cash');
}

// ── 幕间：贵客进门 / 本场结清 ────────────────────────────────
interface CurtainSpec {
  kicker: string;
  title: string;
  blurb: string;
  lines?: { label: string; amount: number }[];
  sum?: string;
}
let curtainResolve: (() => void) | null = null;

function showCurtain(spec: CurtainSpec): Promise<void> {
  const box = need('#curtain');
  need('#curtainKicker').textContent = spec.kicker;
  need('#curtainTitle').textContent = spec.title;
  need('#curtainBlurb').textContent = spec.blurb;
  const lines = need('#curtainLines');
  lines.textContent = '';
  let total = 0;
  // 一行一行报，而不是一整块淡进来：这才是"把账念完"
  let li = 0;
  const step = SNAP ? 0 : 92;
  for (const ln of spec.lines ?? []) {
    const d = el('div', 'cl');
    d.style.animationDelay = `${li++ * step}ms`;
    const a = el('span');
    a.textContent = ln.label;
    const b = el('b');
    b.textContent = `+£${ln.amount}`;
    d.append(a, b);
    lines.append(d);
    total += ln.amount;
  }
  if (spec.sum) {
    const d = el('div', 'cl sum');
    d.style.animationDelay = `${li++ * step}ms`;
    const a = el('span');
    a.textContent = '合计入账';
    const b = el('b');
    b.textContent = `£${total}`;
    d.append(a, b);
    lines.append(d);
  }
  box.classList.remove('hidden');
  // 抓帧时让幕布停在画面里，否则 snap 模式一律立刻放行（否则 await 会把流程挂住）
  if (SNAP && params.get('curtain') !== 'hold') return Promise.resolve();
  return new Promise<void>((resolve) => { curtainResolve = resolve; });
}

function dismissCurtain(): boolean {
  const box = need('#curtain');
  if (box.classList.contains('hidden')) return false;
  box.classList.add('hidden');
  const r = curtainResolve;
  curtainResolve = null;
  if (r) r();
  return true;
}

// ── 牌型图鉴 ─────────────────────────────────────────────────
let codexTab = 'hands';
function renderCodex(): void {
  const body = need('#codexBody');
  body.textContent = '';
  const tabs = el('div', 'reference-tabs');
  for (const [id, name] of [['hands', '牌型'], ['patrons', '客人'], ['letters', '引荐信'], ['books', '牌谱'], ['vouchers', '特权'], ['rare', '稀奇牌'], ['deck', '本局牌组']]) {
    const btn = el('button', `pick${codexTab === id ? ' on' : ''}`);
    btn.textContent = name; btn.dataset.tab = id;
    btn.setAttribute('aria-pressed', String(codexTab === id));
    btn.addEventListener('click', () => { codexTab = id; renderCodex(); need<HTMLButtonElement>(`[data-tab="${id}"]`, body).focus(); });
    tabs.append(btn);
  }
  body.append(tabs);
  if (codexTab==='rare') {
    const intro=el('p','reference-note');intro.textContent='基础六种稀奇牌来自「夜间奇遇」事件；新增八种可通过「经营奇遇」的委托奖励与故事获得。牌性与强化、蜡封并存；收藏留手成长、拾遗弃牌蓄力，其余按牌面条件触发。';body.append(intro);
    for (const card of SPECIALS) {const entry=el('article','catalog-entry rare-entry');const h=el('h3');h.textContent=`${card.glyph} ${card.name}`;const p=el('p');p.textContent=card.blurb;entry.append(h,p);body.append(entry);}return;
  }
  if (codexTab === 'deck') { renderDeck(body, g.state); return; }
  if (codexTab !== 'hands') { renderCatalog(body, codexTab, g.state); return; }
  const note = el('p', 'reference-note');
  note.textContent = '深色边框的示例牌参与牌型计分；浅色为陪牌。下面是基础流水与倍注，客人与强化会继续改变结果。';
  body.append(note);
  const order: HandKind[] = ['high', 'pair', 'twopair', 'three', 'straight', 'flush',
    'full', 'four', 'sf', 'royal', 'five', 'flushhouse', 'flushfive'];
  // 隐秘与否按 SECRET_HANDS 判，不能按数组下标切——皇家同花顺不是隐秘牌型
  const mk = (k: HandKind, secret: boolean): HTMLElement => {
    const d = el('div', `codex-row${secret ? ' secret' : ''}`);
    const lv = levelOf(g.state, k);
    const b = handBase(k, lv);
    const seen = !secret || g.state.discovered.includes(k);
    if (!seen) d.classList.add('locked');
    const cn = el('span', 'cn');
    cn.textContent = seen ? HANDS[k].name : '未见的牌型';
    const cv = el('span', 'cv');
    cv.textContent = `${num(b.chips)} 流水`;
    const cx = el('span', 'cx');
    cx.textContent = `× ${b.mult}`;
    const ct = el('span', 'ct');
    ct.textContent = `${lv} 级`;
    const cl = el('span', 'cl2');
    cl.textContent = seen
      ? (HANDS[k].book + ' 升一级：+' + HANDS[k].dMult + ' 倍注 / +' + HANDS[k].dChips + ' 流水')
      : '用「誊抄」造出重复的牌，凑出来一次就记在本局图鉴';
    d.append(cn, cv, cx, ct, cl);
    if (seen) d.append(handExample(k));
    return d;
  };
  const h1 = el('div', 'codex-h');
  h1.textContent = '常 用 牌 型';
  body.append(h1);
  for (const k of order.filter((x) => !SECRET_HANDS.includes(x))) body.append(mk(k, false));
  const h2 = el('div', 'codex-h');
  h2.textContent = '秘 密 牌 型';
  body.append(h2);
  for (const k of order.filter((x) => SECRET_HANDS.includes(x))) body.append(mk(k, true));
}

// ── 侧页 ─────────────────────────────────────────────────────
type Panel = 'shop' | 'ledger' | 'codex' | 'settings' | 'club';
const PANELS:Panel[]=['shop','ledger','codex','settings','club'];
let panelFocus:HTMLElement|null=null;
function renderClubPanel():void {
  const activeGame=g;
  const change=(fn:()=>boolean):void=>{if(busy||g!==activeGame)return;if(fn()){renderAll();if(g.state.status==='shop')renderShop();saveNow();}};
  renderClub(g,need('#clubBody'),{busy,accept:id=>change(()=>acceptCommission(g,id)),skip:()=>change(()=>skipCommission(g)),claim:id=>change(()=>claimCommission(g,id)),story:id=>change(()=>chooseStory(g,id))});
}
function openPanel(which: Panel): void {
  if(which==='shop'&&g.state.status!=='shop')return;
  panelFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
  for (const p of PANELS) {
    need(`#${p}`).inert=p!==which;
    if (p !== which) need(`#${p}`).classList.remove('open');
  }
  if (which === 'shop') renderShop();
  else if (which === 'ledger') renderLedger();
  else if (which === 'codex') renderCodex();
  else if(which==='club')renderClubPanel();
  else renderSettings();
  need(`#${which}`).classList.add('open');
  need<HTMLButtonElement>('button',need(`#${which}`)).focus();
  if (which === 'codex' && coach) { coach.classList.add('hidden'); delete coach.dataset.step; delete coach.dataset.kind; }
  // 铺子里那两个锚点（请客/抬注）只有面板开着才量得到；等一帧让布局落定再重贴
  setTimeout(() => refreshTutorial(), 0);
}
function closePanels(): void {
  const wasCodex = need('#codex').classList.contains('open');
  for (const p of PANELS){need(`#${p}`).classList.remove('open');need(`#${p}`).inert=true;}
  if(panelFocus?.isConnected)panelFocus.focus();panelFocus=null;
  if (wasCodex) refreshTutorial();
}
window.addEventListener('resize', () => refreshTutorial());

function nextStageOf(): { night: number; stage: Stage } {
  return g.state.stage < 2
    ? { night: g.state.night, stage: (g.state.stage + 1) as Stage }
    : { night: g.state.night + 1, stage: 0 };
}

function renderShop(): void {
  const body = need('#shopBody');
  body.textContent = '';
  const lim = limits(g.state);

  const money = el('div', 'shop-money');
  const lbl = el('span');
  lbl.innerHTML = '<span style="font-size:11px;letter-spacing:.22em;color:#7a6039">银 钱</span>';
  const mb = el('b');
  mb.textContent = `£${g.state.money}`;
  money.append(lbl, mb);
  body.append(money);

  const slots = el('div', 'slots');
  g.state.shop.forEach((slot, i) => {
    const n = el('div', 'slot');
    n.style.animationDelay = SNAP ? '0ms' : `${120 + i * 78}ms`;
    let name = '';
    let desc = '';
    let role = '';
    if (slot.kind === 'patron') {
      const p = patronById(slot.pid!);
      name = p.name; desc = p.blurb;
      role = `${RARITY_LABEL[p.rarity]} · ${HOOK_LABEL[p.hook]}${slot.edition && slot.edition !== 'none' ? ` · ${EDITION_NAME[slot.edition]}` : ''}`;
      if (slot.edition && slot.edition !== 'none') n.classList.add(`ed-${slot.edition}`, 'has-ed');
    } else if (slot.kind === 'consumable') {
      const c = slot.item!;
      if (c.t === 'letter') { const l = letterById(c.id); name = l.name; desc = l.blurb; role = '引荐信'; }
      else { name = HANDS[c.id].book; desc = `使用后 ${HANDS[c.id].name} 升一级`; role = '牌谱'; }
    } else {
      const v = VOUCHERS.find((x) => x.id === slot.vid)!;
      name = v.name; desc = v.blurb; role = '会员特权';
      n.classList.add('wide');
    }
    if (slot.kind === 'patron') {
      const pf = el('span', 'slot-pf');
      // 肖像底色只认脾气（+本人色偏）：版本是"同一位客人的更讲究的副本"，不该换一张脸的颜色
      pf.style.background = portraitGround(patronById(slot.pid!).temperament, slot.pid!);
      pf.innerHTML = portraitSvg(slot.pid!, patronById(slot.pid!).rarity);
      n.append(pf);
    }
    const top = el('div', 'top');
    const nm = el('span', 'nm');
    nm.textContent = name;
    const pr = el('span', 'pr');
    pr.textContent = `£${slot.price}`;
    top.append(nm, pr);
    const rl = el('div', 'rl');
    rl.textContent = role;
    const de = el('div', 'de');
    de.textContent = desc;
    n.append(top, rl, de);
    const full = (slot.kind === 'patron' && slot.edition!=='negative' && seatedCount(g.state) >= lim.seats)
      || (slot.kind === 'consumable' && g.state.consumables.length >= lim.slots);
    const cant = slot.sold || g.state.money < slot.price || full;
    if (slot.sold) n.classList.add('sold');
    else if (cant) {
      n.classList.add('disabled');
      if (full) de.textContent = '席位或随身已满载';
    } else n.addEventListener('click', () => {
      if (busy) return;
      const paid = slot.price;
      if (buy(g, i)) { sfx.play('seat'); flyMoney(-paid, n); renderShop(); renderAll(); saveNow(); toast(g.state.log[0] ?? '进了货'); }
    });
    slots.append(n);
  });
  body.append(slots);

  // P1-1 凑齐了哪些套装，直接列在货位下面——不然"为 tag 构筑"看不见反馈
  if (g.state.flags.sets) {
    const act = activeSets(g.state.seats.map((x) => patronById(x.pid)));
    const names = act.map((x) => x.name);
    if (seenSets !== null && names.some((n) => !seenSets.includes(n))) sfx.play('set');
    seenSets = names;
    const box = el('div', 'sets-box');
    const h = el('h4');
    h.textContent = '凑 齐 的 套 装';
    box.append(h);
    if (!act.length) {
      const p = el('p', 'sets-none');
      p.textContent = '还没有。同一门的人坐齐两位才有。';
      box.append(p);
    }
    for (const s of act) {
      const r = el('div', 'set-line');
      r.textContent = setLine(s);
      box.append(r);
    }
    body.append(box);
  }

  // P1-4 弃牌堆：看得见，花 £5 能把一张放回牌堆底
  if (g.state.flags.discardOps) {
    const pile = peekDiscard(g.state, 8);
    const box = el('div', 'discard-box');
    const h = el('h4');
    h.textContent = `弃 牌 堆（共 ${g.state.discardPile.length} 张，最近 ${pile.length} 张）`;
    box.append(h);
    if (!pile.length) {
      const p = el('p', 'sets-none');
      p.textContent = '还没弃过牌。';
      box.append(p);
    }
    for (const c of pile) {
      const row = el('div', 'd-row');
      const nm = el('span');
      nm.textContent = `${RANK_LABEL(c.rank)}${SUIT_GLYPH[c.suit]}`;
      const de = el('span', 'd-e');
      // 层名一律从两张层表里取，界面上不再自己抄一份中文
      const m = materialById(c.enh);
      const sl = sealById(c.seal);
      de.textContent = [c.enh === 'none' ? '' : m.name, c.seal === 'none' ? '' : sl.name]
        .filter(Boolean).join(' · ');
      row.append(nm, de);
      const f = el('button', 'brass-btn ghost small');
      f.textContent = `捞回 £${FISH_COST}`;
      f.disabled = g.state.money < FISH_COST;
      f.addEventListener('click', () => {
        if (fishDiscard(g, c.id)) { sfx.play('fish'); renderShop(); saveNow(); toast('那张牌回到了牌堆底'); }
      });
      row.append(f);
      box.append(row);
    }
    body.append(box);
  }

  const seat = el('div', 'seatnote');
  seat.textContent = `座位 ${seatedCount(g.state)} / ${lim.seats}　随身 ${g.state.consumables.length} / ${lim.slots}　利息上限 £${lim.interestCap}　牌堆 ${g.state.deck.length} 张`;
  body.append(seat);

  // 抬注：经营闭环里由玩家主动按下的那一侧
  const raise = el('div', 'raise');
  const h3 = el('h3');
  h3.textContent = '抬 注';
  const p = el('p');
  p.textContent = '不花银钱，只押风险。下一场彩头逐档 ×1.5，赏金与盈余折现同步加厚，扛住还记声望；抬得越高，来客档次也越高。';
  const steps = el('div', 'steps');
  const stack = el('div', 'chips-stack');
  for (let lv = 0; lv < 4; lv++) {
    const c = el('i');
    c.className = lv < g.state.raiseNext ? 'on' : 'off';
    c.style.setProperty('--h', `${8 + lv * 5}px`);
    stack.append(c);
  }
  const nxt = nextStageOf();
  for (let lv = 0; lv <= 4; lv++) {
    const s = el('div', 'step');
    if (g.state.raiseNext === lv) s.classList.add('on');
    const big = el('span');
    big.textContent = lv === 0 ? '不抬' : `×${(Math.pow(1.5, lv)).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`;
    const small = el('small');
    const bet = betFor(lv);
    small.textContent = lv === 0 ? '稳妥过关'
      : `彩头 ${num(nextTarget(g.state, lv))}`
        + (g.state.flags.bets ? `\n失手：${bet.visibleHint ? penaltyName(bet.failPenalty) : '后果不明'}` : '');
    small.style.whiteSpace = 'pre-line';
    s.title = betLine(bet);
    s.append(big, small);
    s.addEventListener('click', () => { setRaise(g, lv); sfx.play('raise', lv); renderShop(); saveNow(); });
    steps.append(s);
  }
  raise.append(h3, p, steps, stack);
  body.append(raise);

  const foot = el('div', 'shop-foot');
  const rr = el('button', 'brass-btn ghost');
  const price = rerollPrice(g.state);
  rr.textContent = price === 0 ? '重掷 · 免费' : `重掷 £${price}`;
  rr.disabled = g.state.money < price;
  rr.addEventListener('click', () => { if (reroll(g)) { sfx.play('deal'); renderShop(); saveNow(); } });
  const last = g.state.stage === 2 && g.state.night >= g.state.nights && !g.state.endless;
  const lv2 = el('button', 'brass-btn big leave');
  lv2.textContent = last ? '散 局' : '入下一场';
  const rewardDue=g.state.flags.club&&g.state.club?.contract?.status==='ready';
  (lv2 as HTMLButtonElement).disabled=!!rewardDue;lv2.title=rewardDue?'请打开委托簿，先选择这次委托的奖励':'';
  if(rewardDue){const claim=el('button','brass-btn club-alert');claim.textContent='委托已达成 · 前往领奖';claim.addEventListener('click',()=>openPanel('club'));body.append(claim);}
  lv2.addEventListener('click', async () => {
    if (busy||g.state.status!=='shop') return;
    const activeGame=g,night=g.state.night;
    closePanels();
    g.next();
    if (g.state.status === 'won') { showEnd(true); STORE.del(); refreshResume(); return; }
    resetTable();
    renderAll();
    saveNow();
    if(g.state.flags.club&&g.state.night!==night)openPanel('club');
    if (STAGE_KIND[g.state.stage] === 'boss') {
      // 贵客进门：不请自来，这一场不能跳过
      setBusy(true);
      sfx.play('boss');
      await showCurtain({ kicker: '不速之客', title: stakeLabel(g.state), blurb: stakeBlurb(g.state) });
      if(g!==activeGame)return;
      setBusy(false);
      renderAll();
    } else {
      toast(`第 ${g.state.night} 夜 · ${STAGE_LABEL[STAGE_KIND[g.state.stage]]}`);
    }
  });
  // 铺子里住着两节课（请客人、抬注），而那两处点完只重画铺子不重画牌桌：
  // 不在这儿补一次投影，请完客人之后气泡还挂在「请第一位客人」上——做完了没反应，比不教更糟
  foot.append(rr, lv2);
  body.append(foot);
  refreshTutorial();
}

function seg(rows: [string, number | boolean, string?][], cur: number | boolean, onPick: (v: number | boolean) => void): HTMLElement {
  const box = el('div', 'seg');
  rows.forEach(([label, v, hint], i) => {
    const b = el('button');
    b.textContent = String(label);
    if (hint) b.title = hint;
    if (v === cur || (i === 0 && cur === undefined)) b.classList.add('on');
    b.addEventListener('click', () => { onPick(v); renderSettings(); });
    box.append(b);
    void i;
  });
  return box;
}

function setRow(label: string, desc: string, ctl: HTMLElement): HTMLElement {
  const r = el('div', 'set-row');
  const l = el('div', 'sl');
  l.textContent = label;
  const d = el('span', 'sd');
  d.textContent = desc;
  l.append(d);
  r.append(l, ctl);
  return r;
}

function renderSettings(): void {
  const body = need('#settingsBody');
  body.textContent = '';
  body.append(setRow('音量', '牌局里的落牌、进账与客人开口的响动',
    seg([['静', 0], ['轻', 0.4], ['中', 0.7], ['满', 1]], prefs.vol, (v) => { prefs.vol = Number(v); applyPrefs(); })));
  body.append(setRow('节奏', '整套动效的快慢。嫌拖慢一点，嫌闷放快一点',
    seg([['慢', 0.75], ['适中', 1], ['快', 1.5]], prefs.speed, (v) => { prefs.speed = Number(v); applyPrefs(); })));
  body.append(setRow('减少动效', '关掉飞币、烛光呼吸与大部分过渡',
    seg([['关', false], ['开', true]], prefs.calm, (v) => { prefs.calm = v === true; applyPrefs(); })));
  body.append(setRow('画法', '四种风格共用同一套布局与逻辑，只换令牌层',
    seg(STYLES.map(([k, label]) => [label, k] as [string, string | boolean]), prefs.style,
      (v) => { prefs.style = String(v); applyPrefs(); })));
  body.append(setRow('厅堂底噪', '壁炉与房间的极轻环境音',
    seg([['无声', false], ['有', true]], prefs.ambience, (v) => { prefs.ambience = v === true; applyPrefs(); })));
  // 名单从 TUNES 生成：加了曲子不必记得回来改按钮，也不会出现"表里有、点上没有"
  body.append(setRow('新手引导', `按局面的进度一句话一句话地领：还剩 ${remaining(g.state.tutorial)} 条。
    只提示，不参与算分——关不关它，发牌与结算都一模一样`,
    seg([['关', false], ['开', true]], prefs.tutorial,
      (v) => { prefs.tutorial = v === true; applyPrefs(); renderSettings(); })));
  // 引导关是"上一局课"，不是常驻提示，所以这里给的是重上入口而不是开关：
  // 课上完（或退出）之后 prefs.guide 置真，开场那张课表卡就再也不拦路了
  const retake = el('button', 'brass-btn ghost small');
  retake.id = 'btnReplayGuide';
  retake.textContent = '再上一次';
  retake.title = '开一局锁死种子的教学局，跟着气泡走一遍';
  retake.addEventListener('click', () => { closePanels(); startGuide(); });
  body.append(setRow('第一课', `${LESSONS.length} 节小课从头走一遍牌桌。这一局${inGuide(g.state.guide) ? `还剩 ${lessonsLeft(g.state.guide)} 节没上完` : '不是教学局，按右边那颗就开一局课'}。
    教学局用的种子、牌组、难度都锁死，玩法与普通局同一条代码——上课与不上课，同一颗种子发出同一副牌`, retake));
  body.append(setRow('背景曲', `${TUNES.length} 首都是现场合成的，不挂任何音频素材。鼠标停在曲名上看它适合什么时候放`,
    seg([['无', 0] as [string, number | boolean, string?]].concat(
      TUNES.map((x, i) => [x.short, i + 1, `${x.name}｜${x.scene}｜${x.blurb}`] as [string, number | boolean, string?])),
      prefs.track, (v) => { prefs.track = Number(v); applyPrefs(); })));

  // 玩法实验台：每个新功能一行。开关写进偏好，**只影响新开的一局**——
  // 已在打的那局带着自己那份 flags 快照（在存档里），中途改偏好不会把它的账搅了。
  body.append(setRow('玩法实验台', '开新功能只对新的一局生效；关掉就等于这个功能不存在',
    seg([['全关', 'off'], ['全开', 'all'], ['逐个挑', 'pick']], 'pick', (v) => {
      if (v === 'off') { for (const k of FLAG_KEYS) prefs.flags[k] = false; applyPrefs(); renderSettings(); }
      else if (v === 'all') { for (const k of FLAG_KEYS) prefs.flags[k] = true; applyPrefs(); renderSettings(); }
    })));
  for (const k of FLAG_KEYS) {
    body.append(setRow(FLAG_LABEL[k], FEATURE_BLURB[k],
      seg([['关', false], ['开', true]], prefs.flags[k], (v) => { prefs.flags[k] = v === true; applyPrefs(); })));
  }

  const info = el('div', 'discover');
  info.innerHTML = '<b>键位</b><br>空格 出牌 · X 弃牌 · S 铺子 · L 账本 · K 图鉴 · , 设置 · M 静音 · Esc 收起';
  body.append(info);

  const danger = el('div', 'set-row');
  const dl = el('div', 'sl');
  dl.textContent = '清空进度';
  const dd = el('span', 'sd');
  dd.textContent = '删掉本机存档与上一局战报，回到标题页。不可撤销。';
  dl.append(dd);
  const btn = el('button', 'brass-btn ghost danger');
  btn.textContent = '清空';
  let armedReset = false;
  btn.addEventListener('click', () => {
    if (!armedReset) {
      armedReset = true;
      btn.textContent = '确定要清空？';
      setTimeout(() => { armedReset = false; btn.textContent = '清空'; }, 3000);
      return;
    }
    STORE.del();
    clearReport();lastReport=null;need<HTMLButtonElement>('#btnLastReport').hidden=true;
    refreshResume();
    closePanels();
    need('#title').classList.remove('hidden');
    setBusy(false);
  });
  danger.append(dl, btn);
  body.append(danger);
}

function renderLedger(): void {
  const body = need('#ledgerBody');
  body.textContent = '';
  const detail = el('details', 'hand-detail');
  const summary = el('summary');
  summary.textContent = '上一手怎么计分';
  const trace = el('pre', 'score-trace');
  trace.textContent = scoreText(lastChain, cardNameOf);
  detail.append(summary, trace);
  body.append(detail);
  const t = el('table', 'ledger-t');
  t.innerHTML = '<thead><tr><th>场次</th><th>彩头</th><th>流水</th><th>入账</th><th>银钱</th><th>声望</th></tr></thead>';
  const tb = document.createElement('tbody');
  if (!g.state.ledger.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.style.cssText = 'text-align:center;font-style:italic;color:#8a7a5f';
    td.textContent = '尚无笔迹';
    tr.append(td);
    tb.append(tr);
  }
  for (const r of g.state.ledger) {
    const tr = document.createElement('tr');
    [
      `${r.night}·${STAGE_LABEL[r.stage]}${r.raised ? ` ↑${r.raised}` : ''}`,
      num(r.target), num(r.best), `+£${r.reward}`, `£${r.money}`, String(r.rep),
    ].forEach((c, i) => {
      const td = document.createElement('td');
      td.textContent = c;
      if (i === 3) td.classList.add('gain');
      tr.append(td);
    });
    tb.append(tr);
  }
  t.append(tb);
  body.append(t);

  if (g.state.settlement.length) {
    const r = el('div', 'receipt');
    const h4 = el('h4');
    h4.textContent = '上一场明细';
    r.append(h4);
    let sum = 0;
    for (const ln of g.state.settlement) {
      const d = el('div', 'ln');
      const a = el('span');
      a.textContent = ln.label;
      const b = el('span');
      b.textContent = `£${ln.amount}`;
      d.append(a, b);
      r.append(d);
      sum += ln.amount;
    }
    const tot = el('div', 'ln total');
    const tl = el('span');
    tl.textContent = '合计';
    const tv = el('span');
    tv.textContent = `£${sum}`;
    tot.append(tl, tv);
    r.append(tot);
    body.append(r);
  }

  const disc = el('div', 'discover');
  const normal = (Object.keys(HANDS) as HandKind[]).filter((k) => !['five', 'flushhouse', 'flushfive', 'royal'].includes(k));
  disc.innerHTML = `<b>牌型等级</b><br>${normal.map((k) => `${HANDS[k].name} ${levelOf(g.state, k)}`).join(' · ')}`
    + (g.state.discovered.length
      ? `<br><b>已见过的隐秘牌型</b> ${g.state.discovered.map((k) => `${HANDS[k].name} ${levelOf(g.state, k)}`).join(' · ')}`
      : '<br>隐秘牌型尚未露面 —— 得先用「誊抄」造出重复的牌');
  body.append(disc);

  if (g.state.vouchers.length) {
    const v = el('div', 'discover');
    v.innerHTML = `<b>会员特权</b><br>${g.state.vouchers.map((x) => VOUCHERS.find((y) => y.id === x)!.name).join(' · ')}`;
    body.append(v);
  }
}

// ── 幕卡 ─────────────────────────────────────────────────────
let lastReport:RunReport|null=null;
let reportCanvas:HTMLCanvasElement|null=null;
let exportRequest=0;
let shareReturn:HTMLElement|null=null;
function showShare(report:RunReport):void {
  shareReturn=document.activeElement as HTMLElement;
  lastReport=report;reportCanvas=drawReport(report);
  need('#sharePreview').replaceChildren(reportCanvas);reportCanvas.setAttribute('aria-label','本局战报图片预览');
  need('#shareStatus').textContent='PNG · 1200 × 1740 · 图片与文案均在本机生成';
  need('#sharecard').classList.remove('hidden');need<HTMLButtonElement>('#btnExportReport').focus();
}
function closeShare():void {
  need('#sharecard').classList.add('hidden');exportRequest=0;
  for(const id of ['btnExportReport','btnSystemShare','btnCopyReport'])need<HTMLButtonElement>('#'+id).disabled=false;
  shareReturn?.focus();
}
function performShare(action:'export'|'share'|'copy'):void {
  if(!lastReport||!reportCanvas||exportRequest)return;
  try {exportRequest=nativeShare(action,lastReport,reportCanvas);for(const id of ['btnExportReport','btnSystemShare','btnCopyReport'])need<HTMLButtonElement>('#'+id).disabled=true;need('#shareStatus').textContent=action==='export'?'选择保存位置…':action==='share'?'选择分享方式…':'正在复制…';}
  catch(error){need('#shareStatus').textContent=(error as Error).message;}
}
window.addEventListener('guinea-export',(event)=>{
  const reply=(event as CustomEvent).detail;
  if(!reply||reply.id!==exportRequest)return;
  exportRequest=0;
  for(const id of ['btnExportReport','btnSystemShare','btnCopyReport'])need<HTMLButtonElement>('#'+id).disabled=false;
  need('#shareStatus').textContent=reply.status==='saved'?'图片已保存，可发给朋友。':reply.status==='copied'?'分享文案已复制。':reply.status==='presented'?'已打开系统分享菜单。':reply.status==='cancelled'?'已取消保存。':reply.detail||'导出失败，请重试。';
});
function showEnd(won: boolean): void {
  lastReport=makeReport(g.state,won,new Date().toLocaleDateString('sv-SE'));
  saveReport(lastReport);
  need<HTMLButtonElement>('#btnLastReport').hidden=false;
  need('#endTitle').textContent = won ? '堂 局' : '散 场';
  need('#endSub').textContent = won
    ? `${g.state.nights} 夜通吃。这间牌局从此有了你的名字。`
    : `第 ${g.state.night} 夜 · ${STAGE_LABEL[STAGE_KIND[g.state.stage]]}未达彩头，宾客散去。`;
  const sum = need('#endSummary');
  sum.textContent = '';
  const review = runReview(g.state, won);
  const best = review.best;
  for (const [k, v] of [
    ['撑过的场次', String(g.state.ledger.length)],
    ['最高单场流水', num(best)],
    ['留下银钱', `£${g.state.money}`],
    ['声望', String(g.state.rep)],
    ['座上宾', String(g.state.seats.length)],
  ] as [string, string][]) {
    const d = el('div');
    const l = el('span', 'lbl');
    l.textContent = k;
    const b = el('b');
    b.textContent = v;
    d.append(l, b);
    sum.append(d);
  }
  const reviewBox = need('#endReview');
  reviewBox.textContent = '';
  const result = el('p', 'review-result');
  result.textContent = `本场彩头 ${num(review.target)} · 累计流水 ${num(review.score)} · ${won ? `超过 ${num(Math.max(0, review.score - review.target))}` : `还差 ${num(review.gap)}`}`;
  const resources = el('p'); resources.textContent = review.resources;
  const context = el('p'); context.textContent = review.context;
  const tips = el('ul');
  for (const text of review.tips) { const li = el('li'); li.textContent = text; tips.append(li); }
  reviewBox.append(result, resources, context, tips);
  if(lastReport.story){const clubResult=el('p','club-ending');clubResult.textContent=`委托履约 ${lastReport.completedContracts??0} 份 · ${lastReport.story}`;reviewBox.append(clubResult);}
  if (lastChain) {
    const detail = el('details', 'hand-detail');
    const label = el('summary'); label.textContent = '最后一手怎么计分';
    const trace = el('pre', 'score-trace'); trace.textContent = scoreText(lastChain, cardNameOf);
    detail.append(label, trace); reviewBox.append(detail);
  }
  need('#btnEndless').hidden = !won||g.state.mode==='daily';
  // 「事件回顾」：整局递过的事件按夜列一遍，右边那行是当时**实际**发生了什么
  // （抛硬币那类只有执行完才知道朝哪面）。数据全在 state.events，这里只做投影。
  const box = need('#endRecapBox');
  const rec = need('#endRecap');
  rec.textContent = '';
  const fired = g.state.flags.events ? g.state.events : [];
  if (fired.length) {
    box.classList.remove('hidden');
    for (const e of fired) {
      const row = el('div', 'er-row');
      const n = el('span', 'er-night');
      n.textContent = `第${e.night}夜`;
      const w = el('div', 'er-what');
      w.textContent = eventById(e.id)?.name ?? e.id;
      const i = el('i');
      i.textContent = e.result;
      w.append(i);
      row.append(n, w);
      rec.append(row);
    }
  } else {
    // 一条都没递过（或这局根本没开这个功能）：这块整段收掉，不留一个空标题
    box.classList.add('hidden');
  }
  need('#endcard').classList.remove('hidden');
}

function resetTable(): void {
  need('#tableCards').textContent = '';
  need('#tray').textContent = '';
  cardEls.clear();
  need('.felt', need('#board')).classList.remove('cleared');
  lastTotal = 0;
  totalReel.set(0);
  chipsReel.set(0);
  multReel.set(1);
  need('#readout').classList.add('idle');
}

const seedFromInput = (): number => {
  const v = Number(need<HTMLInputElement>('#seedInput').value.trim());
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 20261009;
};

let pickedDeck = 'standard';

const dailyLocked = (): boolean => prefs.mode === 'daily';
/** 下一局**真正会跑**的夜数：每日一局固定八夜（同一天同一局含局长），别照抄偏好里那个数。
 *  标题页的高亮、说明行、候选偏置、开局传参都读这一个口子，四处不可能各说各话 */
const nightsForRun = (): number => (dailyLocked() ? DEFAULT_NIGHTS : prefs.nights);
/** 每日一局的种子由日期决定，输入框只是给人看今天这局是哪个号 */
const runSeed = (): number => (dailyLocked() ? dailySeed() : seedFromInput());

interface PickItem { id: string; name: string; blurb: string }
const asPick = (x: { id: string; name: string; blurb: string }): PickItem =>
  ({ id: x.id, name: x.name, blurb: x.blurb });
// 最后碰过哪一排，说明行就展开讲哪一项：三排药丸 + 一行说明，比原来
// "五副牌各占一行"省一百多像素，主操作才不必滚动就能看见
let lastPick: 'mode' | 'diff' | 'deck' | 'length' = 'mode';

function pickNote(): void {
  const m = modeById(prefs.mode), d = diffById(dailyLocked() ? 'standard' : prefs.diff), k = deckById(dailyLocked() ? 'standard' : prefs.deck);
  const l = lengthOf(nightsForRun());
  const n = need('#pickNote');
  n.textContent = '';
  const b = el('b');
  b.textContent = `${m.name} · ${d.name} · ${l.nights} 夜 · ${k.name}`;
  // 选中轮数时讲的是"这一档要打到多少分"：终场彩头是设计值，玩家有权先看见终点再开跑
  const blurb = lastPick === 'deck' ? k.blurb
    : lastPick === 'diff' ? d.blurb
      : lastPick === 'length' ? `${l.tier} · ${l.blurb}（终场贵客彩头 ${num(l.finalTarget)}）`
        : m.blurb;
  n.append(b, document.createTextNode(`　${blurb}`));
}

function renderPickers(): void {
  const club=need<HTMLButtonElement>('#btnClubPreset');club.disabled=dailyLocked();club.setAttribute('aria-pressed',String(!dailyLocked()&&prefs.flags.club));
  club.textContent=dailyLocked()?'每日牌局使用固定规则':prefs.flags.club?'经营奇遇已开启 · 委托、故事与新客人':'经营奇遇 · 委托、故事与新客人';
  const events=need<HTMLButtonElement>('#btnEventsToggle');events.disabled=dailyLocked();events.setAttribute('aria-pressed',String(!dailyLocked()&&prefs.flags.events));
  events.textContent=dailyLocked()?'每日牌局使用固定规则':prefs.flags.events?'夜间奇遇已开启 · 事件中可遇见稀奇牌':'开启夜间奇遇 · 事件中可遇见稀奇牌';
  // 牌组那一排随局长变：别的档的专属牌组不许摆在这里——内核会把它落回标准局，
  // 屏幕上留一个"点得动、进不去"的选项比不锁更糟（与签名宾同一口径）
  const offer = decksFor(nightsForRun());
  if (!offer.some((d) => d.id === prefs.deck)) {
    prefs.deck = 'standard';
    pickedDeck = 'standard';
    savePrefs();
  }
  const rows: [string, PickItem[], 'mode' | 'diff' | 'deck'][] = [
    ['#modes', MODES.map(asPick), 'mode'],
    ['#diffs', DIFFS.map(asPick), 'diff'],
    ['#decks', offer.map(asPick), 'deck'],
  ];
  const lock = dailyLocked();
  for (const [sel, list, key] of rows) {
    const box = need<HTMLElement>(sel);
    box.textContent = '';
    box.classList.toggle('locked', (key === 'deck' || key === 'diff') && lock);
    for (const item of list) {
      const selected = lock && key === 'diff' ? 'standard' : lock && key === 'deck' ? 'standard' : prefs[key];
      const b = el('button', 'pick' + (selected === item.id ? ' on' : ''));
      b.textContent = item.name;
      b.title = item.blurb;
      b.addEventListener('click', () => {
        if (key === 'deck' && dailyLocked()) return;   // 每日一局锁牌组，否则"同一天同一局"不成立
        if (key === 'diff' && dailyLocked()) return;
        prefs[key] = item.id as never;
        if (key === 'deck') pickedDeck = item.id;
        lastPick = key;
        applyPrefs();          // 里面会 savePrefs，所以选中的东西存得下来
        renderPickers();
        refreshResume();
      });
      box.append(b);
    }
  }
  if (lock) need<HTMLInputElement>('#seedInput').value = String(dailySeed());
  need('#seedRow').classList.toggle('locked', lock);
  // 轮数一排：3..15 夜各一格。每日一局把它钉回八夜——"同一天同一局"里含局长，
  // 高亮的那一格必须是**真会跑的那个数字**，不是偏好里躺着的那个
  const lenBox = need<HTMLElement>('#lengths');
  lenBox.textContent = '';
  lenBox.classList.toggle('locked', lock);
  const shownNights = nightsForRun();
  for (const l of LENGTHS) {
    const b = el('button', 'pick len' + (shownNights === l.nights ? ' on' : ''));
    b.textContent = String(l.nights);
    b.title = `${l.tier} · ${l.blurb}`;
    b.addEventListener('click', () => {
      if (dailyLocked()) return;
      prefs.nights = l.nights;
      lastPick = 'length';
      applyPrefs();
      renderPickers();
    });
    lenBox.append(b);
  }
  pickNote();
  renderDraft();
}

// ── 开局选签名宾 ───────────────────────────────────────────
// 候选由 (种子, 重掷次数) 完全决定，走的是 draft.ts 的派生流：
// 换一批、反复换，都不会挪动牌局里那一条主随机流（发牌、铺子、玻璃碎裂照旧）
let draftRerolls = 0;

function draftSeed(): number {
  const raw = Number(need<HTMLInputElement>('#seedInput').value);
  return Number.isFinite(raw) && raw > 0 ? raw : 20261009;
}

/** 当前能进局的签名宾。flag 关了就整块藏掉，不读候选也不看已选的人 */
function draftEligible(): boolean {
  return prefs.flags.draft && !dailyLocked();
}

function renderDraft(): void {
  const box = need('#draftBox');
  const row = need('#draftRow');
  const note = need('#draftNote');
  row.textContent = '';
  if (!draftEligible()) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const offer = drawOffer(draftSeed(), 0, draftRerolls, nightsForRun());
  // 换种子之后旧的"已选"可能不在这批候选里了：那就退回未选，
  // 而不是让玩家带着一位屏幕上根本看不见的客人开局
  if (prefs.signature && !offer.some((p) => p.id === prefs.signature)) {
    prefs.signature = '';
    savePrefs();
  }
  for (const p of offer) {
    const c = el('button', 'draft-card t-' + p.temperament + (p.rarity ? ` r-${p.rarity}` : ''));
    c.innerHTML =
      '<span class="dc-pf"></span><span class="dc-name"></span>'
      + '<span class="dc-temper"></span><span class="dc-blurb"></span>';
    need('.dc-pf', c).style.background = portraitGround(p.temperament, p.id);
    need('.dc-pf', c).innerHTML = portraitSvg(p.id, p.rarity);
    need('.dc-name', c).textContent = p.name;
    need('.dc-temper', c).textContent = TEMPERAMENT_LABEL[p.temperament];
    need('.dc-blurb', c).textContent = p.blurb;
    c.title = offerLine(p);
    c.dataset.pid = p.id;
    c.classList.toggle('on', prefs.signature === p.id);
    c.addEventListener('click', () => {
      prefs.signature = prefs.signature === p.id ? '' : p.id;
      sfx.play('draft');
      savePrefs();
      renderDraft();
      pickNote();
    });
    row.append(c);
  }
  const left = OFFER_SIZE - offer.length;
  // 局长会挪候选池的配比（draft.ts 的 lengthWeight）：这句只说**真发生过的偏置**。
  // 六到九夜权重恒为 1，每日一局也固定走八夜，那两种场合都不许谎称"按局长偏过"。
  const n = nightsForRun();
  const bias = n < 6 ? ' · 短局候选压掉了一批长进型与翻倍注'
    : n > 9 ? ' · 长局候选偏给长进型与翻倍注' : '';
  note.textContent = (prefs.signature
    ? `已请定「${patronById(prefs.signature).name}」，入席就在座上`
    : (left > 0 ? `还差 ${left} 位候选可抽——这局的客人池不够满` : '选一位开局入席；不选就是白手开局')) + bias;
}

// ── 随机事件的三选一 ─────────────────────────────────────────
// 面板只做投影：候选由内核抽（events.ts 的派生流），选下去之后账怎么变也是内核定的。
// 这一层唯一做的事是把 state.pendingEvent 里那三个 id 演成三张能点的卡。

/** 七个角标各配一只画出来的小记号，全部 currentColor + stroke，跟着画法换色。
 *  取 eventTags 的第一条——tags 是从 ops 推出来的，所以同一件事永远配同一个记号。 */
const EVENT_GLYPH: Record<string, string> = {
  crest: '<path d="M6 20h12l-1-9H7L6 20Z"/><path d="M6 5v6h12V5h-3v3h-3V5H9v3H6"/>',
  ledger: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 7h6M9 11h6M9 15h4"/>',
  ember: '<path d="m12 3 2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4L12 3Z"/>',
  mirror: '<path d="m12 3 8 9-8 9-8-9 8-9Z"/><path d="m12 7 4 5-4 5M8 12h3"/>',
  anchor: '<circle cx="12" cy="5" r="2"/><path d="M12 7v14M8 10h8M4 14c0 4 3 7 8 7s8-3 8-7M4 14l-2 3M20 14l2 3"/>',
  comet: '<circle cx="8" cy="16" r="4"/><path d="M10 11 19 2M14 12l8-8M14 16l7-7"/>',
  银钱: '<path d="M7 9h10l1.6 8.4A3 3 0 0 1 15.7 21H8.3a3 3 0 0 1-2.9-3.6L7 9Z"/><path d="M9.4 9V7.2a2.6 2.6 0 0 1 5.2 0V9"/>',
  规矩: '<path d="M12 4v14"/><path d="M5 8h14"/><path d="M5 8 2.8 13a2.6 2.6 0 0 0 4.4 0L5 8Z"/><path d="M19 8l-2.2 5a2.6 2.6 0 0 0 4.4 0L19 8Z"/><path d="M8.6 20h6.8"/>',
  计分: '<path d="M4 18 9 9l3.4 5 2.2-3.2L20 18Z"/><circle cx="9" cy="9" r="1.4"/>',
  牌组: '<rect x="4.6" y="6.4" width="8" height="11.2" rx="1.2" transform="rotate(-7 8.6 12)"/><rect x="11.4" y="6.4" width="8" height="11.2" rx="1.2" transform="rotate(7 15.4 12)"/>',
  客人: '<circle cx="12" cy="7.6" r="3.2"/><path d="M6 20.4c0-3.6 2.7-5.6 6-5.6s6 2 6 5.6"/>',
  货单: '<rect x="4" y="7" width="16" height="11" rx="1.4"/><path d="M4.6 7.8 12 13.4l7.4-5.6"/>',
  运气: '<circle cx="12" cy="12" r="7.4"/><path d="M12 7.2A4.8 4.8 0 0 1 12 16.8"/>',
};

function eventGlyph(e: EventDef): string {
  const tags = eventTags(e);
  const rare=e.ops.flatMap(op=>op.t==='addCard'?op.cards:[]).map(card=>specialById(card.special)).find(Boolean);
  const key = rare ? rare.id : tags.length ? tags[0] : '运气';
  return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.15" '
    + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + (EVENT_GLYPH[key] ?? EVENT_GLYPH['运气']) + '</svg>';
}

function renderEventPick(): void {
  const box = q('#eventPick');
  if (!box) return;
  const cands = g ? eventChoices(g) : [];
  if (!cands.length) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  const row = need('#eventRow');
  row.textContent = '';
  need('#eventSub').textContent =
    `第 ${g.state.night} 夜 · 三件里应一件 · 选下去的那条会改往后的账`;
  for (const e of cands) {
    const c = el('button', 'ev-card r-' + e.risk);
    c.innerHTML = '<span class="ev-glyph"></span><span class="ev-name"></span>'
      + '<span class="ev-risk"></span><span class="ev-kicker"></span><span class="ev-blurb"></span>';
    need('.ev-glyph', c).innerHTML = eventGlyph(e);
    need('.ev-name', c).textContent = e.name;
    need('.ev-risk', c).textContent = riskName(e.risk);
    need('.ev-kicker', c).textContent = e.kicker;
    need('.ev-blurb', c).textContent = e.blurb;
    for(const op of e.ops) if(op.t==='addCard') for(const card of op.cards) {
      const rare=specialById(card.special);if(!rare)continue;
      const gift=el('span','ev-gift');gift.textContent=`${rare.name} · ${rare.blurb}`;c.append(gift);c.classList.add('has-gift');
      need('.ev-glyph',c).style.color=rare.color;
    }
    c.title = `${e.name}｜${riskName(e.risk)}｜${eventTags(e).join(' · ')}`;
    c.dataset.eid = e.id;
    c.addEventListener('click', () => takeEvent(e.id));
    row.append(c);
  }
  // 错帧入场，和铺子货位、结清幕同一套节奏；抓帧时一律给到位
  Array.from(row.children).forEach((n, i) => {
    (n as HTMLElement).style.animationDelay = SNAP ? '0ms' : `${120 + i * 88}ms`;
  });
  need('#eventNote').textContent =
    '拿不定就按「让牌局自决」——管家按 稳吃、靠脑子、吃运气 这个次序替你应一件。';
  // 候选没了（应下了、或这一屏换局了）就把抽牌礼那一排一起收掉，别留一排扣着的牌在空中
  if (!cands.length) closeFan();
}

// ── 抽牌礼：扣过来的一排 ─────────────────────────────────────
// 界面只做投影：要不要抽牌、候选是哪几张、抽完之后账怎么落，全在 core/game.ts（fanOffer / chooseEvent）。
// 这一层只负责把牌背摆成一排，把玩家点的那张的 id 交回内核。
let fanFrom: string | null = null;
let fanItems: { card: Card; node: HTMLElement }[] = [];

function closeFan(): void {
  fanFrom = null;
  fanItems = [];
  const box = q('#drawFan');
  if (box) box.classList.add('hidden');
  const row = q('#fanRow');
  if (row) { row.textContent = ''; row.classList.remove('locked'); }
}

/** 摆出扇面。返回 false = 这条事件不挑一张牌，调用方直接落账（不摆就是没这个仪式） */
function openFan(id: string): boolean {
  if (!g) return false;
  const offer = fanOffer(g, id);
  if (!offer || !offer.cards.length) return false;
  const def = eventById(id);
  if (!def) return false;
  const row = need('#fanRow');
  row.textContent = '';
  row.classList.remove('locked');
  fanItems = [];
  fanFrom = id;
  const mid = (offer.cards.length - 1) / 2;
  for (let i = 0; i < offer.cards.length; i++) {
    const c = offer.cards[i];
    const n = el('div', 'card back');
    // 只挂 id（一张扣过来的牌是谁仍然看不见）：门禁要靠它对上"抽的就是落的"，
    // 不靠它也能点——按钮走的是闭包里的 c.id，删掉这行只影响量得准不准
    n.dataset.card = String(c.id);
    n.innerHTML = '<span class="backart"><svg viewBox="' + BACK_VIEWBOX + '" aria-hidden="true">'
      + BACK_ART + '</svg></span>';
    const d = i - mid;
    n.style.setProperty('--rot', `${(d * 3).toFixed(2)}deg`);
    n.style.setProperty('--base', `${(Math.abs(d) ** 2 * 1.6).toFixed(2)}px`);
    n.style.animationDelay = SNAP ? '0ms' : `${150 + i * 74}ms`;
    n.addEventListener('click', () => drawFromFan(c.id));
    fanItems.push({ card: c, node: n });
    row.append(n);
  }
  need('#fanSub').textContent =
    `${def.name} · 要挑一张牌：这 ${offer.cards.length} 张扣过来的就是它的候选`;
  need('#fanNote').textContent = offer.more
    ? '抽一张定头一张，这件事要挑的其余那几张仍由牌局自己摇。'
    : '抽一张，这件事就落在你抽到的那张牌上。';
  need('#drawFan').classList.remove('hidden');
  return true;
}

/**
 * 抽定一张。账在点击这一刻就落地（内核是权威的，动画只是皮），
 * 扇面留在屏幕上演完那半圈翻面，演完才重画这一屏。
 */
function drawFromFan(cardId: number): void {
  const activeGame=g;
  if (fanFrom === null || busy) return;
  const from = fanFrom;
  fanFrom = null;                      // 先摘这一格：再点第二张也不许二次落账
  const line = chooseEvent(g, from, cardId);
  if (line === null) { closeFan(); renderAll(); return; }
  sfx.play('event');
  saveNow();
  toast(line);
  const hit = fanItems.find((x) => x.card.id === cardId);
  const row = need('#fanRow');
  row.classList.add('locked');
  if (hit) hit.node.classList.add('drawn');
  if (SNAP) { renderAll();finishEventTransition(); return; }
  setBusy(true);
  const flip = Math.round(230 / speedMul);
  const done = Math.round(460 / speedMul);
  if (hit) {
    hit.node.style.animation = `cardTurn ${done}ms var(--ease-settle)`;
    // 转到侧面那一瞬才换成正面：先看见牌背走开，再看见自己抽的这张立起来
    setTimeout(() => { if(g===activeGame)syncCard(hit.card, hit.node); }, flip);
  }
  setTimeout(() => { if(g!==activeGame)return;closeFan(); renderAll(); setBusy(false);finishEventTransition(); }, done);
}

/** 选一条下去。内核认不下这个 id 就什么都不做（存档是外部输入，不能信它给的 id） */
function finishEventTransition():void {
  if(g.state.status==='cleared'){g.openShop();renderAll();renderShop();openPanel('shop');saveNow();}
  else if(g.state.status==='lost'){setBusy(false);saveNow();showEnd(false);}
}
function takeEvent(id: string): void {
  if (openFan(id)) { sfx.play('deal'); return; }   // 要挑一张牌：先翻过去打乱，等玩家抽
  const line = chooseEvent(g, id);
  if (line === null) return;
  sfx.play('event');
  renderAll();
  saveNow();
  toast(line);
  finishEventTransition();
}

function cancelPresentation():void {
  dismissCurtain();
  for(const a of liveAnims)a.cancel();liveAnims.clear();ff=false;
  closeShare();closePanels();closeFan();
}
function start(seed: number, deckId = pickedDeck, over?: { diff?: Diff; mode?: Mode; flags?: FeatureFlags; nights?: number }): void {
  cancelPresentation();
  // 偏好里的开关在**开局这一刻**被抄进 state.flags，之后这一局就用那份快照。
  // 中途去设置里翻开关不会搅了正在打的账——存档里带着 flags 就是为了这个。
  // over 只有引导关那一处在用：它要锁死难度、模式，并且强行关掉随机事件（见 guideFlags）。
  const mode = over?.mode ?? prefs.mode;
  const actualSeed = mode === 'daily' ? dailySeed() : seed;
  g = new Game(actualSeed, mode === 'daily' ? 'standard' : deckId, {
    diff: over?.diff ?? prefs.diff, mode: over?.mode ?? prefs.mode,
    flags: over?.flags ?? prefs.flags,
    // 局长同样在这一刻定死：引导关的课表按八夜排，每日一局按参照档比
    nights: over?.nights ?? nightsForRun(),
    // flag 关掉时连 id 都不传：等于这个功能不存在
    signature: prefs.flags.draft ? prefs.signature : '',
  });
  seenSets = null;
  seenGrowth.clear();
  lastChain = null;
  pickedDeck = deckId;
  patronEls.clear();
  need('#patrons').textContent = '';
  resetTable();
  armed = null;
  setBusy(false);
  need('#title').classList.add('hidden');
  need('#endcard').classList.add('hidden');
  need('#sharecard').classList.add('hidden');exportRequest=0;reportCanvas=null;
  closePanels();
  renderAll();
  saveNow();
  toast(`第 1 夜 · 便宴 · 彩头 ${num(targetOf(g.state))}`);
  sfx.play('deal');
  if(g.state.flags.club)openPanel('club');
}

/**
 * 开一局课：种子、牌组、难度、模式全锁死（core/guide.ts 里那张表钉的就是这一副牌），
 * 其余一律走普通局的同一扇门——start() 里做什么这里就做什么，不搞第二套开局。
 * 锁完再钉标记位，因为 start() 末尾会存一次档，标记必须赶在下一次存盘前进 state。
 */
function startGuide(): void {
  prefs.guide = true;
  savePrefs();
  hideIntro();
  start(GUIDE.seed, GUIDE.deckId, {
    diff: GUIDE.diff, mode: GUIDE.mode, flags: guideFlags(prefs.flags),
    // 局长由 core/guide.ts 钉死（最短三夜）：课表十节课的时机是按这一档排的，
    // 玩家选的轮数不许把它挪走——引导关走完再开正常局时才轮到那个选择
    nights: GUIDE.nights,
  });
  beginGuide(g.state);
  saveNow();
  refreshTutorial();
  toast('第一课 · 跟着气泡做，随时能退出');
}

// ── 按钮与键盘 ───────────────────────────────────────────────
need('#btnStart').addEventListener('click', () => start(runSeed()));
need('#btnEventsToggle').addEventListener('click',()=>{if(dailyLocked())return;prefs.flags.events=!prefs.flags.events;applyPrefs();renderPickers();});
need('#btnClubPreset').addEventListener('click',()=>{
  if(dailyLocked())return;
  prefs.flags={...FLAGS_OFF,...(!prefs.flags.club?{club:true,events:true,sets:true,growth:true,adjacency:true,layers:true}:{})};
  applyPrefs();renderPickers();
});
need('#btnClub').addEventListener('click',()=>openPanel('club'));
need('#btnShareRun').addEventListener('click',()=>{if(lastReport)showShare(lastReport);});
need('#btnLastReport').addEventListener('click',()=>{const report=lastReport??loadReport();if(report)showShare(report);else toast('还没有上一局战报');});
need('#btnExportReport').addEventListener('click',()=>performShare('export'));
need('#btnSystemShare').addEventListener('click',()=>performShare('share'));
need('#btnCopyReport').addEventListener('click',()=>performShare('copy'));
need('#btnCloseShare').addEventListener('click',closeShare);
// 出牌与弃牌以前只有空格 / X 按得动：同一件事必须也点得动（走的是同一条 doPlay/doDiscard，
// 不搞第二套逻辑，所以按钮与快捷键不可能各演各的）
need('#btnPlay').addEventListener('click', () => { void doPlay(); });
need('#btnDiscard').addEventListener('click', () => { void doDiscard(); });
need('#btnSkip').addEventListener('click', () => { requestSkip(); });
need('#btnTakeGuide').addEventListener('click', () => startGuide());
need('#btnSkipGuide').addEventListener('click', () => skipIntro());
need('#btnEventAuto').addEventListener('click', () => {
  const line = autoResolveEvent(g);
  if (line === null) return;
  sfx.play('event');
  renderAll();
  saveNow();
  toast(`牌局自决 · ${line}`);
  finishEventTransition();
});
// 「先不抽」：把扇面收掉，回到三选一。事件还挂着待决，什么都不落地
need('#btnFanCancel').addEventListener('click', () => {
  closeFan();
  sfx.play('leave');
});
need('#btnSeedDice').addEventListener('click', () => {
  if (dailyLocked()) return;   // 每日一局不给摇：那就不再是"同一局"了
  draftRerolls = 0;            // 换种子就该重抽候选，留着旧的重掷次数没有意义
  need<HTMLInputElement>('#seedInput').value = String(1000 + Math.floor(Math.random() * 899900));
  renderDraft();
});
// 手打进一个种子也要重抽候选：候选是按种子定的，不换的话屏幕上就是五张错牌
need<HTMLInputElement>('#seedInput').addEventListener('input', () => {
  draftRerolls = 0;
  renderDraft();
});
need('#btnReroll').addEventListener('click', () => {
  if (!draftEligible()) return;
  draftRerolls = nextRerolls(draftRerolls);
  renderDraft();
});
need('#btnShop').addEventListener('click', () => { if (g.state.status === 'shop') openPanel('shop'); });
need('#btnLedger').addEventListener('click', () => openPanel('ledger'));
need('#btnCodex').addEventListener('click', () => { codexTab = 'hands'; openPanel('codex'); });
need('#btnDeck').addEventListener('click', () => { codexTab = 'deck'; openPanel('codex'); });
need('#btnSettings').addEventListener('click', () => openPanel('settings'));
need('#btnResume').addEventListener('click', () => {
  const t = STORE.get();
  const loaded = t ? loadSave(t) : null;
  if (!loaded) { need('#resumeNote').textContent = '那份存档读不出来了'; return; }
  cancelPresentation();
  g = loaded;
  const recovered = STORE.recovered;
  seenSets = null;
  seenGrowth.clear();
  lastChain = null;
  patronEls.clear();
  cardEls.clear();
  need('#patrons').textContent = '';
  need('#tableCards').textContent = '';
  need('#tray').textContent = '';
  armed = null;
  setBusy(false);
  need('#title').classList.add('hidden');
  hideIntro();
  if (g.state.status === 'cleared') { g.openShop(); saveNow(); }
  place(need('#tableCards'), g.state.table);
  renderAll();
  if (g.state.status === 'shop') openPanel('shop');
  toast(recovered ? '已恢复上一份有效进度' : `续上第 ${g.state.night} 夜`);
});
need('#btnSound').addEventListener('click', () => {
  prefs.muted = !prefs.muted;
  applyPrefs();          // 里面会 savePrefs 并重画按钮
});

function paintSoundBtn(): void {
  const b = need('#btnSound');
  b.style.opacity = sfx.muted ? '.4' : '1';
  b.textContent = sfx.muted ? '∅' : '♪';
}
// 散场后默认换一个种子；想原样重打同一局，回到标题页手动填回旧种子
need('#btnAgain').addEventListener('click', () => {
  if(need('#endcard').classList.contains('hidden')||!['won','lost'].includes(g.state.status))return;
  // 每日一局"再来一局"还是今天这一局（要换就得明天）；其余模式换一个新种子
  const next = dailyLocked() ? dailySeed() : 1000 + Math.floor(Math.random() * 899900);
  need<HTMLInputElement>('#seedInput').value = String(next);
  start(next);
});
need('#btnEndless').addEventListener('click', () => {
  if(need('#endcard').classList.contains('hidden')||g.state.mode==='daily'||g.state.status!=='won')return;
  need('#endcard').classList.add('hidden');
  continueEndless(g);
  saveNow();
  resetTable();
  renderAll();
  toast(`无尽经营 · 第 ${g.state.night} 夜`);
});
for (const b of document.querySelectorAll('[data-close]')) b.addEventListener('click', () => closePanels());

document.addEventListener('click', () => sfx.unlock(), false);
// 鼠标玩家不该被要求去记键盘：演出中点牌桌任意一处就是"跳过"。
// 这里不再自己判 busy——"没在演出就不算跳过"由 requestSkip 一处守着，
// 两处各判一遍的话，改掉里面那层也看不出差别（falsify-ui 注进去过，全绿，是假安全感）
need('#board').addEventListener('click', () => requestSkip());
need('#curtain').addEventListener('click', () => dismissCurtain());
// 幕布那颗「继 续」是**给眼睛看的落点**：不绑事件，点了它冒泡到上面那条就收幕。
// 所以"按钮存在"与"幕布能点掉"是同一份实现，不会出现两条路各关各的。
document.addEventListener('keydown', (ev: KeyboardEvent) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  if(!need('#sharecard').classList.contains('hidden')) {
    if(ev.key==='Escape'){ev.preventDefault();closeShare();}
    if(ev.key==='Tab') {
      const buttons=Array.from(need('#sharecard').querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));const i=buttons.indexOf(document.activeElement as HTMLButtonElement);
      if(ev.shiftKey&&i<=0){ev.preventDefault();buttons.at(-1)!.focus();}else if(!ev.shiftKey&&(i<0||i===buttons.length-1)){ev.preventDefault();buttons[0].focus();}
    }
    return;
  }
  // 正在往输入框里打字时，空格和字母属于内容，不属于快捷键
  const tag = (ev.target as HTMLElement | null)?.tagName ?? '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') {
    if (ev.key === 'Enter' && (ev.target as HTMLElement).id === 'seedInput' && !need('#title').classList.contains('hidden')) { ev.preventDefault(); need<HTMLButtonElement>('#btnStart').click(); }
    return;
  }
  if (tag === 'SELECT') return;
  if ((tag === 'BUTTON' || tag === 'SUMMARY') && (ev.key === 'Enter' || ev.key === ' ')) return;
  const k = ev.key.toLowerCase();
  if (k === ' ' || k === 'enter') {
    ev.preventDefault();
    if (dismissCurtain()) return;
    if (busy) { requestSkip(); return; }        // 演出中：这一下是"跳过"，不是"再打一次"
    // 课表卡此刻正拦在标题页前面：回车那一下要落在「上第一课」，不能绕过它去开局
    if (!need('#guideIntro').classList.contains('hidden')) { need<HTMLButtonElement>('#btnTakeGuide').click(); return; }
    if (!need('#title').classList.contains('hidden')) { need<HTMLButtonElement>('#btnStart').click(); return; }
    void doPlay();
  } else if (k === 'x') void doDiscard();
  else if (k === 's') { if (g.state.status === 'shop') openPanel('shop'); }
  else if (k === 'l') openPanel('ledger');
  else if (k === 'k') openPanel('codex');
  else if (k === ',') openPanel('settings');
  else if (k === 'm') need<HTMLElement>('#btnSound').click();
  else if (k === 'r' && !need('#title').classList.contains('hidden')) need<HTMLElement>('#btnSeedDice').click();
  else if (k === 'escape') closePanels();
});

/** 量真实渲染成本：连续摆位 + 连续结算，把毫秒打到控制台（外壳会转进 stderr）。
 *  无头环境里 rAF 冻结，所以只能用 performance.now，不能数帧。 */
/** 一份能当判据用的性能报表：不只打到控制台，还要 return 出来给 uitest 断言 */
interface PerfReport {
  placeUs: number;       // 单次摆位（renderTray + FLIP）微秒
  scoreUs: number;       // 单次结算（含 3 位客人）微秒
  renderAllMs: number;   // 单次全量重渲染毫秒
  nodes: number;         // DOM 节点总数
  cards: number;         // cardEls 记着的牌
  detached: number;      // 其中已游离出 DOM 却还被记着的
  patrons: number;       // patronEls 记着的客人
  jitter: number;        // 抖动 21 次全量重渲染后的节点差
}

function perfProbe(): PerfReport {
  const t0 = performance.now();
  for (let i = 0; i < 240; i++) {
    const k = 1 + (i % 5);
    g.state.chosen = g.state.hand.slice(0, k).map((c) => c.id);
    renderTray();
  }
  const t1 = performance.now();
  let t2 = performance.now();
  for (let i = 0; i < 500; i++) {
    const gg = new Game(4242 + i);
    gg.state.seats = PROBE_SEATS;
    gg.state.chosen = gg.state.hand.slice(0, 5).map((c) => c.id);
    play(gg);
  }
  const t3 = performance.now();
  const nodes = document.querySelectorAll('*').length;
  const detached = [...cardEls.values()].filter((x) => !x.isConnected).length;
  console.log(`PERF 摆位240次 ${(t1 - t0).toFixed(1)}ms（${((t1 - t0) / 240 * 1000).toFixed(0)} 微秒/次）`);
  console.log(`PERF 结算500局 ${(t3 - t2).toFixed(1)}ms（${((t3 - t2) / 500 * 1000).toFixed(0)} 微秒/次）`);
  console.log(`PERF DOM ${nodes} 节点，cardEls ${cardEls.size}，其中游离未回收 ${detached}`);

  // 抖动：反复换客人 + 全量重渲染，量单次 renderAll 的真实成本与节点增减。
  // 基线必须和终态用同一组客人，否则"3 位 → 0 位"的差是负的，判据永远绿（之前就是这么假绿的）
  g.state.seats = [mkSeat(PATRONS[0].id)];
  renderAll();
  const base = document.querySelectorAll('*').length;
  const c0 = performance.now();
  for (let i = 0; i < 20; i++) {
    g.state.seats = [{ pid: PATRONS[i % PATRONS.length].id, edition: 'none' }];
    renderAll();
  }
  const c1 = performance.now();
  g.state.seats = [mkSeat(PATRONS[0].id)];
  renderAll();
  const after = document.querySelectorAll('*').length;
  console.log(`PERF 抖动 renderAll×22 ${(c1 - c0).toFixed(1)}ms（${((c1 - c0) / 22).toFixed(2)}ms/次），`
    + `DOM ${base} → ${after}（差 ${after - base}），patronEls ${patronEls.size}`);
  if (after - base > 5) console.log('PERF WARN 节点疑似泄漏');
  return {
    placeUs: (t1 - t0) / 240 * 1000, scoreUs: (t3 - t2) / 500 * 1000,
    renderAllMs: (c1 - c0) / 20, nodes: after, cards: cardEls.size,
    detached, patrons: patronEls.size, jitter: after - base,
  };
}


// ── 调试口子：抓动画中间态用 ─────────────────────────────────
const api = {
  get speed(): number { return speedMul; },
  set speed(v: number) { speedMul = Math.max(0.05, v); },
  get busy(): boolean { return busy; },
  /** 跳过标记：测试要能证明它被置上、也要能证明它不会漏到下一手 */
  get ff(): boolean { return ff; },
  /** 还在飞的动画数：跳过之后必须立刻归零，否则会留下半路的 transform */
  get anims(): number { return liveAnims.size; },
  /** 演出路径飘出过几条阈值提示（0 就说明 bonus 分支没被走过） */
  get cues(): number { return cueCount; },
  /**
   * 测试专用：把还挂在 liveAnims 上的动画立刻收尾，返回收尾了几个。
   * 只在"代打时钟"的无头环境里用。显示器睡着时某些新建动画压根没被注册进
   * document.getAnimations()（实测 getAnims=5 而 anims=3），测试侧推不动它们，
   * 只能由持有引用的这一侧来收尾。产品路径不会调用它，跳过演出走的是 requestSkip。
   */
  settleAnims(): number {
    let n = 0;
    for (const a of liveAnims) { try { a.finish(); n += 1; } catch { /* 已经结束了 */ } }
    return n;
  },
  /** 泄漏探针：DOM 里的牌 vs cardEls 里记着的牌（含已游离的） */
  stats(): { cards: number; detached: number; nodes: number } {
    return { cards: cardEls.size,
      detached: [...cardEls.values()].filter((x) => !x.isConnected).length,
      nodes: document.querySelectorAll('*').length };
  },
  get game(): Game { return g; },
  // 无头行为测试要看静音的真实状态：按钮文案只反映"最后一次点它时"的样子，
  // 改音量之后界面不重画，所以必须直接读 sfx
  get muted(): boolean { return sfx.muted; },
  get prefsCopy(): Record<string, unknown> { return { ...prefs }; },
  get bgm(): { tune: string | null; level: number; heat: number; layers: number; ticking: boolean; ctx: string; pending: number } { return music.debug; },
  /** 音效接线：每个配方被**要求**响过几次（静音/未解锁时也计数——测的是选没选对声，
   *  不是耳朵听没听到），以及音频图上还挂着几个没摘的节点 */
  get sfx(): { pending: number; fired: Record<string, number>; ctx: string } { return sfx.debug; },
  resetSfx(): void { sfx.resetLog(); },
  /** 引导的当前状态：该说哪条、气泡可见吗、有没有盖住锚点、讲过哪几条 */
  tutor(): {
    id: string | null; visible: boolean; coversAnchor: boolean; eatsClicks: boolean;
    inViewport: boolean; anchorInOpenPanel: boolean; seen: string[];
  } {
    const st = currentStep();
    const geo = st ? coachGeom(st.anchor) : { covers: false, inView: false, inPanel: false };
    return {
      id: st?.id ?? null,
      visible: !!coach && !coach.classList.contains('hidden') && coach.dataset.kind === 'tip',
      coversAnchor: geo.covers, inViewport: geo.inView, anchorInOpenPanel: geo.inPanel,
      eatsClicks: coachEatsClicks(),
      seen: [...g.state.tutorial],
    };
  },
  /**
   * 引导关的测试口。除了几何那三条（提醒气泡共用），重点是**课与局面的对应**：
   * 报出当前课的 id/todo/序号、十节还剩几节、这门课认不认这局是教学局。
   */
  guide(): {
    marker: boolean; id: string | null; todo: string; n: number; left: number; total: number;
    visible: boolean; coversAnchor: boolean; eatsClicks: boolean; inViewport: boolean;
    seen: string[]; facts: GuideFacts; intro: boolean; lessons: string[];
  } {
    const l = currentLesson();
    const geo = l ? coachGeom(l.anchor) : { covers: false, inView: false, inPanel: false };
    return {
      marker: inGuide(g.state.guide),
      id: l?.id ?? null,
      todo: l?.todo ?? '',
      n: position(l?.id ?? null), left: lessonsLeft(g.state.guide), total: LESSONS.length,
      visible: !!coach && !coach.classList.contains('hidden') && coach.dataset.kind === 'lesson',
      coversAnchor: geo.covers, inViewport: geo.inView, eatsClicks: coachEatsClicks(),
      seen: [...g.state.guide],
      facts: guideFactsNow(),
      intro: !need('#guideIntro').classList.contains('hidden'),
      lessons: LESSONS.map((x) => x.id),
    };
  },
  /** 测试口：直接开一局课，不必先点开场卡 */
  startGuide(): void { startGuide(); },
  /**
   * 测试口：这条候选会不会摆出抽牌扇面。只读 fanOffer，一行规则都不在这儿算。
   * uitest=events 那一档要用它挑一张"点下去直接落账"的卡，免得被抽牌礼拦在半路。
   */
  fanNeeds(id: string): boolean { return !!fanOffer(g, id); },
  /** 离线渲染一个音效配方，返回波形峰值（0..1）。测的是"真的出声了没有" */
  soundPeak(cue: string, step = 0, tint = 0): Promise<number> { return sfx.renderPeak(cue as Cue, step, tint); },
  start,
  renderPickers,
  /** 测试专用：改完 state 让它重投影一次（界面只读 state，不自己算账） */
  render(): void { renderAll(); },
  /**
   * 改**偏好**里的开关（不是这一局的 flags 快照）。标题页的签名宾候选看的是偏好，
   * 因为它决定的是"下一局"；测试要验"关掉之后候选框消失"就得动偏好，动 state 没用。
   */
  setPrefFlag(key: keyof FeatureFlags, on: boolean): void {
    prefs.flags[key] = on;
    applyPrefs();
    renderPickers();
  },
  /**
   * 测试专用：改偏好里的曲号（0 = 不放）。音频图的"有没有漏节点"必须在
   * **没人在飞的时刻**量——曲子放着时那个数是节奏的函数，量出来会自己闪断。
   */
  setPrefTrack(n: number): void {
    prefs.track = n;
    applyPrefs();
  },
  // 界面验收要能直接开侧页，不必模拟一串键盘事件
  renderShop,
  showEnd,
  openPanel: (which: string): void => openPanel(which as never),
  closePanels,
  select(n: number | string): void {
    const idx = typeof n === 'string' && n.includes(',')
      ? n.split(',').map(Number)
      : Array.from({ length: Number(n) }, (_, i) => i);
    for (const i of idx) {
      const c = g.state.hand[i];
      if (c) toggleChosen(g.state, c.id);
    }
    renderAll();
  },
  play(): Promise<void> { return doPlay(); },
  seat(id: string, edition: Edition = 'none'): void {
    if (!g.state.seats.some((x) => x.pid === id)) g.state.seats.push(mkSeat(id, edition));
    renderAll();
  },
  money(v: number): void { g.state.money = v; renderGauges(); },
  jump(night: number, stage: number): void { g.state.night = night; g.state.stage = stage as Stage; resetTable(); renderAll(); },
  /** 直接把本夜结清，用于截铺子与账本 */
  /** 计分拆解：把最近一次结算摊成文本，一行一个节点。
   *  需求文档的硬约束 2「一行可解释」要有能跑出来的东西，不是靠人读代码。
   *  新功能贡献的那几行用 ★ 标出来。演出路与跳过/抓帧路共用同一份事件流。 */
  chain(): string {
    return scoreText(lastChain, cardNameOf);
  },
  /** 最近一手内核给的三个数。读数判据要拿它当权威值，不能让测试自己算一遍。 */
  lastHand(): { chips: number; mult: number; value: number } | null {
    const e = lastChain && lastChain.events[lastChain.events.length - 1];
    return e ? { chips: e.after.chips, mult: e.after.mult, value: e.after.value } : null;
  },
  /** 新功能的实时状态：验收与调试都读这个，别去猜 DOM */
  feat(): Record<string, unknown> {
    const defs = g.state.seats.map((x) => patronById(x.pid));
    return {
      flags: { ...g.state.flags },
      claimed: g.state.claimed.slice(),
      sets: activeSets(defs).map((x) => x.name),
      seatXp: g.state.seats.map((x) => x.xp ?? 0),
      seatOrder: g.state.seats.map((x) => x.pid),
      discardTop: peekDiscard(g.state, 3).map((c) => c.id),
      discardCount: g.state.discardPile.length,
      betReprieves: g.state.betReprieves,
      totalCards: totalCards(g.state),
      maxLayers: MAX_LAYERS,
      // 随机事件的实时状态：门禁读这一份，不去猜界面上哪张卡被点过
      pendingEvent: g.state.pendingEvent.slice(),
      events: g.state.events.map((e) => ({ night: e.night, id: e.id })),
      eventMods: g.state.eventMods.map((m) => m.from),
      eventAt: g.state.eventAt,
      nightActions: g.state.nightActions,
      // 局长：门禁读这一格确认"标题页选的夜数真的进了这一局"，不看偏好也不看 DOM
      nights: g.state.nights,
    };
  },
  perf: perfProbe,
  clear(): void {
    if (g.state.status !== 'playing') return;
    g.state.score = targetOf(g.state) + 120;
    settle(g);
    g.openShop();
    renderAll();
    renderShop();
    openPanel('shop');
  },
};
(window as unknown as Record<string, unknown>).__H = api;

// ── 启动 ─────────────────────────────────────────────────────
// 偏好要在这一切之前读回来：音量、节奏、画法、上次选的牌组都存在本机
prefs = loadPrefs();
applyPrefs();          // 里面会 savePrefs + paintSoundBtn
pickedDeck = prefs.deck;
renderPickers();
// 续局按钮在 HTML 里默认 hidden：不在开场就查一次存档，玩家永远看不见它
refreshResume();
need<HTMLButtonElement>('#btnLastReport').hidden=loadReport()===null;
// 第一次玩的话，标题页前面先站一张课表卡（判据在 refreshIntro 里：没上过课 + 手上没存档）
refreshIntro();
// 偶尔一记壁炉噼啪，让房间是活的。抓帧与减少动效时不出声。只登记一次
// 壁炉：要不要响由这里挑（UI 的节拍器），**多大一记**由 core/sound.ts 查表算，
// 所以同一串步数永远得到同一串噼啪——音效序列可复现，不靠摇骰子
let crackleStep = 0;
if (!SNAP) setInterval(() => {
  if (prefs.ambience && !sfx.muted && Math.random() < 0.35) sfx.crackle(crackleStep++);
}, 4200);
if (params.get('speed')) speedMul = Math.max(0.05, Number(params.get('speed')));
// 风格样张：切换只改一个 data 属性，证明换皮不碰结构
if (params.get('style')) document.documentElement.dataset.style = params.get('style') as string;
if (params.get('perf')) setTimeout(() => perfProbe(), 400);
if (SNAP) document.documentElement.dataset.snap = '1';

if (params.get('autostart') === '1' || SNAP) {
  start(Number(params.get('seed') ?? 20261009), params.get('deck') ?? pickedDeck);
  // seats=hobbs:foil,rent —— 冒号后是版本，抓帧要能指定到具体座位
  for (const raw of (params.get('seats') ?? '').split(',')) {
    if (!raw) continue;
    const [pid, ed] = raw.split(':');
    api.seat(pid, (ed ?? 'none') as Edition);
  }
  if (SNAP) {
    // seal=0:red,2:blue —— 给指定手牌上蜡封，用来拍正交轴的可视化
    for (const raw of (params.get('seal') ?? '').split(',')) {
      if (!raw) continue;
      const [i, sl] = raw.split(':');
      const c = g.state.hand[Number(i)];
      if (c) c.seal = sl as Card['seal'];
    }
    for (const raw of (params.get('enh') ?? '').split(',')) {
      if (!raw) continue;
      const [i, e] = raw.split(':');
      const c = g.state.hand[Number(i)];
      if (c) c.enh = e as Card['enh'];
    }
    // 上面这些是直接改状态塞进场景的，不重渲染就永远画不出来
    renderAll();
    if (params.get('boss')) {
      g.state.stage = 2;
      g.state.bossId = params.get('boss') as string;
      if (params.get('night')) g.state.night = Number(params.get('night'));
      resetTable();
      renderAll();
      void showCurtain({ kicker: '不速之客', title: stakeLabel(g.state), blurb: stakeBlurb(g.state) });
    }
    // 牌背审片：?backs=1 摆一排扣过来的牌（抽牌仪式用的就是这一面）
    if (params.get('backs')) {
      document.documentElement.dataset.sheet = '1';
      const box = need('#cardsheet');
      box.style.gridTemplateColumns = 'repeat(6, 1fr)';
      for (let i = 0; i < 6; i++) {
        const node = el('div', 'card back');
        node.innerHTML = `<span class="backart"><svg viewBox="${BACK_VIEWBOX}" aria-hidden="true">`
          + BACK_ART + '</svg></span>';
        box.append(node);
      }
    }
    // 牌面审片：?cards=1 把 52 张牌面全摆出来（用的是 syncCard 本身，不另画一份）
    if (params.get('cards')) {
      document.documentElement.dataset.sheet = '1';
      const box = need('#cardsheet');
      const suits: Suit[] = ['s', 'h', 'd', 'c'];
      let n = 0;
      for (const st of suits) {
        for (let r = 14; r >= 2; r--) {
          const node = el('div', 'card');
          syncCard({ id: 900 + n++, rank: r, suit: st, enh: 'none', seal: 'none' }, node);
          box.append(node);
        }
      }
    }
    if (params.get('pick')) api.select(params.get('pick') as string);
    const step = params.get('play');
    if (step !== null) {
      const played = chosenCards(g.state);
      const res = play(g);
      if (res) applyEventsSync(res, played, Number(step));
    }
    if (params.get('codex')) { api.clear(); closePanels(); openPanel('codex'); }
    if (params.get('settings')) { api.clear(); closePanels(); openPanel('settings'); }
    if (params.get('receipt')) {
      g.state.score = targetOf(g.state) + 400;
      settle(g);
      void showCurtain({
        kicker: '本场结清', title: stakeLabel(g.state),
        blurb: `彩头 ${num(targetOf(g.state))}，做出 ${num(g.state.score)}`,
        lines: g.state.settlement.map((l) => ({ label: l.label, amount: l.amount })),
        sum: '1',
      });
      renderAll();
    }
    if (params.get('ledger')) { api.clear(); closePanels(); openPanel('ledger'); }
    else if (params.get('shop')) {
      api.clear();
      const r = params.get('raise');
      if (r) { setRaise(g, Number(r)); renderShop(); }
    }
    if (params.get('end')) showEnd(params.get('end') === 'win');
  } else if (params.get('demo')) {
    const t = Number(params.get('delay') ?? 260);
    setTimeout(() => {
      api.select(Number(params.get('pick') ?? 3));
      setTimeout(() => void doPlay(), 40);
    }, t);
  }
} else {
  need('#title').classList.remove('hidden');
}
// 抓帧与门禁要能一步落在课堂上：?lesson=1 就是替玩家点一下开场卡那颗按钮。
// 必须排在上面那段 autostart 之后——抓帧档本身就带着 snap=1，先跑的那次 start()
// 会把这局课换成一局普通牌局，样张里就什么气泡都没有了。
if (params.get('lesson') === '1') startGuide();
// 抓帧与门禁要能一步落在"事件刚递出来"那一刻：真开一局、真出手，一路打到内核递出三张候选。
// 留后门（直接改 state.pendingEvent）拍出来的样张演不了玩家真会看见的那一屏，所以不打。
if (params.get('events') === '1') {
  prefs.flags.events = true;
  start(Number(params.get('seed') ?? 20261012), 'standard');
  for (let i = 0; i < 12 && !g.state.pendingEvent.length && g.state.status === 'playing'; i++) {
    const picked = g.state.hand.slice(0, 3);
    g.state.chosen = picked.map((c) => c.id);
    const res = play(g);
    if (res) applyEventsSync(res, picked, -1);
    if (g.state.status === 'cleared') { g.openShop(); g.next(); renderAll(); }
  }
  renderEventPick();
}
// 抽牌礼的样张：上一段刚把三张候选递出来，这里替玩家点一条**要挑一张牌**的。
// 走的是 openFan 那一扇门（不是另搭一台舞台），所以拍到的就是玩家真会看见的那一排牌背。
if (params.get('fan') === '1') {
  for (const e of eventChoices(g)) if (openFan(e.id)) break;
}
document.body.dataset.ready = '1';
