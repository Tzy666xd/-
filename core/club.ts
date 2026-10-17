import { CONTRACTS, contractOffer, freshWork } from './contracts.ts';
import type { ContractRun, ContractRecord, NightWork } from './contracts.ts';
import { newStory, storyById } from './stories.ts';
import type { StoryRun } from './stories.ts';
import { HANDS } from './hands.ts';
export interface ClubState {
  night:number; offer:string[]; contract:ContractRun|null; work:NightWork;
  completed:number; archive:ContractRecord[]; story:StoryRun;
}
export const newClub=(seed:number,night=1):ClubState=>({night,offer:contractOffer(seed,night),contract:null,work:freshWork(),completed:0,archive:[],story:newStory(seed)});
const obj=(x:unknown):x is Record<string,unknown>=>!!x&&typeof x==='object'&&!Array.isArray(x);
const int=(x:unknown,max=100000)=>typeof x==='number'&&Number.isSafeInteger(x)&&x>=0&&x<=max;
const text=(x:unknown,max=320)=>typeof x==='string'&&x.length<=max;
export function validClub(x:unknown):x is ClubState {
  if(!obj(x)||!int(x.night)||x.night===0||!int(x.completed)||!obj(x.work))return false;
  if(!Array.isArray(x.offer)||x.offer.length>2||new Set(x.offer).size!==x.offer.length||!x.offer.every(id=>CONTRACTS.some(d=>d.id===id)))return false;
  for(const k of Object.keys(freshWork()).filter(k=>k!=='streak'))if(!int(x.work[k]))return false;
  if(!Array.isArray(x.work.streak)||x.work.streak.length>3||!x.work.streak.every(k=>typeof k==='string'&&Object.hasOwn(HANDS,k))||new Set(x.work.streak).size!==x.work.streak.length)return false;
  if(x.contract!==null){
    const c=x.contract;if(!obj(c)||!CONTRACTS.some(d=>d.id===c.id)||!int(c.night)||c.night!==x.night||!['accepted','ready','claimed','failed'].includes(String(c.status))||!int(c.value,100)||!text(c.result))return false;
  }
  if(!Array.isArray(x.archive)||x.archive.length>60||!x.archive.every(r=>obj(r)&&CONTRACTS.some(d=>d.id===r.id)&&int(r.night)&&text(r.result)&&typeof r.completed==='boolean'))return false;
  const s=x.story;if(!obj(s)||typeof s.id!=='string')return false;
  const def=storyById(s.id);
  return !!def&&int(s.chapter,def.chapters.length-1)&&int(s.due,100001)&&typeof s.done==='boolean'&&text(s.ending)&&Array.isArray(s.history)&&s.history.length<=8&&s.history.every(h=>text(h));
}
