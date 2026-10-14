import { Game, nextTarget, targetOf, limits, play, mkSeat } from '../core/game.ts';
import { serialize, deserialize, validate, SAVE_KEY } from '../core/save.ts';
import { Rand } from '../core/rng.ts';
import { FLAGS_OFF } from '../core/flags.ts';
import { stateFacts, LESSONS } from '../core/guide.ts';
import { createSaveStore } from '../web/persistence.ts';
import { pathToFileURL } from 'node:url';

export function runReliability(check) {
  const daily = new Game(4242, 'patrician', {mode:'daily',diff:'grudge',nights:3,endless:true,
    flags:Object.fromEntries(Object.keys(FLAGS_OFF).map(k=>[k,true]))});
  check('每日模式固定标准难度、牌组、八夜与规则',daily.state.diff==='standard'
    && daily.state.deckId==='standard' && daily.state.nights===8
    && !daily.state.endless && Object.values(daily.state.flags).every(v=>v===false) && daily.state.seats.length===0);
  const dailyBack=deserialize(serialize(daily));
  check('每日模式固定配置读档保持一致',dailyBack!==null
    && dailyBack.state.mode==='daily' && dailyBack.state.diff==='standard');
  for (const nights of [3, 5, 8, 12, 15]) {
    const g = new Game(4242, 'standard', { nights, flags: {...FLAGS_OFF, events:true} });
    Object.assign(g.state, { stage:2, status:'shop', raiseNext:1,
      eventMods:[{from:'gas-lamp',scope:'night',night:1,rule:{targetScale:1.1}}] });
    const before = serialize(g);
    const predicted = nextTarget(g.state, 1);
    check(`跨夜预告不改状态与随机流（${nights}夜）`, serialize(g) === before);
    g.next();
    check(`跨夜抬注预告等于真实彩头（${nights}夜，事件已到期）`, predicted === targetOf(g.state));
  }
  const full = new Game(4242,'standard',{flags:{...FLAGS_OFF,bets:true,sets:true}});
  Object.assign(full.state,{night:3,seats:[mkSeat('hobbs'),mkSeat('clerk')],buffer:0,
    raisedHere:2,handsLeft:1,money:20,consumables:Array.from({length:3},()=>({t:'letter',id:'fortune'}))});
  full.state.chosen = [full.state.hand[0].id]; play(full);
  check('失手请客不挤掉随身物，也不留下超槽状态', full.state.consumables.length===3
    && full.state.consumables.length<=limits(full.state).slots && full.state.seats.length===2);
  check('容量不足时替代惩罚实际扣钱并说清楚', full.state.money===16 && full.state.log[0].includes('改赔 £4'));
  const safe = new Game(4242,'standard',{flags:{...FLAGS_OFF,bets:true,sets:true}});
  Object.assign(safe.state,{night:3,seats:[mkSeat('hobbs'),mkSeat('clerk')],signature:'clerk',
    buffer:0,raisedHere:2,handsLeft:1});
  safe.state.chosen=[safe.state.hand[0].id]; play(safe);
  check('能安全离席的加注惩罚仍请走最右边客人', safe.state.seats.length===1 && safe.state.seats[0].pid==='hobbs');
  check('加注惩罚请走签名宾后同步标记', safe.state.signature==='');

  const raw = () => JSON.parse(serialize(new Game(4242)));
  const bad = (name, mutate) => { const r=raw(); mutate(r); check(name, validate(r)===null); };
  bad('重复客人单字段非法仍拒收',r=>r.state.seats=[mkSeat('hobbs'),mkSeat('hobbs')]);
  bad('跨牌区的重复牌ID拒收',r=>r.state.deck[0].id=r.state.hand[0].id);
  bad('不存在的选中牌拒收',r=>r.state.chosen=[9999999]);
  bad('重复选择同一张牌拒收',r=>r.state.chosen=[r.state.hand[0].id,r.state.hand[0].id]);
  bad('选择超过五张牌拒收',r=>r.state.chosen=r.state.hand.slice(0,6).map(c=>c.id));
  bad('缺失完整账本字段拒收',r=>r.state.ledger=[{night:1,stage:'open',label:'便宴',target:300,money:10}]);
  bad('结清明细不是合法账目拒收',r=>r.state.settlement=[{label:'赏金',amount:'很多'}]);
  bad('日志中非字符串拒收',r=>r.state.log=[{}]);
  bad('随机步数早于开局拒收',r=>r.calls=0);
  bad('不安全整数随机步数拒收',r=>r.calls=Number.MAX_SAFE_INTEGER+1);
  bad('牌谱未知键拒收',r=>r.state.books.missing=1);
  bad('超过玩法牌堆上限拒收',r=>{while(r.state.deck.length+r.state.hand.length<=120)r.state.deck.push({...r.state.hand[0],id:10000+r.state.deck.length});});
  const missing = new Game(4242);
  missing.state.chosen=[9999999]; const old=serialize(missing);
  check('不存在的选牌不能空手记分或耗次数', play(missing)===null && serialize(missing)===old);
  for (const seed of [0,4242,0xffffffff]) {
    const r=new Rand(seed), jump=new Rand(seed);
    for(let i=0;i<500001;i++)r.next();
    jump.restoreCalls(500001);
    check(`随机恢复超过旧40万上限仍逐位相同（${seed}）`, Array.from({length:8},()=>r.next()).join(',')===Array.from({length:8},()=>jump.next()).join(','));
  }
  const long=raw();long.calls=500000;
  check('合法长局随机调用次数精确恢复',deserialize(JSON.stringify(long))?.rand.calls===500000);
  const guide=new Game(20261011,'standard',{diff:'gentle',nights:3});guide.state.score=126;
  const text=LESSONS.find(x=>x.id==='stage').dyn({started:true,...stateFacts(guide.state)});
  check('引导剩余彩头扣除已做出的126分',text.includes('还差 94 分'));
  check('引导不承诺不存在的剩余次数收入',!text.includes('没用完的次数'));

  const values=new Map();let fail=false;
  const port={getItem:k=>values.get(k)??null,setItem:(k,v)=>{if(fail)throw Error('quota');values.set(k,v);},removeItem:k=>values.delete(k)};
  const store=createSaveStore(()=>port);
  const a=serialize(new Game(4242)),b=serialize(new Game(4243));
  check('有效存档立即写入主档',store.set(a)&&values.get(SAVE_KEY)===a);
  check('第二次写入保留上一份有效档',store.set(b)&&values.get(`${SAVE_KEY}.backup`)===a);
  values.set(SAVE_KEY,'broken');
  check('主档损坏自动读有效备份',store.get()===a&&store.recovered);
  fail=true;
  check('写入失败有明确失败结果',store.set(b)===false);
  fail=false;
  check('写入失败仍保留原有效备份',store.get()===a);
  store.del();
  check('清空同时删除主档和备份，旧局不复活',values.size===0&&store.get()===null);
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  let pass=0,fail=0;
  runReliability((name,ok)=>{if(ok)pass++;else{fail++;console.error('FAIL',name);}});
  console.log(`RELIABILITY ${pass} passed, ${fail} failed`);
  process.exitCode=fail?1:0;
}
