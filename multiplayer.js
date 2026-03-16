// ════════════════════════════════════════════════════════════
//  TIME OF CONQUEST — MULTIPLAYER (WebRTC via PeerJS)
//  Architecture:
//    HOST  — creates room, picks nation, initialises G, sends
//            full state after every endTurn()
//    GUEST — joins room, picks a different nation, receives
//            G updates, runs local UI only (no AI for players)
//
//  Message types:
//    SETUP   — host sends initial G snapshot + nation assignments
//    STATE   — host sends G after each full turn cycle
//    ACTION  — guest sends their turn actions (list of commands)
//    CHAT    — in-game chat message
//    PING/PONG — keep-alive
// ════════════════════════════════════════════════════════════

const MP = (() => {

  // ── State ─────────────────────────────────────────────────
  let peer = null;       // PeerJS instance
  let conn = null;       // active DataConnection
  let role = null;       // 'host' | 'guest' | null
  let roomId = null;     // the 6-char room code
  let guestNation = -1;  // which nation the guest controls
  let hostNation  = -1;
  let myTurn = false;    // is it currently this player's turn?
  let connected = false;
  let pingTimer = null;
  let reconnectAttempts = 0;

  // Pending guest actions queue (applied when host processes turn)
  let guestActions = [];
  let waitingForGuest = false;

  // ── PeerJS config ─────────────────────────────────────────
  const PEER_CONFIG = {
    // Uses PeerJS public cloud broker for signalling only
    // After handshake all data is P2P
    config: {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ]
    },
    debug: 0
  };

  // ── UI helpers ────────────────────────────────────────────
  function mpLog(msg, type='info') {
    const el = document.getElementById('mp-log');
    if (!el) return;
    const colors = { info:'#8a7848', ok:'#40a830', warn:'#cc8030', err:'#cc3030', chat:'#c9a84c' };
    const div = document.createElement('div');
    div.style.cssText = `padding:3px 0;border-bottom:1px solid rgba(42,36,24,.15);font-size:10px;color:${colors[type]||colors.info};animation:mpFadeIn .3s ease`;
    div.innerHTML = `<span style="color:var(--dim);font-size:8px">${new Date().toLocaleTimeString('en',{hour:'2-digit',minute:'2-digit'})}</span> ${msg}`;
    el.insertAdjacentElement('afterbegin', div);
    while (el.children.length > 40) el.removeChild(el.lastChild);
  }

  function setStatus(text, type='idle') {
    const el = document.getElementById('mp-status-dot');
    const tl = document.getElementById('mp-status-text');
    const colors = { idle:'#555', connecting:'#c9a84c', ok:'#40a830', err:'#cc3030', waiting:'#8060c0' };
    if (el) el.style.background = colors[type] || colors.idle;
    if (tl) tl.textContent = text;
    // Also update in-game indicator
    const ig = document.getElementById('mp-ingame-bar');
    const igDot = document.getElementById('mp-ig-dot');
    const igTxt = document.getElementById('mp-ig-txt');
    if (ig) ig.style.display = connected ? 'flex' : 'none';
    if (igDot) igDot.style.background = colors[type] || colors.idle;
    if (igTxt) igTxt.textContent = text;
  }

  function setTurnUI(isMine) {
    myTurn = isMine;
    const endBtn = document.getElementById('end-btn');
    const endBtnMob = document.getElementById('end-btn-mob');
    const overlay = document.getElementById('mp-turn-overlay');
    if (endBtn) endBtn.disabled = !isMine;
    if (endBtnMob) endBtnMob.disabled = !isMine;
    if (overlay) overlay.style.display = isMine ? 'none' : 'flex';
    if (isMine) {
      popup('⚔ Your turn!', 2200);
      addLog('── Your turn ──', 'diplo');
      setStatus('Your turn', 'ok');
    } else {
      setStatus('Waiting for opponent…', 'waiting');
    }
  }

  // ── Send helpers ──────────────────────────────────────────
  function send(type, payload = {}) {
    if (!conn || conn.open === false) { mpLog('⚠ Not connected', 'warn'); return; }
    try { conn.send(JSON.stringify({ type, ...payload })); }
    catch(e) { mpLog('Send error: ' + e.message, 'err'); }
  }

  function sendPing() { send('PING'); }

  // ── Connection setup ──────────────────────────────────────
  function wireConnection(c) {
    conn = c;
    conn.on('open', () => {
      connected = true;
      reconnectAttempts = 0;
      mpLog('🟢 Connection established!', 'ok');
      setStatus('Connected', 'ok');
      clearInterval(pingTimer);
      pingTimer = setInterval(sendPing, 8000);

      if (role === 'host') {
        // Send initial setup to guest
        send('HELLO', { hostNation, availableNations: getAvailableNations() });
      }
    });

    conn.on('data', raw => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      handleMessage(msg);
    });

    conn.on('close', () => {
      connected = false;
      clearInterval(pingTimer);
      mpLog('🔴 Connection closed', 'err');
      setStatus('Disconnected', 'err');
      if (document.getElementById('s-game')?.classList.contains('on')) {
        popup('⚠ Opponent disconnected!', 5000);
        // Allow local play to continue
        setTurnUI(true);
      }
    });

    conn.on('error', e => {
      mpLog('Connection error: ' + e.type, 'err');
      setStatus('Error', 'err');
    });
  }

  // ── Message handler ───────────────────────────────────────
  function handleMessage(msg) {
    switch(msg.type) {

      case 'PING': send('PONG'); break;
      case 'PONG': break; // just keep-alive

      // Host → Guest: initial handshake
      case 'HELLO':
        hostNation = msg.hostNation;
        mpLog(`🤝 Host is playing as <b>${NATIONS[hostNation]?.name || hostNation}</b>`, 'ok');
        showGuestNationPick(msg.availableNations);
        break;

      // Guest → Host: picked nation
      case 'NATION_PICK':
        guestNation = msg.nation;
        mpLog(`👤 Guest picked <b>${NATIONS[guestNation]?.name}</b>`, 'ok');
        // Show in lobby
        const gpEl = document.getElementById('mp-guest-nation');
        if (gpEl) gpEl.textContent = NATIONS[guestNation]?.name || '?';
        document.getElementById('mp-start-game-btn')?.removeAttribute('disabled');
        break;

      // Host → Guest: game is starting, here's the initial state
      case 'GAME_START':
        guestNation = msg.guestNation;
        hostNation  = msg.hostNation;
        applyState(msg.state);
        G.playerNation = guestNation;
        show('game');
        setTimeout(() => {
          computeHexRadius(); buildCanvas(); zoomReset();
          updateHUD(); updateIdeoHUD(); updateSeasonUI();
          addLog('🌐 Multiplayer game started!', 'diplo');
          addLog(`You control: ${NATIONS[guestNation]?.name}`, 'event');
        }, 80);
        setTurnUI(false); // host goes first
        mpLog('🎮 Game started — host goes first', 'ok');
        break;

      // Guest → Host: guest finished their turn, here are actions
      case 'GUEST_TURN_END':
        guestActions = msg.actions || [];
        waitingForGuest = false;
        mpLog('📨 Guest ended turn', 'ok');
        applyGuestActions();
        hostProcessFullTurn();
        break;

      // Host → Guest: full state sync after host processed everything
      case 'STATE_SYNC':
        applyState(msg.state);
        updateHUD(); updateIdeoHUD(); updateSeasonUI(); scheduleDraw();
        if (G.sel >= 0) updateSP(G.sel);
        setTurnUI(true); // now guest's turn
        mpLog('🔄 State synced', 'info');
        break;

      // Both: chat
      case 'CHAT':
        const who = msg.from === 'host'
          ? (NATIONS[hostNation]?.name || 'Host')
          : (NATIONS[guestNation]?.name || 'Guest');
        addLog(`💬 ${who}: ${msg.text}`, 'diplo');
        mpLog(`💬 <b>${who}:</b> ${msg.text}`, 'chat');
        popup(`💬 ${who}: ${msg.text}`, 3500);
        break;

      // Host → Guest: sync a single action result immediately (for responsiveness)
      case 'ACTION_RESULT':
        // Partial update — just redraw
        if (msg.log) addLog(msg.log.msg, msg.log.type);
        scheduleDraw(); updateHUD();
        break;
    }
  }

  // ── Guest action recording ─────────────────────────────────
  // When guest is playing, we intercept state changes and record them
  // as serializable commands to send to host
  const recordedActions = [];

  function recordAction(type, data) {
    if (role !== 'guest' || !myTurn) return;
    recordedActions.push({ type, data, ts: Date.now() });
  }

  // Apply guest's recorded actions on host side
  function applyGuestActions() {
    for (const act of guestActions) {
      try {
        switch (act.type) {
          case 'MOVE':
            const { from, to, amount } = act.data;
            G.army[from] = Math.max(0, G.army[from] - amount);
            G.army[to] += amount;
            addLog(`[Guest] ${PROVINCES[from]?.short}→${PROVINCES[to]?.short}: ${amount} troops`, 'move');
            break;
          case 'DRAFT':
            G.army[act.data.prov] += act.data.amount;
            G.pop[act.data.prov] = Math.max(1000, G.pop[act.data.prov] - act.data.amount * 1000);
            G.gold[guestNation] -= act.data.amount;
            break;
          case 'ATTACK':
            // Re-run combat with same seed for determinism
            resolveAttack(act.data.from, act.data.to, act.data.send, guestNation);
            break;
          case 'BUILD':
            if (G.gold[guestNation] >= act.data.cost) {
              G.gold[guestNation] -= act.data.cost;
              (G.buildings[act.data.prov] = G.buildings[act.data.prov] || []).push(act.data.building);
            }
            break;
          case 'IDEOLOGY':
            G.ideology_player2 = act.data.ideology; // stored separately
            break;
        }
      } catch(e) { /* ignore bad actions */ }
    }
    guestActions = [];
  }

  // ── Combat resolver (shared logic) ───────────────────────
  function resolveAttack(from, to, send, attackerNation) {
    const aio = IDEOLOGIES[NATIONS[attackerNation]?.ideology || 'nationalism'];
    const s = season();
    const def3 = G.owner[to];
    if (def3 >= 0 && def3 !== attackerNation) G.war[attackerNation][def3] = G.war[def3][attackerNation] = true;
    const terrain2 = TERRAIN[PROVINCES[to]?.terrain || 'plains'];
    const frt = (G.buildings[to] || []).includes('fortress') ? 1.6 : 1;
    const terrMod = s.winterTerrain?.includes(PROVINCES[to]?.terrain) ? s.moveMod : 1.0;
    const win = send * aio.atk * terrMod * rf(.75,1.25) > G.army[to] * terrain2.defB * frt * rf(.75,1.25);
    if (win) {
      const al = Math.floor(send * rf(.15,.3));
      G.army[from] -= send; G.army[to] = Math.max(50, send - al); G.owner[to] = attackerNation;
      G.instab[to] = ri(30,60); G.assim[to] = ri(5,20);
      addLog(`⚔ [Guest] seized ${PROVINCES[to]?.name}!`, 'war');
    } else {
      G.army[from] = Math.max(0, G.army[from] - Math.floor(send * rf(.1,.28)));
      G.army[to] = Math.max(50, G.army[to] - Math.floor(G.army[to] * rf(.08,.25)));
    }
  }

  // ── Host: process full turn after guest actions applied ───
  function hostProcessFullTurn() {
    // endTurn() already runs all the game logic including AI
    // We hook into endTurn via the MP.onEndTurn callback
    // After endTurn finishes, sync state to guest
    const stateSnap = JSON.stringify(G);
    send('STATE_SYNC', { state: JSON.parse(stateSnap) });
    setTurnUI(true); // host's turn again... wait, actually:
    // Turn order: host acts → host ends → guest acts → guest ends → repeat
    // After guest ends, host processes and it becomes GUEST's turn again
    // Actually: we just alternate. After host sends STATE_SYNC, it's guest's turn.
    // So host goes back to waiting after sending state.
    // We handle this in the endTurn hook below.
  }

  // ── State apply ───────────────────────────────────────────
  function applyState(state) {
    // Deep-assign received state into G
    Object.assign(G, state);
  }

  // ── Available nations ─────────────────────────────────────
  function getAvailableNations() {
    return NATIONS.map((n,i) => ({ i, name: n.name, color: n.color, ideology: n.ideology }))
      .filter(n => n.i !== hostNation);
  }

  // ── Guest nation picker ───────────────────────────────────
  function showGuestNationPick(nations) {
    const panel = document.getElementById('mp-guest-pick-panel');
    if (!panel) return;
    panel.style.display = 'flex';
    const list = document.getElementById('mp-guest-nation-list');
    if (!list) return;
    list.innerHTML = nations.map(n => `
      <div class="mp-nat-row" onclick="MP.pickGuestNation(${n.i})" style="display:flex;align-items:center;gap:9px;padding:7px 10px;background:rgba(0,0,0,.2);border:1px solid var(--border);cursor:pointer;margin-bottom:3px;transition:all .12s">
        <div style="width:14px;height:14px;border-radius:2px;background:${n.color};flex-shrink:0;border:1px solid rgba(255,255,255,.1)"></div>
        <span style="font-family:Cinzel,serif;font-size:10px;flex:1">${n.name}</span>
        <span style="font-size:8px;color:var(--dim)">${n.ideology}</span>
      </div>
    `).join('');
  }

  // ── PUBLIC API ────────────────────────────────────────────
  return {

    get role() { return role; },
    get connected() { return connected; },
    get myTurn() { return myTurn; },
    get guestNation() { return guestNation; },
    get hostNation() { return hostNation; },
    get active() { return role !== null && connected; },

    // Called when host clicks "Create Room"
    createRoom(nation) {
      if (typeof Peer === 'undefined') {
        mpLog('⚠ PeerJS not loaded — check internet connection', 'err');
        setStatus('PeerJS unavailable', 'err');
        popup('PeerJS library not loaded. Check your internet connection.');
        return;
      }
      hostNation = nation;
      role = 'host';
      mpLog('⏳ Creating room…', 'info');
      setStatus('Creating room…', 'connecting');

      peer = new Peer(undefined, PEER_CONFIG);

      peer.on('open', id => {
        roomId = id;
        mpLog(`✅ Room created: <b>${id}</b>`, 'ok');
        setStatus('Waiting for guest…', 'connecting');
        // Show room ID in UI
        const ridEl = document.getElementById('mp-room-id');
        if (ridEl) {
          ridEl.textContent = id;
          ridEl.parentElement?.style && (ridEl.parentElement.style.display = 'block');
        }
        document.getElementById('mp-waiting-text')?.style && (document.getElementById('mp-waiting-text').style.display='block');
      });

      peer.on('connection', c => {
        if (conn) { c.close(); return; } // only one guest
        mpLog('👤 Guest connecting…', 'info');
        wireConnection(c);
      });

      peer.on('error', e => {
        mpLog('PeerJS error: ' + e.type, 'err');
        setStatus('Error — ' + e.type, 'err');
      });
    },

    // Called when guest clicks "Join Room"
    joinRoom(id, nation) {
      if (typeof Peer === 'undefined') {
        mpLog('⚠ PeerJS not loaded — check internet connection', 'err');
        setStatus('PeerJS unavailable', 'err');
        popup('PeerJS library not loaded. Check your internet connection.');
        return;
      }
      if (!id || !id.trim()) { mpLog('Enter a room ID!', 'warn'); return; }
      guestNation = nation; // tentative, host may override
      role = 'guest';
      roomId = id.trim();
      mpLog(`⏳ Connecting to room ${roomId}…`, 'info');
      setStatus('Connecting…', 'connecting');

      peer = new Peer(undefined, PEER_CONFIG);

      peer.on('open', myId => {
        mpLog(`My peer ID: ${myId}`, 'info');
        const c = peer.connect(roomId, { reliable: true, serialization: 'raw' });
        wireConnection(c);
      });

      peer.on('error', e => {
        mpLog('Error: ' + e.type, 'err');
        if (e.type === 'peer-unavailable') mpLog('Room not found — check the ID', 'warn');
        setStatus('Error', 'err');
      });
    },

    // Guest picks their nation
    pickGuestNation(i) {
      guestNation = i;
      document.querySelectorAll('.mp-nat-row').forEach(r => r.style.borderColor = 'var(--border)');
      event?.currentTarget?.style && (event.currentTarget.style.borderColor = 'var(--gold)');
      send('NATION_PICK', { nation: i });
      mpLog(`✓ You picked <b>${NATIONS[i]?.name}</b>`, 'ok');
      document.getElementById('mp-join-ready-btn')?.removeAttribute('disabled');
    },

    // Host starts the game
    startMultiplayerGame() {
      if (guestNation < 0) { popup('Guest hasn't picked a nation yet!'); return; }
      // Set up G exactly like single player
      SC = hostNation; SI = NATIONS[hostNation].ideology;
      startGame(); // this shows 'game' screen and sets up G

      // Override G.playerNation for host
      G.playerNation = hostNation;

      // Send game start to guest
      setTimeout(() => {
        send('GAME_START', {
          hostNation,
          guestNation,
          state: JSON.parse(JSON.stringify(G))
        });
        setTurnUI(true); // host goes first
        mpLog('🎮 Game started! You go first.', 'ok');
      }, 200);
    },

    // Guest signals ready (after picking nation)
    guestReady() {
      mpLog('✅ Ready! Waiting for host to start…', 'ok');
      setStatus('Waiting for host…', 'waiting');
      document.getElementById('mp-guest-pick-panel').style.display = 'none';
      document.getElementById('mp-guest-waiting').style.display = 'flex';
    },

    // Called from patched endTurn — HOST only
    onHostEndTurn() {
      if (role !== 'host') return false;
      // It's now guest's turn — wait for their actions
      waitingForGuest = true;
      recordedActions.length = 0;
      setTurnUI(false);
      mpLog('⏳ Waiting for guest to end their turn…', 'info');
      send('YOUR_TURN', { state: JSON.parse(JSON.stringify(G)) });
      return true; // signals endTurn to skip AI (we do it after guest)
    },

    // Called from patched endTurn — GUEST only
    onGuestEndTurn() {
      if (role !== 'guest') return false;
      // Send actions to host and wait for state sync
      send('GUEST_TURN_END', { actions: recordedActions.slice() });
      recordedActions.length = 0;
      setTurnUI(false);
      mpLog('📤 Turn sent to host…', 'info');
      return true;
    },

    // Record an action (guest side)
    recordAction,

    // Send chat message
    sendChat(text) {
      if (!text?.trim()) return;
      const from = role;
      addLog(`💬 You: ${text}`, 'diplo');
      send('CHAT', { from, text: text.trim() });
    },

    // Disconnect
    disconnect() {
      clearInterval(pingTimer);
      if (conn) { try { conn.close(); } catch {} }
      if (peer) { try { peer.destroy(); } catch {} }
      conn = null; peer = null; role = null; roomId = null;
      connected = false; myTurn = false;
      setStatus('Disconnected', 'idle');
      mpLog('Disconnected', 'warn');
    },

    // Check if actions are allowed (for UI locking)
    canAct() {
      if (!role) return true; // singleplayer — always allowed
      return myTurn;
    }
  };
})();

// ── Patch endTurn to handle multiplayer ──────────────────────
const _origEndTurn = window.endTurn;
window.endTurn = function() {
  if (MP.role === 'host') {
    // Run normal turn processing but skip AI (it runs after guest responds)
    _origEndTurn();
    MP.onHostEndTurn();
    return;
  }
  if (MP.role === 'guest') {
    // Guest just signals done — no AI, no time advance
    MP.onGuestEndTurn();
    return;
  }
  // Singleplayer
  _origEndTurn();
};

// ── Patch action functions to record for guest ───────────────
const _origOpenMoveDialog = window.openMoveDialog;
// We record moves at the confirm stage in game.js — hook via MP.recordAction
