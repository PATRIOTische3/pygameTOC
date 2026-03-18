// ════════════════════════════════════════════════════════════
//  TIME OF CONQUEST — MULTIPLAYER v4.3
//  Version: MAJOR.MINOR.PATCH-YYMMDD
//  MAJOR=engine rewrite  MINOR=new system  PATCH=fix
//
//  KEY FIX: timestamp filter — each client only processes
//  messages with _ts > their own join time. No stale replay.
//  Self-messages filtered by _pid field.
// ════════════════════════════════════════════════════════════

const MP = (() => {

  const FB = (window.TOC_FIREBASE_URL ||
    'https://timeofconquest-default-rtdb.europe-west1.firebasedatabase.app'
  ).replace(/\/$/,'');

  // state
  let role=null, roomId=null, myNation=-1, myPid=null;
  let connected=false, myTurn=false;
  let _poll=null, _joinTs=0, _lastStateTs=0;
  let _origET=null;
  let players=[], playerOrder=[], turnIdx=0;
  let _delta=mkDelta();

  // AFK
  let _afkW=null,_afkK=null;
  const AFK_W=90000,AFK_K=60000;
  function afkReset(){clearTimeout(_afkW);clearTimeout(_afkK);}
  function afkStart(){
    afkReset();
    _afkW=setTimeout(()=>{
      if(!connected||myTurn)return;
      send('PING',{target:curNation()});
      _afkK=setTimeout(()=>{if(role==='host')kickCurrent();},AFK_K);
    },AFK_W);
  }
  function curNation(){return playerOrder[turnIdx%Math.max(1,playerOrder.length)];}
  function kickCurrent(){
    const n=curNation(),nm=nname(n);
    players=players.filter(p=>p.nation!==n);
    playerOrder=playerOrder.filter(x=>x!==n);
    if(turnIdx>=playerOrder.length)turnIdx=0;
    send('KICKED',{nation:n});
    banner(nm+' removed (AFK) — AI takes over');
    if(playerOrder.length)advanceTurn();
  }
  function banner(msg){
    const o=document.getElementById('_mpbanner');if(o)o.remove();
    if(!document.getElementById('_mpbs')){const s=document.createElement('style');s.id='_mpbs';s.textContent='@keyframes _mptk{0%{transform:translateX(0%)}100%{transform:translateX(-100%)}}';document.head.appendChild(s);}
    const b=document.createElement('div');b.id='_mpbanner';
    b.style.cssText='position:fixed;top:0;left:0;right:0;z-index:900;height:28px;background:#2a0808;border-bottom:1px solid #c03030;overflow:hidden;display:flex;align-items:center;';
    const t=document.createElement('div');t.style.cssText='white-space:nowrap;font-family:Cinzel,serif;font-size:11px;color:#ff6060;padding-left:100%;animation:_mptk 8s linear forwards';
    t.textContent='⚡ '+msg;b.appendChild(t);document.body.prepend(b);
    const h=document.getElementById('hud');if(h)h.style.marginTop='28px';
    setTimeout(()=>{b.remove();if(h)h.style.marginTop='';},8500);
  }

  // Firebase helpers
  async function fbSet(p,d){try{await fetch(FB+'/'+p+'.json',{method:'PUT',body:JSON.stringify(d)});}catch(e){}}
  async function fbPush(p,d){try{await fetch(FB+'/'+p+'.json',{method:'POST',body:JSON.stringify(d)});}catch(e){}}
  async function fbGet(p){try{const r=await fetch(FB+'/'+p+'.json');return r.ok?r.json():null;}catch(e){return null;}}
  async function fbDel(p){try{await fetch(FB+'/'+p+'.json',{method:'DELETE'});}catch(e){}}

  // Send a message (push to msgs channel)
  function send(type,payload){
    if(!roomId)return;
    return fbPush('rooms/'+roomId+'/msgs',Object.assign({type,_pid:myPid,_nation:myNation,_ts:Date.now()},payload||{}));
  }

  // Host pushes full state to state node
  async function pushState(){
    const snap=JSON.parse(JSON.stringify(G,(k,v)=>v instanceof Set?[...v]:v));
    await fbSet('rooms/'+roomId+'/state',{snap,playerOrder,turnIdx,players,_ts:Date.now()});
  }

  // Polling
  function startPoll(){
    if(_poll)clearInterval(_poll);
    _poll=setInterval(async()=>{
      if(!roomId)return;
      const msgs=await fbGet('rooms/'+roomId+'/msgs');
      if(msgs&&typeof msgs==='object'){
        Object.values(msgs)
          .filter(m=>m&&m._ts>_joinTs&&m._pid!==myPid)  // only fresh, not own
          .sort((a,b)=>a._ts-b._ts)
          .forEach(m=>{
            _joinTs=Math.max(_joinTs,m._ts); // advance window
            try{handle(m);}catch(e){console.error('MP:',m.type,e);}
          });
      }
      // non-host: poll state
      if(role==='player'){
        const st=await fbGet('rooms/'+roomId+'/state');
        if(st&&st._ts>_lastStateTs){_lastStateTs=st._ts;applyState(st);}
      }
    },1500);
  }
  function stopPoll(){if(_poll){clearInterval(_poll);_poll=null;}}

  // Apply state snapshot (non-host)
  function applyState(d){
    if(!d||!d.snap)return;
    const pn=G.playerNation,ide=G.ideology;
    Object.assign(G,d.snap);
    fixSets();
    G.playerNation=pn;G.ideology=ide;
    if(d.playerOrder)playerOrder=d.playerOrder;
    if(d.turnIdx!==undefined)turnIdx=d.turnIdx;
    if(d.players)players=d.players;
    updateHUD();updateIdeoHUD();updateSeasonUI();scheduleDraw();
    if(G.sel>=0)updateSP(G.sel);
    const active=playerOrder[turnIdx%Math.max(1,playerOrder.length)];
    setWait(active!==myNation);
  }

  function fixSets(){
    if(G.epidemics)G.epidemics.forEach(ep=>{if(Array.isArray(ep.provinces))ep.provinces=new Set(ep.provinces);});
    if(!G._allyEpicNotified)G._allyEpicNotified=new Set();
    else if(Array.isArray(G._allyEpicNotified))G._allyEpicNotified=new Set(G._allyEpicNotified);
    if(!G.moveQueue)G.moveQueue=[];
    if(!G.battleQueue)G.battleQueue=[];
    if(!G._enemyAttackQueue)G._enemyAttackQueue=[];
  }

  // Message handler
  function handle(msg){
    switch(msg.type){

    case 'PLAYER_JOINED':
      if(role!=='host')break;
      log('👤 Player joining…','ok');
      // Send lobby state — joiner will see it on next poll
      send('LOBBY_STATE',{
        taken:players.map(p=>p.nation),
        roster:players.map(p=>({n:p.nation,name:p.name}))
      });
      break;

    case 'LOBBY_STATE':
      if(role!=='player')break;
      log('🗺 Pick your nation','ok');
      status('Pick your nation…','connecting');
      showPick(msg.taken||[]);
      const pl=document.getElementById('mp-players-list');
      if(pl&&msg.roster)pl.innerHTML=(msg.roster||[]).map(p=>'<div style="font-size:9px;color:var(--dim)">● '+p.name+'</div>').join('');
      break;

    case 'PLAYER_READY':{
      if(role!=='host')break;
      const nm=msg.name||nname(msg._nation);
      players=players.filter(p=>p.id!==msg._pid);
      players.push({id:msg._pid,nation:msg._nation,name:nm});
      taken(msg._nation);
      log('✅ '+nm+' ready!','ok');
      hostUI();
      if(players.length>=2){
        const b=document.getElementById('mp-start-game-btn');
        if(b)b.removeAttribute('disabled');
      }
      // Broadcast updated taken list to all
      send('LOBBY_STATE',{
        taken:players.map(p=>p.nation),
        roster:players.map(p=>({n:p.nation,name:p.name}))
      });
      break;
    }

    case 'NATION_CLAIMED':
      taken(msg.nation);
      if(role==='host'){
        const ex=players.find(p=>p.id===msg._pid);
        if(ex)ex.nation=msg.nation;
        hostUI();
      }
      break;

    case 'GAME_START':
      if(role!=='player')break;
      playerOrder=msg.playerOrder||[];
      turnIdx=msg.turnIdx||0;
      players=msg.players||[];
      Object.assign(G,msg.state);
      fixSets();
      G.playerNation=myNation;
      G.ideology=(NATIONS[myNation]&&NATIONS[myNation].ideology)||'democracy';
      connected=true;
      _lastStateTs=msg._ts||0;
      show('game');
      setTimeout(()=>{
        computeHexRadius();buildCanvas();zoomReset();
        updateHUD();updateIdeoHUD();updateSeasonUI();
        addLog('🌐 Multiplayer started!','diplo');
        const ord=playerOrder.indexOf(myNation)+1;
        popup('🎲 You are #'+ord+' in turn order',3000);
        addLog('🎲 Turn order #'+ord,'event');
        _delta=mkDelta();
        setWait(playerOrder[turnIdx%Math.max(1,playerOrder.length)]!==myNation);
      },80);
      log('🎮 Game started!','ok');
      break;

    case 'PLAYER_DELTA':
      if(role!=='host')break;
      applyDelta(msg.delta||{},msg._nation);
      advanceTurn();
      break;

    case 'PING':
      if(msg.target===myNation)send('PONG',{});
      break;
    case 'PONG':
      afkReset();if(!myTurn)afkStart();
      break;

    case 'KICKED':
      if(msg.nation===myNation){banner('You were removed (AFK)');toSingle();}
      else{banner(nname(msg.nation)+' removed (AFK) — AI takes over');
        players=players.filter(p=>p.nation!==msg.nation);
        playerOrder=playerOrder.filter(n=>n!==msg.nation);}
      break;

    case 'CHAT':{
      const who=nname(msg._nation);
      addLog('💬 '+who+': '+msg.text,'diplo');popup('💬 '+who+': '+msg.text,3500);
      break;
    }
    }
  }

  // Host: advance to next player
  async function advanceTurn(){
    if(!playerOrder.length)return;
    turnIdx=(turnIdx+1)%playerOrder.length;
    if(turnIdx===0&&_origET)_origET(); // full round = run AI+time
    await pushState();
    const next=playerOrder[turnIdx];
    log('⏩ Turn → '+nname(next),'info');
    if(next===myNation)setWait(false);
    else{setWait(true);afkStart();}
  }

  // Apply player's delta actions
  function applyDelta(d,nation){
    (d.moves||[]).forEach(m=>{
      G.army[m.from]=Math.max(0,(G.army[m.from]||0)-m.amt);
      G.army[m.to]=(G.army[m.to]||0)+m.amt;
      if(G.owner[m.to]<0)G.owner[m.to]=nation;
    });
    (d.drafts||[]).forEach(x=>{
      G.army[x.prov]=(G.army[x.prov]||0)+x.amt;
      G.pop[x.prov]=Math.max(500,(G.pop[x.prov]||0)-x.amt);
      G.gold[nation]=Math.max(0,(G.gold[nation]||0)-x.cost);
    });
    (d.builds||[]).forEach(x=>{
      G.gold[nation]=Math.max(0,(G.gold[nation]||0)-x.cost);
      (G.buildings[x.prov]=G.buildings[x.prov]||[]).push(x.bld);
    });
    (d.attacks||[]).forEach(x=>{
      const en=G.owner[x.to];
      if(en>=0&&en!==nation){G.war[nation][en]=true;G.war[en][nation]=true;}
      if(!G.battleQueue)G.battleQueue=[];
      G.battleQueue.push({fr:x.from,to:x.to,force:x.force});
    });
  }

  function toSingle(){
    stopPoll();afkReset();
    if(roomId)fbDel('rooms/'+roomId);
    role=null;roomId=null;connected=false;myTurn=false;myNation=-1;
    if(_origET){window.endTurn=_origET;_origET=null;}
    document.querySelectorAll('#mp-ingame-bar,#mp-turn-indicator-wrap').forEach(e=>e&&(e.style.display='none'));
    document.querySelectorAll('#side-panel,#bottom').forEach(e=>e&&(e.style.opacity='1',e.style.pointerEvents=''));
    document.querySelectorAll('#end-btn,#end-btn-mob').forEach(e=>e&&(e.disabled=false));
    addLog('🤖 Continuing as singleplayer.','diplo');scheduleDraw();updateHUD();
  }

  // UI helpers
  function showPick(takenList){
    const panel=document.getElementById('mp-guest-pick-panel');
    if(panel){panel.style.display='flex';panel.style.flexDirection='column';}
    const list=document.getElementById('mp-guest-nation-list');if(!list)return;
    list.innerHTML=NATIONS.map((n,i)=>{
      const t=(takenList||[]).includes(i);
      return '<div id="mpn'+i+'" onclick="'+(t?'':('MP.claimNation('+i+')'))+'" style="display:flex;align-items:center;gap:8px;padding:6px 10px;border:1px solid var(--border);cursor:'+(t?'not-allowed':'pointer')+';opacity:'+(t?'.35':'1')+';margin-bottom:3px;background:rgba(0,0,0,.2)">'
        +'<div style="width:13px;height:13px;border-radius:2px;background:'+n.color+'"></div>'
        +'<span style="font-family:Cinzel,serif;font-size:10px;flex:1">'+n.name+'</span>'
        +'<span style="font-size:8px;color:var(--dim)">'+(t?'✗ taken':n.ideology)+'</span></div>';
    }).join('');
  }
  function taken(nation){
    const el=document.getElementById('mpn'+nation);if(!el)return;
    el.style.opacity='.35';el.style.cursor='not-allowed';el.onclick=null;
    const s=el.querySelectorAll('span');if(s[1])s[1].textContent='✗ taken';
  }
  function hostUI(){
    const pl=document.getElementById('mp-players-list');
    if(pl)pl.innerHTML=players.map(p=>'<div style="font-size:9px;color:var(--dim);padding:1px 0">● '+p.name+'</div>').join('');
  }
  function setWait(waiting){
    myTurn=!waiting;
    document.querySelectorAll('#end-btn,#end-btn-mob').forEach(e=>e&&(e.disabled=waiting));
    document.querySelectorAll('#side-panel,#bottom').forEach(e=>{
      if(e){e.style.opacity=waiting?'.4':'1';e.style.pointerEvents=waiting?'none':'';}
    });
    const ind=document.getElementById('mp-turn-indicator');
    const iw=document.getElementById('mp-turn-indicator-wrap');
    if(iw)iw.style.display=connected?'block':'none';
    if(ind){
      const an=playerOrder[turnIdx%Math.max(1,playerOrder.length)];
      ind.textContent=waiting?'⏳ '+nname(an)+"'s turn":'⚔ Your turn';
      ind.style.color=waiting?'#8060c0':'#40a830';
    }
    const ig=document.getElementById('mp-ingame-bar');if(ig)ig.style.display=connected?'flex':'none';
    if(!waiting){popup('⚔ Your turn!',2000);addLog('── Your turn ──','diplo');status('Your turn','ok');afkReset();}
    else{status('Waiting…','waiting');afkStart();}
  }
  function status(txt,type){
    const c={idle:'#555',connecting:'#c9a84c',ok:'#40a830',err:'#cc3030',waiting:'#8060c0'}[type]||'#555';
    ['mp-status-dot','mp-ig-dot'].forEach(id=>{const e=document.getElementById(id);if(e)e.style.background=c;});
    ['mp-status-text','mp-ig-txt'].forEach(id=>{const e=document.getElementById(id);if(e)e.textContent=txt;});
  }
  function log(msg,type){
    const el=document.getElementById('mp-log');if(!el)return;
    const c={info:'#8a7848',ok:'#40a830',warn:'#cc8030',err:'#cc3030'}[type||'info']||'#8a7848';
    const d=document.createElement('div');
    d.style.cssText='padding:2px 0;border-bottom:1px solid rgba(42,36,24,.1);font-size:10px;color:'+c;
    d.innerHTML='<span style="color:var(--dim);font-size:8px">'+new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})+'</span> '+msg;
    el.prepend(d);while(el.children.length>50)el.removeChild(el.lastChild);
  }
  function nname(n){return (NATIONS[n]&&NATIONS[n].name)||'?';}
  function mkDelta(){return {moves:[],drafts:[],builds:[],attacks:[]};}

  function patchET(){
    if(_origET)return;
    _origET=window.endTurn;
    window.endTurn=function(){
      if(!role){_origET();return;}
      // Snapshot delta BEFORE clearing
      const d=JSON.parse(JSON.stringify(_delta));
      _delta=mkDelta();
      send('PLAYER_DELTA',{delta:d});
      setWait(true);
      log('📤 Turn submitted…','info');
      if(role==='host'){applyDelta(d,myNation);advanceTurn();}
    };
  }

  function patchActions(){
    const om=window.confirmMove;
    window.confirmMove=function(fr,to){
      if(role&&myTurn){
        const v=+(document.getElementById('msl')?.value||G.army[fr]);
        const s=season(),tm=s.winterTerrain?.includes(PROVINCES[to]?.terrain)?s.moveMod:1;
        _delta.moves.push({from:fr,to,amt:Math.round(v*tm)});
      }
      om?.(fr,to);
    };
    const od=window.confirmDraft;
    window.confirmDraft=function(){
      if(role&&myTurn){
        const r=window._dr,v=+(document.getElementById('dsl')?.value||0);
        if(r>=0&&v>0)_delta.drafts.push({prov:r,amt:v,cost:v});
      }
      od?.();
    };
    const ob=window.queueBuild;
    window.queueBuild=function(k,ri2){
      if(role&&myTurn){
        const cost=Math.round((BUILDINGS[k]?.cost||100)*(ideol().buildCostMod||1));
        _delta.builds.push({prov:ri2,bld:k,cost});
      }
      ob?.(k,ri2);
    };
    const oa=window.launchAtk;
    window.launchAtk=function(bd){
      if(role&&myTurn){
        const fr=window._af,to=window._at;
        const force=+(document.getElementById('asl')?.value||availableArmy(fr));
        _delta.attacks.push({from:fr,to,force});
        if(bd&&G.owner[to]>=0){G.war[myNation][G.owner[to]]=true;G.war[G.owner[to]][myNation]=true;}
      }
      oa?.(bd);
    };
  }

  return {
    get role(){return role;},
    get connected(){return connected;},
    get myTurn(){return myTurn;},
    get active(){return !!role;},
    canAct(){return !role||myTurn;},

    createRoom(nation){
      myNation=nation;myPid='h'+Date.now();role='host';
      roomId=String(Math.floor(100000+Math.random()*900000));
      players=[{id:myPid,nation,name:nname(nation)}];
      log('✅ Room: <b>'+roomId+'</b>','ok');
      status('Waiting for players…','connecting');
      const rc=document.getElementById('mp-room-id');if(rc)rc.textContent=roomId;
      const lk=document.getElementById('mp-invite-link');
      if(lk){const url=location.href.split('?')[0]+'?room='+roomId;lk.textContent=url;}
      const disp=document.getElementById('mp-room-display');if(disp)disp.style.display='flex';
      const wt=document.getElementById('mp-waiting-text');if(wt)wt.style.display='flex';
      fbSet('rooms/'+roomId+'/info',{host:nation,created:Date.now()});
      _joinTs=Date.now();
      startPoll();patchET();patchActions();
    },

    joinRoom(id){
      id=(id||'').trim();if(!id){log('Enter code!','warn');return;}
      myPid='p'+Date.now();role='player';roomId=id;
      log('⏳ Joining '+id+'…','info');status('Connecting…','connecting');
      fbGet('rooms/'+id+'/info').then(info=>{
        if(!info){log('❌ Room not found','err');status('Room not found','err');role=null;roomId=null;return;}
        log('✅ Found! Waiting for nation list…','ok');status('Joining lobby…','connecting');
        connected=true;
        _joinTs=Date.now()-200; // slight buffer so LOBBY_STATE reply is captured
        startPoll();patchET();patchActions();
        send('PLAYER_JOINED',{});
      });
    },

    claimNation(i){
      if(myNation===i)return;
      myNation=i;
      document.querySelectorAll('[id^="mpn"]').forEach(r=>r.style.borderColor='var(--border)');
      const el=document.getElementById('mpn'+i);if(el)el.style.borderColor='var(--gold)';
      send('NATION_CLAIMED',{nation:i});
      log('✓ Claimed <b>'+nname(i)+'</b>','ok');
      const b=document.getElementById('mp-join-ready-btn');if(b)b.removeAttribute('disabled');
    },

    playerReady(){
      if(myNation<0){log('Pick a nation first!','warn');return;}
      send('PLAYER_READY',{nation:myNation,name:nname(myNation)});
      log('✅ Ready!','ok');status('Waiting for host…','waiting');
      const pp=document.getElementById('mp-guest-pick-panel');if(pp)pp.style.display='none';
      const gw=document.getElementById('mp-guest-waiting');if(gw)gw.style.display='flex';
      const jb=document.getElementById('mp-join-btn');if(jb)jb.style.display='none';
    },

    startMultiplayerGame(){
      if(players.length<2){popup('Need 2+ players ('+players.length+' ready)!');return;}
      SC=myNation;SI=NATIONS[myNation].ideology;
      startGame();G.playerNation=myNation;G.ideology=NATIONS[myNation].ideology;
      setTimeout(()=>{
        const sh=[...players];
        for(let i=sh.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[sh[i],sh[j]]=[sh[j],sh[i]];}
        playerOrder=sh.map(p=>p.nation);turnIdx=0;players=sh;
        addLog('🎲 Order: '+sh.map((p,i)=>(i+1)+'. '+nname(p.nation)).join(' → '),'event');
        const snap=JSON.parse(JSON.stringify(G,(k,v)=>v instanceof Set?[...v]:v));
        send('GAME_START',{state:snap,playerOrder,turnIdx:0,players,_ts:Date.now()});
        connected=true;
        setWait(playerOrder[0]!==myNation);
        log('🎮 Game started — dice rolled!','ok');
      },300);
    },

    sendChat(text){
      if(!text?.trim())return;
      addLog('💬 You: '+text,'diplo');
      send('CHAT',{text:text.trim()});
    },

    disconnect(){
      stopPoll();afkReset();
      if(roomId)fbDel('rooms/'+roomId);
      role=null;roomId=null;connected=false;myTurn=false;myNation=-1;
      if(_origET){window.endTurn=_origET;_origET=null;}
      status('Disconnected','idle');log('Disconnected','warn');
      const sp=document.getElementById('side-panel');if(sp){sp.style.opacity='1';sp.style.pointerEvents='';}
    },

    checkDeepLink(){
      try{
        const code=new URLSearchParams(location.search).get('room');
        if(!code)return;
        const inp=document.getElementById('mp-join-code')||document.getElementById('mp-join-id');
        if(inp)inp.value=code;
        show('mp');log('🔗 Code from link: '+code,'ok');
      }catch(e){}
    }
  };
})();

document.addEventListener('DOMContentLoaded',()=>{try{MP.checkDeepLink();}catch(e){}});
