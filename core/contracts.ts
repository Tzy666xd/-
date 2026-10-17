import { Rand } from './rng.ts';
import type { HandKind } from './hands.ts';

export type RewardKind = 'money' | 'book' | 'card' | 'guest';
export interface ContractDef { id:string; name:string; blurb:string; goal:number; reward:RewardKind; cash:number; endOnly?:boolean }
export const CONTRACTS: ContractDef[] = [
  {id:'thrift',name:'节俭晚宴',blurb:'结清本夜三场，累计弃牌不超过 1 次',goal:3,reward:'guest',cash:7,endOnly:true},
  {id:'hearts',name:'偏爱红心',blurb:'本夜 3 手牌各有红心真正参与计分',goal:3,reward:'card',cash:6},
  {id:'variety',name:'不重复的节目',blurb:'本夜连续 3 手的牌型各不相同',goal:3,reward:'book',cash:7},
  {id:'black',name:'黑领结之约',blurb:'本夜 3 手各有至少 2 张黑色牌参与计分',goal:3,reward:'card',cash:6},
  {id:'faces',name:'贵客的肖像',blurb:'本夜累计有 6 张 J、Q、K 参与计分（重诵不重复计数）',goal:6,reward:'guest',cash:7},
  {id:'small',name:'三张小宴',blurb:'本夜 4 次出牌，每次不超过 3 张',goal:4,reward:'book',cash:6},
  {id:'curios',name:'珍奇展览',blurb:'本夜累计有 4 张稀奇牌参与计分（重诵不重复计数）',goal:4,reward:'card',cash:8},
  {id:'savings',name:'账房的信任',blurb:'结清本夜三场，最后持有至少 £20',goal:3,reward:'guest',cash:8,endOnly:true},
  {id:'clean',name:'只凭手艺',blurb:'结清本夜三场，期间不使用牌谱或引荐信',goal:3,reward:'book',cash:7,endOnly:true},
  {id:'pair',name:'成双的请柬',blurb:'本夜累计打出 3 手对子或两对',goal:3,reward:'card',cash:6},
  {id:'full',name:'满桌都是好牌',blurb:'本夜 3 手打出的牌全部参与计分，且每手至少 3 张',goal:3,reward:'book',cash:8},
  {id:'bold',name:'有胆识的主人',blurb:'本夜结清 1 场至少抬注 1 档的牌局',goal:1,reward:'guest',cash:8},
];
export interface NightWork {
  actions:number; discards:number; items:number; wins:number; hearts:number; black:number; faces:number;
  small:number; curios:number; pair:number; full:number; bold:number; streak:HandKind[];
}
export const freshWork=():NightWork=>({actions:0,discards:0,items:0,wins:0,hearts:0,black:0,faces:0,small:0,curios:0,pair:0,full:0,bold:0,streak:[]});
export interface ContractRun { id:string; night:number; status:'accepted'|'ready'|'claimed'|'failed'; value:number; result:string }
export interface ContractRecord { id:string; night:number; result:string; completed:boolean }
export function contractOffer(seed:number,night:number):string[] {
  const r=new Rand((seed^0x6c715b)+night*104729);
  return r.shuffle(CONTRACTS.map(d=>d.id)).slice(0,2);
}
export const contractById=(id:string)=>CONTRACTS.find(d=>d.id===id);
export function contractValue(id:string,w:NightWork,money:number):number {
  switch(id){
    case 'thrift':return w.discards<=1?w.wins:0;
    case 'savings':return money>=20?w.wins:0;
    case 'clean':return w.items===0?w.wins:0;
    case 'variety':return w.streak.length;
    default:return w[id as keyof NightWork] as number;
  }
}
