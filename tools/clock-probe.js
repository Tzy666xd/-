(function () {
  // 动画时钟探针：**实测**一根 150ms 的 WAAPI 动画能不能自己跑完。
  //
  // 为什么不用 CGDisplayIsAsleep 就够了：2026-10-11 连着两轮遇到
  // "壳报显示器醒着、可动画一步都不走"（跳过演出档 -1ms、性能档某手锁 16 秒）。
  // 也就是说"屏幕醒着"只是必要条件，不是充分条件——窗口有没有真的被合成，
  // 取决于台子上还有什么在抢合成器。唯一可信的判据是问时钟本身。
  //
  // 回 'CLOCK OK <ms>' 或 'CLOCK STUCK <state>'，uitest.sh 拿它决定要不要代打时钟。
  var t0 = performance.now();
  var el = document.createElement('div');
  el.style.cssText = 'position:fixed;left:-9999px;top:0;width:8px;height:8px';
  document.body.append(el);
  var a = el.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(20px)' }],
    { duration: 150, easing: 'linear' });
  var done = false;
  a.finished.then(function () {
    if (done) return;
    done = true;
    var t = Math.round(performance.now() - t0);
    window.__UITEST_RESULT = 'UITEST PASS CLOCK OK ' + t + 'ms';
    el.remove();
  }, function () {
    if (done) return;
    done = true;
    el.remove();
    window.__UITEST_RESULT = 'UITEST PASS CLOCK STUCK rejected:' + a.playState;
  });
  setTimeout(function () {
    if (done) return;
    done = true;
    el.remove();
    window.__UITEST_RESULT = 'UITEST PASS CLOCK STUCK ' + a.playState
      + ' ct=' + Math.round(a.currentTime || 0);
  }, 1500);
})();
