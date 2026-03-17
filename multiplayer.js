// ════════════════════════════════════════════════════════════
//  TIME OF CONQUEST — ONLINE MULTIPLAYER
//  Uses Firebase Realtime Database as relay.
//
//  ⚠ SETUP REQUIRED (2 minutes, free):
//  1. Go to console.firebase.google.com
//  2. Create project → Build → Realtime Database
//  3. "Start in test mode" → copy your DB URL
//  4. Replace FB_URL below with your URL
// ════════════════════════════════════════════════════════════

const MP = (() => {

  // ── YOUR FIREBASE URL HERE ────────────────────────────────
  // Replace with your own from console.firebase.google.com
  // Format: https://YOUR-PROJECT-default-rtdb.firebaseio.com
  const FB_URL = (window.TOC_FIREBASE_URL || 'https://timeofconquest-default-rtdb.europe-west1.firebasedatabase.app').replace(/\/$/, '');

  function checkConfig() {
    if (!FB_URL) {
      const msg = `⚠ Firebase not configured!\n\nTo enable multiplayer:\n1. Go to console.firebase.google.com\n2. Create project → Realtime Database → Test mode\n3. Copy your DB URL\n4. Open multiplayer.js and set FB_URL`;
      mpLog('⚠ Firebase URL not set — see instructions below', 'err');
      setStatus('Not configured', 'err');
      document.getElementById('mp-firebase-setup')?.style && (document.getElementById('mp-firebase-setup').style.display='block');
      return false;
    }
    return true;
  }

  let role = null;
  let roomId = null;
  let guestNation = -1;
  let hostNation  = -1;
  let myTurn = false;
  let connected = false;
  let _pollTimer = null;
  let _lastMsgId = 0;
  let _msgQueue = [];

  // ── Firebase REST helpers ──────────────────────────────────
  async function fbSet(path, data) {
    try {
      const r = await fetch(`${FB_URL}/${path}.json`, {
        method: 'PUT',
        body: JSON.stringify(data)
      });
      return r.ok;
    } catch(e) { return false; }
  }

  async function fbPush(path, data) {
    try {
      const r = await fetch(`${FB_URL}/${path}.json`, {
        method: 'POST',
        body: JSON.stringify({ ...data, _ts: Date.now() })
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
    try {
      await fetch(`${FB_URL}/${path}.json`, { method: 'DELETE' });
    } catch(e) {}
  }

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
    const colors = { idle:'#555', connecting:'#c9a84c', ok:'#40a830', err:'#cc3030', waiting:'#8060c0' };
    const dot = document.getElementById('mp-status-dot');
    const txt = document.getElementById('mp-status-text');
    if (dot) dot.style.background = colors[type] || colors.idle;
    if (txt) txt.textContent = text;
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

  // ── Send message via Firebase ─────────────────────────────
  async function send(type, payload = {}) {
    if (!roomId) return;
    const channel = role === 'host' ? 'host_to_guest' : 'guest_to_host';
    await fbPush(`rooms/${roomId}/${channel}`, { type, ...payload });
  }

  // ── Poll for messages ─────────────────────────────────────
  let _seenKeys = new Set();

  function startPolling() {
    if (_pollTimer) clearInterval(_pollTimer);
    _pollTimer = setInterval(async () => {
      if (!roomId) return;
      const channel = role === 'host' ? 'guest_to_host' : 'host_to_guest';
      const msgs = await fbGet(`rooms/${roomId}/${channel}`);
      if (!msgs) return;
      const entries = Object.entries(msgs).sort((a,b) => (a[1]._ts||0)-(b[1]._ts||0));
      for (const [key, msg] of entries) {
        if (_seenKeys.has(key)) continue;
        _seenKeys.add(key);
        handleMessage(msg);
      }
    }, 1500); // poll every 1.5 seconds
  }

  function stopPolling() {
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // ── Message handler ───────────────────────────────────────
  function handleMessage(msg) {
    switch(msg.type) {
      case 'GUEST_ARRIVED':
        mpLog('👤 Guest joined!', 'ok');
        setStatus('Guest connected — pick nations', 'ok');
        connected = true;
        send('HELLO', { hostNation, availableNations: getAvailableNations() });
        break;

      case 'HELLO':
        hostNation = msg.hostNation;
        mpLog(`🤝 Host plays as <b>${NATIONS[hostNation]?.name}</b>`, 'ok');
        showGuestNationPick(msg.availableNations);
        break;

      case 'NATION_PICK':
        guestNation = msg.nation;
        mpLog(`👤 Guest picked <b>${NATIONS[guestNation]?.name}</b>`, 'ok');
        const gpEl = document.getElementById('mp-guest-nation');
        if (gpEl) gpEl.textContent = NATIONS[guestNation]?.name || '?';
        const gj = document.getElementById('mp-guest-joined');
        const wt = document.getElementById('mp-waiting-text');
        if (gj) gj.style.display = 'block';
        if (wt) wt.style.display = 'none';
        document.getElementById('mp-start-game-btn')?.removeAttribute('disabled');
        break;

      case 'GAME_START':
        guestNation = msg.guestNation;
        hostNation  = msg.hostNation;
        Object.assign(G, msg.state);
        G.playerNation = guestNation;
        show('game');
        setTimeout(() => {
          computeHexRadius(); buildCanvas(); zoomReset();
          updateHUD(); updateIdeoHUD(); updateSeasonUI();
          addLog('🌐 Online game started!', 'diplo');
          addLog(`You control: ${NATIONS[guestNation]?.name}`, 'event');
        }, 80);
        setTurnUI(false);
        connected = true;
        setStatus('Connected — opponent\'s turn', 'waiting');
        mpLog('🎮 Game started!', 'ok');
        break;

      case 'YOUR_TURN':
        Object.assign(G, msg.state);
        updateHUD(); updateIdeoHUD(); updateSeasonUI(); scheduleDraw();
        if (G.sel >= 0) updateSP(G.sel);
        connected = true;
        setTurnUI(true);
        mpLog('🔄 State synced — your turn', 'info');
        break;

      case 'STATE_SYNC':
        Object.assign(G, msg.state);
        updateHUD(); updateIdeoHUD(); updateSeasonUI(); scheduleDraw();
        if (G.sel >= 0) updateSP(G.sel);
        setTurnUI(true);
        mpLog('🔄 State synced', 'info');
        break;

      case 'GUEST_TURN_END':
        waitingForGuest = false;
        mpLog('📨 Guest ended turn', 'ok');
        // Host processes full turn then syncs back
        _origEndTurn();
        const snap = JSON.parse(JSON.stringify(G));
        send('STATE_SYNC', { state: snap });
        setTurnUI(true);
        break;

      case 'CHAT':
        const who = msg.from === 'host'
          ? (NATIONS[hostNation]?.name || 'Host')
          : (NATIONS[guestNation]?.name || 'Guest');
        addLog(`💬 ${who}: ${msg.text}`, 'diplo');
        mpLog(`💬 <b>${who}:</b> ${msg.text}`, 'chat');
        popup(`💬 ${who}: ${msg.text}`, 3500);
        break;
    }
  }

  let waitingForGuest = false;

  function getAvailableNations() {
    return NATIONS.map((n,i) => ({ i, name: n.name, color: n.color, ideology: n.ideology }))
      .filter(n => n.i !== hostNation);
  }

  function showGuestNationPick(nations) {
    const panel = document.getElementById('mp-guest-pick-panel');
    if (!panel) return;
    panel.style.display = 'flex';
    const list = document.getElementById('mp-guest-nation-list');
    if (!list) return;
    list.innerHTML = nations.map(n => `
      <div class="mp-nat-row" onclick="MP.pickGuestNation(${n.i})" style="display:flex;align-items:center;gap:9px;padding:7px 10px;background:rgba(0,0,0,.2);border:1px solid var(--border);cursor:pointer;margin-bottom:3px;transition:all .12s">
        <div style="width:14px;height:14px;border-radius:2px;background:${n.color};flex-shrink:0"></div>
        <span style="font-family:Cinzel,serif;font-size:10px;flex:1">${n.name}</span>
        <span style="font-size:8px;color:var(--dim)">${n.ideology}</span>
      </div>`).join('');
  }

  // ── Patch endTurn ─────────────────────────────────────────
  let _origEndTurn = null;
  function patchEndTurn() {
    if (_origEndTurn) return;
    _origEndTurn = window.endTurn;
    window.endTurn = function() {
      if (role === 'host') {
        _origEndTurn();
        waitingForGuest = true;
        setTurnUI(false);
        mpLog('⏳ Waiting for guest…', 'info');
        send('YOUR_TURN', { state: JSON.parse(JSON.stringify(G)) });
        return;
      }
      if (role === 'guest') {
        send('GUEST_TURN_END', {});
        setTurnUI(false);
        mpLog('📤 Turn sent to host…', 'info');
        return;
      }
      _origEndTurn();
    };
  }

  // ── PUBLIC API ────────────────────────────────────────────
  return {
    get role() { return role; },
    get connected() { return connected; },
    get myTurn() { return myTurn; },
    get active() { return role !== null; },
    canAct() { return !role || myTurn; },

    createRoom(nation) {
      if (!checkConfig()) return;
      hostNation = nation;
      role = 'host';
      // Generate a simple 6-digit code
      roomId = Math.floor(100000 + Math.random() * 900000).toString();
      mpLog(`✅ Room code: <b>${roomId}</b>`, 'ok');
      setStatus('Waiting for guest…', 'connecting');

      // Show room ID
      const ridEl = document.getElementById('mp-room-id');
      if (ridEl) {
        ridEl.textContent = roomId;
        const disp = document.getElementById('mp-room-display');
        if (disp) disp.style.display = 'flex';
      }
      const wt = document.getElementById('mp-waiting-text');
      if (wt) wt.style.display = 'flex';

      // Write room to Firebase so guest can find it
      fbSet(`rooms/${roomId}/info`, { host: nation, created: Date.now() });

      // Start polling for guest messages
      _seenKeys.clear();
      startPolling();
      patchEndTurn();
    },

    joinRoom(id, nation) {
      if (!checkConfig()) return;
      if (!id || !id.trim()) { mpLog('Enter a room code!', 'warn'); return; }
      guestNation = nation;
      role = 'guest';
      roomId = id.trim();
      mpLog(`⏳ Joining room ${roomId}…`, 'info');
      setStatus('Connecting…', 'connecting');

      // Verify room exists then send HELLO response trigger
      fbGet(`rooms/${roomId}/info`).then(info => {
        if (!info) {
          mpLog('❌ Room not found — check the code', 'err');
          setStatus('Room not found', 'err');
          role = null; roomId = null;
          return;
        }
        mpLog('✅ Room found! Waiting for host to send nations…', 'ok');
        setStatus('Waiting for host…', 'waiting');
        _seenKeys.clear();
        startPolling();
        patchEndTurn();
        // Notify host a guest arrived
        send('GUEST_ARRIVED', { ts: Date.now() });
      });
    },

    // Host checks for guest arrival (called from mpCreateRoom polling)
    checkGuestArrived() {
      // handled by polling + GUEST_ARRIVED message
    },

    pickGuestNation(i) {
      guestNation = i;
      document.querySelectorAll('.mp-nat-row').forEach(r => r.style.borderColor = 'var(--border)');
      send('NATION_PICK', { nation: i });
      mpLog(`✓ You picked <b>${NATIONS[i]?.name}</b>`, 'ok');
      document.getElementById('mp-join-ready-btn')?.removeAttribute('disabled');
    },

    startMultiplayerGame() {
      if (guestNation < 0) { popup('Guest hasn\'t picked a nation yet!'); return; }
      SC = hostNation; SI = NATIONS[hostNation].ideology;
      startGame();
      G.playerNation = hostNation;
      setTimeout(() => {
        send('GAME_START', {
          hostNation, guestNation,
          state: JSON.parse(JSON.stringify(G))
        });
        connected = true;
        setTurnUI(true);
        mpLog('🎮 Game started! You go first.', 'ok');
      }, 200);
    },

    guestReady() {
      mpLog('✅ Ready! Waiting for host…', 'ok');
      setStatus('Waiting for host…', 'waiting');
      const pp = document.getElementById('mp-guest-pick-panel');
      if (pp) pp.style.display = 'none';
      const gw = document.getElementById('mp-guest-waiting');
      if (gw) gw.style.display = 'flex';
    },

    sendChat(text) {
      if (!text?.trim()) return;
      addLog(`💬 You: ${text}`, 'diplo');
      send('CHAT', { from: role, text: text.trim() });
    },

    disconnect() {
      stopPolling();
      if (roomId) fbDelete(`rooms/${roomId}`);
      role = null; roomId = null; connected = false; myTurn = false;
      setStatus('Disconnected', 'idle');
      mpLog('Disconnected', 'warn');
      // Restore endTurn
      if (_origEndTurn) { window.endTurn = _origEndTurn; _origEndTurn = null; }
    }
  };
})();

// Handle GUEST_ARRIVED on host side via polling
(function() {
  const _origPoll = setInterval; // just ensure GUEST_ARRIVED triggers HELLO
  // We handle this in handleMessage above when guest sends GUEST_ARRIVED
  // But host needs to send HELLO in response — patch handleMessage
  const origHandle = MP._handleMessage; // already wired internally
})();
