// 稀奇牌保留扑克牌点数与花色，牌性独立于强化/蜡封；效果都走现有逐张计分事件。
import type { Card } from './hands.ts';
export type SpecialKind = 'crest' | 'ledger' | 'ember' | 'mirror' | 'anchor' | 'comet'
  | 'relay' | 'collector' | 'salvage' | 'bond' | 'sealed' | 'spectrum' | 'modest' | 'reserve';
export const SPECIALS: { id: SpecialKind; name: string; glyph: string; blurb: string; color: string }[] = [
  { id:'crest', name:'会客牌', glyph:'♜', blurb:'计分时，每位座上宾 +12 流水，最多 +48', color:'#315e4e' },
  { id:'ledger', name:'账票牌', glyph:'£', blurb:'计分时，每 £1 存款 +2 流水，最多 +50', color:'#8b6a2a' },
  { id:'ember', name:'余烬牌', glyph:'✦', blurb:'计分时，按本场第几手 +2 倍注，最多 +8', color:'#a04e36' },
  { id:'mirror', name:'镜面牌', glyph:'◇', blurb:'同手有另一张同点数的计分牌时，本张 +6 倍注', color:'#527484' },
  { id:'anchor', name:'压舱牌', glyph:'⚓', blurb:'计分时，手里还留至少 3 张牌，倍注 ×1.5', color:'#354d70' },
  { id:'comet', name:'彗尾牌', glyph:'☄', blurb:'至少 3 张参与计分，且本张最后计分时，倍注 ×1.6', color:'#71537c' },
  { id:'relay',name:'接力牌',glyph:'↝',blurb:'前一张计分牌与本张同花色时，+25 流水',color:'#406e59' },
  { id:'collector',name:'收藏牌',glyph:'▣',blurb:'每次结清时留在手中积 1 层；计分每层 +20 流水，最多 4 层',color:'#78603e' },
  { id:'salvage',name:'拾遗牌',glyph:'↶',blurb:'每次弃掉积 1 层；计分每层 +3 倍注，最多 4 层',color:'#477d83' },
  { id:'bond',name:'债券牌',glyph:'§',blurb:'计分倍注 ×0.9；每次出牌首次计分得 £2，全局最多兑现 3 次',color:'#816447' },
  { id:'sealed',name:'封缄牌',glyph:'✉',blurb:'本张带任意火漆时，计分 +30 流水',color:'#9a4f43' },
  { id:'spectrum',name:'彩窗牌',glyph:'❖',blurb:'本手计分牌凑齐四种花色时，倍注 ×1.5',color:'#785f97' },
  { id:'modest',name:'小宴牌',glyph:'Ⅲ',blurb:'本次出牌不超过 3 张时，计分 +5 倍注',color:'#627848' },
  { id:'reserve',name:'后备牌',glyph:'⌛',blurb:'出牌时待抽牌堆少于 15 张，计分 +40 流水',color:'#53648a' },
];
export const specialById = (id: string | undefined) => SPECIALS.find((x) => x.id === id);
export function specialEffect(c: Card, live: Card[], held: Card[], money: number, seats: number, handIndex: number, index: number, playedCount=live.length, deckLeft=52): { chips: number; mult: number; xmult: number; note: string } {
  let chips=0, mult=0, xmult=1;
  switch(c.special) {
    case 'crest': chips=12*Math.min(4,seats); break;
    case 'ledger': chips=2*Math.min(25,Math.floor(money)); break;
    case 'ember': mult=Math.min(8,2*(handIndex+1)); break;
    case 'mirror': if(live.some((x)=>x.id!==c.id&&x.rank===c.rank)) mult=6; break;
    case 'anchor': if(held.length>=3) xmult=1.5; break;
    case 'comet': if(live.length>=3&&index===live.length-1) xmult=1.6; break;
    case 'relay': if(index>0&&live[index-1].suit===c.suit) chips=25;break;
    case 'collector': chips=20*(c.charge??0);break;
    case 'salvage': mult=3*(c.charge??0);break;
    case 'bond': xmult=.9;break;
    case 'sealed': if(c.seal!=='none')chips=30;break;
    case 'spectrum': if(new Set(live.map(x=>x.suit)).size===4)xmult=1.5;break;
    case 'modest': if(playedCount<=3)mult=5;break;
    case 'reserve': if(deckLeft<15)chips=40;break;
  }
  return {chips,mult,xmult,note: specialById(c.special)?.name ?? ''};
}
export function specialProgress(c:Card):string {
  return c.special==='bond'?`已兑现 ${Math.min(3,c.charge??0)}/3 次`:c.special==='collector'||c.special==='salvage'?`蓄力 ${c.charge??0}/4 层`:'';
}
