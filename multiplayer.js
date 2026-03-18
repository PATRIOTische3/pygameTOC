// ════════════════════════════════════════════════════════════
//  TIME OF CONQUEST — MULTIPLAYER v4.1
//  Firebase Realtime Database
//
//  Version format: MAJOR.MINOR.PATCH-YYMMDD
//  MAJOR = engine/map/save rewrite  MINOR = new system
//  PATCH = fix/balance/UI  YYMMDD = build date
//
//  Architecture:
//  - HOST owns canonical G, runs AI, processes all turns
//  - All messages go to rooms/{id}/msgs (everyone polls)
//  - HOST writes state to rooms/{id}/state after each turn
//  - Players poll state and apply when _ts changes
//  - Turn order = random shuffle on game start (dice roll)
//  - Deep-link: ?room=XXXXXX auto-fills join code
// ════════════════════════════════════════════════════════════

const MP = (() => {

  const FB_URL = (window.TOC_FIREBASE_URL ||
    'https://timeofconquest-default-rtdb.europe-west1.firebasedatabase.app')
    .replace(/\/$/, '');

  // ── State ─────────────────────────────────────────────────
  let role         = null;   // 'host' | 'player' | null
  let roomId       = null;
  let myNation     = -1;
  let myPlayerId   = null;
  let connected    = false;
  let myTurn       = false;
  let _pollTimer   = null;
  let _seenKeys    = new Set();
  let _origEndTurn = null;
  let _lastStateTs = 0;

  // Lobby/game roster
  let players      = [];   // [{id, nation, name}]
  let playerOrder  = [];   // nation indices in turn order
  let currentTurnIdx = 0;

  let _delta = emptyDelta();

  // ── AFK ───────────────────────────────────────────────────
  const AFK_WARN_MS = 90_000;
  const AFK_KICK_MS = 60_000;
  let _afkWarnTimer = null;
  let _afkKickTimer = null;

  function _resetAfkWatch() {
    clearTimeout(_afkWarnTimer);
    clearTimeout(_afkKickTimer);
  }

  function _startAfkWatch() {
    _resetAfkWatch();
    _afkWarnTimer = setTimeout(() => {
      if (!connected || myTurn) return;
      broadcast('PING', { target: _currentNation() });
      _afkKickTimer = setTimeout(() => {
        if (role === 'host') _kickCurrentPlayer();
      }, AFK_KICK_MS);
    }, AFK_WARN_MS);
  }

  function _currentNation() {
    return playerOrder[currentTurnIdx % Math.max(1, playerOrder.length)];
  }

  function _kickCurrentPlayer() {
    const nation = _currentNation();
    const name = (NATIONS[nation] && NATIONS[nation].name) || 'Player';
    players = players.filter(p => p.nation !== nation);
    playerOrder = playerOrder.filter(n => n !== nation);
    if (currentTurnIdx >= playerOrder.length) currentTurnIdx = 0;
    broadcast('PLAYER_KICKED', { nation, reason: 'afk' });
    _showKickBanner(name + ' removed for inactivity — AI takes over');
    addLog('⚠ ' + name + ' AFK-kicked.', 'warn');
    if (playerOrder.length > 0) _advanceTurn();
  }

  function _showKickBanner(msg) {
    const old = document.getElementById('mp-kick-banner');
    if (old) old.remove();
    if (!document.getElementById('mp-ticker-style')) {
      const st = document.createElement('style');
      st.id = 'mp-ticker-style';
      st.textContent = '@keyframes mpTick{from{transform:translateX(0)}to{transform:translateX(-200%)}}';
      document.head.appendChild(st);
    }
    const b = document.createElement('div');
    b.id = 'mp-kick-banner';
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:700;height:28px;background:linear-gradient(90deg,#1a0404,#3a0808,#1a0404);border-bottom:1px solid rgba(200,40,40,.5);overflow:hidden;display:flex;align-items:center';
    const t = document.createElement('div');
    t.style.cssText = 'white-space:nowrap;font-family:Cinzel,serif;font-size:11px;color:#ff6060;letter-spacing:2px;padding-left:100%;animation:mpTick 8s linear forwards';
    t.textContent = '⚡ ' + msg;
    b.appendChild(t);
    document.body.appendChild(b);
    const hud = document.getElementById('hud');
    if (hud) { hud.style.transition='margin-top .3s'; hud.style.marginTop='28px'; }
    setTimeout(() => { b.remove(); if (hud) hud.style.marginTop=''; }, 8500);
  }

  // ── Firebase ───────────────────────────────────────────────
  async function fbSet(path, data) {
    try {
      const r = await fetch(FB_URL+'/'+path+'.json', {method:'PUT', body:JSON.stringify(data)});
      return r.ok;
    } catch(e) { return false; }
  }
  async function fbPatch(path, data) {
    try {
      const r = await fetch(FB_URL+'/'+path+'.json', {method:'PATCH', body:JSON.stringify(data)});
      return r.ok;
    } catch(e) { return false; }
  }
  async function fbPush(path, data) {
    try {
      const r = await fetch(FB_URL+'/'+path+'.json', {method:'POST', body:JSON.stringify(Object.assign({}, data, {_ts:Date.now()}))});
      return r.ok;
    } catch(e) { return false; }
  }
  async function fbGet(path) {
    try {
      const r = await fetch(FB_URL+'/'+path+'.json');
      if (!r.ok) return null;
      return await r.json();
    } catch(e) { return null; }
  }
  async function fbDelete(path) {
    try { await fetch(FB_URL+'/'+path+'.json', {method:'DELETE'}); } catch(e) {}
  }

  // ── Messaging ──────────────────────────────────────────────
  // Broadcast: writes to rooms/{id}/msgs — everyone polls
  async function broadcast(type, payload) {
    if (!roomId) return;
    await fbPush('rooms/'+roomId+'/msgs', Object.assign({type, from:myPlayerId, fromNation:myNation}, payload||{}));
  }

  // Host-only: push full state to rooms/{id}/state
  async function pushState(extra) {
    const snap = JSON.parse(JSON.stringify(G, function(k,v){ return v instanceof Set ? [...v] : v; }));
    const data = Object.assign({
      state: snap,
      playerOrder: playerOrder,
      currentTurnIdx: currentTurnIdx,
      players: players,
      _ts: Date.now()
    }, extra||{});
    await fbSet('rooms/'+roomId+'/state', data);
  }

  // ── Polling ────────────────────────────────────────────────
  function startPolling() {
    if (_pollTimer) clearInterval(_pollTimer);
    _seenKeys.clear();
    _lastStateTs = 0;
    _pollTimer = setInterval(async () => {
      if (!roomId) return;
      // 1. Poll messages (all players)
      const msgs = await fbGet('rooms/'+roomId+'/msgs');
      if (msgs && typeof msgs === 'object') {
        const entries = Object.entries(msgs).sort((a,b)=>(a[1]._ts||0)-(b[1]._ts||0));
        for (const [key, msg] of entries) {
          if (_seenKeys.has(key)) continue;
          _seenKeys.add(key);
          try { handleMessage(msg); } catch(e) { console.error('MP msg err:', e, msg); }
        }
      }
      // 2. Poll state (non-host players only)
      if (role === 'player') {
        const st = await fbGet('rooms/'+roomId+'/state');
        if (st && st._ts && st._ts > _lastStateTs) {
          _lastStateTs = st._ts;
          applyState(st);
        }
      }
    }, 1500);
  }

  function stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // ── Apply state (non-host) ─────────────────────────────────
  function applyState(data) {
    if (!data || !data.state) return;
    const myPN = G.playerNation;
    const myIde = G.ideology;
    Object.assign(G, data.state);
    // Restore Sets
    if (G.epidemics) G.epidemics.forEach(ep => { if (Array.isArray(ep.provinces)) ep.provinces = new Set(ep.provinces); });
    if (!G._allyEpicNotified) G._allyEpicNotified = new Set();
    else if (Array.isArray(G._allyEpicNotified)) G._allyEpicNotified = new Set(G._allyEpicNotified);
    if (!G.moveQueue) G.moveQueue = [];
    if (!G.battleQueue) G.battleQueue = [];
    if (!G._enemyAttackQueue) G._enemyAttackQueue = [];
    G.playerNation = myPN;
    G.ideology = myIde;
    if (data.playerOrder) playerOrder = data.playerOrder;
    if (data.currentTurnIdx !== undefined) currentTurnIdx = data.currentTurnIdx;
    if (data.players) players = data.players;
    updateHUD(); updateIdeoHUD(); updateSeasonUI(); scheduleDraw();
    if (G.sel >= 0) updateSP(G.sel);
    const activeNation = playerOrder[currentTurnIdx % Math.max(1,playerOrder.length)];
    setWaitingUI(activeNation !== myNation);
  }

  // ── Handle message ─────────────────────────────────────────
  function handleMessage(msg) {
    // Skip own messages (except PING/PONG targeted at us)
    if (msg.from === myPlayerId && msg.type !== 'PING' && msg.type !== 'PONG') return;

    switch (msg.type) {

      // HOST receives: player wants to join
      case 'PLAYER_JOINED': {
        if (role !== 'host') break;
        mpLog('👤 Player joining…', 'ok');
        // Reply with current lobby state
        const taken = players.map(p => p.nation);
        broadcast('LOBBY_STATE', {
          taken: taken,
          playersInfo: players.map(p => ({nation:p.nation, name:(NATIONS[p.nation]&&NATIONS[p.nation].name)||'?'}))
        });
        // Enable start button
        const btn = document.getElementById('mp-start-game-btn');
        if (btn) btn.removeAttribute('disabled');
        // Update player count
        _updateHostLobbyUI();
        break;
      }

      // PLAYER receives: lobby state with taken nations
      case 'LOBBY_STATE': {
        if (role !== 'player') break;
        mpLog('🗺 Lobby: pick your nation', 'ok');
        setMpStatus('Pick your nation…', 'connecting');
        showNationPick(msg.taken || []);
        // Show other players
        const pList = document.getElementById('mp-players-list');
        if (pList && msg.playersInfo) {
          pList.innerHTML = (msg.playersInfo||[]).map(p =>
            '<div style="font-size:9px;color:var(--dim);padding:1px 0">● '+(p.name||'?')+'</div>'
          ).join('');
        }
        break;
      }

      // Everyone receives: a player claimed a nation
      case 'NATION_CLAIMED': {
        if (msg.fromNation !== myNation) {
          markNationTaken(msg.nation);
          mpLog((NATIONS[msg.nation]&&NATIONS[msg.nation].name||'?')+' claimed', 'info');
        }
        if (role === 'host') _updateHostLobbyUI();
        break;
      }

      // PLAYER receives: game starting
      case 'GAME_START': {
        if (role !== 'player') break;
        playerOrder = msg.playerOrder || [];
        currentTurnIdx = msg.currentTurnIdx || 0;
        players = msg.players || [];
        Object.assign(G, msg.state);
        if (G.epidemics) G.epidemics.forEach(ep => { if (Array.isArray(ep.provinces)) ep.provinces = new Set(ep.provinces); });
        if (!G._allyEpicNotified) G._allyEpicNotified = new Set();
        if (!G.moveQueue) G.moveQueue = [];
        if (!G.battleQueue) G.battleQueue = [];
        if (!G._enemyAttackQueue) G._enemyAttackQueue = [];
        G.playerNation = myNation;
        G.ideology = (NATIONS[myNation]&&NATIONS[myNation].ideology) || 'democracy';
        connected = true;
        show('game');
        setTimeout(() => {
          computeHexRadius(); buildCanvas(); zoomReset();
          updateHUD(); updateIdeoHUD(); updateSeasonUI();
          addLog('🌐 Multiplayer game started!', 'diplo');
          addLog('You control: '+(NATIONS[myNation]&&NATIONS[myNation].name), 'event');
          const myOrder = playerOrder.indexOf(myNation) + 1;
          const suffix = myOrder===1?'st':myOrder===2?'nd':myOrder===3?'rd':'th';
          popup('🎲 Turn order decided! You are #'+myOrder, 3000);
          addLog('🎲 You go '+myOrder+suffix+' in turn order.', 'event');
          _delta = emptyDelta();
          const activeNation = playerOrder[currentTurnIdx % Math.max(1,playerOrder.length)];
          setWaitingUI(activeNation !== myNation);
        }, 80);
        mpLog('🎮 Game started!', 'ok');
        _lastStateTs = msg._ts || 0;
        break;
      }

      // HOST receives: player submitted their turn
      case 'PLAYER_DELTA': {
        if (role !== 'host') break;
        applyPlayerDelta(msg.delta||{}, msg.fromNation);
        _advanceTurn();
        break;
      }

      case 'PING': {
        if (msg.target === myNation) broadcast('PONG', {});
        break;
      }

      case 'PONG': {
        _resetAfkWatch();
        if (!myTurn) _startAfkWatch();
        break;
      }

      case 'PLAYER_KICKED': {
        const name = (NATIONS[msg.nation]&&NATIONS[msg.nation].name)||'Player';
        if (msg.nation === myNation) {
          _showKickBanner('You were removed for inactivity — AI takes over');
          addLog('⚠ You were removed (AFK).', 'warn');
          _convertToSingleplayer();
        } else {
          _showKickBanner(name+' removed for inactivity — AI takes over');
          addLog('⚠ '+name+' AFK-kicked.', 'warn');
          players = players.filter(p => p.nation !== msg.nation);
          playerOrder = playerOrder.filter(n => n !== msg.nation);
        }
        break;
      }

      case 'CHAT': {
        const sender = (NATIONS[msg.fromNation]&&NATIONS[msg.fromNation].name)||'?';
        addLog('💬 '+sender+': '+msg.text, 'diplo');
        popup('💬 '+sender+': '+msg.text, 3500);
        break;
      }
    }
  }

  // ── Host: advance turn ─────────────────────────────────────
  async function _advanceTurn() {
    if (!playerOrder.length) return;
    currentTurnIdx = (currentTurnIdx + 1) % playerOrder.length;
    // If wrapped around to start — run game endTurn (AI + time)
    if (currentTurnIdx === 0) {
      _origEndTurn();
    }
    // Push new state to all players
    await pushState();
    const nextNation = playerOrder[currentTurnIdx];
    mpLog('⏩ Turn → '+(NATIONS[nextNation]&&NATIONS[nextNation].name||'?'), 'info');
    // Is it host's turn?
    if (nextNation === myNation) {
      setWaitingUI(false);
    } else {
      setWaitingUI(true);
      _startAfkWatch();
    }
  }

  // ── Apply player delta (host) ──────────────────────────────
  function applyPlayerDelta(delta, nation) {
    (delta.armyMoves||[]).forEach(function(m) {
      G.army[m.from] = Math.max(0,(G.army[m.from]||0)-m.amount);
      G.army[m.to] = (G.army[m.to]||0)+m.amount;
      if (G.owner[m.to]<0) G.owner[m.to]=nation;
    });
    (delta.drafts||[]).forEach(function(d) {
      G.army[d.prov]=(G.army[d.prov]||0)+d.amount;
      G.pop[d.prov]=Math.max(500,(G.pop[d.prov]||0)-d.amount);
      G.gold[nation]=Math.max(0,(G.gold[nation]||0)-d.goldCost);
    });
    (delta.builds||[]).forEach(function(b) {
      G.gold[nation]=Math.max(0,(G.gold[nation]||0)-b.cost);
      (G.buildings[b.prov]=G.buildings[b.prov]||[]).push(b.building);
    });
    (delta.attacks||[]).forEach(function(a) {
      const en=G.owner[a.to];
      if (en>=0&&en!==nation) { G.war[nation][en]=true; G.war[en][nation]=true; }
      if (!G.battleQueue) G.battleQueue=[];
      G.battleQueue.push({fr:a.from, to:a.to, force:a.force});
    });
  }

  // ── Convert to singleplayer ────────────────────────────────
  function _convertToSingleplayer() {
    stopPolling(); _resetAfkWatch();
    if (roomId) fbDelete('rooms/'+roomId);
    role=null; roomId=null; connected=false; myTurn=true;
    if (_origEndTurn) { window.endTurn=_origEndTurn; _origEndTurn=null; }
    ['mp-ingame-bar','mp-turn-indicator-wrap'].forEach(function(id){
      const el=document.getElementById(id); if(el) el.style.display='none';
    });
    ['side-panel','bottom'].forEach(function(id){
      const el=document.getElementById(id); if(el){el.style.opacity='1';el.style.pointerEvents='';}
    });
    ['end-btn','end-btn-mob'].forEach(function(id){
      const el=document.getElementById(id); if(el) el.disabled=false;
    });
    addLog('🤖 Continuing as single player.', 'diplo');
    scheduleDraw(); updateHUD();
  }

  // ── UI helpers ─────────────────────────────────────────────
  function showNationPick(taken) {
    const panel = document.getElementById('mp-guest-pick-panel');
    if (panel) { panel.style.display='flex'; panel.style.flexDirection='column'; }
    const list = document.getElementById('mp-guest-nation-list');
    if (!list) return;
    list.innerHTML = NATIONS.map(function(n,i) {
      const isTaken = (taken||[]).includes(i);
      return '<div id="mp-nat-'+i+'" onclick="'+(isTaken?'':('MP.claimNation('+i+')'))+'" style="display:flex;align-items:center;gap:9px;padding:7px 10px;background:rgba(0,0,0,.2);border:1px solid var(--border);cursor:'+(isTaken?'not-allowed':'pointer')+';margin-bottom:3px;opacity:'+(isTaken?'0.35':'1')+';transition:all .12s">'
        +'<div style="width:14px;height:14px;border-radius:2px;background:'+n.color+';flex-shrink:0"></div>'
        +'<span style="font-family:Cinzel,serif;font-size:10px;flex:1">'+n.name+'</span>'
        +'<span style="font-size:8px;color:var(--dim)">'+(isTaken?'✗ taken':n.ideology)+'</span>'
        +'</div>';
    }).join('');
  }

  function markNationTaken(nation) {
    const el = document.getElementById('mp-nat-'+nation);
    if (!el) return;
    el.style.opacity='0.35'; el.style.cursor='not-allowed'; el.onclick=null;
    const sp = el.querySelectorAll('span');
    if (sp[1]) sp[1].textContent='✗ taken';
  }

  function _updateHostLobbyUI() {
    const pList = document.getElementById('mp-players-list');
    if (pList) {
      pList.innerHTML = players.map(function(p){
        return '<div style="font-size:9px;color:var(--dim);padding:1px 0">● '+(NATIONS[p.nation]&&NATIONS[p.nation].name||'?')+'</div>';
      }).join('');
    }
  }

  function setWaitingUI(waiting) {
    myTurn = !waiting;
    ['end-btn','end-btn-mob'].forEach(function(id){
      const el=document.getElementById(id); if(el) el.disabled=waiting;
    });
    ['side-panel','bottom'].forEach(function(id){
      const el=document.getElementById(id);
      if(el){el.style.opacity=waiting?'0.4':'1';el.style.pointerEvents=waiting?'none':'';}
    });
    const indWrap=document.getElementById('mp-turn-indicator-wrap');
    const indicator=document.getElementById('mp-turn-indicator');
    if (indWrap) indWrap.style.display=connected?'block':'none';
    if (indicator) {
      const activeNation=playerOrder[currentTurnIdx%Math.max(1,playerOrder.length)];
      const activeName=(NATIONS[activeNation]&&NATIONS[activeNation].name)||'Player';
      indicator.textContent=waiting?'⏳ '+activeName+"'s turn":'⚔ Your turn';
      indicator.style.color=waiting?'#8060c0':'#40a830';
    }
    const igBar=document.getElementById('mp-ingame-bar');
    if (igBar) igBar.style.display=connected?'flex':'none';
    if (!waiting) {
      popup('⚔ Your turn!', 2000);
      addLog('── Your turn ──', 'diplo');
      setMpStatus('Your turn', 'ok');
      _resetAfkWatch();
    } else {
      setMpStatus('Waiting…', 'waiting');
      _startAfkWatch();
    }
  }

  function setMpStatus(text, type) {
    const colors={idle:'#555',connecting:'#c9a84c',ok:'#40a830',err:'#cc3030',waiting:'#8060c0'};
    const c=colors[type]||colors.idle;
    ['mp-status-dot','mp-ig-dot'].forEach(function(id){ const el=document.getElementById(id); if(el) el.style.background=c; });
    ['mp-status-text','mp-ig-txt'].forEach(function(id){ const el=document.getElementById(id); if(el) el.textContent=text; });
  }

  function mpLog(msg, type) {
    const el=document.getElementById('mp-log'); if(!el) return;
    const colors={info:'#8a7848',ok:'#40a830',warn:'#cc8030',err:'#cc3030',chat:'#c9a84c'};
    const div=document.createElement('div');
    div.style.cssText='padding:3px 0;border-bottom:1px solid rgba(42,36,24,.15);font-size:10px;color:'+(colors[type||'info']||'#8a7848');
    div.innerHTML='<span style="color:var(--dim);font-size:8px">'+new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})+'</span> '+msg;
    el.insertAdjacentElement('afterbegin',div);
    while(el.children.length>40) el.removeChild(el.lastChild);
  }

  function emptyDelta() { return {armyMoves:[],drafts:[],builds:[],attacks:[]}; }

  // ── Patch endTurn ──────────────────────────────────────────
  function patchEndTurn() {
    if (_origEndTurn) return;
    _origEndTurn = window.endTurn;
    window.endTurn = function() {
      if (!role) { _origEndTurn(); return; }
      // Send delta and wait
      broadcast('PLAYER_DELTA', {delta:_delta});
      _delta = emptyDelta();
      setWaitingUI(true);
      mpLog('📤 Turn submitted…', 'info');
      // Host also processes immediately
      if (role === 'host') {
        applyPlayerDelta(_delta, myNation);
        _advanceTurn();
      }
    };
  }

  function patchPlayerActions() {
    const origMove=window.confirmMove;
    window.confirmMove=function(from,to){
      if(role&&myTurn){
        const v=+(document.getElementById('msl')&&document.getElementById('msl').value||G.army[from]);
        const s=season(); const tm=s.winterTerrain&&s.winterTerrain.includes(PROVINCES[to]&&PROVINCES[to].terrain)?s.moveMod:1.0;
        _delta.armyMoves.push({from,to,amount:Math.round(v*tm)});
      }
      origMove&&origMove(from,to);
    };
    const origDraft=window.confirmDraft;
    window.confirmDraft=function(){
      if(role&&myTurn){
        const r=window._dr; const v=+(document.getElementById('dsl')&&document.getElementById('dsl').value||0);
        if(r>=0&&v>0) _delta.drafts.push({prov:r,amount:v,goldCost:v});
      }
      origDraft&&origDraft();
    };
    const origBuild=window.queueBuild;
    window.queueBuild=function(k,ri2){
      if(role&&myTurn){
        const io=ideol(); const cost=Math.round((BUILDINGS[k]&&BUILDINGS[k].cost||100)*(io.buildCostMod||1));
        _delta.builds.push({prov:ri2,building:k,cost});
      }
      origBuild&&origBuild(k,ri2);
    };
    const origAtk=window.launchAtk;
    window.launchAtk=function(bd){
      if(role&&myTurn){
        const fr=window._af,to=window._at;
        const force=+(document.getElementById('asl')&&document.getElementById('asl').value||availableArmy(fr));
        _delta.attacks.push({from:fr,to,force});
        if(bd&&G.owner[to]>=0){G.war[myNation][G.owner[to]]=true;G.war[G.owner[to]][myNation]=true;}
      }
      origAtk&&origAtk(bd);
    };
  }

  // ── PUBLIC API ─────────────────────────────────────────────
  return {
    get role()      { return role; },
    get connected() { return connected; },
    get myTurn()    { return myTurn; },
    get active()    { return !!role; },
    canAct()        { return !role || myTurn; },

    createRoom(nation) {
      myNation=nation; myPlayerId='host_'+Date.now(); role='host';
      roomId=String(Math.floor(100000+Math.random()*900000));
      players=[{id:myPlayerId, nation, name:(NATIONS[nation]&&NATIONS[nation].name)||'?'}];
      mpLog('✅ Room: <b>'+roomId+'</b>', 'ok');
      setMpStatus('Waiting for players…', 'connecting');
      // Show room code
      const ridEl=document.getElementById('mp-room-id');
      if(ridEl) ridEl.textContent=roomId;
      // Show invite link
      const linkEl=document.getElementById('mp-invite-link');
      if(linkEl){
        const url=location.origin+location.pathname.replace(/\/$/,'')+'/index.html?room='+roomId;
        linkEl.textContent=url; linkEl.href=url;
      }
      const disp=document.getElementById('mp-room-display');
      if(disp) disp.style.display='flex';
      const wt=document.getElementById('mp-waiting-text');
      if(wt) wt.style.display='flex';
      fbSet('rooms/'+roomId+'/info', {host:nation,created:Date.now()});
      _seenKeys.clear(); startPolling(); patchEndTurn(); patchPlayerActions();
    },

    joinRoom(id) {
      id=(id||'').trim();
      if(!id){ mpLog('Enter a room code!','warn'); return; }
      myPlayerId='player_'+Date.now(); role='player'; roomId=id;
      mpLog('⏳ Joining '+roomId+'…','info');
      setMpStatus('Connecting…','connecting');
      fbGet('rooms/'+roomId+'/info').then(function(info){
        if(!info){
          mpLog('❌ Room not found','err'); setMpStatus('Room not found','err');
          role=null; roomId=null; return;
        }
        mpLog('✅ Room found! Waiting for nation list…','ok');
        setMpStatus('Joining lobby…','connecting');
        connected=true; _seenKeys.clear();
        startPolling(); patchEndTurn(); patchPlayerActions();
        broadcast('PLAYER_JOINED',{});
      });
    },

    claimNation(i) {
      if(myNation===i) return;
      myNation=i;
      document.querySelectorAll('[id^="mp-nat-"]').forEach(function(r){r.style.borderColor='var(--border)';});
      const el=document.getElementById('mp-nat-'+i);
      if(el) el.style.borderColor='var(--gold)';
      broadcast('NATION_CLAIMED',{nation:i});
      mpLog('✓ Claimed <b>'+((NATIONS[i]&&NATIONS[i].name)||'?')+'</b>','ok');
      const btn=document.getElementById('mp-join-ready-btn');
      if(btn) btn.removeAttribute('disabled');
    },

    playerReady() {
      if(myNation<0){mpLog('Pick a nation first!','warn');return;}
      // Add self to players list (host will see via NATION_CLAIMED)
      mpLog('✅ Ready!','ok'); setMpStatus('Waiting for host to start…','waiting');
      const pp=document.getElementById('mp-guest-pick-panel');
      if(pp) pp.style.display='none';
      const gw=document.getElementById('mp-guest-waiting');
      if(gw) gw.style.display='flex';
    },

    startMultiplayerGame() {
      if(players.length<2){popup('Need at least 2 players!');return;}
      // Init game
      SC=myNation; SI=NATIONS[myNation].ideology;
      startGame(); G.playerNation=myNation; G.ideology=NATIONS[myNation].ideology;
      setTimeout(function(){
        // Fisher-Yates shuffle for turn order
        const shuffled=[...players];
        for(let i=shuffled.length-1;i>0;i--){
          const j=Math.floor(Math.random()*(i+1));
          [shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];
        }
        playerOrder=shuffled.map(function(p){return p.nation;});
        currentTurnIdx=0; players=shuffled;
        addLog('🎲 Turn order: '+shuffled.map(function(p,idx){return (idx+1)+'. '+((NATIONS[p.nation]&&NATIONS[p.nation].name)||'?');}).join(' → '),'event');
        const snap=JSON.parse(JSON.stringify(G,function(k,v){return v instanceof Set?[...v]:v;}));
        broadcast('GAME_START',{state:snap,playerOrder,currentTurnIdx:0,players,_ts:Date.now()});
        connected=true;
        const firstNation=playerOrder[0];
        setWaitingUI(firstNation!==myNation);
        mpLog('🎮 Game started — dice rolled!','ok');
      }, 300);
    },

    sendChat(text) {
      if(!text||!text.trim()) return;
      addLog('💬 You: '+text,'diplo');
      broadcast('CHAT',{text:text.trim()});
    },

    disconnect() {
      stopPolling(); _resetAfkWatch();
      if(roomId) fbDelete('rooms/'+roomId);
      role=null;roomId=null;connected=false;myTurn=false;myNation=-1;
      if(_origEndTurn){window.endTurn=_origEndTurn;_origEndTurn=null;}
      setMpStatus('Disconnected','idle'); mpLog('Disconnected','warn');
      const sp=document.getElementById('side-panel');
      if(sp){sp.style.opacity='1';sp.style.pointerEvents='';}
    },

    checkDeepLink() {
      try {
        const code=new URLSearchParams(location.search).get('room');
        if(!code) return;
        const inp=document.getElementById('mp-join-code')||document.getElementById('mp-join-id');
        if(inp) inp.value=code;
        show('mp');
        mpLog('🔗 Room code from link: '+code,'ok');
      } catch(e){}
    }
  };
})();

document.addEventListener('DOMContentLoaded', function(){ try{MP.checkDeepLink();}catch(e){} });
