(function(){
  var H=window.__H,q=function(s){return document.querySelector(s);};
  var mode=new URLSearchParams(location.search).get('regression');
  function finish(ok,name,data){window.__UITEST_RESULT='UITEST '+(ok?'PASS':'FAIL')+' [club-regression-'+name+'] '+JSON.stringify(data);}
  H.start(4242);
  if(mode==='loss'){
    H.game.state.handsLeft=1;H.game.state.buffer=0;H.game.state.hand[0].rank=2;H.render();q('#tray .card').click();q('#btnPlay').click();
    var report=JSON.parse(localStorage.getItem('guinea.last-report.v1')||'null'),gap={status:H.game.state.status,reportSeed:report&&report.seed};
    H.start(5555);
    setTimeout(function(){var saved=JSON.parse(localStorage.getItem('guinea.save.v1')||'null');var after={seed:H.game.state.seed,status:H.game.state.status,savedSeed:saved&&saved.state.seed,endHidden:q('#endcard').classList.contains('hidden')};
      finish(gap.status==='lost'&&gap.reportSeed===4242&&after.seed===5555&&after.status==='playing'&&after.savedSeed===5555&&after.endHidden,'loss',{gap:gap,after:after});},80);
    return '';
  }
  if(mode==='curtain'){
    H.game.state.books.high=100;H.render();q('#tray .card').click();q('#btnPlay').click();
    setTimeout(function(){var old={status:H.game.state.status,visible:!q('#curtain').classList.contains('hidden')};H.start(6666);var hiddenImmediately=q('#curtain').classList.contains('hidden');q('#btnCurtainOk').click();
      setTimeout(function(){var after={status:H.game.state.status,stage:H.game.state.stage,ledger:H.game.state.ledger.length,hidden:q('#curtain').classList.contains('hidden'),shop:q('#shop').classList.contains('open')};
        finish(old.status==='cleared'&&old.visible&&hiddenImmediately&&after.status==='playing'&&after.stage===0&&after.ledger===0&&after.hidden&&!after.shop,'curtain',{old:old,hiddenImmediately:hiddenImmediately,after:after});},80);
    },40);return '';
  }
  if(mode==='events'){
    H.start(4242,'standard',{flags:{events:true}});H.game.state.buffer=0;H.game.state.handsLeft=1;H.game.state.pendingEvent=['candle-roll'];H.render();q('[data-eid="candle-roll"]').click();
    var ended=H.game.state.status==='lost'&&!q('#endcard').classList.contains('hidden')&&!!localStorage.getItem('guinea.last-report.v1');
    H.start(4242,'standard',{flags:{events:true}});H.game.state.buffer=0;H.game.state.handsLeft=1;H.game.state.pendingEvent=['candle-roll'];H.render();q('#btnEventAuto').click();
    var automatic=H.game.state.status==='lost'&&!q('#endcard').classList.contains('hidden');
    finish(ended&&automatic,'events',{manual:ended,automatic:automatic});return '';
  }
  return 'UITEST FAIL [club-regression] unknown mode';
})();
