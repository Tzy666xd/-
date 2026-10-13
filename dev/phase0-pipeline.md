# Phase 0 · 计分管道与 RNG 现状（只回答，不改代码）

对应需求文档第五节。四个问题逐条回答，末尾附**功能清单与现状的重叠表**——
那一部分决定了哪些 P0 其实已经做完，别重复建设。

代码位置均为本轮实读，行号以 `core/scoring.ts` 187 行、`core/game.ts` 788 行为准。

---

## 一、当前计分管道与 RNG 的现状

### 1.1 计分管道：一条，四个阶段，产物是事件序列不是一个数

唯一入口 `score(input: ScoreInput): ScoreResult`（`core/scoring.ts:81`）。
整条链只有两个可变累加器，`chips` 与 `mult`，收口方式固定：

```ts
// scoring.ts:93
const snap = (): Snap => ({ chips, mult, value: chips * mult });
```

`value` **永远**等于 `chips * mult`，没有第三个维度。这条是需求文档硬约束 1 的现成保障。

阶段顺序（严格按代码执行顺序，也就是事件流顺序）：

| # | 阶段 | 位置 | 挂载点 | 说明 |
|---|---|---|---|---|
| 1 | 牌型底 | `scoring.ts:99-102` | — | `handBase(kind, level)` 一次性写入 chips/mult |
| 2 | 贵客刁难 | `scoring.ts:105-115` | — | 被挡下的牌既不入流水也不惊动客人 |
| 3 | 出牌时 | `scoring.ts:144` | `onPlayed` | 全体客人过一遍 |
| 4 | 逐张计分 | `scoring.ts:150-173` | `onCard` | **左→右**，每张之后紧跟挂在这张牌上的客人 |
| 5 | 入局即算 | `scoring.ts:177-181` | `independent` | 翻倍注主力在此收口，乘的是已累积倍注；版本特效紧跟自家效果 |
| 6 | 收口 | `scoring.ts:183` | — | `push({t:'total'})`，取最后一条事件的 `after` 作返回值 |

**顺序是确定的、可断言的**：`roster` 由 `input.seats.map(...)` 生成（`scoring.ts:83`），
`seats` 是有序数组，所以客人座位次序直接进入结算次序；`live.forEach((c, i) => ...)`
保证计分牌左到右。这两点已经能写成测试断言。

事件类型共 6 种，每条都自带 `after` 快照（`scoring.ts:20-26`）：
`hand / blocked / card / patron / shatter / total`。
UI 侧 `runTimeline()` 逐条播放、把 `after` 贴屏幕，自己不做算术（`web/main.ts:793-886`）。
`requestSkip()` 走 `applyEventsSync()` 一次性落到终值（`main.ts:932`）——
所以**新增任何事件类型，播放路径与跳过路径必须同时改**，否则跳过会算错账。

### 1.2 六个挂载点里只有三个在管道内，另外三个只认银钱

`core/effects.ts:5-11` 声明 6 hook × 6 kind 的矩阵，实际内容也确实用满了
（实读 `content.ts`：independent×5、onCard×4、onRoundEnd×2、onPlayed×1、onHeld×1、onDiscard×1）。
但**触发点分散在三个不同的函数里**，且语义不对等：

| hook | 在哪触发 | 能否影响 chips/mult |
|---|---|---|
| `onPlayed` / `onCard` / `independent` | `score()` 内 | ✅ 完整，产生事件 |
| `onDiscard` | `discard()` `game.ts:420-432` | ❌ **只取 `.money`** |
| `onHeld` | `settle()` `game.ts:466-473` | ❌ **只取 `.money`** |
| `onRoundEnd` | `settle()` `game.ts:474-479` | ❌ **只取 `.money`** |

三处都是同一行写法：`.reduce((a, x) => a + (x.money ?? 0), 0)`。
后果要记着：今天给一个 `onHeld` 客人写 `mult: 5`，它会**静默失效**——不报错、不自检失败、
只是那 5 点倍注从来没存在过。这是当前架构里最隐蔽的一口井，新功能的验收要专门堵它。

### 1.3 RNG：一条全局流，可复现，可控

`core/rng.ts` 只有 mulberry32 加一个 `Rand` 壳，`next()` 每调一次 `calls += 1`。
内核里**没有任何 `Math.random()`**（AGENTS.md 明令，UI 层的骰子按钮是例外，它不参与对局）。

抽卡、洗牌、玻璃牌碎裂（`scoring.ts:169` `rand.chance(GLASS_BREAK)`）、铺子补货、
贵客指派，全部走同一条流。存档只存 `(seed, calls)`（`save.ts:138`），
读档时快进到目标步数（`save.ts:182`），所以**读档后抽到的牌与没存过完全一致**。

seed 可控：`Game` 构造函数吃 seed，URL 有 `?seed=`，UI 有种子输入框与骰子。

⚠️ 这条性质对新功能有实际约束：**任何新 hook 只要多消耗一次 RNG，整条随机流就往后挪**，
老存档快进的步数会落到不同的牌上。所以新功能若要摇骰，必须
(a) 挂在固定的调用序号上、(b) 存档版本号 +1 并拒绝旧版本、或 (c) 用独立子流派生
（`new Rand(seed ^ 0x5f3a)`）而不污染主流。**建议 (c)**：主流继续负责发牌与铺子，
新子系统各开自己的流，互不影响，这样旧存档与 `?seed=4242` 抓帧基线都不动。

---

## 二、支撑这些功能，管道要补哪几个 hook

需求文档的九个功能，落到现有管道上缺 5 个位置。命名与签名沿用现有风格
（数据 + `apply: (ctx) => Effect | Effect[] | null`，不引入 class、不引入 enum）。

### H1 `onScored` — 阈值奖励 / 加注奖励的落点（P0-1、P0-3）

现在 `total` 之前**没有**任何 hook，而 `push({t:'total'})` 是硬编码的最后一步。
阈值奖励必须在 `independent` 之后、`total` 之前插入，否则它乘不到已累积的倍注，
或者乘完了却没进 `value`。

```ts
// 新增事件类型，与现有 6 种并列
| { t: 'bonus'; source: string; addChips: number; addMult: number;
    xmult: number; note: string; after: Snap }

// 管道里插在 scoring.ts:183 之前
for (const cue of run('onScored')) applyCue(cue, null);
push({ t: 'total' });
```

`source` 是给拆解 UI 用的可解释标签（例 `'高利贷 · 还差 0'`），
`Hook` 联合类型与 `HOOK_LABEL` 同步加一项。读状态：当前 `chips/mult/value`；
写状态：同 `applyCue`。**幂等**：不消耗 RNG，纯函数。

### H2 `checkTarget` — 加注的成败判定（P0-1）

判定现在**在管道外**：`play()` 里 `if (s.score >= targetOf(s)) settle(g)`（`game.ts:375`）。
加注要的是"达标给什么、不达标罚什么"，所以现在这个 if 必须升级成一个有返回值的钩子，
而不是散在 `play()` 里的分支。

```ts
interface BetOutcome {
  reached: boolean;
  tier: number;
  reward: Effect | null;     // 达标：走 H1 或 settle 的 SettleLine
  penalty: FailPenalty;      // 'loseRound' | 'losePatron' | 'loseMoney' | 'loseRun'
  applied: string;           // 一句人话，进 log 与拆解
}
function resolveBet(s: GameState, target: number, bet: BetDef): BetOutcome
```

现有 `FailPenalty` 事实上只有 `loseRun` 一档（未达标即 `status='lost'`，`game.ts:380-386`）。
需求文档要的三档里，`loseRound`（本场重来、扣一次出牌）和 `loseMoney` 都还没有。

### H3 `onSeatShift` + 邻接解析 — 槽位排序（P0-2）

位置语义**已经存在但只有一处**：`cuesFor()` 里 `def.copy === 'left'`
用 `roster.indexOf(row)` 找左邻（`scoring.ts:68-73`）。也就是说"顺序影响结算"这件事
架构上已经成立，缺的是：

**实查 `s.seats` 的全部写操作**，只有三处 append 和一处 remove，**没有任何换座接口**：
`game.ts:609` 铺子买入 push、`game.ts:759` 起手牌组 `grant` 附赠客人 push、
`game.ts:629` `sellSeat` 按 index splice、`main.ts:1794` 测试口子 `__H.seat()` push。
所以今天座位次序事实上等于**获得次序**，这是唯一存在的顺序信号，也是玩家不可控的。

```ts
// 1) 换座接口（现在完全没有；buy 只 push，sellSeat 只 splice）
function reorderSeat(g: Game, from: number, to: number): boolean;  // 返回是否付得起 swapCost

// 2) 邻接规则进 PatronDef，与 copy 平级
adjacency?: { tag: string; effect: Effect };   // 左邻同 tag 时额外来一发

// 3) Cue 带上位置，让拆解能写"第 2 位 · 邻接 +12 倍注"
type Cue = { pid: string; index: number; effect: Effect }
```

验收要的"交换两张后总分变化可预测、可复现"，靠现有 `snap()` 机制天然成立——
因为 `chips/mult` 只有加法和右乘，**顺序影响结果仅当出现 xmult**，
所以判据应该写成：交换前后 `events` 序列逐条比对，而不是只比 `value`。

### H4 让 `onDiscard` / `onHeld` / `onRoundEnd` 不再只认银钱（P1-3、P1-4 的前置）

三处 `.reduce(money)` 要改成"要么完整支持、要么显式声明只支持 economy"。
**建议后者**：在 `PatronDef` 上加一条自检约束——
非 `score()` 内触发的 hook 若 `kind !== 'economy'`，selftest 直接红。
理由是这三个点都在计分批之外，让它们回写 chips/mult 会破坏
"事件序列就是账目"这条承重墙（付了钱却没有对应事件，UI 演不出来）。

### H5 `onPreDeal` — 桌规 / 诅咒牌（P2，暂不做但先留位）

牌型底之前没有 hook，桌规（环境规则）与诅咒牌的"改造这手牌"必须落在
`handBase` 之前或改 `result.scoring`。留位即可，不加实现。

### 交付包第 3 项（集成点说明）的填法

新功能一律按这张表填：挂在 H1–H5 哪一格 / 读 `chips,mult,value` 还是读 `GameState` /
写 `events` 还是写 `money`/`mods` / 是否摇骰（摇骰必须走独立子流）。

---

## 三、配置格式选型与目录结构

### 3.1 结论：**保持 TS 模块当数据表，不要 JSON，不要 plist**

这条不是口味问题，是硬约束推出来的：

```html
<!-- web/index.html:8 -->
<meta http-equiv="Content-Security-Policy" content="... connect-src 'none'; ...">
```

`connect-src 'none'` **禁掉了所有 fetch/XHR**。运行时读 `.json` 配置文件这条路
被自己的安全策略堵死了——要读就得放开 CSP，而"不许有任何网络依赖"是项目总纲。
plist 同理，且 TS 侧没有现成解析器。

另外三条支持这个结论：
- 零构建（`tools/build-web.mjs` 只用 `node:module` 的 `stripTypeScriptTypes`）。
  JSON 得额外打包进 `web/gen`，并多一条"资源点名"失败面。
- `Record<Hook, string>` 这类**类型安全**现在是有编译期保障的；JSON 会退化成
  `as unknown as` 加一堆运行时校验，而运行时校验只在读档路径值得做（那是外部输入）。
- 自检和反证要能直接 import 常量表。`falsify.sh` 注破坏靠的是**源码里的字面量**，
  数据搬到 JSON 后这套注法全部失效。

**选型**：数据 = TS `const` 表（继续 `core/content.ts` 的路子）；
只有**用户产物**（沙盒导入的自定义牌组）才走 JSON，且走 `save.ts` 已有的那套
"外部输入不可信"校验。

### 3.2 目录结构建议

```
core/
  content/
    patrons.ts       # 座上宾（按稀有度或主题拆片，纯搬迁不改语义）
    bets.ts          # 新增：加注档位表 BetDef[]        ← P0-1
    thresholds.ts    # 新增：回合阈值表 ThresholdDef[]  ← P0-3
    sets.ts          # 新增：tag 与套装规则 SetDef[]     ← P1-1
    cards.ts         # 新增：强化层级 MaterialDef/EffectDef ← P1-3
    tables.ts        # 预留：桌规 RuleDef[]              ← P2
    flags.ts         # 新增：FEATURE_FLAGS 默认值 + 类型
    index.ts         # 只做 re-export，保持 content.ts 的公开面不变
  content.ts         # 变成薄壳 re-export，避免一次大改冲击 12 个 import 方
```

`PatronDef` 加 `tags: string[]` 与 `growth?: GrowthDef` 是**加字段**，
不是改结构——现有 14 位客人的定义不用动，`fuzz`/`selftest` 的构造点也不会崩。

### 3.3 feature flag 落点

现在**代码里没有任何 feature flag 机制**（实查：`grep -rn "flag\|FLAG" core/*.ts` 零命中）。
建议最小形态：

```ts
// core/content/flags.ts
export interface FeatureFlags {
  betTiers: boolean; seatAdjacency: boolean; roundThresholds: boolean;
  patronSets: boolean; patronGrowth: boolean; cardLayers: boolean;
  discardPileOps: boolean;
}
export const FEATURE_FLAGS: FeatureFlags = { /* 全部默认 false */ };
export const FLAGS_ON: FeatureFlags = { /* 全开，供测试与试玩 */ };
```

要点：flag 关闭时**新字段必须完全不被读取**（不是"读取了但不生效"），
这样才能证明"关掉就等于没有这个功能"，也就等于老代码路径。
`GameState` 里加 `flags: FeatureFlags` 快照并入存档，
否则同一局跨 flag 版本会读出一半生效的怪账。

---

## 四、沙盒/调试模式的最低可用形态

**好消息：大部分已经有了**，在 `web/main.ts:1757-1807` 的 `window.__H` 上，
已经支撑着 6 档无头行为测试。缺的不是重写，是补齐 4 项。

壳侧现有命令行（实读 `shell/Sources/House/main.swift`）：
`--uitest --shot --boot --query --delay --window --anim --burst --tick`。
其中 `--tick`（心跳，`main.swift:249,296`）是无头环境下让动画时钟不冻结的那个开关，
沙盒模式要用它才跑得动带演出的回归；`--boot` 是文档级注入 localStorage 的口，
新功能的 flag 快照如果要从命令行摆，走这条最省事。

| 需求文档要的能力 | 现状 | 缺什么 |
|---|---|---|
| 固定 seed | ✅ `__H.start(seed)`、URL `?seed=` | — |
| 配牌（指定手牌/座位） | 🟡 `__H.seat(pid, edition)`、`__H.select(n)` | 不能指定**手牌具体是哪几张**（只能按序号选前 n 张）；不能直接摆 `s.table` |
| 跳轮次 | ✅ `__H.jump(night, stage)`、`__H.clear()`（直接结清本场并进铺子） | 没有"跳到第 N 手" |
| 打印 RNG 序列 | ❌ | 只有 `rand.calls` 计数，**摇不出未来序列** |
| 断言结算链 | 🟡 事件流可重放 | 没有把 `score()` 的 `events` 打成文本的口子 |

### 4.1 最低可用四件套（建议形态，全部只加不改）

```ts
// ① RNG 预演：不改状态的纯窥探。Rand 内部是 mulberry32，
//    可以照抄一个"影子 Rand"从当前 (seed, calls) 往前摇 n 个。
__H.rngPeek(n: number): number[]

// ② 手牌直配：绕开发牌，直接把牌摆进手里。给 fuzz 与手工回归用。
__H.setHand(spec: string): void        // 'AS,KH,7D,7C,3S' 的紧凑写法
__H.setSeats(spec: string): void       // 已有 seats= URL 参数，补一个方法版

// ③ 结算链打印：一次出牌后把事件摊成文本
__H.dumpChain(): string
//  →  流水 60 × 倍注 3 = 180
//     [hand]      同花 · 2级        60 × 3   = 180
//     [card] A♠  +11 流水                     71 × 3   = 213
//     [patron] 收租人 +2 倍注                  71 × 5   = 355
//     [bonus]  高利贷·阈值达成 ×1.5            71 × 7.5 = 532   ← 新功能贡献行
//     [total]                                  = 532

// ④ 沙盒入口：无头可跑
guinea --sandbox 'seed=4242;night=3;stage=1;money=40;seats=hobbs:foil,rent;hand=AS,KS,QS,JS,10S'
```

`dumpChain()` 是这里最值钱的一项：交付包第 4 项（计分拆解样例输出）
和验收（"达标瞬间拆解多出一行"）都靠它，而且它能直接长成 UI 的拆解面板——
现有的 `readout` 只显示 chips/mult/total 三个滚轴（`main.ts:638`），
**还没有逐行的拆解视图**。硬约束 2"一行可解释"要能被机器验证，就得先有这坨文本。

### 4.2 与现有门禁的接线

新增功能必须过五道门禁（AGENTS.md 已列），实操上要注意两点：

1. `uitest.js` 的性能档靠"锁住输入的时间"作判据（`tools/uitest.js:340`，界线上限 4000ms）。
   新 hook 每多一条事件就多一次 `await wait(...)`，
   **P0-3 阈值奖励若做成逐条演出，最慢一手会直接顶穿这条线**。
   要么并进现有 `patron` 事件，要么同步调那条上限。
2. `falsify-ui.sh` 现在有 16 条注入、零盲区（本轮实测）。新功能的每条判据
   都要按同样标准配一条"注回去要求变红"的注入，否则就是假绿。

### 4.3 实测发现：这两档红可能是环境，不是产品

2026-10-10 做动画轮时踩到，写在这里免得下一个人重踩：

`uitest.sh` 的「跳过演出」「性能与泄漏」要等 WAAPI **自然跑完**，而
WKWebView 的动画时钟只在真的合成帧时才走。**显示器一睡（`CGDisplayIsAsleep=1` /
`CGDisplayIsActive=0`）这两档就必然红**，签名是 `busy=true anims=3`（卡在 `await landed`）
或耗时 `-1ms`（`whenReady` 的超时哨兵），而 `keys/prefs/reload/again` 四档照常绿。
`--tick` 心跳救不了：`takeSnapshot` 照样返回、心跳一次不卡，只是没屏可合成。

当时同一份 CSS 先三跑三绿、用户睡后变三跑三红，被误判成动画回归，
为此改了两轮水位反光又整个删掉——白做。顺带暴露一个**空判据洞**：
`falsify-ui.sh` 只要求"注入后变红"，环境已红时 16 条注入全算"被抓到"，
于是会打印一个假的 `FALSIFY-UI OK`。

已经落成的两个守卫（别改回去）：
- `tools/uitest.sh` 开头打印 `环境：显示器 asleep=… active=…`，睡着时明写这两档不可信。
- `tools/falsify-ui.sh` 在显示器睡着、**或未注入的基线没绿**时直接 `exit 2` 拒绝结论。
  基线前置是更根本的那条：注入判据只有在"基线绿"的前提下才有意义。

**对新功能的实际影响**：新 hook 每多一条事件就多一次 `await wait()`，
这类时间敏感判据的复跑都要求显示器醒着。做 P0-3 之前要么先把动画档改成
不依赖自然时钟（比如让测试自己 `finish()` 再断言终值），要么把"要醒着跑"写进验收步骤。

---

## 五、重叠表：功能清单 vs 现状（**先看这张表再排期**）

需求文档的 P0 里有**一个已经做完、一个做了一半**。直接照单开工的话会重做。

| 编号 | 需求 | 现状 | 真正的增量 |
|---|---|---|---|
| **P0-1 加注** | 选档级赌目标分 | 🟢 **约 70% 已实现**：`setRaise(g, 0..4)`（`game.ts:694`）；彩头 `× 1.5^tier`（`game.ts:230`）；赏金 `× (1+0.5·tier)`（`game.ts:450`）；盈余折现含 `+raisedHere`（`game.ts:454`）；声望累加（`game.ts:494`）；抬得越高来客档次越高（`restock` 用 `rep + raisedHere`）；`stakeLabel` 已展示 | ①档位从硬编码 `1.5^n` 变成 `BetDef[]` 数据表；②`failPenalty` 三档（现在只有输整场）；③`visibleHint` 开关；④若要"每手牌选档"而非"每场选档"，是**另一条产品决定**，见下 |
| **P0-2 槽位排序** | 手动调整结算顺序 | 🟡 顺序**已经有意义**（`seats` 有序数组 + `copy:'left'` 靠 `roster.indexOf`）；但**没有任何换座接口**，也没有邻接规则 | `reorderSeat()` + `swapCost` + `adjacency` 规则 + `slotIndexBonus` 表 |
| **P0-3 阈值奖励** | 冲线拿奖励 | 🔴 不存在。最接近的是 `settle()` 的"盈余折现"，那是**过了线之后**按超出比例折钱，不是"到达某个中间阈值即触发" | H1 `onScored` + `ThresholdDef[]` + `progressVisible`（`scoreline` 现在只画 score/target 一根线） |
| **P1-1 套装 tag** | 围绕 tag 构筑 | 🔴 不存在。`PatronDef` 有 `kind`（6 类效果）与 `rarity`，但那是**分类不是构筑轴**；`grep tags` 零命中 | `tags: string[]` + `SetDef`。注意需求文档自己禁了"直接乘倍率"，与 H1 不冲突，可走 `Mods`（`slots/freeRerolls/discards`） |
| **P1-2 成长型** | 用多了变强 | 🟡 原料齐了：`s.books[k]` 是牌型等级，`s.handUse[k]` 已在统计每手牌型用了几次（`game.ts:362`）。缺"客人自身按使用次数升级" | `growth?: {xpPerUse, levels, cap}` + 在 `applyCue` 处记使用次数。**`cap` 必须有**，现有 `editionEffect` 是无上限的静态加成 |
| **P1-3 牌强化 2 层** | material + effect 两层 | 🟢 **结构天然就是两层**：`Card = {id, rank, suit, enh, seal}`，`enh`（bonus/mult/glass/gold）与 `seal`（red/gold/purple/blue）**已经是正交双槽**，代码注释明写"一张牌可以同时是烫金 + 红蜡封"（`hands.ts:11`） | 把 `enh`/`seal` 从两个 enum 泛化成 `MaterialDef`/`EffectDef` 引用表；`maxLayers: 2` 已由类型保证（各只有一个字段，物理上叠不了第三层） |
| **P1-4 弃牌堆可操作** | peek / 重排 / 回牌堆 | 🔴 `s.discardPile` 是 `Card[]`，但**只进不出**：`discard()` push、`recycle()` 整体 splice 回牌堆洗牌。UI 完全看不见弃牌堆 | 读接口 + `peekN` + 回牌堆动作。**注意**：`recycle()` 的注释（`game.ts:721-723`）记着"漏掉 discardPile 会让牌永久蒸发"是 fuzz 抓出来的坑——动这个列表要把那条判据一起看 |
| P2 桌规/Boss 多阶段/分支地图/诅咒 | — | 🟡 `BossDef` 已有 `suitLock/faceLock/taxDiscard/handSize/hands`（单阶段）；贵客开场幕已有 | 需要先有 H5 `onPreDeal` |

### 5.1 三个"这个功能让玩家多做了什么决定"的现成答案

需求文档附加约束要求每个功能提交时回答这一条。先记三个已经能答的：

- **P0-1**：赌"本场彩头 ×1.5 我扛不扛得住"——现有抬注已经在答，且答得比需求文档好
  （它同时改变了来客档次，风险与构筑机会同向变化）。
- **P0-2**：赌"把 ×倍注的客人挪到 ×倍注客人右边，让两个连乘叠起来"——
  这是**唯一真正需要 xmult 存在顺序才有意义**的功能，所以它必须和邻接规则一起做，
  单独做换座接口玩家看不出区别（加法可交换）。
- **P1-4**：赌"弃掉的牌待会儿还能不能捞回来"——但它和现有的 `recycle()` 语义冲突，
  做之前要先定"捞回来"算不算破坏牌堆消耗这个压力源。

### 5.2 建议的排期调整

需求文档说"每轮只做 P0 中的一个 + P1 中的一个"。按重叠表，我建议第一轮这么排：

**第一轮：P0-3（阈值奖励）+ P1-3（牌强化层级泛化）**
理由：P0-3 是从零做且只依赖 H1 一个新 hook，改动面最小、正交性最清楚
（多一个"要不要现在冲线"的决定）；P1-3 的**结构已经在了**，
它是纯数据表泛化，不动管道，用来把"数据驱动 + 8~10 条能跑的配置样例"
这套交付格式先跑通一遍。

**第一轮不做 P0-1**，因为 70% 已存在，剩余增量（三档 failPenalty + 数据表化）
是改造而非新建，改造已上线的抬注要先有 `dumpChain()` 才测得准。
**也不把 P0-2 单独排第一轮**，因为没有邻接规则时换座不影响结果，做了等于没做。

---

## 六、留给下一轮的三个待定问题

1. **加注的粒度**：现在是"每场开打前定档、本场不变"。需求文档写"出牌前选档级"，
   如果真要**每手牌**都能选档，那 `raised` 就从每场一次的战略决策变成每手一次的
   战术决策，难度曲线和 `targetFor` 都要重写。这是产品决定，不是实现细节，需要拍板。
2. **P1-1 的套装收益走 `Mods` 还是走 H1**：需求文档禁了"直接乘算倍率"，
   提出"额外槽位/免费刷新/缓冲回合"。前两个 `Mods` 里已有字段（`slots`/`freeRerolls`），
   **"缓冲回合"现在没有对应概念**——最接近的是 `hands`（每场出牌次数），
   但那是每场重置的，不是跨场累积的。要不要新造一个"缓冲"资源？
3. **`onHeld`/`onDiscard`/`onRoundEnd` 只认银钱这件事**（本文 1.2）：
   是当成已知限制、用 selftest 钉住"这几个 hook 只准 economy"，
   还是借新功能把它们拉进管道？后者会动到 `settle()` 的事件语义，
   意味着结清幕要能演出倍注变化。我倾向前者。
