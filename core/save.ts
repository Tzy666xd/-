// 存档。整局状态本来就是纯数据，所以直接序列化；
// 随机流不在 state 里，靠 (seed, 已调用次数) 复原——读档后抽到的牌和没存过一模一样。
//
// 读档路径按"外部输入不可信"处理：localStorage 里的东西可能是手改过的、旧版本的、
// 或者干脆是乱码。任何一处不合结构就返回 null，绝不让界面拿到半个对象。
import { Game, STAGE_KIND, DIFFS, MODES } from './game.ts';
import type { GameState } from './game.ts';
import type { Card } from './hands.ts';
import { HANDS, SUITS } from './hands.ts';
import { PATRONS, DECKS, VOUCHERS, BOSSES, LETTERS, deckLegal } from './content.ts';
import { sanitizeFlags, FLAGS_OFF } from './flags.ts';
import { clampNights } from './lengths.ts';
import { THRESHOLDS } from './thresholds.ts';
import { STEP_IDS } from './tutorial.ts';
import { LESSON_IDS, MARKER } from './guide.ts';
import { EVENT_IDS } from './events.ts';

export const SAVE_VERSION = 1;
export const SAVE_KEY = 'guinea.save.v1';

const SUIT_SET = new Set<string>(SUITS);
const ENH_SET = new Set<string>(['none', 'bonus', 'mult', 'glass', 'gold']);
const SEAL_SET = new Set<string>(['none', 'red', 'gold', 'purple', 'blue']);
const EDITION_SET = new Set<string>(['none', 'foil', 'holo', 'polychrome', 'negative']);
const STATUS_SET = new Set<string>(['playing', 'cleared', 'shop', 'won', 'lost']);
const KIND_SET = new Set(Object.keys(HANDS));
const PID_SET = new Set(PATRONS.map((p) => p.id));
const DECK_SET = new Set(DECKS.map((d) => d.id));
const VID_SET = new Set(VOUCHERS.map((v) => v.id));
const BOSS_SET = new Set(BOSSES.map((b) => b.id));
const LETTER_SET = new Set(LETTERS.map((l) => l.id));
const KIND_NAME_SET = new Set<string>(STAGE_KIND);
const DIFF_SET = new Set<string>(DIFFS.map((d) => d.id));
const MODE_SET = new Set<string>(MODES.map((m) => m.id));
const TID_SET = new Set<string>(THRESHOLDS.map((t) => t.id));
const SCOPE_SET = new Set<string>(['hand', 'night', 'run']);

const isInt = (v: unknown, min = -Infinity, max = Infinity): boolean =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isNum = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

function cardOk(c: unknown): c is Card {
  if (typeof c !== 'object' || c === null) return false;
  const x = c as Record<string, unknown>;
  return isInt(x.id, 0)
    && isInt(x.rank, 2, 14)
    && isStr(x.suit) && SUIT_SET.has(x.suit)
    && isStr(x.enh) && ENH_SET.has(x.enh)
    && isStr(x.seal) && SEAL_SET.has(x.seal);
}

/** 结构校验。返回 null 表示这份存档不可信，调用方应当直接丢弃 */
export function validate(raw: unknown): { state: GameState; calls: number } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o.v !== SAVE_VERSION) return null;
  if (!isInt(o.calls, 0)) return null;
  const s = o.state;
  if (typeof s !== 'object' || s === null) return null;
  const g = s as Record<string, unknown>;

  if (!isInt(g.seed, 0) || !isStr(g.deckId) || !DECK_SET.has(g.deckId)) return null;
  // 档位专属牌组与局长必须配得上：nights 是能单独改的那一格，改完它就能把
  // 一副本档选不到的牌组夹带进局（构造口会静默落回标准局，读档这条路也要挡住）
  if (!deckLegal(g.deckId, clampNights(g.nights))) return null;
  if (!isInt(g.night, 1, 100000) || !isInt(g.stage, 0, 2)) return null;
  if (!isStr(g.status) || !STATUS_SET.has(g.status)) return null;
  if (typeof g.endless !== 'boolean') return null;
  // 难度与模式可以缺省（v1 老档就是没有），但写了就必须认识，否则 limits() 会拿到 undefined
  if (g.diff !== undefined && (!isStr(g.diff) || !DIFF_SET.has(g.diff))) return null;
  if (g.mode !== undefined && (!isStr(g.mode) || !MODE_SET.has(g.mode))) return null;
  if (!isNum(g.money) || (g.money as number) < 0) return null;
  if (!isNum(g.rep) || (g.rep as number) < 0) return null;
  if (!isInt(g.score, 0)) return null;
  for (const k of ['raiseNext', 'raisedHere', 'handsLeft', 'discardsLeft',
    'handIndex', 'discardsUsed', 'rerolls'] as const) {
    if (!isInt(g[k], 0, 99)) return null;
  }
  // 牌区必须是数组，且每张牌都合法——不能"缺了就当空"，那会让读档后拿到半个对象
  for (const k of ['deck', 'hand', 'table', 'discardPile'] as const) {
    if (!isArr(g[k]) || !(g[k] as unknown[]).every(cardOk)) return null;
  }
  if (!isArr(g.chosen) || !(g.chosen as unknown[]).every((x) => isInt(x, 0))) return null;
  if (!isArr(g.seats) || !(g.seats as unknown[]).every((x) => {
    if (typeof x !== 'object' || x === null) return false;
    const r = x as Record<string, unknown>;
    if (!isStr(r.pid) || !PID_SET.has(r.pid)) return false;
    if (!isStr(r.edition) || !EDITION_SET.has(r.edition)) return false;
    // P1-2 长进记在座位上。它可以缺省（老档就是这个字段没有），
    // 但只要出现就必须是 0..64 的整数——否则一个 -1 或 1e9 就能把成长档数搅了
    return r.xp === undefined || isInt(r.xp, 0, 64);
  })) return null;
  // 同一位客人不该出现两次（存档被手改也可能造出来，读档时照样拒）
  if (new Set((g.seats as unknown[]).map((x) => (x as { pid: string }).pid)).size !== (g.seats as unknown[]).length) return null;
  if (!isArr(g.vouchers) || !(g.vouchers as unknown[]).every((v) => isStr(v) && VID_SET.has(v))) return null;
  if (g.bossId !== null && !(isStr(g.bossId) && BOSS_SET.has(g.bossId))) return null;
  if (!isArr(g.consumables) || !(g.consumables as unknown[]).every((c) => {
    if (typeof c !== 'object' || c === null) return false;
    const r = c as Record<string, unknown>;
    if (r.t === 'letter') return isStr(r.id) && LETTER_SET.has(r.id);
    if (r.t === 'book') return isStr(r.id) && KIND_SET.has(r.id);
    return false;
  })) return null;
  // 铺子位要逐个查：手改的档里塞一个不存在的 pid，buy() 会在 patronById 上当场抛
  if (!isArr(g.shop) || !(g.shop as unknown[]).every((x) => {
    if (typeof x !== 'object' || x === null) return false;
    const r = x as Record<string, unknown>;
    if (!isStr(r.kind) || !isNum(r.price) || (r.price as number) < 0) return false;
    if (typeof r.sold !== 'boolean') return false;
    if (r.kind === 'patron') {
      if (!isStr(r.pid) || !PID_SET.has(r.pid)) return false;
      return r.edition === undefined || (isStr(r.edition) && EDITION_SET.has(r.edition));
    }
    if (r.kind === 'voucher') return isStr(r.vid) && VID_SET.has(r.vid);
    if (r.kind === 'consumable') {
      const it = r.item;
      if (typeof it !== 'object' || it === null) return false;
      const ir = it as Record<string, unknown>;
      if (ir.t === 'letter') return isStr(ir.id) && LETTER_SET.has(ir.id);
      return ir.t === 'book' && isStr(ir.id) && KIND_SET.has(ir.id);
    }
    return false;
  })) return null;
  // 账本行的 stage 是阶段名（open/feast/boss），和 state.stage 的数字不是一回事——
  // 拿 isInt 查它会把所有"打过一场并存过档"的合法存档整份拒掉
  if (!isArr(g.ledger) || !(g.ledger as unknown[]).every((x) => {
    if (typeof x !== 'object' || x === null) return false;
    const r = x as Record<string, unknown>;
    return isInt(r.night, 1) && isStr(r.stage) && KIND_NAME_SET.has(r.stage)
      && isStr(r.label) && isNum(r.target) && isNum(r.money);
  })) return null;
  for (const k of ['books', 'handUse', 'discovered', 'settlement', 'log'] as const) {
    const v = g[k];
    if (k === 'books' || k === 'handUse') {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
      if (!Object.values(v as Record<string, unknown>).every((n) => isInt(n, 0, 100000))) return null;
    } else if (!isArr(v)) return null;
  }
  if (!isArr(g.discovered) || !(g.discovered as unknown[]).every((k) => isStr(k) && KIND_SET.has(k))) return null;
  // 阈值认领账：只认表里存在的 id。写了不存在的 id 一律丢掉（不当整份存档作废），
  // 因为这条不影响牌的正确性，只是少发一次奖
  if (g.claimed !== undefined) {
    if (!isArr(g.claimed) || !(g.claimed as unknown[]).every((x) => isStr(x) && TID_SET.has(x))) return null;
  }
  // flags 属于外部输入：只认白名单键与布尔值，其余由 sanitizeFlags 丢掉。
  // 缺省当"全关"处理，这样新功能上线前存的档照样能读。
  if (g.betReprieves !== undefined && !isInt(g.betReprieves, 0, 4)) return null;
  // 缓冲回合数也走白名单：写了就必须落在 0..9，否则一个负数或天文数字就能让兜底逻辑失灵
  if (g.buffer !== undefined && !isInt(g.buffer, 0, 9)) return null;
  // 签名宾只认表里真有的 id：认不出就当没选过（不毁档，也不凭空塞一位客人进来）
  if (g.signature !== undefined && !isStr(g.signature)) return null;
  if (g.flags !== undefined && (typeof g.flags !== 'object' || g.flags === null || Array.isArray(g.flags))) return null;
  // 引导进度只是"讲过哪几条"，不参与任何玩法计算。
  // 与 claimed 不同：**不认识的 id 丢掉就行**，不该因为将来改了一条文案就把整局档毁掉。
  if (g.tutorial !== undefined) {
    if (!isArr(g.tutorial) || !(g.tutorial as unknown[]).every(isStr)) return null;
  }
  // 引导关进度同一条规矩：形状不合就整份拒收，内容认不出只是丢掉
  if (g.guide !== undefined) {
    if (!isArr(g.guide) || !(g.guide as unknown[]).every(isStr)) return null;
  }
  // 随机事件的五个字段。形状不合就整份拒收——它们会改限额、改计分、改牌组；
  // 但"事件 id 认不出来"只在 deserialize 里丢掉（改文案、删事件不该毁掉一整局的档）。
  // 局长决定"打到第几夜算赢"和整条彩头曲线，越界的值不能夹带进来读档：
  // 一个 nights=0 的档会让第一夜就判胜，一个 999 会永远打不完。
  if (g.nights !== undefined && (!isInt(g.nights, 3, 15) || g.nights !== clampNights(g.nights))) return null;
  if (g.eventAt !== undefined && !isInt(g.eventAt, 0, 99)) return null;
  if (g.nightActions !== undefined && !isInt(g.nightActions, 0, 999)) return null;
  if (g.pendingEvent !== undefined
    && (!isArr(g.pendingEvent) || !(g.pendingEvent as unknown[]).every(isStr))) return null;
  if (g.events !== undefined && !(isArr(g.events) && (g.events as unknown[]).every((x) => {
    if (typeof x !== 'object' || x === null) return false;
    const r = x as Record<string, unknown>;
    return isInt(r.night, 1) && isStr(r.id) && isStr(r.result);
  }))) return null;
  if (g.eventMods !== undefined && !(isArr(g.eventMods) && (g.eventMods as unknown[]).every((x) => {
    if (typeof x !== 'object' || x === null) return false;
    const r = x as Record<string, unknown>;
    if (!isStr(r.from) || !isStr(r.scope) || !SCOPE_SET.has(r.scope) || !isInt(r.night, 1)) return false;
    if (r.hands !== undefined && !isInt(r.hands, -999, 999)) return false;
    // rule/eff 只许是"数字的数字表"：混进一个字符串，limits() 的累加就变成拼接，
    // 手牌上限能变成 "8333"，而这条路是存档这个外部输入开得出来的
    for (const key of ['rule', 'eff'] as const) {
      const m = r[key];
      if (m === undefined) continue;
      if (typeof m !== 'object' || m === null || Array.isArray(m)) return false;
      if (!Object.values(m as Record<string, unknown>).every(isNum)) return false;
    }
    return true;
  }))) return null;
  // 手牌与牌堆的总数要自洽：牌只能被移出或复制，不能凭空多出来
  const total = (g.deck as unknown[]).length + (g.hand as unknown[]).length
    + (g.table as unknown[]).length + (g.discardPile as unknown[]).length;
  if (total < 1 || total > 400) return null;
  return { state: s as GameState, calls: o.calls as number };
}

export function serialize(g: Game): string {
  const s = g.state;
  return JSON.stringify({
    v: SAVE_VERSION,
    calls: g.rand.calls,
    state: {
      seed: s.seed, deckId: s.deckId, night: s.night, stage: s.stage, status: s.status,
      money: s.money, rep: s.rep, raiseNext: s.raiseNext, raisedHere: s.raisedHere,
      deck: s.deck, hand: s.hand, table: s.table, chosen: s.chosen, discardPile: s.discardPile,
      seats: s.seats, consumables: s.consumables, books: s.books, handUse: s.handUse,
      vouchers: s.vouchers, bossId: s.bossId,
      night: s.night, nights: s.nights,
      handsLeft: s.handsLeft, discardsLeft: s.discardsLeft, handIndex: s.handIndex,
      discardsUsed: s.discardsUsed, score: s.score,
      shop: s.shop, rerolls: s.rerolls, ledger: s.ledger, discovered: s.discovered,
      settlement: s.settlement, endless: s.endless, diff: s.diff, mode: s.mode, log: s.log.slice(0, 12),
      flags: s.flags, claimed: s.claimed, betReprieves: s.betReprieves, buffer: s.buffer,
      signature: s.signature, tutorial: s.tutorial, guide: s.guide,
      eventAt: s.eventAt, nightActions: s.nightActions, pendingEvent: s.pendingEvent,
      events: s.events, eventMods: s.eventMods,
    },
  });
}

/** 只认这些键。用 Object.assign 整份复制是不行的：
 *  JSON.parse('{"__proto__":…}') 会造出一个自有属性叫 __proto__ 的对象，
 *  assign 时走 setter，等于让存档给状态对象挂原型。 */
const STATE_KEYS = [
  'seed', 'deckId', 'night', 'stage', 'status', 'money', 'rep', 'raiseNext', 'raisedHere',
  'deck', 'hand', 'table', 'chosen', 'discardPile', 'seats', 'consumables', 'books', 'handUse',
  'vouchers', 'bossId', 'handsLeft', 'discardsLeft', 'handIndex', 'discardsUsed', 'score',
  'shop', 'rerolls', 'ledger', 'discovered', 'settlement', 'endless', 'diff', 'mode', 'log',
  'flags', 'claimed', 'betReprieves', 'buffer', 'signature', 'tutorial', 'guide',
  'eventAt', 'nightActions', 'pendingEvent', 'events', 'eventMods', 'nights',
] as const;

function assignWhitelisted(to: Record<string, unknown>, from: Record<string, unknown>): void {
  for (const k of STATE_KEYS) if (k in from) to[k] = from[k];
}

/** 从存档文本重建一局。结构不合或版本不对一律返回 null */
export function deserialize(text: string): Game | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  const ok = validate(raw);
  if (!ok) return null;
  const g = new Game(ok.state.seed, ok.state.deckId, ok.state.endless);
  assignWhitelisted(g.state as unknown as Record<string, unknown>,
    ok.state as unknown as Record<string, unknown>);
  // 开关与认领账要过一遍清洗：assignWhitelisted 只保证键在白名单里，不管值长什么样。
  // 缺 flags（新功能上线前存的档）就落在构造期的 FLAGS_OFF 上——新功能默认关，
  // 老档照样能读，而且不会读出"半个开关状态"。
  g.state.flags = sanitizeFlags(g.state.flags, FLAGS_OFF);
  // 签名宾只有一条守卫，而且必须只有这一条：非字符串已被 validate 拦掉，
  // 再叠一层 PID_SET 判同样的事，等于留一行永远测不到的死代码（falsify 会把它记成盲区）。
  // 语义上正确的判据是"档里确实坐着这位"——选了人但人不在座上就当作没选。
  if (g.state.signature && !g.state.seats.some((x) => x.pid === g.state.signature)) g.state.signature = '';
  // 引导进度：只留认得的 id 并去重。改文案、删步骤都不该让老档读不出来
  g.state.tutorial = [...new Set((g.state.tutorial ?? []).filter((id) => STEP_IDS.has(id)))];
  // 引导关进度同上，但'on' 这个标记位要留得住——它是"这一局是一局课"的唯一凭据，
  // 丢了它，读档之后十节课会从头再弹一遍
  g.state.guide = [...new Set((g.state.guide ?? []).filter((id) => id === MARKER || LESSON_IDS.has(id)))];
  // 随机事件：认不出的 id 一律丢掉。挂着的一条修正如果指向已经不存在的事件，
  // 留着它就等于让一条"改不动也看不见"的规矩一直在改限额与计分
  g.state.pendingEvent = [...new Set((g.state.pendingEvent ?? []).filter((id) => EVENT_IDS.has(id)))];
  g.state.events = (g.state.events ?? []).filter((e) => EVENT_IDS.has(e.id));
  g.state.eventMods = (g.state.eventMods ?? []).filter((m) => EVENT_IDS.has(m.from));
  // 这一局关着这个功能，那这五格必须全空。不然手改的存档能把"待决事件"带进一局
  // 本来不该有这个功能的牌局：面板会弹出来，而内核的 maybeEvent 永远不会再递第二张，
  // 玩家对着一个"不存在"的功能被堵住出牌。
  if (!g.state.flags.events) {
    g.state.eventAt = 0; g.state.nightActions = 0; g.state.pendingEvent = [];
    g.state.events = []; g.state.eventMods = [];
  }
  g.notes = [];
  // 牌是全局自增 id：读档后必须把计数器推到已有最大值之后，
  // 否则「誊抄」复制出来的牌会和现有牌撞 id，渲染层就会把两张牌当成一张
  const all = [...g.state.deck, ...g.state.hand, ...g.state.table, ...g.state.discardPile];
  g.bumpUid(Math.max(0, ...all.map((c) => c.id)) + 1);
  // 随机流快进到存档现场：构造时已经消耗过的次数要一并算进去
  const target = Math.max(0, Math.min(400000, ok.calls - g.rand.calls));
  for (let i = 0; i < target; i++) g.rand.next();
  return g;
}

/** 存档摘要，给标题页那行"继续上一局"用；坏档一律返回 null */
export function summarize(text: string):
  { night: number; stage: number; money: number; seats: number; status: string; deckId: string } | null {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return null; }
  const ok = validate(raw);
  if (!ok) return null;
  const s = ok.state;
  return { night: s.night, stage: s.stage, money: s.money, seats: s.seats.length,
    status: s.status, deckId: s.deckId };
}
