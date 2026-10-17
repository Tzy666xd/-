#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="${SHOT_OUT:-shots/club}"
BIN='dist/几尼.app/Contents/MacOS/Guinea'
mkdir -p "$OUT"
BOOT='localStorage.clear();localStorage.setItem("guinea.prefs.v1",JSON.stringify({guide:true,tutorial:false,muted:true,flags:{club:true,events:true,sets:true,growth:true,adjacency:true,layers:true}}));'
shot() {
  local name="$1" script="$2" window="${3:-1400x860}"
  "$BIN" --shot "$OUT/$name.png" --boot "$BOOT" --query 'snap=1&seed=4242' --anim "$script" --burst 0 --delay 650 --window "$window"
  test -s "$OUT/$name.png"
}
shot '01-委托邀约' 'window.__H.start(4242);window.__H.game.state.club.offer=["thrift","hearts"];window.__H.render();'
shot '02-跨夜来信' 'var H=window.__H;H.start(4242);var s=H.game.state;s.money=30;s.night=2;s.club.night=2;s.club.offer=[];s.club.story={id:"lost-ledger",chapter:1,due:2,done:false,history:["柜台下的羊皮册：付 £3 收下"],ending:""};H.render();'
shot '03-自选稀奇牌奖励' 'var H=window.__H;H.start(4242);H.game.state.club.offer=[];H.game.state.club.work.curios=4;H.game.state.club.contract={id:"curios",night:1,status:"ready",value:4,result:""};H.render();'
shot '04-新牌与新客' 'var H=window.__H;H.start(4242);H.closePanels();H.seat("solicitor");H.seat("archivist");H.seat("courier");H.seat("sponsor","negative");var kinds=["relay","collector","salvage","bond","sealed","spectrum","modest","reserve"];H.game.state.hand.forEach(function(c,i){c.special=kinds[i];c.charge=i===1?4:i===2?2:i===3?1:0;if(i===4)c.seal="red";});H.render();'
shot '05-小窗口委托' 'window.__H.start(4242);window.__H.game.state.club.offer=["thrift","hearts"];window.__H.render();' '1080x680'
