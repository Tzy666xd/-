(function(){
 try {
  var H=window.__H,q=function(s){return document.querySelector(s);};if(!H)return '';
  var checks=[];function t(name,ok){if(!ok)throw Error(name);checks.push(name);}
  t('开局可见经营奇遇预设',!q('#title').classList.contains('hidden')&&!!q('#btnClubPreset'));
  q('#btnClubPreset').click();t('一次开启经营组合且偏好落盘',H.prefsCopy.flags.club&&H.prefsCopy.flags.events&&JSON.parse(localStorage.getItem('guinea.prefs.v1')).flags.club);
  q('#btnStart').click();t('真入席按钮开启委托与故事',H.game.state.flags.club&&q('#club').classList.contains('open')&&q('#club').inert===false);
  t('显示两份可选委托',document.querySelectorAll('.club-contract').length===2);
  var id=q('.club-contract').dataset.contract;q('.club-contract button').click();
  t('真按钮接单且清空候选',H.game.state.club.contract.id===id&&H.game.state.club.offer.length===0);
  t('接单进度即时保存',JSON.parse(localStorage.getItem('guinea.save.v1')).state.club.contract.id===id);
  H.closePanels();q('#btnClub').click();t('委托簿可随时重新打开',q('#club').classList.contains('open'));
  H.game.state.money=50;var first=q('[data-story-choice]');var storyName=first.dataset.storyChoice;first.click();
  t('故事按钮留下真实选择且同夜收起下一章',H.game.state.club.story.history.length===1&&document.querySelectorAll('[data-story-choice]').length===0);
  var money=H.game.state.money;first.click();t('旧故事按钮不能重复领奖',H.game.state.money===money);
  t('故事分支保存',JSON.parse(localStorage.getItem('guinea.save.v1')).state.club.story.history.length===1);
  H.game.state.club.contract={id:'hearts',night:H.game.state.night,status:'ready',value:3,result:''};H.render();
  t('八种新稀奇牌均可自选',document.querySelectorAll('[data-reward^="card:"]').length===8);
  q('[data-reward="card:collector"]').click();
  t('真领奖按钮把收藏牌加入待抽牌组',H.game.state.club.completed===1&&H.game.state.deck.some(c=>c.special==='collector'));
  t('领奖后不再出现奖励按钮',document.querySelectorAll('[data-reward]').length===0);
  var c=H.game.state.hand[0];c.special='collector';c.charge=2;H.render();
  t('牌面和辅助说明显示实时蓄力',q('#tray [data-id="'+c.id+'"]').textContent.includes('2/4')&&q('#tray [data-id="'+c.id+'"]').title.includes('2/4'));
  H.closePanels();var oldSeed=H.game.state.seed;q('#btnAgain').focus();q('#btnAgain').click();
  t('隐藏终局按钮无法聚焦或重开',document.activeElement!==q('#btnAgain')&&H.game.state.seed===oldSeed);
  H.clear();var leave=q('#shopBody .leave');leave.click();var stage=H.game.state.stage;leave.focus();leave.click();
  t('关闭商店后旧按钮无法跳场',H.game.state.stage===stage&&document.activeElement!==leave);
  H.start(4242,'standard',{flags:{club:false}});H.seat('hobbs');H.seat('payne');H.seat('clerk');
  H.game.state.status='shop';H.game.state.money=100;H.game.state.shop=[{kind:'patron',pid:'turf',edition:'negative',price:5,sold:false}];H.openPanel('shop');q('#shopBody .slot').click();
  t('满座的负片货位可实际购买',H.game.state.seats.length===4&&H.game.state.money===95);
  H.start(4242,'standard',{mode:'daily'});H.game.state.status='won';H.showEnd(true);q('#btnEndless').click();
  t('每日终局隐藏无尽并在处理器拒绝',q('#btnEndless').hidden&&!H.game.state.endless&&H.game.state.night===1);
  H.start(4242,'standard',{mode:'run',flags:{club:true,events:true}});
  H.game.state.club.completed=1;H.game.state.club.archive=[{id:'hearts',night:1,result:'收藏牌加入牌组',completed:true}];
  H.game.state.club.story.done=true;H.game.state.club.story.ending='彩窗新生';H.game.state.club.story.history=['付钱修复','重新上漆','留下彩窗牌'];
  H.game.state.status='lost';H.showEnd(false);
  t('散场页显示委托和故事',q('#endReview').textContent.includes('委托履约 1 份')&&q('#endReview').textContent.includes('彩窗新生'));
  var report=JSON.parse(localStorage.getItem('guinea.last-report.v1'));t('战报保存完整新增信息',report.completedContracts===1&&report.commissions.length===1&&report.story.includes('彩窗新生'));
  q('#btnShareRun').click();t('分享预览绘制真实画布',q('#sharePreview canvas').width===1200&&q('#sharePreview canvas').height===1740);
  window.addEventListener('guinea-export',function(event){window.__UITEST_RESULT='UITEST '+(event.detail.status==='saved'?'PASS':'FAIL')+' '+checks.length+'/'+checks.length+' [club] '+JSON.stringify({checks:checks,export:q('#shareStatus').textContent});},{once:true});
  q('#btnExportReport').click();return '';
 }catch(error){return 'UITEST FAIL [club] '+error.message;}
})();
