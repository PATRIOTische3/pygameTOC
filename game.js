const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const MONTH_DAYS=[31,28,31,30,31,30,31,31,30,31,30,31]; // non-leap
const WEEK_NAMES=['I','II','III','IV'];

function isLeapYear(y){ return (y%4===0&&y%100!==0)||(y%400===0); }
function daysInMonth(m,y){ return m===1&&isLeapYear(y)?29:MONTH_DAYS[m]; }
function weeksInMonth(m,y){
  // We use 4 weeks for 28-day months, 4 for 29/30, still 4 but last week longer
  // Simple: always 4 ticks per month, last tick of Feb in leap year just "includes" day 29
  return 4;
}

let G={
  month:0, week:0,  // week = 0..3 within month
  year:1936,playerNation:0,leaderName:'The Leader',ideology:'fascism',
  owner:[],pop:[],army:[],income:[],gold:[],buildings:[],instab:[],assim:[],disease:[],
  satisfaction:[],
  construction:[],
  reforming:false,reformTarget:'',reformTurnsLeft:0,reformTotalTurns:0,
  resPool:{oil:0,coal:0,grain:0,steel:0},
  resBase:[],
  taxRate:25, // 0-100%, default 25%
  taxMood:[],  // per-province "tax mood" — cumulative reaction to tax changes
  loans:[],
  totalDebt:0,
  pact:[],war:[],pLeft:[],capitalPenalty:[],
  alliance:[],
  puppet:[],
  resistance:[],
  resistSponsor:[],
  fleet:[],
  sel:-1,moveFrom:-1,moveMode:false,navalMode:false,navalFrom:-1,mapMode:'political',
  allianceOf:[],
  tick:0, // total weeks elapsed since game start
};

// Week number → approximate day of month (for display)
function weekToDay(week, month, year){
  const days=daysInMonth(month, year);
  // Divide month into 4 roughly equal parts
  return Math.min(days, 1 + Math.floor(week * days / 4));
}

function dateStr(){
  const day=weekToDay(G.week, G.month, G.year);
  return `${day} ${MONTHS[G.month]} ${G.year}`;
}

// Advance time by one week; returns true if a new month started
function advanceWeek(){
  G.tick = (G.tick||0) + 1;
  G.week++;
  if(G.week>=4){
    G.week=0;
    G.month++;
    if(G.month>=12){G.month=0;G.year++;}
    return true; // new month
  }
  return false;
}
// ── HEX RADIUS (computed from actual grid spacing) ───────
let HEX_R = 4.75;
function computeHexRadius(){
  if(PROVINCES.length < 10){HEX_R=4.75;return;}

  // Sample province centroids to find the most common neighbour distance.
  // The old map uses cx/cy with ~7-8px hex spacing; the new editor export
  // uses the actual hex grid spacing.  We keep the range wide (2..30) and
  // use the MEDIAN of the lowest-distance cluster to avoid being thrown off
  // by diagonal or skip-one distances.
  const dists=[];
  const sample=Math.min(PROVINCES.length,400);
  for(let i=0;i<sample;i++){
    for(let j=i+1;j<sample;j++){
      const dx=PROVINCES[i].cx-PROVINCES[j].cx, dy=PROVINCES[i].cy-PROVINCES[j].cy;
      const d=Math.sqrt(dx*dx+dy*dy);
      if(d>1.5&&d<30) dists.push(d);
    }
  }
  if(dists.length<5){HEX_R=4.75;return;}
  dists.sort((a,b)=>a-b);

  // Find the first clear peak: bin into 0.25px buckets, take the mode
  const step=0.25;
  const bins={};
  dists.forEach(d=>{const b=Math.round(d/step)*step;bins[b]=(bins[b]||0)+1;});
  const sorted=Object.entries(bins).sort((a,b)=>b[1]-a[1]);
  const neighborDist=parseFloat(sorted[0][0]);

  // For a pointy-top hex grid: spacing between centres = sqrt(3)*R
  // So R = spacing / sqrt(3).  Multiply by 0.99 to leave a 1% overlap that
  // closes antialiasing seams without visibly enlarging hexes.
  HEX_R = (neighborDist / Math.sqrt(3)) * 0.99;

  // ── Rebuild NB for ALL provinces using coordinate proximity ──
  const N=PROVINCES.length;
  while(NB.length<N) NB.push([]);
  // Use 1.35× spacing as neighbour threshold (covers slight grid irregularity)
  const thresh=neighborDist*1.35;
  const thresh2=thresh*thresh;
  for(let i=0;i<N;i++) NB[i]=[];
  for(let i=0;i<N;i++){
    for(let j=i+1;j<N;j++){
      const dx=PROVINCES[i].cx-PROVINCES[j].cx;
      const dy=PROVINCES[i].cy-PROVINCES[j].cy;
      if(dx*dx+dy*dy<=thresh2){
        NB[i].push(j);
        NB[j].push(i);
      }
    }
  }
}
// All hexes same size — no capital scaling (causes gap artifacts)
const scaledR=(i)=>HEX_R;


const ri=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
const rf=(a,b)=>Math.random()*(b-a)+a;
const fm=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(0)+'k':''+Math.round(n);
const fa=n=>Math.round(n).toLocaleString('en');
const ideol=()=>IDEOLOGIES[G.ideology];
const regsOf=n=>PROVINCES.map((_,i)=>i).filter(i=>G.owner[i]===n);
const ownerName=n=>n<0?'Rebels':NATIONS[n]?.short||`#${n}`;
const natColor=n=>NATIONS[n]?.color||'#181620';
const season=()=>getSeason(G.month);

function aliveNations(){const s=new Set();PROVINCES.forEach((_,i)=>{const o=G.owner[i];if(o>=0&&o!==G.playerNation)s.add(o);});return[...s];}
function areAllies(a,b){return G.allianceOf[a]>=0&&G.allianceOf[a]===G.allianceOf[b];}
function atWar(a,b){return!!(G.war[a]&&G.war[a][b]);}

function initDiplo(){
  const N=NATIONS.length;
  G.pact=Array.from({length:N},()=>new Array(N).fill(false));
  G.war=Array.from({length:N},()=>new Array(N).fill(false));
  G.pLeft=Array.from({length:N},()=>new Array(N).fill(0));
  G.capitalPenalty=new Array(N).fill(0);
  G.gold=new Array(N).fill(0);
  G.allianceOf=new Array(N).fill(-1);
  G.alliance=[];
  G.puppet=[];
  // Set historical alliances
  INIT_ALLIANCES.forEach((al,ai)=>{
    G.alliance.push({...al});
    al.members.forEach(m=>{G.allianceOf[m]=ai;});
  });
}

// ── SETUP UI ──────────────────────────────────────────────
// SC (selected country index) and SI (selected ideology) are managed by the
// setup screen script in index.html. We just declare the globals here.
let SC=-1,SI='fascism';
function chkSB(){const b=document.getElementById('startbtn');if(b)b.disabled=SC<0||!SI;}

// ── SCREEN MANAGEMENT ─────────────────────────────────────
function show(id){document.querySelectorAll('.scr').forEach(e=>e.classList.remove('on'));document.getElementById('s-'+id).classList.add('on');}
function switchTab(id){document.querySelectorAll('.tab,.tpane').forEach(e=>e.classList.remove('on'));document.getElementById('tab-'+id).classList.add('on');document.getElementById('pane-'+id).classList.add('on');hideProvPopup();}
function setMapMode(mode){G.mapMode=mode;document.querySelectorAll('.mmbtn').forEach(b=>b.classList.remove('on'));document.getElementById('mm-'+mode).classList.add('on');scheduleDraw();}

// ── GAME START ────────────────────────────────────────────
function startGame(){
  if(SC<0)return;
  G.leaderName=document.getElementById('rname').value.trim()||'The Leader';
  G.ideology=SI||'fascism';G.playerNation=SC;
  G.month=0;G.week=0;G.year=1936;
  initDiplo();
  G.owner=PROVINCES.map(p=>p.nation??-1);
  G.pop=PROVINCES.map(p=>p.isCapital?ri(30000,50000):ri(10000,40000));
  G.army=PROVINCES.map(()=>0);
  G.income=PROVINCES.map(p=>p.isCapital?ri(120,280):ri(40,130));
  G.instab=PROVINCES.map(()=>0);
  G.assim=PROVINCES.map(()=>100);
  G.disease=PROVINCES.map(()=>0);
  G.buildings=PROVINCES.map(()=>[]);
  G.satisfaction=PROVINCES.map(()=>ri(65,80)); // start at 65-80%
  G.construction=PROVINCES.map(()=>null);       // no active construction
  G.reforming=false;G.reformTarget='';G.reformTurnsLeft=0;G.reformTotalTurns=0;
  // Disease system
  G.disease=PROVINCES.map(()=>0);               // legacy severity 0-100 (kept for compat)
  G.epidemics=[];                                // active epidemic objects
  G.provDisease=PROVINCES.map(()=>null);         // per-province: epidemic id or null
  G.resistance=PROVINCES.map(()=>0);
  G.resistSponsor=PROVINCES.map(()=>-1);
  G._allyEpicNotified=new Set();
  G.taxRate=25;
  G.taxMood=PROVINCES.map(()=>0);
  G.battleQueue=[];
  G._enemyAttackQueue=[];
  G.moveQueue=[]; // queued troop movements: [{from,to,amount}]
  G.draftQueue=[]; // queued conscriptions: [{prov,amount,weeksLeft,nation}] // 0 = neutral, negative = angry about taxes
  G.assimQueue=PROVINCES.map(()=>null); // per-province assimilation: {type,weeksLeft,popFloor} or null
  G.resBase=PROVINCES.map(p=>({...((p.res)||{})}));
  G.resPool={oil:0,coal:0,grain:0,steel:0};
  G.loans=[];G.totalDebt=0;
  G.fleet=[];
  G.moveFrom=-1;G.moveMode=false;G.navalMode=false;G.navalFrom=-1;G.sel=-1;
  G.gold[SC]=1200;
  NATIONS.forEach((_,i)=>{if(i!==SC)G.gold[i]=ri(300,700);});
  // Player gets army in capital only
  const capIdx=PROVINCES.findIndex(p=>p.nation===SC&&p.isCapital);
  if(capIdx>=0)G.army[capIdx]=ri(6000,10000);
  // AI nations: army in capital + small garrisons on borders only
  NATIONS.forEach((_,ni)=>{
    if(ni===SC)return;
    const ci=PROVINCES.findIndex(p=>p.nation===ni&&p.isCapital);
    if(ci>=0)G.army[ci]=ri(2000,5000);
    // 2-3 border provinces get small garrison
    const natProvs=PROVINCES.map((_,idx)=>idx).filter(idx=>PROVINCES[idx].nation===ni&&!PROVINCES[idx].isCapital);
    const borderProvs=natProvs.filter(idx=>(NB[idx]||[]).some(nb=>PROVINCES[nb].nation!==ni&&PROVINCES[nb].nation>=0));
    borderProvs.slice(0,ri(1,3)).forEach(idx=>{G.army[idx]=ri(200,800);});
  });
  show('game');
  setTimeout(()=>{
    computeHexRadius();
    buildCanvas();
    zoomReset();
    updateHUD();updateIdeoHUD();updateSeasonUI();
    addLog(`${dateStr()}: ${G.leaderName} rises to power.`,'event');
    // Log starting alliances
    G.alliance.forEach(al=>{addLog(`🤝 ${al.name} alliance active: ${al.members.map(m=>NATIONS[m]?.short).join(', ')}`, 'diplo');});
  },80);
}


// ══════════════════════════════════════════════════════════
//  CANVAS RENDERER — replaces SVG for performance
// ══════════════════════════════════════════════════════════
const canvas=document.getElementById('map-canvas');
const ctx=canvas.getContext('2d');
let CW=0,CH=0;
let vp={scale:1,tx:0,ty:0};
let _drawPending=false;

function buildCanvas(){
  const wrap=document.getElementById('map-wrap');
  CW=wrap.clientWidth||window.innerWidth;
  CH=wrap.clientHeight||Math.floor(window.innerHeight*.55);
  if(CW<10||CH<10){setTimeout(buildCanvas,60);return;}
  canvas.width=CW;canvas.height=CH;
  scheduleDraw();
}

window.addEventListener('resize',()=>{
  if(!document.getElementById('s-game')?.classList.contains('on'))return;
  const wrap=document.getElementById('map-wrap');
  if(!wrap)return;
  CW=wrap.clientWidth||window.innerWidth;
  CH=wrap.clientHeight||Math.floor(window.innerHeight*.55);
  if(CW<10||CH<10)return;
  canvas.width=CW;canvas.height=CH;
  scheduleDraw();
});

// Batch draws — requestAnimationFrame prevents overdraw
function scheduleDraw(){
  if(_drawPending)return;
  _drawPending=true;
  requestAnimationFrame(()=>{_drawPending=false;drawMap();});
}

// ── HEX MATH ─────────────────────────────────────────────
// Provinces already have cx,cy in 680×490 SVG space
// We transform through viewport: screen = (cx*vp.scale + vp.tx, cy*vp.scale + vp.ty)
function toScreen(cx,cy){return[cx*vp.scale+vp.tx, cy*vp.scale+vp.ty];}
function toWorld(sx,sy){return[(sx-vp.tx)/vp.scale,(sy-vp.ty)/vp.scale];}

function hexPath(ctx2,cx,cy,r){
  // Pointy-top hexagon: vertices at angles 30°, 90°, 150°, 210°, 270°, 330°
  // = PI/6 + i*PI/3
  ctx2.beginPath();
  for(let i=0;i<6;i++){
    const a=Math.PI/6+Math.PI/3*i;
    const x=cx+Math.cos(a)*r, y=cy+Math.sin(a)*r;
    i===0?ctx2.moveTo(x,y):ctx2.lineTo(x,y);
  }
  ctx2.closePath();
}

// ── FOG OF WAR ────────────────────────────────────────────
// Returns true if player can see army count in province i
function canSeeArmy(i){
  const o=G.owner[i];
  if(o===G.playerNation)return true;                          // own province
  if(areAllies(G.playerNation,o))return true;                 // ally
  if(G.puppet.includes(o))return true;                        // puppet
  // Watchtower in any adjacent OWN province reveals this hex
  const ownNbs=NB[i]?.filter(nb=>G.owner[nb]===G.playerNation)||[];
  if(ownNbs.some(nb=>(G.buildings[nb]||[]).includes('fortress')))return true;
  // Watchtower IN this province (if we captured it temporarily) — always visible if ours
  if((G.buildings[i]||[]).includes('fortress')&&o===G.playerNation)return true;
  return false;
}
// Terrain fill colours — kept in sync with TERRAIN{} in map.js
const TC={
  plains:  '#3a4828', forest:  '#2a3a1c', mountain:'#4a3e30',
  hills:   '#5a5a38', highland:'#5a4e3c', swamp:   '#405838',
  marsh:   '#384838', desert:  '#4a3e28', steppe:  '#5a4e28',
  savanna: '#6a5a28', scrub:   '#5a5a28', jungle:  '#1e4c2c',
  taiga:   '#2a4a38', tundra:  '#354040', ice:     '#6a7878',
  farmland:'#506038', urban:   '#2a2420', volcanic:'#4a2820',
};

// ── TERRAIN HELPERS ───────────────────────────────────────
// Returns weighted-average defB for a province, optionally biased
// toward the hexes that face the attacking province (fromIdx).
// Falls back gracefully to TERRAIN[p.terrain] if no HEX_GRID present.
function provDefB(toIdx, fromIdx){
  const p = PROVINCES[toIdx];
  const baseTerrain = TERRAIN[p.terrain||'plains'] || TERRAIN.plains;

  // No terrainMap → simple lookup (old behaviour)
  if(!p.terrainMap || !Object.keys(p.terrainMap).length)
    return baseTerrain.defB;

  // Build a frequency map of terrain types in this province
  const entries = Object.entries(p.terrainMap); // [[hexIdx, terrainType], ...]

  // If we know the attacker's province, find border hexes.
  // A border hex of province `toIdx` is one that is adjacent to ANY hex
  // belonging to province `fromIdx`. We detect this via HEX_GRID if available.
  let hexWeights = null;
  if(fromIdx >= 0 && typeof HEX_GRID !== 'undefined' && HEX_GRID.hexes){
    const fromHexSet = new Set();
    HEX_GRID.hexes.forEach((h,hi)=>{ if(h.p===fromIdx) fromHexSet.add(hi); });

    // Build neighbour lookup once (cached on HEX_GRID to avoid rebuilding)
    if(!HEX_GRID._nbCache){
      const cols = HEX_GRID.cols;
      HEX_GRID._nbCache = HEX_GRID.hexes.map((h,hi)=>{
        const even = h.r%2===0;
        const dirs = even
          ? [[-1,-1],[-1,0],[0,-1],[0,1],[1,-1],[1,0]]
          : [[-1,0],[-1,1],[0,-1],[0,1],[1,0],[1,1]];
        return dirs.map(([dr,dc])=>{
          const nr=h.r+dr, nc=h.c+dc;
          if(nr<0||nr>=HEX_GRID.rows||nc<0||nc>=cols) return -1;
          return nr*cols+nc;
        }).filter(ni=>ni>=0);
      });
    }

    // Which hexes of toIdx border fromIdx?
    const borderHexes = new Set();
    entries.forEach(([hiStr])=>{
      const hi = +hiStr;
      if(HEX_GRID._nbCache[hi]?.some(ni=>fromHexSet.has(ni)))
        borderHexes.add(hiStr);
    });

    if(borderHexes.size > 0){
      // Weight border hexes ×3, interior hexes ×1
      hexWeights = entries.map(([hiStr, t])=>
        [t, borderHexes.has(hiStr) ? 3 : 1]
      );
    }
  }

  // Weighted average of defB across all hex terrains
  if(!hexWeights) hexWeights = entries.map(([,t])=>[t,1]);
  let totalW = 0, totalDefB = 0;
  hexWeights.forEach(([t, w])=>{
    const td = TERRAIN[t]||baseTerrain;
    totalDefB += td.defB * w;
    totalW += w;
  });
  return totalW > 0 ? totalDefB/totalW : baseTerrain.defB;
}

// Weighted-average income modifier for a province (used in economy tick)
function provIncM(idx){
  const p = PROVINCES[idx];
  if(!p.terrainMap || !Object.keys(p.terrainMap).length)
    return (TERRAIN[p.terrain||'plains']||TERRAIN.plains).incM;
  const entries = Object.entries(p.terrainMap);
  const sum = entries.reduce((s,[,t])=>s+(TERRAIN[t]||TERRAIN.plains).incM, 0);
  return sum / entries.length;
}
const RES_COLORS={oil:'#8a6020',coal:'#303030',grain:'#5a7020',steel:'#405070'};

const REBEL_COLOR='#c86820'; // orange-amber for rebels

function provColor(i){
  const o=G.owner[i],m=G.mapMode;

  if(m==='disease'){
    const epId=G.provDisease?.[i];
    if(epId){
      const ep=G.epidemics?.find(e=>e.id===epId&&e.active);
      if(ep) return ep.color;
      return '#3a2020';
    }
    return '#1e2020';
  }

  if(m==='instab'){
    if(PROVINCES[i]?.isSea) return '#0a1828';
    if(o<0) return '#c86820'; // rebels = orange
    if(o!==G.playerNation) return '#181a1a'; // grey out others
    const ins=G.instab[i]||0;
    if(ins>70) return '#8a0808';
    if(ins>50) return '#7a2808';
    if(ins>30) return '#5a4008';
    if(ins>10) return '#3a4820';
    return '#1a4010'; // stable = dark green
  }

  if(m==='buildings'){
    if(PROVINCES[i]?.isSea) return '#0a1828';
    if(o<0) return '#1a1a1a';
    const hasBld=(G.buildings[i]||[]).length>0;
    const hasConst=!!G.construction[i];
    if(o===G.playerNation){
      if(hasBld) return '#2a4020'; // own with buildings = dark green
      if(hasConst) return '#302010'; // under construction = dark amber
      return '#161c10'; // own without = very dark
    }
    return hasBld?'#1e1e28':'#0e0e12'; // others
  }

  if(m==='terrain') return TC[PROVINCES[i].terrain]||'#2a2a2a';

  if(m==='resources'){
    const r=G.resBase[i]||{};
    if(r.oil>0)return'#6a4010';
    if(r.coal>0)return'#282828';
    if(r.grain>0)return'#3a5018';
    if(r.steel>0)return'#283848';
    return'#181618';
  }

  // Political — clean colors, no instability overlay
  if(o<0){
    if(PROVINCES[i]?.isSea) return '#0a1828';
    return REBEL_COLOR; // rebels = orange
  }
  if(o===G.playerNation) return '#288820'; // always solid green for player
  if(atWar(G.playerNation,o))return'#801818';
  if(G.pact[G.playerNation][o])return'#706010';
  if(areAllies(G.playerNation,o))return'#183868';
  return natColor(o);
}

// ── SEA LABELS ────────────────────────────────────────────
// Legacy fallback — used when map.js does NOT export SEA_ZONES
const SEA_LABELS=[
  {t:'ATLANTIC',x:40,y:300},{t:'NORTH SEA',x:182,y:224},
  {t:'NORW. SEA',x:185,y:160},{t:'BALTIC',x:303,y:226},
  {t:'MED.',x:155,y:462},{t:'MED.',x:253,y:460},{t:'MED. E',x:372,y:458},
  {t:'ADRIATIC',x:304,y:394},{t:'AEGEAN',x:394,y:430},
  {t:'BLACK SEA',x:440,y:376},{t:'CASPIAN',x:568,y:364},
  {t:'ARCTIC',x:360,y:72},{t:'BARENTS',x:508,y:96},
];
// Use SEA_ZONES from editor export when available, fall back to hardcoded list
function _seaLabels(){
  if(typeof SEA_ZONES!=='undefined'&&SEA_ZONES.length)
    return SEA_ZONES.map(z=>({t:z.name.toUpperCase(),x:z.cx,y:z.cy,fs:z.fontSize}));
  return SEA_LABELS;
}

// ── MAIN DRAW ─────────────────────────────────────────────
function drawMap(){
  if(!ctx||!CW)return;
  ctx.clearRect(0,0,CW,CH);

  // Ocean background
  const grad=ctx.createLinearGradient(0,0,0,CH);
  grad.addColorStop(0,'#08162a');grad.addColorStop(1,'#0c1e38');
  ctx.fillStyle=grad;ctx.fillRect(0,0,CW,CH);

  // Grid overlay (subtle)
  ctx.strokeStyle='rgba(50,110,190,.045)';ctx.lineWidth=.5;
  const gs=40*vp.scale;
  const ox=((vp.tx%gs)+gs)%gs,oy=((vp.ty%gs)+gs)%gs;
  for(let x=ox;x<CW;x+=gs){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,CH);ctx.stroke();}
  for(let y=oy;y<CH;y+=gs){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(CW,y);ctx.stroke();}

  // Clip to visible bounds for performance
  const [wx0,wy0]=toWorld(0,0),[wx1,wy1]=toWorld(CW,CH);

  ctx.save();
  ctx.translate(vp.tx,vp.ty);ctx.scale(vp.scale,vp.scale);

  // Sea labels — from editor SEA_ZONES or legacy hardcoded list
  _seaLabels().forEach(sl=>{
    if(sl.x<wx0-20||sl.x>wx1+20||sl.y<wy0-10||sl.y>wy1+10)return;
    ctx.font=`italic ${sl.fs||7}px Cinzel,serif`;
    ctx.fillStyle='rgba(65,135,200,.26)';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText(sl.t,sl.x,sl.y);
  });

  
  // ── DRAW HEXES ────────────────────────────────────────────
  // Two modes:
  //   A) HEX_GRID present (editor export) → draw every raw hex with its own
  //      terrain colour, then overlay province political colour with transparency.
  //   B) No HEX_GRID (old map.js) → draw province centroid hex as before.
  //
  // Both modes: second pass draws borders between different owners.

  const HAS_HEXGRID = typeof HEX_GRID !== 'undefined' && HEX_GRID.hexes && HEX_GRID.hexes.length;

  if(HAS_HEXGRID){
    // ── Mode A: per-hex render ─────────────────────────────
    const hR   = HEX_GRID.hexR || HEX_R;
    const cols = HEX_GRID.cols;
    const rows = HEX_GRID.rows;
    function hcx(c,r){ return hR*Math.sqrt(3)*(c+(r%2)*0.5)+hR; }
    function hcy(r){ return hR*1.5*r+hR; }

    const m = G.mapMode;

    // Pass 1 — terrain fill + political overlay
    HEX_GRID.hexes.forEach(h=>{
      const cx=hcx(h.c,h.r), cy=hcy(h.r);
      if(cx<wx0-hR*2||cx>wx1+hR*2||cy<wy0-hR*2||cy>wy1+hR*2) return;

      const pi = h.p; // province index, -1 = unassigned/open sea

      // Sea hex — just draw ocean, skip
      if(h.sea){
        hexPath(ctx,cx,cy,hR+0.5/vp.scale);
        ctx.fillStyle='#0a1828';
        ctx.fill();
        return;
      }

      // Land hex — determine colours
      const terrainCol = TC[h.t] || TC.plains;

      if(m==='terrain'){
        // Pure terrain view — just the raw terrain colour
        hexPath(ctx,cx,cy,hR+0.5/vp.scale);
        ctx.fillStyle=terrainCol;
        ctx.fill();
        return;
      }

      // Political / other modes:
      // Draw terrain base, then overlay province political colour semi-transparent
      hexPath(ctx,cx,cy,hR+0.5/vp.scale);
      ctx.fillStyle=terrainCol;
      ctx.fill();

      if(pi>=0){
        const polCol = provColor(pi);   // returns hex string
        // Convert to rgba with ~55% opacity so terrain bleeds through
        hexPath(ctx,cx,cy,hR+0.5/vp.scale);
        ctx.fillStyle=polCol+'8c'; // 8c ≈ 55% opacity in hex
        ctx.fill();
      }
    });

    // Pass 2 — province borders (drawn on province centroids as before,
    // but now only as thin outlines so seams between hexes are visible)
    PROVINCES.forEach((p,i)=>{
      if(p.cx<wx0-30||p.cx>wx1+30||p.cy<wy0-30||p.cy>wy1+30) return;
      const r=scaledR(i);
      const o=G.owner[i];
      if(i===G.sel){
        hexPath(ctx,p.cx,p.cy,r);ctx.strokeStyle='rgba(255,255,255,.95)';ctx.lineWidth=2/vp.scale;ctx.stroke();
      } else if(G.moveMode&&G.moveFrom>=0&&isMoveTgt(i)){
        hexPath(ctx,p.cx,p.cy,r);ctx.strokeStyle='rgba(80,255,80,.9)';ctx.lineWidth=1.6/vp.scale;ctx.stroke();
      } else if(_atkSelectMode&&isAtkSrc(i)){
        hexPath(ctx,p.cx,p.cy,r);ctx.strokeStyle='rgba(255,80,80,.9)';ctx.lineWidth=1.8/vp.scale;ctx.stroke();
      } else if(G.navalMode&&G.navalFrom>=0&&navalDests(G.navalFrom).includes(i)){
        hexPath(ctx,p.cx,p.cy,r);ctx.strokeStyle='rgba(80,200,255,.9)';ctx.lineWidth=1.6/vp.scale;ctx.stroke();
      }
    });

  } else {
    // ── Mode B: legacy centroid-only render ───────────────
    // Fill pass
    PROVINCES.forEach((p,i)=>{
      if(p.cx<wx0-30||p.cx>wx1+30||p.cy<wy0-30||p.cy>wy1+30)return;
      const r=scaledR(i);
      hexPath(ctx,p.cx,p.cy,r+0.6/vp.scale);
      ctx.fillStyle=provColor(i);
      ctx.fill();
    });

    // Border pass
    PROVINCES.forEach((p,i)=>{
      if(p.cx<wx0-30||p.cx>wx1+30||p.cy<wy0-30||p.cy>wy1+30)return;
      const r=scaledR(i);
      const o=G.owner[i];
      if(i===G.sel){
        hexPath(ctx,p.cx,p.cy,r);ctx.strokeStyle='rgba(255,255,255,.95)';ctx.lineWidth=2/vp.scale;ctx.stroke();
      } else if(G.moveMode&&G.moveFrom>=0&&isMoveTgt(i)){
        hexPath(ctx,p.cx,p.cy,r);ctx.strokeStyle='rgba(80,255,80,.9)';ctx.lineWidth=1.6/vp.scale;ctx.stroke();
      } else if(_atkSelectMode&&isAtkSrc(i)){
        hexPath(ctx,p.cx,p.cy,r);ctx.strokeStyle='rgba(255,80,80,.9)';ctx.lineWidth=1.8/vp.scale;ctx.stroke();
      } else if(G.navalMode&&G.navalFrom>=0&&navalDests(G.navalFrom).includes(i)){
        hexPath(ctx,p.cx,p.cy,r);ctx.strokeStyle='rgba(80,200,255,.9)';ctx.lineWidth=1.6/vp.scale;ctx.stroke();
      } else {
        const hasBorder=(NB[i]||[]).some(nb=>G.owner[nb]!==o);
        if(hasBorder){
          hexPath(ctx,p.cx,p.cy,r);
          if(o<0&&!PROVINCES[i]?.isSea&&G.mapMode==='political'){
            ctx.save();ctx.setLineDash([2.5/vp.scale,2/vp.scale]);
            ctx.strokeStyle='rgba(200,100,30,.7)';ctx.lineWidth=1.2/vp.scale;
            ctx.stroke();ctx.setLineDash([]);ctx.restore();
          } else if(o===G.playerNation&&G.mapMode==='political'){
            const hasRebelNeighbor=(NB[i]||[]).some(nb=>G.owner[nb]<0&&!PROVINCES[nb]?.isSea);
            if(hasRebelNeighbor){
              ctx.save();ctx.setLineDash([3/vp.scale,2/vp.scale]);
              ctx.strokeStyle='rgba(60,200,60,.85)';ctx.lineWidth=1.6/vp.scale;
              ctx.stroke();ctx.setLineDash([]);ctx.restore();
            } else {
              ctx.strokeStyle='rgba(6,8,14,.65)';ctx.lineWidth=.5/vp.scale;ctx.stroke();
            }
          } else {
            ctx.strokeStyle='rgba(6,8,14,.65)';ctx.lineWidth=.5/vp.scale;ctx.stroke();
          }
        }
      }
    });
  }

  // Labels — only when zoomed enough
  if(vp.scale>0.55){
    PROVINCES.forEach((p,i)=>{
      if(p.cx<wx0-25||p.cx>wx1+25||p.cy<wy0-25||p.cy>wy1+25)return;
      const r=scaledR(i);
      const fs=Math.max(3,Math.min(7,r*.42));

      // Province name — only for capitals on the map
      if(p.isCapital){
        ctx.font=`700 ${fs+1}px Cinzel,serif`;
        ctx.fillStyle='#f0d080';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.shadowColor='rgba(0,0,0,.95)';ctx.shadowBlur=4;
        ctx.fillText(p.short.length>10?p.short.slice(0,10):p.short,p.cx,p.cy-(G.army[i]>0&&vp.scale>1.2?2:0));
        ctx.shadowBlur=0;
      }

      // Rebel label — only in political mode
      if(G.owner[i]<0 && !PROVINCES[i]?.isSea && vp.scale>0.8 && G.mapMode==='political'){
        ctx.font=`bold ${Math.max(4,fs)}px Cinzel,serif`;
        ctx.fillStyle='rgba(220,130,50,.95)';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.shadowColor='rgba(0,0,0,.95)';ctx.shadowBlur=3;
        ctx.fillText('REBELS',p.cx,p.cy);
        ctx.shadowBlur=0;
      }

      // Instab mode — show satisfaction% on player provinces only
      if(G.mapMode==='instab' && G.owner[i]===G.playerNation && vp.scale>0.9){
        const sat=Math.round(G.satisfaction[i]||70);
        const ins=G.instab[i]||0;
        ctx.font=`bold ${Math.max(4,fs)}px Cinzel,serif`;
        ctx.fillStyle=ins>70?'#ff8060':ins>40?'#ffcc60':ins>15?'#c0e860':'#80ff80';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.shadowColor='rgba(0,0,0,.95)';ctx.shadowBlur=3;
        ctx.fillText(sat+'%',p.cx,p.cy);
        ctx.shadowBlur=0;
      }

      // Draft queue indicator — #72F372, below army number if army present
      const _draftEntry=(G.draftQueue||[]).find(d=>d.prov===i&&d.nation===G.playerNation);
      if(_draftEntry && G.mapMode==='political' && vp.scale>1.0){
        const _armyYBase = p.isCapital ? fs*.85 : 0;
        const _hasArmy = G.army[i]>0 && canSeeArmy(i);
        // If army exists, shift draft number down by one line; otherwise use same position
        const _draftY = p.cy + _armyYBase + (_hasArmy ? fs*1.4 : 0);
        ctx.font=`${Math.max(3.5,fs-1.5)}px Cinzel,serif`;
        ctx.fillStyle='#72F372';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.shadowColor='rgba(0,0,0,.95)';ctx.shadowBlur=2;
        ctx.fillText(fm(_draftEntry.amount),p.cx,_draftY);
        ctx.shadowBlur=0;
      }

      // Army count — only political/terrain/resources modes, when zoomed in
      if(G.army[i]>0 && vp.scale>1.0 && canSeeArmy(i) && G.mapMode!=='instab' && G.mapMode!=='disease' && G.mapMode!=='buildings'){
        ctx.font=`${Math.max(3.5,fs-1.5)}px Cinzel,serif`;
        ctx.fillStyle='rgba(232,205,145,.85)';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=2;
        ctx.fillText(fm(G.army[i]),p.cx,p.cy+(p.isCapital?fs*.85:0));
        ctx.shadowBlur=0;
      }

      // Capital star
      if(p.isCapital){
        ctx.font=`${fs+3}px serif`;
        ctx.fillStyle='#f0d080';ctx.shadowColor='rgba(0,0,0,.8)';ctx.shadowBlur=2;
        ctx.fillText('★',p.cx+r*.62,p.cy-r*.55);ctx.shadowBlur=0;
      }

      // Building icons — ONLY in buildings map mode
      if(G.mapMode==='buildings' && G.buildings[i]&&G.buildings[i].length){
        const bldList=G.buildings[i];
        const bldR=r*0.82;
        const total=bldList.length;
        bldList.forEach((k,bi)=>{
          const bDef=BUILDINGS[k];
          if(!bDef)return;
          // Place icons in a row at bottom of hex
          const startX=p.cx-(total-1)*fs*0.65;
          const bx=startX+bi*fs*1.3;
          const by=p.cy+bldR*0.55;
          // Background circle for readability
          ctx.fillStyle='rgba(0,0,0,0.7)';
          ctx.beginPath();ctx.arc(bx,by,fs*0.72,0,Math.PI*2);ctx.fill();
          ctx.strokeStyle='rgba(201,168,76,0.5)';ctx.lineWidth=0.8/vp.scale;
          ctx.stroke();
          // Draw icon as text — use larger size for better rendering
          ctx.font=`${Math.max(fs*1.1,5)}px serif`;
          ctx.textAlign='center';ctx.textBaseline='middle';
          ctx.fillText(bDef.icon||'?',bx,by);
        });
      }
      // Construction indicator — also only in buildings mode
      if(G.mapMode==='buildings' && G.construction[i]){
        const c=G.construction[i];
        const prog=Math.round((c.totalTurns-c.turnsLeft)/c.totalTurns*100);
        ctx.font=`${Math.max(4,fs-1)}px Cinzel,serif`;
        ctx.fillStyle='rgba(201,168,76,0.9)';
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.shadowColor='rgba(0,0,0,.95)';ctx.shadowBlur=2;
        ctx.fillText('🏗'+prog+'%',p.cx,p.cy);
        ctx.shadowBlur=0;
      }

      // Resistance indicator — only in political mode
      if(G.mapMode==='political' && G.resistance[i]>30){
        ctx.font=`${fs+1}px serif`;
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillText('🔥',p.cx+r*.55,p.cy+r*.55);
      }

      // Resource dots in resource mode
      if(G.mapMode==='resources'){
        const res=G.resBase[i]||{};
        const rkeys=Object.keys(res).filter(k=>res[k]>0);
        rkeys.forEach((k,ki)=>{
          ctx.fillStyle=RES_COLORS[k]||'#888';
          ctx.beginPath();ctx.arc(p.cx-4+ki*5,p.cy+r*.6,2,0,Math.PI*2);ctx.fill();
        });
      }
    });
  }

  // Fleet icons
  G.fleet&&G.fleet.filter(f=>f.nation===G.playerNation).forEach(f=>{
    const p=PROVINCES[f.at];if(!p)return;
    if(p.cx<wx0-20||p.cx>wx1+20)return;
    ctx.font=`${12/vp.scale*Math.min(vp.scale,1.2)}px serif`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.fillText('🚢',p.cx,p.cy-scaledR(f.at)-4/vp.scale);
  });

  ctx.restore();

  // ── Draw queued order arrows (screen space) ──────────────
  function drawOrderArrow(fsx, fsy, tsx, tsy, color, dashColor, label){
    ctx.save();
    ctx.strokeStyle=color;
    ctx.lineWidth=2.5;
    ctx.setLineDash([8,4]);
    ctx.beginPath();ctx.moveTo(fsx,fsy);ctx.lineTo(tsx,tsy);ctx.stroke();
    ctx.setLineDash([]);
    // Arrowhead
    const angle=Math.atan2(tsy-fsy,tsx-fsx);
    const al=13;
    ctx.fillStyle=color;
    ctx.beginPath();
    ctx.moveTo(tsx,tsy);
    ctx.lineTo(tsx-al*Math.cos(angle-0.4),tsy-al*Math.sin(angle-0.4));
    ctx.lineTo(tsx-al*Math.cos(angle+0.4),tsy-al*Math.sin(angle+0.4));
    ctx.closePath();ctx.fill();
    // Troop count label above midpoint
    if(label){
      const mx=(fsx+tsx)/2, my=(fsy+tsy)/2-10;
      ctx.font='bold 11px Cinzel,serif';
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.fillStyle='rgba(6,8,14,.75)';
      const tw=ctx.measureText(label).width;
      ctx.fillRect(mx-tw/2-3,my-7,tw+6,14);
      ctx.fillStyle=dashColor;
      ctx.fillText(label,mx,my);
    }
    ctx.restore();
  }

  // Attack arrows — red dashed (only player's queued attacks)
  if(G.battleQueue&&G.battleQueue.length){
    G.battleQueue.filter(b=>b.isPlayer!==false).forEach(({fr,to,force})=>{
      const fp=PROVINCES[fr],tp=PROVINCES[to];
      if(!fp||!tp)return;
      const [fsx,fsy]=toScreen(fp.cx,fp.cy);
      const [tsx,tsy]=toScreen(tp.cx,tp.cy);
      drawOrderArrow(fsx,fsy,tsx,tsy,'rgba(255,80,80,.85)','#ff9090',fm(force));
    });
  }
  // Move arrows — green dashed (only player's queued moves)
  if(G.moveQueue&&G.moveQueue.length){
    G.moveQueue.forEach(({from,to,amount})=>{
      const fp=PROVINCES[from],tp=PROVINCES[to];
      if(!fp||!tp)return;
      const [fsx,fsy]=toScreen(fp.cx,fp.cy);
      const [tsx,tsy]=toScreen(tp.cx,tp.cy);
      drawOrderArrow(fsx,fsy,tsx,tsy,'rgba(80,220,80,.85)','#a0ffb0',fm(amount));
    });
  }
  if(G.mapMode==='disease'){
    const active=G.epidemics?.filter(ep=>ep.active)||[];
    if(active.length>0){
      const pad=10, lh=18, sw=160, sh=pad*2+active.length*lh+16;
      const lx=CW-sw-8, ly=8;
      ctx.fillStyle='rgba(6,8,14,.88)';
      ctx.strokeStyle='rgba(42,36,24,.8)';ctx.lineWidth=1;
      ctx.beginPath();ctx.rect(lx,ly,sw,sh);ctx.fill();ctx.stroke();
      ctx.font='bold 9px Cinzel,serif';
      ctx.fillStyle='#c9a84c';ctx.textAlign='left';ctx.textBaseline='top';
      ctx.fillText('ACTIVE EPIDEMICS',lx+pad,ly+pad);
      active.forEach((ep,idx)=>{
        const ey=ly+pad+14+idx*lh;
        // Colored dot
        ctx.fillStyle=ep.color;
        ctx.beginPath();ctx.arc(lx+pad+5,ey+7,5,0,Math.PI*2);ctx.fill();
        // Name + death count
        ctx.fillStyle='#e8d5a3';ctx.font='8px Cinzel,serif';
        ctx.fillText(`${ep.icon} ${ep.name}`,lx+pad+14,ey+2);
        ctx.fillStyle='#8a7848';ctx.font='7px serif';
        ctx.fillText(`${ep.provinces.size} provs · ☠${fm(ep.dead)}`,lx+pad+14,ey+10);
      });
    } else {
      // No active epidemics message
      ctx.fillStyle='rgba(6,8,14,.75)';
      ctx.strokeStyle='rgba(42,36,24,.6)';ctx.lineWidth=1;
      ctx.beginPath();ctx.rect(CW-160,8,152,28);ctx.fill();ctx.stroke();
      ctx.font='9px Cinzel,serif';ctx.fillStyle='#8a7848';
      ctx.textAlign='left';ctx.textBaseline='middle';
      ctx.fillText('No active epidemics',CW-150,22);
    }
  }
  if(G.mapMode==='buildings'){
    // Count player buildings
    const PN=G.playerNation;
    const bldCounts={};
    PROVINCES.forEach((_,i)=>{
      if(G.owner[i]!==PN)return;
      (G.buildings[i]||[]).forEach(k=>{bldCounts[k]=(bldCounts[k]||0)+1;});
      if(G.construction[i])bldCounts['_const']=(bldCounts['_const']||0)+1;
    });
    const entries=Object.entries(bldCounts).filter(([k])=>k!=='_const');
    const constCount=bldCounts['_const']||0;
    if(entries.length||constCount){
      const pad=9,lh=16,sw=165,sh=pad*2+20+(entries.length+(constCount?1:0))*lh;
      const lx=CW-sw-8,ly=8;
      ctx.fillStyle='rgba(6,8,14,.9)';ctx.strokeStyle='rgba(40,60,30,.9)';ctx.lineWidth=1;
      ctx.beginPath();ctx.rect(lx,ly,sw,sh);ctx.fill();ctx.stroke();
      ctx.font='bold 9px Cinzel,serif';ctx.fillStyle='#c9a84c';ctx.textAlign='left';ctx.textBaseline='top';
      ctx.fillText('YOUR BUILDINGS',lx+pad,ly+pad);
      let row=0;
      entries.sort((a,b)=>b[1]-a[1]).forEach(([k,cnt])=>{
        const b=BUILDINGS[k];if(!b)return;
        const ey=ly+pad+16+row*lh;
        ctx.font=`${lh-4}px serif`;ctx.fillText(b.icon||'?',lx+pad,ey);
        ctx.font='8px Cinzel,serif';ctx.fillStyle='#e8d5a3';
        ctx.fillText(b.name,lx+pad+18,ey+1);
        ctx.fillStyle='#c9a84c';ctx.font='bold 9px Cinzel,serif';
        ctx.textAlign='right';ctx.fillText('×'+cnt,lx+sw-pad,ey+1);
        ctx.textAlign='left';ctx.fillStyle='#e8d5a3';
        row++;
      });
      if(constCount){
        const ey=ly+pad+16+row*lh;
        ctx.font='8px Cinzel,serif';ctx.fillStyle='#c9a84c';
        ctx.fillText('🏗 Under construction',lx+pad,ey+1);
        ctx.textAlign='right';ctx.fillText('×'+constCount,lx+sw-pad,ey+1);
        ctx.textAlign='left';
      }
    } else {
      ctx.fillStyle='rgba(6,8,14,.8)';ctx.strokeStyle='rgba(40,60,30,.7)';ctx.lineWidth=1;
      ctx.beginPath();ctx.rect(CW-180,8,172,26);ctx.fill();ctx.stroke();
      ctx.font='9px Cinzel,serif';ctx.fillStyle='#8a7848';ctx.textAlign='left';ctx.textBaseline='middle';
      ctx.fillText('No buildings constructed yet',CW-172,21);
    }
  }
}
function zoomBy(f,cx,cy){
  if(cx===undefined){cx=CW/2;cy=CH/2;}
  const ns=Math.max(.18,Math.min(9,vp.scale*f)),r=ns/vp.scale;
  vp.tx=cx-(cx-vp.tx)*r;vp.ty=cy-(cy-vp.ty)*r;vp.scale=ns;
  scheduleDraw();
}
function zoomReset(){
  if(!PROVINCES.length){vp.scale=1;vp.tx=0;vp.ty=0;scheduleDraw();return;}
  const xs=PROVINCES.map(p=>p.cx), ys=PROVINCES.map(p=>p.cy);
  const minX=Math.min(...xs)-25, maxX=Math.max(...xs)+25;
  const minY=Math.min(...ys)-25, maxY=Math.max(...ys)+25;
  const mw=maxX-minX, mh=maxY-minY;
  const s=Math.min(CW/mw, CH/mh)*0.88;
  vp.scale=s;
  vp.tx=(CW-mw*s)/2 - minX*s;
  vp.ty=(CH-mh*s)/2 - minY*s;
  scheduleDraw();
}

// Hit-test: which province was clicked at world coords wx,wy
function hitProv(wx,wy){
  let best=-1,bestDist=Infinity;
  PROVINCES.forEach((p,i)=>{
    const dx=wx-p.cx,dy=wy-p.cy,d=dx*dx+dy*dy;
    const r=p.isCapital?19:15;
    if(d<r*r*1.2&&d<bestDist){bestDist=d;best=i;}
  });
  return best;
}

// ── PROVINCE POPUP ────────────────────────────────────────
let _ppProvince = -1;

function showProvPopup(i, screenX, screenY){
  const p=PROVINCES[i], o=G.owner[i], PN=G.playerNation;
  _ppProvince = i;

  const isOurs = o === PN;
  const isEnemy = o >= 0 && o !== PN;
  const isIndep = o < 0;
  const ideo = o >= 0 ? IDEOLOGIES[NATIONS[o]&&NATIONS[o].ideology] : null;
  const ownerTxt = o < 0 ? '⚡ Rebels' : (NATIONS[o]&&NATIONS[o].name) || '?';

  let inc = G.income[i];
  if((G.buildings[i]||[]).includes('factory')) inc = Math.floor(inc*1.8);
  if(isOurs) inc = Math.floor(inc * ideol().income);

  const peace = inPeacePeriod();
  const canAtk = !peace && (isEnemy||isIndep) && regsOf(PN).some(r=>G.army[r]>100&&(NB[r]||[]).includes(i));
  const canMove = isOurs && G.army[i]>100;

  const epId = G.provDisease&&G.provDisease[i];
  const ep = epId ? G.epidemics&&G.epidemics.find(e=>e.id===epId&&e.active) : null;

  // Stats grid — pick most relevant 4 stats
  const stats = [];
  const avail_army = isOurs ? availableArmy(i) : G.army[i];
  const armyStr = canSeeArmy(i)
    ? (isOurs && avail_army < G.army[i] ? `${fm(avail_army)}/${fm(G.army[i])}` : fm(G.army[i]))
    : '?';
  stats.push({l:'Army', v: armyStr});
  stats.push({l:'Pop', v: fm(G.pop[i])});
  stats.push({l:'Income', v: inc+'/mo'});
  if(isOurs){
    stats.push({l:'Satisfaction', v: Math.round(G.satisfaction[i]||0)+'%'});
  } else {
    stats.push({l:'Terrain', v: (()=>{
      const tm = p.terrainMap && Object.values(p.terrainMap);
      if(tm && tm.length > 1){
        // Count dominant terrain
        const freq = {};
        tm.forEach(t=>{ freq[t]=(freq[t]||0)+1; });
        const dom = Object.entries(freq).sort((a,b)=>b[1]-a[1])[0][0];
        const types = Object.keys(freq).length;
        return (TERRAIN[dom]?.name||dom) + (types>1?` +${types-1}`:'');
      }
      return TERRAIN[p.terrain||'plains']?.name||'Plains';
    })()});
  }

  const gridHtml = stats.map(s=>`<div class="pp-cell"><div class="pp-label">${s.l}</div><div class="pp-val">${s.v}</div></div>`).join('');

  const diseaseHtml = ep ? `<div class="pp-disease" style="color:${ep.color};border-color:${ep.color}">${ep.icon} ${ep.name}</div>` : '';

  // Action buttons
  const btns = [];
  if(isEnemy||isIndep){
    btns.push({icon:'⚔',lbl:'Attack',cls:'red',disabled:!canAtk,onclick:`hideProvPopup();G.sel=${i};chkBtns();openAttack()`});
  }
  if(isOurs&&canMove&&G.mapMode!=='instab'){
    btns.push({icon:'🚶',lbl:'Move',cls:'grn',onclick:`hideProvPopup();G.sel=${i};toggleMoveMode()`});
  }
  if(isOurs&&G.mapMode==='instab'){
    // In Unrest mode: show Assimilate instead of Build/Draft
    const instabVal=G.instab[i]||0;
    const hasAssim=G.assimQueue&&G.assimQueue[i];
    const canAssim=instabVal>25;
    if(hasAssim){
      btns.push({icon:'🔄',lbl:'Assimilating…',cls:'',disabled:true,onclick:''});
    } else if(canAssim){
      btns.push({icon:'🏛',lbl:'Assimilate',cls:'',onclick:`hideProvPopup();G.sel=${i};openAssim(${i})`});
    } else {
      btns.push({icon:'✅',lbl:'Stable',cls:'',disabled:true,onclick:''});
    }
  } else if(isOurs&&G.mapMode!=='instab'){
    btns.push({icon:'🏗',lbl:'Build',cls:'',onclick:`hideProvPopup();G.sel=${i};openBuild()`});
    const _hasDraft=(G.draftQueue||[]).some(d=>d.prov===i&&d.nation===G.playerNation);
    btns.push({icon:'🪖',lbl:_hasDraft?'Drafting…':'Draft',cls:'',disabled:_hasDraft,onclick:_hasDraft?'':(`hideProvPopup();G.sel=${i};openDraft()`)});
  }
  btns.push({icon:'📋',lbl:'Details',cls:'',onclick:`hideProvPopup();G.sel=${i};updateSP(${i});scheduleDraw()`});

  const btnsHtml = btns.map(b=>`<button class="pp-act${b.cls?' '+b.cls:''}" ${b.disabled?'disabled':''} onclick="${b.onclick}"><span class="pp-act-icon">${b.icon}</span><span class="pp-act-lbl">${b.lbl}</span></button>`).join('');

  const html = `
    <button class="pp-close" onclick="hideProvPopup()">✕</button>
    <div class="pp-head">
      <div class="pp-name">${p.name||p.short||'Province'}${p.isCapital?' ★':''}</div>
      <div class="pp-sub">${ownerTxt}${ideo?' · '+ideo.icon+' '+ideo.name:''}</div>
    </div>
    <div class="pp-grid">${gridHtml}</div>
    ${diseaseHtml}
    <div class="pp-actions">${btnsHtml}</div>
  `;

  const pp = document.getElementById('prov-popup');
  const pi = document.getElementById('prov-popup-inner');
  if(!pp||!pi) return;
  pi.innerHTML = html;
  pi.classList.remove('pp-anim');
  void pi.offsetWidth;
  pi.classList.add('pp-anim');

  pp.style.display = 'block';
  const ppW = pi.offsetWidth || 260;
  const ppH = pi.offsetHeight || 180;
  const wrap = document.getElementById('map-wrap');
  const wrapRect = wrap ? wrap.getBoundingClientRect() : {left:0,top:0,width:window.innerWidth,height:window.innerHeight};
  let x = screenX - ppW/2;
  let y = screenY - ppH - 14;
  if(x < 4) x = 4;
  if(x + ppW > wrapRect.width - 4) x = wrapRect.width - ppW - 4;
  if(y < 4) y = screenY + 22;
  pp.style.left = x + 'px';
  pp.style.top = y + 'px';
}

function hideProvPopup(){
  const pp = document.getElementById('prov-popup');
  if(pp) pp.style.display = 'none';
  _ppProvince = -1;
}

function hexToRgb(hex){
  const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);
  return `${r},${g},${b}`;
}

function onCanvasClick(wx,wy){
  const i=hitProv(wx,wy);
  if(i<0){hideProvPopup();return;}

  if(G.navalMode&&G.navalFrom>=0){
    if(navalDests(G.navalFrom).includes(i))openNavalDialog(G.navalFrom,i);
    else if(G.owner[i]===G.playerNation&&canLaunchNaval(i)){G.navalFrom=i;scheduleDraw();updateSP(i);}
    else cancelNaval();
    return;
  }
  if(G.moveMode&&G.moveFrom>=0){
    if(isMoveTgt(i))openMoveDialog(G.moveFrom,i);
    else if(G.owner[i]===G.playerNation&&G.army[i]>100){G.moveFrom=i;scheduleDraw();updateSP(i);}
    else cancelMove();
    return;
  }

  // Attack source selection mode
  if(_atkSelectMode && _atkTarget>=0){
    if(isAtkSrc(i)){
      const tgt=_atkTarget;
      cancelAtkSelect();
      showAttackDialog(i, tgt);
    } else {
      cancelAtkSelect();
    }
    return;
  }

  // Always select for side panel
  G.sel=i; scheduleDraw(); updateSP(i); chkBtns();
  if(window.innerWidth<=700) switchTab('info');

  // Show popup with province info + action buttons
  // Convert world coords back to screen for popup positioning
  const [sx,sy] = toScreen(PROVINCES[i].cx, PROVINCES[i].cy);
  showProvPopup(i, sx, sy - HEX_R*vp.scale);
}

// ── POINTER EVENTS (unified mouse+touch) ──────────────────
let _pan={active:false,lx:0,ly:0};
let _pinch={active:false,dist:0};
let _tapStart={x:0,y:0,t:0};
let _moved=false;

const wrap=document.getElementById('map-wrap');

// Mouse
canvas.addEventListener('mousedown',e=>{
  if(e.button===1||(e.button===0&&e.ctrlKey)){e.preventDefault();}
  _pan.active=true;_pan.lx=e.clientX;_pan.ly=e.clientY;_moved=false;
  _tapStart={x:e.clientX,y:e.clientY,t:Date.now()};
  wrap.style.cursor='grabbing';
  hideProvPopup();
});
window.addEventListener('mousemove',e=>{
  if(!_pan.active)return;
  const dx=e.clientX-_pan.lx,dy=e.clientY-_pan.ly;
  if(Math.abs(dx)>3||Math.abs(dy)>3){_moved=true;hideProvPopup();}
  vp.tx+=dx;vp.ty+=dy;_pan.lx=e.clientX;_pan.ly=e.clientY;
  scheduleDraw();
});
window.addEventListener('mouseup',e=>{
  if(!_pan.active)return;
  _pan.active=false;wrap.style.cursor='';
  if(!_moved&&Date.now()-_tapStart.t<400){
    const r=canvas.getBoundingClientRect();
    const[wx,wy]=toWorld(e.clientX-r.left,e.clientY-r.top);
    onCanvasClick(wx,wy);
  }
});
canvas.addEventListener('wheel',e=>{
  e.preventDefault();
  const r=canvas.getBoundingClientRect();
  zoomBy(e.deltaY<0?1.12:1/1.12,e.clientX-r.left,e.clientY-r.top);
},{passive:false});

// Touch — single finger pan + two finger pinch
const _touches={};
canvas.addEventListener('touchstart',e=>{
  e.preventDefault();
  for(const t of e.changedTouches)_touches[t.identifier]={x:t.clientX,y:t.clientY};
  if(e.touches.length===1){
    _pan.active=true;_pan.lx=e.touches[0].clientX;_pan.ly=e.touches[0].clientY;
    _moved=false;_tapStart={x:_pan.lx,y:_pan.ly,t:Date.now()};
  }
  if(e.touches.length===2){
    _pan.active=false;
    const dx=e.touches[0].clientX-e.touches[1].clientX;
    const dy=e.touches[0].clientY-e.touches[1].clientY;
    _pinch={active:true,dist:Math.hypot(dx,dy)};
  }
},{passive:false});
canvas.addEventListener('touchmove',e=>{
  e.preventDefault();
  if(e.touches.length===1&&_pan.active){
    const t=e.touches[0];
    const dx=t.clientX-_pan.lx,dy=t.clientY-_pan.ly;
    if(Math.abs(dx)>2||Math.abs(dy)>2){_moved=true;hideProvPopup();}
    vp.tx+=dx;vp.ty+=dy;_pan.lx=t.clientX;_pan.ly=t.clientY;
    scheduleDraw();
  }else if(e.touches.length===2&&_pinch.active){
    const dx=e.touches[0].clientX-e.touches[1].clientX;
    const dy=e.touches[0].clientY-e.touches[1].clientY;
    const nd=Math.hypot(dx,dy);
    const r=canvas.getBoundingClientRect();
    const cx=(e.touches[0].clientX+e.touches[1].clientX)/2-r.left;
    const cy=(e.touches[0].clientY+e.touches[1].clientY)/2-r.top;
    if(_pinch.dist>0)zoomBy(nd/_pinch.dist,cx,cy);
    _pinch.dist=nd;
  }
},{passive:false});
canvas.addEventListener('touchend',e=>{
  e.preventDefault();
  for(const t of e.changedTouches)delete _touches[t.identifier];
  if(e.touches.length===0){
    _pinch.active=false;
    if(!_moved&&_pan.active&&Date.now()-_tapStart.t<400){
      const r=canvas.getBoundingClientRect();
      const[wx,wy]=toWorld(_tapStart.x-r.left,_tapStart.y-r.top);
      onCanvasClick(wx,wy);
    }
    _pan.active=false;
  }
  if(e.touches.length===1){_pan.active=true;_pan.lx=e.touches[0].clientX;_pan.ly=e.touches[0].clientY;}
},{passive:false});


// ── HUD / UI ──────────────────────────────────────────────
function updateHUD(){
  const mr=regsOf(G.playerNation);let ta=0,tp=0,tsat=0;
  mr.forEach(r=>{ta+=G.army[r];tp+=G.pop[r];tsat+=G.satisfaction[r]??70;});
  const avgSat=mr.length?Math.round(tsat/mr.length):70;
  const debt=G.loans.reduce((s,l)=>s+l.amount,0);
  sEl('h-date',dateStr());
  sEl('h-gld',fa(G.gold[G.playerNation]));
  sEl('h-pop',fm(tp));
  const loanSt=document.getElementById('h-loan-st');
  if(loanSt){loanSt.style.display=debt>0?'flex':'none';sEl('h-debt',fa(debt));}
  // Satisfaction display
  const satEl=document.getElementById('h-sat');
  if(satEl){
    satEl.textContent=avgSat+'%';
    const satSt=document.getElementById('h-sat-st');
    if(satSt){
      satSt.classList.toggle('warn',avgSat<40);
      satSt.style.display='flex';
    }
  }
  // Tax rate display
  const taxEl=document.getElementById('h-tax');
  if(taxEl){
    const tr=G.taxRate??25;
    taxEl.textContent=tr+'%';
    taxEl.style.color=tr<=25?'var(--green2)':tr<=50?'var(--gold)':tr<=75?'#e07030':'#ff4040';
  }
  // sp-tax-sub update
  const taxSubEl=document.getElementById('sp-tax-sub');
  if(taxSubEl){const tr=G.taxRate??25;taxSubEl.textContent=`Tax: ${tr}% · Avg satisfaction: ${avgSat}%`;}
  // Reform indicator
  const refEl=document.getElementById('h-reform-st');
  if(refEl){
    refEl.style.display=G.reforming?'flex':'none';
    if(G.reforming)sEl('h-reform-txt',`⚖ ${G.reformTurnsLeft}mo left`);
  }
}
function updateIdeoHUD(){const io=ideol(),el=document.getElementById('hud-ideo');if(!el)return;el.textContent=io.icon+' '+io.name;el.style.color=io.color;el.style.borderColor=io.border;}
function updateSeasonUI(){
  const s=season();
  sEl('h-season',s.icon);
  const sb=document.getElementById('season-banner');
  if(sb)sb.textContent=s.icon+' '+s.name+(s.moveMod<1?` — movement ×${s.moveMod}`:'');
}
const sEl=(id,v)=>{const e=document.getElementById(id);if(e)e.textContent=v;};
const sHTML=(id,v)=>{const e=document.getElementById(id);if(e)e.innerHTML=v;};

function isMoveTgt(i){
  if(!G.moveMode||G.moveFrom<0||i===G.moveFrom)return false;
  if(!NB[G.moveFrom].includes(i))return false;
  const o=G.owner[i];
  if(o!==G.playerNation&&o>=0&&!atWar(G.playerNation,o))return false;
  return true;
}

function updateSP(i){
  if(i<0)return;
  const p=PROVINCES[i],o=G.owner[i];
  let inc=G.income[i];
  if((G.buildings[i]||[]).includes('factory'))inc=Math.floor(inc*1.8);
  if(o===G.playerNation)inc=Math.floor(inc*ideol().income);
  const maxBld=p.isCapital?MAX_BLD_CAP:MAX_BLD_NORM;
  const bldC=(G.buildings[i]||[]).length;
  const inst=G.instab[i],resist=G.resistance[i];
  const navalRch=canLaunchNaval(i)?navalDests(i).length:0;
  const allyIdx=o>=0?G.allianceOf[o]:-1;
  const allyName=allyIdx>=0?G.alliance[allyIdx]?.name:'';

  let bdg='';
  if(o===G.playerNation){
    bdg='<span class="badge ours">★ Yours</span>';
    if(p.isCapital)bdg+='<span class="badge cap">★ Capital</span>';
    if(inst>40)bdg+='<span class="badge war">⚡ Unstable</span>';
  } else if(o<0)bdg='';
  else if(atWar(G.playerNation,o))bdg='<span class="badge war">⚔ War</span>';
  else if(G.pact[G.playerNation][o])bdg=`<span class="badge pact">🤝 Pact(${G.pLeft[G.playerNation][o]}mo)</span>`;
  else if(areAllies(G.playerNation,o))bdg=`<span class="badge ally">🤝 ${allyName}</span>`;
  else bdg='<span class="badge neut">○ Neutral</span>';
  if(resist>20)bdg+=`<span class="badge resist">🔥 Resist ${Math.round(resist)}%</span>`;
  if(G.puppet.includes(o))bdg+='<span class="badge pact">🎭 Puppet</span>';
  // Disease badge
  const epId=G.provDisease?.[i];
  if(epId){
    const ep=G.epidemics?.find(e=>e.id===epId&&e.active);
    if(ep)bdg+=`<span class="badge war" style="border-color:${ep.color};color:${ep.color}">${ep.icon} ${ep.name}</span>`;
  }

  const resHtml=Object.entries(G.resBase[i]||{}).filter(([,v])=>v>0).map(([k,v])=>`<span class="res-chip">${{oil:'🛢️',coal:'⚫',grain:'🌾',steel:'⚙️'}[k]||k} ${v}</span>`).join('');
  const bldHtml=bldC?G.buildings[i].map(k=>`<span class="bld-tag">${BUILDINGS[k]?.icon||k}</span>`).join(''):`<span style="font-size:8px;color:var(--dim)">${bldC}/${maxBld} buildings</span>`;

  sEl('sp-nm',p.name);
  sHTML('sp-bdg',bdg);
  sEl('sp-ow',(o>=0?ownerName(o):'Rebels')+' · '+(TERRAIN[p.terrain||'plains']?.name||'')+' · '+dateStr());
  const avArmy=G.owner[i]===G.playerNation?availableArmy(i):G.army[i];
  const armyDisp=G.owner[i]===G.playerNation&&avArmy<G.army[i]
    ?`${fa(avArmy)} <span style="color:var(--dim);font-size:9px">(${fa(G.army[i])})</span>`
    :fa(G.army[i]);
  sEl('sp-ar',canSeeArmy(i)?fa(avArmy):fa(G.army[i]));sEl('sp-pp',fm(G.pop[i]));sEl('sp-in',inc+'/mo');
  sEl('sp-as',o===G.playerNation?Math.round(G.assim[i])+'%':'—');
  sHTML('sp-res',resHtml);sHTML('sp-blds',bldHtml);
  const spif=document.getElementById('sp-if'),spiv=document.getElementById('sp-iv');
  if(spif){spif.style.width=inst+'%';spif.style.background=inst>70?'#c82808':inst>40?'#c08020':'#389828';}
  if(spiv)spiv.textContent=Math.round(inst)+'%';
  const spibar=document.getElementById('sp-ibar');if(spibar)spibar.style.display='none';
  // Satisfaction bar
  const sat=G.satisfaction[i]??70;
  const spsat=document.getElementById('sp-sat-fill'),spsatv=document.getElementById('sp-sat-val');
  const spsatbar=document.getElementById('sp-sat-bar');
  if(spsatbar)spsatbar.style.display=o===G.playerNation?'block':'none';
  if(spsat){spsat.style.width=sat+'%';spsat.style.background=sat<40?'#c83020':sat<60?'#c08020':'#389828';}
  if(spsatv)spsatv.textContent=Math.round(sat)+'%';
  // Construction progress
  const con=G.construction[i];
  const spcon=document.getElementById('sp-con');
  if(spcon){
    if(con&&o===G.playerNation){
      const b=BUILDINGS[con.building];
      const pct=Math.round((con.totalTurns-con.turnsLeft)/con.totalTurns*100);
      spcon.style.display='block';
      spcon.innerHTML=`<div style="display:flex;justify-content:space-between;font-size:7.5px;color:var(--dim);margin-bottom:2px"><span>🏗 ${b?.name}</span><span>${con.totalTurns-con.turnsLeft}/${con.totalTurns}mo</span></div><div style="height:3px;background:rgba(255,255,255,.06);border-radius:2px"><div style="height:100%;background:var(--gold);border-radius:2px;width:${pct}%"></div></div>`;
    }else spcon.style.display='none';
  }
  sEl('sp-bld-sub',o===G.playerNation?(con?`Building: ${BUILDINGS[con.building]?.name}`:`${bldC}/${maxBld} slots`):'Select your territory');
  // Move/naval btns
  const canMove=o===G.playerNation&&G.army[i]>100;
  ['sp-btn-move','mob-btn-move'].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=!canMove;});
  sEl('sp-move-sub',canMove?`From ${p.short}`:'Select your territory');
  const canNaval=canLaunchNaval(i);
  ['sp-btn-naval','mob-btn-naval'].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=!canNaval;});
  sEl('sp-naval-sub',canNaval?`${navalRch} ports in range`:'Need port + coastal');
  // Mobile
  sEl('ri-nm',p.name);sHTML('ri-bdg',bdg);sEl('ri-ow',o>=0?ownerName(o):'Rebels');
  sEl('ri-ar',fa(G.army[i]));sEl('ri-pp',fm(G.pop[i]));sEl('ri-in',inc+'/mo');sEl('ri-as',o===G.playerNation?Math.round(G.assim[i])+'%':'—');
  sHTML('ri-res',resHtml);sHTML('ri-blds',bldHtml);
  const riif=document.getElementById('ri-if'),riiv=document.getElementById('ri-iv');
  if(riif){riif.style.width=inst+'%';riif.style.background=inst>70?'#c82808':inst>40?'#c08020':'#389828';}
  if(riiv)riiv.textContent=Math.round(inst)+'%';
}

const PEACE_WEEKS = 10;
function inPeacePeriod(){ return (G.tick||0) < PEACE_WEEKS; }
function peaceTurnsLeft(){ return Math.max(0, PEACE_WEEKS - (G.tick||0)); }

function chkBtns(){
  const si=G.sel,PN=G.playerNation;
  const peace=inPeacePeriod();
  const canAtk=!peace&&si>=0&&G.owner[si]!==PN&&G.owner[si]>=0;
  const fr=canAtk?regsOf(PN).find(r=>G.army[r]>100&&NB[r]?.includes(si)):undefined;
  const ok=fr!==undefined&&canAtk;
  ['btn-atk','sp-btn-atk'].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=!ok;});
  const atkSub = peace
    ? `Peace — ${peaceTurnsLeft()} weeks left`
    : !canAtk ? 'Select enemy'
    : ok ? `${PROVINCES[fr].short}→${PROVINCES[si].short}`
    : 'No army on border';
  sEl('sp-atk-sub', atkSub);
  sEl('atk-sub', peace ? `Peace — ${peaceTurnsLeft()}wk` : ok?`${PROVINCES[fr].short}→${PROVINCES[si].short}`:'Select enemy');
  if(ok){window._af=fr;window._at=si;}
}

// ── MODAL ─────────────────────────────────────────────────
function openMo(title,body,btns){
  sEl('mo-t',title);sHTML('mo-b',body);
  const bw=document.getElementById('mo-btns');bw.innerHTML='';
  btns.forEach(({lbl,cls,cb})=>{const b=document.createElement('button');b.className='btn '+(cls||'');b.textContent=lbl;b.onclick=()=>{closeMo();cb&&cb();};bw.appendChild(b);});
  document.getElementById('mo').classList.add('on');
}
function closeMo(){document.getElementById('mo').classList.remove('on');}
function moOut(e){if(e.target===document.getElementById('mo'))closeMo();}
// Aliases used by save system in index.html
function openModal(title,body,btnsHtml){
  sEl('mo-t',title);sHTML('mo-b',body);
  const bw=document.getElementById('mo-btns');
  bw.innerHTML=btnsHtml||'';
  document.getElementById('mo').classList.add('on');
}
function closeModal(){closeMo();}

let _popT;
function popup(msg,dur=2600){const p=document.getElementById('popup');p.textContent=msg;p.classList.add('on');clearTimeout(_popT);_popT=setTimeout(()=>p.classList.remove('on'),dur);}
function addLog(msg,type='info'){
  const entryHtml=`<div class="le le-new"><span class="lt">${dateStr()}</span><span class="lm ${type}">${msg}</span></div>`;
  ['log','mob-log'].forEach(id=>{
    const l=document.getElementById(id);if(!l)return;
    // Clear placeholder
    if(id==='log'&&l.children.length===1&&l.children[0].style?.textAlign==='center')l.innerHTML='';
    l.insertAdjacentHTML('afterbegin',entryHtml);
    // Trigger animation on the new entry
    const newEl=l.firstElementChild;
    if(newEl){
      void newEl.offsetWidth; // reflow
      newEl.classList.add('le-anim');
      setTimeout(()=>newEl?.classList.remove('le-new','le-anim'),600);
    }
    while(l.children.length>100)l.removeChild(l.lastChild);
  });
}
function setEB(d){['end-btn','end-btn-mob'].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=d;});}

// Escape key closes popup and cancels modes
document.addEventListener('keydown', e=>{
  if(e.key==='Escape'){
    hideProvPopup();
    if(_atkSelectMode) cancelAtkSelect();
    if(G.moveMode) cancelMove();
    if(G.navalMode) cancelNaval();
  }
});


// ── MOVEMENT ──────────────────────────────────────────────
function toggleMoveMode(){
  if(G.navalMode)cancelNaval();
  if(G.moveMode){cancelMove();return;}
  const si=G.sel;
  if(si<0||G.owner[si]!==G.playerNation||G.army[si]<1){popup('Select your territory first!');return;}
  G.moveFrom=si;G.moveMode=true;
  const mb=document.getElementById('move-banner');if(mb)mb.style.display='block';
  ['sp-btn-move','mob-btn-move'].forEach(id=>{const b=document.getElementById(id);if(b){b.classList.add('active-mode');const am=b.querySelector('.am');if(am)am.textContent='Cancel Move';}});
  scheduleDraw();popup('Move mode — click adjacent territory');
}
function cancelMove(){
  G.moveFrom=-1;G.moveMode=false;
  const mb=document.getElementById('move-banner');if(mb)mb.style.display='none';
  ['sp-btn-move','mob-btn-move'].forEach(id=>{const b=document.getElementById(id);if(b){b.classList.remove('active-mode');const am=b.querySelector('.am');if(am)am.textContent='Move Army';}});
  scheduleDraw();
}
function isMoveTgt(i){
  if(!G.moveMode||G.moveFrom<0||i===G.moveFrom)return false;
  if(!NB[G.moveFrom]?.includes(i))return false;
  const o=G.owner[i];
  // Only allow move into own territory or independent (o<0) provinces
  // Enemy provinces must use the Attack button, not Move
  if(o>=0&&o!==G.playerNation)return false;
  return true;
}
// How many troops are available in province (actual minus committed to queues)
function availableArmy(prov){
  let committed=0;
  (G.battleQueue||[]).forEach(b=>{if(b.fr===prov)committed+=b.force;});
  (G.moveQueue||[]).forEach(m=>{if(m.from===prov)committed+=m.amount;});
  return Math.max(0,(G.army[prov]||0)-committed);
}

function openMoveDialog(from,to){
  cancelMove();
  const toOwner=G.owner[to];
  const PN=G.playerNation;

  // Moving onto ENEMY territory → offer attack instead
  if(toOwner>=0&&toOwner!==PN&&!atWar(PN,toOwner)){
    if(inPeacePeriod()){popup(`Peace period — ${peaceTurnsLeft()} weeks remaining`);return;}
    openMo('ENTER HOSTILE TERRITORY',
      `<p class="mx">Moving into <b style="color:#ff7070">${PROVINCES[to].name}</b> (${ownerName(toOwner)}) will start a war.</p>
       <p class="mx" style="color:var(--dim)">Declare war and attack, or cancel?</p>`,
      [{lbl:'Cancel',cls:'dim'},
       {lbl:'⚔ Declare War & Attack',cls:'red',cb:()=>{G.sel=to;window._af=from;window._at=to;launchAtkFromMove(from,to);}}]
    );
    return;
  }

  const avail=availableArmy(from);
  if(avail<=0){popup('No available troops (all committed to orders)!');return;}

  const s=season();
  const terrMod=s.winterTerrain&&s.winterTerrain.includes(PROVINCES[to].terrain)?s.moveMod:1.0;
  const movNote=terrMod<1?`<p class="mx" style="color:#80c8ff">${s.icon} ${s.name}: movement ×${terrMod}</p>`:'';
  openMo('TROOP MOVEMENT',
    `<p class="mx"><b>${PROVINCES[from].short}</b> → <b style="color:var(--gold)">${PROVINCES[to].name}</b></p>
     ${movNote}
     <p class="mx">Available: <b>${fa(avail)}</b> · Total in province: <b style="color:var(--dim)">${fa(G.army[from])}</b></p>
     <div class="slider-w"><div class="slider-l"><span>Soldiers to send</span><span class="slider-v" id="msv">${fa(avail)}</span></div>
     <input type="range" id="msl" min="1" max="${avail}" value="${avail}" oninput="updSl('msl','msv')"></div>
     <p class="mx" style="font-size:9px;color:var(--dim)">Remaining troops stay — you can issue more orders this turn.</p>`,
    [{lbl:'Cancel',cls:'dim'},{lbl:'→ Queue Move',cls:'grn',cb:()=>confirmMove(from,to)}]
  );
  setTimeout(()=>document.getElementById('msl')&&document.getElementById('msl').style.setProperty('--pct','100%'),40);
}

function confirmMove(from,to){
  const v=+(document.getElementById('msl')&&document.getElementById('msl').value||availableArmy(from));
  if(!v)return;
  const avail=availableArmy(from);
  if(v>avail){popup(`Only ${fa(avail)} available!`);return;}
  // Add to move queue
  if(!G.moveQueue)G.moveQueue=[];
  G.moveQueue.push({from,to,amount:v});
  closeMo();
  const remaining=availableArmy(from);
  addLog(`🚶 Move queued: ${fa(v)} from ${PROVINCES[from].short} → ${PROVINCES[to].short}. ${fa(remaining)} remain.`,'move');
  popup(`✓ Move queued — ${fa(remaining)} still available in ${PROVINCES[from].short}`);
  scheduleDraw();updateHUD();if(G.sel>=0)updateSP(G.sel);chkBtns();
}
function launchAtkFromMove(from,to){
  const en=G.owner[to],PN=G.playerNation;
  if(en>=0)G.war[PN][en]=G.war[en][PN]=true;
  const force=availableArmy(from);
  if(force<=0){popup('No available troops!');return;}
  if(!G.battleQueue)G.battleQueue=[];
  G.battleQueue.push({fr:from,to,force,isPlayer:true});
  addLog(`⚔ Attack ordered: ${PROVINCES[from].short} → ${PROVINCES[to].name}`, 'war');
  popup(`⚔ Attack queued — executes next turn`);
  scheduleDraw();updateHUD();if(G.sel>=0)updateSP(G.sel);chkBtns();
}
function updSl(slId,vId){
  const sl=document.getElementById(slId),vEl=document.getElementById(vId);
  if(!sl||!vEl)return;const v=+sl.value;
  vEl.textContent=fa(v);sl.style.setProperty('--pct',+sl.max?(v/+sl.max*100)+'%':'0%');
}

// ── NAVAL ─────────────────────────────────────────────────
function toggleNavalMode(){
  if(G.moveMode)cancelMove();
  if(G.navalMode){cancelNaval();return;}
  const si=G.sel;
  if(si<0||!canLaunchNaval(si)){popup('Need coastal territory with port!');return;}
  G.navalFrom=si;G.navalMode=true;
  const mb=document.getElementById('move-banner');
  if(mb){mb.style.display='block';mb.className='naval';mb.textContent='⚓ NAVAL MODE — click destination';}
  ['sp-btn-naval','mob-btn-naval'].forEach(id=>{const b=document.getElementById(id);if(b){b.classList.add('active-naval');const am=b.querySelector('.am');if(am)am.textContent='Cancel Naval';}});
  scheduleDraw();popup('Naval mode — click reachable coastal territory');
}
function cancelNaval(){
  G.navalFrom=-1;G.navalMode=false;
  const mb=document.getElementById('move-banner');if(mb){mb.style.display='none';mb.className='';}
  ['sp-btn-naval','mob-btn-naval'].forEach(id=>{const b=document.getElementById(id);if(b){b.classList.remove('active-naval');const am=b.querySelector('.am');if(am)am.textContent='Naval Transport';}});
  scheduleDraw();
}
function openNavalDialog(from,to){
  cancelNaval();
  if(G.owner[to]>=0&&G.owner[to]!==G.playerNation&&!atWar(G.playerNation,G.owner[to])){popup('Cannot land without war!');return;}
  const max=G.army[from]-100;
  const zones=getNavalZones(PROVINCES[from].id).map(z=>z.replace(/_/g,' ')).join(', ');
  openMo('NAVAL TRANSPORT',`<p class="mx">⚓ <b>${PROVINCES[from].name}</b> → <b style="color:#60e8ff">${PROVINCES[to].name}</b></p><p class="mx" style="color:#5090c0">Via: <b>${zones}</b> · Arrives next month</p><p class="mx">Available: <b>${fa(max)}</b> soldiers</p><div class="slider-w"><div class="slider-l"><span>Soldiers</span><span class="slider-v" id="nsv">${fa(max)}</span></div><input type="range" id="nsl" min="100" max="${max}" value="${max}" oninput="updSl('nsl','nsv')"></div>`,
    [{lbl:'Cancel',cls:'dim'},{lbl:'⚓ Embark!',cls:'grn',cb:()=>confirmNaval(from,to)}]);
  setTimeout(()=>document.getElementById('nsl')?.style.setProperty('--pct','100%'),40);
}
function confirmNaval(from,to){
  const v=+(document.getElementById('nsl')?.value||G.army[from]-100);if(!v)return;
  G.army[from]-=v;
  G.fleet.push({at:to,size:v,nation:G.playerNation,arriveIn:1});
  addLog(`⚓ ${fa(v)} embarked ${PROVINCES[from].short}→${PROVINCES[to].short}.`,'naval');
  popup(`⚓ Fleet en route — arrives next month!`);scheduleDraw();updateHUD();
}
function resolveNavalArrivals(){
  G.fleet=G.fleet.filter(f=>{
    f.arriveIn--;
    if(f.arriveIn<=0&&f.nation===G.playerNation){
      G.army[f.at]+=f.size;
      if(G.owner[f.at]<0)G.owner[f.at]=G.playerNation;
      addLog(`⚓ ${fa(f.size)} troops landed at ${PROVINCES[f.at].short}.`,'naval');
      return false;
    }
    return f.arriveIn>0;
  });
}

// ── CONSCRIPTION ──────────────────────────────────────────
function openDraft(){
  const mr=PROVINCES.map((_,i)=>i).filter(i=>G.owner[i]===G.playerNation);
  if(!mr.length){popup('No territories!');return;}
  const io=ideol();
  // Current province (selected or capital)
  let cur=G.sel>=0&&G.owner[G.sel]===G.playerNation?G.sel:-1;
  if(cur<0){const ci=mr.find(i=>PROVINCES[i].isCapital&&PROVINCES[i].nation===G.playerNation);cur=ci!=null?ci:mr[0];}
  window._dr=cur;

  function isDrafting(r){return (G.draftQueue||[]).some(d=>d.prov===r&&d.nation===G.playerNation);}

  function draftCap(r){
    const hb=(G.buildings[r]||[]).includes('barracks');
    const sat=G.satisfaction[r]??70;
    const satMod=sat<40?0.5:sat<60?0.75:1.0;
    const refMod=G.reforming?0.8:1.0;
    return Math.max(0,Math.min(
      Math.floor(G.pop[r]*0.20*(hb?1.5:1)/io.conscriptMod*satMod*refMod),
      G.gold[G.playerNation]
    ));
  }
  function rowHtml(r,isPrimary){
    const cap=draftCap(r);
    const isOrig=PROVINCES[r].nation===G.playerNation;
    const name=PROVINCES[r].name+(PROVINCES[r].isCapital&&isOrig?'★':isOrig?'':' ⚑');
    const hb=(G.buildings[r]||[]).includes('barracks');
    const drafting=isDrafting(r);
    const draftEntry=drafting?(G.draftQueue||[]).find(d=>d.prov===r&&d.nation===G.playerNation):null;
    if(isPrimary){
      // Province already being drafted — show frozen state
      if(drafting){
        return`<div id="draft-primary" style="background:rgba(80,140,60,.08);border:1px solid rgba(114,243,114,.35);padding:10px 12px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <span style="font-family:Cinzel,serif;font-size:12px;color:#72F372">${name}</span>
            <span style="font-size:9px;color:var(--dim)">⚔ ${fm(G.army[r])} · pop ${fm(G.pop[r])}${hb?' · 🏕barracks':''}</span>
          </div>
          <div style="font-size:10px;color:#72F372;font-style:italic;text-align:center;padding:8px 0">
            🪖 Conscripting ${fa(draftEntry.amount)} soldiers — ${draftEntry.weeksLeft}w remaining
          </div>
          <button class="btn dim" style="width:100%;padding:7px;margin-top:4px" onclick="closeMo()">Close</button>
        </div>`;
      }
      const initVal=Math.min(2000,Math.floor(cap/2));
      return`<div id="draft-primary" style="background:rgba(201,168,76,.06);border:1px solid var(--gold);padding:10px 12px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-family:Cinzel,serif;font-size:12px;color:var(--gold)">${name}</span>
          <span style="font-size:9px;color:var(--dim)">⚔ ${fm(G.army[r])} · pop ${fm(G.pop[r])}${hb?' · 🏕barracks':''}</span>
        </div>
        ${cap>0?`
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:9px;color:var(--dim);flex-shrink:0">Soldiers</span>
          <input type="range" id="dsl" min="100" max="${cap}" value="${initVal}" oninput="updSl('dsl','dsv')" style="flex:1">
          <span style="font-family:Cinzel,serif;font-size:13px;color:var(--gold);min-width:38px;text-align:right" id="dsv">${fm(initVal)}</span>
        </div>
        <div style="display:flex;gap:6px">
          <button class="btn dim" style="flex:1;padding:7px" onclick="closeMo()">Cancel</button>
          <button class="btn grn" style="flex:2;padding:7px" onclick="confirmDraft()">⚔ Conscript ${fm(initVal)}</button>
        </div>`:`<div style="font-size:10px;color:var(--dim);font-style:italic;text-align:center;padding:6px 0">Cannot conscript here — no funds or population</div>
        <button class="btn dim" style="width:100%;padding:7px;margin-top:4px" onclick="closeMo()">Cancel</button>`}
      </div>`;
    }
    // Other province row — frozen if already drafting
    if(drafting){
      return`<div class="ti" id="dr${r}" onclick="switchDraftProv(${r})" style="padding:5px 9px;opacity:.65;cursor:pointer">
        <span class="tn" style="font-size:10px;color:#72F372">${name} <span style="font-size:8px">🪖</span></span>
        <span class="ta" style="font-size:8px;color:#72F372">Drafting ${fm(draftEntry.amount)} · ${draftEntry.weeksLeft}w</span>
      </div>`;
    }
    return`<div class="ti" id="dr${r}" onclick="switchDraftProv(${r})" style="padding:5px 9px">
      <span class="tn" style="font-size:10px">${name}</span>
      <span class="ta" style="font-size:8px">⚔${fm(G.army[r])} · Max ${fm(cap)}</span>
    </div>`;
  }

  const others=mr.filter(r=>r!==cur);
  const html=`
    <p class="mx" style="font-size:10px;margin-bottom:6px">Cost: <b>1,000 pop + 1 gold</b>/soldier · ${io.icon} ×${(1/io.conscriptMod).toFixed(2)} · Treasury: <b>${fa(G.gold[G.playerNation])}g</b></p>
    ${rowHtml(cur,true)}
    ${others.length?`<div style="font-size:8px;color:var(--dim);letter-spacing:2px;text-transform:uppercase;padding:4px 0 3px;border-bottom:1px solid rgba(42,36,24,.3);margin-bottom:4px">Other Territories</div>
    <div class="tlist" style="margin:0;max-height:220px;overflow-y:auto">${others.map(r=>rowHtml(r,false)).join('')}</div>`:''}
  `;
  openMo('CONSCRIPTION', html, []);
  // Update conscript button label live
  const sl=document.getElementById('dsl');
  if(sl) sl.addEventListener('input', ()=>{
    const btn=document.querySelector('#mo .btn.grn');
    if(btn)btn.textContent=`⚔ Conscript ${fm(+sl.value)}`;
  });
}

window.switchDraftProv=function(r){
  // Rebuild modal with new primary province
  window._dr=r;
  G.sel=r; // update selection too
  openDraft();
};

function pickDR(r){ window.switchDraftProv(r); } // legacy alias

function confirmDraft(){
  const r=window._dr; if(r<0||r===undefined)return;
  const v=+(document.getElementById('dsl')&&document.getElementById('dsl').value||0); if(!v)return;
  const io=ideol();
  // Guard: cannot draft in province already in queue
  if((G.draftQueue||[]).some(d=>d.prov===r&&d.nation===G.playerNation)){popup('Already conscripting here!');return;}
  if(G.pop[r]<v+1000){popup('Not enough population!');return;}
  if(G.gold[G.playerNation]<v){popup('Not enough gold!');return;}

  // ── Draft queue: conscription takes time ──────────────
  // Dictators (nazism/fascism/stalinism/militarism/communism): always 1 week
  // Others: 1 week for small draft (<5% pop), up to 2 weeks for large
  const dictatorIdeologies=['nazism','fascism','stalinism','militarism','communism'];
  const isDictator=dictatorIdeologies.includes(G.ideology);
  const popPct=v/G.pop[r];
  let draftWeeks;
  if(isDictator){
    draftWeeks=1;
  } else {
    draftWeeks=popPct<0.05?1:2;
  }

  // Immediate cost (pop + gold committed now)
  G.pop[r]=Math.max(1000,G.pop[r]-v);
  G.gold[G.playerNation]-=v;

  // Add to draft queue
  if(!G.draftQueue) G.draftQueue=[];
  G.draftQueue.push({
    prov: r,
    amount: v,
    weeksLeft: draftWeeks,
    totalWeeks: draftWeeks,
    nation: G.playerNation
  });

  closeMo();
  scheduleDraw(); updateHUD(); if(G.sel>=0)updateSP(G.sel);
  addLog(`🪖 ${PROVINCES[r].short}: ${fa(v)} being conscripted — arrive in ${draftWeeks} week${draftWeeks>1?'s':''}.`,'info');
  popup(`🪖 ${fa(v)} conscription started — ${draftWeeks}w until ready`);
}

// Process draft queue — called every week in endTurn
function processDraftQueue(){
  if(!G.draftQueue||!G.draftQueue.length) return;
  const done=[];
  G.draftQueue=G.draftQueue.filter(entry=>{
    entry.weeksLeft--;
    if(entry.weeksLeft<=0){
      G.army[entry.prov]=(G.army[entry.prov]||0)+entry.amount;
      done.push(entry);
      return false;
    }
    return true;
  });
  for(const entry of done){
    const isPlayer=entry.nation===G.playerNation;
    if(isPlayer){
      addLog(`✅ ${PROVINCES[entry.prov].short}: ${fa(entry.amount)} soldiers reporting for duty!`,'info');
      popup(`✅ ${fa(entry.amount)} troops ready in ${PROVINCES[entry.prov].short}!`,2500);
    }
  }
}


// ── ASSIMILATION ──────────────────────────────────────────
// ── ASSIMILATION ──────────────────────────────────────────
// Rate: instab reduction per week
// Pop loss: total % of pop lost over full 48 weeks (random within range each week)
// Cost formula: paid upfront for chosen N weeks; early weeks more expensive
//   weekCost(w, N) = baseRate * (1 + (N - w) / N * 1.8)  — first weeks ~2.8x last
// Gentle: cheapest; Standard: most expensive total; Harsh ≈ Standard but brutal pop loss
const ASSIM_DEFS = {
  gentle:   {
    label:'🕊 Gentle', icon:'🕊',
    instabRate: 2,
    popLossMin: 0.0,
    popLossMax: 0.015,
    desc:'Slow & humane. Minimal population impact.'
  },
  standard: {
    label:'⚖ Standard', icon:'⚖',
    instabRate: 2.5,
    popLossMin: 0.01,
    popLossMax: 0.05,
    desc:'Balanced. Noticeable but manageable pop decline.'
  },
  harsh: {
    label:'☠ Harsh', icon:'☠',
    instabRate: null,
    popLossMin: 0.05,
    popLossMax: 0.30,
    desc:'Rapid but brutal. Heavy initial pop losses.'
  },
};

// Harsh instab rate per week (decelerating)
function harshRate(weekIdx){ // weekIdx 0-based
  if(weekIdx===0) return 10;
  if(weekIdx===1) return 9.5;
  if(weekIdx===2) return 8;
  if(weekIdx===3) return 6.5;
  return 5;
}

// Upfront cost for N weeks of type
// Weekly cost curve: starts at 5g, divides by 1.05 each week, floors at 2g then slides to 1.75g
// Type multipliers: gentle=1.0 (cheapest), standard=1.7 (most expensive), harsh=1.65
const ASSIM_COST_MULT={gentle:1.0,standard:1.7,harsh:1.65};

// Base curve: week 0 = 5, each week / 1.05, floors at 2.0 then slides to 1.75
// Sum of this curve over 48 weeks ≈ 86 (used as normalizer)
const _ASSIM_BASE_48=(()=>{
  let s=0;
  const startVal=5.0,divRate=1.05,floor=2.0,endVal=1.75,floorReached=Math.ceil(Math.log(startVal/floor)/Math.log(divRate));
  for(let w=0;w<48;w++){
    let v=startVal/Math.pow(divRate,w);
    if(v<=floor){const extra=w-floorReached;v=floor-(floor-endVal)*Math.min(1,extra/Math.max(1,48-floorReached));}
    s+=v;
  }
  return s; // ≈86
})();

function assimWeekCost(weekIdx){ // returns normalised 0..1 weight for this week
  const startVal=5.0,divRate=1.05,floor=2.0,endVal=1.75,floorWeeks=48;
  let val=startVal/Math.pow(divRate,weekIdx);
  if(val<=floor){
    const floorReached=Math.ceil(Math.log(startVal/floor)/Math.log(divRate));
    const extra=weekIdx-floorReached;
    const totalExtra=floorWeeks-floorReached;
    val=floor-(floor-endVal)*Math.min(1,extra/Math.max(1,totalExtra));
  }
  return val/_ASSIM_BASE_48; // normalised weight
}

// pop = province population; type multiplier for gentle/standard/harsh
function assimTotalCost(type, weeks, pop){
  const mult=ASSIM_COST_MULT[type]||1.0;
  const popBase=(pop||10000)/2; // base cost for 48 weeks = pop/2
  // Scale: 48 weeks costs popBase*mult; fewer weeks cost proportionally less (front-loaded)
  let weightSum=0;
  for(let w=0;w<weeks;w++) weightSum+=assimWeekCost(w);
  // Full 48-week weight sum = 1.0 by construction
  return Math.max(1, Math.round(popBase * mult * weightSum));
}

function openAssim(i){
  if(i===undefined||i<0)i=G.sel;
  if(i<0||G.owner[i]!==G.playerNation){popup('Select your territory!');return;}
  const instabVal=Math.round(G.instab[i]||0);
  if(instabVal<=25){popup('Province already stable (instability ≤ 25%).');return;}
  if(G.assimQueue&&G.assimQueue[i]){
    const aq=G.assimQueue[i];
    const def=ASSIM_DEFS[aq.type];
    openMo('🏛 ASSIMILATION IN PROGRESS',
      `<p class="mx"><b>${PROVINCES[i].name}</b> · ${def?.label||''}</p>
       <p class="mx">Instability: <b style="color:#c9a84c">${instabVal}%</b> · Weeks remaining: <b>${aq.weeksLeft}</b></p>
       <p class="mx" style="color:#ff8844;font-size:9px">Cancel to stop (no refund).</p>`,
      [{lbl:'Keep running',cls:'grn'},{lbl:'Cancel assimilation',cls:'red',cb:()=>{G.assimQueue[i]=null;addLog(`🏛 ${PROVINCES[i].short}: assimilation cancelled.`,'info');scheduleDraw();}}]
    );
    return;
  }

  const p=PROVINCES[i];
  const isConquered=p.nation!==G.playerNation;
  const gold=G.gold[G.playerNation];
  const provPop=G.pop[i]||10000;
  const initWeeks=24;
  window._assimProv=i;

  // Three type cards — prices update via slider
  function typeCards(weeks){
    return Object.entries(ASSIM_DEFS).map(([key,def])=>{
      const cost=assimTotalCost(key,weeks,provPop);
      const canAfford=gold>=cost;
      const col=key==='harsh'?'#ff7060':key==='standard'?'#c9a84c':'#80c080';
      const estDrop=key==='harsh'
        ?[10,9.5,8,6.5,...Array(44).fill(5)].slice(0,weeks).reduce((a,b)=>a+b,0)
        :def.instabRate*weeks;
      const instabAfter=Math.max(0,instabVal-estDrop).toFixed(0);
      const popMin=Math.round(def.popLossMin*100);
      const popMax=Math.round(def.popLossMax*100);
      return`<div id="assim_card_${key}" style="flex:1;background:rgba(0,0,0,.3);border:1px solid ${canAfford?col:'#333'};padding:9px 8px;text-align:center;${canAfford?'cursor:pointer':'opacity:.45;cursor:not-allowed'}"
        ${canAfford?`onclick="startAssim(${i},'${key}',document.getElementById('assim-weeks-sl').value|0,${provPop})"`:''}>
        <div style="font-family:Cinzel,serif;font-size:11px;color:${col};margin-bottom:4px">${def.label}</div>
        <div style="font-size:8px;color:var(--dim);margin-bottom:6px;line-height:1.4">${def.desc}</div>
        <div style="font-size:8px;color:#c0c040;margin-bottom:2px">→ ${instabAfter}% instab</div>
        <div style="font-size:8px;color:#ff8844;margin-bottom:6px">pop −${popMin===0?'<1':'~'+popMin}–${popMax}%</div>
        <div style="font-family:Cinzel,serif;font-size:15px;color:${canAfford?col:'#ff4040'}" id="ac_${key}">${fa(cost)}g</div>
      </div>`;
    }).join('');
  }

  openMo('🏛 ASSIMILATION',
    `<p class="mx"><b>${p.name}${p.isCapital?' ★':''}</b>${isConquered?' · <span style="color:#ff8844">Foreign province</span>':''}</p>
     <p class="mx">Instability: <b style="color:${instabVal>60?'#ff6040':instabVal>40?'#e08030':'#c0c040'}">${instabVal}%</b> · Pop: <b>${fm(provPop)}</b> · Treasury: <b>${fa(gold)}g</b></p>
     <div style="display:flex;align-items:center;gap:10px;padding:9px 12px;background:rgba(0,0,0,.25);border:1px solid var(--border2);margin-bottom:10px">
       <span style="font-size:9px;color:var(--dim);flex-shrink:0">Duration</span>
       <input type="range" id="assim-weeks-sl" min="1" max="48" value="${initWeeks}" style="flex:1"
         oninput="(function(w){
           document.getElementById('assim-weeks-val').textContent=w+'w';
           Object.keys(ASSIM_DEFS).forEach(function(k){
             var el=document.getElementById('ac_'+k);
             if(el)el.textContent=fa(assimTotalCost(k,w,${provPop}))+'g';
           });
         })(+this.value)">
       <span style="font-family:Cinzel,serif;font-size:14px;color:var(--gold);min-width:34px;text-align:right" id="assim-weeks-val">${initWeeks}w</span>
     </div>
     <p class="mx" style="font-size:9px;color:var(--dim);margin-bottom:8px">Cost paid upfront. Early weeks cost more. Click a method to confirm.</p>
     <div style="display:flex;gap:6px">${typeCards(initWeeks)}</div>`,
    [{lbl:'Cancel',cls:'dim'}]
  );
}

window.startAssim=function(i,type,weeks,pop){
  closeMo();
  if(!G.assimQueue)G.assimQueue=PROVINCES.map(()=>null);
  const def=ASSIM_DEFS[type];if(!def)return;
  weeks=Math.max(1,Math.min(48,weeks||24));
  const provPop=pop||G.pop[i]||10000;
  const cost=assimTotalCost(type,weeks,provPop);
  if(G.gold[G.playerNation]<cost){popup('Insufficient gold!');return;}
  G.gold[G.playerNation]-=cost;
  const popFloor=Math.floor(G.pop[i]*0.28);
  G.assimQueue[i]={type,weeksLeft:weeks,totalWeeks:weeks,popFloor,weekIdx:0};
  addLog(`🏛 ${PROVINCES[i].short}: ${def.label} assimilation (${weeks}w, ${fa(cost)}g).`,'info');
  popup(`🏛 Assimilation started — ${fa(cost)}g paid upfront`);
  scheduleDraw();updateHUD();if(G.sel>=0)updateSP(G.sel);
};

// processAssimCosts is now a no-op (cost paid upfront)
function processAssimCosts(){ /* paid upfront */ }

// ── ECONOMY ───────────────────────────────────────────────
// Max tax rate per ideology
const TAX_MAX={
  nazism:90, fascism:80, stalinism:85, communism:75,
  militarism:70, nationalism:65, monarchy:60,
  socialdem:55, democracy:50, liberalism:45,
};

function taxMax(){ return TAX_MAX[G.ideology]||60; }

function openEconomy(){
  const PN=G.playerNation;
  const io=ideol();
  const mr=regsOf(PN);
  const avgSat=mr.length?Math.round(mr.reduce((s,r)=>s+(G.satisfaction[r]??70),0)/mr.length):70;
  const curTax=G.taxRate??25;
  const maxTax=taxMax();
  const curInc=mr.reduce((s,r)=>{
    let inc=G.income[r];
    if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);
    if((G.buildings[r]||[]).includes('palace'))inc=Math.floor(inc*1.15);
    const taxFactor=0.4+(curTax/100)*2.4;
    return s+Math.floor(inc*io.income*taxFactor);
  },0);

  // Tax mood description
  const taxLabel=curTax<=10?'🟢 Very Low':curTax<=25?'🟢 Low':curTax<=40?'🟡 Moderate':curTax<=60?'🟠 High':curTax<=80?'🔴 Very High':'💀 Extreme';
  const satEffect=curTax<=10?'+15% sat':curTax<=25?'+5% sat':curTax<=40?'neutral':curTax<=60?'−10% sat':curTax<=80?'−25% sat':'−40% sat';

  // Appease cost: 50g per province, boosts satisfaction by 5-12
  const appeaseCost=Math.max(50,mr.length*20);

  const html=`
    <p class="mx" style="margin-bottom:10px">Manage your empire's economy. Tax rates affect both income and popular opinion.</p>

    <div style="background:rgba(201,168,76,.05);border:1px solid var(--border2);padding:12px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-family:Cinzel,serif;font-size:11px;color:var(--gold)">TAX RATE</span>
        <span style="font-size:10px;color:var(--dim)">${io.icon} Max: <b style="color:var(--gold)">${maxTax}%</b></span>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <input type="range" id="tax-sl" min="0" max="${maxTax}" value="${curTax}" oninput="updTaxPreview()" style="flex:1">
        <span style="font-family:Cinzel,serif;font-size:16px;color:var(--gold);min-width:42px;text-align:right" id="tax-val">${curTax}%</span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--dim);margin-bottom:8px">
        <span>Current: <b style="color:var(--gold)">${taxLabel}</b></span>
        <span>Pop mood: <b id="tax-mood-lbl" style="color:var(--gold)">${satEffect}</b></span>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--dim);margin-bottom:10px">
        <span>Est. monthly income: <b id="tax-inc-preview" style="color:var(--gold)">${fa(curInc)}g</b></span>
        <span>Avg. satisfaction: <b style="color:${avgSat<40?'#ff6040':avgSat<60?'#c08020':'#40c040'}">${avgSat}%</b></span>
      </div>
      <button class="btn grn" style="width:100%;padding:8px" onclick="applyTaxRate()">✓ Apply Tax Rate</button>
    </div>

    <div style="background:rgba(100,50,200,.05);border:1px solid rgba(100,50,200,.3);padding:12px">
      <div style="font-family:Cinzel,serif;font-size:11px;color:#b090ff;margin-bottom:6px">🎁 APPEASE POPULATION</div>
      <p class="mx" style="font-size:9px;margin-bottom:8px">Distribute bread, gold, and entertainment to raise satisfaction across all provinces. One-time effect.</p>
      <div style="display:flex;gap:6px">
        <button class="btn" style="flex:1;padding:8px;border-color:rgba(100,50,200,.5);color:#b090ff" onclick="appeasePop(100,'small')">🍞 Small<br><span style="font-size:8px;color:var(--dim)">${fa(appeaseCost/2)}g · +${ri(3,6)}% sat</span></button>
        <button class="btn" style="flex:1;padding:8px;border-color:rgba(100,50,200,.5);color:#b090ff" onclick="appeasePop(100,'medium')">🎪 Festival<br><span style="font-size:8px;color:var(--dim)">${fa(appeaseCost)}g · +${ri(6,12)}% sat</span></button>
        <button class="btn" style="flex:1;padding:8px;border-color:rgba(100,50,200,.5);color:#b090ff" onclick="appeasePop(100,'grand')">👑 Grand<br><span style="font-size:8px;color:var(--dim)">${fa(appeaseCost*2)}g · +${ri(12,20)}% sat</span></button>
      </div>
    </div>
  `;
  openMo('💰 ECONOMY & TAXATION', html, [{lbl:'Close',cls:'dim'}]);
  // store for preview
  window._econMr=mr;
  window._econIo=io;
}

window.updTaxPreview=function(){
  const sl=document.getElementById('tax-sl');
  const val=parseInt(sl.value);
  document.getElementById('tax-val').textContent=val+'%';
  const mr=window._econMr||[];
  const io=window._econIo||ideol();
  const taxFactor=0.4+(val/100)*2.4;
  const est=mr.reduce((s,r)=>{
    let inc=G.income[r];
    if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);
    if((G.buildings[r]||[]).includes('palace'))inc=Math.floor(inc*1.15);
    return s+Math.floor(inc*io.income*taxFactor);
  },0);
  const incEl=document.getElementById('tax-inc-preview');
  if(incEl)incEl.textContent=fa(est)+'g';
  const moodEl=document.getElementById('tax-mood-lbl');
  if(moodEl){
    const lbl=val<=10?'+15% sat':val<=25?'+5% sat':val<=40?'neutral':val<=60?'−10% sat':val<=80?'−25% sat':'−40% sat';
    const col=val<=25?'#40c040':val<=40?'var(--gold)':val<=60?'#c08020':val<=80?'#c04020':'#ff2020';
    moodEl.textContent=lbl;moodEl.style.color=col;
  }
};

window.applyTaxRate=function(){
  const sl=document.getElementById('tax-sl');
  if(!sl)return;
  const newTax=parseInt(sl.value);
  const oldTax=G.taxRate??25;
  const diff=newTax-oldTax;
  if(diff===0){popup('Tax rate unchanged.');return;}
  G.taxRate=newTax;
  // Apply taxMood shock proportional to change
  // Big increase → big negative shock; decrease → positive shock
  const shock=diff*1.2; // each % point of change = 1.2 taxMood points
  const PN=G.playerNation;
  if(!G.taxMood) G.taxMood=PROVINCES.map(()=>0);
  regsOf(PN).forEach(r=>{
    G.taxMood[r]=(G.taxMood[r]||0)-shock; // negative = sad about taxes
  });
  closeMo();
  const dir=diff>0?'▲':'▼';
  const col=diff>0?'#ff8040':'#40e060';
  addLog(`💰 Tax rate ${dir} ${oldTax}% → <b style="color:${col}">${newTax}%</b>. Population reacts…`,'event');
  popup(`Tax rate set to ${newTax}%`);
  updateHUD();scheduleDraw();
};

window.appeasePop=function(cost, scale){
  const PN=G.playerNation;
  const mr=regsOf(PN);
  const costs={small:Math.max(50,mr.length*10),medium:Math.max(100,mr.length*20),grand:Math.max(200,mr.length*40)};
  const boosts={small:[4,8],medium:[8,15],grand:[14,22]};
  const realCost=costs[scale]||costs.medium;
  if(G.gold[PN]<realCost){popup(`Not enough gold! Need ${fa(realCost)}g`);return;}
  G.gold[PN]-=realCost;
  const [minB,maxB]=boosts[scale]||boosts.medium;
  mr.forEach(r=>{
    const boost=ri(minB,maxB);
    G.satisfaction[r]=Math.min(100,G.satisfaction[r]+boost);
    // Positive taxMood boost too
    if(G.taxMood) G.taxMood[r]=(G.taxMood[r]||0)+boost*0.5;
  });
  closeMo();
  const icons={small:'🍞',medium:'🎪',grand:'👑'};
  const avgBoost=Math.round((minB+maxB)/2);
  addLog(`${icons[scale]} ${scale.charAt(0).toUpperCase()+scale.slice(1)} appeasement: −${fa(realCost)}g, avg +${avgBoost}% satisfaction.`,'event');
  popup(`${icons[scale]} People rejoice! +${avgBoost}% satisfaction`);
  updateHUD();scheduleDraw();
};


// ── BUILD ─────────────────────────────────────────────────
// Base build turns per building type (modified by satisfaction)
const BUILD_TURNS={factory:3,fortress:3,barracks:2,port:2,hospital:2,oilwell:2,mine:2,granary:1,palace:4,academy:4,arsenal:3};

function buildTurns(r, key){
  // Low satisfaction = longer construction
  // satisfaction >70: normal; 40-70: +50%; <40: doubled or worse
  const sat=G.satisfaction[r]??70;
  const base=BUILD_TURNS[key]||2;
  let mult=1;
  if(sat<40) mult=2.0+Math.floor((40-sat)/10)*0.5; // 2x at 40%, up to ~4x at 10%
  else if(sat<70) mult=1.0+(70-sat)/60;             // 1x→1.5x
  return Math.max(1,Math.round(base*mult));
}

function openBuild(){
  const si=G.sel;
  if(si<0||G.owner[si]!==G.playerNation){popup('Select your territory!');return;}
  // Check if construction already queued here
  if(G.construction[si]){
    const c=G.construction[si];
    const b=BUILDINGS[c.building];
    openModal('Construction in Progress',
      `<p class="mx">Building <b>${b?.icon} ${b?.name}</b> in <b>${PROVINCES[si].name}</b></p>
       <div style="margin:10px 0">
         <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--dim);margin-bottom:4px"><span>Progress</span><span>${c.totalTurns-c.turnsLeft}/${c.totalTurns} months</span></div>
         <div style="height:6px;background:rgba(255,255,255,.06);border-radius:3px;overflow:hidden"><div style="height:100%;background:var(--gold);border-radius:3px;width:${Math.round((c.totalTurns-c.turnsLeft)/c.totalTurns*100)}%;transition:width .3s"></div></div>
       </div>
       <p class="mx" style="font-size:9px;color:var(--dim)">Completes in <b>${c.turnsLeft}</b> more month${c.turnsLeft!==1?'s':''}.</p>`,
      `<button class="btn red" onclick="cancelConstruction(${si})">✕ Cancel (lose 50% gold)</button>
       <button class="btn dim" onclick="closeModal()">Close</button>`
    );
    return;
  }
  const p=PROVINCES[si],io=ideol(),cm=io.buildCostMod||1;
  const maxBld=p.isCapital?MAX_BLD_CAP:MAX_BLD_NORM,ex=G.buildings[si]||[];
  if(ex.length>=maxBld){popup(`Building limit (${maxBld}) reached!`);return;}
  const sat=G.satisfaction[si]??70;
  const satNote=sat<40
    ?`<p class="mx warn">⚠ Low satisfaction (${Math.round(sat)}%) — construction takes <b>longer</b> and costs more.</p>`
    :sat<70
    ?`<p class="mx" style="font-size:9px;color:#c08030">⚠ Satisfaction ${Math.round(sat)}% — mild construction delays.</p>`:'';
  const opts=Object.entries(BUILDINGS).filter(([k,b])=>!ex.includes(k)&&(!b.capitalOnly||p.isCapital)&&(!b.needsCoast||p.isCoastal)&&(!b.needsRes||(G.resBase[si][b.needsRes]||0)>0));
  const html=`<p class="mx">Build in <b>${p.name}</b>${p.isCapital?' ★':''} · Slots: <b>${ex.length}/${maxBld}</b> · Gold: <b>${fa(G.gold[G.playerNation])}</b></p>
  ${satNote}
  <div class="tlist">${opts.map(([k,b])=>{
    const cost=Math.round(b.cost*cm*(sat<40?1+(40-sat)/50:1)); // cost penalty when unhappy
    const turns=buildTurns(si,k);
    const ok=G.gold[G.playerNation]>=cost;
    return`<div class="ti${ok?'':' ene'}" onclick="${ok?`queueBuild('${k}',${si})`:''}" ${ok?'':'style="cursor:not-allowed"'}>
      <span class="tn">${b.name}</span>
      <span class="ta">${b.desc}<br>
        <span style="color:${ok?'#c8a030':'#555'}">${fa(cost)}g</span>
        <span style="color:#8090a0;margin-left:4px">⏳${turns}mo</span>
      </span>
    </div>`;
  }).join('')}</div>`;
  openModal('CONSTRUCTION',html,'<button class="btn dim" onclick="closeModal()">Cancel</button>');
}

window.queueBuild=function(k,ri2){
  closeModal();
  const io=ideol();
  const sat=G.satisfaction[ri2]??70;
  const cm=io.buildCostMod||1;
  const cost=Math.round(BUILDINGS[k].cost*cm*(sat<40?1+(40-sat)/50:1));
  if(G.gold[G.playerNation]<cost){popup('Insufficient gold!');return;}
  G.gold[G.playerNation]-=cost;
  const turns=buildTurns(ri2,k);
  G.construction[ri2]={building:k,turnsLeft:turns,totalTurns:turns,cost};
  scheduleDraw();updateHUD();if(G.sel===ri2)updateSP(ri2);
  addLog(`🏗 ${PROVINCES[ri2].short}: ${BUILDINGS[k].name} construction started (${turns}mo).`,'build');
  popup(`✓ Building ${BUILDINGS[k].name} — completes in ${turns} months`);
};

// Keep old doB as alias for compatibility
function doB(k,ri2){window.queueBuild(k,ri2);}

window.cancelConstruction=function(ri2){
  const c=G.construction[ri2];if(!c)return;
  const refund=Math.floor(c.cost*.5);
  G.gold[G.playerNation]+=refund;
  G.construction[ri2]=null;
  closeModal();
  scheduleDraw();updateHUD();if(G.sel===ri2)updateSP(ri2);
  addLog(`🏗 ${PROVINCES[ri2].short}: construction cancelled (+${refund}g refund).`,'build');
  popup(`Construction cancelled — ${fa(refund)}g refunded`);
};

function processConstruction(){
  const PN=G.playerNation;
  regsOf(PN).forEach(r=>{
    const c=G.construction[r];if(!c)return;
    c.turnsLeft--;
    if(c.turnsLeft<=0){
      (G.buildings[r]=G.buildings[r]||[]).push(c.building);
      G.construction[r]=null;
      addLog(`✅ ${PROVINCES[r].short}: ${BUILDINGS[c.building]?.name} completed!`,'build');
      popup(`✅ ${BUILDINGS[c.building]?.name} built in ${PROVINCES[r].short}!`,3000);
      if(G.sel===r)updateSP(r);
    }
  });
}

// ── LOANS ─────────────────────────────────────────────────
function openLoan(){
  const existing=G.loans.length;
  const debt=G.loans.reduce((s,l)=>s+l.amount,0);
  const opts=[
    {amt:500, monthly:30, months:18},
    {amt:1000,monthly:55, months:20},
    {amt:2000,monthly:100,months:22},
  ];
  const html=`<p class="mx">Borrow from the <b>World Bank</b>. Monthly repayment deducted automatically.</p>
  <p class="mx">Current debt: <b style="color:${debt>0?'#ff8844':'#60cc50'}">${fa(debt)} gold</b> · Active loans: <b>${existing}</b></p>
  <div class="tlist">${opts.map(o=>`<div class="ti grn" onclick="takeLoan(${o.amt},${o.monthly},${o.months})"><span class="tn">🏦 ${fa(o.amt)} gold</span><span class="ta">${fa(o.monthly)}/mo × ${o.months}mo<br>Total: ${fa(o.monthly*o.months)}</span></div>`).join('')}</div>
  <p class="mx" style="font-size:9px;color:var(--dim)">Failure to pay → instability rises in all territories.</p>`;
  openMo('WORLD BANK — LOAN',html,[{lbl:'Close',cls:'dim'}]);
}
function takeLoan(amount,monthly,months){
  closeMo();
  G.gold[G.playerNation]+=amount;
  G.loans.push({amount,monthly,monthsLeft:months,origMonths:months});
  addLog(`🏦 Loan: +${fa(amount)} gold. Repay ${fa(monthly)}/mo × ${months}mo.`,'loan');
  popup(`✓ ${fa(amount)} gold received. Monthly: ${fa(monthly)}/mo`);
  updateHUD();
}
function processLoans(){
  let paid=0;
  G.loans=G.loans.filter(loan=>{
    const pay=Math.min(loan.monthly,G.gold[G.playerNation]);
    G.gold[G.playerNation]-=pay;loan.amount-=pay;loan.monthsLeft--;paid+=pay;
    if(pay<loan.monthly){
      // Can't pay — instability
      regsOf(G.playerNation).forEach(r=>G.instab[r]=Math.min(100,G.instab[r]+ri(2,6)));
      addLog(`🏦 Loan default! +instability.`,'revolt');
    }
    return loan.amount>0&&loan.monthsLeft>0;
  });
}

// ── RESOURCES ─────────────────────────────────────────────
function gatherResources(){
  // Reset pool
  G.resPool={oil:0,coal:0,grain:0,steel:0};
  regsOf(G.playerNation).forEach(i=>{
    const base=G.resBase[i]||{};
    const blds=G.buildings[i]||[];
    let mult=1;
    if(blds.includes('oilwell'))base.oil=(base.oil||0)+2;
    if(blds.includes('mine')){base.coal=(base.coal||0)+2;base.steel=(base.steel||0)+1;}
    if(blds.includes('granary')){base.grain=(base.grain||0)+2;}
    Object.keys(base).forEach(k=>{if(G.resPool[k]!==undefined)G.resPool[k]+=base[k]*mult;});
  });
  // Resource effects — silent (no log spam)
  const PN=G.playerNation;
  if(G.resPool.coal<5){
    G.gold[PN]=Math.max(0,G.gold[PN]-ri(20,50));
  }
  if(G.resPool.grain<8){
    regsOf(PN).forEach(r=>G.instab[r]=Math.min(100,G.instab[r]+ri(0,2)));
  }
  if(G.resPool.grain>20){
    regsOf(PN).forEach(r=>G.pop[r]+=Math.floor(G.pop[r]*.002));
  }
}

// ── RESISTANCE SYSTEM ─────────────────────────────────────
function openSponsor(){
  // Sponsor resistance in enemy provinces, OR
  // show own occupied territories' resistance status
  const PN=G.playerNation;
  const enemyOccupied=PROVINCES.map((_,i)=>i).filter(i=>{
    return G.owner[i]!==PN&&G.owner[i]>=0&&
      NB[i].some(nb=>G.owner[nb]===PN); // adjacent to player
  });
  const playerOccupied=PROVINCES.map((_,i)=>i).filter(i=>G.owner[i]===PN&&G.resistance[i]>10);

  let html=`<p class="mx">Spend gold to fund partisans in enemy territory, raising their instability.</p>`;
  if(enemyOccupied.length){
    html+=`<p class="mx" style="color:var(--gold)">Sponsor in enemy territory (100g each):</p><div class="tlist">${enemyOccupied.slice(0,12).map(i=>`<div class="ti ene" onclick="doSponsor(${i})"><span class="tn">${PROVINCES[i].name}</span><span class="ta">⚡${Math.round(G.instab[i])}% instab<br>🔥${Math.round(G.resistance[i])}% resist</span></div>`).join('')}</div>`;
  }
  if(playerOccupied.length){
    html+=`<p class="mx" style="color:#ff8844">Active resistance in your territories:</p><div class="tlist">${playerOccupied.map(i=>`<div class="ti"><span class="tn">${PROVINCES[i].name}</span><span class="ta">🔥${Math.round(G.resistance[i])}% resist<br>Suppressing: 200g</span><button class="btn" style="padding:3px 7px;font-size:8px" onclick="suppressResist(${i})">Suppress</button></div>`).join('')}</div>`;
  }
  if(!enemyOccupied.length&&!playerOccupied.length)html+='<p class="mx" style="color:var(--dim)">No viable targets nearby.</p>';
  openMo('RESISTANCE OPERATIONS',html,[{lbl:'Close',cls:'dim'}]);
}
function doSponsor(i){
  closeMo();
  if(G.gold[G.playerNation]<100){popup('Need 100 gold!');return;}
  G.gold[G.playerNation]-=100;
  const boost=ri(15,35);
  G.resistance[i]=Math.min(100,G.resistance[i]+boost);
  G.instab[i]=Math.min(100,G.instab[i]+ri(10,25));
  G.resistSponsor[i]=G.playerNation;
  addLog(`🔥 Resistance sponsored in ${PROVINCES[i].name}: +${boost}%.`,'resist');
  popup(`🔥 Partisans active in ${PROVINCES[i].name}!`);
  scheduleDraw();updateHUD();
}
function suppressResist(i){
  closeMo();
  if(G.gold[G.playerNation]<200){popup('Need 200 gold!');return;}
  G.gold[G.playerNation]-=200;
  const red=ri(30,60);
  G.resistance[i]=Math.max(0,G.resistance[i]-red);
  G.instab[i]=Math.max(0,G.instab[i]-ri(10,20));
  addLog(`${PROVINCES[i].name}: resistance suppressed (-${red}%).`,'info');
  popup(`Resistance suppressed in ${PROVINCES[i].name}`);
  scheduleDraw();
}
function processResistance(){
  // Player-owned territories with resistance
  regsOf(G.playerNation).forEach(i=>{
    if(G.resistance[i]<=0)return;
    // Milder instab from resistance: /20 instead of /10
    G.instab[i]=Math.min(100,G.instab[i]+Math.floor(G.resistance[i]/20));
    G.resistance[i]=Math.max(0,G.resistance[i]-ri(3,7)); // slightly faster decay
    if(G.resistance[i]>80&&Math.random()<.10){ // higher threshold, lower chance
      G.army[i]=Math.max(0,G.army[i]-ri(100,400));
      addLog(`🔥 Partisan attack in ${PROVINCES[i].name}!`,'resist');
    }
  });
  // AI sponsors resistance — reduced frequency
  aliveNations().forEach(ai=>{
    const lost=PROVINCES.map((_,i)=>i).filter(i=>G.owner[i]===G.playerNation&&PROVINCES[i].nation===ai);
    lost.forEach(i=>{
      if(Math.random()<.04&&G.gold[ai]>=80){ // was 0.08
        G.gold[ai]-=80;
        G.resistance[i]=Math.min(100,G.resistance[i]+ri(3,12)); // was 5-20
      }
    });
  });
}


// ── ATTACK / BATTLE ───────────────────────────────────────
// ── ATTACK SOURCE SELECTION ───────────────────────────────
// When player clicks Attack, if multiple border provinces → highlight them for selection
let _atkSelectMode = false;
let _atkTarget = -1;

function cancelAtkSelect(){
  _atkSelectMode = false;
  _atkTarget = -1;
  const mb=document.getElementById('move-banner');
  if(mb){mb.style.display='none';mb.className='';}
  scheduleDraw();
}

// Highlight attack sources on map (reuse move highlight color but red)
function isAtkSrc(i){
  return _atkSelectMode && _atkTarget>=0 && G.owner[i]===G.playerNation && G.army[i]>100 && NB[i]?.includes(_atkTarget);
}

function openAttack(){
  if(inPeacePeriod()){popup(`Peace period — ${peaceTurnsLeft()} weeks remaining`);return;}
  const si=G.sel;
  if(si<0||G.owner[si]===G.playerNation){popup('Select an enemy territory!');return;}
  const PN=G.playerNation;
  const sources=regsOf(PN).filter(r=>G.army[r]>100&&NB[r]?.includes(si));
  if(!sources.length){popup('No army on the border!');return;}

  if(sources.length===1){
    // Only one border province — go straight to attack dialog
    window._af=sources[0];window._at=si;
    showAttackDialog(sources[0],si);
  } else {
    // Multiple border provinces → switch to selection mode
    _atkSelectMode=true;
    _atkTarget=si;
    hideProvPopup();
    const mb=document.getElementById('move-banner');
    if(mb){mb.style.display='block';mb.className='';mb.style.cssText='display:block;background:rgba(80,10,10,.88);border-color:rgba(255,80,80,.5);color:#ff8080;'+mb.style.cssText.replace(/display:[^;]+;/,'');}
    if(mb)mb.textContent=`⚔ Choose attack province (${sources.length} available) — Esc to cancel`;
    scheduleDraw();
    popup(`${sources.length} border provinces — click one to attack from`);
  }
}

function showAttackDialog(fr,to){
  window._af=fr;window._at=to;
  const en=G.owner[to],PN=G.playerNation;
  const hasPact=en>=0&&G.pact[PN][en],hasAlly=en>=0&&areAllies(PN,en);
  const hasFort=(G.buildings[to]||[]).includes('fortress');
  const io=ideol(),terrain=TERRAIN[PROVINCES[to].terrain||'plains'];
  const defBonus=terrain.defB*(hasFort?1.6:1),effDef=Math.round(G.army[to]*defBonus);
  const resist=G.resistance[to];
  const avail=availableArmy(fr);
  let html='';
  if(hasPact)html+=`<p class="mx" style="color:#e07030">⚠ This will break your non-aggression pact!</p>`;
  if(hasAlly)html+=`<p class="mx" style="color:#ff6040">⚠ ${NATIONS[en]&&NATIONS[en].short} is your ALLY!</p>`;
  if(hasFort)html+=`<p class="mx" style="color:#c09040">🏰 Fortress: defense ×1.6</p>`;
  if(resist>20)html+=`<p class="mx" style="color:#ff9040">🔥 Resistance bonus</p>`;
  html+=`<p class="mx">${io.icon} ${io.name}: atk ×${io.atk.toFixed(2)} · ${terrain.name} def ×${terrain.defB.toFixed(1)}</p>`;
  html+=`<p class="mx"><b>${PROVINCES[fr].short}</b> → <b style="color:#ff7070">${PROVINCES[to].name}</b></p>`;
  html+=`<p class="mx">Available: <b>${fa(avail)}</b> · Enemy effective: <b style="color:#ff7070">${fa(effDef)}</b></p>`;
  if(avail>0){
    html+=`<div class="slider-w"><div class="slider-l"><span>Force to commit</span><span class="slider-v" id="asv">${fa(avail)}</span></div><input type="range" id="asl" min="1" max="${avail}" value="${avail}" oninput="updSl('asl','asv')"></div>`;
    html+=`<p class="mx" style="font-size:9px;color:var(--dim)">Remaining troops stay — you can order more attacks this turn.</p>`;
  } else {
    html+=`<p class="mx" style="color:#ff6040">⚠ All troops already committed to other orders!</p>`;
  }
  const canFight=avail>0;
  const btns=hasPact||hasAlly
    ?[{lbl:'Cancel',cls:'dim'},{lbl:'Break & Queue Attack',cls:'red',cb:()=>canFight&&launchAtk(true)}]
    :[{lbl:'Cancel',cls:'dim'},{lbl:'⚔ Queue Attack',cls:'red',cb:()=>canFight&&launchAtk(false)}];
  openMo('QUEUE ATTACK',html,btns);
  setTimeout(()=>document.getElementById('asl')&&document.getElementById('asl').style.setProperty('--pct','100%'),40);
}
function launchAtk(breakDiplo){
  const fr=window._af,to=window._at,force=+(document.getElementById('asl')?.value||G.army[fr]);
  const en=G.owner[to],PN=G.playerNation;
  if(breakDiplo&&en>=0){
    G.pact[PN][en]=G.pact[en][PN]=false;G.pLeft[PN][en]=G.pLeft[en][PN]=0;
    // Break alliance if applicable
    const ai=G.allianceOf[PN];
    if(ai>=0&&G.alliance[ai]?.members.includes(en)){
      G.alliance[ai].members=G.alliance[ai].members.filter(m=>m!==PN);
      G.allianceOf[PN]=-1;
      addLog(`Alliance broken: attacked ally ${ownerName(en)}!`,'diplo');
    }
  }
  if(en>=0)G.war[PN][en]=G.war[en][PN]=true;
  // Allied nations join the war
  const enAlly=G.allianceOf[en];
  if(enAlly>=0){
    G.alliance[enAlly].members.filter(m=>m!==en&&m!==PN).forEach(m=>{
      G.war[PN][m]=G.war[m][PN]=true;
      addLog(`${ownerName(m)} joined the war as ally of ${ownerName(en)}!`,'war');
    });
  }
  addLog(`⚔ Attack on ${PROVINCES[to].name}!`,'war');
  runBattle(fr,to,force,PN,()=>{scheduleDraw();updateHUD();if(G.sel>=0)updateSP(G.sel);chkBtns();chkVic();});
}

function launchAtk(breakDiplo){
  const fr=window._af,to=window._at;
  const force=+(document.getElementById('asl')&&document.getElementById('asl').value||availableArmy(fr));
  const avail=availableArmy(fr);
  if(force<=0||force>avail){popup(`Only ${fa(avail)} available!`);return;}
  const en=G.owner[to],PN=G.playerNation;
  if(breakDiplo&&en>=0){
    G.pact[PN][en]=G.pact[en][PN]=false;G.pLeft[PN][en]=G.pLeft[en][PN]=0;
    const ai=G.allianceOf[PN];
    if(ai>=0&&G.alliance[ai]&&G.alliance[ai].members.includes(en)){
      G.alliance[ai].members=G.alliance[ai].members.filter(m=>m!==PN);
      G.allianceOf[PN]=-1;
      addLog(`Alliance broken: attacked ally ${ownerName(en)}!`,'diplo');
    }
  }
  if(en>=0)G.war[PN][en]=G.war[en][PN]=true;
  const enAlly=G.allianceOf[en];
  if(enAlly>=0){
    G.alliance[enAlly].members.filter(m=>m!==en&&m!==PN).forEach(m=>{
      G.war[PN][m]=G.war[m][PN]=true;
      addLog(`${ownerName(m)} joined the war as ally of ${ownerName(en)}!`,'war');
    });
  }
  // Queue — allow MULTIPLE attacks from same province (don't filter by fr)
  if(!G.battleQueue)G.battleQueue=[];
  G.battleQueue.push({fr,to,force});
  const remaining=availableArmy(fr);
  addLog(`⚔ Attack queued: ${PROVINCES[fr].short} → ${PROVINCES[to].name} (${fa(force)} troops). ${fa(remaining)} remain.`,'war');
  popup(`⚔ Attack queued — ${fa(remaining)} still available in ${PROVINCES[fr].short}`);
  closeMo();
  scheduleDraw();updateHUD();if(G.sel>=0)updateSP(G.sel);chkBtns();
}

// ── FAST MODE ─────────────────────────────────────────────
// When active: battle/move overlays skip instantly, no zoom animation
let _fastMode = false;
function toggleFastMode(){
  _fastMode = !_fastMode;
  const btn = document.getElementById('fast-mode-btn');
  if(btn){
    btn.style.color = _fastMode ? 'var(--gold)' : 'var(--dim)';
    btn.style.borderColor = _fastMode ? 'var(--gold)' : 'var(--border)';
    btn.title = _fastMode ? 'Fast mode ON — click to disable' : 'Fast mode — skip battle animations';
  }
  popup(_fastMode ? '▶▶ Fast mode ON' : '▶ Normal mode', 1500);
}
// Called from endTurn — runs all queued player battles in sequence with animation
function executeMoveQueue(){
  if(!G.moveQueue||!G.moveQueue.length) return;
  const queue=[...G.moveQueue];
  G.moveQueue=[];
  const s=season();
  for(const {from,to,amount} of queue){
    if(G.owner[from]!==G.playerNation) continue; // lost province
    const actual=Math.min(amount, G.army[from]);
    if(actual<=0) continue;
    const terrMod=s.winterTerrain&&s.winterTerrain.includes(PROVINCES[to]&&PROVINCES[to].terrain)?s.moveMod:1.0;
    const moved=Math.round(actual*terrMod);
    G.army[from]=Math.max(0,G.army[from]-actual);
    G.army[to]=(G.army[to]||0)+moved;
    if(moved<actual) addLog(`${s.icon} Winter: ${fa(actual-moved)} lost to cold!`,'season');
    if(G.owner[to]<0) G.owner[to]=G.playerNation; // claim independent
    addLog(`🚶 ${fa(moved)} moved: ${PROVINCES[from].short} → ${PROVINCES[to]&&PROVINCES[to].short||'?'}.`,'move');
  }
}

function _restoreVP(){
  if(!window._preBattleVP)return;
  const saved=window._preBattleVP;
  window._preBattleVP=null;
  const startScale=vp.scale,startTx=vp.tx,startTy=vp.ty;
  const ANIM_MS=500;const startT=performance.now();
  function easeInOut(t){return t<0.5?2*t*t:1-Math.pow(-2*t+2,2)/2;}
  function frame(now){
    const t=easeInOut(Math.min((now-startT)/ANIM_MS,1));
    vp.scale=startScale+(saved.scale-startScale)*t;
    vp.tx=startTx+(saved.tx-startTx)*t;
    vp.ty=startTy+(saved.ty-startTy)*t;
    scheduleDraw();
    if(t<1)requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Approximate enemy force display (fog of war)
function approxForce(real){
  // Round to nearest "nice" number to simulate intel uncertainty
  if(real<50) return real;
  const magnitude=Math.pow(10,Math.floor(Math.log10(real)));
  const factor=magnitude>=1000?500:magnitude>=100?50:10;
  const base=Math.round(real/factor)*factor;
  // Add small random offset ±15%
  const jitter=Math.round((rf(-0.12,0.12)*real)/factor)*factor;
  return Math.max(factor,base+jitter);
}

function executeBattleQueue(onAllDone){
  const playerQueue=G.battleQueue&&G.battleQueue.length?[...G.battleQueue]:[];
  G.battleQueue=[];
  const enemyQueue=G._enemyAttackQueue&&G._enemyAttackQueue.length?[...G._enemyAttackQueue]:[];
  G._enemyAttackQueue=[];

  if(!playerQueue.length&&!enemyQueue.length){onAllDone();return;}

  // Save viewport before any battle animations
  window._preBattleVP={scale:vp.scale,tx:vp.tx,ty:vp.ty};

  let pidx=0;

  function runPlayerNext(){
    if(pidx>=playerQueue.length){
      // Done with player battles — show enemy attacks
      runEnemyQueue(onAllDone);
      return;
    }
    const {fr,to,force}=playerQueue[pidx++];
    if(G.owner[fr]!==G.playerNation){runPlayerNext();return;}
    if(G.owner[to]===G.playerNation){runPlayerNext();return;}
    const actualForce=Math.min(force,G.army[fr]);
    if(actualForce<1){runPlayerNext();return;}
    runBattle(fr,to,actualForce,G.playerNation,()=>{
      scheduleDraw();updateHUD();chkVic();
      setTimeout(runPlayerNext,400);
    });
  }

  function runEnemyQueue(done){
    if(!enemyQueue.length){
      _restoreVP();
      done();
      return;
    }
    let eidx=0;
    function showNext(){
      if(eidx>=enemyQueue.length){_restoreVP();done();return;}
      const ev=enemyQueue[eidx++];
      showEnemyAttackOverlay(ev,()=>setTimeout(showNext,300));
    }
    showNext();
  }

  runPlayerNext();
}

// Skip current battle animation — called when player clicks battle card
window.skipBattleAnim=function(){
  if(window._battleSkipFn) window._battleSkipFn();
};

function runBattle(fr,to,atkF,atker,done){
  const df=G.army[to],isP=atker===G.playerNation;
  const io2=isP?ideol():IDEOLOGIES[NATIONS[atker]?.ideology||'nationalism'];
  const terrain=TERRAIN[PROVINCES[to].terrain||'plains'];
  const hasFort=(G.buildings[to]||[]).includes('fortress');
  const defM=provDefB(to, fr)*(hasFort?1.6:1);
  const instPen=isP?Math.max(.7,1-G.instab[fr]/150):1.0;
  const capPen=G.capitalPenalty[atker]>0?.85:1.0;
  const hasArsenal=(G.buildings[fr]||[]).includes('arsenal');
  const resistBonus=isP?1+(G.resistance[to]/200):1.0;
  const effAtk=atkF*io2.atk*instPen*capPen*(hasArsenal?1.2:1)*resistBonus;
  const effDef=Math.round(df*defM);
  const ap=effAtk/(effAtk+effDef)*100;

  // Pre-compute outcome so skip works instantly
  const av=effAtk*rf(.78,1.25),dv=effDef*rf(.78,1.25),win=av>dv;
  const al=Math.min(atkF-1,Math.floor(atkF*rf(.13,.36))),dl=Math.min(df,Math.floor(df*rf(.15,.42)));

  function applyOutcome(){
    if(win){
      G.army[fr]-=atkF;G.army[to]=Math.max(50,atkF-al);
      const prev=G.owner[to];G.owner[to]=atker;G.gold[atker]+=G.income[to]*3;
      if(atker===G.playerNation){
        const io3=ideol();
        G.instab[to]=ri(82,95); // very high instability on conquest
        G.satisfaction[to]=ri(8,18); // very low satisfaction
        G.assim[to]=ri(5,22);
        if(!G.assimQueue)G.assimQueue=PROVINCES.map(()=>null);
        G.assimQueue[to]=null; // clear any previous assimilation
        if(hasFort)G.buildings[to]=G.buildings[to].filter(b=>b!=='fortress');
        if(PROVINCES[to].isCapital&&prev>=0){G.capitalPenalty[atker]=3;addLog(`★ ${PROVINCES[to].name} captured!`,'war');}
        G.resistance[to]=ri(20,50);
      }
      if(isP)addLog(`✦ ${PROVINCES[to].name} taken! Lost ${fa(al)}.`,'vic');
      if(prev>=0&&regsOf(prev).length===0){G.war[atker][prev]=G.war[prev][atker]=false;if(isP)addLog(`${ownerName(prev)} eliminated.`,'war');}
    }else{
      G.army[fr]=Math.max(0,G.army[fr]-al);G.army[to]=Math.max(50,df-dl);
      if(isP)addLog(`✗ ${PROVINCES[to].name} held. Lost ${fa(al)}.`,'war');
    }
  }

  if(!isP){
    // AI battle — instant, no animation
    applyOutcome();
    done();
    return;
  }

  // Player battle — show overlay on game map (no screen switch)
  applyOutcome();
  showBattleOverlay(fr, to, win, atkF, al, done);
}

// ── BATTLE OVERLAY ────────────────────────────────────────
// Inject CSS once
function _ensureBattleStyles(){
  if(document.getElementById('battle-overlay-style'))return;
  const st=document.createElement('style');
  st.id='battle-overlay-style';
  st.textContent=`
    @keyframes battleSlideUp{from{opacity:0;transform:translateX(-50%) translateY(40px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
    #battle-fog{position:fixed;inset:0;z-index:490;pointer-events:none;background:rgba(4,6,12,.0);transition:background .4s ease}
    #battle-fog.active{background:rgba(4,6,12,.55);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)}
    #battle-overlay{position:fixed;bottom:clamp(16px,4vh,40px);left:50%;transform:translateX(-50%);z-index:500;cursor:pointer;
      width:min(94vw,540px);
      background:linear-gradient(160deg,rgba(18,10,6,.98),rgba(6,3,2,.99));
      border:1px solid rgba(201,168,76,.4);
      padding:clamp(14px,2.5vh,22px) clamp(16px,3vw,28px) clamp(12px,2vh,18px);
      box-shadow:0 0 80px rgba(0,0,0,.95),0 0 30px rgba(180,30,20,.2);
      font-family:"IM Fell English",serif;color:#e8d5a3}
  `;
  document.head.appendChild(st);
  // Fog layer
  const fog=document.createElement('div');
  fog.id='battle-fog';
  document.body.appendChild(fog);
}

function _animZoomTo(fr, to, offsetY){
  if(_fastMode) return; // skip zoom in fast mode
  const tp=PROVINCES[to], fp=fr>=0?PROVINCES[fr]:tp;
  if(!tp||!fp||CW<=0||CH<=0)return;
  const midX=(tp.cx+(fp?fp.cx:tp.cx))/2;
  const midY=(tp.cy+(fp?fp.cy:tp.cy))/2;
  const dist=fp!==tp?Math.sqrt((tp.cx-fp.cx)**2+(tp.cy-fp.cy)**2):0;
  const targetScale=Math.min(CW,CH)/(Math.max(dist*4,HEX_R*16));
  const endScale=Math.max(1.5,Math.min(targetScale,10));
  const endTx=CW/2-midX*endScale;
  const endTy=(CH*(offsetY||0.40))-midY*endScale;
  const startScale=vp.scale,startTx=vp.tx,startTy=vp.ty;
  const ANIM_MS=550;const startT=performance.now();
  function easeOut(t){return 1-Math.pow(1-t,3);}
  function frame(now){
    const t=easeOut(Math.min((now-startT)/ANIM_MS,1));
    vp.scale=startScale+(endScale-startScale)*t;
    vp.tx=startTx+(endTx-startTx)*t;
    vp.ty=startTy+(endTy-startTy)*t;
    scheduleDraw();
    if(t<1)requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function _showOverlayCard(html, onDismiss, autoMs){
  // Fast mode — skip overlay entirely
  if(_fastMode){ onDismiss&&onDismiss(); return; }

  _ensureBattleStyles();
  // Activate fog
  const fog=document.getElementById('battle-fog');
  if(fog){void fog.offsetWidth;fog.classList.add('active');}

  let ov=document.getElementById('battle-overlay');
  if(!ov){
    ov=document.createElement('div');ov.id='battle-overlay';
    document.body.appendChild(ov);
  }
  ov.style.animation='none';void ov.offsetWidth;
  ov.style.animation='battleSlideUp .38s cubic-bezier(.2,.8,.3,1) both';
  ov.style.display='block';
  ov.innerHTML=html;

  let _gone=false;
  let _t=null;
  function dismiss(){
    if(_gone)return;_gone=true;
    if(_t)clearTimeout(_t);
    window._battleSkipFn=null;
    if(fog)fog.classList.remove('active');
    ov.style.transition='opacity .22s ease,transform .22s ease';
    ov.style.opacity='0';
    ov.style.transform='translateX(-50%) translateY(24px)';
    setTimeout(()=>{
      ov.style.display='none';
      ov.style.transition='';ov.style.opacity='';ov.style.transform='';
      onDismiss&&onDismiss();
    },220);
  }
  window._battleSkipFn=dismiss;
  ov.onclick=dismiss;
  _t=setTimeout(dismiss,autoMs||3000);
}

function showBattleOverlay(fr, to, win, atkF, al, done){
  _animZoomTo(fr, to, 0.38);

  const resColor=win?'#90ff80':'#ff9080';
  const resText=win?`✦ Victory — ${PROVINCES[to]&&PROVINCES[to].name} occupied!`:`✗ Repelled! Lost ${fa(al)}.`;
  const defArmy=win?al:G.army[to]||0;

  const html=`
    <div style="font-family:'Cinzel Decorative',serif;font-size:clamp(12px,2vw,16px);color:#c9a84c;letter-spacing:3px;text-align:center;margin-bottom:6px">⚔ Battle Report ⚔</div>
    <div style="font-size:clamp(8px,1.2vw,10px);color:#4a3828;letter-spacing:2px;text-align:center;margin-bottom:12px">${(PROVINCES[fr]&&PROVINCES[fr].short)||'?'} → ${(PROVINCES[to]&&PROVINCES[to].name)||'?'}</div>
    <div style="display:flex;gap:0;margin-bottom:12px">
      <div style="flex:1;text-align:center;padding:clamp(8px,1.5vh,14px) clamp(8px,1.5vw,16px);background:rgba(30,70,20,.35);border:1px solid rgba(70,150,50,.4);border-right:none">
        <div style="font-size:clamp(7px,1vw,9px);color:#80c860;letter-spacing:2px;margin-bottom:5px">ATTACKING</div>
        <div style="font-size:clamp(9px,1.3vw,11px);color:#e8d5a3;margin-bottom:4px">${(PROVINCES[fr]&&PROVINCES[fr].short)||'?'}</div>
        <div style="font-size:clamp(28px,5vw,40px);font-family:'Cinzel',serif;font-weight:700;color:#a0e870;line-height:1">${fa(atkF)}</div>
      </div>
      <div style="display:flex;align-items:center;padding:0 clamp(12px,2vw,18px);font-family:'Cinzel Decorative',serif;font-size:clamp(20px,3.5vw,28px);color:#d43030">VS</div>
      <div style="flex:1;text-align:center;padding:clamp(8px,1.5vh,14px) clamp(8px,1.5vw,16px);background:rgba(70,16,16,.35);border:1px solid rgba(150,40,40,.4);border-left:none">
        <div style="font-size:clamp(7px,1vw,9px);color:#c85050;letter-spacing:2px;margin-bottom:5px">DEFENDING</div>
        <div style="font-size:clamp(9px,1.3vw,11px);color:#e8d5a3;margin-bottom:4px">${(PROVINCES[to]&&PROVINCES[to].name)||'?'}</div>
        <div style="font-size:clamp(28px,5vw,40px);font-family:'Cinzel',serif;font-weight:700;color:#e87070;line-height:1">${fa(defArmy)}</div>
      </div>
    </div>
    <div style="text-align:center;padding:clamp(10px,1.8vh,16px) 14px;border:1px solid ${win?'rgba(60,160,40,.5)':'rgba(160,40,40,.5)'};background:${win?'rgba(40,100,20,.22)':'rgba(100,20,20,.22)'};font-family:'Cinzel',serif;font-size:clamp(12px,2vw,15px);letter-spacing:1px;color:${resColor}">${resText}</div>
    <div style="font-size:clamp(8px,1.1vw,10px);color:#2a2018;text-align:center;margin-top:8px;letter-spacing:1px">tap to continue</div>
  `;

  _showOverlayCard(html, ()=>{
    done();
  }, 3000);
}

function showEnemyAttackOverlay(ev, done){
  const {fr, to, atker, send, win, al} = ev;
  _animZoomTo(fr, to, 0.38);

  // Approximate enemy force (fog of war)
  const approxSend=approxForce(send);
  const approxDef=approxForce(G.army[to]||0);

  const resColor=win?'#ff8060':'#a0c880';
  const resText=win
    ?`☠ ${ownerName(atker)} seized ${(PROVINCES[to]&&PROVINCES[to].name)||'?'}!`
    :`✦ ${(PROVINCES[to]&&PROVINCES[to].name)||'?'} repelled the attack!`;

  const html=`
    <div style="font-family:'Cinzel Decorative',serif;font-size:clamp(11px,1.8vw,15px);color:#c06040;letter-spacing:3px;text-align:center;margin-bottom:6px">⚔ Enemy Attack ⚔</div>
    <div style="font-size:clamp(8px,1.2vw,10px);color:#4a3020;letter-spacing:2px;text-align:center;margin-bottom:12px">${ownerName(atker)} → ${(PROVINCES[to]&&PROVINCES[to].name)||'?'}</div>
    <div style="display:flex;gap:0;margin-bottom:12px">
      <div style="flex:1;text-align:center;padding:clamp(8px,1.5vh,14px) clamp(8px,1.5vw,16px);background:rgba(70,16,16,.35);border:1px solid rgba(150,40,40,.4);border-right:none">
        <div style="font-size:clamp(7px,1vw,9px);color:#c85050;letter-spacing:2px;margin-bottom:5px">ENEMY FORCE</div>
        <div style="font-size:clamp(9px,1.3vw,11px);color:#e8d5a3;margin-bottom:4px">${ownerName(atker)}</div>
        <div style="font-size:clamp(28px,5vw,40px);font-family:'Cinzel',serif;font-weight:700;color:#e87070;line-height:1">~${fa(approxSend)}</div>
      </div>
      <div style="display:flex;align-items:center;padding:0 clamp(12px,2vw,18px);font-family:'Cinzel Decorative',serif;font-size:clamp(20px,3.5vw,28px);color:#c09040">VS</div>
      <div style="flex:1;text-align:center;padding:clamp(8px,1.5vh,14px) clamp(8px,1.5vw,16px);background:rgba(20,50,20,.35);border:1px solid rgba(50,120,40,.4);border-left:none">
        <div style="font-size:clamp(7px,1vw,9px);color:#80c860;letter-spacing:2px;margin-bottom:5px">YOUR FORCE</div>
        <div style="font-size:clamp(9px,1.3vw,11px);color:#e8d5a3;margin-bottom:4px">${(PROVINCES[to]&&PROVINCES[to].name)||'?'}</div>
        <div style="font-size:clamp(28px,5vw,40px);font-family:'Cinzel',serif;font-weight:700;color:#a0e870;line-height:1">${fa(approxDef)}</div>
      </div>
    </div>
    <div style="text-align:center;padding:clamp(10px,1.8vh,16px) 14px;border:1px solid ${win?'rgba(160,40,40,.5)':'rgba(60,160,40,.5)'};background:${win?'rgba(100,20,20,.22)':'rgba(20,80,10,.22)'};font-family:'Cinzel',serif;font-size:clamp(12px,2vw,15px);letter-spacing:1px;color:${resColor}">${resText}</div>
    <div style="font-size:clamp(8px,1.1vw,10px);color:#2a2018;text-align:center;margin-top:8px;letter-spacing:1px">tap to continue</div>
  `;

  _showOverlayCard(html, done, 3000);
}

function drawBattleMap(){ /* no-op — replaced by overlay */ }
function battleZoomOut(done){ done&&done(); /* no-op — no separate screen */ }
function openAllianceMenu(){
  const PN=G.playerNation,myAl=G.allianceOf[PN];
  const alive=aliveNations().slice(0,22);
  let html=`<p class="mx">Manage alliances, NAPs, and ultimatums.</p>`;
  if(myAl>=0)html+=`<p class="mx" style="color:#80c8ff">Your alliance: <b>${G.alliance[myAl].name}</b> (${G.alliance[myAl].members.map(m=>ownerName(m)).join(', ')})</p>`;

  html+=`<p class="mx" style="color:var(--gold)">Nations:</p><div class="tlist">${alive.map(ai=>{
    const ar=regsOf(ai),tot=ar.reduce((s,r)=>s+G.army[r],0);
    const st=atWar(PN,ai)?'⚔ War':G.pact[PN][ai]?`🤝 NAP(${G.pLeft[PN][ai]}mo)`:areAllies(PN,ai)?'🤝 Ally':'○ Neutral';
    return`<div class="ti"><span class="tn">${ownerName(ai)} (${ar.length}t)</span><span class="ta">⚔${fm(tot)}<br>${st}</span>
      <div style="display:flex;gap:3px;margin-top:3px">
        ${!G.pact[PN][ai]&&!atWar(PN,ai)?`<button class="btn" style="padding:2px 6px;font-size:8px" onclick="closeMo();offerNAP(${ai})">NAP</button>`:''}
        ${!areAllies(PN,ai)&&!atWar(PN,ai)?`<button class="btn" style="padding:2px 6px;font-size:8px" onclick="closeMo();proposeAlliance(${ai})">Alliance</button>`:''}
        ${!atWar(PN,ai)?`<button class="btn red" style="padding:2px 6px;font-size:8px" onclick="closeMo();openUltimatum(${ai})">Ultimatum</button>`:''}
      </div></div>`;
  }).join('')}</div>`;
  openMo('DIPLOMACY',html,[{lbl:'Close',cls:'dim'}]);
}

function offerNAP(ai){
  const PN=G.playerNation;
  if(atWar(PN,ai)){popup('Make peace first!');return;}
  if(G.pact[PN][ai]){popup(`Pact active: ${G.pLeft[PN][ai]} months`);return;}
  const io=ideol(),ch=.45*io.pactChance;
  setTimeout(()=>{
    if(Math.random()<ch){
      G.pact[PN][ai]=G.pact[ai][PN]=true;G.pLeft[PN][ai]=G.pLeft[ai][PN]=5;
      addLog(`🤝 NAP signed with ${ownerName(ai)}.`,'diplo');popup(`✓ NAP with ${ownerName(ai)}`);
    }else popup(`✗ ${ownerName(ai)} refused NAP`);
    scheduleDraw();
  },300);
}

function proposeAlliance(ai){
  const PN=G.playerNation;
  if(atWar(PN,ai)){popup('Cannot ally while at war!');return;}
  const io=ideol(),ch=.38*io.pactChance;
  const myAl=G.allianceOf[PN],theirAl=G.allianceOf[ai];
  setTimeout(()=>{
    if(Math.random()<ch){
      if(myAl>=0){
        // Add to existing alliance
        G.alliance[myAl].members.push(ai);G.allianceOf[ai]=myAl;
        addLog(`${ownerName(ai)} joined ${G.alliance[myAl].name}!`,'diplo');
      }else if(theirAl>=0){
        G.alliance[theirAl].members.push(PN);G.allianceOf[PN]=theirAl;
        addLog(`You joined ${G.alliance[theirAl].name}!`,'diplo');
      }else{
        // Form new alliance
        const newAl={name:`${ownerName(PN)}-${ownerName(ai)} Pact`,color:'#204080',members:[PN,ai]};
        G.alliance.push(newAl);const idx=G.alliance.length-1;
        G.allianceOf[PN]=idx;G.allianceOf[ai]=idx;
        addLog(`New alliance formed: ${ownerName(PN)} & ${ownerName(ai)}!`,'diplo');
      }
      popup(`✓ Alliance with ${ownerName(ai)}!`);
    }else popup(`✗ ${ownerName(ai)} refused alliance`);
    scheduleDraw();
  },300);
}

function openUltimatum(ai){
  const PN=G.playerNation;
  const theirRegs=regsOf(ai);if(!theirRegs.length)return;
  const html=`<p class="mx">Issue ultimatum to <b style="color:#ff7070">${ownerName(ai)}</b>. They may comply or resist — risking war.</p>
  <p class="mx">Demand options:</p>
  <div class="tlist">
    <div class="ti ene" onclick="doUltimatum(${ai},'territory')"><span class="tn">⚔ Cede border territory</span><span class="ta">40% accept if weaker</span></div>
    <div class="ti ene" onclick="doUltimatum(${ai},'tribute')"><span class="tn">💰 Pay tribute (500 gold)</span><span class="ta">55% accept if weaker</span></div>
    <div class="ti ene" onclick="doUltimatum(${ai},'puppet')"><span class="tn">🎭 Become puppet state</span><span class="ta">25% accept if far weaker</span></div>
  </div>`;
  openMo('ULTIMATUM',html,[{lbl:'Cancel',cls:'dim'}]);
}
function doUltimatum(ai,type){
  closeMo();
  const PN=G.playerNation;
  const myPow=regsOf(PN).reduce((s,r)=>s+G.army[r],0);
  const theirPow=regsOf(ai).reduce((s,r)=>s+G.army[r],0);
  const stronger=myPow>theirPow*1.4;
  const baseChance=type==='tribute'?.55:type==='territory'?.40:.25;
  const ch=stronger?baseChance*1.5:baseChance*.5;
  setTimeout(()=>{
    if(Math.random()<ch){
      if(type==='tribute'){G.gold[PN]+=500;G.gold[ai]-=300;addLog(`💰 ${ownerName(ai)} paid tribute: +500 gold.`,'diplo');popup(`✓ Tribute received!`);}
      else if(type==='territory'){
        const border=regsOf(ai).find(r=>NB[r].some(nb=>G.owner[nb]===PN));
        if(border>=0){G.owner[border]=PN;G.instab[border]=60;addLog(`⚔ ${PROVINCES[border].name} ceded by ultimatum!`,'diplo');popup(`✓ ${PROVINCES[border].name} ceded!`);}
      }else if(type==='puppet'){
        G.puppet.push(ai);G.war[PN][ai]=G.war[ai][PN]=false;addLog(`🎭 ${ownerName(ai)} became puppet state!`,'diplo');popup(`✓ ${ownerName(ai)} is now your puppet!`);}
      scheduleDraw();updateHUD();
    }else{
      G.war[PN][ai]=G.war[ai][PN]=true;
      addLog(`⚔ ${ownerName(ai)} refused ultimatum — WAR!`,'war');popup(`✗ Ultimatum rejected — war declared!`);
    }
  },400);
}

function openPeace(){
  const PN=G.playerNation,ew=aliveNations().filter(ai=>atWar(PN,ai));
  if(!ew.length){popup('Not at war.');return;}
  const html=`<p class="mx">Seek ceasefire:</p><div class="tlist">${ew.map(ai=>{const tot=regsOf(ai).reduce((s,r)=>s+G.army[r],0);return`<div class="ti ene" onclick="offerPeace(${ai})"><span class="tn">⚔ ${ownerName(ai)}</span><span class="ta">⚔${fa(tot)}</span></div>`;}).join('')}</div>`;
  openMo('PEACE TALKS',html,[{lbl:'Close',cls:'dim'}]);
}
function offerPeace(ai){
  closeMo();const PN=G.playerNation;
  const ma=regsOf(PN).reduce((s,r)=>s+G.army[r],0),aa=regsOf(ai).reduce((s,r)=>s+G.army[r],0);
  let ch=.38;if(ma>aa*2)ch=.82;if(ma<aa*.5)ch=.18;
  setTimeout(()=>{
    if(Math.random()<ch){G.war[PN][ai]=G.war[ai][PN]=false;addLog(`🕊 Peace with ${ownerName(ai)}.`,'peace');popup(`✓ Peace accepted`);}
    else popup(`✗ ${ownerName(ai)} rejected`);
    scheduleDraw();
  },300);
}

function openMarionette(){
  const PN=G.playerNation;
  // Can make puppet from nations you've beaten (at war, have all their territory)
  const beaten=aliveNations().filter(ai=>atWar(PN,ai)&&regsOf(PN).length>regsOf(ai).length*2);
  const current=G.puppet.filter(p=>regsOf(p).length>0);
  if(!beaten.length&&!current.length){popup('No suitable nations to puppet or view.');return;}
  const html=`<p class="mx">Puppet states pay you 30% of their income and follow your wars.</p>
  ${beaten.length?`<p class="mx" style="color:var(--gold)">Offer puppet status to:</p><div class="tlist">${beaten.map(ai=>`<div class="ti" onclick="makePuppet(${ai})"><span class="tn">🎭 ${ownerName(ai)}</span><span class="ta">${regsOf(ai).length} territories</span></div>`).join('')}</div>`:''}
  ${current.length?`<p class="mx" style="color:#c090f0">Current puppets:</p><div class="tlist">${current.map(ai=>`<div class="ti"><span class="tn">🎭 ${ownerName(ai)}</span><span class="ta">${regsOf(ai).length}t · 30% tribute</span></div>`).join('')}</div>`:''}`;
  openMo('PUPPET STATES',html,[{lbl:'Close',cls:'dim'}]);
}
function makePuppet(ai){
  closeMo();
  G.puppet.push(ai);G.war[G.playerNation][ai]=G.war[ai][G.playerNation]=false;
  addLog(`🎭 ${ownerName(ai)} became your puppet state.`,'diplo');
  popup(`✓ ${ownerName(ai)} is now a puppet!`);scheduleDraw();
}

// ── GOVERNMENT REFORM ─────────────────────────────────────
// Ideology "distance" matrix — how different two systems are
// Higher = more expensive + longer transition + bigger satisfaction hit
const IDEO_DISTANCE = {
  fascism:    {fascism:0,nazism:1,militarism:2,nationalism:2,monarchy:3,communism:5,stalinism:6,socialdem:5,democracy:5,liberalism:6},
  nazism:     {nazism:0,fascism:1,militarism:2,nationalism:2,monarchy:4,communism:6,stalinism:7,socialdem:6,democracy:6,liberalism:7},
  communism:  {communism:0,stalinism:1,socialdem:3,democracy:4,liberalism:5,nationalism:5,fascism:5,nazism:6,monarchy:5,militarism:4},
  stalinism:  {stalinism:0,communism:1,socialdem:4,democracy:5,liberalism:6,nationalism:5,fascism:6,nazism:7,monarchy:5,militarism:4},
  democracy:  {democracy:0,liberalism:1,socialdem:1,monarchy:2,communism:4,nationalism:3,fascism:5,nazism:6,stalinism:5,militarism:4},
  liberalism: {liberalism:0,democracy:1,socialdem:2,monarchy:3,communism:5,nationalism:4,fascism:6,nazism:7,stalinism:6,militarism:5},
  socialdem:  {socialdem:0,democracy:1,liberalism:2,communism:3,monarchy:3,nationalism:3,fascism:5,nazism:6,stalinism:4,militarism:4},
  monarchy:   {monarchy:0,nationalism:1,democracy:2,liberalism:3,fascism:3,militarism:2,socialdem:3,communism:5,stalinism:5,nazism:4},
  nationalism:{nationalism:0,monarchy:1,fascism:2,militarism:2,democracy:3,liberalism:4,socialdem:3,communism:5,stalinism:5,nazism:2},
  militarism: {militarism:0,fascism:2,nazism:2,nationalism:2,monarchy:2,communism:4,stalinism:4,democracy:4,liberalism:5,socialdem:4},
};

function ideoDist(a,b){
  return (IDEO_DISTANCE[a]||{})[b] ?? 4; // fallback 4
}

function openReform(){
  if(G.reforming){
    const tgt=IDEOLOGIES[G.reformTarget];
    openModal('Reform in Progress',
      `<p class="mx warn">⚠ Currently transitioning to <b style="color:${tgt?.color}">${tgt?.icon} ${tgt?.name}</b></p>
       <p class="mx">Transition completes in <b>${G.reformTurnsLeft}</b> turns (${G.reformTurnsLeft} of ${G.reformTotalTurns} remaining).</p>
       <p class="mx" style="font-size:9px;color:var(--dim)">During transition: −20% income, −20% conscription efficiency, satisfaction declining.</p>`,
      '<button class="btn dim" onclick="closeModal()">Close</button>'
    );
    return;
  }

  const cur=G.ideology;
  const io=ideol();
  const gold=G.gold[G.playerNation];
  const avgSat=Math.round(regsOf(G.playerNation).reduce((s,r)=>s+G.satisfaction[r],0)/Math.max(1,regsOf(G.playerNation).length));

  const rows=Object.entries(IDEOLOGIES).filter(([k])=>k!==cur).map(([key,id])=>{
    const dist=ideoDist(cur,key);
    // Cost: 200 base × dist² — more different = much more expensive
    const cost=200+dist*dist*80;
    // Transition turns: 3 + dist*2 months
    const turns=3+dist*2;
    // Satisfaction hit: dist*8 points
    const satHit=dist*8;
    const canAfford=gold>=cost;
    const distLabel=['Identical','Very Close','Close','Moderate','Different','Very Different','Extreme'][Math.min(dist,6)];
    const distColor=['#8a8a8a','#50b050','#80c050','#c0c050','#c08030','#c04030','#900010'][Math.min(dist,6)];
    return`<div class="ideo-mo-card${canAfford?'':' ideo-mo-disabled'}" onclick="${canAfford?`doReform('${key}')`:''}" style="border-color:${id.border};${canAfford?'':'opacity:.45;cursor:not-allowed'}">
      <span style="font-size:20px;flex-shrink:0">${id.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-family:Cinzel,serif;font-size:11px;color:${id.color};margin-bottom:3px">${id.name}</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <span style="font-size:8px;color:${canAfford?'#c8a030':'#666'}">💰 ${fa(cost)}g</span>
          <span style="font-size:8px;color:#8090a0">⏳ ${turns} months</span>
          <span style="font-size:8px;color:#c06050">😞 −${satHit}% satisfaction</span>
          <span style="font-size:8px;color:${distColor}">${distLabel}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  openModal('⚖ Reform Government',
    `<p class="mx">Current: <b style="color:${io.color}">${io.icon} ${io.name}</b> · Treasury: <b>${fa(gold)}g</b> · Avg. Satisfaction: <b>${avgSat}%</b></p>
     <p class="mx" style="font-size:9px;color:var(--dim)">During transition your state is weakened. More different ideologies cost more and take longer.</p>
     <div class="ideo-mo-list" style="margin-top:8px">${rows}</div>`,
    '<button class="btn dim" onclick="closeModal()">Cancel</button>'
  );
}

function doReform(key){
  const dist=ideoDist(G.ideology,key);
  const cost=200+dist*dist*80;
  const turns=3+dist*2;
  const satHit=dist*8;
  const PN=G.playerNation;
  if(G.gold[PN]<cost){popup('Not enough gold!');return;}
  G.gold[PN]-=cost;
  G.reforming=true;
  G.reformTarget=key;
  G.reformTurnsLeft=turns;
  G.reformTotalTurns=turns;
  // Immediate satisfaction hit across all provinces
  regsOf(PN).forEach(r=>{
    G.satisfaction[r]=Math.max(5,G.satisfaction[r]-satHit);
    G.instab[r]=Math.min(100,G.instab[r]+dist*5);
  });
  closeModal();
  updateHUD();updateIdeoHUD();scheduleDraw();
  const tgt=IDEOLOGIES[key];
  addLog(`⚖ Reform: transitioning to ${tgt.icon} ${tgt.name} (${turns} months)…`,'ideo');
  popup(`⚖ Reform begins — ${turns} months to completion`);
}

function endTurn(){
  setEB(true);cancelMove();cancelNaval();
  try{
  // Advance one week; check if new month
  const newMonth = advanceWeek();

  // ── Weekly light processing (every tick) ──────────────
  const io=ideol(),PN=G.playerNation,s=season();

  // Epidemic runs every week (scaled down)
  processEpidemics(newMonth);

  // Fleet arrivals every week
  resolveNavalArrivals();
  // Execute queued moves (instant, no animation needed)
  executeMoveQueue();
  processDraftQueue(); // advance draft timers every week
  processAssimCosts(); // deduct assimilation gold cost weekly

  if(!newMonth){
    doAI(false); // weekly — attacks, retreats only
    executeBattleQueue(()=>{
      scheduleDraw();updateHUD();if(G.sel>=0)updateSP(G.sel);chkBtns();chkVic();
      setEB(false);
    });
    scheduleDraw();updateHUD();updateSeasonUI();
    if(G.sel>=0)updateSP(G.sel);chkBtns();
    return;
  }

  // ════════════════════════════════════════════
  //  MONTHLY PROCESSING (only on new month)
  // ════════════════════════════════════════════

  // Resources
  gatherResources();

  // Process loans
  processLoans();

  // Process construction queue
  processConstruction();

  // ── Process reform transition ──────────────────────────
  if(G.reforming){
    G.reformTurnsLeft--;
    if(G.reformTurnsLeft<=0){
      G.ideology=G.reformTarget;
      G.reforming=false;G.reformTarget='';G.reformTurnsLeft=0;G.reformTotalTurns=0;
      const newIo=IDEOLOGIES[G.ideology];
      addLog(`⚖ Reform complete — now ${newIo.icon} ${newIo.name}!`,'ideo');
      popup(`⚖ Transition complete! New government: ${newIo.icon} ${newIo.name}`,4000);
      updateIdeoHUD();
    } else {
      addLog(`⚖ Reform: ${G.reformTurnsLeft} months remaining…`,'ideo');
    }
  }

  // ── Player income + growth ─────────────────────────────
  const taxRate=G.taxRate??25;
  const taxMod=taxRate/100; // 0 to 1
  // Tax income multiplier: 0% tax = 0 income from pop taxes, 100% = full
  // Base province income stays, pop-based tax bonus scales with taxRate
  regsOf(PN).forEach(r=>{
    const sat=G.satisfaction[r]??70;
    const satIncomeMod=sat<40?0.80:1.0;
    const reformMod=G.reforming?0.80:1.0;

    let inc=G.income[r];
    if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);
    if((G.buildings[r]||[]).includes('palace'))inc=Math.floor(inc*1.15);
    // Terrain income modifier — averaged across all hexes if terrainMap present
    const terrIncM = provIncM(r);
    // Tax rate scales income: 25% base = full income, lower = less, higher = more
    const taxIncomeFactor=0.4+taxMod*2.4; // 0% tax→0.4x income, 25%→1.0x, 50%→1.6x, 100%→2.8x
    inc=Math.floor(inc*io.income*satIncomeMod*reformMod*(1-Math.min(.5,G.instab[r]/100))*s.incomeMod*taxIncomeFactor*terrIncM);
    G.gold[PN]+=inc;

    // Puppet tribute
    G.puppet.forEach(pp=>{
      regsOf(pp).forEach(pr=>{let pi=G.income[pr];if((G.buildings[pr]||[]).includes('factory'))pi=Math.floor(pi*1.8);G.gold[PN]+=Math.floor(pi*.3);});
    });

    // Population growth
    let pgr=G.pop[r]*.005*io.popGrowth*(sat<40?0.5:sat<60?0.8:1.0);
    if((G.buildings[r]||[]).includes('hospital'))pgr*=1.1;
    if((G.buildings[r]||[]).includes('granary'))pgr*=1.15;
    G.pop[r]+=Math.floor(pgr);

    // Assimilation passive (old assim field — kept for compat display)
    if(G.assim[r]<100)G.assim[r]=Math.min(100,G.assim[r]+ri(1,3)*(io.assimSpeed||1));

    // ── Instability decay (new system) ─────────────────────
    // Natural decay is very slow and stops at 25% floor (foreign province barrier)
    // Phase 1: 100→50: −0.25/week  Phase 2: 50→25: −0.5/week
    const instab=G.instab[r]||0;
    const isConquered = PROVINCES[r].nation !== G.playerNation; // foreign province
    const instabFloor = isConquered ? 25 : 0;
    let instabDec = 0;
    if(instab > 50) instabDec = 0.25;
    else if(instab > 25) instabDec = 0.5;
    else if(!isConquered) instabDec = ri(1,3)*(io.instabDecay||1); // own historical: normal decay below 25
    // Buildings still help on own provinces
    if(!isConquered){
      if((G.buildings[r]||[]).includes('fortress'))instabDec+=5;
      if((G.buildings[r]||[]).includes('palace'))instabDec+=6;
    }
    G.instab[r]=Math.max(instabFloor, instab - instabDec);

    // Active assimilation processing (weekly)
    const aq = G.assimQueue&&G.assimQueue[r];
    if(aq){
      const def=ASSIM_DEFS[aq.type];
      if(def){
        // Instab reduction this week
        let instabDrop;
        if(aq.type==='harsh'){
          instabDrop=harshRate(aq.weekIdx||0);
        } else {
          instabDrop=def.instabRate;
        }
        G.instab[r]=Math.max(0, G.instab[r]-instabDrop);

        // Pop loss this week — random within type's range, distributed over 48w
        const weeklyLossMin=def.popLossMin/48;
        const weeklyLossMax=def.popLossMax/48;
        const weeklyLoss=weeklyLossMin+(weeklyLossMax-weeklyLossMin)*Math.random();
        const popLoss=Math.floor(G.pop[r]*weeklyLoss);
        G.pop[r]=Math.max(aq.popFloor||Math.floor(G.pop[r]*0.28), G.pop[r]-popLoss);

        aq.weekIdx=(aq.weekIdx||0)+1;
        aq.weeksLeft--;

        // End conditions
        if(aq.weeksLeft<=0||G.instab[r]<=0||G.owner[r]!==G.playerNation){
          G.assimQueue[r]=null;
          if(G.owner[r]===G.playerNation){
            addLog(`✅ ${PROVINCES[r].short}: assimilation complete. Instab ${Math.round(G.instab[r])}%.`,'info');
          }
        }
      }
    }

    // Supply penalty — only if army is VERY oversized (3x pop/10), and milder
    if(G.army[r]>G.pop[r]/10*3) G.instab[r]=Math.min(100,G.instab[r]+1);

    // Disease effects now in processEpidemics

    // ── Satisfaction update ──────────────────────────────
    const taxBaseline = taxRate<=10?80:taxRate<=25?70:taxRate<=40?60:taxRate<=60?50:taxRate<=80?38:28;
    const natSat = Math.round((io.popGrowth>1?72:io.atk>1.2?55:65)*0.4 + taxBaseline*0.6);
    let satDelta=0;
    if(sat<natSat) satDelta+=ri(1,3);
    if(sat>natSat) satDelta-=ri(0,1); // reduced: was 0-2
    // instab affects sat only at very high levels, and more mildly
    if(G.instab[r]>70) satDelta-=1;
    if(G.instab[r]>90) satDelta-=1;
    const atWarWithAnyone=G.war[PN]?.some(w=>w);
    if(atWarWithAnyone) satDelta-=ri(0,1); // reduced: was 0-2
    if(G.reforming) satDelta-=ri(0,1);    // reduced: was 1-3
    if(G.provDisease?.[r]){
      const ep=G.epidemics?.find(e=>e.id===G.provDisease[r]&&e.active);
      if(ep) satDelta-=ri(1,Math.ceil(ep.type.satHit/6)); // milder: was /4
    }
    if((G.buildings[r]||[]).includes('palace')) satDelta+=ri(1,2);
    if((G.buildings[r]||[]).includes('hospital')) satDelta+=1;
    if(G.taxMood&&G.taxMood[r]){
      satDelta+=Math.sign(G.taxMood[r])*Math.min(4,Math.ceil(Math.abs(G.taxMood[r])/3));
      G.taxMood[r]=Math.abs(G.taxMood[r])<0.5?0:G.taxMood[r]*0.88;
    }
    // Hard floor: satisfaction cannot drop below 5 naturally (revolt is separate)
    G.satisfaction[r]=Math.max(5,Math.min(100,sat+satDelta));

    // Revolt check — only at near-zero satisfaction (extremely rare)
    const revoltChance=G.satisfaction[r]<5?0.04:0; // reduced threshold and chance
    if(Math.random()<revoltChance)triggerRevolt(r,io);
  });

  if(G.capitalPenalty[PN]>0)G.capitalPenalty[PN]--;

  // NAP expiry
  for(let a=0;a<NATIONS.length;a++)for(let b=0;b<NATIONS.length;b++)if(G.pact[a][b]){G.pLeft[a][b]--;if(G.pLeft[a][b]<=0){G.pact[a][b]=false;G.pLeft[a][b]=0;}}

  // Resistance
  processResistance();

  // AI turns — full monthly processing (income, buildings, conscript)
  doAI(true);

  // Random event (monthly)
  if(Math.random()<.25)randEvent(io);

  // ── Autosave every new month (slot 0, overwrites) ──────────
  autoSave();

  scheduleDraw();updateHUD();updateSeasonUI();
  if(G.sel>=0)updateSP(G.sel);chkBtns();checkDefeat();
  }catch(e){console.error('endTurn error:',e);}
  // Run queued player battles (async, battle animations), then re-enable button
  executeBattleQueue(()=>{
    scheduleDraw();updateHUD();if(G.sel>=0)updateSP(G.sel);chkBtns();chkVic();checkDefeat();
    setEB(false);
  });
}


function saveAndExit(){
  autoSave();
  try{localStorage.removeItem('toc_live');}catch(e){} // clear resume prompt
  setTimeout(()=>{show('worlds');refreshWorldsList();},80);
}

function autoSave(){
  try{
    const saves=getAllSaves();
    const nat=NATIONS[G.playerNation];
    const mo=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    // Deep copy G but convert Sets to arrays for JSON serialization
    const stateCopy=JSON.parse(JSON.stringify(G, (key,val)=>{
      if(val instanceof Set) return [...val];
      return val;
    }));
    const entry={
      slot:0,label:'⟳ Autosave',
      nation:nat?.name||'?',natColor:nat?.color||'#888',
      ideology:G.ideology,leaderName:G.leaderName,
      gameDate:`${mo[G.month]} ${G.year}`,
      regions:G.owner.filter(o=>o===G.playerNation).length,
      gold:Math.round(G.gold[G.playerNation]||0),
      saved:new Date().toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),
      state:stateCopy
    };
    const idx=saves.findIndex(s=>s.slot===0);
    if(idx>=0)saves[idx]=entry;else saves.unshift(entry);
    setSaves(saves);
    // Live session snapshot — overwritten every autosave for reload recovery
    try{localStorage.setItem('toc_live',JSON.stringify(stateCopy));}catch(e){}
  }catch(e){console.warn('Autosave failed',e);}
}

function triggerRevolt(r,io){
  const ra=Math.floor(ri(200,800)*(io.revoltScale||1));
  G.owner[r]=-1;G.army[r]=ra;G.instab[r]=ri(20,45);G.assim[r]=ri(8,28);G.resistance[r]=0;
  addLog(`🔥 Rebellion — ${PROVINCES[r].name} rises against you!`,'revolt');
  popup(`🔥 Rebellion in ${PROVINCES[r].name}!`,3200);
}

function spreadDisease(){
  // Legacy stub — new system handles everything
  processEpidemics();
}

// ════════════════════════════════════════════════════════════
//  EPIDEMIC SYSTEM
// ════════════════════════════════════════════════════════════

// Disease names and their base properties
const DISEASE_TYPES=[
  {name:'Plague',       lethality:.10, spreadRate:.65, satHit:22, armyHit:.28, icon:'☠',  duration:[10,22], seasonal:'winter'},
  {name:'Influenza',    lethality:.03, spreadRate:.80, satHit:12, armyHit:.12, icon:'🤧', duration:[5,14],  seasonal:'winter'},
  {name:'Cholera',      lethality:.08, spreadRate:.60, satHit:18, armyHit:.22, icon:'💧', duration:[7,16],  seasonal:'summer'},
  {name:'Typhus',       lethality:.07, spreadRate:.55, satHit:20, armyHit:.25, icon:'🦟', duration:[6,15],  seasonal:null},
  {name:'Dysentery',    lethality:.04, spreadRate:.50, satHit:14, armyHit:.18, icon:'🌡', duration:[5,12],  seasonal:'summer'},
  {name:'Smallpox',     lethality:.14, spreadRate:.45, satHit:28, armyHit:.35, icon:'💉', duration:[12,24], seasonal:null},
  {name:'Tuberculosis', lethality:.05, spreadRate:.38, satHit:16, armyHit:.14, icon:'🫁', duration:[14,28], seasonal:'winter'},
  {name:'Malaria',      lethality:.04, spreadRate:.48, satHit:12, armyHit:.20, icon:'🦟', duration:[9,20],  seasonal:'summer'},
];

// Distinct epidemic colors for map rendering
const EPIDEMIC_COLORS=[
  '#c83030','#c07820','#9030a8','#2878c0','#30a850',
  '#c03070','#787020','#2090a0','#8050c0','#c05020',
];

let _epicIdCounter=0;

function newEpidemic(originProv, type){
  if(!type) type=DISEASE_TYPES[Math.floor(Math.random()*DISEASE_TYPES.length)];
  const dur=ri(type.duration[0],type.duration[1]);
  const id=++_epicIdCounter;
  const color=EPIDEMIC_COLORS[(id-1)%EPIDEMIC_COLORS.length];
  const ep={
    id,
    name:type.name,
    icon:type.icon,
    color,
    type,
    origin:originProv,
    turnsActive:0,
    totalDuration:dur,
    provinces:new Set([originProv]),
    dead:0,
    active:true,
  };
  G.epidemics.push(ep);
  G.provDisease[originProv]=id;
  G.disease[originProv]=60+ri(0,30); // legacy severity
  // Only log outbreak if it's in player's territory
  const originOwner=G.owner[originProv];
  if(originOwner===G.playerNation){
    addLog(`${type.icon} <b>${type.name}</b> outbreak in ${PROVINCES[originProv]?.name||'?'}!`,'revolt');
    popup(`${type.icon} ${type.name} outbreak in ${PROVINCES[originProv]?.name}!`,4000);
  }
  // Track for ally notification later (checked monthly in processEpidemics)
  return ep;
}

function processEpidemics(fullMonth=false){
  const s=season();
  const isWinter=s.name==='Winter';
  const isAutumn=s.name==='Autumn';
  const isSummer=s.name==='Summer';
  // Very mild seasonal multiplier
  const seasonMult=isWinter?1.3:isAutumn?1.05:isSummer?1.05:1.0;

  // ── Random new outbreaks — very rare, monthly only ────────
  if(fullMonth){
    const atWar=G.war[G.playerNation]&&G.war[G.playerNation].some(w=>w);
    // ~70% per year in peace, ~150% in war — diseases are common
    const baseChance=(atWar?0.50:0.28)*seasonMult;
    if(Math.random()<baseChance){
      const candidates=PROVINCES.map((_,i)=>i).filter(i=>!PROVINCES[i].isSea);
      const origin=candidates[Math.floor(Math.random()*candidates.length)];
      if(!G.epidemics||!G.epidemics.find(ep=>ep.active&&ep.provinces.has(origin))){
        let pool=DISEASE_TYPES;
        if(isWinter) pool=DISEASE_TYPES.filter(d=>d.seasonal==='winter'||!d.seasonal);
        if(isSummer||isAutumn) pool=DISEASE_TYPES.filter(d=>d.seasonal==='summer'||!d.seasonal);
        const type=pool[Math.floor(Math.random()*pool.length)];
        newEpidemic(origin, type);
      }
    }
  }

  // ── Process each active epidemic ─────────────────────────
  for(const ep of G.epidemics){
    if(!ep.active) continue;
    if(fullMonth) ep.turnsActive++;

    const provList=[...ep.provinces];

    for(const prov of provList){
      // ── Fast elimination: 28-48% per week → clears in 2-4 weeks ──
      const hospBonus=(G.buildings[prov]||[]).includes('hospital')?0.20:0;
      const eliminateChance=Math.min(0.55, 0.28+hospBonus);
      if(Math.random()<eliminateChance){
        ep.provinces.delete(prov);
        G.provDisease[prov]=null;
        G.disease[prov]=0;
        continue;
      }

      // ── Mild effects ──────────────────────────────────
      const pop=G.pop[prov];
      if(pop>500){
        const dead=Math.floor(pop*ep.type.lethality*0.04*(Math.random()<0.1?4:1));
        if(dead>0){G.pop[prov]=Math.max(500,pop-dead);ep.dead+=dead;}
        G.disease[prov]=Math.min(100,15+Math.floor(ep.type.lethality*150));
      }
      if(G.satisfaction[prov]!==undefined){
        G.satisfaction[prov]=Math.max(5,(G.satisfaction[prov]||70)-ri(0,Math.ceil(ep.type.satHit/10)));
      }
      G.instab[prov]=Math.min(100,(G.instab[prov]||0)+ri(0,2));

      // ── Neighbor spread — very rare, one neighbor at a time ──
      const neighbors=(NB[prov]||[]).filter(nb=>!ep.provinces.has(nb)&&!PROVINCES[nb]?.isSea);
      if(neighbors.length>0&&Math.random()<0.12){ // 12% chance to even attempt spread this tick
        const nb=neighbors[Math.floor(Math.random()*neighbors.length)];
        const nbOwner=G.owner[nb];
        const sameNation=G.owner[prov]>=0&&nbOwner===G.owner[prov];
        const nbHosp=(G.buildings[nb]||[]).includes('hospital')?0.25:1.0;
        const baseSpread=ep.type.spreadRate*0.05*(sameNation?1.1:0.5)*nbHosp*seasonMult;
        if(Math.random()<baseSpread){
          ep.provinces.add(nb);
          G.provDisease[nb]=ep.id;
          G.disease[nb]=8+ri(0,12);
          if(nbOwner===G.playerNation){
            addLog(`${ep.icon} ${ep.name} spreads to ${PROVINCES[nb]&&PROVINCES[nb].name||'?'}!`,'revolt');
          }
        }
      }
      // No long-range jumps
    }

    // ── Natural end ───────────────────────────────────────
    if(fullMonth&&(ep.turnsActive>=ep.totalDuration||ep.provinces.size===0)){
      ep.active=false;
      for(const p of ep.provinces){G.provDisease[p]=null;G.disease[p]=0;}
      ep.provinces.clear();
      if(ep.dead>0){
        addLog(`${ep.icon} ${ep.name} epidemic ended. ☠ ${fm(ep.dead)} total deaths.`,'event');
      }
    }
  }

  if(G.epidemics.length>30) G.epidemics=G.epidemics.slice(-30);

  // ── Monthly: warn about large ally epidemics (>5 provinces) ──
  if(fullMonth){
    if(!G._allyEpicNotified) G._allyEpicNotified=new Set();
    for(const ep of G.epidemics){
      if(!ep.active||ep.provinces.size<=5) continue;
      if(G._allyEpicNotified.has(ep.id)) continue;
      let allyCount=0;
      for(const p of ep.provinces){
        const o=G.owner[p];
        if(o>=0&&o!==G.playerNation&&areAllies(G.playerNation,o)) allyCount++;
      }
      if(allyCount>=5){
        G._allyEpicNotified.add(ep.id);
        addLog(`${ep.icon} Major ${ep.name} outbreak among allies (${ep.provinces.size} provinces affected)!`,'revolt');
      }
    }
    for(const id of [...G._allyEpicNotified]){
      if(!G.epidemics.find(ep=>ep.active&&ep.id===id)) G._allyEpicNotified.delete(id);
    }
  }
}

// ── AI ────────────────────────────────────────────────────
// fullMonth=true → income, buildings, conscript, upkeep
// fullMonth=false (weekly) → attacks, army movements only
function doAI(fullMonth=true){
  for(const ai of aliveNations()){
    const ar=regsOf(ai);if(!ar.length)continue;
    const aio=IDEOLOGIES[NATIONS[ai]&&NATIONS[ai].ideology||'nationalism'];
    const s=season();
    const isAtWar=G.war[ai]&&G.war[ai].some(w=>w);

    // Each AI nation has a persistent personality: aggressive or defensive
    // Stored in G.aiPersonality[ai] — set once, kept forever
    if(!G.aiPersonality)G.aiPersonality={};
    if(G.aiPersonality[ai]===undefined)G.aiPersonality[ai]=Math.random()<0.5?'aggressive':'defensive';
    const aggressive=G.aiPersonality[ai]==='aggressive';

    if(fullMonth){
      // ── Income ──────────────────────────────────────────
      for(const r of ar){
        let inc=G.income[r];
        if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);
        if((G.buildings[r]||[]).includes('palace'))inc=Math.floor(inc*1.15);
        G.gold[ai]+=Math.floor(inc*aio.income*.78);
      }

      // ── Smart buildings ──────────────────────────────────
      // Aggressive: builds barracks+factory first; Defensive: fortress first
      const capIdx=ar.find(r=>PROVINCES[r]&&PROVINCES[r].isCapital);
      const borderProvs=ar.filter(r=>(NB[r]||[]).some(nb=>{const o=G.owner[nb];return o>=0&&o!==ai&&!areAllies(ai,o);}));
      const buildBudget=Math.floor(G.gold[ai]*(aggressive?0.25:0.2));
      let bSpent=0;

      // Priority list of (province, building, reason)
      const buildQueue=[];
      // Fortresses on borders
      for(const r of borderProvs){
        const blds=G.buildings[r]||[];
        if(!blds.includes('fortress')&&!(G.buildQueue&&G.buildQueue.some&&G.buildQueue.some(b=>b.prov===r&&b.bld==='fortress')))
          buildQueue.push({r,bld:'fortress',priority:aggressive?2:4});
      }
      // Fortress on capital
      if(capIdx!==undefined){
        const blds=G.buildings[capIdx]||[];
        if(!blds.includes('fortress'))buildQueue.push({r:capIdx,bld:'fortress',priority:5});
        if(!blds.includes('palace'))buildQueue.push({r:capIdx,bld:'palace',priority:4});
        if(!blds.includes('barracks'))buildQueue.push({r:capIdx,bld:'barracks',priority:aggressive?5:3});
        if(!blds.includes('factory'))buildQueue.push({r:capIdx,bld:'factory',priority:3});
      }
      // Barracks on high-pop border provinces
      for(const r of borderProvs){
        if(G.pop[r]>20000&&!(G.buildings[r]||[]).includes('barracks'))
          buildQueue.push({r,bld:'barracks',priority:aggressive?3:2});
      }
      // Factories in interior high-income provinces
      const interior=ar.filter(r=>!borderProvs.includes(r));
      for(const r of interior.slice(0,3)){
        if(!(G.buildings[r]||[]).includes('factory'))
          buildQueue.push({r,bld:'factory',priority:2});
      }

      buildQueue.sort((a,b)=>b.priority-a.priority);
      for(const {r,bld} of buildQueue){
        if(bSpent>=buildBudget)break;
        const cost=BUILDINGS[bld]&&BUILDINGS[bld].cost||300;
        if(G.gold[ai]>=cost*0.9&&bSpent+cost<=buildBudget){
          const blds=G.buildings[r]||[];
          const maxSlots=PROVINCES[r]&&PROVINCES[r].isCapital?5:3;
          if(!blds.includes(bld)&&blds.length<maxSlots){
            G.gold[ai]-=cost; bSpent+=cost;
            G.buildings[r]=[...blds,bld];
          }
        }
      }

      // ── Conscript ────────────────────────────────────────
      // Aggressive: conscripts more; defensive: less but focuses borders
      const conscriptRate=aggressive?(isAtWar?0.22:0.12):(isAtWar?0.15:0.07);
      const conscriptBudget=Math.floor(G.gold[ai]*conscriptRate);
      let spent=0;
      const priorityProvs=[...new Set([
        ...(capIdx!==undefined?[capIdx]:[]),
        ...borderProvs
      ])];
      for(const r of priorityProvs){
        if(spent>=conscriptBudget)break;
        const popCap=Math.floor(G.pop[r]/10);
        const canRecruit=Math.max(0,Math.min(
          Math.floor(popCap*(aggressive?0.04:0.025)),
          conscriptBudget-spent, 100
        ));
        if(canRecruit>0&&G.army[r]<popCap){
          const actual=Math.min(canRecruit,popCap-G.army[r]);
          G.army[r]+=actual;
          G.pop[r]=Math.max(500,G.pop[r]-actual);
          G.gold[ai]-=actual; spent+=actual;
        }
      }

      // ── Upkeep ───────────────────────────────────────────
      for(const r of ar){
        G.pop[r]+=Math.floor(G.pop[r]*.004);
        G.instab[r]=Math.max(0,G.instab[r]-ri(1,4));
        if(G.assim[r]<100)G.assim[r]=Math.min(100,G.assim[r]+ri(1,3));
      }

      // ── Puppet tribute ────────────────────────────────────
      if(G.puppet.includes(ai)){
        G.gold[G.playerNation]+=Math.floor(ar.reduce((sum,r)=>{
          let inc=G.income[r];
          if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);
          return sum+inc;
        },0)*.3);
      }
    } // end fullMonth

    // ── Attack (runs EVERY week) ─────────────────────────
    // Aggressive: 30% weekly chance; Defensive: 10% (both higher when at war)
    const atkChance=isAtWar?(aggressive?0.55:0.35):(aggressive?0.14:0.05);
    if(!inPeacePeriod()&&Math.random()<atkChance){
      const tgts=[];
      for(const r of ar){
        if(G.army[r]<200)continue;
        for(const nb of (NB[r]||[])){
          const nbo=G.owner[nb];
          if(nbo===ai||areAllies(ai,nbo)||(nbo>=0&&G.pact[ai][nbo]))continue;
          // Prefer capitals and provinces with buildings
          const hasCap=PROVINCES[nb]&&PROVINCES[nb].isCapital;
          const hasBld=(G.buildings[nb]||[]).length>0;
          const ratio=G.army[r]/Math.max(1,G.army[nb]);
          const minRatio=aggressive?1.2:1.8;
          if(ratio>=minRatio){
            const score=ratio*(hasCap?2.5:1)*(hasBld?1.5:1);
            tgts.push([r,nb,score]);
          }
        }
      }
      if(tgts.length){
        tgts.sort((a,b)=>b[2]-a[2]);
        const [fr2,to2]=tgts[0];
        const def=G.owner[to2];
        const sendFrac=aggressive?0.55:0.4;
        const send=Math.max(1,Math.floor(G.army[fr2]*sendFrac));
        if(def>=0&&def!==ai){G.war[ai][def]=true;G.war[def][ai]=true;}
        const terrain2=TERRAIN[PROVINCES[to2]&&PROVINCES[to2].terrain||'plains'];
        const frt=(G.buildings[to2]||[]).includes('fortress')?1.6:1;
        const terrMod=s.winterTerrain&&s.winterTerrain.includes(PROVINCES[to2]&&PROVINCES[to2].terrain)?s.moveMod:1.0;
        const win=send*aio.atk*terrMod*rf(.75,1.25)>G.army[to2]*terrain2.defB*frt*rf(.75,1.25);
        if(win){
          const al=Math.floor(send*rf(.15,.3));
          G.army[fr2]-=send;G.army[to2]=Math.max(50,send-al);G.owner[to2]=ai;
          G.instab[to2]=ri(30,60);G.assim[to2]=ri(5,20);
          if((G.buildings[to2]||[]).includes('fortress'))
            G.buildings[to2]=(G.buildings[to2]||[]).filter(b=>b!=='fortress');
          if(def===G.playerNation){
            addLog(`⚔ ${ownerName(ai)} seized ${PROVINCES[to2].name}!`,'war');
            if(!G._enemyAttackQueue)G._enemyAttackQueue=[];
            G._enemyAttackQueue.push({fr:fr2,to:to2,atker:ai,send,win:true,al});
          }
          if(def>=0&&regsOf(def).length===0)G.war[ai][def]=G.war[def][ai]=false;
          if(PROVINCES[to2]&&PROVINCES[to2].isCapital&&def>=0)G.capitalPenalty[ai]=3;
        }else{
          G.army[fr2]=Math.max(0,G.army[fr2]-Math.floor(send*rf(.1,.28)));
          G.army[to2]=Math.max(50,G.army[to2]-Math.floor(G.army[to2]*rf(.08,.25)));
          if(def===G.playerNation&&Math.random()<0.35){
            if(!G._enemyAttackQueue)G._enemyAttackQueue=[];
            G._enemyAttackQueue.push({fr:fr2,to:to2,atker:ai,send,win:false,al:0});
          }
        }
      }
    }

    // ── Retreat from interior (weekly, 10% chance) ────────
    if(Math.random()<.1){
      for(const r of ar){
        const isBorder=(NB[r]||[]).some(nb=>G.owner[nb]!==ai);
        if(!isBorder&&G.army[r]>600){
          const dest=ar.find(d=>d!==r&&(NB[d]||[]).some(nb=>G.owner[nb]!==ai));
          if(dest){const mv=Math.floor(G.army[r]*.4);G.army[r]-=mv;G.army[dest]+=mv;}
        }
      }
    }
  }
}

    // ── Income (AI gets 78% efficiency) ──────────────────
    for(const r of ar){
      let inc=G.income[r];
      if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);
      if((G.buildings[r]||[]).includes('palace'))inc=Math.floor(inc*1.15);
      G.gold[ai]+=Math.floor(inc*aio.income*.78);
    }

    // ── Conscript: tight budget, only capital + border provinces ──
    // Max spend per turn = 15% of gold, hard cap per province based on pop
    const conscriptBudget=Math.floor(G.gold[ai]*.15);
    let spent=0;
    // Identify border provinces (adjacent to non-ally, non-own)
    const borderProvs=ar.filter(r=>(NB[r]||[]).some(nb=>{const o=G.owner[nb];return o!==ai&&!areAllies(ai,o);}));
    const capIdx=ar.find(r=>PROVINCES[r].isCapital);
    const priorityProvs=[...new Set([...(capIdx!==undefined?[capIdx]:[]),...borderProvs])];

    for(const r of priorityProvs){
      if(spent>=conscriptBudget)break;
      // Pop support limit: 1 soldier per 10 pop
      const popCap=Math.floor(G.pop[r]/10);
      // Each turn recruit max 3% of pop cap, hard cap 50
      const canRecruit=Math.max(0,Math.min(
        Math.floor(popCap*.03),
        Math.floor(G.gold[ai]*.05),
        conscriptBudget-spent,
        50
      ));
      if(canRecruit>0&&G.army[r]<popCap){
        const actual=Math.min(canRecruit,popCap-G.army[r]);
        G.army[r]+=actual;
        G.pop[r]=Math.max(500,G.pop[r]-actual); // 1 soldier = 1 person
        G.gold[ai]-=actual;
        spent+=actual;
      }
    }

// ── RANDOM EVENTS ─────────────────────────────────────────
function randEvent(io){
  const mr=regsOf(G.playerNation);if(!mr.length)return;
  const r=mr[Math.floor(Math.random()*mr.length)];
  const evs=[
    ()=>{const b=ri(80,500);G.gold[G.playerNation]+=b;return[`💰 War bonds in ${PROVINCES[r].short}: +${b}g.`,'event'];},
    ()=>{const l=Math.floor(G.pop[r]*.06);G.pop[r]=Math.max(500,G.pop[r]-l);G.instab[r]=Math.min(100,G.instab[r]+ri(10,20));return[`☠ Epidemic in ${PROVINCES[r].name}. -${fm(l)} pop.`,'revolt'];},
    ()=>{const b=ri(100,300);G.gold[G.playerNation]+=b;return[`🏛 Tax windfall in ${PROVINCES[r].short}: +${b}g.`,'event'];},
    ()=>{G.income[r]+=ri(15,35);return[`🏭 Industrial boom in ${PROVINCES[r].short}.`,'event'];},
    ()=>{const l=Math.min(G.army[r]-150,ri(100,800));if(l<=0)return null;G.army[r]-=l;return[`😤 Desertion: -${fa(l)} in ${PROVINCES[r].short}.`,'revolt'];},
    ()=>{G.instab[r]=Math.max(0,G.instab[r]-ri(15,30));return[`🎖 Morale boost in ${PROVINCES[r].short}.`,'event'];},
    ()=>{const b=ri(50,200);G.gold[G.playerNation]+=b;return[`⛏ Resources in ${PROVINCES[r].short}: +${b}g.`,'event'];},
    // Seasonal events
    ()=>{if(season().name!=='Winter')return null;G.army[r]=Math.max(0,G.army[r]-ri(100,500));return[`❄️ Frostbite casualties in ${PROVINCES[r].short}.`,'season'];},
    ()=>{if(season().name!=='Summer')return null;const b=ri(100,300);G.gold[G.playerNation]+=b;return[`☀️ Bumper harvest in ${PROVINCES[r].short}: +${b}g.`,'season'];},
  ];
  for(let i=0;i<5;i++){const fn=evs[Math.floor(Math.random()*evs.length)],res=fn();if(res){const[msg,type]=res;addLog(msg,type);popup('★ '+msg,2800);break;}}
}

// ── VICTORY / DEFEAT ──────────────────────────────────────
function chkVic(){if(regsOf(G.playerNation).length>=LAND.length){sEl('vic-txt',`${G.leaderName} under ${ideol().icon} ${ideol().name} conquered Europe by ${dateStr()}.`);show('victory');}}
function checkDefeat(){if(!regsOf(G.playerNation).length){sEl('def-txt',`The regime of ${G.leaderName} collapsed in ${dateStr()}.`);show('defeat');}}


