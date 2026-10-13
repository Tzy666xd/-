// 引导关实测：证明 core/guide.ts 里钉住的那个种子，**整门课一节不断上完**（现表 14 节）。
//
// 为什么要有这个脚本：课程表读的是局面，局面是发牌发出来的。发牌顺序只要被改动
// （换随机数、改牌堆、改 setupStage），第 1 场就可能一把打穿彩头线、或者铺子里
// 一个客人都请不起——那门课就会卡在第 5 节或第 6 节，玩家永远看不到后面的内容。
// 这种 bug 内核自检抓不到（它不看课程），界面门禁也抓不到（它跑的是真点击，很慢）。
// 所以这里用一个**按课程表行事的机器人**把整门课走一遍，只判三件事：
//   1. 每一节该出现的课都出现了，且顺序就是课程表顺序；
//   2. 每节课要求的动作机器人都当场做出来了（没有卡住的课）；
//   3. 走完全程没散局，且请得起一位客人、抬得起一注。
//
// 用法：
//   node tools/guide-check.mjs            # 验 core/guide.ts 里钉住的种子
//   node tools/guide-check.mjs --search   # 从头往后找能用的小种子，打印第一个
import { Game, play, settle, discard, buy, setRaise, targetOf, limits } from '../core/game.ts';
import { evaluate, HAND_ORDER } from '../core/hands.ts';
import { GUIDE, LESSONS, MARKER, beginGuide, guideFacts, lessonFor } from '../core/guide.ts';

const search = process.argv.includes('--search');
const from = Number(process.argv.find((a) => /^--seed=/.test(a) || '')) || 0;

/** 把手里最好的"成型的"2–5 张挑出来：牌型高低直接用 HAND_ORDER，不自己编优先级 */
function bestShape(hand) {
  let best = null;
  const walk = (start, cur) => {
    if (cur.length >= 2) {
      const kind = evaluate(cur).kind;
      if (kind === 'high') return;
      const tier = HAND_ORDER.indexOf(kind);
      if (!best || tier < best.tier || (tier === best.tier && cur.length > best.cards.length)) {
        best = { cards: [...cur], kind, tier };
      }
    }
    if (cur.length === 5) return;
    for (let i = start; i < hand.length; i++) { cur.push(hand[i]); walk(i + 1, cur); cur.pop(); }
  };
  walk(0, []);
  return best;
}

/** 弃哪两张：优先拆最没用的单张（点数最小、且不落在任何对子里） */
function swapTargets(hand) {
  const count = new Map();
  for (const c of hand) count.set(c.rank, (count.get(c.rank) ?? 0) + 1);
  const singles = hand.filter((c) => count.get(c.rank) === 1).sort((a, b) => a.rank - b.rank);
  return (singles.length >= 2 ? singles : [...hand].sort((a, b) => a.rank - b.rank)).slice(0, 2).map((c) => c.id);
}

/** 按课程表走一遍。返回 {ok, trace, fail, final} */
export function walk(seed, deckId = GUIDE.deckId) {
  const g = new Game(seed, deckId, { diff: GUIDE.diff, mode: GUIDE.mode, nights: GUIDE.nights });
  beginGuide(g.state);
  const seen = [MARKER];
  const trace = [];
  // 两本账：这节课的窗口有没有真的开过、它要求的动作有没有真的做到过。
  // 有了这两本账，"一把打穿第 1 场，于是讲次数那节课自动翻页"算正常，
  // "铺子里请不起客人，于是后面三节课整个不存在"算失败——只看 seen 分不出这两种。
  const opened = new Set();
  const doneEver = new Set();
  let guard = 0;

  const note = (id, extra) => trace.push(`${id}${extra ? `(${extra})` : ''}`);

  while (guard++ < 80) {
    const f = guideFacts(g.state, true);
    for (const l of LESSONS) {
      if (l.open(f)) opened.add(l.id);
      if (l.done?.(f)) doneEver.add(l.id);
    }
    const l = lessonFor(f, seen);
    if (!l) {
      // 没有课在讲，但课表还没走完：这一局得**自己往前打**，不然窗口永远开不到那里
      //（原来这里是直接 break，于是"最后一节课根本没出现过"也算通过）。
      if (g.state.status === 'shop') { g.next(); continue; }
      if (g.state.status === 'cleared') { g.openShop(); continue; }
      if (g.state.status === 'playing') {
        const b = bestShape(g.state.hand) ?? { cards: g.state.hand.slice(0, 1) };
        g.state.chosen = b.cards.map((c) => c.id);
        if (!play(g)) break;
        settle(g);
        continue;
      }
      break;
    }
    if (g.state.status === 'lost') return { ok: false, fail: `上到「${l.id}」时已经散局`, trace, seen };

    switch (l.req) {
      case 'read': {
        // 讲次数那节课（drive）带一条"做到才算过"：机器人替玩家把手打够，
        // 而不是点掉气泡就翻页——点掉气泡不会让彩头线自己消失
        let tried = 0;
        while (l.done && !l.done(guideFacts(g.state, true))
          && g.state.status === 'playing' && tried++ < 8) {
          const b = bestShape(g.state.hand);
          g.state.chosen = b ? b.cards.map((c) => c.id) : g.state.hand.slice(0, 1).map((c) => c.id);
          if (!play(g)) break;
          settle(g);
        }
        if (g.state.status === 'cleared') g.openShop();
        seen.push(l.id); note(l.id, l.done ? `打${tried}手` : '看过');
        break;
      }
      case 'discard': {
        const before = g.state.discardsUsed;
        g.state.chosen = swapTargets(g.state.hand);
        // discard() 的返回值是**进账的银钱**，£0 是合法结果，不能拿它当成败判据
        discard(g);
        if (g.state.discardsUsed === before) {
          return { ok: false, fail: `「${l.id}」按了弃牌却没弃掉（弃牌次数没动）`, trace, seen };
        }
        seen.push(l.id); note(l.id, `弃${g.state.discardsUsed}次`);
        break;
      }
      case 'pick': {
        const b = bestShape(g.state.hand);
        if (!b) return { ok: false, fail: `「${l.id}」要凑个牌型，可这手八张牌凑不出对子以上的任何牌型`, trace, seen };
        g.state.chosen = b.cards.map((c) => c.id);
        seen.push(l.id); note(l.id, b.kind);
        break;
      }
      case 'play': {
        if (!g.state.chosen.length) {
          const b = bestShape(g.state.hand);
          if (!b) return { ok: false, fail: `「${l.id}」要出牌，手里却没有成型的牌`, trace, seen };
          g.state.chosen = b.cards.map((c) => c.id);
        }
        const res = play(g);
        if (!res) return { ok: false, fail: `「${l.id}」按了出牌却没打出东西`, trace, seen };
        settle(g);
        if (g.state.status === 'cleared') g.openShop();
        seen.push(l.id); note(l.id, `+${res.value}`);
        break;
      }
      case 'clear': {
        let hands = 0;
        while (g.state.status === 'playing' && hands++ < limits(g.state).hands + 2) {
          const b = bestShape(g.state.hand);
          g.state.chosen = b ? b.cards.map((c) => c.id) : g.state.hand.slice(0, 1).map((c) => c.id);
          if (!play(g)) break;
          settle(g);
        }
        if (g.state.status !== 'cleared') return { ok: false, fail: `第 1 场打不穿彩头线 ${targetOf(g.state)}（status=${g.state.status}）`, trace, seen };
        g.openShop();
        seen.push(l.id); note(l.id, `£${g.state.money}`);
        break;
      }
      case 'hire': {
        const before = g.state.seats.length;
        const i = g.state.shop
          .map((sl, idx) => ({ sl, idx }))
          .filter((x) => x.sl.kind === 'patron' && !x.sl.sold && x.sl.price <= g.state.money)
          .sort((a, b) => a.sl.price - b.sl.price)[0];
        if (!i) {
          const prices = g.state.shop.filter((x) => x.kind === 'patron').map((x) => x.price).join('/') || '无';
          return { ok: false, fail: `「hire」请不起客人：£${g.state.money}，货架上 ${prices}`, trace, seen };
        }
        if (!buy(g, i.idx) || g.state.seats.length !== before + 1) {
          return { ok: false, fail: `「hire」买了 ${i.idx} 号位却没进座`, trace, seen };
        }
        seen.push(l.id); note(l.id, `${i.sl.pid}£${i.sl.price}`);
        break;
      }
      case 'buyItem': {
        // 买货架上那件小东西（引荐信或牌谱）：格子满了或钱不够都算这节课失败
        const idx = g.state.shop.findIndex((x) => x.kind === 'consumable' && !x.sold);
        if (idx < 0) return { ok: false, fail: '「satchel」要买那件小东西，可货架上根本没有这一格', trace, seen };
        const before = g.state.consumables.length;
        if (!buy(g, idx) || g.state.consumables.length !== before + 1) {
          return { ok: false, fail: `「satchel」买不下那件小东西：£${g.state.money}，价签 £${g.state.shop[idx].price}`, trace, seen };
        }
        seen.push(l.id); note(l.id, `£${g.state.shop[idx].price}`);
        break;
      }
      case 'raise': {
        setRaise(g, 1);
        if (g.state.raiseNext < 1) return { ok: false, fail: `「raise」抬到 +1 档没生效（raiseNext=${g.state.raiseNext}）`, trace, seen };
        seen.push(l.id); note(l.id, `×${g.state.raiseNext}`);
        break;
      }
      case 'cascade': {
        const b = bestShape(g.state.hand) ?? { cards: g.state.hand.slice(0, 1) };
        g.state.chosen = b.cards.map((c) => c.id);
        const res = play(g);
        if (!res) return { ok: false, fail: `「pulse」带着客人却打不出这一手`, trace, seen };
        settle(g);
        if (g.state.status === 'cleared') g.openShop();
        seen.push(l.id); note(l.id, `${g.state.seats.length}位客人+${res.value}`);
        break;
      }
      default:
        return { ok: false, fail: `课程表里冒出没实现的 req='${l.req}'`, trace, seen };
    }
  }

  // 卡住的课：窗口开过、既没做到也没被点掉——玩家会永远停在这一节
  const stuck = LESSONS.filter((x) => opened.has(x.id) && !seen.includes(x.id) && !doneEver.has(x.id))
    .map((x) => x.id);
  if (stuck.length) return { ok: false, fail: `有课卡住了：${stuck.join(' ')}`, trace, seen };
  // 六节动手的课必须真的动过手。少一节就是这门课在讲空话
  const handsOn = ['tray', 'swap', 'cash', 'hire', 'satchel', 'raise', 'pulse'];
  const skipped = handsOn.filter((id) => !seen.includes(id));
  if (skipped.length) return { ok: false, fail: `动手课没上到：${skipped.join(' ')}`, trace, seen };
  const order = trace.map((t) => t.split('(')[0]);
  const idx = order.map((id) => LESSONS.findIndex((x) => x.id === id));
  if (idx.some((v, i) => i && v < idx[i - 1])) return { ok: false, fail: '课程顺序倒回来了', trace, seen };
  if (g.state.status === 'lost') return { ok: false, fail: '上完课当场散局', trace, seen };
  return {
    ok: true, fail: '', trace, seen,
    final: {
      night: g.state.night, seats: g.state.seats.length, money: g.state.money,
      status: g.state.status, flipped: LESSONS.filter((x) => !seen.includes(x.id)).map((x) => x.id),
    },
  };
}

if (search) {
  const tried = [];
  for (let s = (from || GUIDE.seed); s < (from || GUIDE.seed) + 4000; s++) {
    const r = walk(s);
    if (r.ok) {
      console.log(`GUIDE SEED OK ${s}  ${r.trace.join(' → ')}`);
      console.log(`试过 ${tried.length + 1} 个种子，第一个能用的是 ${s}`);
      if (tried.length) console.log(`前几个为什么不合适：\n${tried.slice(0, 6).map((x) => `  ${x.s} ${x.why}`).join('\n')}`);
      process.exit(0);
    }
    if (tried.length < 40) tried.push({ s, why: r.fail });
  }
  console.log('GUIDE SEED FAIL：4000 个种子里没有一个能上完整门课');
  console.log(tried.slice(0, 10).map((x) => `  ${x.s} ${x.why}`).join('\n'));
  process.exit(1);
}

const r = walk(GUIDE.seed);
if (!r.ok) {
  console.log(`GUIDE CHECK FAIL  种子 ${GUIDE.seed}：${r.fail}`);
  console.log(`  走到：${r.trace.join(' → ') || '（一节课没上成）'}`);
  process.exit(1);
}
console.log(`GUIDE CHECK OK  种子 ${GUIDE.seed}（${GUIDE.diff}/${GUIDE.mode}/${GUIDE.nights} 夜）${LESSONS.length} 节课连得上`);
console.log(`  ${r.trace.join(' → ')}`);
console.log(`  上完时：第 ${r.final.night} 夜 ${r.final.status} · ${r.final.seats} 位客人 · £${r.final.money}`);
console.log(`  自动翻页（窗口没开或顺手做到了）：${r.final.flipped.join(' ') || '无'}`);
