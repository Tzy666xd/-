// 稀奇牌保留扑克牌点数与花色，牌性独立于强化/蜡封；效果都走现有逐张计分事件。
import type { Card } from './hands.ts';
export type SpecialKind = 'crest' | 'ledger' | 'ember' | 'mirror' | 'anchor' | 'comet';
export const SPECIALS: { id: SpecialKind; name: string; glyph: string; blurb: string; color: string }[] = [
  { id:'crest', name:'会客牌', glyph:'♜', blurb:'计分时，每位座上宾 +12 流水，最多 +48', color:'#315e4e' },
  { id:'ledger', name:'账票牌', glyph:'£', blurb:'计分时，每 £1 存款 +2 流水，最多 +50', color:'#8b6a2a' },
  { id:'ember', name:'余烬牌', glyph:'✦', blurb:'计分时，按本场第几手 +2 倍注，最多 +8', color:'#a04e36' },
  { id:'mirror', name:'镜面牌', glyph:'◇', blurb:'同手有另一张同点数的计分牌时，本张 +6 倍注', color:'#527484' },
  { id:'anchor', name:'压舱牌', glyph:'⚓', blurb:'计分时，手里还留至少 3 张牌，倍注 ×1.5', color:'#354d70' },
  { id:'comet', name:'彗尾牌', glyph:'☄', blurb:'至少 3 张参与计分，且本张最后计分时，倍注 ×1.6', color:'#71537c' },
];
export const specialById = (id: string | undefined) => SPECIALS.find((x) => x.id === id);
export function specialEffect(c: Card, live: Card[], held: Card[], money: number, seats: number, handIndex: number, index: number): { chips: number; mult: number; xmult: number; note: string } {
  let chips=0, mult=0, xmult=1;
  switch(c.special) {
    case 'crest': chips=12*Math.min(4,seats); break;
    case 'ledger': chips=2*Math.min(25,Math.floor(money)); break;
    case 'ember': mult=Math.min(8,2*(handIndex+1)); break;
    case 'mirror': if(live.some((x)=>x.id!==c.id&&x.rank===c.rank)) mult=6; break;
    case 'anchor': if(held.length>=3) xmult=1.5; break;
    case 'comet': if(live.length>=3&&index===live.length-1) xmult=1.6; break;
  }
  return {chips,mult,xmult,note: specialById(c.special)?.name ?? ''};
}
