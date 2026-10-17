import type { EventOp } from './events.ts';
export interface StoryChoice { id:string; name:string; blurb:string; next:number; ops:EventOp[]; ending?:string }
export interface StoryChapter { title:string; text:string; choices:StoryChoice[] }
export interface StoryDef { id:string; name:string; chapters:StoryChapter[] }
export interface StoryRun { id:string; chapter:number; due:number; done:boolean; history:string[]; ending:string }
export const STORIES:StoryDef[]=[
  {id:'lost-ledger',name:'失踪的账本',chapters:[
    {title:'柜台下的羊皮册',text:'账页夹着一枚铜钥匙。封面上的名字被刮掉了。',choices:[
      {id:'keep',name:'付 £3 收下',blurb:'花 £3；下一夜寻找失主',next:1,ops:[{t:'money',n:-3}]},
      {id:'sell',name:'卖给旧书摊',blurb:'得 £5；故事结束',next:0,ops:[{t:'money',n:5}],ending:'旧账换新钱'}]},
    {title:'两位索书人',text:'律师拿着委托书，陌生人却知道钥匙属于哪扇门。你信谁？',choices:[
      {id:'law',name:'请律师核验',blurb:'得 £4；下一夜迎接账本主人',next:2,ops:[{t:'money',n:4}]},
      {id:'door',name:'跟着钥匙查下去',blurb:'花 £2；下一夜打开密室',next:3,ops:[{t:'money',n:-2}]}]},
    {title:'一份正式的谢礼',text:'账本终于物归原主。主人请你自己挑一种报酬。',choices:[
      {id:'cash',name:'收下酬金',blurb:'得 £14；故事结束',next:0,ops:[{t:'money',n:14}],ending:'完璧归赵'},
      {id:'card',name:'留下旧账票',blurb:'获得方片 8「债券牌」进牌组；故事结束',next:0,ops:[{t:'addCard',cards:[{rank:8,suit:'d',special:'bond'}]}],ending:'账页里的股息'}]},
    {title:'密室里的收藏',text:'门后没有金库，只有一副被小心封存的旧牌。',choices:[
      {id:'collect',name:'收藏其中一张',blurb:'获得梅花 K「收藏牌」进牌组；故事结束',next:0,ops:[{t:'addCard',cards:[{rank:13,suit:'c',special:'collector'}]}],ending:'密室收藏家'},
      {id:'close',name:'封门退还',blurb:'得 £8、声望 +2；故事结束',next:0,ops:[{t:'money',n:8},{t:'rep',n:2}],ending:'守口如瓶'}]},
  ]},
  {id:'night-post',name:'午夜邮差',chapters:[
    {title:'一封没有地址的信',text:'邮差把信交给你，说收信人总会来你的牌局。',choices:[
      {id:'hold',name:'替他保管',blurb:'得 £2；下一夜等待来客',next:1,ops:[{t:'money',n:2}]},
      {id:'return',name:'退回邮局',blurb:'得 £4；故事结束',next:0,ops:[{t:'money',n:4}],ending:'准时退信'}]},
    {title:'红蜡与蓝蜡',text:'两位来客都认出了信。你决定在什么条件下交出去。',choices:[
      {id:'witness',name:'请人见证交接',blurb:'花 £3；下一夜收到正式回信',next:2,ops:[{t:'money',n:-3}]},
      {id:'quiet',name:'悄悄递给邮差',blurb:'声望 +1；下一夜收到私人回礼',next:3,ops:[{t:'rep',n:1}]}]},
    {title:'封口完整的回信',text:'回信感谢你的谨慎，夹着一张压平的红蜡牌。',choices:[
      {id:'seal',name:'留下火漆牌',blurb:'获得红心 Q「封缄牌」，带红蜡封；故事结束',next:0,ops:[{t:'addCard',cards:[{rank:12,suit:'h',special:'sealed',seal:'red'}]}],ending:'封缄的信任'},
      {id:'fee',name:'领取见证费',blurb:'得 £13；故事结束',next:0,ops:[{t:'money',n:13}],ending:'有据可查'}]},
    {title:'邮差的私人路线',text:'他从衣袋里拿出一张能替下一位铺路的牌。',choices:[
      {id:'relay',name:'收下接力牌',blurb:'获得黑桃 9「接力牌」进牌组；故事结束',next:0,ops:[{t:'addCard',cards:[{rank:9,suit:'s',special:'relay'}]}],ending:'午夜接力'},
      {id:'cash',name:'收取递送费',blurb:'得 £9、声望 +1；故事结束',next:0,ops:[{t:'money',n:9},{t:'rep',n:1}],ending:'一路顺风'}]},
  ]},
  {id:'broken-cabinet',name:'旧牌匣',chapters:[
    {title:'拍卖散场之后',text:'无人出价的牌匣留在门边，里面有几张被折过角的牌。',choices:[
      {id:'repair',name:'花 £2 修好它',blurb:'花 £2；下一夜寻找修复师',next:1,ops:[{t:'money',n:-2}]},
      {id:'scrap',name:'卖掉铜扣',blurb:'得 £4；故事结束',next:0,ops:[{t:'money',n:4}],ending:'零碎的价值'}]},
    {title:'修复师的两种手艺',text:'她能保留磨损，也能把一切擦得像新的一样。',choices:[
      {id:'patina',name:'保留旧痕',blurb:'声望 +1；下一夜取回旧牌',next:2,ops:[{t:'rep',n:1}]},
      {id:'polish',name:'付 £3 重新上漆',blurb:'花 £3；下一夜取回新牌',next:3,ops:[{t:'money',n:-3}]}]},
    {title:'折角也有用处',text:'每一道折角都记着一次被弃掉又回来的经历。',choices:[
      {id:'salvage',name:'留作牌局使用',blurb:'获得梅花 6「拾遗牌」进牌组；故事结束',next:0,ops:[{t:'addCard',cards:[{rank:6,suit:'c',special:'salvage'}]}],ending:'弃牌的第二次机会'},
      {id:'museum',name:'转赠藏家',blurb:'得 £10、声望 +1；故事结束',next:0,ops:[{t:'money',n:10},{t:'rep',n:1}],ending:'岁月有价'}]},
    {title:'四种颜色的漆',text:'牌匣里最上面那张，在灯下映出四种花色。',choices:[
      {id:'spectrum',name:'留下彩窗牌',blurb:'获得方片 J「彩窗牌」进牌组；故事结束',next:0,ops:[{t:'addCard',cards:[{rank:11,suit:'d',special:'spectrum'}]}],ending:'彩窗新生'},
      {id:'sale',name:'将牌匣售出',blurb:'得 £16；故事结束',next:0,ops:[{t:'money',n:16}],ending:'焕然一新的买卖'}]},
  ]},
  {id:'empty-seat',name:'空席的约定',chapters:[
    {title:'提前一夜的预约',text:'一位戴灰手套的客人，希望你为明晚保留一盏灯。',choices:[
      {id:'invite',name:'答应留灯',blurb:'得 £3；下一夜听他的提议（无需空出座位）',next:1,ops:[{t:'money',n:3}]},
      {id:'decline',name:'婉言谢绝',blurb:'得 £2、声望 +1；故事结束',next:0,ops:[{t:'money',n:2},{t:'rep',n:1}],ending:'体面的谢绝'}]},
    {title:'他带来两种生意',text:'一边是小而精的牌局，一边是把积蓄押在下一次机会。',choices:[
      {id:'small',name:'选择小桌',blurb:'声望 +1；下一夜收到小宴请柬',next:2,ops:[{t:'rep',n:1}]},
      {id:'reserve',name:'准备最后一搏',blurb:'花 £3；下一夜收到备用牌',next:3,ops:[{t:'money',n:-3}]}]},
    {title:'三张牌的宴席',text:'请柬上写着：少一点，也可以很精彩。',choices:[
      {id:'modest',name:'收下小宴牌',blurb:'获得红心 3「小宴牌」进牌组；故事结束',next:0,ops:[{t:'addCard',cards:[{rank:3,suit:'h',special:'modest'}]}],ending:'小宴尽兴'},
      {id:'fee',name:'接受赞助',blurb:'得 £10、声望 +1；故事结束',next:0,ops:[{t:'money',n:10},{t:'rep',n:1}],ending:'灯下的赞助'}]},
    {title:'留到最后的礼物',text:'灰手套把最后一张牌留在你的牌堆里。',choices:[
      {id:'reserve',name:'收下后备牌',blurb:'获得黑桃 A「后备牌」进牌组；故事结束',next:0,ops:[{t:'addCard',cards:[{rank:14,suit:'s',special:'reserve'}]}],ending:'留有后手'},
      {id:'cash',name:'换成经营本金',blurb:'得 £15；故事结束',next:0,ops:[{t:'money',n:15}],ending:'稳妥的本金'}]},
  ]},
];
export const storyById=(id:string)=>STORIES.find(s=>s.id===id);
export function newStory(seed:number):StoryRun {
  return {id:STORIES[(seed>>>0)%STORIES.length].id,chapter:0,due:1,done:false,history:[],ending:''};
}
