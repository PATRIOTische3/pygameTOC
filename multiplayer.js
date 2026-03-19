// ════════════════════════════════════════════════════════════
//  TIME OF CONQUEST — MULTIPLAYER v4
//  Firebase Realtime Database
//
//  Architecture:
//  - HOST owns canonical state, runs AI, processes all turns in order
//  - Players join, pick nations (taken nations locked), pick slots
//  - On game start: HOST rolls dice → determines turn order (1..N)
//  - Turn order: currentTurnIdx cycles through playerOrder[]
//  - Each player sends PLAYER_DELTA when ending their turn
//  - HOST applies delta, advances turn, broadcasts new state to all
//  - All non-player nations = AI (handled by host each round)
//  - Deep-link: ?room=XXXXXX pre-fills join code
// ════════════════════════════════════════════════════════════

const MP = (() => {

  const FB_URL = (window.TOC_FIREBASE_URL ||
    'https://timeofconquest-default-rtdb.europe-west1.firebasedatabase.app')
    .replace(/\/$/, '');

  // ── State ─────────────────────────────────────────────────
  let role         = null;   // 'host' | 'player'
  let roomId       = null;
  let myNation     = -1;
  let myPlayerId   = null;   // unique id per player session
  let connected    = false;
  let myTurn       = false;
  let _pollTimer   = null;
  let _seenKeys    = new Set();
  let _origEndTurn = null;

  // Multi-player roster (host tracks this)
  // players = [{id, nation, name, order}]
  let players      = [];
  let playerOrder  = [];     // nation indices in turn order
  let currentTurnIdx = 0;    // index into playerOrder

  let _delta = emptyDelta();

  // ── AFK ───────────────────────────────────────────────────
  const AFK_WARN_MS = 90_000;
  const AFK_KICK_MS = 60_000;
  let _afkWarnTimer = null;
  let _afkKickTimer = null;
  let _afkDialogOpen = false;
  let _hbTimer = null;

  function _resetAfkWatch() {
    clearTimeout(_afkWarnTimer); clearTimeout(_afkKickTimer);
    _afkDialogOpen = false;
    const dlg = document.getElementById('mp-afk-dialog');
    if (dlg) dlg.remove();
  }

  function _startAfkWatch() {
    clearTimeout(_afkWarnTimer); clearTimeout(_afkKickTimer);
    _afkWarnTimer = setTimeout(() => {
      if (!connected || myTurn) return;
      _afkDialogOpen = true;
      broadcast('PING', { target: currentTurnNation() });
      _afkKickTimer = setTimeout(_kickCurrentPlayer, AFK_KICK_MS);
    }, AFK_WARN_MS);
  }

  function currentTurnNation() {
    return playerOrder[currentTurnIdx % playerOrder.length];
  }

  function _showKickBanner(msg) {
    const old = document.getElementById('mp-kick-banner');
    if (old) old.remove();
    const banner = document.createElement('div');
    banner.id = 'mp-kick-banner';
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:700;height:28px;background:linear-gradient(90deg,#1a0404,#3a0808,#1a0404);border-bottom:1px solid rgba(200,40,40,.5);overflow:hidden;display:flex;align-items:center';
    const ticker = document.createElement('div');
    ticker.style.cssText = 'white-space:nowrap;font-family:Cinzel,serif;font-size:11px;color:#ff6060;letter-spacing:2px;padding-left:100%;animation:mpTickerScroll 8s linear forwards';
    ticker.textContent = '⚡ ' + msg;
    if (!document.getElementById('mp-ticker-style')) {
      const st = document.createElement('style');
      st.id = 'mp-ticker-style';
      st.textContent = '@keyframes mpTickerScroll{from{transform:translateX(0)}to{transform:translateX(-200%)}}';
      document.head.appendChild(st);
    }
    banner.appendChild(ticker);
    document.body.appendChild(banner);
    const hud = document.getElementById('hud');
    if (hud) { hud.style.transition = 'margin-top .3s'; hud.style.marginTop = '28px'; }
    setTimeout(() => { banner.remove(); if (hud) hud.style.marginTop = ''; }, 8500);
  }

  function _kickCurrentPlayer() {
    if (!connected || role !== 'host') return;
    const nation = currentTurnNation();
    const name = (NATIONS[nation] && NATIONS[nation].name) || 'Player';
    _resetAfkWatch();
    // Remove from players list
    players = players.filter(p => p.nation !== nation);
    playerOrder = playerOrder.filter(n => n !== nation);
    if (currentTurnIdx >= playerOrder.length) currentTurnIdx = 0;
    broadcast('PLAYER_KICKED', { nation, reason: 'afk' });
    _showKickBanner(`${name} removed for inactivity — AI takes over`);
    addLog(`⚠ ${name} AFK-kicked. AI takes over.`, 'warn');
    _advanceTurn(); // move to next player
  }

  // ── Firebase helpers ───────────────────────────────────────
  async function fbSet(path, data) {
    try {
      const r = await fetch(`${FB_URL}/${path}.json`, { method:'PUT', body:JSON.stringify(data) });
      return r.ok;
    } catch(e) { return false; }
  }
  async function fbPush(path, data) {
    try {
      const r = await fetch(`${FB_URL}/${path}.json`, {
        method:'POST', body:JSON.stringify({...data, _ts:Date.now()})
      });
      return r.ok;
    } catch(e) { return false; }
  }
  async function fbGet(path) {
    try {
      const r = await fetch(`${FB_URL}/${path}.json`);
      if (!r.ok) return null;
      return await r.json();
    } catch(e) { return null; }
  }
  async function fbDelete(path) {
    try { await fetch(`${FB_URL}/${path}.json`, {method:'DELETE'}); } catch(e) {}
  }

  // ── Messaging ──────────────────────────────────────────────
  // All messages go to rooms/{id}/msgs — everyone polls this
  async function broadcast(type, payload={}) {
    if (!roomId) return;
    await fbPush(`rooms/${roomId}/msgs`, {type, from: myPlayerId, nation: myNation, ...payload});
  }

  // Host-only: send state snapshot to all
  async function sendStateToAll(extraPayload={}) {
    const snap = JSON.parse(JSON.stringify(G, (k,v) => v instanceof Set ? [...v] : v));
    await fbSet(`rooms/${roomId}/state`, {
      ...extraPayload,
      state: snap,
      playerOrder,
      currentTurnIdx,
      players,
      _ts: Date.now()
    });
  }

  function startPolling() {
    if (_pollTimer) clearInterval(_pollTimer);
    _seenKeys.clear();
    _pollTimer = setInterval(async () => {
      if (!roomId) return;
      const msgs = await fbGet(`rooms/${roomId}/msgs`);
      if (msgs && typeof msgs === 'object') {
        const entries = Object.entries(msgs).sort((a,b) => (a[1]._ts||0)-(b[1]._ts||0));
        for (const [key, msg] of entries) {
          if (_seenKeys.has(key)) continue;
          _seenKeys.add(key);
          try { handleMessage(msg); } catch(e) { console.error('MP msg err:', e); }
        }
      }
      // Non-host players: poll for state updates
      if (role !== 'host') {
        const stateData = await fbGet(`rooms/${roomId}/state`);
        if (stateData && stateData._ts && !_seenKeys.has('state_' + stateData._ts)) {
          _seenKeys.add('state_' + stateData._ts);
          applyServerState(stateData);
        }
      }
    }, 1500);
  }

  function stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // ── Apply incoming state ───────────────────────────────────
  function applyServerState(data) {
    if (!data || !data.state) return;
    const myPN = G.playerNation;
    const myIdeol = G.ideology;
    Object.assign(G, data.state);
    // Restore Sets
    if (G.epidemics) G.epidemics.forEach(ep => { if (Array.isArray(ep.provinces)) ep.provinces = new Set(ep.provinces); });
    if (!G._allyEpicNotified) G._allyEpicNotified = new Set();
    else if (Array.isArray(G._allyEpicNotified)) G._allyEpicNotified = new Set(G._allyEpicNotified);
    if (!G.moveQueue) G.moveQueue = [];
    if (!G.battleQueue) G.battleQueue = [];
    if (!G._enemyAttackQueue) G._enemyAttackQueue = [];
    G.playerNation = myPN;
    G.ideology = myIdeol;

    if (data.playerOrder) playerOrder = data.playerOrder;
    if (data.currentTurnIdx !== undefined) currentTurnIdx = data.currentTurnIdx;
    if (data.players) players = data.players;

    updateHUD(); updateIdeoHUD(); updateSeasonUI(); scheduleDraw();
    if (G.sel >= 0) updateSP(G.sel);

    // Is it my turn?
    const activeNation = playerOrder[currentTurnIdx % playerOrder.length];
    const isMyTurn = activeNation === myNation;
    setWaitingUI(!isMyTurn);
    if (isMyTurn) mpLog('⚔ Your turn!', 'ok');
  }

  // ── Message handler ────────────────────────────────────────
  function handleMessage(msg) {
    // Reset AFK on any message from current player
    if (msg.nation === currentTurnNation()) _resetAfkWatch();

    switch (msg.type) {

      case 'PLAYER_JOINED': {
        if (role !== 'host') break;
        // A new player wants to join — send them the lobby state
        const taken = players.map(p => p.nation);
        broadcast('LOBBY_STATE', {
          hostNation: myNation,
          taken,
          players: players.map(p => ({nation: p.nation, name: NATIONS[p.nation]&&NATIONS[p.nation].name||'?'}))
        });
        mpLog(`👤 Player joining…`, 'ok');
        // Enable start button
        if (window._mpCheckStartable) window._mpCheckStartable();
        break;
      }

      case 'LOBBY_STATE': {
        if (role === 'host') break;
        // Show available nations
        showNationPick(msg.taken || []);
        const pList = document.getElementById('mp-players-list');
        if (pList) {
          pList.innerHTML = (msg.players||[]).map(p =>
            `<div style="font-size:10px;color:var(--dim);padding:2px 0">● ${p.name}</div>`
          ).join('');
        }
        break;
      }

      case 'NATION_CLAIMED': {
        // Another player claimed a nation — mark it taken in UI
        if (msg.from !== myPlayerId) {
          markNationTaken(msg.nation);
          mpLog(`👤 ${NATIONS[msg.nation]&&NATIONS[msg.nation].name||'?'} claimed`, 'info');
        }
        break;
      }

      case 'GAME_START': {
        // Receive full initial state + turn order
        playerOrder = msg.playerOrder;
        currentTurnIdx = msg.currentTurnIdx;
        players = msg.players;
        // Apply state
        Object.assign(G, msg.state);
        if (G.epidemics) G.epidemics.forEach(ep => { if (Array.isArray(ep.provinces)) ep.provinces = new Set(ep.provinces); });
        if (!G._allyEpicNotified) G._allyEpicNotified = new Set();
        if (!G.moveQueue) G.moveQueue = [];
        if (!G.battleQueue) G.battleQueue = [];
        if (!G._enemyAttackQueue) G._enemyAttackQueue = [];
        G.playerNation = myNation;
        G.ideology = NATIONS[myNation]&&NATIONS[myNation].ideology || 'democracy';
        connected = true;
        // Save MP session for reconnect on reload
        try{localStorage.setItem('toc_mp_session',JSON.stringify({roomId,nation:myNation}));}catch(e){}
        show('game');
        setTimeout(() => {
          computeHexRadius(); buildCanvas(); zoomReset();
          updateHUD(); updateIdeoHUD(); updateSeasonUI();
          addLog('🌐 Multiplayer game started!', 'diplo');
          addLog(`You control: ${NATIONS[myNation]&&NATIONS[myNation].name}`, 'event');
          // Show dice roll result
          const myOrder = playerOrder.indexOf(myNation) + 1;
          addLog(`🎲 You go ${myOrder}${myOrder===1?'st':myOrder===2?'nd':myOrder===3?'rd':'th'} in turn order.`, 'event');
          popup(`🎲 Turn order decided! You are #${myOrder}`, 3000);
          _delta = emptyDelta();
          const activeNation = playerOrder[currentTurnIdx % playerOrder.length];
          setWaitingUI(activeNation !== myNation);
        }, 80);
        mpLog('🎮 Game started!', 'ok');
        break;
      }

      case 'PLAYER_DELTA': {
        if (role !== 'host') break;
        // Apply this player's actions
        applyPlayerDelta(msg.delta, msg.nation);
        _advanceTurn();
        break;
      }

      case 'PING': {
        if (msg.target === myNation) broadcast('PONG', {});
        break;
      }

      case 'PONG': {
        _resetAfkWatch();
        clearTimeout(_afkKickTimer);
        if (!myTurn) _startAfkWatch();
        break;
      }

      case 'PLAYER_KICKED': {
        const name = NATIONS[msg.nation]&&NATIONS[msg.nation].name || 'Player';
        if (msg.nation === myNation) {
          _showKickBanner('You were removed for inactivity — AI takes over');
          addLog('⚠ You were removed from the game (AFK).', 'warn');
          _convertToSingleplayer();
        } else {
          _showKickBanner(`${name} removed for inactivity — AI takes over`);
          addLog(`⚠ ${name} removed (AFK). AI takes over.`, 'warn');
          players = players.filter(p => p.nation !== msg.nation);
          playerOrder = playerOrder.filter(n => n !== msg.nation);
        }
        break;
      }

      case 'CHAT': {
        const sender = players.find(p => p.nation === msg.nation);
        const who = sender ? (NATIONS[msg.nation]&&NATIONS[msg.nation].name||'?') : 'Player';
        addLog(`💬 ${who}: ${msg.text}`, 'diplo');
        popup(`💬 ${who}: ${msg.text}`, 3500);
        break;
      }
    }
  }

  // ── Host: advance to next player's turn ────────────────────
  async function _advanceTurn() {
    // Advance index
    currentTurnIdx = (currentTurnIdx + 1) % playerOrder.length;
    const nextNation = playerOrder[currentTurnIdx];

    // Is next player a human?
    const isHuman = players.some(p => p.nation === nextNation);

    if (!isHuman) {
      // AI nation — skip (AI handled in endTurn via doAI)
      // Just keep advancing until we find a human
      let loops = 0;
      while (!players.some(p => p.nation === playerOrder[currentTurnIdx]) && loops < playerOrder.length) {
        currentTurnIdx = (currentTurnIdx + 1) % playerOrder.length;
        loops++;
      }
    }

    // After full round (all players done), run game endTurn
    // We track this by checking if we've wrapped around
    if (currentTurnIdx === 0) {
      // Full round complete — run AI + time advance
      _origEndTurn();
    }

    // Broadcast updated state to all
    await sendStateToAll({ type: 'STATE_UPDATE' });
    mpLog(`⏩ Turn → ${NATIONS[playerOrder[currentTurnIdx]]&&NATIONS[playerOrder[currentTurnIdx]].name||'?'}`, 'info');

    // Start AFK watch for new current player
    if (playerOrder[currentTurnIdx] !== myNation) {
      _startAfkWatch();
    }
    // If it's host's turn
    if (playerOrder[currentTurnIdx] === myNation) {
      setWaitingUI(false);
    }
  }

  // ── Apply player delta ─────────────────────────────────────
  function applyPlayerDelta(delta, nation) {
    if (!delta) return;
    const n = nation;
    (delta.armyMoves||[]).forEach(({from,to,amount}) => {
      G.army[from] = Math.max(0,(G.army[from]||0)-amount);
      G.army[to] = (G.army[to]||0)+amount;
      if (G.owner[to]<0) G.owner[to]=n;
    });
    (delta.drafts||[]).forEach(({prov,amount,goldCost}) => {
      G.army[prov]=(G.army[prov]||0)+amount;
      G.pop[prov]=Math.max(500,(G.pop[prov]||0)-amount);
      G.gold[n]=Math.max(0,(G.gold[n]||0)-goldCost);
    });
    (delta.builds||[]).forEach(({prov,building,cost}) => {
      G.gold[n]=Math.max(0,(G.gold[n]||0)-cost);
      (G.buildings[prov]=G.buildings[prov]||[]).push(building);
    });
    // Attacks go into battleQueue — host resolves on endTurn
    (delta.attacks||[]).forEach(({from,to,force}) => {
      const en=G.owner[to];
      if (en>=0&&en!==n) G.war[n][en]=G.war[en][n]=true;
      if (!G.battleQueue) G.battleQueue=[];
      G.battleQueue.push({fr:from,to,force,atker:n});
    });
    (delta.taxRate !== undefined) && (G.taxRates = G.taxRates||{}, G.taxRates[n]=delta.taxRate);
  }

  // ── Convert to singleplayer ────────────────────────────────
  function _convertToSingleplayer() {
    stopPolling();
    clearTimeout(_afkWarnTimer); clearTimeout(_afkKickTimer);
    if (roomId) fbDelete(`rooms/${roomId}`);
    role=null; roomId=null; connected=false; myTurn=true;
    if (_origEndTurn) { window.endTurn=_origEndTurn; _origEndTurn=null; }
    const igBar=document.getElementById('mp-ingame-bar');
    if (igBar) igBar.style.display='none';
    const sp=document.getElementById('side-panel');
    if (sp) { sp.style.opacity='1'; sp.style.pointerEvents=''; }
    const bottom=document.getElementById('bottom');
    if (bottom) { bottom.style.opacity='1'; bottom.style.pointerEvents=''; }
    document.getElementById('end-btn')&&(document.getElementById('end-btn').disabled=false);
    document.getElementById('end-btn-mob')&&(document.getElementById('end-btn-mob').disabled=false);
    addLog('🤖 Game continues as single player.', 'diplo');
    scheduleDraw(); updateHUD();
  }

  // ── Nation pick UI ────────────────────────────────────────
  function showNationPick(taken=[]) {
    const panel = document.getElementById('mp-guest-pick-panel');
    if (!panel) return;
    panel.style.display = 'flex';
    const list = document.getElementById('mp-guest-nation-list');
    if (!list) return;
    list.innerHTML = NATIONS.map((n,i) => {
      const isTaken = taken.includes(i);
      return `<div class="mp-nat-row${isTaken?' mp-nat-taken':''}" 
        id="mp-nat-${i}"
        onclick="${isTaken?'':('MP.claimNation('+i+')')}"
        style="display:flex;align-items:center;gap:9px;padding:7px 10px;
        background:rgba(0,0,0,.2);border:1px solid var(--border);
        cursor:${isTaken?'not-allowed':'pointer'};margin-bottom:3px;
        opacity:${isTaken?'0.35':'1'};transition:all .12s">
        <div style="width:14px;height:14px;border-radius:2px;background:${n.color};flex-shrink:0"></div>
        <span style="font-family:Cinzel,serif;font-size:10px;flex:1">${n.name}</span>
        <span style="font-size:8px;color:var(--dim)">${isTaken?'✗ taken':n.ideology}</span>
      </div>`;
    }).join('');
  }

  function markNationTaken(nation) {
    const el = document.getElementById('mp-nat-' + nation);
    if (!el) return;
    el.style.opacity = '0.35';
    el.style.cursor = 'not-allowed';
    el.onclick = null;
    const sp = el.querySelector('span:last-child');
    if (sp) sp.textContent = '✗ taken';
  }

  // ── Reconnect picker — show only nations already in this game ─
  function showReconnectPick(gamePlayers) {
    const panel = document.getElementById('mp-guest-pick-panel');
    if (panel) { panel.style.display='flex'; panel.style.flexDirection='column'; }
    const list = document.getElementById('mp-guest-nation-list');
    if (!list) return;
    list.innerHTML = `<div style="font-size:9px;color:var(--gold);padding:4px 0 8px;letter-spacing:1px">GAME IN PROGRESS — pick your nation to rejoin</div>` +
      gamePlayers.map(p => {
        const n = NATIONS[p.nation];
        return `<div id="mp-nat-${p.nation}" onclick="MP.reconnectAs(${p.nation})"
          style="display:flex;align-items:center;gap:9px;padding:7px 10px;background:rgba(0,0,0,.2);border:1px solid var(--border);cursor:pointer;margin-bottom:3px">
          <div style="width:14px;height:14px;border-radius:2px;background:${n&&n.color};flex-shrink:0"></div>
          <span style="font-family:Cinzel,serif;font-size:10px;flex:1">${p.name||'?'}</span>
          <span style="font-size:8px;color:var(--gold)">↩ Rejoin</span>
        </div>`;
      }).join('');
    const btn = document.getElementById('mp-join-ready-btn');
    if (btn) { btn.textContent = '↩ Rejoin Game'; btn.removeAttribute('disabled'); btn.onclick = ()=>{}; }
  }

  // ── Delta helpers ─────────────────────────────────────────
  function emptyDelta() {
    return { armyMoves:[], drafts:[], builds:[], attacks:[], taxRate: undefined };
  }

  // ── Patch endTurn ─────────────────────────────────────────
  function patchEndTurn() {
    if (_origEndTurn) return;
    _origEndTurn = window.endTurn;
    window.endTurn = function() {
      if (!role) { _origEndTurn(); return; }

      if (role === 'host' && playerOrder[currentTurnIdx % playerOrder.length] === myNation) {
        // Host's own turn — send delta and advance
        broadcast('PLAYER_DELTA', { delta: _delta, nation: myNation });
        _delta = emptyDelta();
        setWaitingUI(true);
        // _advanceTurn() will be triggered by our own broadcast being received
        // Actually: host processes directly
        applyPlayerDelta(_delta, myNation);
        _advanceTurn();
        return;
      }

      if (role === 'player') {
        broadcast('PLAYER_DELTA', { delta: _delta, nation: myNation });
        _delta = emptyDelta();
        setWaitingUI(true);
        mpLog('📤 Turn submitted…', 'info');
        return;
      }

      _origEndTurn();
    };
  }

  function patchPlayerActions() {
    const origMove = window.confirmMove;
    window.confirmMove = function(from, to) {
      if (role && myTurn) {
        const v = +(document.getElementById('msl')&&document.getElementById('msl').value || G.army[from]);
        const s = season();
        const terrMod = s.winterTerrain&&s.winterTerrain.includes(PROVINCES[to].terrain)?s.moveMod:1.0;
        _delta.armyMoves.push({from, to, amount: Math.round(v*terrMod)});
      }
      origMove&&origMove(from, to);
    };
    const origDraft = window.confirmDraft;
    window.confirmDraft = function() {
      if (role && myTurn) {
        const r = window._dr;
        const v = +(document.getElementById('dsl')&&document.getElementById('dsl').value||0);
        if (r>=0&&v>0) _delta.drafts.push({prov:r, amount:v, goldCost:v});
      }
      origDraft&&origDraft();
    };
    const origBuild = window.queueBuild;
    window.queueBuild = function(k, ri2) {
      if (role && myTurn) {
        const io = ideol();
        const cost = Math.round((BUILDINGS[k]&&BUILDINGS[k].cost||100)*(io.buildCostMod||1));
        _delta.builds.push({prov:ri2, building:k, cost});
      }
      origBuild&&origBuild(k, ri2);
    };
    const origLaunch = window.launchAtk;
    window.launchAtk = function(breakDiplo) {
      if (role && myTurn) {
        const fr=window._af, to=window._at;
        const force=+(document.getElementById('asl')&&document.getElementById('asl').value||availableArmy(fr));
        _delta.attacks.push({from:fr, to, force});
        if (breakDiplo&&G.owner[to]>=0) {
          G.war[myNation][G.owner[to]]=G.war[G.owner[to]][myNation]=true;
        }
      }
      origLaunch&&origLaunch(breakDiplo);
    };
  }

  // ── setWaitingUI ──────────────────────────────────────────
  function setWaitingUI(waiting) {
    myTurn = !waiting;
    const endBtn=document.getElementById('end-btn');
    const endBtnMob=document.getElementById('end-btn-mob');
    if (endBtn) endBtn.disabled = waiting;
    if (endBtnMob) endBtnMob.disabled = waiting;
    const sp=document.getElementById('side-panel');
    const bottom=document.getElementById('bottom');
    if (sp) { sp.style.opacity=waiting?'0.4':'1'; sp.style.pointerEvents=waiting?'none':''; }
    if (bottom) { bottom.style.opacity=waiting?'0.4':'1'; bottom.style.pointerEvents=waiting?'none':''; }
    const indWrap=document.getElementById('mp-turn-indicator-wrap');
    const indicator=document.getElementById('mp-turn-indicator');
    if (indWrap) indWrap.style.display = connected?'block':'none';
    if (indicator) {
      const activeNation = playerOrder[currentTurnIdx % playerOrder.length];
      const activeName = NATIONS[activeNation]&&NATIONS[activeNation].name || 'Player';
      indicator.textContent = waiting ? `⏳ ${activeName}'s turn` : '⚔ Your turn';
      indicator.style.color = waiting ? '#8060c0' : '#40a830';
    }
    const igBar=document.getElementById('mp-ingame-bar');
    if (igBar) igBar.style.display=connected?'flex':'none';
    if (!waiting) {
      popup('⚔ Your turn!', 2000);
      addLog('── Your turn ──', 'diplo');
      setMpStatus('Your turn', 'ok');
      clearTimeout(_afkWarnTimer); clearTimeout(_afkKickTimer);
    } else {
      setMpStatus('Waiting…', 'waiting');
      _startAfkWatch();
    }
  }

  function setMpStatus(text, type='idle') {
    const colors={idle:'#555',connecting:'#c9a84c',ok:'#40a830',err:'#cc3030',waiting:'#8060c0'};
    const dot=document.getElementById('mp-status-dot');
    const txt=document.getElementById('mp-status-text');
    const igDot=document.getElementById('mp-ig-dot');
    const igTxt=document.getElementById('mp-ig-txt');
    if (dot) dot.style.background=colors[type]||colors.idle;
    if (txt) txt.textContent=text;
    if (igDot) igDot.style.background=colors[type]||colors.idle;
    if (igTxt) igTxt.textContent=text;
  }

  function mpLog(msg, type='info') {
    const el=document.getElementById('mp-log');
    if (!el) return;
    const colors={info:'#8a7848',ok:'#40a830',warn:'#cc8030',err:'#cc3030',chat:'#c9a84c'};
    const div=document.createElement('div');
    div.style.cssText=`padding:3px 0;border-bottom:1px solid rgba(42,36,24,.15);font-size:10px;color:${colors[type]||colors.info}`;
    div.innerHTML=`<span style="color:var(--dim);font-size:8px">${new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}</span> ${msg}`;
    el.insertAdjacentElement('afterbegin',div);
    while(el.children.length>40)el.removeChild(el.lastChild);
  }

  // ── PUBLIC API ────────────────────────────────────────────
  return {
    get role()      { return role; },
    get connected() { return connected; },
    get myTurn()    { return myTurn; },
    get active()    { return role !== null; },
    canAct()        { return !role || myTurn; },

    // Host creates room and picks nation
    createRoom(nation) {
      myNation = nation;
      myPlayerId = 'host_' + Date.now();
      role = 'host';
      roomId = Math.floor(100000 + Math.random() * 900000).toString();

      players = [{ id: myPlayerId, nation, name: NATIONS[nation]&&NATIONS[nation].name||'?' }];

      mpLog(`✅ Room: <b>${roomId}</b>`, 'ok');
      setMpStatus('Waiting for players…', 'connecting');

      const ridEl = document.getElementById('mp-room-id');
      if (ridEl) ridEl.textContent = roomId;

      // Show invite link
      const linkEl = document.getElementById('mp-invite-link');
      if (linkEl) {
        const url = `${location.origin}${location.pathname}?room=${roomId}`;
        linkEl.textContent = url;
        linkEl.href = url;
      }

      const disp = document.getElementById('mp-room-display');
      if (disp) disp.style.display = 'flex';
      const wt = document.getElementById('mp-waiting-text');
      if (wt) wt.style.display = 'flex';

      fbSet(`rooms/${roomId}/info`, { host: nation, created: Date.now(), maxPlayers: 6 });
      _seenKeys.clear();
      startPolling();
      patchEndTurn();
      patchPlayerActions();
    },

    // Non-host joins by code
    joinRoom(id) {
      if (!id||!id.trim()) { mpLog('Enter a room code!', 'warn'); return; }
      myPlayerId = 'player_' + Date.now();
      role = 'player';
      roomId = id.trim();
      mpLog(`⏳ Joining ${roomId}…`, 'info');
      setMpStatus('Connecting…', 'connecting');

      fbGet(`rooms/${roomId}/info`).then(async info => {
        if (!info) {
          mpLog('❌ Room not found', 'err');
          setMpStatus('Room not found', 'err');
          role = null; roomId = null;
          return;
        }
        mpLog('✅ Room found!', 'ok');
        connected = true;
        _seenKeys.clear();
        startPolling();
        patchEndTurn();
        patchPlayerActions();

        // Check if game is already running (has state) → reconnect
        const stateData = await fbGet(`rooms/${roomId}/state`);
        if (stateData && stateData.state && stateData.players && stateData.players.length > 0) {
          // Game in progress — show nation picker from existing players
          mpLog('🔄 Game in progress — reconnecting…', 'ok');
          setMpStatus('Reconnecting…', 'connecting');
          players = stateData.players || [];
          playerOrder = stateData.playerOrder || [];
          currentTurnIdx = stateData.currentTurnIdx || 0;
          // Show reconnect nation picker (only nations already in this game)
          showReconnectPick(players);
        } else {
          // Lobby phase
          setMpStatus('Pick your nation…', 'waiting');
          broadcast('PLAYER_JOINED', {});
        }
      });
    },

    // Rejoin an in-progress game as a specific nation
    reconnectAs(nation) {
      myNation = nation;
      const pp = document.getElementById('mp-guest-pick-panel');
      if (pp) pp.style.display = 'none';
      mpLog(`🔄 Rejoining as ${NATIONS[nation]&&NATIONS[nation].name}…`, 'ok');
      setMpStatus('Rejoining…', 'connecting');
      // Pull latest state immediately
      fbGet(`rooms/${roomId}/state`).then(st => {
        if (!st || !st.state) { mpLog('❌ Could not load state', 'err'); return; }
        _lastStateTs = 0; // force apply
        applyServerState(st);
        connected = true;
        G.playerNation = myNation;
        G.ideology = NATIONS[myNation]&&NATIONS[myNation].ideology||'democracy';
        show('game');
        setTimeout(()=>{
          computeHexRadius(); buildCanvas(); zoomReset();
          updateHUD(); updateIdeoHUD(); updateSeasonUI();
          addLog(`↩ Reconnected as ${NATIONS[myNation]&&NATIONS[myNation].name}.`, 'diplo');
          popup(`↩ Reconnected!`, 2000);
        }, 80);
      });
    },

    // Player claims a nation slot
    claimNation(i) {
      if (myNation === i) return;
      myNation = i;
      // Highlight selection
      document.querySelectorAll('.mp-nat-row').forEach(r => r.style.borderColor='var(--border)');
      const el = document.getElementById('mp-nat-' + i);
      if (el) el.style.borderColor = 'var(--gold)';
      broadcast('NATION_CLAIMED', { nation: i });
      mpLog(`✓ Claimed <b>${NATIONS[i]&&NATIONS[i].name}</b>`, 'ok');
      document.getElementById('mp-join-ready-btn')&&document.getElementById('mp-join-ready-btn').removeAttribute('disabled');
    },

    playerReady() {
      if (myNation < 0) { mpLog('Pick a nation first!', 'warn'); return; }
      players.push({ id: myPlayerId, nation: myNation, name: NATIONS[myNation]&&NATIONS[myNation].name||'?' });
      mpLog('✅ Ready!', 'ok');
      setMpStatus('Waiting for host to start…', 'waiting');
      const pp = document.getElementById('mp-guest-pick-panel');
      if (pp) pp.style.display = 'none';
      const gw = document.getElementById('mp-guest-waiting');
      if (gw) gw.style.display = 'flex';
    },

    startMultiplayerGame() {
      if (players.length < 2) { popup('Need at least 2 players!'); return; }
      // Initialize game
      SC = myNation; SI = NATIONS[myNation].ideology;
      startGame();
      G.playerNation = myNation;
      G.ideology = NATIONS[myNation].ideology;
      // Save MP session for reconnect
      try{localStorage.setItem('toc_mp_session',JSON.stringify({roomId,nation:myNation}));}catch(e){}

      setTimeout(() => {
        // 🎲 Roll dice to determine turn order
        const shuffled = [...players];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        playerOrder = shuffled.map(p => p.nation);
        currentTurnIdx = 0;
        players = shuffled;

        const diceLog = shuffled.map((p, idx) =>
          `${idx+1}. ${NATIONS[p.nation]&&NATIONS[p.nation].name||'?'}`
        ).join(' → ');
        addLog(`🎲 Turn order: ${diceLog}`, 'event');

        const snap = JSON.parse(JSON.stringify(G, (k,v) => v instanceof Set ? [...v] : v));
        broadcast('GAME_START', {
          state: snap,
          playerOrder,
          currentTurnIdx,
          players
        });

        connected = true;
        const firstNation = playerOrder[0];
        setWaitingUI(firstNation !== myNation);
        mpLog('🎮 Game started! Turn order rolled.', 'ok');
      }, 250);
    },

    sendChat(text) {
      if (!text||!text.trim()) return;
      addLog(`💬 You: ${text}`, 'diplo');
      broadcast('CHAT', { text: text.trim() });
    },

    disconnect() {
      stopPolling();
      clearTimeout(_afkWarnTimer); clearTimeout(_afkKickTimer);
      if (roomId) fbDelete(`rooms/${roomId}`);
      role=null; roomId=null; connected=false; myTurn=false; myNation=-1;
      if (_origEndTurn) { window.endTurn=_origEndTurn; _origEndTurn=null; }
      try{localStorage.removeItem('toc_mp_session');}catch(e){}
      setMpStatus('Disconnected', 'idle');
      mpLog('Disconnected', 'warn');
      const sp=document.getElementById('side-panel');
      if (sp) { sp.style.opacity='1'; sp.style.pointerEvents=''; }
    },

    // Auto-fill room code from URL ?room=XXXXXX
    checkDeepLink() {
      const params = new URLSearchParams(location.search);
      const code = params.get('room');
      if (!code) return;
      const inp = document.getElementById('mp-join-code');
      if (inp) { inp.value = code; }
      // Auto-navigate to join screen
      show('mp');
      mpLog(`🔗 Room code from link: ${code}`, 'ok');
    }
  };
})();

// Check deep link on load
document.addEventListener('DOMContentLoaded', () => { try { MP.checkDeepLink(); } catch(e) {} });
