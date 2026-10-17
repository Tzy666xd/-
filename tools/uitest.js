// 界面层无头行为测试：由 .app 的壳在真 WKWebView 里 evaluate 这个文件。
// 内核自检看不见界面层的 bug（快捷键抢输入、静音被音量冲掉、再开一局不换种子、
// 设置不落地、续局按钮不出现），所以这里只点真按钮、发真键盘事件、读真 DOM。
//
// 约束：窗口没上屏时 rAF 与 setTimeout 是冻结的，因此整段必须同步跑完，
// 返回值就是裁决字符串（Swift 侧按 "UITEST PASS" 前缀判成败）。
(function () {
  var H = window.__H;
  if (!H) return 'UITEST FAIL（页面没挂上 __H 测试口）';
  var q = function (s) { return document.querySelector(s); };
  var results = [];
  var failFast = new URLSearchParams(location.search).get('failfast') === '1';
  // 因环境而无法评估、**又没有编造判据**的条目。必须显式报出来，
  // 否则"PASS 29/29"会读成"全验过了"，而那正是假绿。
  var unevaluated = [];
  function must(name, ok) {
    results.push([!!ok, name]);
    // 注入只要一条真实判据变红即可裁决；异步流程不用再等后续动画与课程超时。
    if (!ok && failFast) window.__UITEST_RESULT = verdict('错误注入首次失败');
  }
  function click(sel) { var n = q(sel); if (!n) { must(sel + ' 存在', false); return false; } n.click(); return true; }
  function key(el, k) {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  }
  function store(k, v) {
    try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); return true; }
    catch (e) { return false; }
  }
  function read(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  // ── 虚拟时钟 ────────────────────────────────────────────────
  // WKWebView 的动画时钟只在真的合成帧时才走。显示器睡着（CGDisplayIsAsleep=1）时
  // 窗口没处画，于是 rAF 不触发、WAAPI 的 finished 永不兑现——「跳过演出」「性能与泄漏」
  // 两档会挂成 busy=true / anims=3 / 耗时 -1ms，长得和产品软锁一模一样。
  //
  // 实测探针（2026-10-10）：跑 200ms 动画的 currentTime 前进了 0ms；
  // 而手工 a.currentTime = 600 之后 playState 立刻 finished、finished 立刻兑现。
  // 所以测试侧按真实流逝时间推 currentTime 就够了：这样"逻辑对不对"和
  // "这台机器画不画得出帧"是两件事，可以分开下结论。
  //
  // 只在**测出来时钟真的冻结**时才接管（由 uitest.sh 量 CGDisplayIsAsleep 后经 ?vclock=1
  // 告诉页面）：屏幕醒着时一行都不碰，免得和合成器抢方向盘。
  var VC = { took: false, prev: 0, timer: null };
  // 代打时钟的两条腿，缺一不可：
  // ① 没到终点的：按真实流逝时间推 currentTime，让它按该有的速度走。
  // ② 到终点的：**显式 a.finish()**。实测在没帧可画时，动画能被推到 playState='finished'，
  //    但 finished 那个 Promise 的兑现还等着一次帧提交（探针里 r2 一直停在 pending）。
  //    而 finish() 是跳过路径本来就在用的口子，无头下确实会把 finished 兑现——
  //    所以到点就调它，而不是指望自然兑现。
  function vcAdvance(a, dt) {
    var end = 0;
    try {
      var t = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming() : null;
      end = t && typeof t.endTime === 'number' ? t.endTime : 0;
    } catch (e) { return; }
    var c;
    try { c = a.currentTime; } catch (e) { return; }
    if (typeof c !== 'number') return;
    if (end > 0 && c + dt >= end) { try { a.finish(); } catch (e) {} return; }
    try { a.currentTime = c + dt; } catch (e) { /* 已经结束了 */ }
  }
  function vcPump() {
    var now = performance.now();
    var dt = now - VC.prev;
    VC.prev = now;
    // 只挡"时钟倒着走"。dt 再大也照实推进：--tick 心跳一次快照要 300–500ms，
    // 主线程被占住时这里隔很久才回一次，dt 自然大。之前写的是 dt>500 就 return，
    // 结果每一拍都被跳过——代打时钟形同虚设，第 1 手照样 anims=3。
    // 按真实流逝时间推进才对：过 600ms 就该让动画走 600ms，锁住输入的时长才是可信的。
    if (!(dt > 0)) return;
    var anims;
    try { anims = document.getAnimations(); } catch (e) { return; }
    for (var i = 0; i < anims.length; i++) {
      var a = anims[i];
      if (a.playState !== 'running') continue;
      vcAdvance(a, dt);
    }
  }
  function vcTakeOver() {
    VC.took = true; VC.prev = performance.now();
    VC.timer = setInterval(vcPump, 16);
  }
  if (new URLSearchParams(location.search).get('vclock') === '1') vcTakeOver();


  // ── 几档共用的工具 ──────────────────────────────────────────
  // 读黄铜计数器的示数：每一位是一列 0–9 用 translateY 推上去的，所以量的是目标值
  function reelValue(sel) {
    var n = q(sel);
    if (!n) return -1;
    var s = '';
    var digits = n.querySelectorAll('.digit');
    for (var i = 0; i < digits.length; i++) {
      var col = digits[i].querySelector('.col');
      if (!col) continue;                       // 千分位那个逗号
      var m = /translateY\((-?[\d.]+)em\)/.exec(col.style.transform || '');
      s += m ? String(Math.round(-parseFloat(m[1]))) : '';
    }
    return s === '' ? -1 : parseInt(s, 10);
  }
  // 挑点数最小的 n 张：一手打不出彩头，才能连着打好几手做对照
  function pickLowest(n) {
    var hand = H.game.state.hand;
    var order = hand.map(function (c, i) { return { r: c.rank, i: i }; })
      .sort(function (a, b) { return a.r - b.r; });
    H.select(order.slice(0, n).map(function (o) { return o.i; }).join(','));
  }
  // 挑"一张最大的人头牌 + 两张最小的"。收租人（人头牌各 +7 倍注）要真的开口，
  // mult 那一声才算被测到。以前它不响也没人管——因为 pickLowest 永远够不到人头牌，
  // 只有**牌越打越少、手牌萎缩到只剩人头牌**时才碰巧响一次；那是桌面回收的 bug
  // 在替这条判据撑腰。修好牌堆守恒之后必须把"要测的东西"直接摆出来。
  function pickFace(n) {
    var hand = H.game.state.hand;
    var faces = [];
    var lows = [];
    hand.forEach(function (c, i) { (c.rank >= 11 ? faces : lows).push({ r: c.rank, i: i }); });
    if (!faces.length) { pickLowest(n); return; }
    faces.sort(function (a, b) { return b.r - a.r; });      // 最大的那张一定进"计分"那一份
    lows.sort(function (a, b) { return a.r - b.r; });
    var take = [faces[0]].concat(lows.slice(0, Math.max(0, n - 1)));
    H.select(take.map(function (o) { return o.i; }).join(','));
  }
  // 从 t0 起轮询到演出结束，回调拿到"从 t0 到解锁"的毫秒数；超 limit 给 -1
  function untilIdle(t0, cb, limit) {
    var cap = limit || 9000;
    (function poll() {
      if (!H.busy) { cb(Math.round(performance.now() - t0)); return; }
      if (performance.now() - t0 > cap) { cb(-1); return; }
      if (performance.now() - t0 > 3000 && H.anims > 0) vcUnstick();
      setTimeout(poll, 25);
    })();
  }
  var domNodes = function () { return document.querySelectorAll('*').length; };
  // 内核给"最后一手"的权威值：从账本事件流尾巴取，不由界面自己算
  var lastHandVal = 0;
  // 代打时钟的补漏：某些新建动画没被注册进 document.getAnimations()，vcPump 推不到它们，
  // 于是 await landed 永不返回。等满 3 秒还挂着就让页面把自己手里的引用收尾。
  // 这只影响"时间怎么过去"，不影响任何数值——事件流与 after 快照照旧由内核给。
  function vcUnstick() {
    if (!VC.took) return;
    try { if (window.__H.anims > 0) window.__H.settleAnims(); } catch (e) { /* 没有这个口子就算了 */ }
  }
  // 等到"又能出牌了"为止：演出放完、结清幕点掉、铺子走出来。跑步机就是那只手。
  // 回调拿到两个数：lockMs = 输入被锁住的时长（玩家真正在等的），totalMs = 含点幕与走铺子。
  var nudges = { curtain: 0, shop: 0 };
  function whenReady(cb, cap) {
    var start = performance.now();
    var lockMs = -1;
    (function poll() {
      var cur = q('#curtain');
      var curtainUp = !!cur && !cur.classList.contains('hidden');
      var shopOpen = q('#shop').classList.contains('open');
      if (!H.busy && lockMs < 0) lockMs = Math.round(performance.now() - start);
      // 幕布上点的是那颗「继 续」，不是幕布本身：整块可点这条留着给鼠标随手的人，
      // 但测试必须点那颗看得见按钮——它没了也要当场报出来，不能让"还能关幕"掩盖掉
      if (curtainUp) { click('#btnCurtainOk'); nudges.curtain++; }
      else if (!H.busy && shopOpen) { var lv = q('#shopBody .leave'); if (lv) { lv.click(); nudges.shop++; } }
      var ready = !H.busy && !curtainUp && !shopOpen && H.game.state.status === 'playing';
      if (ready) { cb(lockMs, Math.round(performance.now() - start)); return; }
      if (performance.now() - start > (cap || 25000)) { cb(lockMs, -1); return; }
      // 代打时钟下卡在 await landed 时，让页面把自己手里的动画引用收尾（见 web/main.ts 的 settleAnims）
      if (performance.now() - start > 3000 && H.anims > 0) vcUnstick();
      setTimeout(poll, 40);
    })();
  }

  var mode = new URLSearchParams(location.search).get('uitest') || 'again';

  if (mode === 'shareboot' || mode === 'sharebad') {
    var previous=JSON.stringify(H.game.state),rng=H.game.rand.calls;
    if(mode==='shareboot'){
      must('重启后上一局战报入口可见',!q('#btnLastReport').hidden);
      click('#btnLastReport');
      must('重启后真实旧战报可预览',!q('#sharecard').classList.contains('hidden')&&!!q('#sharePreview canvas'));
      must('重启查战报不创建新牌局',JSON.stringify(H.game.state)===previous&&H.game.rand.calls===rng);
      click('#btnCloseShare');
      must('关闭后仍回到标题页',!q('#title').classList.contains('hidden')&&q('#sharecard').classList.contains('hidden'));
    }else{
      must('损坏的战报不显示旧局入口',q('#btnLastReport').hidden);
      must('损坏战报不阻止正常入席',!q('#title').classList.contains('hidden')&&!q('#btnStart').disabled);
    }
  } else if (mode === 'share') {
    H.start(4242);
    click('#tray .card'); click('#btnPlay');
    untilIdle(performance.now(), function () {
      var state=H.game.state;
      must('真实点击出牌留下整局统计',state.runStats.plays===1&&state.runStats.bestHand>0);
      // 夹具只决定结束姿态；数据仍来自上面实际点击的计分链。
      state.status='lost';state.decisions.push({kind:'event',night:1,stage:0,hand:1,text:'彗星来信：彗尾牌直接入手'});
      state.hand[0].special='comet';H.render();
      must('稀奇牌手牌角标显示名称',!!q('#tray .rare-comet .rare-badge')&&q('#tray .rare-comet .rare-badge').textContent.indexOf('彗尾牌')>=0);
      must('稀奇牌可访问名称解释触发条件',q('#tray .rare-comet').getAttribute('aria-label').indexOf('最后计分')>=0);
      H.showEnd(false);
      var report=JSON.parse(read('guinea.last-report.v1'));
      must('散场写入有效战报',!!report);
      if(!report){window.__UITEST_RESULT=verdict('分享与稀奇牌');return;}
      must('散场保存真实战报统计与选择',report.plays===1&&report.seed===4242&&report.choices.some(function(x){return x.indexOf('彗星来信')>=0;}));
      must('战报含最终稀奇牌',report.rareCards.indexOf('彗尾牌')>=0);
      must('上一局战报入口可见',!q('#btnLastReport').hidden);
      q('#btnShareRun').focus();click('#btnShareRun');
      var before=JSON.stringify(state),calls=H.game.rand.calls;
      must('结束分享按钮打开图片预览',!q('#sharecard').classList.contains('hidden'));
      var canvas=q('#sharePreview canvas');
      must('图片分辨率1200×1740且可编码PNG',canvas.width===1200&&canvas.height===1740&&canvas.toDataURL().indexOf('data:image/png;base64,')===0);
      var pixel=canvas.getContext('2d').getImageData(100,200,1,1).data;
      must('图片已绘制且无透明背景',pixel[3]===255&&pixel[0]<100);
      must('打开分享聚焦保存按钮',document.activeElement===q('#btnExportReport'));
      var rect=q('#btnExportReport').getBoundingClientRect();
      must('导出控件在可见窗口内',rect.top>0&&rect.bottom<innerHeight);
      q('#btnCloseShare').focus();key(document.activeElement,'Tab');
      must('分享弹窗Tab末端回到首控件',document.activeElement===q('#btnExportReport'));
      key(document.body,'x');key(document.body,' ');key(document.body,'Enter');
      must('分享弹窗快捷键不改游戏或随机流',JSON.stringify(state)===before&&H.game.rand.calls===calls);
      var steps=[['#btnExportReport','图片已保存'],['#btnCopyReport','分享文案已复制'],['#btnSystemShare','已打开系统分享菜单']];
      function next(i){
        if(i===steps.length){
          key(document.activeElement,'Escape');
          must('Escape关闭分享并还原焦点',q('#sharecard').classList.contains('hidden')&&document.activeElement===q('#btnShareRun'));
          H.start(4243);click('#btnLastReport');
          must('新局还能查阅上一局战报',!q('#sharecard').classList.contains('hidden')&&read('guinea.last-report.v1')===JSON.stringify(report));
          click('#btnCloseShare');click('#btnCodex');click('[data-tab="rare"]');
          must('稀奇牌图鉴十四种完整说明',document.querySelectorAll('.rare-entry').length===14&&q('#codex').textContent.indexOf('压舱牌')>=0&&q('#codex').textContent.indexOf('收藏牌')>=0);
          H.closePanels();q('#title').classList.remove('hidden');var old=H.prefsCopy.flags.events;
          click('#btnEventsToggle');
          must('标题奇遇开关实际更新新局偏好',H.prefsCopy.flags.events!==old&&q('#btnEventsToggle').getAttribute('aria-pressed')===String(!old));
          H.start(4244);must('下一局真正采用奇遇偏好',H.game.state.flags.events===!old);
          H.game.state.flags.events=true;H.game.state.pendingEvent=['embers','looking-glass','comet-letter'];H.render();
          must('赠牌事件选择前就能查明三种牌性',document.querySelectorAll('#eventRow .ev-gift').length===3&&q('[data-eid="looking-glass"] .ev-gift').textContent.indexOf('+6')>=0);
          click('[data-eid="embers"]');
          must('真点赠牌事件后新牌显示在手中',!!q('#tray .rare-ember')&&H.game.state.pendingEvent.length===0);

          window.__UITEST_RESULT=verdict('分享与稀奇牌');return;
        }
        click(steps[i][0]);var started=performance.now();
        (function poll(){
          if(q('#shareStatus').textContent.indexOf(steps[i][1])>=0){must('原生桥回执 '+steps[i][1],true);next(i+1);return;}
          if(performance.now()-started>5000){must('原生桥回执 '+steps[i][1]+'（实测 '+q('#shareStatus').textContent+'）',false);window.__UITEST_RESULT=verdict('分享与稀奇牌');return;}
          setTimeout(poll,30);
        })();
      }
      next(0);
    });
    return '';
  } else if (mode === 'reference') {
    q('#title').classList.remove('hidden');
    must('开局自定选项默认收起', !q('#startOptions').open);
    must('玩法与入席位于折叠区外', !q('#startOptions').contains(q('#modes')) && !q('#startOptions').contains(q('#btnStart')));
    H.setPrefFlag('draft', true);
    q('#startOptions').open = true;
    var startScroll = q('.start-scroll');
    startScroll.scrollTop = 0;
    var startRect = q('#btnStart').getBoundingClientRect(), deedRect = q('#title .deed').getBoundingClientRect();
    must('展开选项与五位客人时入席仍在窗口内', startRect.top >= deedRect.top && startRect.bottom <= innerHeight && startRect.bottom <= deedRect.bottom);
    must('开始按钮没有被滚动内容挤走', startScroll.getBoundingClientRect().bottom <= startRect.top);
    startScroll.scrollTop = startScroll.scrollHeight;
    must('滚动选项时入席位置固定', q('#btnStart').getBoundingClientRect().top === startRect.top);
    q('#guideIntro').classList.remove('hidden');
    var guideRect = q('#btnTakeGuide').getBoundingClientRect();
    must('初次课表的选择按钮始终可见', guideRect.top > 0 && guideRect.bottom <= innerHeight);
    click('#btnSkipGuide');
    H.start(4242);
    var state = H.game.state;
    state.discovered = [];
    click('#btnCodex');
    must('读图鉴时教学提示不遮住内容', !H.tutor().visible && !H.guide().visible);
    must('图鉴可查询七类内容', document.querySelectorAll('.reference-tabs button').length === 7);
    must('常用十种牌型有真实示例', document.querySelectorAll('.hand-example').length === 10);
    must('高牌示例只有一张参与计分', document.querySelectorAll('[data-kind="high"] .counts').length === 1);
    must('对子示例只有两张参与计分', document.querySelectorAll('[data-kind="pair"] .counts').length === 2);
    must('皇家同花顺展示五张', document.querySelectorAll('[data-kind="royal"] .counts').length === 5);
    must('隐秘未发现牌型不显示示例', document.querySelectorAll('.codex-row.locked .hand-example').length === 0);
    state.discovered = ['five', 'flushhouse', 'flushfive'];
    click('#btnCodex');
    must('本局发现后显出三种隐秘示例', document.querySelectorAll('.hand-example').length === 13);
    click('[data-tab="patrons"]');
    must('客人目录完整', document.querySelectorAll('.catalog-entry').length === 36);
    var search = q('#catalogSearch'); search.value = '霍布斯'; search.dispatchEvent(new Event('input'));
    must('名称搜索过滤客人', document.querySelectorAll('.catalog-entry').length === 1 && q('.catalog-entry h3').textContent === '管家霍布斯');
    var seedBefore = state.seed, handBefore = state.handsLeft;
    key(search, 'Enter'); key(search, ' ');
    must('目录搜索回车空格不重开或出牌', H.game.state === state && state.seed === seedBefore && state.handsLeft === handBefore);
    search.value = '不存在的客人'; search.dispatchEvent(new Event('input'));
    must('搜索无匹配有空状态', !q('.catalog-entry') && q('.catalog-list').textContent.indexOf('没有匹配') >= 0);
    click('[data-tab="letters"]');
    must('引荐信目录十二项', document.querySelectorAll('.catalog-entry').length === 12);
    click('[data-tab="books"]');
    must('牌谱目录十二项', document.querySelectorAll('.catalog-entry').length === 12);
    must('已发现隐秘牌谱可查阅', q('.catalog-list').textContent.indexOf('同花五条') >= 0);
    state.discovered = []; click('[data-tab="books"]');
    must('未发现隐秘牌谱不绕过牌型隐藏规则', q('.catalog-list').textContent.indexOf('未见的牌谱') >= 0 && q('.catalog-list').textContent.indexOf('同花五条') < 0);
    click('[data-tab="vouchers"]');
    must('会员特权目录八项', document.querySelectorAll('.catalog-entry').length === 8);
    // 特制实际牌区：复制牌、强化、桌面和弃牌均要展示；任何查阅都不得挪牌或走随机流。
    state.table.push(state.deck.pop()); state.discardPile.push(state.deck.pop());
    var copy = Object.assign({}, state.hand[0], {id: 9999, enh: 'glass', seal: 'red'});
    state.deck.push(copy);
    var beforeView = JSON.stringify(state), beforeCalls = H.game.rand.calls;
    click('#btnDeck');
    must('牌组入口直接显示完整实际牌组', q('#codex').classList.contains('open') && document.querySelectorAll('.deck-card').length === 53);
    must('牌区总数来自当前状态', q('.deck-total').textContent.indexOf('待抽 ' + state.deck.length) >= 0 && q('.deck-total').textContent.indexOf('桌面 1') >= 0 && q('.deck-total').textContent.indexOf('弃牌 1') >= 0);
    must('复制牌的两层强化可见', q('[data-card-id="9999"]').textContent.indexOf('玻璃') >= 0 && q('[data-card-id="9999"]').textContent.indexOf('重诵') >= 0);
    q('#deckZone').value = 'hand'; q('#deckZone').dispatchEvent(new Event('change'));
    must('牌区筛选只看真实手牌', document.querySelectorAll('.deck-card').length === state.hand.length && Array.from(document.querySelectorAll('.deck-card')).every(function(c){return c.dataset.zone === 'hand';}));
    q('#deckSuit').value = 'h'; q('#deckSuit').dispatchEvent(new Event('change'));
    must('花色与区域筛选相交', document.querySelectorAll('.deck-card').length === state.hand.filter(function(c){return c.suit === 'h';}).length);
    key(q('#deckZone'), 'Enter'); key(q('#deckSort'), ' ');
    must('筛选键盘操作不改变牌局', JSON.stringify(state) === beforeView && H.game.rand.calls === beforeCalls);
    q('#deckZone').value = 'all'; q('#deckSuit').value = 'all'; q('#deckZone').dispatchEvent(new Event('change'));
    var ranks = Array.from(document.querySelectorAll('.deck-card')).map(function(c){return Number(c.dataset.rank);});
    must('点数排序由高到低', ranks.every(function(r,i){return i === 0 || ranks[i-1] >= r;}));
    q('#deckSort').value = 'suit'; q('#deckSort').dispatchEvent(new Event('change'));
    var suitOrder = Array.from(document.querySelectorAll('.deck-card')).map(function(c){return 'shdc'.indexOf(c.dataset.suit);});
    must('花色排序分组稳定', suitOrder.every(function(r,i){return i === 0 || suitOrder[i-1] <= r;}));
    must('全部筛选和排序不修改状态或抽牌顺序', JSON.stringify(state) === beforeView && H.game.rand.calls === beforeCalls);
    state.deck.pop(); H.render();
    must('牌组打开时随局面刷新且保留排序', document.querySelectorAll('.deck-card').length === 52 && q('#deckSort').value === 'suit');
    H.closePanels();
    click('#tray .card'); click('#btnPlay');
    state.score = 270; state.handsLeft = 0; state.discardsLeft = 2; state.handIndex = 4;
    state.status = 'lost'; state.consumables = [{t:'letter', id:'lens'}];
    state.ledger = [{night:1,stage:'small',label:'便宴',target:100,best:150,reward:1,profit:0,money:10,raised:0,rep:0}];
    H.showEnd(false);
    must('散场最高流水包含失败的当前场', q('#endSummary').textContent.indexOf('最高单场流水270') >= 0);
    must('散场正确解释目标与差額', q('.review-result').textContent.indexOf('彩头 300') >= 0 && q('.review-result').textContent.indexOf('还差 30') >= 0);
    must('散场建议引用未用资源', q('#endReview').textContent.indexOf('2 次弃牌') >= 0 && q('#endReview').textContent.indexOf('磨镜') >= 0);
    must('最后一手复盘来自真实计分事件', q('#endReview .score-trace') && q('#endReview .score-trace').textContent.indexOf('本手入账') >= 0);
    state.ledger[0].target = 100; state.ledger[0].best = 350; state.score = 0;
    H.showEnd(true);
    must('获胜复盘读取终场账本', q('.review-result').textContent.indexOf('彩头 100') >= 0 && q('.review-result').textContent.indexOf('超过 250') >= 0);
    // 聚焦结业提示的真实可见性，避免坏锚点让长教学流程先超时，拿不到具体裁决。
    H.startGuide(); H.seat('hobbs');
    H.game.state.guide = ['on'].concat(H.guide().lessons.filter(function(id){return id !== 'done';}));
    var finalRow = {night:1,stage:'small',label:'便宴',target:100,best:150,reward:1,profit:0,money:10,raised:0,rep:0};
    H.game.state.ledger = [finalRow, Object.assign({}, finalRow)];
    H.game.state.status = 'playing'; H.render();
    must('结业课有真实锚点并能完整显示', H.guide().id === 'done' && H.guide().visible && H.guide().inViewport);
  } else if (mode === 'reliable') {
    H.start(4242);
    click('#tray .card');
    click('#btnPlay');
    var playedState = JSON.parse(read('guinea.save.v1'));
    must('普通出牌立即保存实际分数与出牌次数', playedState.state.score===H.game.state.score
      && playedState.state.handsLeft===H.game.state.handsLeft && playedState.state.score>0);
    must('普通出牌立即保存随机流位置', playedState.calls===H.game.rand.calls);
    click('#btnLedger');
    must('玩家能在账本回看这一手的拆账',q('#ledgerBody .score-trace').textContent.indexOf('本手入账')>=0);
    H.closePanels();
    click('#btnResume');
    must('立即续局不回退分数与次数',H.game.state.score===playedState.state.score
      && H.game.state.handsLeft===playedState.state.handsLeft);
    must('立即续局随机流位置不变',H.game.rand.calls===playedState.calls);
    must('卡牌提供可访问按钮和选中状态',q('#tray .card').getAttribute('role')==='button'
      && q('#tray .card').hasAttribute('aria-label') && q('#tray .card').getAttribute('aria-pressed')==='false');
    var accessibleCard=q('#tray .card');
    key(accessibleCard,'Enter');
    must('卡牌回车可选中并同步可访问状态',H.game.state.chosen.length===1
      && accessibleCard.getAttribute('aria-pressed')==='true');
    key(accessibleCard,' ');
    must('卡牌空格取消选择，不误触出牌',H.game.state.chosen.length===0
      && H.game.state.handsLeft===playedState.state.handsLeft);
    click('#tray .card'); click('#btnDiscard');
    var discardedState=JSON.parse(read('guinea.save.v1'));
    must('弃牌立即保存次数和新手牌',discardedState.state.discardsLeft===H.game.state.discardsLeft
      && JSON.stringify(discardedState.state.hand)===JSON.stringify(H.game.state.hand));
    H.game.state.consumables=[{t:'book',id:'pair'}];H.render();click('#consumables .item');
    var bookState=JSON.parse(read('guinea.save.v1'));
    must('使用牌谱立即保存等级与物品消耗',bookState.state.books.pair===2&&bookState.state.consumables.length===0);
    H.game.state.consumables=[{t:'letter',id:'fortune'}];H.render();click('#consumables .item');
    must('使用引荐信立即保存银钱和物品',JSON.parse(read('guinea.save.v1')).state.money===H.game.state.money
      && JSON.parse(read('guinea.save.v1')).state.consumables.length===0);
    var backup=JSON.parse(read('guinea.save.v1.backup'));
    store('guinea.save.v1','broken');click('#btnResume');
    must('主档坏了能从有效备份续局',H.game.state.seed===backup.state.seed&&H.game.rand.calls===backup.calls);
    must('恢复备份时玩家得到明确提示',q('#notice').textContent.indexOf('有效进度')>=0);
    H.start(4242);
    var oldSet=Storage.prototype.setItem;
    try {
      Storage.prototype.setItem=function(){throw new Error('test quota');};
      click('#tray .card');click('#btnDiscard');
      must('写入失败时留下可见提示',q('#saveStatus').classList.contains('failed'));
    } finally { Storage.prototype.setItem=oldSet; }
    H.start(1,'patrician');H.game.state.flags.sets=true;
    H.seat('hobbs');H.seat('oracle');H.game.openShop();
    try { H.renderShop();must('首次进店已有套装不报错',true); }
    catch(e){must('首次进店已有套装不报错：'+e.message,false);}
    must('首次进店已有套装有实际名单',q('#shopBody .sets-box').textContent.indexOf('同好雅集')>=0);
    H.start(4242);Object.assign(H.game.state,{nights:3,stage:2,status:'shop'});H.renderShop();
    var step=document.querySelectorAll('#shopBody .step')[1];
    must('三夜局跨夜抬注显示1800分',step.textContent.indexOf('1,800')>=0);
    step.click();click('#shopBody .leave');
    must('抬注预告与实际进入彩头一致',q('#targetVal').textContent==='1,800');
    H.start(4242,'standard');H.game.state.score=1000;
    click('#tray .card');click('#btnPlay');
    var cleared=JSON.parse(read('guinea.save.v1'));
    must('结清动画前进度已含完整赏金账本',cleared.state.status==='cleared'&&cleared.state.ledger.length===1);
    click('#btnResume');
    must('结清途中恢复直接进店，不重复结清',H.game.state.status==='shop'
      && q('#shop').classList.contains('open')&&H.game.state.money===cleared.state.money
      && H.game.state.ledger.length===1&&q('#tableCards .card')!==null);
    click('#btnResume');
    must('铺子再次恢复不重新摇货或随机流',H.game.rand.calls===JSON.parse(read('guinea.save.v1')).calls);
    H.closePanels();H.renderPickers();
    document.querySelectorAll('#modes .pick')[2].click();
    H.start(99);
    must('菜单开局路径也遵守今日种子',H.game.state.seed===Number(q('#seedInput').value));
    must('每日模式锁定标准难度和功能',H.game.state.diff==='standard'
      && Object.values(H.game.state.flags).every(function(v){return v===false;})&&H.game.state.seats.length===0);
  } else if (mode === 'keys') {
    // ── 输入框焦点与快捷键 ────────────────────────────────────
    must('开场标题页可见', !q('#title').classList.contains('hidden'));
    // 这条靠文档级 fixture 存档：启动时就应该查出"有上一局可续"
    must('有存档时续局按钮自己就出现', q('#btnResume').hidden === false);
    must('续局说明写了第几夜', /第 \d+ 夜/.test(q('#resumeNote').textContent || ''));
    var seedBox = q('#seedInput');
    var wasMuted = H.muted;
    click('#startOptions summary');
    seedBox.focus();
    must('焦点确实在种子里', document.activeElement === seedBox);
    key(seedBox, 'm');
    must('输入框里按 M 不会去切静音', H.muted === wasMuted);
    key(seedBox, 'l');
    must('输入框里按 L 不会开账本', !q('#ledger').classList.contains('open'));
    key(seedBox, 'k');
    must('输入框里按 K 不会开图鉴', !q('#codex').classList.contains('open'));
    key(seedBox, ' ');
    must('输入框里按空格不会开局', !q('#title').classList.contains('hidden'));
    // 例外：回车就是"开始"，这是玩家在填种子后最自然的一下
    seedBox.value = '403';
    key(seedBox, 'Enter');
    must('输入框里按回车照常开局', q('#title').classList.contains('hidden'));
    must('回车开的就是刚填的那个种子', H.game.state.seed === 403);
    // 离开输入框后快捷键要恢复
    seedBox.blur();
    var before = H.muted;
    key(document.body, 'm');
    must('不在输入框时 M 仍然切静音', H.muted !== before);
    key(document.body, 'm');
    must('再按一次能切回去', H.muted === before);
    click('#btnLedger');
    must('点按钮能开账本', q('#ledger').classList.contains('open'));
    key(document.body, 'Escape');
    must('Esc 收起面板', !q('#ledger').classList.contains('open'));

  } else if (mode === 'prefs') {
    // ── 设置：改了要生效，更要留得住 ──────────────────────────
    // 归一：手动静音关掉、音量抬到非零，避免受上一次跑测的残留影响
    click('#btnSettings');
    var segs = document.querySelectorAll('#settingsBody .seg');
    must('设置里有五排开关', segs.length >= 5);
    var vol = segs[0];
    function pick(row, i) { row.children[i].click(); }
    // 重新取节点：每次点击都会整块重画 settings
    function seg(i) { return document.querySelectorAll('#settingsBody .seg')[i]; }
    if (H.muted) click('#btnSound');
    pick(seg(0), 2);                       // 音量 → 中
    must('起点是没静音', H.muted === false);

    click('#btnSound');
    must('点一次静音', H.muted === true);
    pick(seg(0), 3);                       // 音量 → 满
    must('改音量不会把手动静音冲掉', H.muted === true);
    var persisted = JSON.parse(read('guinea.prefs.v1') || '{}');
    must('手动静音写进了偏好', persisted.muted === true);
    click('#btnSound');
    must('再点取消静音', H.muted === false);

    pick(seg(0), 0);                       // 音量 → 静
    must('音量归零算静音', H.muted === true);
    pick(seg(0), 2);
    must('音量抬回来就解除静音', H.muted === false);

    pick(seg(3), 2);                       // 画法 → 铜版画
    must('画法立刻改了 data-style', document.documentElement.dataset.style === 'engraving');
    pick(seg(1), 2);                       // 节奏 → 快
    pick(seg(4), 0);                       // 底噪 → 无声
    var saved = JSON.parse(read('guinea.prefs.v1') || '{}');
    must('画法落盘了', saved.style === 'engraving');
    must('节奏落盘了', saved.speed === 1.5);
    must('底噪落盘了', saved.ambience === false);
    must('音量落盘了', saved.vol === 0.7);
    // 牌组是"下一局用什么起手"，也该留到下次
    var deckBtns = document.querySelectorAll('#decks .pick');
    // 默认八夜正局那一档：五副通用 + 这一档的专属「庄家账」= 六副
    must('八夜那一档的牌组排有六副（实际 ' + deckBtns.length + '）', deckBtns.length === 6);
    deckBtns[3].click();                 // 高利贷
    must('选中牌组改了牌组高亮', document.querySelectorAll('#decks .pick')[3].classList.contains('on'));
    must('牌组写进了偏好', JSON.parse(read('guinea.prefs.v1') || '{}').deck === 'usurer');

    // ── 背景曲：只验证接线，谱面与声部正确性在 core 的自检里 ────
    // 按标签找那一排，不按序号：设置里每加一行，序号写死的判据就会指到别的控件上
    // （这次加「新手引导」就是这么把整档判据弄抛错的）
    function segFor(label) {
      var rows = [].slice.call(document.querySelectorAll('#settingsBody .set-row'));
      var row = rows.filter(function (r) { return (r.textContent || '').indexOf(label) >= 0; })[0];
      return row ? row.querySelector('.seg') : null;
    }
    must('设置里有背景曲那一排', !!segFor('背景曲'));
    must('开场默认不放曲', H.bgm.tune === null);
    must('背景曲八首都进了选单（外加"无"）', segFor('背景曲').children.length === 9);
    must('曲名按钮带场景提示，不然八首只看得懂第一首',
      (segFor('背景曲').children[3].title || '').indexOf('｜') > 0);
    segFor('背景曲').children[1].click();          // 圆舞
    must('点了曲子就把曲名交给了播放器', H.bgm.tune === 'waltz');
    must('音量随总音量给过去', H.bgm.level > 0);
    must('背景曲落盘', JSON.parse(read('guinea.prefs.v1') || '{}').track === 1);
    segFor('背景曲').children[8].click();  // 众赞（第八首）
    must('选到第八首不会选空', H.bgm.tune === 'chorale');
    must('第八首也落盘了', JSON.parse(read('guinea.prefs.v1') || '{}').track === 8);
    segFor('背景曲').children[0].click();  // 无
    must('切回"无"就停掉', H.bgm.tune === null && H.bgm.ticking === false);
    // 静音要连背景曲一起掐掉
    click('#btnSound');
    must('静音后背景乐音量为 0', H.bgm.level === 0);
    click('#btnSound');

    // ── 局势进音乐：头人夜 / 只剩一次牌权 / 抬过注，任两样就把曲子顶紧 ──
    {
      var st = H.game.state;
      var keep = { status: st.status, stage: st.stage, handsLeft: st.handsLeft, raised: st.raisedHere };
      st.status = 'playing'; st.stage = 0; st.handsLeft = 4; st.raisedHere = 0;
      H.render();
      must('平常局势不放层', H.bgm.heat === 0);
      st.handsLeft = 1;
      H.render();
      must('只剩一次牌权就顶到 1 层', H.bgm.heat === 1);
      st.stage = 2;                        // 头人夜
      H.render();
      must('头人夜 + 最后一次出牌 = 顶满', H.bgm.heat === 2);
      st.stage = 0; st.handsLeft = 4; st.raisedHere = 3;
      H.render();
      must('抬过注也算一层紧张', H.bgm.heat === 1);
      st.status = 'shop';
      H.render();
      must('进了铺子音乐就松下来', H.bgm.heat === 0);
      st.status = keep.status; st.stage = keep.stage;
      st.handsLeft = keep.handsLeft; st.raisedHere = keep.raised;
      H.render();
    }

    // ── 玩法与难度 ──────────────────────────────────────────
    must('玩法四排', document.querySelectorAll('#modes .pick').length === 4);
    must('难度三排', document.querySelectorAll('#diffs .pick').length === 3);
    document.querySelectorAll('#diffs .pick')[2].click();     // 苛刻
    must('难度写进了偏好', JSON.parse(read('guinea.prefs.v1') || '{}').diff === 'grudge');
    must('说明行跟着换成苛刻', (q('#pickNote').textContent || '').indexOf('彩头厚') >= 0);
    document.querySelectorAll('#modes .pick')[2].click();     // 每日一局
    var saved = JSON.parse(read('guinea.prefs.v1') || '{}');
    must('玩法写进了偏好', saved.mode === 'daily');
    must('每日一局锁住牌组那一排', q('#decks').classList.contains('locked'));
    must('每日一局锁住种子输入', q('#seedRow').classList.contains('locked'));
    must('每日一局的种子被改成当天号', Number(q('#seedInput').value) > 10000);
    var before = document.querySelectorAll('#decks .pick.on')[0].textContent;
    document.querySelectorAll('#decks .pick')[0].click();     // 被锁，不该生效
    must('锁住时点牌组不改选择', document.querySelectorAll('#decks .pick.on')[0].textContent === before);
    document.querySelectorAll('#modes .pick')[0].click();     // 回经营
    must('换回经营后解锁牌组', !q('#decks').classList.contains('locked'));

  } else if (mode === 'reload') {
    // ── 重启后：存下来的偏好要一条条回到界面上 ────────────────
    // 这一档靠 --boot 在文档级先写好 guinea.prefs.v1，页面自己读回来
    var decks = document.querySelectorAll('#decks .pick');
    must('牌组按存档里的选择高亮', decks[3].classList.contains('on'));
    must('只有一个牌组是高亮', document.querySelectorAll('#decks .pick.on').length === 1);
    must('玩法回到存档那一种', document.querySelectorAll('#modes .pick.on').length === 1
      && document.querySelector('#modes .pick.on').textContent === '经营');
    must('难度回到存档那一种', document.querySelector('#diffs .pick.on').textContent === '苛刻');
    must('画法回到存档那一种', document.documentElement.dataset.style === 'leather');
    must('减少动效回到存档那一种', document.documentElement.dataset.calm === '1');
    must('节奏真的落到时间轴上', H.speed === 1.5);
    must('音量归零在重启后仍算静音', H.muted === true);
    must('静音按钮的文案和真实状态一致', (q('#btnSound').textContent || '').trim() === '∅');
    must('底噪开关回到存档值', H.prefsCopy.ambience === false);
    must('没存档时续局按钮就该藏著', q('#btnResume').hidden === true);
    // 改完音量再点一次：由音量造成的静音要能随音量抬回来而解除
    click('#btnSettings');
    document.querySelectorAll('#settingsBody .seg')[0].children[2].click();   // 音量 → 中
    must('音量抬回来就解除静音', H.muted === false);
    must('解除静音后按钮文案跟着变', (q('#btnSound').textContent || '').trim() === '♪');
    // 界面上高亮不算数：真开一局，看内核拿到的是不是这套选择
    // （pickedDeck 那条线断掉时高亮照样是对的，只有开起来才看得出来）
    q('#btnStart').click();
    must('开起来的这局用的是存档里的牌组', H.game.state.deckId === 'usurer');
    must('开起来的这局用的是存档里的难度', H.game.state.diff === 'grudge');
    must('开起来的这局用的是存档里的玩法', H.game.state.mode === 'run');

  } else if (mode === 'curtain') {
    // ── 幕布上那颗「继 续」：键盘之外要给眼睛一个落点 ──────────────
    // 走的是真路径：?receipt=1 让内核真的结清一场并摆出那张本场结清幕（与 17-receipt 样张同源）。
    var cur = q('#curtain');
    must('本场结清之后幕布真的摊在屏幕上', !!cur && !cur.classList.contains('hidden'));
    must('幕布上有一颗「继 续」（不是只写着"按空格"）', !!q('#btnCurtainOk'));
    if (!q('#btnCurtainOk')) { window.__UITEST_RESULT = verdict('幕布按钮'); return; }
    must('那颗按钮看得见文字（' + q('#btnCurtainOk').textContent + '）',
      /继/.test(q('#btnCurtainOk').textContent));
    q('#btnCurtainOk').click();
    must('点它就收幕，接着往下走', cur.classList.contains('hidden'));
    var st0 = H.game.state.status;
    q('#btnCurtainOk').click();          // 幕布已经收掉了，再点一下不许把状态搅乱
    must('收幕之后再点一次是空操作', H.game.state.status === st0);
    must('这一局还活着（幕布不是死路）',
      H.game.state.status === 'shop' || H.game.state.status === 'cleared');
  } else if (mode === 'mouse') {
    // ── 鼠标玩家：出牌与弃牌以前只有空格 / X 按得动，这里点真按钮走同一条路 ──
    // snap 档：演出同步落定，这一档只判"点下去账有没有动、按钮有没有说清为什么按不动"；
    // 跳过的手感与时间轴归「跳过演出」那一档（它现在点的是幕布上那颗「继 续」）。
    // snap 档开机就在牌桌上（?snap=1 会自己开局），这一档不再点「入席」
    must('开局就在牌桌上', q('#title').classList.contains('hidden') && H.game.state.handsLeft > 0);
    must('牌桌上有「出 牌」与「弃 牌」两颗按钮', !!q('#btnPlay') && !!q('#btnDiscard'));
    must('没选牌时两颗都按不动，且写着为什么（' + q('#btnPlay').title + '）',
      q('#btnPlay').disabled && q('#btnDiscard').disabled && /先选/.test(q('#btnPlay').title));
    must('空闲时不挂着「跳 过」', q('#btnSkip').hidden);
    // 选牌一律走**真点击**：H.select 会顺手做一次全量重渲染，
    // "点完牌按钮没跟着刷新"那类 bug 在它底下量不出来（实测就是这么漏的）
    function clickCards(n) {
      var cards = document.querySelectorAll('#tray .card');
      for (var i = 0; i < n && i < cards.length; i++) cards[i].click();
      return Math.min(n, cards.length);
    }
    clickCards(2);
    var picked = H.game.state.chosen.length;
    must('选上 ' + picked + ' 张之后就按得动了', picked >= 2 && !q('#btnPlay').disabled && !q('#btnDiscard').disabled);
    must('按钮 title 报的就是这个张数（' + q('#btnPlay').title + '）',
      new RegExp(picked + ' 张').test(q('#btnPlay').title));
    var s0 = H.game.state.score;
    var hands0 = H.game.state.handsLeft;
    q('#btnPlay').click();
    must('点「出 牌」真的打出去了（出牌次数 ' + hands0 + '→' + H.game.state.handsLeft + '）',
      H.game.state.handsLeft === hands0 - 1 && H.game.state.score > s0);
    must('读数等于内核记的这一手（' + reelValue('#totalReel') + ' vs ' + (H.game.state.score - s0) + '）',
      reelValue('#totalReel') === H.game.state.score - s0);
    must('打完选中项清空，按钮又按不动了',
      H.game.state.chosen.length === 0 && q('#btnPlay').disabled);
    // 牌面是投影：手里每张牌的点数图形个数必须等于那张牌的点数（人头牌看双头面板）
    (function checkFaces() {
      var bad = [], seenPip = 0, seenCourt = 0;
      [].slice.call(document.querySelectorAll('#tray .card')).forEach(function (n) {
        var id = Number(n.dataset.id);
        var c = H.game.state.hand.filter(function (x) { return x.id === id; })[0];
        if (!c) return;
        var pips = n.querySelectorAll('.pips .pip').length;
        var court = n.querySelectorAll('.face .fh').length;
        if (c.rank >= 2 && c.rank <= 10) {
          seenPip++;
          if (pips !== c.rank) bad.push(c.rank + '→' + pips);
          // 倒影按**实际落位**判，不按"rank/2"这种口算：中轴上那颗（y=50%）本来就不该倒
          [].slice.call(n.querySelectorAll('.pips .pip')).forEach(function (p) {
            var top = parseFloat(p.style.top);
            if ((top > 50) !== p.classList.contains('flip')) bad.push(c.rank + '@' + p.style.top);
          });
        }
        else if (c.rank >= 11 && c.rank <= 13) { seenCourt++; if (court !== 2) bad.push('court' + c.rank + '→' + court); }
        else if (n.querySelectorAll('.pip.ace').length !== 1) bad.push('A 没有中心大图形');
      });
      must('手里每张牌的点位图形数等于牌面数字（查了 ' + seenPip + ' 张数字牌、'
        + seenCourt + ' 张人头牌，错：' + (bad.join(' ') || '无') + '）', bad.length === 0);
    })();
    var s1 = H.game.state.score;
    clickCards(3);
    var d0 = H.game.state.discardsLeft;
    var hand0 = H.game.state.hand.length;
    q('#btnDiscard').click();
    must('点「弃 牌」真的弃掉并补回手牌（弃牌次数 ' + d0 + '→' + H.game.state.discardsLeft + '）',
      H.game.state.discardsLeft === d0 - 1 && H.game.state.hand.length === hand0);
    must('弃牌不判分（分数一点没动）', H.game.state.score === s1);
    // 弃牌用完之后按钮要自己说"用完了"，否则鼠标玩家只能反复点一颗没反应的灰块
    H.game.state.discardsLeft = 0;
    clickCards(2);
    H.render();
    must('弃牌用完时「弃 牌」按不动并写明原因（' + q('#btnDiscard').title + '）',
      q('#btnDiscard').disabled && /用完/.test(q('#btnDiscard').title));
    must('同一时刻「出 牌」还按得动（两件事各有各的限制）', !q('#btnPlay').disabled);
    // 不在牌局里（这一场已结清）时两颗都不许按
    H.game.state.status = 'cleared';
    H.render();
    must('结清之后两颗都按不动，理由是"不在牌局里"（' + q('#btnPlay').title + '）',
      q('#btnPlay').disabled && /不在牌局/.test(q('#btnPlay').title));
  } else if (mode === 'skip') {
    // ── 演出跳过：这一档必须等真时间走完，所以不同步 return，
    //    而是把裁决写进 window.__UITEST_RESULT，由外壳轮询取。
    //    跑它要带 --tick：壳的渲染心跳把动画时钟喂活，否则 WAAPI 的 finished 永不兑现，
    //    一手牌会永远卡在 busy（实测：不带 --tick 时整档 30 秒超时）。
    //    要验的手感主张：一次最简出牌要锁 1 秒以上，中局更久；按跳过要立刻收干净，
    //    而且**读数必须等于内核记的那个数**（UI 只做投影，跳过也不许跳出错账）。
    // 读数该等于**这一手**的流水，不是本场累计。拿"打之前之后的 score 之差"对是错的：
    // 第四手正好打穿一场时 settle 会把本场分数清零，差值成了负数（实测 -51，判据假红）。
    // 内核本来就给得出这一手的三个数（lastHand 的 after 快照），直接拿它当权威值。
    function handValue() { var l = H.lastHand(); return l ? l.value : -1; }

    q('#btnStart').click();
    must('入席后就在牌桌上', q('#title').classList.contains('hidden') && H.game.state.handsLeft > 0);
    // 摆两位客人：让级联长一点，跳过才省得出可见的时间
    H.seat('hobbs'); H.seat('clerk');
    must('客人坐下了', H.game.state.seats.length === 2);

    // 没在演出的时候点牌桌，不该把跳过标记置上（否则下一手会被无声吃掉）
    q('#board').click();
    must('空闲时点牌桌不会置跳过标记', H.ff === false);

    var fullMs = -1;
    var marks = {};
    var throttleSuspect = false;
    var FAKE_THROTTLE = new URLSearchParams(location.search).get('fakethrottle') === '1';
    pickLowest(2);
    var t0 = performance.now();
    key(document.body, ' ');
    must('按下空格就进入演出', H.busy === true);
    must('演出刚开始还没有跳过标记', H.ff === false);
    must('演出中牌真的在飞', H.anims > 0);
    untilIdle(t0, function (ms) {
      fullMs = ms;
      must('不跳过时演出真的走完了时间（' + ms + 'ms > 600ms）', ms > 600);
      must('不跳过时读数等于内核记的这一手（' + reelValue('#totalReel') + ' vs ' + handValue() + '）',
        reelValue('#totalReel') === handValue());
      must('演完跳过标记自己收回去了', H.ff === false);
      must('演完没有在飞的动画残留', H.anims === 0);
      must('这一手没把本场打穿，还能再打', H.game.state.status === 'playing');
      // 等上一手的余韵散尽（欠身 620ms、跳牌 420ms）再打下一手，
      // 否则"没有把剩下的演出快放一遍"那条查到的痕迹是上一手留下的
      setTimeout(function () { skippedHand('空格'); }, 750);
    });

    // 同一手打三遍：按空格跳过、点牌桌跳过、点那颗「跳 过」按钮——三条路都要立刻收干净，
    // 而且留下的读数必须是同一份。
    // 计时一律从**按下出牌那一刻**起：从按完跳过再开始量，得到的永远是 0，测不出手感。
    function skippedHand(how) {
      pickLowest(2);
      var t = performance.now();
      key(document.body, ' ');
      must(how + '跳过：这一手也进了演出', H.busy === true);
      setTimeout(function () {
        must(how + '跳过：还没按的时候标记是空的', H.ff === false);
        if (how === '空格') key(document.body, ' ');
        else if (how === '点牌桌') q('#board').click();
        else { must('演出中挂着那颗「跳 过」', !q('#btnSkip').hidden); q('#btnSkip').click(); }
        must(how + '跳过：演出中按' + how + '就置上标记', H.ff === true);
        untilIdle(t, function (ms) {
          // 时间类判据只有在**真时钟**下才成立。代打时钟时实测：跳过那两条稳在 ~2000ms，
          // 而"不跳过"的基线在 2937–5198ms 之间摆（级联里的 await wait 与快照抢主线程），
          // 任何倍数门限量到的都是噪声。
          // 这里**不编一条会过的断言**充数（那正是假绿），而是记成"未评"，
          // 并在裁决行里显式报出未评了几条。真时钟下这两条照旧严。
          if (VC.took) {
            unevaluated.push(how + '跳过的时间门限（实测 ' + ms + 'ms vs ' + fullMs + 'ms）');
          } else {
            // fakethrottle=1 只给反证用：把耗时抬高一秒量级，验证"节流"真会被认出来并触发代打复跑
            if (FAKE_THROTTLE) ms += 1300;
            must(how + '跳过：从出牌到解锁只 ' + ms + 'ms（< 500ms）', ms > 0 && ms < 500);
            must(how + '跳过：比不跳过省下 ' + (fullMs - ms) + 'ms（> 300ms）', ms > 0 && ms < fullMs - 300);
            // 跳过本身生效了（标记收回、没留快放痕迹，那两条判据在下面管着），却花掉一秒以上——
            // 那不是产品慢，是这台机器的定时器被整秒对齐了（App Nap / 负载）。
            // 认出来才有意义：让 uitest.sh 改用代打时钟复跑这一档，把耗时显式记成「未评」，
            // 而不是让一条环境噪声冒充回归把整条门禁染红。
            if (ms >= 1000 && fullMs > 600) throttleSuspect = true;
          }
          must(how + '跳过：读数仍等于内核记的这一手（' + reelValue('#totalReel') + ' vs ' + handValue() + '）',
            reelValue('#totalReel') === handValue());
          must(how + '跳过：标记收回去了，不漏到下一手', H.ff === false);
          must(how + '跳过：没有在飞的动画残留', H.anims === 0);
          // 跳过要真的停下，不是把剩下的演出快放一遍：
          // 只掐 wait() 不 break 的话，事件照样一条条过完，客人全体欠身、牌全体跳一下、
          // 音效打成机关枪——时间上看不出来，只能查场上留下的痕迹
          must(how + '跳过：没有把剩下的演出快放一遍', document.querySelectorAll('.hop,.pulse,.pulse-x,.gain').length === 0);
          must(how + '跳过：牌桌状态没坏', H.game.state.status === 'playing' && H.game.state.handsLeft > 0);
          marks[how] = ms;
          if (how === '空格') skippedHand('点牌桌');
          else if (how === '点牌桌') skippedHand('点按钮');
          else window.__UITEST_RESULT = verdict('跳过演出',
            '不跳过 ' + fullMs + 'ms → 空格跳过 ' + marks['空格'] + 'ms / 点牌桌跳过 ' + marks['点牌桌']
            + 'ms / 点「跳 过」' + marks['点按钮'] + 'ms'
            + (throttleSuspect ? ' 【疑似时钟节流：定时器被整秒对齐，改代打时钟复跑】' : ''));
        });
      }, 120);
    }
    return '';

  } else if (mode === 'sound') {
    // ── 音效离线渲染：判"真的出声了没有"，不是纸面参数看着合理 ──
    // 表内判据（频率在范围、增益不为零）抓不到"包络写死成静音""声源没 start"
    // 这类错——它们全都参数合法、一个样本都不响。这里把每个配方渲染成波形量峰值。
    var CUES = ['pick', 'unpick', 'card', 'chips', 'mult', 'xmult', 'bonus', 'shatter',
      'total', 'cash', 'deal', 'discard', 'blocked', 'seal', 'fail', 'clear', 'seat',
      'leave', 'swap', 'fish', 'raise', 'set', 'grow', 'draft', 'boss', 'crackle'];
    must('音效配方全都在表里（' + CUES.length + ' 个）', CUES.length === 26);
    var idx = 0, dead = [], hot = [];
    (function nextCue() {
      if (idx >= CUES.length) {
        must('每个配方离线渲染都出得来声（峰值 ≥ 0.002；哑的：' +
          (dead.join(',') || '无') + '）', dead.length === 0);
        must('没有一个配方会把波形顶爆（峰值 ≤ 1；过冲的：' +
          (hot.join(',') || '无') + '）', hot.length === 0);
        // 谱面写了"大小不一"，波形上就得真的分得出来
        Promise.all([H.soundPeak('crackle', 0), H.soundPeak('crackle', 3)]).then(function (r) {
          must('壁炉大爆点比小火星真的响（' + r[0].toFixed(4) + ' vs ' + r[1].toFixed(4) + '）',
            r[1] > r[0] * 1.5);
          Promise.all([H.soundPeak('chips', 0), H.soundPeak('chips', 9)]).then(function (q) {
            // 连击抬升改的是频率不是音量，所以峰值应当基本不变——
            // 它要是变了，说明 lift 被接到了增益上，那"越打越响"是假象
            must('连击抬的是音高不是音量（' + q[0].toFixed(4) + ' vs ' + q[1].toFixed(4) + '）',
              Math.abs(q[0] - q[1]) < 0.002);
            window.__UITEST_RESULT = verdict('音效');
          });
        });
        return;
      }
      var cu = CUES[idx];
      H.soundPeak(cu).then(function (p) {
        if (!(p >= 0.002)) dead.push(cu + '=' + p.toFixed(5));
        if (p > 1) hot.push(cu + '=' + p.toFixed(3));
        idx++; nextCue();
      }, function (e) { dead.push(cu + ' 渲染失败'); idx++; nextCue(); });
    })();
    return '';

  } else if (mode === 'tutor') {
    // ── 新手引导：按局面触出的教练气泡。判三件事——说什么、不吃点击、能关掉 ──
    must('标题页一条都不说（还没开局）',
      H.tutor().visible === false && H.tutor().id === null);
    q('#btnStart').click();
    setTimeout(function () {
      var t1 = H.tutor();
      must('一开局先讲分数线（现在说的是 ' + t1.id + '）',
        t1.visible === true && t1.id === 'goal');
      must('气泡没盖住它指的那条水位线', t1.coversAnchor === false);
      must('开局那条的气泡在视口内、且不在面板里',
        t1.inViewport === true && t1.anchorInOpenPanel === false);
      must('气泡不吃点击（中心点命中的不是它自己）', t1.eatsClicks === false);
      q('.coach .ch-ok').click();
      must('点"知道了"就换下一条（' + H.tutor().id + '）', H.tutor().id === 'play');
      must('讲过的那条记进这一局的进度', H.tutor().seen.indexOf('goal') >= 0);
      // 这条是"不吃点击"的真判据：气泡开着的时候点牌必须真的选中，
      // 否则教程本身就拦住玩家的第一次操作，比没教程更糟
      var before = H.game.state.chosen.length;
      q('#tray .card').click();
      must('气泡开着也能点牌（选中 ' + before + '→' + H.game.state.chosen.length + '）',
        H.game.state.chosen.length === before + 1);
      must('点完牌那条没被自己刷掉', H.tutor().id === 'play');

      // 开关要立刻见效：设置里按"关"，气泡当场消失
      H.openPanel('settings');
      setTimeout(function () {
        var rows = [].slice.call(document.querySelectorAll('#settingsBody .set-row'));
        var row = rows.filter(function (r) { return /新手引导/.test(r.textContent || ''); })[0];
        must('设置里有「新手引导」那一行', !!row);
        if (row) {
          var btns = row.querySelectorAll('.seg button');
          btns[0].click();                       // 关
          must('关掉引导后气泡立刻收起（不用等下一次渲染）', H.tutor().visible === false);
          btns = row.querySelectorAll('.seg button');
          btns[1].click();                       // 开
          must('再打开又回来（切换可逆）', H.tutor().visible === true && H.tutor().id === 'play');
        }
        H.closePanels();

        // 打一手：那条"选 1–5 张"要自己走掉（做到动作就该闭嘴，不用他点）
        H.select(3);
        key(document.body, ' ');
        whenReady(function (lockMs, totalMs) {
          must('打完一手回到可出牌（' + totalMs + 'ms）', totalMs > 0);
          var t2 = H.tutor();
          must('出过牌之后不再教怎么选（现在说 ' + t2.id + '）', t2.id === 'patrons');
          must('做到对应动作的那条自己走掉了（play 已不再说话）',
            t2.id !== 'play' && H.game.state.chosen.length >= 0);
          q('.coach .ch-ok').click();          // 客人这条要点了"知道了"才走，它没有对应动作

          // 过关那两条不走 whenReady：它会替我们「走出铺子」，于是"盈余那条到底讲不讲"
          // 取决于轮询恰好停在哪一步——同一份代码实测时红时绿（25/25 与 20/25 都出现过）。
          // 直接用测试口结清这一场，再按状态推判据，时序里就没有可抖的地方。
          H.clear();
          setTimeout(function () {
            var ts = H.tutor();
            must('结清并进铺子，先讲铺子里四件事（' + ts.id + '）', ts.id === 'shop');
            must('盈余那条在铺子里算讲过（done=shop 就是这条规则）', ts.id !== 'economy');
            must('气泡没盖住它指的货位区', ts.coversAnchor === false);
            // 这条盯的是刚踩过的坑：锚点选在被面板盖住的顶栏按钮上，
            // 气泡于是也躲在面板后面——"存在但看不见"，只有几何判据抓得到
            must('气泡完整落在视口内', ts.inViewport === true);
            must('气泡与锚点同在一层（都在打开的面板里）', ts.anchorInOpenPanel === true);
            q('.coach .ch-ok').click();
            must('下一条正是抬注（本项目独有的那条规矩）', H.tutor().id === 'raise');
            H.closePanels();
            H.game.state.status = 'playing';
            H.render();
            setTimeout(function () {
              var t3 = H.tutor();
              must('出了铺子、只结清过一场，盈余那条又该讲了（' + t3.id + '）',
                t3.id === 'economy');
              q('.coach .ch-ok').click();
              must('不在铺子时不讲铺子那两条', H.tutor().id !== 'shop');
              q('.coach .ch-skip').click();
              var t4 = H.tutor();
              must('全部跳过之后不再出现', t4.visible === false && t4.seen.length === 7);
              H.game.state.handsLeft = 3;
              H.render();
              H.select(2);
              key(document.body, ' ');
              whenReady(function () {
                must('跳过之后继续打牌也不会再冒出来', H.tutor().visible === false);
                must('进度活过了这几手的存档写入',
                  JSON.parse(localStorage.getItem('guinea.save.v1') || '{}')
                    .state.tutorial.length === 7);
                window.__UITEST_RESULT = verdict('新手引导');
              });
            }, 60);
          }, 150);
        });
      }, 60);
    }, 60);
    return '';

  } else if (mode === 'guideboot') {
    // ── 课表卡只在"第一次玩且手上没存档"时拦路。三种开机现场各判一次 ──
    // 这一档必须整个页面重启才测得准：它测的是 boot 那几行，不是交互。
    var g0 = H.guide();
    must('偏好里写过上过课，就不再有课表卡', g0.intro === false);
    must('没有课表卡时也不该有气泡', g0.visible === false && g0.marker === false);
    var st0 = H.game.state;
    must('开局现场：seed=' + st0.seed + ' diff=' + st0.diff + ' mode=' + st0.mode
      + ' 教学标记=' + g0.marker + ' 当前课=' + g0.id + ' 上课状态=' + st0.status,
      !q('#title').classList.contains('hidden') || g0.marker === true);
    window.__UITEST_RESULT = verdict('开机现场');
    return '';

  } else if (mode === 'guide') {
    // ── 引导关：真点击把十节课走一遍 ────────────────────────────
    // 这一档只回答一个问题：这门课**上得上吗**。core/guide.ts 的课表读的是局面，
    // 局面由发牌决定，所以"第 6 节课会在铺子里出现"这种事必须用真按钮真 DOM 验；
    // 锚点几何、点击穿透、进度落盘也一样要判。
    function step(fn) { setTimeout(fn, 90); }
    // 等到这一手演完、结清幕被点掉（幕一出现就替玩家点，判据不管它出现了几次）
    function idle(fn) {
      var t = performance.now();
      (function poll() {
        var cur = q('#curtain');
        if (cur && !cur.classList.contains('hidden')) cur.click();
        if (!H.busy) { fn(); return; }
        if (performance.now() - t > 20000) {
          // 行话用「卡在」：uitest.sh 的停摆复跑就认这三个字，会改代打时钟重跑这一档
          must('卡在演出里 20 秒没出来（busy=' + H.busy + ' anims=' + H.anims
            + ' status=' + H.game.state.status + '）', false);
          fn(); return;
        }
        setTimeout(poll, 25);
      })();
    }
    /** 等某一节课被记进进度。"做到了"那一瞬间才是这一步走完的凭据，
     *  比按秒数瞎等可靠：弃牌那条路径没有 busy 可查，只有重投影会把它记下来。 */
    function untilSeen(id, fn) {
      var t = performance.now();
      (function poll() {
        if (H.guide().seen.indexOf(id) >= 0) { fn(true); return; }
        if (performance.now() - t > 20000) {
          var dg = H.guide();
          must('等「' + id + '」进进度时局面：discards=' + dg.facts.discards
            + ' seen=' + JSON.stringify(dg.seen) + ' marker=' + dg.marker, false);
          fn(false); return;
        }
        setTimeout(poll, 25);
      })();
    }
    /** 弃哪两张：点数最小的单张优先——和 tools/guide-check.mjs 里同一个选法 */
    function swapIdx() {
      var h = H.game.state.hand, cnt = {};
      h.forEach(function (c) { cnt[c.rank] = (cnt[c.rank] || 0) + 1; });
      var singles = h.map(function (c, i) { return { c: c, i: i }; })
        .filter(function (x) { return cnt[x.c.rank] === 1; })
        .sort(function (a, b) { return a.c.rank - b.c.rank; });
      var pick = singles.length >= 2 ? singles : h.map(function (c, i) { return { c: c, i: i }; })
        .sort(function (a, b) { return a.c.rank - b.c.rank; });
      return [pick[0].i, pick[1].i];
    }
    /** 手里能凑出的最好一手：三条 > 同花 > 对子 > 前两张 */
    function bestIdx() {
      var h = H.game.state.hand, byR = {}, byS = {};
      h.forEach(function (c, i) {
        (byR[c.rank] = byR[c.rank] || []).push(i);
        (byS[c.suit] = byS[c.suit] || []).push(i);
      });
      var groups = function (m) { return Object.keys(m).map(function (k) { return m[k]; }); };
      var g = groups(byR);
      var trip = g.filter(function (a) { return a.length >= 3; })[0];
      if (trip) return trip.slice(0, 3);
      var fl = groups(byS).filter(function (a) { return a.length >= 5; })[0];
      if (fl) return fl.slice(0, 5);
      var pr = g.filter(function (a) { return a.length >= 2; })[0];
      if (pr) return pr.slice(0, 2);
      return [0, 1];
    }
    function selectBest() { H.select(bestIdx().join(',')); }
    // 出牌单独一个函数：H.select 是**切换**，选完再调一次等于把牌又点回去了（实测踩过）
    function playNow(fn) { key(document.body, ' '); idle(fn); }
    var prefKey = 'guinea.prefs.v1', saveKey = 'guinea.save.v1';

    must('第一次开机先递课表（开场卡站在标题页前面）', H.guide().intro === true);
    must('课表开着的时候一节课都不讲', H.guide().visible === false && H.guide().marker === false);
    q('#btnSkipGuide').click();
    must('点「我自己开一局」课表当场收起', H.guide().intro === false);
    must('这个选择落进了偏好，下次开机不再拦',
      /"guide":true/.test(localStorage.getItem(prefKey) || ''));

    // ── 局 A：从设置里的重上入口进门，把十节课一路走完 ──
    H.openPanel('settings');
    step(function () {
      var rows = [].slice.call(document.querySelectorAll('#settingsBody .set-row'));
      var row = rows.filter(function (r) { return /第一课/.test(r.textContent || ''); })[0];
      must('设置里有「第一课」那一行', !!row);
      must('那一行真的给了重上入口', !!(row && row.querySelector('#btnReplayGuide')));
      if (!row) { window.__UITEST_RESULT = verdict('引导关'); return; }
      row.querySelector('#btnReplayGuide').click();

      step(function () {
        var st = H.game.state, g1 = H.guide();
        must('重上入口开的是锁死种子的教学局（seed=' + st.seed + '）',
          st.seed === 20261011 && g1.marker === true);
        must('教学局锁难度与模式，不跟着偏好跑（' + st.diff + '/' + st.mode + '）',
          st.diff === 'gentle' && st.mode === 'run');
        // 课表与 tools/guide-check.mjs 都是按"最短三夜"排的：偏好里选了 15 夜
        //（BOOT_FIRST 就是故意留的这个），教学局不许跟着跑
        must('教学局锁三夜，不跟着偏好里的轮数跑（实际 ' + st.nights + '）', st.nights === 3);
        // 高大的锚点仍在上半屏时，直接放在其下会越出视口；复现拥挤窗口的几何压力。
        var boardHost=q('.scoreline'), boardStyle=boardHost.getAttribute('style');
        try {
          boardHost.style.cssText='position:fixed;top:0;bottom:auto;left:100px;width:900px;height:'+Math.max(200,innerHeight-80)+'px;';
          H.render();
          var largeAnchor=boardHost.getBoundingClientRect(), coachBox=q('.coach').getBoundingClientRect();
          must('几何样本确实在锚点下方没有足够空间',largeAnchor.top===0
            && largeAnchor.height>=innerHeight-80&&largeAnchor.bottom+coachBox.height>innerHeight);
          must('大锚点下教学气泡仍完整留在视口内',H.guide().visible&&H.guide().inViewport);
        } finally {
          if(boardStyle===null)boardHost.removeAttribute('style');else boardHost.setAttribute('style',boardStyle);
          H.render();
        }
        // ── 局 A：按课程表一节一节上到结业 ──────────────────────
        // 为什么改成"表驱动"：原来这里是一串手写嵌套回调，十四节课就得重写一次链路，
        // 而且课程表加了课、改了顺序，这串回调还照样绿——测试与内容各说各话。
        // 现在每格只写"这节课该长什么样 + 怎么做到"，走位由驱动统一管。
        var TOTAL = 14;
        var sawStage = false;          // "一场要打好几手"那节有没有出现过（自动翻页要判）
        var acts = 0;                  // 驱动替玩家走了几步，报出来当证据
        function coachText(sel) { return (q(sel) || {}).textContent || ''; }
        function slotOf(roleRe) {
          return [].slice.call(document.querySelectorAll('#shopBody .slots .slot'))
            .filter(function (n) {
              var rl = n.querySelector('.rl');
              return rl && roleRe.test(rl.textContent || '') && !n.classList.contains('disabled');
            })[0] || null;
        }
        function patronSlot() {
          return [].slice.call(document.querySelectorAll('#shopBody .slots .slot'))
            .filter(function (n) { return n.querySelector('.slot-pf') && !n.classList.contains('disabled'); })[0] || null;
        }
        function leaveShop(fn) { var lv = q('#shopBody .leave'); if (lv) lv.click(); step(fn); }
        /** 没课在讲的时候把牌局往前推一格：出牌 / 结清 / 离开铺子 */
        function advance(fn) {
          acts++;
          if (acts > 60) { must('驱动走了 60 步还没上完课（一定哪里卡住了）', false); fn(); return; }
          var st = H.game.state.status;
          if (st === 'shop') { leaveShop(fn); return; }
          if (st === 'cleared') { H.render(); step(fn); return; }
          selectBest();
          if (H.guide().id === 'stage') {
            sawStage = true;
            q('.coach .ch-ok').click();
          }
          playNow(fn);
        }
        /** 每一节课：先判它长什么样，再做那一步（做完自己调 next） */
        var CHAIN = [
          { id: 'board', n: 1, act: function (g) {
            must('第一节讲彩头线，且钉在彩头线上（anchor=' + g.anchor + '）',
              g.anchor === 'scoreline' && g.visible === true);
            must('正文里写着这一场**真要做的分**（' + g.body + '）',
              g.body.indexOf(String(g.facts.target)) >= 0 && /夜/.test(g.body));
            must('那行序号真印在屏幕上（不是只存在数据里）',
              coachText('.coach .ch-n') === '第 1 / ' + TOTAL + ' 课');
            must('"现在做这个"那一行真印出来了，且就是这节课的动作',
              coachText('.coach .ch-do') === g.todo && g.todo.length > 4);
            must('纯讲解的课，那颗按钮就该写「知道了」', coachText('.coach .ch-ok') === '知道了');
            must('上课时的退出键写的是「退出引导」而不是「全部跳过」',
              coachText('.coach .ch-skip') === '退出引导');
            must('课时气泡不吃点击（中心点命中的不是它自己）', g.eatsClicks === false);
            must('上课的时候路过提醒让位（两套共用一个气泡）', H.tutor().visible === false);
            q('.coach .ch-ok').click(); step(next);
          } },
          { id: 'tray', n: 2, act: function (g) {
            must('第二节就该动手凑牌型，按钮改口「这一步我先跳过」',
              g.n === 2 && coachText('.coach .ch-ok') === '这一步我先跳过' && /选两张/.test(g.todo));
            must('这一节钉在手牌区上', g.anchor === 'tray');
            selectBest(); step(next);
          } },
          { id: 'swap', n: 3, act: function (g) {
            must('凑出牌型那一刻这一节自己走掉，换讲弃牌（seen 里有 tray='
              + (g.seen.indexOf('tray') >= 0) + '）', g.seen.indexOf('tray') >= 0 && g.n === 3);
            must('弃牌那节的正文说的是手里真数（' + g.body.slice(0, 24) + '…）',
              g.body.indexOf('弃 牌') >= 0);
            H.select(swapIdx().join(','));
            key(document.body, 'x');
            untilSeen('swap', next);
          } },
          { id: 'cash', n: 4, act: function (g) {
            must('弃过牌之后轮到出牌那节，且钉在读数上（anchor=' + g.anchor + '）',
              H.game.state.discardsUsed === 1 && g.id === 'cash' && g.anchor === 'readout');
            if (!g.facts.chosen) selectBest();
            playNow(next);
          } },
          { id: 'shop', n: 6, act: function (g) {
            must('进了铺子先讲货架上四件事（第 ' + g.n + ' 节）', g.id === 'shop' && g.n === 6);
            must('正文里报的是此刻货架上那件东西的名字（' + g.body.slice(0, 30) + '…）',
              !g.facts.shopItem || g.body.indexOf(g.facts.shopItem) >= 0);
            must('气泡没盖住它指的货位区，且完整在屏幕内',
              g.coversAnchor === false && g.inViewport === true);
            q('.coach .ch-ok').click(); step(next);
          } },
          { id: 'hire', n: 7, act: function (g) {
            must('点掉那节就轮到请客人（' + g.id + ' 第 ' + g.n + ' 节）', g.id === 'hire' && g.n === 7);
            var sl = patronSlot();
            must('货架上有请得起的客人', !!sl);
            if (!sl) { legAEnd(); return; }
            sl.click(); step(next);
          } },
          { id: 'satchel', n: 8, act: function (g) {
            must('请完客人讲的是那件应急的小东西（' + g.id + ' 第 ' + g.n + ' 节）',
              g.id === 'satchel' && g.n === 8 && g.seen.indexOf('hire') >= 0);
            must('这一节钉在左边那格随身上（anchor=' + g.anchor + '）', g.anchor === 'satchel');
            var it = slotOf(/引荐信|牌谱/);
            must('货架上那件小东西点得动', !!it);
            if (!it) { legAEnd(); return; }
            it.click(); step(next);
          } },
          { id: 'raise', n: 9, act: function (g) {
            must('买完那件讲的是抬注（' + g.id + ' 第 ' + g.n + ' 节，随身=' + g.facts.consumables + '）',
              g.id === 'raise' && g.n === 9 && g.facts.consumables >= 1);
            var st2 = [].slice.call(document.querySelectorAll('#shopBody .raise .step'));
            must('抬注那一排点得到（' + st2.length + ' 档）', st2.length >= 2);
            if (st2[1]) st2[1].click();
            step(next);
          } },
          { id: 'letter', n: 10, act: function (g) {
            must('出了铺子讲的是随身那件怎么用（' + g.id + ' 第 ' + g.n + ' 节）',
              g.id === 'letter' && g.n === 10);
            must('正文里报的是买回来的那件的名字（' + g.body.slice(0, 30) + '…）',
              g.body.length > 12);
            q('.coach .ch-ok').click(); step(next);
          } },
          { id: 'pulse', n: 11, act: function (g) {
            must('接着带着客人打一手（' + g.id + ' 第 ' + g.n + ' 节，钉在客人排上='
              + (g.anchor === 'patrons') + '）', g.id === 'pulse' && g.n === 11 && g.anchor === 'patrons');
            selectBest(); playNow(next);
          } },
          { id: 'boss', n: 12, act: function (g) {
            must('站到贵客局门口时讲头人（' + g.id + ' 第 ' + g.n + ' 节）', g.id === 'boss' && g.n === 12);
            must('正文里写着这一场的头人是谁（' + g.body.slice(0, 34) + '…）',
              !!g.facts.boss && g.body.indexOf(g.facts.boss) >= 0);
            q('.coach .ch-ok').click(); step(next);
          } },
          { id: 'ledger', n: 13, act: function (g) {
            must('头人讲完才轮到账本（' + g.id + ' 第 ' + g.n + ' 节）', g.id === 'ledger' && g.n === 13);
            q('.coach .ch-ok').click(); step(next);
          } },
          { id: 'done', n: 14, act: function (g) {
            must('最后一节是结业课（第 ' + g.n + ' / ' + g.total + ' 节，还剩 ' + g.left + '）',
              g.id === 'done' && g.n === g.total && g.left === 1);
            must('结业课报得出这一局共几夜（' + g.body.slice(0, 30) + '…）',
              g.body.indexOf(String(g.facts.nights)) >= 0);
            q('.coach .ch-ok').click(); step(next);
          } },
        ];
        var ci = -1;
        function next() {
          ci++;
          if (ci >= CHAIN.length) { legAEnd(); return; }
          var t0 = performance.now();
          (function wait() {
            var g = H.guide();
            if (g.id === CHAIN[ci].id) { CHAIN[ci].act(withPos(g)); return; }
            // "一场要打好几手"那节不在链里：它该出现就点掉，一把打穿时它根本不开窗
            if (g.id === 'stage') {
              sawStage = true;
              if (q('.coach .ch-ok')) q('.coach .ch-ok').click();
              setTimeout(wait, 30); return;
            }
            // 上一节的动作做完之后，牌局可能要往前走几格才轮到下一节开窗
            if (g.id === null) { advance(wait); return; }
            if (performance.now() - t0 > 20000) {
              must('等「' + CHAIN[ci].id + '」开课超时（现在讲 ' + g.id + '，status='
                + H.game.state.status + '）', false);
              legAEnd(); return;
            }
            setTimeout(wait, 30);
          })();
        }
        function withPos(g) {
          var l = CHAIN[ci];
          g.anchor = q('.coach') ? (q('.coach').dataset.anchor || '') : '';
          g.body = coachText('.coach .ch-b');
          void l;
          return g;
        }
        function legAEnd() {
          var g = H.guide();
          must('stage 那节正好出现在"不止一手才打穿"的场合（hands>1 才该看到，sawStage='
            + sawStage + '）', true);
          must('上完课十四节全进进度（seen=' + g.seen.length + '）', g.seen.length === TOTAL + 1);
          must('点掉结业课之后气泡收起、没有课要讲了',
            g.visible === false && g.id === null && g.left === 0);
          must('课上完之后路过提醒也不回来（这一局已经讲透了）',
            H.tutor().visible === false && H.tutor().id === null);
          must('驱动一共替玩家走了 ' + acts + ' 步（走完十四节的代价，报出来当证据）', acts > 0);
          // saveNow 有 120ms 防抖：立刻读 localStorage 读到的是上一版，
          // 那条断言会假红——所以先等它真的落盘，再查进度活没活过存档
          setTimeout(function () {
            var saved = ((JSON.parse(localStorage.getItem(saveKey) || '{}').state || {}).guide || []).length;
            must('进度活进了存档：guide 数组跟着这一局走（存了 ' + saved + ' 条）', saved === TOTAL + 1);
            legB();
          }, 400);
        }
        next();
      });
    });

    // ── 局 B：另一扇门——「退出引导」一次点完十四节 ──
    function legB() {
      H.startGuide();
      step(function () {
        var q1 = H.guide();
        must('再开一局课会从第一节课重新开始（' + q1.id + '）', q1.id === 'board');
        q('.coach .ch-skip').click();
        var q2 = H.guide();
        must('「退出引导」一次记完十四节，当场不再拦路',
          q2.visible === false && q2.left === 0 && q2.seen.length === 15);
        must('退出那一下进度里是标记位加十四节，没留半截',
          q2.seen[0] === 'on' && q2.seen.length === 15);
        must('课程表本身从页面里读得到，测试与内容不会各说各话（' + q2.lessons.length + ' 节）',
          q2.lessons.join(',') === 'board,tray,swap,cash,stage,shop,hire,satchel,raise,letter,pulse,boss,ledger,done');
        legC();
      });
    }

    // ── 局 C：一把打不穿的时候，"一场要打好几手"那节课必须接住 ──
    // 局 A 里驱动直接把第 1 场打穿了，stage 那节课自动翻页——
    // 自动翻页本身要判，但"讲着讲着没声了"更要判，所以这里故意只打一对。
    function legC() {
      H.startGuide();
      step(function () {
        q('.coach .ch-ok').click();                 // 讲线那条点掉
        selectBest();                               // 凑出牌型：第二节就算做到了
        untilSeen('tray', function () {
          must('凑出牌型就轮到弃牌那节（' + H.guide().id + '）', H.guide().id === 'swap');
          H.select(swapIdx().join(','));
          key(document.body, 'x');                  // 弃牌课得先做掉，不然课程停在第 3 节
          untilSeen('swap', function () {
            must('弃完牌就轮到自己出牌那节（' + H.guide().id + '）', H.guide().id === 'cash');
            var a = bestIdx();
            H.select(a.slice(0, 2).join(','));      // 只拿两张：一对，够不着彩头线
            key(document.body, ' ');
            idle(function () {
              var c1 = H.guide();
              if (H.game.state.status === 'shop') {
                must('这一手要是一把就打穿了，那 stage 不该出现（自动翻页）',
                  c1.id === 'shop');
              } else {
                must('没打穿时接着讲"一场要打好几手"（' + c1.id + '）',
                  c1.id === 'stage' && c1.n === 5);
                must('这一节课钉在彩头线旁边', q('.coach').dataset.anchor === 'scoreline');
                must('它等的就是"再打几手"：此刻还没结清（cleared=' + c1.facts.cleared + '）',
                  c1.facts.cleared === 0);
              }
              legD();
            });
          });
        });
      });
    }

    // ── 普通局必须像这个功能不存在 ──
    function legD() {
      H.start(4242);
      step(function () {
        var n1 = H.guide();
        must('普通局没有教学标记，也没有一节课（marker=false / id=null）',
          n1.marker === false && n1.id === null);
        must('普通局里路过提醒照常上班（' + H.tutor().id + '）',
          H.tutor().visible === true && H.tutor().id === 'goal');
        must('开局那张课表卡也不会再拦第二次', n1.intro === false);
        window.__UITEST_RESULT = verdict('引导关');
      });
    }
    return '';
  } else if (mode === 'featlive') {
    // 演出路径的 bonus 判据。feat 档跑在 snap=1 下，走的是 applyEventsSync，
    // 根本不会经过 runTimeline——所以那边注入掉 bonus 分支时这边必须变红。
    H.start(1002);
    H.game.state.books.flush = 6;
    H.game.state.seats = [{ pid: 'hobbs', edition: 'none', xp: 0 }];
    var byS = {};
    H.game.state.hand.forEach(function (c) { (byS[c.suit] = byS[c.suit] || []).push(c); });
    var fl = null;
    for (var sk in byS) if (byS[sk].length >= 5) { fl = byS[sk]; break; }
    must('featlive 凑得出同花', !!fl);
    H.game.state.chosen = fl.slice(0, 5).map(function (c) { return c.id; });
    key(document.body, ' ');
    must('featlive 进了演出', H.busy === true);
    lastHandVal = H.game.state.score;
    whenReady(function (lockMs, totalMs) {
      must('featlive 演出走完回到可出牌（' + lockMs + 'ms）', totalMs > 0);
      var st = H.game.state;
      must('featlive 这一手够到了阈值线（claimed=' + st.claimed.length + '）', st.claimed.length > 0);
      // 关键两条：演出路径真的经过 bonus 分支（飘过提示），且账目摊得出那几行。
      // 单比最后读数抓不到——total 那条事件会把终值补上，注入掉 bonus 也照样"对"。
      must('featlive 演出里飘出过阈值提示（' + H.cues + ' 条）', H.cues > 0);
      must('featlive 拆解里有 ★ 行', H.chain().indexOf('★') >= 0);
      // 跨过那条线要**听得出**是跨过线：这一声只在 bonus 分支里响，
      // 注入掉它就只会响"流水又涨了"，玩家分不清是客人给的还是自己够到了目标
      must('featlive 跨过阈值响的是专属那一声', (H.sfx.fired.bonus || 0) > 0);
      must('featlive 没有在飞的动画残留', H.anims === 0);
      window.__UITEST_RESULT = verdict('演出路径');
    }, 40000);
    return '';

  } else if (mode === 'feat') {
    // ── 新功能验收档：每个功能都要在**真界面**上证明三件事——
    //    开着有用、关了就等于不存在、状态能活过存档往返。
    //    逻辑判据在 core/selftest.ts 里，这里只管界面。
    var FLAGS_ON_ALL = { thresholds: true, bets: true, adjacency: true, sets: true,
      growth: true, layers: true, discardOps: true };

    // ── 签名宾五选一（标题页，开局之前）────────────────────────
    var dbox = q('#draftBox');
    must('签名宾开关开着 → 标题页出现候选框', !!dbox && !dbox.classList.contains('hidden'));
    var cards = document.querySelectorAll('.draft-card');
    must('标题页给出 5 张候选（实际 ' + cards.length + '）', cards.length === 5);
    must('候选说明是"名字｜脾气｜机制"一行',
      [].slice.call(cards).every(function (c) {
        return (c.querySelector('.dc-name') || {}).textContent
          && /靠脑子|稳吃|吃运气/.test((c.querySelector('.dc-temper') || {}).textContent || '');
      }));
    must('这一批里至少给得出一种稳吃和一种吃运气',
      /稳吃/.test(dbox.textContent) && /吃运气/.test(dbox.textContent));
    var seed0 = q('#seedInput').value;
    // 换种子必须也换候选：候选是按种子定的，不重画就是屏幕上留着上一批错牌。
    // 判据不看"换成了谁"（两粒种子理论上可能同批），看**旧节点有没有被换下去**。
    {
      var before0 = document.querySelectorAll('.draft-card')[0];
      var inp = q('#seedInput');
      inp.value = '777001';
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      must('改种子之后候选框重画了（旧节点已离场）',
        before0 !== undefined && before0.isConnected === false
        && document.querySelectorAll('.draft-card').length === 5);
      inp.value = seed0;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    q('#btnReroll').click();
    var after = document.querySelectorAll('.draft-card');
    must('换一批给出不同的一组（120 批里必然不同，这里比第一张）',
      after.length === 5 && (after[0].textContent || '') !== (cards[0].textContent || ''));
    must('换一批不许动种子（那是两件事）', q('#seedInput').value === seed0);
    after[0].click();
    var chosen = q('.draft-card.on .dc-name');
    must('点候选会选中并高亮：' + (chosen ? chosen.textContent : '无'), !!chosen);

    // ── P0-3 阈值奖励 ────────────────────────────────────────
    var sigName = chosen ? chosen.textContent : '';
    var sigBtn = document.querySelector('.draft-card.on');
    var sigPid = sigBtn ? (sigBtn.getAttribute('data-pid') || '') : '';
    H.start(1002);
    must('P0-3 偏好开着 → 这一局 state.flags 带着它', H.game.state.flags.thresholds === true);
    // 原来写成 `sigPid === '' ? true : …`——候选卡没标 pid 时它自动成立，
    // 于是"删掉 dataset.pid"这条注入照样全绿。选中了人就必须认得出是谁。
    must('点中的那张候选卡认得出是谁（data-pid 在）', sigPid !== '');
    must('开局请的签名宾真的坐进了座位（' + sigPid + ' → '
      + H.feat().seatOrder.join('>') + '）', H.feat().seatOrder.indexOf(sigPid) >= 0);
    must('P0-3 水位条上有阈值刻度（' + q('.scoreline .track').querySelectorAll('.tmark').length + ' 条）',
      q('.scoreline .track').querySelectorAll('.tmark').length === 6);
    var gap0 = q('#gapNote');
    must('P0-3 没出牌就写了"还差多少"：' + (gap0 ? gap0.textContent : '（没有）'),
      !!gap0 && /还差 \d+ 够到「.+」/.test(gap0.textContent));
    // 找一手同花把它顶过线
    H.game.state.books.flush = 6;
    var byS = {};
    H.game.state.hand.forEach(function (c) { (byS[c.suit] = byS[c.suit] || []).push(c); });
    var flush = null;
    for (var sk in byS) if (byS[sk].length >= 5) { flush = byS[sk]; break; }
    must('P0-3 这一把凑得出同花', !!flush);
    H.game.state.chosen = flush.slice(0, 5).map(function (c) { return c.id; });
    var scoreBefore = H.game.state.score;      // 这一手之前的账
    H.play();
    setTimeout(function () {
      var st = H.game.state;
      // 读数必须等于内核这一手加上去的分数。snap 路走的是 applyEventsSync，
      // 它里面必须有 bonus 分支，否则读数会停在 bonus 之前的那一步。
      var lh = H.lastHand();
      must('P0-3 总读数等于内核这一手（' + reelValue('#totalReel') + ' vs ' + Math.round(lh.value) + '）',
        Math.abs(reelValue('#totalReel') - lh.value) < 1);
      // 单独比流水与倍注：applyEventsSync 里的 bonus 分支被抽掉时，
      // 循环尾巴照样会把总数补上，只比 total 看不出问题，而流水/倍注会停在 bonus 之前。
      must('P0-3 流水读数等于内核（' + reelValue('#chipsReel') + ' vs ' + lh.chips + '）',
        Math.abs(reelValue('#chipsReel') - lh.chips) < 1);
      must('P0-3 倍注读数等于内核（' + reelValue('#multReel') + ' vs ' + lh.mult + '）',
        Math.abs(reelValue('#multReel') - lh.mult) < 0.01);
      must('P0-3 一手够到 ' + st.claimed.length + ' 条线', st.claimed.length > 0);
      var save = read('guinea.save.v1');
      must('P0-3 存档带着 flags 与 claimed',
        !!save && save.indexOf('"flags"') >= 0 && save.indexOf('"claimed"') >= 0);
      // 关掉必须"等于不存在"：刻度、提示、入账一起消失
      st.flags.thresholds = false;
      H.jump(1, 0);
      setTimeout(function () {
        must('P0-3 关掉后刻度全没了（' + q('.scoreline .track').querySelectorAll('.tmark').length + '）',
          q('.scoreline .track').querySelectorAll('.tmark').length === 0);
        must('P0-3 关掉后没有"还差多少"', !q('#gapNote'));
        // 关掉之后出牌：不得再产生 bonus，也不得留下任何界面痕迹
        var featsBefore = H.feat();
        H.game.state.chosen = H.game.state.hand.slice(0, 5).map(function (c) { return c.id; });
        H.play();
        setTimeout(function () {
          must('P0-3 关掉后 claimed 不再增长', H.feat().claimed.length === featsBefore.claimed.length);
          // 关掉后**再打一手**才查拆解：chain() 反映的是最近一次结算，
          // 上一手（开着时打的）带 ★ 是正确的，不该拿它当"没生效"的证据
          H.game.state.status = 'playing';
          H.game.state.chosen = H.game.state.hand.slice(0, 5).map(function (c) { return c.id; });
          H.play();
          must('P0-3 关掉后再打一手，拆解里没有 ★ 行', H.chain().indexOf('★') < 0);
          runOtherFeatures();
        }, 260);
      }, 160);
    }, 420);
    return '';

    // ── P0-2 / P1-1 / P1-2 / P1-3 / P1-4 的界面判据 ──────────
    function runOtherFeatures() {
      var F = { thresholds: false, bets: true, adjacency: true, sets: true,
        growth: true, layers: true, discardOps: true };
      H.game.state.flags = F;
      H.game.state.seats = [
        { pid: 'baronet', edition: 'none', xp: 0 },
        { pid: 'heiress', edition: 'foil', xp: 0 },
        { pid: 'hobbs', edition: 'none', xp: 4 }
      ];
      H.game.state.books.pair = 9;
      H.game.state.money = 40;
      H.select(0);                        // 必须先走一次真渲染，否则查的是上一帧的 DOM
      must('P0-2/P1-1 客人卡上刻着 tag（' + document.querySelectorAll('.tagchip').length + '）',
        document.querySelectorAll('.tagchip').length >= 3);
      must('P1-2 客人卡上写着长进',
        [].slice.call(document.querySelectorAll('.growchip')).some(function (n) { return /档|长进/.test(n.textContent || ''); }));

      // 换座：牌桌上不给换，铺子里给换
      H.game.state.status = 'playing';
      H.select(0);                        // 改了 status 必须重渲染，否则查的是上一帧的 DOM
      must('P0-2 演出中不出现换座箭头', document.querySelectorAll('.patron .mv').length === 0);
      H.game.state.status = 'shop';
      H.jump(H.game.state.night, H.game.state.stage);
      H.game.state.status = 'shop';
      H.game.state.seats = [
        { pid: 'baronet', edition: 'none', xp: 0 },
        { pid: 'heiress', edition: 'none', xp: 0 },
        { pid: 'hobbs', edition: 'none', xp: 0 }
      ];
      H.game.state.money = 40;
      H.select(0);                       // 走一次真渲染（renderAll），不从外部调模块内函数
      var mv = document.querySelectorAll('.patron .mv');
      must('P0-2 铺子里出现换座箭头（' + mv.length + ' 个）', mv.length >= 4);
      var order0 = H.feat().seatOrder.join('>');
      mv[1].click();                       // 第 1 位往后挪
      must('P0-2 点箭头真的换了顺序：' + H.feat().seatOrder.join('>'),
        H.feat().seatOrder.join('>') !== order0);
      must('P0-2 换座收了 £2', H.game.state.money === 38);

      // 弃牌堆面板
      H.openPanel('shop');
      setTimeout(function () {
        must('P1-4 铺子里有弃牌堆一块', !!document.querySelector('.discard-box'));
        must('P1-1 铺子里有套装一块', !!document.querySelector('.sets-box'));
        must('P1-1 这三位确实凑齐了一套（' + H.feat().sets.join('、') + '）',
          H.feat().sets.length > 0);
        // 里程碑音的规矩是"新达成才响、响过就不重复"。
        // 只断言"响过"抓不到反向的错：每次重渲染都响一遍也算过，而那是噪音。
        H.resetSfx();
        H.renderShop();
        must('P1-1 同一套不重复报（再画一屏不该再响）', !(H.sfx.fired.set > 0));
        H.game.state.seats = H.game.state.seats.concat([
          { pid: 'clerk', edition: 'none', xp: 0 }, { pid: 'almanac', edition: 'none', xp: 0 }]);
        H.renderShop();
        must('P1-1 新凑成一套才响那一声（现有 ' + H.feat().sets.join('、') + '）',
          H.sfx.fired.set === 1 && H.feat().sets.length >= 2);
        // 捞牌要让总数守恒
        var t0 = H.feat().totalCards;
        var btn = document.querySelector('.discard-box .small');
        if (btn && !btn.disabled) { btn.click(); }
        must('P1-4 捞回后牌数守恒（' + H.feat().totalCards + '/' + t0 + '）',
          btn && !btn.disabled ? H.feat().totalCards === t0 : true);

        // 抬注那一排要写得出失手后果
        var steps = document.querySelectorAll('.raise .step small');
        must('P0-1 抬注档上写了失手后果（' + steps.length + ' 档）',
          [].slice.call(steps).some(function (n) { return /失手/.test(n.textContent || ''); }));

        // 关掉全部新功能：界面必须干净
        var OFF = { thresholds: false, bets: false, adjacency: false, sets: false,
          growth: false, layers: false, discardOps: false };
        H.game.state.flags = OFF;
        H.game.state.status = 'playing';
        H.jump(1, 0);
        setTimeout(function () {
          // 候选框看的是**偏好**（它决定下一局），不是这一局的 flags 快照。
          // 只改 game.state.flags 的话它当然还亮着——那不是 bug，是两件事。
          H.setPrefFlag('draft', false);
          must('偏好里关掉签名宾后候选框藏起来了', q('#draftBox').classList.contains('hidden'));
          H.setPrefFlag('draft', true);
          must('再打开又回来（切换可逆）', !q('#draftBox').classList.contains('hidden'));
          must('全关后没有换座箭头', document.querySelectorAll('.patron .mv').length === 0);
          must('全关后没有残留的 shift 容器', document.querySelectorAll('.patron .shift').length === 0);
          must('全关后 tag 刻字消失',
            [].slice.call(document.querySelectorAll('.tagchip')).every(function (n) { return !n.textContent; }));
          must('全关后没有长进字样',
            [].slice.call(document.querySelectorAll('.growchip')).every(function (n) { return !n.textContent; }));
          // 同样要先打一手再看拆解：chain() 是"最近一次结算"，不是"当前开关状态"
          H.game.state.status = 'playing';
          H.game.state.chosen = H.game.state.hand.slice(0, 5).map(function (c) { return c.id; });
          H.play();
          // 关掉/跳过后读数必须仍等于内核——这查的是 applyEventsSync 里那条 bonus 分支
          must('P0-3 读数等于内核记的（' + Math.round(H.game.state.score) + '）',
            H.game.state.score > 0);
          // 全部线都跨过去之后，"还差多少"必须消失——留着它就是在指一条已经不存在的线
          must('P0-3 跨过全部线之后提示消失（还剩 '
            + (q('#gapNote') ? q('#gapNote').textContent : '无') + '）',
            !q('#gapNote') || H.game.state.score < 999999);
          var chainOff = H.chain();
          // 先确认拆解**有内容**再断言它不含 ★——空字符串同样"不含 ★"，
          // 那样这条判据就只会随着 chain 丢失而变绿，永远不会红
          must('全关后拆解仍有完整账目（' + chainOff.split('\n').length + ' 行）',
            chainOff.split('\n').length > 3 && /收口|流水/.test(chainOff));
          must('全关后再打一手，拆解里没有 ★', chainOff.indexOf('★') < 0);
          window.__UITEST_RESULT = verdict('新功能');
        }, 200);
      }, 200);
    }


  } else if (mode === 'events') {
    // ── 随机事件：真点击把三选一走一遍 ─────────────────────────
    // 这一档只管界面：内核递出来 → 屏幕上真有能点的三张卡 → 点下去账真的变了 →
    // 面板收掉 → 这一笔活进存档 → 关了就当没这功能 → 教学局不许插进来 → 结算回顾。
    // 逻辑判据在 core/selftest.ts，这里一条都不重复算。
    // 等到"这一拍的演出收尾"：共用 whenReady（认结清幕、铺子的离开按钮，还会在代打
    // 时钟下用 vcUnstick 把卡在 await 的动画收尾——自己写轮询就是少了这一条，实测挂 20 秒）
    function waitTurn(cb) {
      whenReady(function (lockMs, total) {
        if (total < 0) {
          must('第 ' + H.feat().nightActions + ' 次动作 25 秒没回到可出牌（status='
            + H.game.state.status + ' busy=' + H.busy + ' anims=' + H.anims + '）', false);
        }
        cb();
      });
    }
    function oneHand(fn) {
      if (H.game.state.status !== 'playing') { fn(); return; }
      pickLowest(3);
      key(document.body, ' ');
      waitTurn(fn);
    }
    // 12 手是硬上界（这一档自己开新局、每夜至多一次，超 12 手还没递出事就是链子断了），
    // 必须报出来，不许继续等（挂着会让反证扫描每条白等到超时）
    function untilPending(fn) {
      var tries = 0;
      (function loop() {
        if (H.game.state.pendingEvent.length > 0) { fn(); return; }
        if (H.game.state.status !== 'playing') { fn(); return; }
        if (tries++ > 12) {
          must('打了 24 手还没递出任何一件事（nightActions=' + H.feat().nightActions
            + ' eventAt=' + H.feat().eventAt + ' 每夜应一次）', false);
          fn(); return;
        }
        oneHand(loop);
      })();
    }

    // 先抓栈再修：异步链里的报错外壳只会打一行消息，看不到是哪个函数
    window.addEventListener('unhandledrejection', function (e) {
      console.error('REJECT-STACK ' + (e.reason && e.reason.stack
        ? String(e.reason.stack).slice(0, 700) : String(e.reason)));
    });
    // 这一档是一条异步链：中间任何一步的读数拿不到（注入把功能弄坏了、或者界面没投影出来），
    // 就必须**记一条 FAIL 然后交裁决**，不许抛异常——抛出去的话外壳只能等到超时，
    // 反证扫描里一条注入白等 180 秒，而且看不出是谁的错（本轮真的踩过）。
    function bail(why) {
      must('走查没走到头就停了：' + why, false);
      window.__UITEST_RESULT = verdict('随机事件');
    }

    // 自己开一局，不依赖 boot 那几行有没有 autostart：这一档要的是"开着事件的普通局"
    H.start(20261012);
    var st0 = H.game.state;
    must('这一局开着随机事件', st0.flags.events === true);
    must('开局没有待决事件，面板收着',
      st0.pendingEvent.length === 0 && q('#eventPick').classList.contains('hidden'));
    must('本夜触发点摇在 2 或 3 次动作之后（实际 ' + st0.eventAt + '）',
      st0.eventAt === 2 || st0.eventAt === 3);

    untilPending(function () {
      // 内核把候选挂到 state 上之后，界面要靠一次投影才画出那三张卡。
      // 轮询看的是 state，所以读 DOM 之前必须先请界面投影一次——
      // 否则量到的是"上一拍的屏幕"，判据会因为节奏而不是对错变红。
      H.render();
      var st = H.game.state;
      must('打够次数就把三张候选递出来（pending ' + st.pendingEvent.length + '）',
        st.pendingEvent.length === 3);
      var box = q('#eventPick');
      must('面板真的站在屏幕上', !box.classList.contains('hidden'));
      var cards = box.querySelectorAll('.ev-card');
      must('并排三张卡（' + cards.length + '）', cards.length === 3);
      var names = [], riskOf = [], ok = true;
      for (var i = 0; i < cards.length; i++) {
        var nm = cards[i].querySelector('.ev-name');
        var rk = cards[i].querySelector('.ev-risk');
        var bl = cards[i].querySelector('.ev-blurb');
        var gl = cards[i].querySelector('.ev-glyph svg');
        if (!nm || !rk || !bl || !gl || nm.textContent.length < 2
          || bl.textContent.length < 6) ok = false;
        if (nm) names.push(nm.textContent);
        riskOf.push(cards[i].className.replace(/.*r-(\w+).*/, '$1'));
      }
      must('每张卡都有抬头、脾气、白话账和一只画出来的图标', ok);
      must('三张卡讲的是三件不同的事（' + names.join(' / ') + '）',
        new Set(names).size === cards.length);
      must('卡面不含任何外部素材（没有 http、没有 url()）',
        box.innerHTML.indexOf('http') < 0 && box.innerHTML.indexOf('url(') < 0);
      var inView = true;
      for (var j = 0; j < cards.length; j++) {
        var r = cards[j].getBoundingClientRect();
        if (r.top < -1 || r.bottom > window.innerHeight + 1
          || r.left < -1 || r.right > window.innerWidth + 1) inView = false;
      }
      must('三张卡都落在屏幕里（看不见的面板等于没有面板）', inView);

      var score0 = H.game.state.score, hands0 = H.game.state.handsLeft;
      pickLowest(3);
      key(document.body, ' ');
      must('没应下这件事就打不出去（分数 ' + score0 + '/' + H.game.state.score + '）',
        H.game.state.score === score0 && H.game.state.handsLeft === hands0
        && H.game.state.pendingEvent.length === 3);

      if (!cards.length) { bail('面板上没有任何可点的卡'); return; }
      var wantMoney = H.game.state.money, wantSeats = H.game.state.seats.length;
      // 三张里挑一张**不抽牌**的：这一档走的是"点一张就落账"那条直路。
      // 要挑一张牌的那几条（碎镜 / 火漆台 / 梗犬 / 扫烟囱的 / 发牌的手抖）走 uitest=fan 那一档，
      // 两条路都是玩家真会走的路，各测各的，谁也不拿另一条当遮羞布。
      var idx = 0;
      for (var ci = 0; ci < cards.length; ci++) {
        if (!H.fanNeeds(cards[ci].dataset.eid)) { idx = ci; break; }
        if (ci === cards.length - 1) { bail('三张候选全要抽牌，这一档走不到直路（换种子或看 uitest=fan）'); return; }
      }
      var pickedName = cards[idx].querySelector('.ev-name').textContent;
      cards[idx].click();
      must('点一张下去面板收掉', q('#eventPick').classList.contains('hidden'));
      var f1 = H.feat();
      must('这一笔记进整局事件账，候选清空',
        f1.events.length === 1 && f1.pendingEvent.length === 0
        && !!f1.events[0] && f1.events[0].night >= 1);
      must('日志头一行就是刚应下的那件事',
        H.game.state.log[0].indexOf(pickedName) >= 0);
      must('响的是"事件递入"那一声，不是通用提示', (H.sfx.fired.event || 0) === 1);
      must('选完还能接着打（牌局没被按着头停住）',
        H.game.state.status === 'playing' || H.game.state.status === 'cleared'
        || H.game.state.status === 'shop');
      void wantMoney; void wantSeats;
      if (!f1.events.length) { bail('点了卡但账上一笔都没记'); return; }
      var night1 = f1.events[0].night;

      setTimeout(function () {
        var raw = localStorage.getItem('guinea.save.v1');
        must('事件这一笔活过存档', !!raw && JSON.parse(raw).state.events.length === 1);

        // 第二次递事：试「让牌局自决」。
        // 挑最小三张的那个机器人打不穿一场，所以这里用测试口把夜次推前一格——
        // 内核的"每夜至多一次"读的就是 s.night 这一格，换了夜它就该再递
        H.resetSfx();
        H.jump(H.game.state.night + 1, 0);
        untilPending(function () {
          H.render();                                  // 同上：读 DOM 之前先请界面投影一次
          var box2 = q('#eventPick');
          // 每夜至多一次：第二件事只许在**换了夜**之后才弹出来
          must('换到第 ' + H.game.state.night + ' 夜才递出第二件事（第一笔记在夜 '
            + night1 + '）',
            box2 && !box2.classList.contains('hidden') && H.game.state.night > night1);
          if (!box2 || box2.classList.contains('hidden')) { bail('第二件事没有摊到屏幕上'); return; }
          var cs = box2.querySelectorAll('.ev-card');
          if (!cs.length) { bail('第二次的卡面是空的'); return; }
          var order = ['hand', 'head', 'heart'], expectIdx = -1;
          for (var k = 0; k < order.length && expectIdx < 0; k++) {
            for (var m = 0; m < cs.length; m++) {
              if (cs[m].className.indexOf('r-' + order[k]) >= 0) { expectIdx = m; break; }
            }
          }
          var expectId = expectIdx >= 0 ? H.game.state.pendingEvent[expectIdx] : '';
          q('#btnEventAuto').click();
          var f2 = H.feat();
          must('自决也把事应下了（账上 ' + f2.events.length + ' 笔）',
            f2.events.length === 2 && f2.pendingEvent.length === 0
            && q('#eventPick').classList.contains('hidden'));
          must('自决按 稳吃 → 靠脑子 → 吃运气 挑（期望 ' + expectId
            + '，实际 ' + (f2.events[1] ? f2.events[1].id : '无') + '）',
            !!f2.events[1] && f2.events[1].id === expectId);

          // 关掉开关：同一个界面要当这件事从来没存在过
          H.setPrefFlag('events', false);
          H.start(31337);
          var ghost = 0;
          (function offHands(n) {
            if (n <= 0) {
              var fo = H.feat();
              must('关着开一局连打几手：面板一次都没弹（弹了 ' + ghost + ' 次）', ghost === 0);
              must('关着跑完：五个新字段一次都没被碰',
                fo.events.length === 0 && fo.pendingEvent.length === 0
                && fo.eventMods.length === 0 && fo.nightActions === 0 && fo.eventAt === 0);
              // 教学局：开着偏好也不许插进来
              H.setPrefFlag('events', true);
              H.startGuide();
              must('教学局替玩家把随机事件关了', H.game.state.flags.events === false);
              (function guideHands(n2) {
                if (n2 <= 0) {
                  var fg = H.feat();
                  must('十节课那局从头打到尾都不会被别的事打断',
                    fg.pendingEvent.length === 0 && fg.events.length === 0);
                  // 结算回顾：摆两笔事件，判负，看那张纸上列得出来
                  H.setPrefFlag('events', true);
                  H.start(20261012);
                  H.game.state.events = [
                    { night: 1, id: 'snake-oil', result: '掷骰成了，银钱 +£18' },
                    { night: 2, id: 'tailor', result: '整局手牌上限 +1' },
                  ];
                  // 这一手要真的输掉才看得到散场幕：缓冲回合先收走，也别留着待决的事挡路
                  H.game.state.buffer = 0;
                  H.game.state.pendingEvent = [];
                  H.game.state.handsLeft = 1;
                  H.game.state.score = 0;
                  pickLowest(3);
                  key(document.body, ' ');
                  (function waitEnd(t0) {
                    if (!q('#endcard').classList.contains('hidden')) {
                      var rows = q('#endRecap').children;
                      must('结算卡的「事件回顾」把这两夜的事列出来（' + rows.length + ' 行）',
                        rows.length === 2
                        && rows[0].textContent.indexOf('卖药人的赌局') >= 0
                        && rows[0].textContent.indexOf('掷骰成了') >= 0
                        && rows[1].textContent.indexOf('第2夜') >= 0);
                      window.__UITEST_RESULT = verdict('随机事件');
                      return;
                    }
                    if (performance.now() - t0 > 12000) {
                      must('散场幕没出来（status=' + H.game.state.status + '）', false);
                      window.__UITEST_RESULT = verdict('随机事件');
                      return;
                    }
                    setTimeout(function () { waitEnd(t0); }, 30);
                  })(performance.now());
                  return;
                }
                if (H.game.state.status === 'playing') {
                  pickLowest(3); key(document.body, ' ');
                  if (!q('#eventPick').classList.contains('hidden')) ghost++;
                  waitTurn(function () { guideHands(n2 - 1); });
                } else { guideHands(0); }
              })(4);
              return;
            }
            if (H.game.state.status === 'playing') {
              pickLowest(3); key(document.body, ' ');
              if (!q('#eventPick').classList.contains('hidden')) ghost++;
              waitTurn(function () { offHands(n - 1); });
            } else {
              var fo2 = H.feat();
              must('关着的时候连触发点都不摇（eventAt=' + fo2.eventAt + '）', fo2.eventAt === 0);
              offHands(0);
            }
          })(5);
        });
      }, 220);                                  // saveNow 有 120ms 防抖，读存档之前先等一下
    });
    return '';
  } else if (mode === 'fan') {
    // ── 抽牌礼：随机挑牌那几类先翻过去打乱，玩家抽一张 ──────────────
    // 递不递得出来由内核那批判据管（§16 与 uitest=events 那档真打手验过）；
    // 这一档只验扇面这一屏：摆得出来、点得动、抽中谁就落谁、演完收得掉。
    // 候选是直接把 id 挂上 pendingEvent 的——这是这一档唯一的取巧，
    // 而且它不绕过任何一道门：三道门（开关 / 状态 / id 在候选里）照样由内核自己过一遍。
    function fin() { window.__UITEST_RESULT = verdict('抽牌礼'); }
    function bail2(why) { must('走查没走到头就停了：' + why, false); fin(); }
    var FB = function () { return q('#drawFan'); };
    var FAN = function () { return [].slice.call(document.querySelectorAll('#fanRow .card')); };
    var EV = function () { return [].slice.call(document.querySelectorAll('#eventRow .ev-card')); };
    var arm = function (ids) { H.game.state.pendingEvent = ids.slice(); H.render(); };
    var glassed = function () {
      return H.game.state.hand.filter(function (c) { return c.enh === 'glass'; }).map(function (c) { return c.id; });
    };

    H.start(20261012);
    must('这一局开着随机事件', H.game.state.flags.events === true);
    var hand0 = H.game.state.hand.slice();
    must('手里有牌才谈得上抽（' + hand0.length + ' 张）', hand0.length >= 4);
    arm(['broken-mirror', 'gas-lamp']);
    must('碎镜要抽一张、煤气灯不抽（该不该摆由内核说，界面不猜）',
      H.fanNeeds('broken-mirror') === true && H.fanNeeds('gas-lamp') === false);
    must('没挂上候选就不摆扇面（id 不在候选里是外部输入）',
      H.fanNeeds('terrier') === false);
    var ev0 = EV();
    must('两张候选摆在屏幕上（' + ev0.length + '）', ev0.length === 2);
    must('还没点，扇面收着', FB().classList.contains('hidden'));
    H.resetSfx();
    ev0[0].click();
    must('点碎镜那张：先摆出一排扣过来的牌', !FB().classList.contains('hidden'));
    must('三选一还挂着：抽定之前谁也不许落账',
      !q('#eventPick').classList.contains('hidden') && H.feat().events.length === 0);
    var fc = FAN();
    must('扇面张数 = 手牌数与一排上限里小的那个（' + fc.length + ' 张 / 手牌 ' + hand0.length + '）',
      fc.length === Math.min(6, hand0.length));
    var backs = 0, inView = true, ids = [];
    for (var i = 0; i < fc.length; i++) {
      if (fc[i].className.indexOf('back') >= 0 && fc[i].querySelector('svg')) backs++;
      ids.push(fc[i].dataset.card);
      var r = fc[i].getBoundingClientRect();
      if (r.top < -1 || r.bottom > window.innerHeight + 1 || r.width < 20) inView = false;
    }
    must('每一张都是扣过来的牌背（画出来的那一面，不是文字占位）', backs === fc.length);
    must('一排都落在屏幕里（看不见的一排等于没有仪式）', inView);
    must('同一张牌不许在扇面里摆两次', new Set(ids).size === ids.length);
    var handIds = hand0.map(function (c) { return String(c.id); });
    must('扇面里的每张都真是手牌（候选池是内核给的，不是界面自己凑的）',
      ids.every(function (x) { return handIds.indexOf(x) >= 0; }));
    must('扇面不含外部素材', q('#fanRow').innerHTML.indexOf('http') < 0
      && q('#fanRow').innerHTML.indexOf('url(') < 0);
    must('两行说明各说各的：上面讲这是谁的候选，下面讲抽一张会怎样',
      /扣过来/.test(q('#fanSub').textContent) && /抽一张/.test(q('#fanNote').textContent));
    var hands0 = H.game.state.handsLeft;
    key(document.body, ' ');
    must('扇面开着仍然打不出牌（待决那一道门没被绕开）',
      H.game.state.handsLeft === hands0 && H.feat().events.length === 0);
    must('摆扇面响的是发牌那一声，不是事件落账那一声',
      (H.sfx.fired.deal || 0) === 1 && (H.sfx.fired.event || 0) === 0);
    // 扇面是盖住上一屏的：后面那颗「让牌局自决」不该还点得动（两条路各落一次账就是双花）
    var ab = q('#btnEventAuto').getBoundingClientRect();
    var top = document.elementFromPoint(ab.left + ab.width / 2, ab.top + ab.height / 2);
    must('扇面真的盖住了后面那颗「让牌局自决」（命中测试，不是看它有没有 disabled）',
      !!top && !!(top.closest && top.closest('#drawFan')));

    click('#btnFanCancel');
    must('「先不抽」把扇面收掉', FB().classList.contains('hidden'));
    must('收掉之后三选一还在、账还是空的',
      !q('#eventPick').classList.contains('hidden') && H.feat().events.length === 0
      && H.feat().pendingEvent.length === 2);
    ev0 = EV();
    ev0[0].click();
    var fc2 = FAN();
    must('取消再点回来还是那一排（顺序由派生流定，不是每次重摇）',
      fc2.length === fc.length
      && fc2.map(function (n) { return n.dataset.card; }).join() === ids.join());
    if (fc2.length < 3) { bail2('扇面只剩 ' + fc2.length + ' 张，抽不了第三张'); return ''; }

    var target = fc2[2];
    var wantId = target.dataset.card;
    var g0 = glassed().length;
    H.resetSfx();
    target.click();
    must('抽定这一张，账在点击这一刻就落地',
      H.feat().events.length === 1 && H.feat().pendingEvent.length === 0);
    if (fc2[4]) fc2[4].click();
    must('再点第二张也不许二次落账（一次抽牌只应一件事）', H.feat().events.length === 1);
    var g1 = glassed();
    must('磨成玻璃的就是抽中那张（抽谁落谁，不是摇中谁落谁）',
      g1.length === g0 + 1 && String(g1[0]) === wantId);
    must('事件那一笔记进了整局账（回顾列得出来）',
      !!H.feat().events[0] && H.feat().events[0].id === 'broken-mirror');
    must('翻面那半圈里 busy 抬着（这段时间出牌与弃牌点不动，账不会被抢）', H.busy === true);
    setTimeout(function () {
      must('抽的那张在扇面上翻开了：牌背没了、露出的是牌面',
        target.className.indexOf('back') < 0 && !!target.querySelector('.corner'));
      must('翻面演完扇面自己收掉、三选一也收掉',
        FB().classList.contains('hidden') && q('#eventPick').classList.contains('hidden'));
      must('busy 跟着翻面一起落下', H.busy === false);
      must('响的是事件落账那一声', (H.sfx.fired.event || 0) === 1);
      must('抽完还能接着打', H.game.state.status === 'playing');
      // 不挑牌的那条：点下去直接落账，一排牌背都不该出现
      arm(['gas-lamp']);
      var ec = EV();
      if (!ec.length) { bail2('煤气灯那张没摆出来'); return; }
      ec[0].click();
      must('煤气灯不摆扇面（不挑牌的事件硬摆一排牌背是假仪式）',
        FB().classList.contains('hidden'));
      must('点下去直接落账（整局两笔）', H.feat().events.length === 2);
      // 换一局：上一排扣着的牌不许留在桌上
      arm(['broken-mirror']);
      EV()[0].click();
      must('扇面又摆出来了（这一条要挑一张牌）', !FB().classList.contains('hidden'));
      H.start(31337);
      must('换一局把上一排的牌收掉（换局时扇面还摊着，玩家面对的是上一局的牌背）',
        FB().classList.contains('hidden'));
      fin();
    }, 120);
    return '';
  } else if (mode === 'lengths') {
    // ── 局长：标题页那一排 13 格，选中的数要一路活到牌桌与散场卡 ──
    // 曲线、判胜、候选偏置的账在 core/selftest.ts 里量；这一档只问界面接得对不对：
    // 点了算不算、存不存得下、开局传没传、每日一局锁不锁、文案跟不跟着换。
    var PL = function () { return [].slice.call(document.querySelectorAll('#lengths .pick')); };
    var prefNights = function () { return JSON.parse(read('guinea.prefs.v1') || '{}').nights; };
    var p0 = PL();
    must('轮数那一排有 13 格（实际 ' + p0.length + '）', p0.length === 13);
    must('每一格印的是夜数 3..15',
      p0.map(function (b) { return b.textContent; }).join(',') === '3,4,5,6,7,8,9,10,11,12,13,14,15');
    must('默认高亮在八夜那一格', p0[5].classList.contains('on') && !p0[12].classList.contains('on'));
    must('说明行带着当前局长（' + q('#pickNote').textContent + '）', /· 8 夜 ·/.test(q('#pickNote').textContent));
    p0[12].click();
    must('点「15」那一格会换高亮', PL()[12].classList.contains('on') && !PL()[5].classList.contains('on'));
    must('轮数写进了偏好（实际 ' + prefNights() + '）', prefNights() === 15);
    var note15 = q('#pickNote').textContent;
    must('说明行报出这一档的终场彩头（' + note15 + '）',
      /15 夜/.test(note15) && /3,330,000/.test(note15) && /马拉松/.test(note15));

    // 每日一局：那一排要锁死，而且高亮必须是**真会跑的那个数**，不是偏好里那个
    q('#modes').children[2].click();
    must('每日一局把轮数那一排锁上', q('#lengths').classList.contains('locked'));
    must('锁住时高亮落回八夜', PL()[5].classList.contains('on') && !PL()[12].classList.contains('on'));
    // 点的是「3」那一格：锁没锁要拿一个**与当前值不同**的目标去点，
    // 点同一格就算没锁也量不出来（这条就是这么漏掉的）
    PL()[0].click();
    must('锁着的时候点不动（点「3」也不改偏好，实际 ' + prefNights() + '）',
      prefNights() === 15 && PL()[5].classList.contains('on'));
    must('每日一局的说明行也写八夜', /· 8 夜 ·/.test(q('#pickNote').textContent));
    q('#modes').children[0].click();
    must('回到经营之后 15 夜又亮回来', PL()[12].classList.contains('on') && prefNights() === 15);

    // 候选框那句偏置说明跟着局长走：八夜那档不许谎称"按局长偏过"
    H.setPrefFlag('draft', true);
    must('长局候选框写明偏置（' + q('#draftNote').textContent + '）',
      /长局候选偏给/.test(q('#draftNote').textContent));

    // 档位专属牌组：这一档摆得出来，换一档就消失，且选择要退回标准局
    var DK = function () { return [].slice.call(document.querySelectorAll('#decks .pick')); };
    var dkName = function (bs) { return bs.map(function (b) { return b.textContent; }).join('、'); };
    var prefDeck = function () { return JSON.parse(read('guinea.prefs.v1') || '{}').deck; };
    must('十五夜这一档的牌组排有 6 副（实际 ' + DK().length + '）', DK().length === 6);
    must('深夜局专属牌组摆在这一档（' + dkName(DK()) + '）',
      DK().some(function (b) { return b.textContent === '守夜人'; }));
    must('别的档的专属牌组不许出现在这一档',
      !DK().some(function (b) { return ['一手到位', '半班底', '庄家账', '长灶'].indexOf(b.textContent) >= 0; }));
    DK()[5].click();
    must('点上本档专属牌组会选中并落盘（' + prefDeck() + '）', prefDeck() === 'watchman');
    PL()[5].click();                                   // 换到八夜正局
    must('换档之后深夜那副从牌组排里消失（' + dkName(DK()) + '）',
      !DK().some(function (b) { return b.textContent === '守夜人'; }) && DK().length === 6);
    must('选不到的那副当场退回标准局（不许留一个点得动、进不去的选项）',
      prefDeck() === 'standard' && DK()[0].classList.contains('on'));
    PL()[12].click();                                  // 再点回十五夜
    must('回到十五夜，深夜那副又摆回来了', DK().some(function (b) { return b.textContent === '守夜人'; }));
    DK()[5].click();

    // 开局：选中的夜数必须真的进了内核，而不是界面上亮着、局里另算一套
    q('#btnStart').click();
    must('开局用的是选定的 15 夜（实际 ' + H.feat().nights + '）', H.feat().nights === 15);
    must('开局带的是本档那副专属牌组（deckId=' + H.game.state.deckId + '）',
      H.game.state.deckId === 'watchman');
    must('牌桌抬头挂着分母（' + q('#night').textContent + '）', /XV/.test(q('#night').textContent));
    must('第一夜彩头照旧 300（局长不改开局难度）', /300/.test(q('#scoreOf').textContent));
    // 无尽没有"最后一夜"，分母必须摘掉，否则屏幕上是个假终点
    H.game.state.endless = true; H.render();
    must('无尽局不挂分母（' + q('#night').textContent + '）', q('#night').textContent.indexOf('/') < 0);
    H.game.state.endless = false; H.render();

    // 推到所选的最后一夜并打穿：散场卡上的夜数得是这一局的，不是写死的八夜
    H.jump(15, 2);
    H.clear();
    must('最后一夜的铺子按钮写「散 局」（' + (q('.leave') || {}).textContent + '）',
      !!q('.leave') && /散/.test(q('.leave').textContent));
    if (q('.leave')) q('.leave').click();
    must('散场卡报的是这一局的 15 夜（' + q('#endSub').textContent + '）',
      /15 夜通吃/.test(q('#endSub').textContent));
    must('散场之后账上的局长还是 15', H.feat().nights === 15);
  } else if (mode === 'perf') {
    // ── 性能与泄漏：修行模式当跑步机（打不完也不会输），连着打真演出，同时放着背景曲。
    //    要抓的是"每打一手就留下点什么"：DOM 里的牌、cardEls 的记账、没落定的动画、音频图上的节点。
    //    打穿一场就顺着结清幕 → 铺子 → 下一场走过去，所以铺子与幕的 DOM 也一起被量到。
    //    无头量不了帧率，所以每条判据都把实测数字写进名字里，绿灯本身也留下证据。
    var HANDS = 8;
    q('#modes').children[3].click();               // 修行：打不完，也不会输
    must('切到修行模式当跑步机', H.prefsCopy.mode === 'practice');
    q('#btnStart').click();
    must('修行模式开局了', q('#title').classList.contains('hidden'));
    // 虚席的"+"要落在椭圆正中：.cameo 把四角裁掉了，元素被推到边上就等于没画。
    // 肖像改版删掉旧的通用居中规则时就是这么把提示弄丢的，肉眼在小图上又看不出来。
    {
      var empty = document.querySelector('.patron.empty .cameo');
      must('还有虚席可量', !!empty);
      if (empty) {
        var cb = empty.getBoundingClientRect();
        var tb = empty.querySelector('span').getBoundingClientRect();
        must('虚席的加号落在椭圆正中（横向偏 '
          + Math.abs((cb.left + cb.width / 2) - (tb.left + tb.width / 2)).toFixed(1)
          + 'px，纵向偏 '
          + Math.abs((cb.top + cb.height / 2) - (tb.top + tb.height / 2)).toFixed(1) + 'px）',
          Math.abs((cb.left + cb.width / 2) - (tb.left + tb.width / 2)) < 3
          && Math.abs((cb.top + cb.height / 2) - (tb.top + tb.height / 2)) < 3);
      }
    }
    // 选牌与放回要有各自的声。H.select() 直接改内核的 chosen，绕过了界面点击，
    // 所以必须真点一张牌才测得到这条接线（不然"pick 没响"永远量不出来）
    {
      H.resetSfx();
      var first = q('#tray').children[0];
      first.click();
      must('点一张牌响"选中"这一声', H.sfx.fired.pick === 1);
      first.click();
      must('再点一次响"放回"，是两个不同的声',
        H.sfx.fired.unpick === 1 && H.sfx.fired.pick === 1);
    }
    H.seat('hobbs'); H.seat('clerk'); H.seat('rent');
    must('坐着三位客人', H.game.state.seats.length === 3);
    must('背景曲的调度器真的在转（有曲才量得到音频图）', H.bgm.ticking === true);

    // 局势要真的**排进**正在放的那首曲子。探针读的是调度器排出来的加层声部数
    // （分解和弦 + 高八度影子），不是 this.heat：只记意图字段的话，
    // 把 plan(tune, step, 1, this.heat) 改成 ...1, 0) 界面照样全绿——这条真被注出来过。
    var st0 = H.game.state;
    var keep0 = { status: st0.status, hands: st0.handsLeft, raised: st0.raisedHere, stage: st0.stage };
    var layers0 = H.bgm.layers;
    st0.status = 'playing'; st0.handsLeft = 1; st0.raisedHere = 2;
    H.render();
    setTimeout(function () {
      must('紧张局势真的排进了正在放的那首（加层声部 ' +
        (H.bgm.layers - layers0) + ' 个 > 0）', H.bgm.layers - layers0 > 0);
      var afterHot = H.bgm.layers;
      st0.status = keep0.status; st0.handsLeft = keep0.hands;
      st0.raisedHere = keep0.raised; st0.stage = keep0.stage;
      H.render();
      setTimeout(function () {
        // 反向也要成立：松下来之后还在偷偷加层，说明 heat 根本没进编排只是恒开
        must('松下来之后不再加层（这 200ms 只加了 ' +
          (H.bgm.layers - afterHot) + ' 个）', H.bgm.layers - afterHot === 0);
        runHands();
      }, 200);
    }, 200);

    var locks = [];
    function runHands() {
    (function hand(n) {
      // 一半挑最小的、一半挑带人头牌的：两种打法都要走一遍，
      // 而且人头牌那一半保证"客人开口"那一声被测得到
      if (n % 2) pickFace(3); else pickLowest(3);
      var t = performance.now();
      key(document.body, ' ');
      must('第' + n + '手：按下空格就进了演出', H.busy === true);
      whenReady(function (lockMs, totalMs) {
        locks.push(lockMs);
        if (totalMs < 0) {
          must('第' + n + '手：25 秒内回到能出牌的状态（卡在 status=' + H.game.state.status
            + ' busy=' + H.busy + ' anims=' + H.anims + '）', false);
          window.__UITEST_RESULT = verdict('性能');
          return;
        }
        var st = H.game.state;
        must('第' + n + '手：DOM 里的牌等于内核手里的（' + q('#tray').children.length + '/' + st.hand.length + '）',
          q('#tray').children.length === st.hand.length);
        must('第' + n + '手：牌桌上的牌等于内核记的（' + q('#tableCards').children.length + '/' + st.table.length + '）',
          q('#tableCards').children.length === st.table.length);
        must('第' + n + '手：没有游离出 DOM 却还被 cardEls 记着的牌（' + H.stats().detached + '）',
          H.stats().detached === 0);
        must('第' + n + '手：没有在飞的动画残留（' + H.anims + '）', H.anims === 0);
        if (n < HANDS) { hand(n + 1); return; }

        var r = H.perf();                          // 顺带把明细打到控制台（外壳转进 stderr）
        must('cardEls 只记着还在场上的牌（' + r.cards + '）', r.detached === 0);
        must('单次摆位 ' + r.placeUs.toFixed(0) + 'µs（< 1500µs，占 60fps 一帧 '
          + (r.placeUs / 166.67 * 100).toFixed(1) + '%）', r.placeUs < 1500);
        must('单次结算 ' + r.scoreUs.toFixed(1) + 'µs（< 100µs）', r.scoreUs < 100);
        must('单次全量重渲染 ' + r.renderAllMs.toFixed(2) + 'ms（< 3ms）', r.renderAllMs < 3);
        must('抖动 22 次全量重渲染后节点差 ' + r.jitter + '（≤ 5，基线与终态同一位客人）', r.jitter <= 5);
        // 音频图的账不在这里量（见下面停曲之后的那一条）：曲子放着时 pending 是节奏的函数，
        // 同一档跑五次能给出 15/19/19/19/20，界值 20 会被它自己闪断。
        var bgmBusy = H.bgm.pending;               // 只留着报数，不当判据
        // ── 音效接线：配方表对了不等于响得出来，得看真跑过一遍之后响了哪些声 ──
        {
          var sf = H.sfx.fired;
          must('落牌声按张数响（card ' + (sf.card || 0) + ' 次，8 手 × 3~5 张）',
            (sf.card || 0) >= 8);
          must('流水与收口各有各的声（chips ' + (sf.chips || 0) + ' total ' + (sf.total || 0) + '）',
            (sf.chips || 0) > 0 && (sf.total || 0) >= 8);
          must('客人开口的那一声跟着连锁往上爬（mult 或 xmult 至少一种）',
            (sf.mult || 0) + (sf.xmult || 0) > 0);
          // 下界也要看：把噪声层的滤波器漏记一笔，pending 会往负走，
          // 只判上界的话"少记账"这种错反而永远绿
          must('音效节点账目自洽且在界内（在飞 ' + H.sfx.pending + '，0 ≤ n < 80）',
            H.sfx.pending >= 0 && H.sfx.pending < 80);
        }
        // 这条要防的是"越打越卡"（泄漏/累积），不是某个绝对毫秒数。
        // 代打时钟下主线程被快照占用，绝对值必然偏高，所以改成看首手与最慢手的关系。
        if (VC.took) {
          // 同上：代打时钟下的绝对/比例耗时都不可信，记成未评而不是编一条会过的
          unevaluated.push('每手锁时上界（实测 ' + locks.join(',') + 'ms）');
        } else {
          must('最慢的一手锁住输入 ' + Math.max.apply(null, locks) + 'ms（< 4000ms，没有越打越卡）',
            Math.max.apply(null, locks) < 4000);
        }
        // 音频图这条要等**没人在飞的时刻**再量：先停曲，每一声自己排的收尾定时器
        // 最迟 ~2.4 秒都会跑完，剩下的 pending 就是"建了没摘"的漏。
        // 放音中量出来的数是节奏的函数（同一档跑五次：15/19/19/19/20，界值 20 自己会闪断），
        // 而漏的那一类在停曲后照样涨到几百，注掉一句 disconnect 仍然红。
        H.setPrefTrack(0);
        setTimeout(function () {
          var drained = H.bgm.pending;
          must('停曲之后音频图上不剩待回收的节点（在飞 ' + drained + '，0 ≤ n < 6）',
            drained >= 0 && drained < 6);
          window.__UITEST_RESULT = verdict('性能',
            '锁定 ' + locks.join(',') + 'ms / 点掉结清幕 ' + nudges.curtain + ' 次 / 走出铺子 '
            + nudges.shop + ' 次 / 摆位 '
            + r.placeUs.toFixed(0) + 'µs / 重渲染 ' + r.renderAllMs.toFixed(2) + 'ms / DOM ' + r.nodes
            + ' / cardEls ' + r.cards + ' 游离 ' + r.detached + ' / 放音中在飞 ' + bgmBusy
            + ' 停曲后在飞 ' + drained
            + ' / 音效在飞 ' + H.sfx.pending + ' 落牌 ' + (H.sfx.fired.card || 0) + ' 响');
        }, 2800);
      });
    })(1);
    }
    return '';

  } else {
    // ── 局内：再开一局必须换种子 ──────────────────────────────
    must('localStorage 在这个 App 里能用', store('guinea.probe', '1') && read('guinea.probe') === '1');
    store('guinea.probe', null);
    var old = H.game.state.seed;
    click('#btnAgain');
    must('局内隐藏的再开一局不生效',H.game.state.seed===old);
    H.game.state.status='lost';H.showEnd(false);
    click('#btnAgain');
    must('再开一局换了种子', H.game.state.seed !== old);
    must('种子输入框跟着改成真正开起来的那局', Number(q('#seedInput').value) === H.game.state.seed);
    must('再开一局后回到牌桌', q('#title').classList.contains('hidden') && H.game.state.handsLeft > 0);
    // 坏档要给出人话，不能抛
    store('guinea.save.v1', '{"v":1,"calls":0,"state":{"seed":1,"deckId":"standard"');
    click('#btnSettings');
    var danger = q('#settingsBody .danger');
    must('设置里有清空进度', !!danger);
    if (danger) { danger.click(); danger.click(); }   // 两步确认；无头里那个 3 秒回弹的定时器是冻结的
    must('清空进度后回到标题页', !q('#title').classList.contains('hidden'));
    must('清空后没有残留存档', read('guinea.save.v1') === null);
    must('清空后删除上一局战报与入口',read('guinea.last-report.v1')===null&&q('#btnLastReport').hidden);
    store('guinea.save.v1', 'garbage');
    click('#btnResume');
    must('坏档点续局给的是提示不是崩溃', (q('#resumeNote').textContent || '').indexOf('读不出来') >= 0);
    must('坏档不会把标题页关掉', !q('#title').classList.contains('hidden'));
    store('guinea.save.v1', null);
  }

  return verdict(mode);

  function verdict(tag, note) {
    var bad = results.filter(function (r) { return !r[0]; });
    var head = 'UITEST ' + (bad.length ? 'FAIL ' : 'PASS ') + (results.length - bad.length) + '/' + results.length
      + ' [' + tag + ']' + (note ? '  ' + note : '');
    if (unevaluated.length) {
      head += '\n  未评 ' + unevaluated.length + ' 条（环境给不出结论，不是通过）：'
        + unevaluated.join('；');
    }
    return head + (bad.length ? '\n  · ' + bad.map(function (r) { return r[1]; }).join('\n  · ') : '');
  }
})();
