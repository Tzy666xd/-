(function(){try{
  var H=window.__H,q=function(s){return document.querySelector(s);},checks=[];
  function t(name,ok){if(!ok)throw Error(name);checks.push(name);}
  function inside(n){var r=n.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.top>=0&&r.bottom<=innerHeight+1;}
  H.start(4242,'standard',{flags:{club:true,events:true}});
  t('委托侧栏关闭按钮在窗口内',inside(q('#club .close')));
  t('委托侧栏有内容滚动而非页面横向溢出',q('#clubBody').scrollHeight>=q('#clubBody').clientHeight&&document.documentElement.scrollWidth<=innerWidth);
  H.closePanels();
  t('牌桌委托入口在窗口内',inside(q('#btnClub')));
  q('#title').classList.remove('hidden');H.renderPickers();
  t('新预设不会挤走入席按钮',inside(q('#btnStart')));
  t('标题提供经营奇遇按钮',!!q('#btnClubPreset')&&q('#btnClubPreset').offsetWidth>0);
  return 'UITEST PASS '+checks.length+'/'+checks.length+' [club-layout] '+JSON.stringify({width:innerWidth,height:innerHeight,checks:checks});
}catch(e){return 'UITEST FAIL [club-layout] '+e.message;}})();
