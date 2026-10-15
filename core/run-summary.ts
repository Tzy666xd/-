import type { GameState } from './game.ts';
import { modeById, diffById, STAGE_KIND, STAGE_LABEL } from './game.ts';
import { HANDS } from './hands.ts';
import { patronById, deckById, VOUCHERS } from './content.ts';
import { FLAG_KEYS, FLAG_LABEL } from './flags.ts';
import { specialById } from './special-cards.ts';
export interface RunReport {
  v:1; won:boolean; date:string; seed:number; mode:string; diff:string; deck:string; nights:number; night:number;
  cleared:number; bestStage:number; bestHand:number; totalScore:number; money:number; rep:number; plays:number; discards:number;
  mainHand:string; rules?:string[]; opening?:string; guests:string[]; privileges:string[]; rareCards:string[]; choices:string[]; curve:number[]; partial:boolean;
}
export function makeReport(s: GameState, won: boolean, date: string): RunReport {
  const ranked=Object.entries(s.runStats.handUse).sort((a,b)=>b[1]-a[1]);
  const choices=s.decisions.filter((d)=>d.kind!=='start');
  // 保留不同决策种类的代表，再补最近的选择；结果按发生顺序排，最多六条。
  const at=new Set<number>();
  for(const kind of ['hire','raise','event','sell','item']) { const i=choices.findLastIndex((d)=>d.kind===kind); if(i>=0)at.add(i); }
  for(let i=choices.length-1; i>=0&&at.size<6; i--)at.add(i);
  const curve=s.ledger.map((r)=>r.best);
  if(s.status==='playing'||s.status==='lost')curve.push(s.score);
  const all=[...s.deck,...s.hand,...s.table,...s.discardPile];
  return { v:1,won,date,seed:s.seed,mode:modeById(s.mode).name,diff:diffById(s.diff).name,deck:deckById(s.deckId).name,nights:s.nights,night:s.night,
    cleared:s.ledger.length,bestStage:Math.max(0,s.score,s.runStats.bestStage??0,...s.ledger.map((r)=>r.best)),bestHand:s.runStats.bestHand,totalScore:s.runStats.totalScore,
    money:s.money,rep:s.rep,plays:s.runStats.plays,discards:s.runStats.discards,
    mainHand:ranked[0] ? `${HANDS[ranked[0][0] as keyof typeof HANDS].name} · ${ranked[0][1]} 手` : '尚未出牌',
    rules:FLAG_KEYS.filter(k=>s.flags[k]).map(k=>FLAG_LABEL[k]),opening:s.decisions.find(d=>d.kind==='start')?.text??'旧档未记录开局选择',
    guests:s.seats.map((x)=>patronById(x.pid).name),privileges:s.vouchers.map((id)=>VOUCHERS.find((v)=>v.id===id)?.name??id),
    rareCards:[...new Set(all.map((c)=>specialById(c.special)?.name).filter((x):x is string=>!!x))],
    choices:[...at].sort((a,b)=>a-b).map((i)=>`第 ${choices[i].night} 夜 · ${STAGE_LABEL[STAGE_KIND[choices[i].stage]]} · ${choices[i].text}`),
    curve:curve.slice(-45),partial:s.runStats.partial };
}
export function reportText(r: RunReport): string {
  const num=(x:number)=>Math.round(x).toLocaleString('en-US');
  return [`几尼｜${r.won?'堂局通关':'散场复盘'} · ${r.date}`,`${r.mode} / ${r.diff} / ${r.deck} / ${r.nights} 夜 · 种子 ${r.seed}`,
    `开启规则：${r.rules?.join('、')||'基础规则'}`,`开局选择：${r.opening||'未记录'}`,
    `过关 ${r.cleared} 场 · 最高单场 ${num(r.bestStage)} · 最佳单手 ${num(r.bestHand)} · 银钱 £${num(r.money)} · 声望 ${r.rep}`,
    `累计入账 ${num(r.totalScore)} · 出牌 ${r.plays} 手 · 弃牌 ${r.discards} 次 · 主攻 ${r.mainHand}`,`最终客人：${r.guests.join('、')||'无'}`,
    `会员特权：${r.privileges.join('、')||'无'}`,`稀奇牌：${r.rareCards.join('、')||'无'}`, '关键选择：',...(r.choices.length?r.choices:['尚无经营选择']),
    r.partial?'部分出牌数据从旧存档续局后开始记录。':'分享种子与开局配置，一起从这副牌开始。战报仅摘录关键选择。'].join('\n');
}
export function validReport(value: unknown): value is RunReport {
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  const r=value as Record<string,unknown>;
  if(r.v!==1||typeof r.won!=='boolean'||typeof r.partial!=='boolean')return false;
  for(const k of ['date','mode','diff','deck','mainHand'])if(typeof r[k]!=='string'||(r[k] as string).length>120)return false;
  for(const k of ['seed','nights','night','cleared','bestStage','bestHand','totalScore','money','rep','plays','discards'])if(typeof r[k]!=='number'||!Number.isFinite(r[k])||(r[k] as number)<0)return false;
  for(const [k,max] of [['guests',20],['privileges',8],['rareCards',6],['choices',6]] as const)if(!Array.isArray(r[k])||r[k].length>max||!r[k].every((x)=>typeof x==='string'&&x.length<=320))return false;
  if(r.rules!==undefined&&(!Array.isArray(r.rules)||r.rules.length>9||!r.rules.every(x=>typeof x==='string'&&x.length<=80)))return false;
  if(r.opening!==undefined&&(typeof r.opening!=='string'||r.opening.length>240))return false;
  return Array.isArray(r.curve)&&r.curve.length<=45&&r.curve.every((x)=>typeof x==='number'&&Number.isFinite(x)&&x>=0);
}
