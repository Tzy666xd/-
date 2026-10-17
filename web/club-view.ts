import { CONTRACTS, contractById } from '../core/contracts.ts';
import { storyById } from '../core/stories.ts';
import { SPECIALS } from '../core/special-cards.ts';
import { BOOKS, patronById } from '../core/content.ts';
import { HANDS, SECRET_HANDS } from '../core/hands.ts';
import { CLUB_CARDS, CLUB_GUESTS, storyChapter, totalCards, MAX_DECK, seatedCount, limits } from '../core/game.ts';
import type { Game } from '../core/game.ts';
interface Actions { accept:(id:string)=>void; skip:()=>void; claim:(id:string)=>void; story:(id:string)=>void; busy:boolean }
const node=(tag:string,cls:string,text='')=>{const n=document.createElement(tag);n.className=cls;n.textContent=text;return n;};
export function renderClub(g:Game,root:HTMLElement,a:Actions):void {
  root.replaceChildren();const s=g.state,c=s.club;
  if(!s.flags.club||!c){root.append(node('p','club-intro','开局选择「经营奇遇」，即可体验每夜委托与四条跨夜故事。当前牌局的规则已固定。'));return;}
  const terminal=s.status==='won'||s.status==='lost';
  const button=(text:string,action:()=>void,reason='')=>{
    const b=node('button','club-choice',text) as HTMLButtonElement;
    b.disabled=a.busy||terminal||s.pendingEvent.length>0||!!reason;b.title=reason||(terminal?'本局已结束':s.pendingEvent.length?'先处理牌桌上的随机事件':a.busy?'请等待本手演出结束':'');b.addEventListener('click',action);return b;
  };
  const reward=(text:string,key:string,reason='')=>{const b=button(text,()=>a.claim(key),reason);b.dataset.reward=key;return b;};
  root.append(node('p','club-intro',`第 ${s.night} 夜 · 每夜最多一份委托 · 已履约 ${c.completed} 份。奖励之外，每次履约另得 1 声望。`));
  const contractBox=node('section','club-section');contractBox.append(node('h3','','宾 客 委 托'));
  if(c.offer.length){
    contractBox.append(node('p','club-muted','首个出牌或弃牌动作前可接一份；直接开打视为谢绝，本夜没有额外惩罚。'));
    const grid=node('div','club-options');
    for(const id of c.offer){const d=contractById(id)!;
      const card=node('article','club-contract');card.dataset.contract=id;card.append(node('h4','',d.name),node('p','',d.blurb),node('p','club-reward',`奖励：${{book:'任选一本已解锁牌谱升级',card:'任选一张新稀奇牌',guest:'定向邀请四位新客人之一',money:'银钱'}[d.reward]}；或领取 £${d.cash}。`),button('接受这份委托',()=>a.accept(id)));
      grid.append(card);
    }
    contractBox.append(grid,button('本夜谢绝委托',a.skip));
  }else if(c.contract){
    const r=c.contract,d=contractById(r.id)!;
    contractBox.append(node('h4','',d.name),node('p','',d.blurb));
    const label={accepted:'进行中',ready:'已达成 · 请选择奖励',claimed:'已履约',failed:'本夜未达成'}[r.status];
    contractBox.append(node('p','club-progress',`${label} · ${r.value}/${d.goal}${d.endOnly&&r.status==='accepted'?' · 本夜第三场结清时核定':''}`));
    const bar=node('progress','') as HTMLProgressElement;bar.max=d.goal;bar.value=r.value;bar.setAttribute('aria-label',`${d.name}进度`);contractBox.append(bar);
    if(r.status==='ready'){
      contractBox.append(node('p','club-muted','奖励只领一次；满座或牌组已满时，仍可选择银钱。请在下一夜前领取。'));
      const grid=node('div','club-options rewards');
      grid.append(reward(`领取 £${d.cash}，声望 +1`,'cash'));
      if(d.reward==='book')for(const b of BOOKS){if(SECRET_HANDS.includes(b.kind)&&!s.discovered.includes(b.kind))continue;grid.append(reward(`${HANDS[b.kind].name} 升一级`,'book:'+b.kind));}
      if(d.reward==='card')for(const id of CLUB_CARDS){const rare=SPECIALS.find(d=>d.id===id)!;grid.append(reward(`${rare.glyph} ${rare.name}｜${rare.blurb}`,'card:'+id,totalCards(s)>=MAX_DECK?'牌组已满，可选银钱':''));}
      if(d.reward==='guest')for(const id of CLUB_GUESTS){const p=patronById(id);grid.append(reward(`${p.name}｜${p.blurb}`,'guest:'+id,s.seats.some(x=>x.pid===id)?'这位客人已入席':seatedCount(s)>=limits(s).seats?'座位已满，可先在铺子请客离席或选择银钱':''));}
      contractBox.append(grid);
    }
    if(r.result)contractBox.append(node('p','club-reward',r.result));
  }else contractBox.append(node('p','club-muted','本夜未接委托。下一夜开场会收到两份新邀约。'));
  root.append(contractBox);

  const story=node('section','club-section'),run=c.story,def=storyById(run.id)!;
  story.append(node('h3','',def.name));
  if(run.history.length){story.append(node('p','club-muted','此前的选择'));for(const h of run.history)story.append(node('p','club-history',h));}
  if(run.done)story.append(node('p','club-ending',`结局 · ${run.ending}`));
  else {
    const chapter=storyChapter(s);
    if(chapter){story.append(node('h4','',chapter.title),node('p','',chapter.text));
      for(const choice of chapter.choices){
        const cost=choice.ops.reduce((n,op)=>n+(op.t==='money'&&op.n<0?-op.n:0),0);
        const reason=s.money<cost?`需要 £${cost}`:choice.ops.some(op=>op.t==='addCard'&&totalCards(s)+op.cards.length>MAX_DECK)?'牌组已满，请选择其他报酬':'';
        const b=button(`${choice.name}｜${choice.blurb}`,()=>a.story(choice.id),reason);b.dataset.storyChoice=choice.id;story.append(b);
      }
    }else story.append(node('p','club-muted',`下一封消息将在第 ${run.due} 夜到来。故事会随存档保留。`));
  }
  root.append(story);
  if(c.archive.length){const past=node('section','club-section');past.append(node('h3','','履 约 记 录'));for(const r of c.archive.slice(-8).reverse())past.append(node('p','club-history',`第 ${r.night} 夜 · ${contractById(r.id)?.name} · ${r.result}`));root.append(past);}
  const catalog=node('details','club-catalog');catalog.append(node('summary','',`查看全部 ${CONTRACTS.length} 份委托`));for(const d of CONTRACTS)catalog.append(node('p','',`${d.name}：${d.blurb}`));root.append(catalog);
}
