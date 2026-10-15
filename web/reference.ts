// 玩家查阅页：读取真实局面和内容表；示例牌的计分成员交给内核识别。
import type { Card, HandKind, Suit } from '../core/hands.ts';
import type { GameState } from '../core/game.ts';
import { HANDS, SUITS, SUIT_GLYPH, SUIT_NAME, RANK_LABEL, SECRET_HANDS, evaluate } from '../core/hands.ts';
import { PATRONS, LETTERS, VOUCHERS, BOOKS } from '../core/content.ts';
import { RARITY_LABEL, HOOK_LABEL } from '../core/effects.ts';
import { materialById, sealById } from '../core/layers.ts';
import { specialById } from '../core/special-cards.ts';

const node = (tag: string, cls = '', text = ''): HTMLElement => {
  const n = document.createElement(tag); n.className = cls; n.textContent = text; return n;
};
// 5 张示例中保留陪牌，让玩家能区分「打出的牌」与「参与牌型计分的牌」。
const EXAMPLES: Record<HandKind, [number[], string]> = {
  high: [[14, 11, 9, 6, 2], 'shdcs'], pair: [[9, 9, 14, 6, 2], 'shdcs'],
  twopair: [[9, 9, 6, 6, 2], 'shdcs'], three: [[9, 9, 9, 6, 2], 'shdcs'],
  straight: [[5, 6, 7, 8, 9], 'shdcs'], flush: [[2, 5, 8, 11, 14], 'hhhhh'],
  full: [[9, 9, 9, 6, 6], 'shdcs'], four: [[9, 9, 9, 9, 2], 'shdcs'],
  sf: [[5, 6, 7, 8, 9], 'hhhhh'], royal: [[10, 11, 12, 13, 14], 'sssss'],
  five: [[9, 9, 9, 9, 9], 'shdcs'], flushhouse: [[9, 9, 9, 6, 6], 'hhhhh'],
  flushfive: [[9, 9, 9, 9, 9], 'sssss'],
};
const EXPLAIN: Record<HandKind, string> = {
  high: '没有组成更高牌型时，最高的一张计分。', pair: '两张同点数；这两张计分。',
  twopair: '两组对子；四张计分。', three: '三张同点数；这三张计分。',
  straight: '五张点数连续；A 可接 2 或 K，不能绕圈。', flush: '五张同花色，点数无需连续。',
  full: '三张同点数，加另一组对子。', four: '四张同点数；这四张计分。',
  sf: '五张点数连续且同花色。', royal: '同花色的 10、J、Q、K、A；与同花顺共用等级。',
  five: '五张同点数，需要复制或改写牌。', flushhouse: '同花色的三条与对子，需要重复牌。',
  flushfive: '五张同点同花，需要重复牌。',
};
export function exampleCards(kind: HandKind): Card[] {
  const [ranks, suits] = EXAMPLES[kind];
  return ranks.map((rank, id) => ({ id, rank, suit: suits[id] as Suit, enh: 'none', seal: 'none' }));
}
export function handExample(kind: HandKind): HTMLElement {
  const root = node('div', 'hand-example'); root.dataset.kind = kind;
  const cards = exampleCards(kind), scoring = evaluate(cards).scoring;
  const row = node('div', 'sample-cards');
  for (const c of cards) {
    const counts = scoring.some((x) => x.id === c.id);
    const card = node('span', `sample-card ${c.suit === 'h' || c.suit === 'd' ? 'red' : ''}${counts ? ' counts' : ' kicker'}`,
      `${RANK_LABEL(c.rank)}${SUIT_GLYPH[c.suit]}`);
    card.setAttribute('aria-label', `${SUIT_NAME[c.suit]}${RANK_LABEL(c.rank)}，${counts ? '参与计分' : '陪牌不计分'}`);
    row.append(card);
  }
  root.append(row, node('p', '', EXPLAIN[kind])); return root;
}

export function renderCatalog(body: HTMLElement, kind: string, state: GameState): void {
  const rows = kind === 'patrons' ? PATRONS.map((p) => ({ name: p.name, info: p.blurb,
    meta: `${RARITY_LABEL[p.rarity]} · ${HOOK_LABEL[p.hook]}${state.seats.some((s) => s.pid === p.id) ? ' · 已入座' : ''}` }))
    : kind === 'letters' ? LETTERS.map((l) => ({ name: l.name, info: l.blurb, meta: `一次性 · ${l.picks ? `需选 ${l.picks} 张牌` : '无需选牌'}` }))
    : kind === 'books' ? BOOKS.map((b) => {
      const seen = !SECRET_HANDS.includes(b.kind) || state.discovered.includes(b.kind);
      return { name: seen ? b.name : '未见的牌谱',
        info: seen ? `${HANDS[b.kind].name}升一级：+${HANDS[b.kind].dChips} 流水 / +${HANDS[b.kind].dMult} 倍注` : '本局发现对应的隐秘牌型后，可在这里查阅。',
        meta: '一次性 · 牌型升级' };
    })
    : VOUCHERS.map((v) => ({ name: v.name, info: v.blurb, meta: `整局生效${state.vouchers.includes(v.id) ? ' · 已持有' : ''}` }));
  const label = node('label', 'reference-search', '查找名称或效果');
  const search = document.createElement('input'); search.type = 'search'; search.id = 'catalogSearch';
  search.placeholder = '例如：流水、弃牌、霍布斯'; label.append(search);
  const count = node('p', 'reference-note'); count.setAttribute('aria-live', 'polite');
  const list = node('div', 'catalog-list');
  const draw = () => {
    const term = search.value.trim().toLocaleLowerCase();
    const matches = rows.filter((r) => `${r.name} ${r.info} ${r.meta}`.toLocaleLowerCase().includes(term));
    count.textContent = `${matches.length} / ${rows.length} 项 · 内容目录，实际获得以牌局为准`;
    list.replaceChildren();
    for (const r of matches) {
      const entry = node('article', 'catalog-entry');
      entry.append(node('h3', '', r.name), node('small', '', r.meta), node('p', '', r.info)); list.append(entry);
    }
    if (!matches.length) list.append(node('p', 'reference-note', '没有匹配项，试试其他名称或效果。'));
  };
  search.addEventListener('input', draw); body.append(label, count, list); draw();
}

const ZONES = [['deck', '待抽'], ['hand', '手中'], ['table', '桌面'], ['discardPile', '弃牌']] as const;
export function renderDeck(body: HTMLElement, state: GameState): void {
  const all = ZONES.flatMap(([key, name]) => state[key].map((card) => ({ card, zone: key, name })));
  body.append(node('p', 'deck-total', `本局共 ${all.length} 张 · ${ZONES.map(([key, name]) => `${name} ${state[key].length}`).join(' · ')}`));
  body.append(node('p', 'reference-note', '按点数或花色整理，不代表抽牌顺序。复制、移除和强化均按当前牌组显示。'));
  body.append(node('p', 'deck-composition', SUITS.map((s) => `${SUIT_GLYPH[s]} ${all.filter(({ card }) => card.suit === s).length}`).join('　')));
  const controls = node('div', 'reference-filters');
  const select = (id: string, title: string, options: [string, string][]): HTMLSelectElement => {
    const label = node('label', '', title), s = document.createElement('select'); s.id = id;
    for (const [value, text] of options) { const o = document.createElement('option'); o.value = value; o.textContent = text; s.append(o); }
    label.append(s); controls.append(label); return s;
  };
  const zone = select('deckZone', '位置', [['all', '全部'], ...ZONES.map(([key, name]): [string, string] => [key, name])]);
  const suit = select('deckSuit', '花色', [['all', '全部'], ...SUITS.map((s): [string, string] => [s, SUIT_NAME[s]])]);
  const sort = select('deckSort', '排序', [['rank', '点数从高到低'], ['suit', '花色优先']]);
  const count = node('p', 'reference-note'); count.id = 'deckCount'; count.setAttribute('aria-live', 'polite');
  const grid = node('div', 'deck-grid');
  const draw = () => {
    const cards = all.filter((r) => (zone.value === 'all' || r.zone === zone.value) && (suit.value === 'all' || r.card.suit === suit.value));
    cards.sort((a, b) => (sort.value === 'suit' ? SUITS.indexOf(a.card.suit) - SUITS.indexOf(b.card.suit) : 0)
      || b.card.rank - a.card.rank || SUITS.indexOf(a.card.suit) - SUITS.indexOf(b.card.suit) || a.card.id - b.card.id);
    count.textContent = `显示 ${cards.length} / ${all.length} 张`; grid.replaceChildren();
    for (const { card: c, zone: z, name } of cards) {
      const item = node('div', `deck-card ${c.suit === 'h' || c.suit === 'd' ? 'red' : ''}`);
      item.dataset.cardId = String(c.id); item.dataset.zone = z; item.dataset.rank = String(c.rank); item.dataset.suit = c.suit;
      item.append(node('b', '', `${RANK_LABEL(c.rank)}${SUIT_GLYPH[c.suit]}`), node('small', '', name));
      if (c.enh !== 'none') item.append(node('small', '', materialById(c.enh).name));
      if (c.seal !== 'none') item.append(node('small', '', sealById(c.seal).name));
      const rare=specialById(c.special);if(rare)item.append(node('small','rare-label',`${rare.glyph} ${rare.name}`));
      item.title = [materialById(c.enh).line, sealById(c.seal).line,rare?.blurb].filter(Boolean).join('；'); grid.append(item);
    }
    if (!cards.length) grid.append(node('p', 'reference-note', '这个范围没有牌。'));
  };
  for (const s of [zone, suit, sort]) s.addEventListener('change', draw);
  body.append(controls, count, grid); draw();
}
