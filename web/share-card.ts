import type { RunReport } from '../core/run-summary.ts';
import { reportText, validReport } from '../core/run-summary.ts';
export const REPORT_KEY='guinea.last-report.v1';
const fmt=(n:number)=>Math.round(n).toLocaleString('en-US');
export function loadReport(): RunReport|null {
  try { const raw=JSON.parse(localStorage.getItem(REPORT_KEY)||'null');return validReport(raw)?raw:null; } catch{return null;}
}
export function saveReport(r: RunReport): boolean {
  try{localStorage.setItem(REPORT_KEY,JSON.stringify(r));return true;}catch{return false;}
}
export function clearReport():void {try{localStorage.removeItem(REPORT_KEY);}catch{}}
export function drawReport(r: RunReport): HTMLCanvasElement {
  const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=1740;
  const c=canvas.getContext('2d')!;
  const ivory='#f4ebd7',ink='#203c32',gold='#b49357', muted='#6e7367';
  c.fillStyle=ivory;c.fillRect(0,0,1200,1740);
  c.strokeStyle='#d8ccb2';c.lineWidth=1;
  for(let y=380;y<1740;y+=32){c.beginPath();c.moveTo(0,y);c.lineTo(1200,y);c.stroke();}
  c.fillStyle=ink;c.fillRect(0,0,1200,320);
  c.strokeStyle=gold;c.lineWidth=2;c.strokeRect(36,36,1128,1668);
  function text(s:string,x:number,y:number,size:number,color=ink,font='PingFang SC, sans-serif') {c.fillStyle=color;c.font=`${size}px ${font}`;c.fillText(s,x,y);}
  function line(s:string,x:number,y:number,width:number,size=24,color=ink):number {
    let row='';let yy=y;c.font=`${size}px PingFang SC, sans-serif`;
    for(const ch of s){if(c.measureText(row+ch).width>width){text(row,x,yy,size,color);row='';yy+=size*1.55;}row+=ch;}if(row)text(row,x,yy,size,color);return yy+size*1.55;
  }
  text('几 尼',80,120,64,'#f4ebd7','Baskerville, serif');
  text('PRIVATE TABLE  /  RUN REPORT',82,168,18,'#ccb88b','Baskerville, serif');
  text(r.won?'堂 局 · 满堂尽兴':'散 场 · 下次再会',80,247,38,'#e4c789');
  text(r.date,920,122,22,'#ccb88b');
  line(`${r.mode} · ${r.diff} · ${r.deck} · ${r.nights} 夜`,80,286,1030,23,'#e8ddc7');
  const metrics=[['撑过场次',String(r.cleared)],['最高单场',fmt(r.bestStage)],['最佳单手',fmt(r.bestHand)],['银钱',`£${fmt(r.money)}`],['声望',String(r.rep)],['出牌 / 弃牌',`${r.plays} / ${r.discards}`]];
  metrics.forEach(([label,value],i)=>{const x=80+(i%3)*350,y=395+Math.floor(i/3)*135;text(label,x,y,22,muted);text(value,x,y+62,value.length>12?30:44,ink,'Baskerville, serif');});
  text('流 水 曲 线',80,687,22,muted);
  const chart={x:85,y:720,w:1030,h:180};
  c.strokeStyle='#d3c6aa';c.beginPath();c.moveTo(chart.x,chart.y+chart.h);c.lineTo(chart.x+chart.w,chart.y+chart.h);c.stroke();
  const max=Math.max(1,...r.curve);
  if(r.curve.length){c.strokeStyle=ink;c.lineWidth=4;c.beginPath();r.curve.forEach((v,i)=>{const x=chart.x+(r.curve.length===1?chart.w/2:i*chart.w/(r.curve.length-1)),y=chart.y+chart.h-v/max*(chart.h-25);if(i===0)c.moveTo(x,y);else c.lineTo(x,y);});c.stroke();c.fillStyle=gold;r.curve.forEach((v,i)=>{const x=chart.x+(r.curve.length===1?chart.w/2:i*chart.w/(r.curve.length-1)),y=chart.y+chart.h-v/max*(chart.h-25);c.beginPath();c.arc(x,y,5,0,Math.PI*2);c.fill();});}
  text(r.curve.length?'按场次记录 · 最近最多 45 场':'还没有场次记录',80,933,19,muted);
  text(`最高 ${fmt(max)} · 最后一场 ${fmt(r.curve.at(-1)??0)}`,690,933,19,muted);
  function clipped(s:string,y:number,size=23):void {
    c.font=`${size}px PingFang SC, sans-serif`;
    while(c.measureText(s).width>1030)s=s.slice(0,-2)+'…';
    text(s,80,y,size);
  }
  clipped(`主攻牌型  ${r.mainHand}  /  累计入账 ${fmt(r.totalScore)}`,990);
  clipped(`最终客人  ${r.guests.join(' · ')||'空席'}`,1035);
  clipped(`稀奇牌  ${r.rareCards.join(' · ')||'这一局未遇见'}`,1080,22);
  clipped(`会员特权  ${r.privileges.join(' · ')||'无'}`,1125,22);
  text(r.choices.length>4?'关 键 选 择  ·  节选 4 条，文案保留完整记录':'关 键 选 择',80,1182,22,muted);
  let y=1232;
  const choices=r.choices.length?r.choices:['这一局尚未留下经营选择。'];
  for(const [i,s] of choices.slice(-4).entries()){
    text(`0${i+1}`,80,y,22,gold,'Baskerville, serif');
    const short=s.length>66?s.slice(0,65)+'…':s;
    y=line(short,135,y,970,22)+13;
  }
  c.fillStyle=ink;c.fillRect(60,1610,1080,78);
  text(`种子  ${r.seed}  ·  几尼`,80,1657,22,'#eee0bd');
  text(r.partial?'旧档续局 · 部分统计自更新后记录':'分享种子与开局配置，一起从这副牌开始',80,1717,18,muted);
  return canvas;
}
let requestId=0;
export function nativeShare(action:'export'|'share'|'copy',r:RunReport,canvas:HTMLCanvasElement): number {
  const id=++requestId;
  const bridge=(window as unknown as {webkit?:{messageHandlers?:{guinea?:{postMessage:(value:unknown)=>void}}}}).webkit?.messageHandlers?.guinea;
  if(!bridge)throw Error('请在几尼应用中导出图片。');
  bridge.postMessage(action==='copy'?{action,id,text:reportText(r)}:{action,id,png:canvas.toDataURL('image/png').split(',')[1],name:`几尼-${r.date.replace(/[^0-9]/g,'')}-${r.seed}.png`});
  return id;
}
