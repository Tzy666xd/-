import {Game,play,discard,settle,limits,levelOf,useConsumable,chooseEvent,reroll,mkSeat,acceptCommission,skipCommission,claimCommission,chooseStory,storyChapter,CLUB_CARDS,CLUB_GUESTS} from '../core/game.ts';
import {CONTRACTS} from '../core/contracts.ts';
import {STORIES} from '../core/stories.ts';
import {serialize,deserialize,validate} from '../core/save.ts';
import {makeReport,validReport,reportText} from '../core/run-summary.ts';
import {evaluate} from '../core/hands.ts';
import {score} from '../core/scoring.ts';
import {Rand} from '../core/rng.ts';
import {guideFlags} from '../core/guide.ts';
import {pathToFileURL} from 'node:url';
const card=(id,rank=2,suit='s',special,charge=0)=>({id,rank,suit,enh:'none',seal:'none',...(special?{special,charge}:{})});
const compute=(cs,extra={})=>score({played:cs,result:evaluate(cs),level:1,held:[],seats:[],env:{money:0,handIndex:0,rep:0,raised:0,discardsUsed:0},rand:new Rand(42),...extra});
const fresh=()=>{const g=new Game(42,'standard',{nights:8,flags:{club:true,events:true}});g.state.eventAt=99;g.state.money=30;return g;};
function accept(g,id){g.state.club.offer=[id];return acceptCommission(g,id);}
function hit(g,spec){
  const s=g.state;s.handsLeft=30;
  spec.forEach((c,i)=>Object.assign(s.hand[i],{rank:c[0],suit:c[1]??'s',special:c[2],charge:0}));
  s.chosen=s.hand.slice(0,spec.length).map(c=>c.id);return play(g);
}
function win(g){g.state.score=g.target();settle(g);}
function step(g){if(g.state.club?.contract?.status==='ready')claimCommission(g,'cash');g.openShop();g.next();g.state.eventAt=99;}
function night(g){const n=g.state.night;while(g.state.night===n&&g.state.status!=='won'){win(g);step(g);}}
export function runClubChecks(t){
  t('第一批恰有十二份委托和四条故事',CONTRACTS.length===12&&STORIES.length===4);
  for(const d of CONTRACTS){
    const g=fresh();t(`${d.name}可接且不能再接`,accept(g,d.id)&&!acceptCommission(g,d.id));
    const loaded=deserialize(serialize(g));t(`${d.name}接单状态可读档`,loaded?.state.club?.contract?.id===d.id);
  }
  {
    const g=fresh();const calls=g.rand.calls;skipCommission(g);t('谢绝委托不消耗主随机流',g.rand.calls===calls&&g.state.club.offer.length===0);
    const h=fresh();hit(h,[[2]]);t('首个动作后不能追接委托',h.state.club.offer.length===0&&!acceptCommission(h,'small'));
    const base=new Game(42),off=new Game(42,'standard',{flags:{club:false}});
    t('关闭新玩法不改变牌序与随机步数',JSON.stringify(base.state.deck)===JSON.stringify(off.state.deck)&&base.rand.calls===off.rand.calls&&off.state.club===null);
    const daily=new Game(42,'standard',{mode:'daily',flags:{club:true,events:true}});t('每日模式锁定基础规则',!daily.state.flags.club&&daily.state.club===null);
    t('教学局关闭委托和故事，避免预设遮住第一课',!guideFlags({club:true,events:true}).club);
  }
  const plays={hearts:[[2,'h']],black:[[2,'s'],[2,'c']],faces:[[11,'s'],[11,'h'],[11,'d']],small:[[2]],curios:[[2,'s','crest']],pair:[[2,'s'],[2,'h']],full:[[2,'s'],[2,'h'],[2,'d']]};
  for(const [id,spec]of Object.entries(plays)){
    const g=fresh();accept(g,id);g.state.night=8; // 高彩头让多手目标不会提前结场；不写回存档
    for(let i=0;i<CONTRACTS.find(d=>d.id===id).goal;i++)hit(g,spec);
    t(`${id}由真实出牌推进到待领奖`,g.state.club.contract.status==='ready');
  }
  {
    const g=fresh();accept(g,'variety');hit(g,[[2]]);hit(g,[[2]]);t('重复牌型重置连续节目',g.state.club.contract.value===1);
    hit(g,[[3],[3]]);hit(g,[[4],[4],[4]]);t('连续三种牌型达成',g.state.club.contract.status==='ready');
  }
  for(const id of ['thrift','savings','clean']){
    const g=fresh();accept(g,id);win(g);t(`${id}不能第一场提前领奖`,g.state.club.contract.status==='accepted');step(g);win(g);step(g);win(g);
    t(`${id}第三场结清才达成`,g.state.club.contract.status==='ready');
    g.openShop();const old=g.state.night;g.next();t(`${id}奖励未领不能越夜丢失`,g.state.night===old);
    const before=g.state.money;t(`${id}领取一次且不重复付钱`,claimCommission(g,'cash')&&!claimCommission(g,'cash')&&g.state.money-before===CONTRACTS.find(d=>d.id===id).cash&&g.state.club.completed===1);
    const report=makeReport(g.state,false,'2026-10-17');t(`${id}战报有履约记录`,validReport(report)&&report.completedContracts===1&&reportText(report).includes('委托履约：1 份'));
  }
  {
    const g=fresh();accept(g,'bold');g.state.raisedHere=1;win(g);t('抬注委托按真实结清统计',g.state.club.contract.status==='ready');
    g.state.seats=['hobbs','payne','clerk'].map(pid=>({pid,edition:'none'}));t('满座的定向奖励不消耗领取机会',!claimCommission(g,'guest:solicitor')&&g.state.club.contract.status==='ready');
    t('满座仍可领取银钱',claimCommission(g,'cash'));
    const h=fresh();accept(h,'clean');h.state.consumables=[{t:'book',id:'high'}];useConsumable(h,0,[]);night(h);
    t('使用物品导致纯手艺委托失败且不罚钱',h.state.club.archive.some(r=>r.id==='clean'&&!r.completed));
  }
  for(const id of CLUB_CARDS){
    const g=fresh();accept(g,'hearts');g.state.night=8;for(let i=0;i<3;i++)hit(g,[[2,'h']]);
    t(`${id}能从委托奖励真正获得`,claimCommission(g,'card:'+id)&&g.state.deck.some(c=>c.special===id));
  }
  for(const id of CLUB_GUESTS){const g=fresh();accept(g,'bold');g.state.raisedHere=1;win(g);t(`${id}能定向入席`,claimCommission(g,'guest:'+id)&&g.state.seats.some(s=>s.pid===id));}
  {
    const g=fresh();accept(g,'variety');hit(g,[[2]]);hit(g,[[2],[2]]);hit(g,[[3],[3],[3]]);t('自选牌谱即时升级且不占随身位',claimCommission(g,'book:sf')&&levelOf(g.state,'royal')===2&&g.state.consumables.length===0);
  }
  function paths(def,index=0,prefix=[]){return def.chapters[index].choices.flatMap(c=>c.ending?[[...prefix,c.id]]:paths(def,c.next,[...prefix,c.id]));}
  for(const def of STORIES)for(const path of paths(def)){
    const g=fresh();g.state.club.story={id:def.id,chapter:0,due:1,done:false,history:[],ending:''};
    for(const id of path){const chapter=storyChapter(g.state);
      if(!chapter){t(`${def.name}不可提前跳过待执行章节`,false);break;}
      t(`${def.name}/${chapter.title}/${id}执行`,chooseStory(g,id));
      t(`${def.name}同夜不能重选或提前读下一章`,!chooseStory(g,id)&&storyChapter(g.state)===null);
      t(`${def.name}关键故事选择进入战报摘录源`,g.state.decisions.at(-1)?.kind==='story'&&g.state.decisions.at(-1).text.includes(chapter.title));
      const loaded=deserialize(serialize(g));t(`${def.name}分支和下一夜约定可读档`,loaded?.state.club?.story.history.length===g.state.club.story.history.length);
      if(!g.state.club.story.done)night(g);
    }
    t(`${def.name}/${path.join('/')}有确定结局`,g.state.club.story.done&&!!g.state.club.story.ending);
    const r=makeReport(g.state,false,'2026-10-17');t(`${def.name}结局进入图片与文案数据`,validReport(r)&&r.story.includes(g.state.club.story.ending)&&reportText(r).includes(r.story));
  }
  {
    const g=fresh();g.state.money=0;t('付费故事不透支也不推进',!chooseStory(g,'repair')&&g.state.club.story.history.length===0);
    const raw=JSON.parse(serialize(g));
    if(raw.state.club){raw.state.club.story.chapter=99;t('未知故事章节拒收',validate(raw)===null);}
    else t('存档不可遗漏委托与故事',false);
    const old=JSON.parse(serialize(new Game(42)));delete old.state.club;t('缺少新增字段的旧存档可读',!!deserialize(JSON.stringify(old)));
    for(const [label,fn]of [['负蓄力',r=>r.state.hand[0].charge=-1],['蓄力溢出',r=>r.state.hand[0].charge=5],['未知委托',r=>{if(r.state.club)r.state.club.offer=['fake'];}],['非法进度',r=>{if(r.state.club)r.state.club.work.faces='3';}]]){const raw=JSON.parse(serialize(g));fn(raw);t(`${label}单项损坏被拒`,validate(raw)===null);}
    const blocked=fresh();blocked.state.pendingEvent=['tailor'];const before=serialize(blocked);
    t('待决事件期间故事不能改变资金',!chooseStory(blocked,'repair')&&serialize(blocked)===before);
    blocked.state.club.contract={id:'hearts',night:1,status:'ready',value:3,result:''};
    t('待决事件期间不能领取奖励改变事件前提',!claimCommission(blocked,'cash'));
  }
  for(const layers of [false,true]){
    const relay=compute([card(1,2),card(2,2,'s','relay')],{layers});t(`接力同花额外流水 / ${layers}`,relay.events.find(e=>e.t==='card'&&e.id===2).addChips===27);
    t(`接力不同花不触发 / ${layers}`,compute([card(1,2,'h'),card(2,2,'s','relay')],{layers}).events.find(e=>e.t==='card'&&e.id===2).addChips===2);
    t(`收藏满蓄力 / ${layers}`,compute([card(1,2,'s','collector',4)],{layers}).chips===87);
    t(`拾遗满蓄力 / ${layers}`,compute([card(1,2,'s','salvage',4)],{layers}).mult===13);
    const bond={...card(1,2,'s','bond'),seal:'red'};t(`债券重诵仍只兑现一次 / ${layers}`,compute([bond],{layers}).money===2);
    t(`债券三次后停止付钱 / ${layers}`,compute([{...bond,charge:3}],{layers}).money===0);
    t(`封缄无火漆不触发 / ${layers}`,compute([card(1,2,'s','sealed')],{layers}).chips===7);
    t(`封缄有火漆触发 / ${layers}`,compute([{...card(1,2,'s','sealed'),seal:'gold'}],{layers}).chips===37);
    const four=[card(1,2,'s','spectrum'),card(2,2,'h'),card(3,2,'d'),card(4,2,'c')];t(`彩窗四花色 / ${layers}`,compute(four,{layers}).events.find(e=>e.t==='card').xmult===1.5);
    t(`小宴三张以内触发 / ${layers}`,compute([card(1,2,'s','modest')],{layers}).mult===6);
    t(`后备按出牌前牌堆读数 / ${layers}`,compute([card(1,2,'s','reserve')],{layers,scene:{deckLeft:14}}).chips===47);
  }
  {
    const g=fresh(),c=g.state.hand[0];c.special='collector';for(let i=0;i<6;i++){g.state.status='playing';win(g);}t('留在手中才使收藏成长且封顶',c.charge===4);
    const h=fresh(),d=h.state.hand[0];d.special='salvage';h.state.chosen=[d.id];discard(h);t('真实弃牌使拾遗蓄力',d.charge===1&&h.state.discardPile.some(c=>c.id===d.id));
    for(let i=0;i<6;i++){
      for(const zone of [h.state.hand,h.state.deck,h.state.table,h.state.discardPile]){const at=zone.findIndex(c=>c.id===d.id);if(at>=0)zone.splice(at,1);}
      if(h.state.hand.length>=limits(h.state).handSize)h.state.deck.push(h.state.hand.pop());
      h.state.hand.push(d);h.state.chosen=[d.id];h.state.discardsLeft=3;discard(h);
    }
    t('拾遗多次弃牌仍封顶四层',d.charge===4);
    const b=fresh();const bond=b.state.hand[0];bond.special='bond';bond.rank=2;b.state.chosen=[bond.id];play(b);t('真实计分将债券兑现次数存进牌',bond.charge===1);
    t('律师的加成来自已领取奖励的委托',compute([card(1)],{seats:[{pid:'solicitor',edition:'none'}],scene:{contractsDone:3}}).mult===7);
    t('修复师按真实蓄力加分',compute([card(1,2,'s','collector',2)],{seats:[{pid:'archivist',edition:'none'}]}).events.some(e=>e.t==='patron'&&e.pid==='archivist'&&e.addChips===16));
    t('邮差识别出牌中的相邻同花',compute([card(1,2),card(2,3)],{seats:[{pid:'courier',edition:'none'}]}).events.some(e=>e.t==='patron'&&e.pid==='courier'&&e.addChips===35));
    const sponsor=fresh();accept(sponsor,'bold');sponsor.state.raisedHere=1;win(sponsor);claimCommission(sponsor,'guest:sponsor');step(sponsor);win(sponsor);t('赞助人兑现本夜履约后的结清收益',sponsor.state.settlement.some(l=>l.pid==='sponsor'&&l.amount===4));
  }
  {
    const cs=[card(1,2),card(2,14),card(3,2),card(4,14,'s','comet')],r=compute(cs);
    t('两对恢复从左到右计分并保留彗尾',r.events.filter(e=>e.t==='card').map(e=>e.id).join()==='1,2,3,4'&&Math.abs(r.value-147.2)<1e-9);
    const g=new Game(4242,'standard',{flags:{thresholds:true}});g.state.night=4;g.state.books.high=15;
    for(let i=0;i<2;i++){g.state.hand[0].rank=2;g.state.chosen=[g.state.hand[0].id];play(g);}t('连续两手阈值奖励都发且真实过关',g.state.score===5310&&g.state.status==='cleared');
    const h=new Game(42);const st=h.state.stage;h.next();t('出牌中无法跳场',h.state.stage===st);
    h.state.consumables=[{t:'book',id:'sf'}];useConsumable(h,0,[]);t('皇家共享同花顺牌谱',levelOf(h.state,'royal')===2);
    const e=fresh();e.state.pendingEvent=['fencing'];const before=e.state.discardsLeft;chooseEvent(e,'fencing');t('事件即时增加当前弃牌次数',e.state.discardsLeft===before+2);
    const zero=fresh();zero.state.handsLeft=1;zero.state.buffer=0;zero.state.pendingEvent=['candle-roll'];chooseEvent(zero,'candle-roll');t('事件扣完最后一次出牌会正式判负',zero.state.status==='lost');
    const reset=new Game(42,'standard',{flags:{thresholds:true}});reset.state.claimed=['t-quiet','t-ledger'];reset.state.status='cleared';reset.next();
    t('换场清空不跨场的整场奖励，同时保留可跨场奖励',reset.state.claimed.join()==='t-ledger');
    const a=new Game(42),b=new Game(43);a.state.consumables=[{t:'letter',id:'write'}];useConsumable(a,0,[a.state.hand[0].id]);new Game(44);a.state.consumables=[{t:'letter',id:'write'}];useConsumable(a,0,[a.state.hand[0].id]);t('多局实例互不重置牌 ID',!!deserialize(serialize(a)));
    const huge=new Game(42);for(const c of [...huge.state.hand,...huge.state.deck])c.id+=Number.MAX_SAFE_INTEGER-52;
    const restored=deserialize(serialize(huge));t('极大合法牌ID存档可以安全恢复',!!restored);
    if(restored){for(let i=0;i<2;i++){restored.state.consumables=[{t:'letter',id:'write'}];useConsumable(restored,0,[restored.state.hand[0].id]);}t('极大ID恢复后复制仍唯一且可读档',!!deserialize(serialize(restored)));}
    const rr=new Game(42);win(rr);rr.openShop();rr.state.money=10000;for(let i=0;i<100;i++)reroll(rr);t('百次合法重掷不会使存档失效',rr.state.rerolls===100&&!!deserialize(serialize(rr)));
    const copy=new Game(42);copy.state.seats=[mkSeat('payne'),mkSeat('twins')];copy.state.chosen=[copy.state.hand[0].id];const money=copy.state.money;discard(copy);t('双生复制弃牌经济挂载点',copy.state.money-money===2);
    copy.state.seats=[mkSeat('clerk'),mkSeat('twins')];copy.state.discardsUsed=0;win(copy);t('双生复制局终经济挂载点',copy.state.settlement.filter(l=>l.pid==='clerk').reduce((a,l)=>a+l.amount,0)===16);
    for(const value of [-100,.5,'3']){const raw=JSON.parse(serialize(fresh()));raw.state.eventMods=[{from:'gas-lamp',scope:'run',night:1,rule:{handSize:value}}];t(`损坏限额 ${String(value)} 被读档拒绝`,validate(raw)===null);}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let count=0;runClubChecks((name,ok)=>{if(!ok)throw Error(name);count++;});console.log(`CLUB CHECK OK ${count} 项`);}
