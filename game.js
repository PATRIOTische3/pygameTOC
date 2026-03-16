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
  const dists=[];
  const sample=Math.min(PROVINCES.length,300);
  for(let i=0;i<sample;i++){
    for(let j=i+1;j<sample;j++){
      const dx=PROVINCES[i].cx-PROVINCES[j].cx, dy=PROVINCES[i].cy-PROVINCES[j].cy;
      const d=Math.sqrt(dx*dx+dy*dy);
      if(d>3&&d<14) dists.push(d);
    }
  }
  if(dists.length<5){HEX_R=4.75;return;}
  dists.sort((a,b)=>a-b);
  const step=0.5;
  const bins={};
  dists.forEach(d=>{const b=Math.round(d/step)*step;bins[b]=(bins[b]||0)+1;});
  const neighborDist=parseFloat(Object.entries(bins).sort((a,b)=>b[1]-a[1])[0][0]);
  HEX_R = (neighborDist / Math.sqrt(3)) * 0.995;

  // ── Rebuild NB for ALL provinces using coordinate proximity ──
  // NB in map.js only has 100 slots — fix for full 1700+ province set
  const N=PROVINCES.length;
  // Resize NB to cover all provinces
  while(NB.length<N) NB.push([]);
  // Threshold: neighbor if distance < neighborDist * 1.25
  const thresh=neighborDist*1.25;
  const thresh2=thresh*thresh;
  for(let i=0;i<N;i++){
    NB[i]=[];  // clear old
  }
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
const ownerName=n=>n<0?'Independent':NATIONS[n]?.short||`#${n}`;
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
function switchTab(id){document.querySelectorAll('.tab,.tpane').forEach(e=>e.classList.remove('on'));document.getElementById('tab-'+id).classList.add('on');document.getElementById('pane-'+id).classList.add('on');}
function setMapMode(mode){G.mapMode=mode;document.querySelectorAll('.mmbtn').forEach(b=>b.classList.remove('on'));document.getElementById('mm-'+mode).classList.add('on');scheduleDraw();}

// ── GAME START ────────────────────────────────────────────
function startGame(){
  if(SC<0)return;
  G.leaderName=document.getElementById('rname').value.trim()||'The Leader';
  G.ideology=SI||'fascism';G.playerNation=SC;
  G.month=0;G.week=0;G.year=1936;
  initDiplo();
  G.owner=PROVINCES.map(p=>p.nation??-1);
  G.pop=PROVINCES.map(p=>p.isCapital?ri(800000,3000000):ri(200000,1500000));
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
const TC={plains:'#3a4828',forest:'#2a3a1c',mountain:'#4a3e30',swamp:'#405838',desert:'#4a3e28',urban:'#2a2420',tundra:'#354040'};
const RES_COLORS={oil:'#8a6020',coal:'#303030',grain:'#5a7020',steel:'#405070'};

function provColor(i){
  const o=G.owner[i],m=G.mapMode;
  if(m==='disease'){
    const epId=G.provDisease?.[i];
    if(epId){
      const ep=G.epidemics?.find(e=>e.id===epId&&e.active);
      if(ep) return ep.color;
      return '#3a2020'; // epidemic ended but not cleared yet
    }
    // No disease — uniform dark grey (NOT terrain colors)
    return '#1e2020';
  }
  if(m==='terrain')return TC[PROVINCES[i].terrain]||'#2a2a2a';
  if(m==='resources'){
    const r=G.resBase[i]||{};
    if(r.oil>0)return'#6a4010';
    if(r.coal>0)return'#282828';
    if(r.grain>0)return'#3a5018';
    if(r.steel>0)return'#283848';
    return'#181618';
  }
  // Political
  if(o===G.playerNation){const ins=G.instab[i];return ins>70?'#882808':ins>40?'#6a4008':'#288820';}
  if(o<0){
    // Sea provinces stay dark blue — don't color them as revolts
    if(PROVINCES[i]?.isSea) return '#0a1828';
    // Independent/revolt land province — dark red-brown, clearly visible
    const surroundedByPlayer=NB[i]&&NB[i].length>0&&NB[i].every(nb=>G.owner[nb]===G.playerNation||G.owner[nb]<0);
    return surroundedByPlayer?'#6a1010':'#3a1808';
  }
  if(atWar(G.playerNation,o))return'#801818';
  if(G.pact[G.playerNation][o])return'#706010';
  if(areAllies(G.playerNation,o))return'#183868';
  return natColor(o);
}

// ── SEA LABELS ────────────────────────────────────────────
const SEA_LABELS=[
  {t:'ATLANTIC',x:40,y:300},{t:'NORTH SEA',x:182,y:224},
  {t:'NORW. SEA',x:185,y:160},{t:'BALTIC',x:303,y:226},
  {t:'MED.',x:155,y:462},{t:'MED.',x:253,y:460},{t:'MED. E',x:372,y:458},
  {t:'ADRIATIC',x:304,y:394},{t:'AEGEAN',x:394,y:430},
  {t:'BLACK SEA',x:440,y:376},{t:'CASPIAN',x:568,y:364},
  {t:'ARCTIC',x:360,y:72},{t:'BARENTS',x:508,y:96},
];

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

  // Sea labels
  ctx.font='italic 7px Cinzel,serif';
  ctx.fillStyle='rgba(65,135,200,.26)';ctx.textAlign='center';ctx.textBaseline='middle';
  SEA_LABELS.forEach(sl=>{
    if(sl.x<wx0-20||sl.x>wx1+20||sl.y<wy0-10||sl.y>wy1+10)return;
    ctx.fillText(sl.t,sl.x,sl.y);
  });

  
  // Draw hexes — two passes: fill (slightly enlarged to kill AA gaps) then borders
  PROVINCES.forEach((p,i)=>{
    if(p.cx<wx0-30||p.cx>wx1+30||p.cy<wy0-30||p.cy>wy1+30)return;
    const r=scaledR(i);
    // Bloat fill by 0.6px in world-space to cover antialiasing seams
    hexPath(ctx,p.cx,p.cy,r+0.6/vp.scale);
    ctx.fillStyle=provColor(i);
    ctx.fill();
  });

  // Borders — only draw on selected/target hexes + nation boundaries (skip internal same-nation borders)
  PROVINCES.forEach((p,i)=>{
    if(p.cx<wx0-30||p.cx>wx1+30||p.cy<wy0-30||p.cy>wy1+30)return;
    const r=scaledR(i);
    const o=G.owner[i];
    // Always stroke selected/move targets
    if(i===G.sel){
      hexPath(ctx,p.cx,p.cy,r);ctx.strokeStyle='rgba(255,255,255,.95)';ctx.lineWidth=2/vp.scale;ctx.stroke();
    } else if(G.moveMode&&G.moveFrom>=0&&isMoveTgt(i)){
      hexPath(ctx,p.cx,p.cy,r);ctx.strokeStyle='rgba(80,255,80,.9)';ctx.lineWidth=1.6/vp.scale;ctx.stroke();
    } else if(G.navalMode&&G.navalFrom>=0&&navalDests(G.navalFrom).includes(i)){
      hexPath(ctx,p.cx,p.cy,r);ctx.strokeStyle='rgba(80,200,255,.9)';ctx.lineWidth=1.6/vp.scale;ctx.stroke();
    } else {
      // Only draw thin dark border if any neighbor has a DIFFERENT owner
      const hasBorder=(NB[i]||[]).some(nb=>G.owner[nb]!==o);
      if(hasBorder){
        hexPath(ctx,p.cx,p.cy,r);
        // Independent revolt land provinces get a red border
        if(o<0 && !PROVINCES[i]?.isSea){
          ctx.strokeStyle='rgba(200,40,40,.8)';ctx.lineWidth=1.2/vp.scale;
        } else {
          ctx.strokeStyle='rgba(6,8,14,.65)';ctx.lineWidth=.5/vp.scale;
        }
        ctx.stroke();
      }
    }
  });

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

      // Revolt icon for independent land provinces
      if(G.owner[i]<0 && !PROVINCES[i]?.isSea && vp.scale>0.7){
        ctx.font=`${Math.max(5,fs+2)}px serif`;
        ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=3;
        ctx.fillText('⚡',p.cx,p.cy);
        ctx.shadowBlur=0;
      }

      // Army count — only when zoomed in enough AND player can see it
      if(G.army[i]>0 && vp.scale>1.0 && canSeeArmy(i)){
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

      // Building icons
      if(G.buildings[i]&&G.buildings[i].length){
        ctx.font=`${fs+1}px serif`;ctx.textBaseline='middle';
        G.buildings[i].forEach((k,bi)=>{
          ctx.fillText(BUILDINGS[k]?.icon||'',p.cx-r*.55+bi*fs*1.2,p.cy+r*.78);
        });
      }

      // Resistance indicator
      if(G.resistance[i]>30){
        ctx.font=`${fs+1}px serif`;
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

  // ── Disease map legend (drawn in screen space after restore) ──
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
  const ideo = o >= 0 ? IDEOLOGIES[NATIONS[o]?.ideology] : null;
  const ownerTxt = o < 0 ? '⚡ Independent' : NATIONS[o]?.name || '?';

  let inc = G.income[i];
  if((G.buildings[i]||[]).includes('factory')) inc = Math.floor(inc*1.8);

  const peace = inPeacePeriod();
  // Can we attack from a border province?
  const canAtk = !peace && isEnemy && regsOf(PN).some(r=>G.army[r]>100&&NB[r]?.includes(i));
  const atkDisabled = peace || (!canAtk && isEnemy);
  const atkTitle = peace ? `Peace — ${peaceTurnsLeft()} weeks left` : canAtk ? '' : 'No border army';
  const canMove = isOurs && G.army[i]>100;

  const epId = G.provDisease?.[i];
  const ep = epId ? G.epidemics?.find(e=>e.id===epId&&e.active) : null;
  const diseaseHtml = ep ? `<div style="grid-column:1/-1;padding:2px 5px;background:rgba(${hexToRgb(ep.color)},0.15);border:1px solid ${ep.color};font-size:clamp(7px,.7vw,9px);color:${ep.color}">${ep.icon} ${ep.name}</div>` : '';

  const html = `
    <button class="pp-close" onclick="hideProvPopup()">✕</button>
    <div class="pp-name">${p.name||p.short||'Province'}${p.isCapital?'★':''}</div>
    <div class="pp-sub">${ownerTxt}${ideo?' · '+ideo.icon+' '+ideo.name:''} · ${TERRAIN[p.terrain||'plains']?.name||''}</div>
    <div class="pp-stats">
      <div class="pp-stat"><div class="pp-sl">Army</div><div class="pp-sv">${canSeeArmy(i)?fm(G.army[i]):'?'}</div></div>
      <div class="pp-stat"><div class="pp-sl">Population</div><div class="pp-sv">${fm(G.pop[i])}</div></div>
      <div class="pp-stat"><div class="pp-sl">Income</div><div class="pp-sv">${inc}/mo</div></div>
      <div class="pp-stat"><div class="pp-sl">Instability</div><div class="pp-sv">${Math.round(G.instab[i]||0)}%</div></div>
      ${isOurs?`<div class="pp-stat"><div class="pp-sl">Satisfaction</div><div class="pp-sv">${Math.round(G.satisfaction[i]||0)}%</div></div>`:''}
      ${isOurs?`<div class="pp-stat"><div class="pp-sl">Assimilation</div><div class="pp-sv">${Math.round(G.assim[i]||0)}%</div></div>`:''}
      ${diseaseHtml}
    </div>
    <div class="pp-btns">
      ${isEnemy||isIndep ? `<button class="pp-btn atk" onclick="hideProvPopup();G.sel=${i};chkBtns();openAttack()" ${atkDisabled?'disabled':''} title="${atkTitle}">⚔ Attack</button>` : ''}
      ${isOurs ? `<button class="pp-btn ours" onclick="hideProvPopup();G.sel=${i};toggleMoveMode()">🚶 Move</button>` : ''}
      ${isOurs ? `<button class="pp-btn" onclick="hideProvPopup();G.sel=${i};openBuild()">🏗 Build</button>` : ''}
      ${isOurs ? `<button class="pp-btn" onclick="hideProvPopup();G.sel=${i};openDraft()">🪖 Draft</button>` : ''}
      <button class="pp-btn" onclick="hideProvPopup();G.sel=${i};updateSP(${i});scheduleDraw()">📋 Details</button>
    </div>
  `;

  const pp = document.getElementById('prov-popup');
  const pi = document.getElementById('prov-popup-inner');
  if(!pp||!pi) return;
  pi.innerHTML = html;
  pi.classList.remove('pp-anim');
  void pi.offsetWidth;
  pi.classList.add('pp-anim');

  // Position above the hex
  pp.style.display = 'block';
  const ppW = Math.max(200, Math.min(300, window.innerWidth * 0.22));
  const ppH = pi.offsetHeight || 160;
  let x = screenX - ppW/2;
  let y = screenY - ppH - 14; // above hex with tail gap

  // Keep within map bounds
  const wrap = document.getElementById('map-wrap');
  const wrapRect = wrap ? wrap.getBoundingClientRect() : {left:0,top:0,width:window.innerWidth,height:window.innerHeight};
  if(x < 4) x = 4;
  if(x + ppW > wrapRect.width - 4) x = wrapRect.width - ppW - 4;
  if(y < 4){ y = screenY + 24; } // flip below if no space above

  pp.style.left = x + 'px';
  pp.style.top = y + 'px';
  pp.style.width = ppW + 'px';
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
  if(Math.abs(dx)>3||Math.abs(dy)>3)_moved=true;
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
    if(Math.abs(dx)>2||Math.abs(dy)>2)_moved=true;
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
  const fs=Math.floor(tp/10)-ta;
  const debt=G.loans.reduce((s,l)=>s+l.amount,0);
  sEl('h-date',dateStr());sEl('h-reg',mr.length+'/'+LAND.length);
  sEl('h-gld',fa(G.gold[G.playerNation]));
  sEl('h-arm',fa(ta));sEl('h-pop',fm(tp));
  sEl('h-supply',(fs>=0?'+':'')+fa(fs));
  document.getElementById('h-supply-st').classList.toggle('warn',fs<0);
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
  } else if(o<0)bdg='<span class="badge neut">○ Independent</span>';
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
  sEl('sp-ow',(o>=0?ownerName(o):'Independent')+' · '+(TERRAIN[p.terrain||'plains']?.name||'')+' · '+dateStr());
  sEl('sp-ar',fa(G.army[i]));sEl('sp-pp',fm(G.pop[i]));sEl('sp-in',inc+'/mo');
  sEl('sp-as',o===G.playerNation?Math.round(G.assim[i])+'%':'—');
  sHTML('sp-res',resHtml);sHTML('sp-blds',bldHtml);
  const spif=document.getElementById('sp-if'),spiv=document.getElementById('sp-iv');
  if(spif){spif.style.width=inst+'%';spif.style.background=inst>70?'#c82808':inst>40?'#c08020':'#389828';}
  if(spiv)spiv.textContent=Math.round(inst)+'%';
  const spibar=document.getElementById('sp-ibar');if(spibar)spibar.style.display=o===G.playerNation?'block':'none';
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
  sEl('ri-nm',p.name);sHTML('ri-bdg',bdg);sEl('ri-ow',o>=0?ownerName(o):'Independent');
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
    if(G.moveMode) cancelMove();
    if(G.navalMode) cancelNaval();
  }
});


// ── MOVEMENT ──────────────────────────────────────────────
function toggleMoveMode(){
  if(G.navalMode)cancelNaval();
  if(G.moveMode){cancelMove();return;}
  const si=G.sel;
  if(si<0||G.owner[si]!==G.playerNation||G.army[si]<=100){popup('Select your territory first!');return;}
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
function openMoveDialog(from,to){
  cancelMove();
  if(G.owner[to]>=0&&G.owner[to]!==G.playerNation&&!atWar(G.playerNation,G.owner[to])){popup('Cannot enter without war!');return;}
  const max=G.army[from]-100;
  const s=season();
  const terrMod=s.winterTerrain?.includes(PROVINCES[to].terrain)?s.moveMod:1.0;
  const movNote=terrMod<1?`<p class="mx" style="color:#80c8ff">${s.icon} ${s.name}: movement ×${terrMod} in ${TERRAIN[PROVINCES[to].terrain]?.name}</p>`:'';
  openMo('TROOP MOVEMENT',`<p class="mx"><b>${PROVINCES[from].name}</b> → <b style="color:var(--gold)">${PROVINCES[to].name}</b></p>${movNote}<p class="mx">Available: <b>${fa(max)}</b> soldiers</p><div class="slider-w"><div class="slider-l"><span>Soldiers</span><span class="slider-v" id="msv">${fa(max)}</span></div><input type="range" id="msl" min="100" max="${max}" value="${max}" oninput="updSl('msl','msv')"></div>`,
    [{lbl:'Cancel',cls:'dim'},{lbl:'Move!',cls:'grn',cb:()=>confirmMove(from,to)}]);
  setTimeout(()=>document.getElementById('msl')?.style.setProperty('--pct','100%'),40);
}
function confirmMove(from,to){
  const v=+(document.getElementById('msl')?.value||G.army[from]-100);if(!v)return;
  const s=season();
  const terrMod=s.winterTerrain?.includes(PROVINCES[to].terrain)?s.moveMod:1.0;
  const actual=Math.round(v*terrMod);
  G.army[from]-=v;G.army[to]+=actual;
  if(actual<v)addLog(`${s.icon} Winter: ${fa(v-actual)} soldiers lost to cold!`,'season');
  if(G.owner[to]<0)G.owner[to]=G.playerNation;
  scheduleDraw();updateHUD();if(G.sel>=0)updateSP(G.sel);
  addLog(`${PROVINCES[from].short}: ${fa(actual)} soldiers → ${PROVINCES[to].short}.`,'move');
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
  if(cur<0){const ci=mr.find(i=>PROVINCES[i].isCapital&&PROVINCES[i].nation===G.playerNation);cur=ci??mr[0];}
  window._dr=cur;

  function draftCap(r){
    const hb=(G.buildings[r]||[]).includes('barracks');
    const sat=G.satisfaction[r]??70;
    // Low satisfaction = fewer willing recruits
    const satMod=sat<40?0.5:sat<60?0.75:1.0;
    // Reform period also reduces conscription
    const refMod=G.reforming?0.8:1.0;
    return Math.max(0,Math.min(25000,Math.floor(G.pop[r]/1000*(hb?1.5:1)/io.conscriptMod*satMod*refMod),G.gold[G.playerNation]));
  }
  function rowHtml(r,isPrimary){
    const cap=draftCap(r);
    const isOrig=PROVINCES[r].nation===G.playerNation;
    const name=PROVINCES[r].name+(PROVINCES[r].isCapital&&isOrig?'★':isOrig?'':' ⚑');
    const hb=(G.buildings[r]||[]).includes('barracks');
    if(isPrimary){
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
    // Other province row — compact, click to switch
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
  const r=window._dr;if(r<0||r===undefined)return;
  const v=+(document.getElementById('dsl')?.value||0);if(!v)return;
  const io=ideol(),popCost=v*1000*io.conscriptMod;
  if(G.pop[r]<popCost){popup('Not enough population!');return;}
  if(G.gold[G.playerNation]<v){popup('Not enough gold!');return;}
  G.pop[r]-=popCost;G.army[r]+=v;G.gold[G.playerNation]-=v;
  closeMo();
  scheduleDraw();updateHUD();if(G.sel>=0)updateSP(G.sel);
  addLog(`${PROVINCES[r].short}: ${fa(v)} soldiers conscripted.`,'info');
  popup(`✓ ${fa(v)} mobilized in ${PROVINCES[r].short}`);
}


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
  // Resource effects on income/army
  const PN=G.playerNation;
  if(G.resPool.coal<5){
    // Factories less effective
    G.gold[PN]=Math.max(0,G.gold[PN]-ri(20,50));
    if(ri(0,1)===0)addLog('⚫ Coal shortage — factory output reduced.','event');
  }
  if(G.resPool.grain<8){
    // Hunger — pop growth reduced, instability up
    regsOf(PN).forEach(r=>G.instab[r]=Math.min(100,G.instab[r]+ri(0,3)));
    if(ri(0,1)===0)addLog('🌾 Grain shortage — unrest rising.','event');
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
    G.instab[i]=Math.min(100,G.instab[i]+Math.floor(G.resistance[i]/10));
    G.resistance[i]=Math.max(0,G.resistance[i]-ri(2,6)); // decay
    if(G.resistance[i]>70&&Math.random()<.15){
      G.army[i]=Math.max(0,G.army[i]-ri(200,800));
      addLog(`🔥 Partisan attack in ${PROVINCES[i].name}!`,'resist');
    }
  });
  // AI sponsors resistance in player-occupied formerly-their territories
  aliveNations().forEach(ai=>{
    const lost=PROVINCES.map((_,i)=>i).filter(i=>G.owner[i]===G.playerNation&&PROVINCES[i].nation===ai);
    lost.forEach(i=>{
      if(Math.random()<.08&&G.gold[ai]>=80){
        G.gold[ai]-=80;
        G.resistance[i]=Math.min(100,G.resistance[i]+ri(5,20));
      }
    });
  });
}


// ── ATTACK / BATTLE ───────────────────────────────────────
function openAttack(){
  if(inPeacePeriod()){popup(`Peace period — ${peaceTurnsLeft()} weeks remaining`);return;}
  const si=G.sel;
  if(si<0||G.owner[si]===G.playerNation){popup('Select an enemy territory!');return;}
  const PN=G.playerNation,fr=regsOf(PN).find(r=>G.army[r]>100&&NB[r]?.includes(si));
  if(fr===undefined){popup('No army on the border!');return;}
  window._af=fr;window._at=si;
  const en=G.owner[si],hasPact=en>=0&&G.pact[PN][en],hasAlly=en>=0&&areAllies(PN,en);
  const hasFort=(G.buildings[si]||[]).includes('fortress');
  const io=ideol(),terrain=TERRAIN[PROVINCES[si].terrain||'plains'];
  const defBonus=terrain.defB*(hasFort?1.6:1),effDef=Math.round(G.army[si]*defBonus);
  const resist=G.resistance[si];
  let html='';
  if(hasPact)html+=`<p class="mx" style="color:#e07030">⚠ This will break your non-aggression pact!</p>`;
  if(hasAlly)html+=`<p class="mx" style="color:#ff6040">⚠ ${NATIONS[en]?.short} is your ALLY! Alliance will be broken!</p>`;
  if(hasFort)html+=`<p class="mx" style="color:#c09040">🏰 Fortress: defense ×1.6</p>`;
  if(resist>20)html+=`<p class="mx" style="color:#ff9040">🔥 Active resistance +${Math.round(resist/5)}% attack bonus for you!</p>`;
  html+=`<p class="mx">${io.icon} ${io.name}: atk ×${io.atk.toFixed(2)} · ${terrain.name} def ×${terrain.defB.toFixed(1)}</p>`;
  html+=`<p class="mx"><b>${PROVINCES[fr].short}</b> → <b style="color:#ff7070">${PROVINCES[si].name}</b></p>`;
  html+=`<p class="mx">Your force: <b>${fa(G.army[fr])}</b> · Enemy effective: <b style="color:#ff7070">${fa(effDef)}</b></p>`;
  html+=`<div class="slider-w"><div class="slider-l"><span>Force to commit</span><span class="slider-v" id="asv">${fa(G.army[fr])}</span></div><input type="range" id="asl" min="100" max="${G.army[fr]}" value="${G.army[fr]}" oninput="updSl('asl','asv')"></div>`;
  const btns=hasPact||hasAlly?[{lbl:'Cancel',cls:'dim'},{lbl:'Break & Attack',cls:'red',cb:()=>launchAtk(true)}]:[{lbl:'Cancel',cls:'dim'},{lbl:'⚔ Attack!',cls:'red',cb:()=>launchAtk(false)}];
  openMo('DECLARE WAR',html,btns);
  setTimeout(()=>document.getElementById('asl')?.style.setProperty('--pct','100%'),40);
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
  runBattle(fr,to,force,PN,()=>{scheduleDraw();updateHUD();if(G.sel>=0)updateSP(G.sel);chkBtns();chkVic();show('game');});
}

function runBattle(fr,to,atkF,atker,done){
  const df=G.army[to],isP=atker===G.playerNation;
  const io2=isP?ideol():IDEOLOGIES[NATIONS[atker]?.ideology||'nationalism'];
  const terrain=TERRAIN[PROVINCES[to].terrain||'plains'];
  const hasFort=(G.buildings[to]||[]).includes('fortress');
  const defM=terrain.defB*(hasFort?1.6:1);
  const instPen=isP?Math.max(.7,1-G.instab[fr]/150):1.0;
  const capPen=G.capitalPenalty[atker]>0?.85:1.0;
  const hasArsenal=(G.buildings[fr]||[]).includes('arsenal');
  const resistBonus=isP?1+(G.resistance[to]/200):1.0; // resistance helps attacker
  const effAtk=atkF*io2.atk*instPen*capPen*(hasArsenal?1.2:1)*resistBonus;
  const effDef=Math.round(df*defM);
  const ap=effAtk/(effAtk+effDef)*100;

  if(isP){
    sEl('b-an',PROVINCES[fr].short);
    sEl('b-dn',PROVINCES[to].name+(PROVINCES[to].isCapital?' ★':''));
    sEl('b-aa',fa(atkF));sEl('b-da',fa(effDef)+(hasFort?' 🏰':''));
    document.getElementById('b-ab').style.width='0%';document.getElementById('b-db').style.width='0%';
    sEl('b-ap',Math.round(ap)+'%');sEl('b-dp',Math.round(100-ap)+'%');
    const bon=[];
    if(io2.atk!==1)bon.push(`${io2.name} ×${io2.atk.toFixed(2)}`);
    if(hasFort)bon.push('🏰 ×1.6');
    if(terrain.defB!==1)bon.push(`${terrain.name} ×${terrain.defB.toFixed(1)}`);
    if(instPen<.98)bon.push(`Instab -${Math.round((1-instPen)*100)}%`);
    if(resistBonus>1)bon.push(`🔥 Resist +${Math.round((resistBonus-1)*100)}%`);
    sEl('b-bonus',bon.join(' | '));
    document.getElementById('bres').className='bres';
    show('battle');
  }
  if(isP)setTimeout(()=>{document.getElementById('b-ab').style.width=ap+'%';document.getElementById('b-db').style.width=(100-ap)+'%';},100);

  setTimeout(()=>{
    const av=effAtk*rf(.78,1.25),dv=effDef*rf(.78,1.25),win=av>dv;
    const al=Math.min(atkF-1,Math.floor(atkF*rf(.13,.36))),dl=Math.min(df,Math.floor(df*rf(.15,.42)));
    if(win){
      G.army[fr]-=atkF;G.army[to]=Math.max(200,atkF-al);
      const prev=G.owner[to];G.owner[to]=atker;G.gold[atker]+=G.income[to]*3;
      if(atker===G.playerNation){
        const io3=ideol();
        G.instab[to]=Math.min(100,ri(50,75)+(io3.extraConqInstab||0));
        G.assim[to]=ri(5,22);
        if(hasFort)G.buildings[to]=G.buildings[to].filter(b=>b!=='fortress');
        if(PROVINCES[to].isCapital&&prev>=0){G.capitalPenalty[atker]=3;addLog(`★ ${PROVINCES[to].name} captured!`,'war');}
        G.resistance[to]=ri(20,50); // conquered territory gets resistance
      }
      if(isP){document.getElementById('bres').className='bres win show';document.getElementById('bres').textContent=`✦ Victory — ${PROVINCES[to].name} occupied!`;addLog(`✦ ${PROVINCES[to].name} taken! Lost ${fa(al)}.`,'vic');}
      if(prev>=0&&regsOf(prev).length===0){G.war[atker][prev]=G.war[prev][atker]=false;if(isP)addLog(`${ownerName(prev)} eliminated.`,'war');}
    }else{
      G.army[fr]=Math.max(0,G.army[fr]-al);G.army[to]=Math.max(200,df-dl);
      if(isP){document.getElementById('bres').className='bres lose show';document.getElementById('bres').textContent=`✗ Repelled! Lost ${fa(al)}.`;addLog(`✗ ${PROVINCES[to].name} held. Lost ${fa(al)}.`,'war');}
    }
    setTimeout(done,isP?2200:0);
  },isP?2000:0);
}


// ── DIPLOMACY: ALLIANCES, PACTS, PUPPETS, ULTIMATUM ───────
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

  // Advance one week; check if new month
  const newMonth = advanceWeek();

  // ── Weekly light processing (every tick) ──────────────
  const io=ideol(),PN=G.playerNation,s=season();

  // Epidemic runs every week (scaled down)
  processEpidemics(newMonth);

  // Fleet arrivals every week
  resolveNavalArrivals();

  if(!newMonth){
    // Just a week tick — quick update
    scheduleDraw();updateHUD();updateSeasonUI();
    if(G.sel>=0)updateSP(G.sel);chkBtns();setEB(false);
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
  regsOf(PN).forEach(r=>{
    const sat=G.satisfaction[r]??70;
    const satIncomeMod=sat<40?0.80:1.0;
    const reformMod=G.reforming?0.80:1.0;

    let inc=G.income[r];
    if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);
    if((G.buildings[r]||[]).includes('palace'))inc=Math.floor(inc*1.15);
    inc=Math.floor(inc*io.income*satIncomeMod*reformMod*(1-Math.min(.5,G.instab[r]/100))*s.incomeMod);
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

    // Assimilation
    if(G.assim[r]<100)G.assim[r]=Math.min(100,G.assim[r]+ri(2,6)*(io.assimSpeed||1));

    // Instability decay
    let dec=ri(2,7)*(io.instabDecay||1);
    if((G.buildings[r]||[]).includes('fortress'))dec+=5;
    if((G.buildings[r]||[]).includes('palace'))dec+=6;
    G.instab[r]=Math.max(0,G.instab[r]-dec);

    // Supply penalty
    if(G.pop[r]/10<G.army[r])G.instab[r]=Math.min(100,G.instab[r]+ri(2,5));

    // Disease effects now in processEpidemics

    // ── Satisfaction update ──────────────────────────────
    const natSat=io.popGrowth>1?72:io.atk>1.2?55:65;
    let satDelta=0;
    if(sat<natSat) satDelta+=ri(1,3);
    if(sat>natSat) satDelta-=ri(0,2);
    if(G.instab[r]>60) satDelta-=ri(1,3);
    if(G.instab[r]>80) satDelta-=ri(2,4);
    const atWarWithAnyone=G.war[PN]?.some(w=>w);
    if(atWarWithAnyone) satDelta-=ri(0,2);
    if(G.reforming) satDelta-=ri(1,3);
    if(G.provDisease?.[r]){
      const ep=G.epidemics?.find(e=>e.id===G.provDisease[r]&&e.active);
      if(ep) satDelta-=ri(1,Math.ceil(ep.type.satHit/4));
    }
    if((G.buildings[r]||[]).includes('palace')) satDelta+=ri(1,2);
    if((G.buildings[r]||[]).includes('hospital')) satDelta+=1;
    G.satisfaction[r]=Math.max(5,Math.min(100,sat+satDelta));

    // Revolt check
    const revoltChance=G.instab[r]>85&&G.assim[r]<30?0.28:G.satisfaction[r]<15?0.15:0;
    if(Math.random()<revoltChance)triggerRevolt(r,io);
  });

  if(G.capitalPenalty[PN]>0)G.capitalPenalty[PN]--;

  // NAP expiry
  for(let a=0;a<NATIONS.length;a++)for(let b=0;b<NATIONS.length;b++)if(G.pact[a][b]){G.pLeft[a][b]--;if(G.pLeft[a][b]<=0){G.pact[a][b]=false;G.pLeft[a][b]=0;}}

  // Resistance
  processResistance();

  // AI turns
  doAI();

  // Random event (monthly)
  if(Math.random()<.25)randEvent(io);

  scheduleDraw();updateHUD();updateSeasonUI();
  if(G.sel>=0)updateSP(G.sel);chkBtns();checkDefeat();setEB(false);
}

function triggerRevolt(r,io){
  const ra=Math.floor(ri(400,2200)*(io.revoltScale||1));
  G.owner[r]=-1;G.army[r]=ra;G.instab[r]=ri(20,45);G.assim[r]=ri(8,28);G.resistance[r]=0;
  addLog(`⚡ REVOLT — ${PROVINCES[r].name} breaks free!`,'revolt');
  popup(`⚡ Revolt in ${PROVINCES[r].name}!`,3200);
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
  addLog(`${type.icon} <b>${type.name}</b> outbreak in ${PROVINCES[originProv]?.name||'?'}!`,'revolt');
  popup(`${type.icon} ${type.name} outbreak in ${PROVINCES[originProv]?.name}!`,4000);
  return ep;
}

function processEpidemics(fullMonth=false){
  const s=season();
  const isWinter=s.name==='Winter';
  const isAutumn=s.name==='Autumn';
  const isSummer=s.name==='Summer';
  // Seasonal outbreak multiplier
  const seasonMult=isWinter?2.2:isAutumn?1.6:isSummer?1.3:1.0;

  // ── Random new outbreaks (monthly scale, weekly probability = /4) ─
  const atWar=G.war[G.playerNation]?.some(w=>w);
  const baseChance=((atWar?0.22:0.18)*seasonMult)/4; // divide by 4 for weekly tick

  for(let roll=0;roll<3;roll++){
    if(Math.random()<baseChance*(roll===0?1:0.35)){
      const candidates=PROVINCES.map((_,i)=>i).filter(i=>!PROVINCES[i].isSea);
      const origin=candidates[Math.floor(Math.random()*candidates.length)];
      if(!G.epidemics?.find(ep=>ep.active&&ep.provinces.has(origin))){
        let pool=DISEASE_TYPES;
        if(isWinter) pool=DISEASE_TYPES.filter(d=>d.seasonal==='winter'||!d.seasonal).concat(DISEASE_TYPES.filter(d=>d.seasonal==='winter'));
        if(isSummer||isAutumn) pool=DISEASE_TYPES.filter(d=>d.seasonal==='summer'||!d.seasonal).concat(DISEASE_TYPES.filter(d=>d.seasonal==='summer'));
        const type=pool[Math.floor(Math.random()*pool.length)];
        newEpidemic(origin, type);
      }
    }
  }

  // ── Process each active epidemic ─────────────────────────
  for(const ep of G.epidemics){
    if(!ep.active) continue;
    if(fullMonth) ep.turnsActive++; // count months, not weeks

    // ── Possible mutation: become more aggressive ─────────
    if(fullMonth && ep.turnsActive>3&&Math.random()<0.15){
      const mutTypes=['spreadRate','lethality'];
      const stat=mutTypes[Math.floor(Math.random()*mutTypes.length)];
      const boost=stat==='spreadRate'?ri(5,15)/100:ri(2,6)/100;
      ep.type={...ep.type,[stat]:Math.min(0.95,ep.type[stat]+boost)};
      if(ep.dead>100000||ep.provinces.size>20){
        addLog(`${ep.icon} ${ep.name} mutates — becomes more ${stat==='spreadRate'?'contagious':'lethal'}!`,'revolt');
      }
    }

    // Seasonal spread boost
    const spreadBoost=isWinter?(ep.type.seasonal==='winter'?1.8:1.3):isAutumn?1.4:isSummer?(ep.type.seasonal==='summer'?1.6:1.1):1.0;

    const provList=[...ep.provinces];

    for(const prov of provList){
      // ── Persistence roulette (weekly, so divide monthly chance by 4) ──
      const hospBonus=(G.buildings[prov]||[]).includes('hospital')?0.18:0;
      const instabPenalty=Math.min(0.08,(G.instab[prov]||0)/1000);
      const eliminateChance=Math.max(0.008,(0.07+hospBonus-instabPenalty)/4);
      if(Math.random()<eliminateChance){
        ep.provinces.delete(prov);
        G.provDisease[prov]=null;
        G.disease[prov]=0;
        continue;
      }

      // ── Effects ───────────────────────────────────────
      const pop=G.pop[prov];
      if(pop>1000){
        const roll=Math.random();
        let deathRate;
        if(roll<0.55)      deathRate=ep.type.lethality*0.15; // small
        else if(roll<0.85) deathRate=ep.type.lethality*0.55; // medium
        else               deathRate=ep.type.lethality*1.8;  // severe
        const dead=Math.floor(pop*deathRate);
        if(dead>0){
          G.pop[prov]=Math.max(1000,pop-dead);
          ep.dead+=dead;
          // Log big death events
          if(dead>50000&&G.owner[prov]===G.playerNation){
            addLog(`${ep.icon} ${ep.name}: ${fm(dead)} deaths in ${PROVINCES[prov]?.name}!`,'revolt');
          }
        }
        G.disease[prov]=Math.min(100,35+Math.floor(ep.type.lethality*500));
      }

      if(G.satisfaction[prov]!==undefined){
        G.satisfaction[prov]=Math.max(5,(G.satisfaction[prov]||70)-ri(1,Math.ceil(ep.type.satHit/2)));
      }
      G.instab[prov]=Math.min(100,(G.instab[prov]||0)+ri(2,6));

      // ── Spread ────────────────────────────────────────
      const owner=G.owner[prov];
      const provIdx=PROVINCES.findIndex((_,idx)=>idx===prov);
      const neighbors=NB[prov]||[];

      for(const nb of neighbors){
        if(ep.provinces.has(nb)||PROVINCES[nb]?.isSea) continue;
        const nbOwner=G.owner[nb];
        const sameNation=owner>=0&&nbOwner===owner;
        const nbHosp=(G.buildings[nb]||[]).includes('hospital')?0.45:1.0;
        // Same nation spreads much faster; cross-border slower but still significant
        const baseSpread=ep.type.spreadRate*(sameNation?1.0:0.50)*nbHosp*spreadBoost;
        if(Math.random()<baseSpread){
          ep.provinces.add(nb);
          G.provDisease[nb]=ep.id;
          G.disease[nb]=25+ri(0,25);
          if(nbOwner===G.playerNation||owner===G.playerNation){
            addLog(`${ep.icon} ${ep.name} spreads to ${PROVINCES[nb]?.name||'?'}!`,'revolt');
          }
        }

        // Long-distance jump (trade, armies crossing borders)
        // Higher chance now: 4% base, boosted in winter/autumn
        const jumpChance=0.04*spreadBoost;
        if(!ep.provinces.has(nb)&&Math.random()<jumpChance){
          ep.provinces.add(nb);
          G.provDisease[nb]=ep.id;
          G.disease[nb]=15+ri(0,20);
          if(nbOwner===G.playerNation){
            addLog(`${ep.icon} ${ep.name} jumps to ${PROVINCES[nb]?.name||'?'}!`,'revolt');
            popup(`${ep.icon} ${ep.name} reached ${PROVINCES[nb]?.name}!`,3500);
          }
        }
      }

      // Extra: random long-range jump (ships, caravans) — 2% per infected province
      if(Math.random()<0.02*spreadBoost){
        const allLand=PROVINCES.map((_,i)=>i).filter(i=>!PROVINCES[i].isSea&&!ep.provinces.has(i));
        if(allLand.length){
          const target=allLand[Math.floor(Math.random()*allLand.length)];
          ep.provinces.add(target);
          G.provDisease[target]=ep.id;
          G.disease[target]=20+ri(0,20);
          if(G.owner[target]===G.playerNation){
            addLog(`${ep.icon} ${ep.name} appears in ${PROVINCES[target]?.name} — unknown origin!`,'revolt');
            popup(`⚠ ${ep.icon} ${ep.name} in ${PROVINCES[target]?.name}!`,3500);
          }
        }
      }
    }

    // ── Natural end (check monthly) ───────────────────────
    if(fullMonth&&(ep.turnsActive>=ep.totalDuration||ep.provinces.size===0)){
      ep.active=false;
      for(const p of ep.provinces){G.provDisease[p]=null;G.disease[p]=0;}
      ep.provinces.clear();
      if(ep.dead>0){
        addLog(`${ep.icon} ${ep.name} epidemic ended. ☠ ${fm(ep.dead)} total deaths.`,'event');
        if(ep.dead>100000) popup(`${ep.icon} ${ep.name} has ended — ☠ ${fm(ep.dead)} lives lost`,4500);
      }
    }
  }

  if(G.epidemics.length>30) G.epidemics=G.epidemics.slice(-30);
}

// ── AI ────────────────────────────────────────────────────
function doAI(){
  for(const ai of aliveNations()){
    const ar=regsOf(ai);if(!ar.length)continue;
    const aio=IDEOLOGIES[NATIONS[ai]?.ideology||'nationalism'];
    const s=season();
    const isAtWar=G.war[ai]?.some(w=>w);

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
      // Pop support limit: 1 soldier per 20 pop (realistic)
      const popCap=Math.floor(G.pop[r]/20);
      // Each turn recruit max 5% of pop support cap
      const canRecruit=Math.max(0,Math.min(
        Math.floor(popCap*.05),       // 5% of cap per turn
        Math.floor(G.gold[ai]*.05),   // 5% of gold
        conscriptBudget-spent,
        300                           // hard cap per province per turn
      ));
      if(canRecruit>0&&G.army[r]<popCap){
        const actual=Math.min(canRecruit,popCap-G.army[r]);
        G.army[r]+=actual;
        G.pop[r]=Math.max(1000,G.pop[r]-actual*1000);
        G.gold[ai]-=actual;
        spent+=actual;
      }
    }

    // ── Attack: only when prepared and peace period over ─
    if(!inPeacePeriod()&&Math.random()<(isAtWar?.5:.2)){
      const tgts=[];
      for(const r of ar){
        if(G.army[r]<300)continue; // need minimum force
        if(!NB[r])continue;
        for(const nb of NB[r]){
          const nbo=G.owner[nb];
          if(nbo===ai||G.pact[ai][nbo]||areAllies(ai,nbo))continue;
          // Prefer weaker targets
          const ratio=G.army[r]/(Math.max(1,G.army[nb]));
          if(ratio>1.5)tgts.push([r,nb,ratio]); // only attack if 1.5× stronger
        }
      }
      if(tgts.length){
        // Pick best odds
        tgts.sort((a,b)=>b[2]-a[2]);
        const [fr2,to2]=tgts[0];
        const def3=G.owner[to2];
        const send=Math.max(1,Math.floor(G.army[fr2]*.45));
        if(def3>=0&&def3!==ai)G.war[ai][def3]=G.war[def3][ai]=true;
        const terrain2=TERRAIN[PROVINCES[to2].terrain||'plains'];
        const frt=(G.buildings[to2]||[]).includes('fortress')?1.6:1;
        const terrMod=s.winterTerrain?.includes(PROVINCES[to2].terrain)?s.moveMod:1.0;
        const win=send*aio.atk*terrMod*rf(.75,1.25)>G.army[to2]*terrain2.defB*frt*rf(.75,1.25);
        if(win){
          const al=Math.floor(send*rf(.15,.3));
          G.army[fr2]-=send;G.army[to2]=Math.max(50,send-al);G.owner[to2]=ai;
          G.instab[to2]=ri(30,60);G.assim[to2]=ri(5,20);
          if((G.buildings[to2]||[]).includes('fortress'))G.buildings[to2]=G.buildings[to2].filter(b=>b!=='fortress');
          if(def3===G.playerNation)addLog(`⚔ ${ownerName(ai)} seized ${PROVINCES[to2].name}!`,'war');
          if(def3>=0&&regsOf(def3).length===0)G.war[ai][def3]=G.war[def3][ai]=false;
          if(PROVINCES[to2].isCapital&&def3>=0)G.capitalPenalty[ai]=3;
        }else{
          G.army[fr2]=Math.max(0,G.army[fr2]-Math.floor(send*rf(.1,.28)));
          G.army[to2]=Math.max(50,G.army[to2]-Math.floor(G.army[to2]*rf(.08,.25)));
        }
      }
    }

    // ── Retreat excess armies from interior ──────────────
    // Prevents interior provinces from having absurd armies
    if(Math.random()<.15){
      for(const r of ar){
        const isBorder=(NB[r]||[]).some(nb=>G.owner[nb]!==ai);
        if(!isBorder&&G.army[r]>500){
          // Move half to a border
          const dest=ar.find(d=>d!==r&&(NB[d]||[]).some(nb=>G.owner[nb]!==ai));
          if(dest){const mv=Math.floor(G.army[r]*.4);G.army[r]-=mv;G.army[dest]+=mv;}
        }
      }
    }

    // ── Puppet tribute ────────────────────────────────────
    if(G.puppet.includes(ai)){
      G.gold[G.playerNation]+=Math.floor(ar.reduce((s,r)=>{
        let inc=G.income[r];
        if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);
        return s+inc;
      },0)*.3);
    }

    // ── Basic upkeep ──────────────────────────────────────
    for(const r of ar){
      G.pop[r]+=Math.floor(G.pop[r]*.004);
      G.instab[r]=Math.max(0,G.instab[r]-ri(1,4));
      if(G.assim[r]<100)G.assim[r]=Math.min(100,G.assim[r]+ri(1,3));
    }
  }
}

// ── RANDOM EVENTS ─────────────────────────────────────────
function randEvent(io){
  const mr=regsOf(G.playerNation);if(!mr.length)return;
  const r=mr[Math.floor(Math.random()*mr.length)];
  const evs=[
    ()=>{const b=ri(80,500);G.gold[G.playerNation]+=b;return[`💰 War bonds in ${PROVINCES[r].short}: +${b}g.`,'event'];},
    ()=>{const l=Math.floor(G.pop[r]*.06);G.pop[r]=Math.max(1000,G.pop[r]-l);G.instab[r]=Math.min(100,G.instab[r]+ri(10,20));return[`☠ Epidemic in ${PROVINCES[r].name}. -${fm(l)} pop.`,'revolt'];},
    ()=>{const b=ri(300,1500);G.army[r]+=b;return[`🪖 Volunteers: +${fa(b)} in ${PROVINCES[r].short}.`,'event'];},
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

