// 本批：真实计分、事件执行、读档、复盘的契约；也接入 selftest 供故障注入使用。
import { Game, play, discard, chooseEvent, useConsumable, limits, setRaise, buy, sellSeat, mkSeat } from '../core/game.ts';
import { PATRONS } from '../core/content.ts';
import { evaluate } from '../core/hands.ts';
import { score } from '../core/scoring.ts';
import { Rand } from '../core/rng.ts';
import { SPECIALS } from '../core/special-cards.ts';
import { EVENTS, eventById, eventTags } from '../core/events.ts';
import { serialize, deserialize, validate } from '../core/save.ts';
import { makeReport, reportText, validReport } from '../core/run-summary.ts';
import { pathToFileURL } from 'node:url';
export function runExpansion(t) {
  const card=(id,rank=2,special)=>({id,rank,suit:'s',enh:'none',seal:'none',...(special?{special}:{})});
  const compute=(played,extra={})=>score({played,result:evaluate(played),level:1,held:[],seats:[],env:{handIndex:0,rep:0,raised:0,discardsUsed:0,money:0},rand:new Rand(4242),...extra});
  const cue=(played,extra={})=>compute(played,extra).events.find(e=>e.t==='card');
  const held=[card(20),card(21),card(22)];
  const env=(money=0,handIndex=0)=>({money,handIndex,rep:0,raised:0,discardsUsed:0});
  t('稀奇牌六种身份互不重复',SPECIALS.length===6&&new Set(SPECIALS.map(x=>x.id)).size===6);
  for(const layers of [false,true]) {
    const c=card(1,2,'crest');
    t(`会客牌三客 +36 流水 / layers=${layers}`,cue([c],{layers,seats:PATRONS.slice(0,3).map(p=>mkSeat(p.id))}).addChips===38);
    t(`会客牌零客不加流水 / layers=${layers}`,cue([c],{layers}).addChips===2);
    t(`会客牌五客封顶48 / layers=${layers}`,cue([c],{layers,seats:PATRONS.slice(0,5).map(p=>mkSeat(p.id))}).addChips===50);
    t(`账票按整镑 / layers=${layers}`,cue([card(1,2,'ledger')],{layers,env:env(3.9)}).addChips===8);
    t(`账票封顶50 / layers=${layers}`,cue([card(1,2,'ledger')],{layers,env:env(99)}).addChips===52);
    for(const [i,m] of [[0,2],[2,6],[10,8]])t(`余烬第${i+1}手 / layers=${layers}`,cue([card(1,2,'ember')],{layers,env:env(0,i)}).addMult===m);
    t(`镜面同点数计分牌 +6 / layers=${layers}`,cue([card(1,2,'mirror'),card(2)],{layers}).addMult===6);
    t(`镜面单张不触发 / layers=${layers}`,cue([card(1,2,'mirror')],{layers}).addMult===0);
    t(`压舱留三张 ×1.5 / layers=${layers}`,cue([card(1,2,'anchor')],{layers,held}).xmult===1.5);
    t(`压舱留两张不触发 / layers=${layers}`,cue([card(1,2,'anchor')],{layers,held:held.slice(1)}).xmult===1);
    const triple=[card(1,2),card(2,2),card(3,2,'comet')];
    t(`彗尾最后计分 ×1.6 / layers=${layers}`,compute(triple,{layers}).events.filter(e=>e.t==='card').at(-1).xmult===1.6);
    t(`彗尾不在末尾不触发 / layers=${layers}`,cue([triple[2],triple[0],triple[1]],{layers}).xmult===1);
    t(`彗尾两张不触发 / layers=${layers}`,compute(triple.slice(1),{layers}).events.filter(e=>e.t==='card').at(-1).xmult===1);
    const red={...card(1,2,'ember'),enh:'mult',seal:'red'};
    const rr=compute([red],{layers});
    t(`强化与重诵叠加稀奇牌 / layers=${layers}`,rr.events.filter(e=>e.t==='card').length===2&&rr.events.filter(e=>e.t==='card').every(e=>e.addMult===6&&e.note==='余烬牌'));
  }
  const blocked=compute([card(1,2,'ember')],{boss:{id:'test',name:'封锁',suitLock:'s'}});
  t('贵客封锁稀奇牌不触发牌性',blocked.events.some(e=>e.t==='blocked')&&!blocked.events.some(e=>e.t==='card'));
  const plain=compute([card(1)]),fraction=compute([card(1,2,'anchor')],{held});
  t('压舱真实流水允许10.5且末快照一致',fraction.value===10.5&&fraction.events.at(-1).after.value===fraction.value&&plain.value===7);
  for(const id of ['visiting-card','banknote','embers','looking-glass','captains-keepsake','comet-letter']){
    const g=new Game(4242,'standard',{flags:{events:true}});g.state.money=30;
    const before=serialize(g),oldHand=g.state.hand.map(c=>c.id),last=oldHand.at(-1),calls=g.rand.calls;
    g.state.chosen=[last];g.state.pendingEvent=[id];chooseEvent(g,id);
    const op=eventById(id).ops.find(o=>o.t==='addCard');
    const all=[...g.state.deck,...g.state.hand,...g.state.table,...g.state.discardPile];
    const rare=all.find(c=>c.special===op.cards[0].special);
    t(`${id} 真实赠牌与牌堆守恒`,all.length===53&&rare&&new Set(all.map(c=>c.id)).size===53);
    t(`${id} 选择记录实际结果`,g.state.decisions.at(-1).kind==='event'&&g.state.decisions.at(-1).text.includes(eventById(id).name));
    t(`${id} 新牌和选择记录可读档`,deserialize(serialize(g))?.state.decisions.at(-1).text===g.state.decisions.at(-1).text&&deserialize(serialize(g))?.state.hand.length===g.state.hand.length);
    if(op.to==='hand'){
      t(`${id} 满手赠牌直接可选`,g.state.hand.at(-1).id===rare.id&&g.state.hand.length===limits(g.state).handSize);
      t(`${id} 旧牌入弃堆并清选中`,g.state.discardPile.some(c=>c.id===last)&&!g.state.chosen.includes(last));
      t(`${id} 直接赠牌不消耗主随机流`,g.rand.calls===calls);
    }else t(`${id} 加入待抽牌堆`,g.state.deck.some(c=>c.id===rare.id)&&g.state.hand.map(c=>c.id).join()===oldHand.join());
    t(`${id} 禁用奇遇时不能夹带事件`,(()=>{const z=deserialize(before);z.state.flags.events=false;z.state.pendingEvent=[id];const b=serialize(z);return chooseEvent(z,id)===null&&serialize(z)===b;})());
  }
  const g=new Game(4242);g.state.hand[0].rank=2;g.state.hand[0].special='anchor';g.state.chosen=[g.state.hand[0].id];
  const p=play(g);
  t('出牌统计读真实事件流水',g.state.runStats.plays===1&&g.state.runStats.bestHand===p.value&&g.state.runStats.totalScore===p.value&&g.state.runStats.handUse.high===1);
  t('合法小数流水存档不拒收',deserialize(serialize(g))?.state.score===10.5&&deserialize(serialize(g))?.state.runStats.bestHand===10.5);
  g.state.chosen=[g.state.hand[0].id];discard(g);
  t('实际弃牌记一次',g.state.runStats.discards===1);
  const raw=JSON.parse(serialize(g));delete raw.state.runStats;delete raw.state.decisions;
  const old=deserialize(JSON.stringify(raw));
  t('旧档可续局且统计标明部分记录',old&&old.state.runStats.partial&&old.state.runStats.plays===0&&old.state.decisions.length===0);
  for(const [label,mutate] of [
    ['未知稀奇牌',r=>r.state.hand[0].special='missing'],['负流水',r=>r.state.score=-1],['无限流水',r=>r.state.score=Infinity],
    ['负最佳单手',r=>r.state.runStats.bestHand=-1],['无限总分',r=>r.state.runStats.totalScore=Infinity],
    ['非法决策',r=>r.state.decisions=[{kind:'missing',night:1,stage:0,hand:0,text:'x'}]],
    ['无限决策列表',r=>r.state.decisions=Array.from({length:121},()=>({kind:'event',night:1,stage:0,hand:0,text:'x'}))],
  ]){const r=JSON.parse(serialize(g));mutate(r);t(`新字段单项畸形拒收：${label}`,validate(r)===null);}
  const copy=new Game(4242,'standard',{flags:{events:true}});const source=copy.state.hand[0];source.special='mirror';
  copy.state.consumables=[{t:'letter',id:'write'}];useConsumable(copy,0,[source.id]);
  t('引荐信誊抄保留稀奇牌身份但生成新ID',copy.state.deck.some(c=>c.special==='mirror'&&c.id!==source.id));
  const copyDef=EVENTS.find(x=>x.ops.some(o=>o.t==='copyHand'));
  copy.state.pendingEvent=[copyDef.id];chooseEvent(copy,copyDef.id,source.id);
  t('事件誊抄也保留稀奇牌身份',copy.state.deck.filter(c=>c.special==='mirror').length===2);
  const decisions=new Game(4242,'standard',{flags:{bets:true}});decisions.state.status='shop';decisions.state.money=100;
  decisions.state.shop=[{kind:'patron',pid:'hobbs',price:3,sold:false}];buy(decisions,0);setRaise(decisions,2);sellSeat(decisions,0);
  t('购买抬注离席有关键决策记录',['hire','raise','sell'].every(k=>decisions.state.decisions.some(d=>d.kind===k)));
  for(let i=0;i<130;i++)decisions.record('event',`选择 ${i}`);
  t('长局关键决策有界并保留开局记录',decisions.state.decisions.length===120&&decisions.state.decisions[0].kind==='start'&&decisions.state.decisions.at(-1).text==='选择 129');
  const retry=new Game(4242);retry.state.handsLeft=1;retry.state.hand[0].rank=2;retry.state.hand[0].special='anchor';retry.state.chosen=[retry.state.hand[0].id];play(retry);
  t('免费重做归零当前场但保留整局最高流水',retry.state.score===0&&retry.state.runStats.bestStage===10.5);
  t('重做前最高流水可读档并进入最终战报',deserialize(serialize(retry))?.state.runStats.bestStage===10.5&&makeReport(retry.state,false,'2026-10-15').bestStage===10.5);
  const before=serialize(g),calls=g.rand.calls;g.state.status='lost';g.state.score=10.5;
  g.record('event','彗星来信：彗尾牌直接入手');g.record('hire','请进霍布斯');
  const stable=serialize(g);const report=makeReport(g.state,false,'2026-10-15');
  t('战报来自真实总局统计并包含失手流水',report.bestHand===10.5&&report.bestStage===10.5&&report.plays===1&&report.discards===1&&report.curve.at(-1)===10.5);
  t('战报含种子稀奇牌和关键选择',report.seed===4242&&report.rareCards.includes('压舱牌')&&report.choices.length===2&&reportText(report).includes('彗星来信'));
  t('生成战报只读状态和随机流',serialize(g)===stable&&g.rand.calls===calls);
  t('合法战报通过结构校验',validReport(report));
  const config=new Game(4242,'standard',{flags:{events:true,draft:true}});const configured=makeReport(config.state,false,'2026-10-15');
  t('分享文案含开局规则快照与初始选择',configured.rules.length===2&&reportText(configured).includes(configured.rules.join('、'))&&configured.opening.includes('标准牌局'));
  t('旧版战报未含规则也能读',validReport({...report,rules:undefined,opening:undefined}));
  for(const [label,mutate] of [['NaN',r=>r.bestHand=NaN],['过长曲线',r=>r.curve=Array(46).fill(1)],['过长选择',r=>r.choices=['x'.repeat(321)]],['非数组客人',r=>r.guests={}]] ){
    const r=structuredClone(report);mutate(r);t(`坏战报拒收：${label}`,!validReport(r));
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){let pass=0,fail=0;runExpansion((name,ok)=>{if(ok)pass++;else{fail++;console.error('FAIL',name);}});console.log(`EXPANSION ${pass} passed, ${fail} failed`);process.exitCode=fail?1:0;}
