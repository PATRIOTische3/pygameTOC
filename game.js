const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
let G={
  month:0,year:1936,playerNation:0,leaderName:'The Leader',ideology:'fascism',
  owner:[],pop:[],army:[],income:[],gold:[],buildings:[],instab:[],assim:[],disease:[],
  // resources: per-province produced this turn
  resPool:{oil:0,coal:0,grain:0,steel:0}, // player total stockpile
  resBase:[],  // per-province base resource object (copied from PROVINCES.res)
  // loans
  loans:[],  // [{amount,monthly,monthsLeft,creditor}]
  totalDebt:0,
  // diplomacy
  pact:[],war:[],pLeft:[],capitalPenalty:[],
  alliance:[],  // array of {name,color,members:[natIds]}
  puppet:[],    // puppetNatId[] controlled by player
  // resistance
  resistance:[], // per province: 0-100 resistance level
  resistSponsor:[], // per province: which nation is sponsoring (or -1)
  // fleet / naval
  fleet:[],
  // ui state
  sel:-1,moveFrom:-1,moveMode:false,navalMode:false,navalFrom:-1,mapMode:'political',
  // alliances
  allianceOf:[], // per nation: alliance index or -1
};
// ── HEX RADIUS (auto-computed from province spacing) ─────
let HEX_R = 7;
function computeHexRadius(){
  if(PROVINCES.length < 2){HEX_R=7;return;}
  let minD = Infinity;
  for(let i=0;i<Math.min(PROVINCES.length,30);i++){
    for(let j=i+1;j<Math.min(PROVINCES.length,30);j++){
      const dx=PROVINCES[i].cx-PROVINCES[j].cx, dy=PROVINCES[i].cy-PROVINCES[j].cy;
      const d=Math.sqrt(dx*dx+dy*dy);
      if(d>1&&d<minD)minD=d;
    }
  }
  HEX_R = Math.max(5, Math.min(19, minD * 0.56));
}
const scaledR=(i)=>PROVINCES[i].isCapital ? HEX_R*1.18 : HEX_R;


const ri=(a,b)=>Math.floor(Math.random()*(b-a+1))+a;
const rf=(a,b)=>Math.random()*(b-a)+a;
const fm=n=>n>=1e6?(n/1e6).toFixed(1)+'M':n>=1e3?(n/1e3).toFixed(0)+'k':''+Math.round(n);
const fa=n=>Math.round(n).toLocaleString('en');
const ideol=()=>IDEOLOGIES[G.ideology];
const regsOf=n=>PROVINCES.map((_,i)=>i).filter(i=>G.owner[i]===n);
const dateStr=()=>`${MONTHS[G.month]} ${G.year}`;
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
let SC=-1,SI='fascism';
(function buildSetupUI(){
  // Nation buttons — selecting one auto-sets ideology
  const rg=document.getElementById('rgrid');
  NATIONS.forEach((nat,i)=>{
    const b=document.createElement('button');b.className='rbtn';
    b.innerHTML=`<b>${nat.short}</b><br><small style="font-size:7px;color:${IDEOLOGIES[nat.ideology]?.color||'#888'}">${IDEOLOGIES[nat.ideology]?.icon||''} ${nat.ideology}</small>`;
    b.onclick=()=>{
      document.querySelectorAll('.rbtn').forEach(x=>x.classList.remove('pick'));
      b.classList.add('pick'); SC=i; SI=nat.ideology;
      // Show selected ideology
      const idObj=IDEOLOGIES[SI];
      const isDict=['fascism','nazism','communism','stalinism','militarism'].includes(SI);
      document.getElementById('ideo-grid').innerHTML=`
        <div style="display:flex;align-items:center;gap:10px;padding:10px;border:1px solid ${idObj.border};background:rgba(0,0,0,.3)">
          <span style="font-size:22px">${idObj.icon}</span>
          <div>
            <div style="font-family:'Cinzel',serif;font-size:12px;color:${idObj.color}">${idObj.name}</div>
            <div style="font-size:9px;color:${isDict?'#ff8844':'#80c070'};margin-top:2px">${isDict?'⚠ Dictatorship — ideology change requires Revolution':'✦ Reform available in-game for 200g'}</div>
          </div>
        </div>`;
      chkSB();
    };
    rg.appendChild(b);
  });
})();
function chkSB(){document.getElementById('startbtn').disabled=SC<0||!SI;}

// ── SCREEN MANAGEMENT ─────────────────────────────────────
function show(id){document.querySelectorAll('.scr').forEach(e=>e.classList.remove('on'));document.getElementById('s-'+id).classList.add('on');}
function switchTab(id){document.querySelectorAll('.tab,.tpane').forEach(e=>e.classList.remove('on'));document.getElementById('tab-'+id).classList.add('on');document.getElementById('pane-'+id).classList.add('on');}
function setMapMode(mode){G.mapMode=mode;document.querySelectorAll('.mmbtn').forEach(b=>b.classList.remove('on'));document.getElementById('mm-'+mode).classList.add('on');scheduleDraw();}

// ── GAME START ────────────────────────────────────────────
function startGame(){
  if(SC<0)return;
  G.leaderName=document.getElementById('rname').value.trim()||'The Leader';
  G.ideology=SI||'fascism';G.playerNation=SC;
  G.month=0;G.year=1936;
  initDiplo();
  G.owner=PROVINCES.map(p=>p.nation??-1);
  G.pop=PROVINCES.map(p=>p.isCapital?ri(800000,3000000):ri(200000,1500000));
  G.army=PROVINCES.map(()=>ri(3000,12000));
  G.income=PROVINCES.map(p=>p.isCapital?ri(120,280):ri(40,130));
  G.instab=PROVINCES.map(()=>0);
  G.assim=PROVINCES.map(()=>100);
  G.disease=PROVINCES.map(()=>0);
  G.buildings=PROVINCES.map(()=>[]);
  G.resistance=PROVINCES.map(()=>0);
  G.resistSponsor=PROVINCES.map(()=>-1);
  G.resBase=PROVINCES.map(p=>({...((p.res)||{})}));
  G.resPool={oil:0,coal:0,grain:0,steel:0};
  G.loans=[];G.totalDebt=0;
  G.fleet=[];
  G.moveFrom=-1;G.moveMode=false;G.navalMode=false;G.navalFrom=-1;G.sel=-1;
  G.gold[SC]=1200;
  NATIONS.forEach((_,i)=>{if(i!==SC)G.gold[i]=ri(400,900);});
  regsOf(SC).forEach(i=>{G.army[i]+=3000;});
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
  ctx2.beginPath();
  for(let i=0;i<6;i++){
    const a=Math.PI/3*i-Math.PI/6;
    const x=cx+Math.cos(a)*r*1.05,y=cy+Math.sin(a)*r*0.9;
    i===0?ctx2.moveTo(x,y):ctx2.lineTo(x,y);
  }
  ctx2.closePath();
}

// ── COLORS ────────────────────────────────────────────────
const TC={plains:'#3a4828',forest:'#2a3a1c',mountain:'#4a3e30',swamp:'#405838',desert:'#4a3e28',urban:'#2a2420',tundra:'#354040'};
const RES_COLORS={oil:'#8a6020',coal:'#303030',grain:'#5a7020',steel:'#405070'};

function provColor(i){
  const o=G.owner[i],m=G.mapMode;
  if(m==='disease'){const d=G.disease[i];return d>70?'#8a1818':d>40?'#6a3018':d>10?'#4a3518':TC[PROVINCES[i].terrain]||'#2a2a2a';}
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
  if(o<0)return'#181618';
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

  
  // Draw hexes — two passes: fill then borders (avoids overdraw artifacts)
  PROVINCES.forEach((p,i)=>{
    if(p.cx<wx0-30||p.cx>wx1+30||p.cy<wy0-30||p.cy>wy1+30)return;
    const r=scaledR(i);
    hexPath(ctx,p.cx,p.cy,r);
    ctx.fillStyle=provColor(i);
    ctx.fill();
  });

  // Borders + selected highlight
  PROVINCES.forEach((p,i)=>{
    if(p.cx<wx0-30||p.cx>wx1+30||p.cy<wy0-30||p.cy>wy1+30)return;
    const r=scaledR(i);
    hexPath(ctx,p.cx,p.cy,r);
    if(i===G.sel){ctx.strokeStyle='rgba(255,255,255,.95)';ctx.lineWidth=2/vp.scale;}
    else if(G.moveMode&&G.moveFrom>=0&&isMoveTgt(i)){ctx.strokeStyle='rgba(80,255,80,.9)';ctx.lineWidth=1.6/vp.scale;}
    else if(G.navalMode&&G.navalFrom>=0&&navalDests(G.navalFrom).includes(i)){ctx.strokeStyle='rgba(80,200,255,.9)';ctx.lineWidth=1.6/vp.scale;}
    else{ctx.strokeStyle='rgba(6,8,14,.9)';ctx.lineWidth=.7/vp.scale;}
    ctx.stroke();
  });

  // Labels — only when zoomed enough
  if(vp.scale>0.55){
    PROVINCES.forEach((p,i)=>{
      if(p.cx<wx0-25||p.cx>wx1+25||p.cy<wy0-25||p.cy>wy1+25)return;
      const r=scaledR(i);
      const fs=Math.max(3,Math.min(7,r*.42));

      // Province name
      ctx.font=`600 ${fs}px Cinzel,serif`;
      ctx.fillStyle=p.isCapital?'#f0d080':'rgba(232,213,163,.9)';
      ctx.textAlign='center';ctx.textBaseline='middle';
      ctx.shadowColor='rgba(0,0,0,.9)';ctx.shadowBlur=3;
      ctx.fillText(p.short.length>8?p.short.slice(0,8):p.short,p.cx,p.cy-(G.army[i]>0?2:0));
      ctx.shadowBlur=0;

      // Army count
      if(G.army[i]>0){
        ctx.font=`${Math.max(3.5,fs-1.5)}px Cinzel,serif`;
        ctx.fillStyle='rgba(232,205,145,.8)';
        ctx.fillText(fm(G.army[i]),p.cx,p.cy+fs*.7);
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
}


// ── INPUT: PAN / ZOOM / CLICK ──────────────────────────────
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

function onCanvasClick(wx,wy){
  const i=hitProv(wx,wy);if(i<0)return;
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
  G.sel=i;scheduleDraw();updateSP(i);chkBtns();
  if(window.innerWidth<=700)switchTab('info');
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
  const mr=regsOf(G.playerNation);let ta=0,tp=0;
  mr.forEach(r=>{ta+=G.army[r];tp+=G.pop[r];});
  const fs=Math.floor(tp/10)-ta;
  const debt=G.loans.reduce((s,l)=>s+l.amount,0);
  sEl('h-date',dateStr());sEl('h-reg',mr.length+'/'+LAND.length);
  sEl('h-gld',fa(G.gold[G.playerNation]));
  sEl('h-arm',fa(ta));sEl('h-pop',fm(tp));
  sEl('h-supply',(fs>=0?'+':'')+fa(fs));
  document.getElementById('h-supply-st').classList.toggle('warn',fs<0);
  const loanSt=document.getElementById('h-loan-st');
  if(loanSt){loanSt.style.display=debt>0?'flex':'none';sEl('h-debt',fa(debt));}
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
  sEl('sp-bld-sub',o===G.playerNation?`${bldC}/${maxBld} slots`:'Select your territory');
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

function chkBtns(){
  const si=G.sel,PN=G.playerNation;
  const canAtk=si>=0&&G.owner[si]!==PN&&G.owner[si]>=0;
  const fr=canAtk?regsOf(PN).find(r=>G.army[r]>100&&NB[r]?.includes(si)):undefined;
  const ok=fr!==undefined&&canAtk;
  ['btn-atk','sp-btn-atk'].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=!ok;});
  sEl('sp-atk-sub',!canAtk?'Select enemy':ok?`${PROVINCES[fr].short}→${PROVINCES[si].short}`:'No army on border');
  sEl('atk-sub',ok?`${PROVINCES[fr].short}→${PROVINCES[si].short}`:'Select enemy');
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

let _popT;
function popup(msg,dur=2600){const p=document.getElementById('popup');p.textContent=msg;p.classList.add('on');clearTimeout(_popT);_popT=setTimeout(()=>p.classList.remove('on'),dur);}
function addLog(msg,type='info'){
  const e=`<div class="le"><span class="lt">${dateStr()}</span><span class="lm ${type}">${msg}</span></div>`;
  ['log','mob-log'].forEach(id=>{const l=document.getElementById(id);if(!l)return;if(id==='log'&&l.children.length===1&&l.children[0].style.textAlign==='center')l.innerHTML='';l.insertAdjacentHTML('afterbegin',e);while(l.children.length>80)l.removeChild(l.lastChild);});
}
function setEB(d){['end-btn','end-btn-mob'].forEach(id=>{const b=document.getElementById(id);if(b)b.disabled=d;});}


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
  const mr=regsOf(G.playerNation);if(!mr.length){popup('No territories!');return;}
  const io=ideol();
  openMo('CONSCRIPTION',`<p class="mx">Cost: <b>1,000 pop + 1 gold</b>/soldier · ${io.icon} efficiency ×${(1/io.conscriptMod).toFixed(2)}</p><p class="mx">Treasury: <b>${fa(G.gold[G.playerNation])}</b></p><div class="tlist">${mr.map(r=>{const hb=(G.buildings[r]||[]).includes('barracks'),cap=Math.min(25000,Math.floor(G.pop[r]/1000*(hb?1.5:1)/io.conscriptMod),G.gold[G.playerNation]);return`<div class="ti" onclick="pickDR(${r})" id="dr${r}"><span class="tn">${PROVINCES[r].short}${PROVINCES[r].isCapital?'★':''}</span><span class="ta">⚔${fm(G.army[r])}<br>Max:${fm(Math.max(0,cap))}</span></div>`;}).join('')}</div><div id="dslw" style="display:none"><div class="slider-w"><div class="slider-l"><span>Soldiers</span><span class="slider-v" id="dsv">0</span></div><input type="range" id="dsl" min="0" max="1000" value="0" oninput="updSl('dsl','dsv')"></div></div>`,
    [{lbl:'Cancel',cls:'dim'}]);
  window._dr=-1;
}
function pickDR(r){
  document.querySelectorAll('[id^="dr"]').forEach(e=>e.style.borderColor='');
  const el=document.getElementById('dr'+r);if(el)el.style.borderColor='var(--gold)';
  window._dr=r;
  const io=ideol(),hb=(G.buildings[r]||[]).includes('barracks');
  const cap=Math.max(0,Math.min(25000,Math.floor(G.pop[r]/1000*(hb?1.5:1)/io.conscriptMod),G.gold[G.playerNation]));
  const w=document.getElementById('dslw');if(w)w.style.display=cap>0?'block':'none';
  if(!cap){popup('Cannot conscript here!');return;}
  const sl=document.getElementById('dsl');if(sl){sl.max=cap;sl.value=Math.min(2000,Math.floor(cap/2));updSl('dsl','dsv');}
  const bw=document.getElementById('mo-btns');bw.innerHTML='';
  [{lbl:'Cancel',cls:'dim',cb:null},{lbl:'Conscript',cls:'grn',cb:confirmDraft}].forEach(({lbl,cls,cb})=>{const b=document.createElement('button');b.className='btn '+cls;b.textContent=lbl;b.onclick=()=>{closeMo();cb&&cb();};bw.appendChild(b);});
}
function confirmDraft(){
  const r=window._dr;if(r<0)return;
  const v=+(document.getElementById('dsl')?.value||0);if(!v)return;
  const io=ideol(),popCost=v*1000*io.conscriptMod;
  if(G.pop[r]<popCost){popup('Not enough population!');return;}
  if(G.gold[G.playerNation]<v){popup('Not enough gold!');return;}
  G.pop[r]-=popCost;G.army[r]+=v;G.gold[G.playerNation]-=v;
  scheduleDraw();updateHUD();if(G.sel>=0)updateSP(G.sel);
  addLog(`${PROVINCES[r].short}: ${fa(v)} soldiers conscripted.`,'info');
  popup(`✓ ${fa(v)} mobilized`);
}


// ── BUILD ─────────────────────────────────────────────────
function openBuild(){
  const si=G.sel;
  if(si<0||G.owner[si]!==G.playerNation){popup('Select your territory!');return;}
  const p=PROVINCES[si],io=ideol(),cm=io.buildCostMod||1;
  const maxBld=p.isCapital?MAX_BLD_CAP:MAX_BLD_NORM,ex=G.buildings[si]||[];
  if(ex.length>=maxBld){popup(`Building limit (${maxBld}) reached!`);return;}
  const opts=Object.entries(BUILDINGS).filter(([k,b])=>!ex.includes(k)&&(!b.capitalOnly||p.isCapital)&&(!b.needsCoast||p.isCoastal)&&(!b.needsRes||(G.resBase[si][b.needsRes]||0)>0));
  const html=`<p class="mx">Build in <b>${p.name}</b>${p.isCapital?' ★':''} · Slots: <b>${ex.length}/${maxBld}</b> · Gold: <b>${fa(G.gold[G.playerNation])}</b>${cm!==1?' · '+io.icon+' ×'+cm.toFixed(2):''}</p><div class="tlist">${opts.map(([k,b])=>{const cost=Math.round(b.cost*cm),ok=G.gold[G.playerNation]>=cost;return`<div class="ti${ok?'':' ene'}" onclick="${ok?`doB('${k}',${si})`:''}"><span class="tn">${b.name}</span><span class="ta">${b.desc}<br><span style="color:${ok?'#c8a030':'#444'}">${fa(cost)}g</span></span></div>`;}).join('')}</div>`;
  openMo('CONSTRUCTION',html,[{lbl:'Cancel',cls:'dim'}]);
}
function doB(k,ri2){closeMo();const io=ideol(),cost=Math.round(BUILDINGS[k].cost*(io.buildCostMod||1));if(G.gold[G.playerNation]<cost){popup('Insufficient gold!');return;}G.gold[G.playerNation]-=cost;(G.buildings[ri2]=G.buildings[ri2]||[]).push(k);scheduleDraw();updateHUD();if(G.sel===ri2)updateSP(ri2);addLog(`${PROVINCES[ri2].short}: ${BUILDINGS[k].name} built.`,'build');popup(`✓ ${BUILDINGS[k].name} built!`);}

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

// ── REVOLUTION ────────────────────────────────────────────
function openRevolution(){
  const isDictatorship = ['fascism','nazism','communism','stalinism','militarism'].includes(G.ideology);
  const cost = isDictatorship ? 500 : 200;
  const note = isDictatorship
    ? '<p class="mx warn">⚠ <b>Dictatorship:</b> Revolution costs <b>500g</b> + massive instability (+40).</p>'
    : '<p class="mx">Reform costs <b>200g</b> + minor instability (+10).</p>';
  const html=`${note}
  <p class="mx">Current: <b style="color:${ideol().color}">${ideol().icon} ${ideol().name}</b> · Gold: <b>${fa(G.gold[G.playerNation])}</b></p>
  <div class="ideo-mo-list">${Object.entries(IDEOLOGIES).filter(([k])=>k!==G.ideology).map(([key,id])=>`<div class="ideo-mo-card" onclick="doRevolution('${key}',${cost})" style="border-color:${id.border}">
    <span style="font-size:18px">${id.icon}</span>
    <span style="font-family:'Cinzel',serif;font-size:10px;color:${id.color}">${id.name}</span>
  </div>`).join('')}</div>`;
  openModal('Revolution',html,'');
}
function doRevolution(key, cost){
  const isDictatorship = ['fascism','nazism','communism','stalinism','militarism'].includes(G.ideology);
  if(G.gold[G.playerNation]<cost){showToast('Not enough gold!');return;}
  G.gold[G.playerNation]-=cost;
  const instHit = isDictatorship ? 40 : 10;
  regsOf(G.playerNation).forEach(i=>{G.instab[i]=Math.min(100,G.instab[i]+instHit);});
  G.ideology=key;
  closeModal();
  updateHUD();scheduleDraw();
  showToast(`Revolution! New ideology: ${IDEOLOGIES[key].icon} ${IDEOLOGIES[key].name}`);
}

function endTurn(){
  setEB(true);cancelMove();cancelNaval();
  const io=ideol(),PN=G.playerNation,s=season();

  // Resources
  gatherResources();

  // Process loans
  processLoans();

  // Player income + growth
  regsOf(PN).forEach(r=>{
    let inc=G.income[r];
    if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);
    if((G.buildings[r]||[]).includes('palace'))inc=Math.floor(inc*1.15);
    inc=Math.floor(inc*io.income*(1-Math.min(.5,G.instab[r]/100))*s.incomeMod);
    G.gold[PN]+=inc;
    // Puppet tribute
    G.puppet.forEach(pp=>{
      regsOf(pp).forEach(pr=>{let pi=G.income[pr];if((G.buildings[pr]||[]).includes('factory'))pi=Math.floor(pi*1.8);G.gold[PN]+=Math.floor(pi*.3);});
    });
    // Population growth
    let pgr=G.pop[r]*.005*io.popGrowth;
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
    // Disease
    if(G.disease[r]>0){
      G.pop[r]=Math.max(1000,G.pop[r]-Math.floor(G.pop[r]*G.disease[r]/2000));
      G.disease[r]=Math.max(0,G.disease[r]-ri(2,8)*((G.buildings[r]||[]).includes('hospital')?.5:1));
    }
    // Revolt check
    if(G.instab[r]>85&&G.assim[r]<30&&Math.random()<.28)triggerRevolt(r,io);
  });

  if(G.capitalPenalty[PN]>0)G.capitalPenalty[PN]--;

  // NAP expiry
  for(let a=0;a<NATIONS.length;a++)for(let b=0;b<NATIONS.length;b++)if(G.pact[a][b]){G.pLeft[a][b]--;if(G.pLeft[a][b]<=0){G.pact[a][b]=false;G.pLeft[a][b]=0;}}

  // Naval arrivals
  resolveNavalArrivals();

  // Resistance
  processResistance();

  // AI turns
  doAI();

  // Random event
  if(Math.random()<.25)randEvent(io);
  if(Math.random()<.04)spreadDisease();

  // Advance time
  G.month=(G.month+1)%12;if(G.month===0)G.year++;

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
  const hi=Math.floor(Math.random()*LAND.length);
  const i=PROVINCES.findIndex(p=>p===LAND[hi]);if(i<0)return;
  G.disease[i]=Math.min(100,G.disease[i]+ri(10,30));
  NB[i].forEach(nb=>{if(Math.random()<.4)G.disease[nb]=Math.min(100,G.disease[nb]+ri(3,12));});
}

// ── AI ────────────────────────────────────────────────────
function doAI(){
  for(const ai of aliveNations()){
    const ar=regsOf(ai);if(!ar.length)continue;
    const aio=IDEOLOGIES[NATIONS[ai]?.ideology||'nationalism'];
    const s=season();
    // Income
    for(const r of ar){let inc=G.income[r];if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);G.gold[ai]+=Math.floor(inc*.78);}
    // Conscript
    for(const r of ar){const mx=Math.min(2500,Math.floor(G.pop[r]/1000),G.gold[ai]);if(mx>0){G.army[r]+=mx;G.pop[r]-=mx*1000;G.gold[ai]-=mx;}}
    // Attack
    if(Math.random()<.35){
      const tgts=[];
      for(const r of ar){if(G.army[r]<150||!NB[r])continue;for(const nb of NB[r]){const nbo=G.owner[nb];if(nbo!==ai&&!G.pact[ai][nbo]&&!areAllies(ai,nbo))tgts.push([r,nb]);}}
      if(tgts.length){
        const[fr2,to2]=tgts[Math.floor(Math.random()*tgts.length)];
        const def3=G.owner[to2],send=Math.max(1,Math.floor(G.army[fr2]*.42));
        if(def3>=0&&def3!==ai)G.war[ai][def3]=G.war[def3][ai]=true;
        const terrain2=TERRAIN[PROVINCES[to2].terrain||'plains'],frt=(G.buildings[to2]||[]).includes('fortress')?1.6:1;
        const terrMod=s.winterTerrain?.includes(PROVINCES[to2].terrain)?s.moveMod:1.0;
        const win=send*aio.atk*terrMod*rf(.75,1.25)>G.army[to2]*terrain2.defB*frt*rf(.75,1.25);
        if(win){
          const al=Math.floor(send*rf(.13,.35));
          G.army[fr2]-=send;G.army[to2]=Math.max(150,send-al);G.owner[to2]=ai;
          G.instab[to2]=ri(30,60);G.assim[to2]=ri(5,20);
          if((G.buildings[to2]||[]).includes('fortress'))G.buildings[to2]=G.buildings[to2].filter(b=>b!=='fortress');
          if(def3===G.playerNation)addLog(`⚔ ${ownerName(ai)} seized ${PROVINCES[to2].name}!`,'war');
          if(def3>=0&&regsOf(def3).length===0)G.war[ai][def3]=G.war[def3][ai]=false;
          if(PROVINCES[to2].isCapital&&def3>=0)G.capitalPenalty[ai]=3;
        }else{G.army[fr2]=Math.max(0,G.army[fr2]-Math.floor(send*rf(.13,.35)));G.army[to2]=Math.max(150,G.army[to2]-Math.floor(G.army[to2]*rf(.1,.3)));}
      }
    }
    // Puppet tribute
    if(G.puppet.includes(ai)){G.gold[G.playerNation]+=Math.floor(ar.reduce((s,r)=>{let inc=G.income[r];if((G.buildings[r]||[]).includes('factory'))inc=Math.floor(inc*1.8);return s+inc;},0)*.3);}
    // Basic upkeep
    for(const r of ar){G.pop[r]+=Math.floor(G.pop[r]*.004);G.instab[r]=Math.max(0,G.instab[r]-ri(1,5));if(G.assim[r]<100)G.assim[r]=Math.min(100,G.assim[r]+ri(1,3));}
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

