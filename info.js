// ═══════════════════════════════════════════════════════
// TIME OF CONQUEST 1936 — MAP DATA
// Edit this file to change provinces, nations, terrain
// ═══════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════
//  TIME OF CONQUEST 1936 — v5
//  Canvas renderer, new mechanics: resources, loans,
//  resistance, alliances, seasons, puppets
// ══════════════════════════════════════════════════════════

// ── IDEOLOGIES ────────────────────────────────────────────
const IDEOLOGIES={
  fascism:{icon:'⚡',name:'Fascism',color:'#e87020',border:'#a05010',atk:1.35,def:1.0,income:1.20,popGrowth:1.0,assimSpeed:.70,instabDecay:1.25,conscriptMod:1.0,pactChance:.60,buildCostMod:1.0,revoltScale:1.6,buffs:['+35% atk','+20% income'],debuffs:['-40% pact','×1.6 revolt']},
  nazism:{icon:'🦅',name:'Natl.Socialism',color:'#a81418',border:'#700c0c',atk:1.45,def:.85,income:1.10,popGrowth:1.0,assimSpeed:.60,instabDecay:1.10,conscriptMod:.70,pactChance:.50,buildCostMod:1.0,revoltScale:1.8,extraConqInstab:30,buffs:['+45% atk','+30% conscript'],debuffs:['×1.8 revolt','-50% pact']},
  communism:{icon:'☭',name:'Communism',color:'#e03030',border:'#901818',atk:1.0,def:1.30,income:.75,popGrowth:1.0,assimSpeed:1.0,instabDecay:1.0,conscriptMod:.60,pactChance:.80,buildCostMod:.70,revoltScale:1.0,buffs:['+30% def','-30% build'],debuffs:['-25% income']},
  stalinism:{icon:'🔴',name:'Stalinism',color:'#c82020',border:'#801010',atk:1.05,def:1.25,income:.65,popGrowth:.90,assimSpeed:.80,instabDecay:.90,conscriptMod:.50,pactChance:.40,buildCostMod:.75,revoltScale:1.4,buffs:['+25% def','-25% build'],debuffs:['-35% income','×1.4 revolt']},
  democracy:{icon:'🗳',name:'Democracy',color:'#4880d8',border:'#2850a0',atk:.80,def:1.0,income:1.0,popGrowth:1.30,assimSpeed:1.25,instabDecay:1.0,conscriptMod:1.15,pactChance:1.15,buildCostMod:1.0,revoltScale:.8,buffs:['+30% pop','+25% assim'],debuffs:['-20% atk']},
  socialdem:{icon:'🌹',name:'Social Democracy',color:'#e05080',border:'#903050',atk:.85,def:1.0,income:1.20,popGrowth:1.20,assimSpeed:1.30,instabDecay:1.10,conscriptMod:1.10,pactChance:1.10,buildCostMod:1.15,revoltScale:.7,buffs:['+20% income','-30% revolt'],debuffs:['-15% atk']},
  monarchy:{icon:'👑',name:'Monarchy',color:'#c8a030',border:'#887010',atk:1.20,def:1.15,income:1.05,popGrowth:.85,assimSpeed:.90,instabDecay:1.0,conscriptMod:1.0,pactChance:1.0,buildCostMod:1.0,revoltScale:1.0,buffs:['+20% atk','+15% def'],debuffs:['-15% pop']},
  liberalism:{icon:'🏛',name:'Liberalism',color:'#50b8c0',border:'#307880',atk:.75,def:.90,income:1.15,popGrowth:1.25,assimSpeed:1.35,instabDecay:1.05,conscriptMod:1.20,pactChance:1.20,buildCostMod:.90,revoltScale:.7,buffs:['+35% assim','+20% pact'],debuffs:['-25% atk']},
  militarism:{icon:'⚙',name:'Militarism',color:'#909080',border:'#605040',atk:1.30,def:1.20,income:.70,popGrowth:.80,assimSpeed:.65,instabDecay:.90,conscriptMod:.60,pactChance:.90,buildCostMod:.75,revoltScale:1.2,buffs:['+30% atk','+20% def','-25% build'],debuffs:['-30% income']},
  nationalism:{icon:'🏴',name:'Nationalism',color:'#c08030',border:'#805020',atk:1.25,def:1.10,income:1.20,popGrowth:1.0,assimSpeed:1.20,instabDecay:1.30,conscriptMod:1.15,pactChance:.75,buildCostMod:1.0,revoltScale:1.0,extraConqInstab:30,buffs:['+25% atk','+20% income'],debuffs:['-25% pact','+30 instab on conq']},
};

// ── BUILDINGS ─────────────────────────────────────────────
const BUILDINGS={
  factory: {name:'🏭 Factory',  cost:250,desc:'Income ×1.8',icon:'🏭'},
  fortress:{name:'🏰 Fortress', cost:300,desc:'Def +60%, -instab',icon:'🏰'},
  barracks:{name:'⛺ Barracks', cost:180,desc:'Conscript cap +50%',icon:'⛺'},
  port:    {name:'⚓ Port',     cost:200,desc:'Naval transport',icon:'⚓',needsCoast:true},
  hospital:{name:'🏥 Hospital', cost:200,desc:'Disease -40%, pop +10%',icon:'🏥'},
  oilwell: {name:'🛢 Oil Well', cost:280,desc:'Oil +2 per turn',icon:'🛢',needsRes:'oil'},
  mine:    {name:'⛏ Mine',     cost:220,desc:'Coal/Steel +2 per turn',icon:'⛏'},
  granary: {name:'🌾 Granary',  cost:160,desc:'Grain +2, pop growth +15%',icon:'🌾'},
  palace:  {name:'🏛 Palace',   cost:400,desc:'Stability +15, income +15%',icon:'🏛',capitalOnly:true},
  academy: {name:'🎓 Academy',  cost:350,desc:'Assimilation ×2',icon:'🎓',capitalOnly:true},
  arsenal: {name:'⚙ Arsenal',  cost:320,desc:'Attack +20%',icon:'⚙',capitalOnly:true},
};
const MAX_BLD_NORM=3,MAX_BLD_CAP=5;

// ── TERRAIN ───────────────────────────────────────────────
// defB = defence bonus multiplier
// incM = income multiplier
// movM = movement cost multiplier
const TERRAIN={
  plains:   {name:'Plains',   defB:1.00, incM:1.10, movM:1.0, col:'#3a4828'},
  forest:   {name:'Forest',   defB:1.25, incM:0.90, movM:0.8, col:'#2a3a1c'},
  mountain: {name:'Mountain', defB:1.60, incM:0.65, movM:0.5, col:'#4a3e30'},
  hills:    {name:'Hills',    defB:1.30, incM:0.85, movM:0.7, col:'#5a5a38'},
  highland: {name:'Highland', defB:1.40, incM:0.75, movM:0.6, col:'#5a4e3c'},
  swamp:    {name:'Swamp',    defB:1.15, incM:0.75, movM:0.5, col:'#405838'},
  marsh:    {name:'Marsh',    defB:1.10, incM:0.70, movM:0.5, col:'#384838'},
  desert:   {name:'Desert',   defB:0.90, incM:0.70, movM:0.7, col:'#4a3e28'},
  steppe:   {name:'Steppe',   defB:0.85, incM:0.80, movM:1.1, col:'#5a4e28'},
  savanna:  {name:'Savanna',  defB:0.95, incM:0.85, movM:1.0, col:'#6a5a28'},
  scrub:    {name:'Scrub',    defB:1.05, incM:0.80, movM:0.9, col:'#5a5a28'},
  jungle:   {name:'Jungle',   defB:1.35, incM:0.70, movM:0.5, col:'#1e4c2c'},
  taiga:    {name:'Taiga',    defB:1.20, incM:0.75, movM:0.7, col:'#2a4a38'},
  tundra:   {name:'Tundra',   defB:1.10, incM:0.55, movM:0.8, col:'#354040'},
  ice:      {name:'Ice',      defB:0.80, incM:0.20, movM:0.4, col:'#6a7878'},
  farmland: {name:'Farmland', defB:0.95, incM:1.30, movM:1.0, col:'#506038'},
  urban:    {name:'Urban',    defB:1.35, incM:1.50, movM:0.9, col:'#2a2420'},
  volcanic: {name:'Volcanic', defB:0.75, incM:0.50, movM:0.6, col:'#4a2820'},
};

// ── SEASONS ───────────────────────────────────────────────
const SEASONS=[
  {name:'Winter',icon:'❄️',moveMod:.50,incomeMod:.90,winterTerrain:['tundra','mountain','forest'],desc:'Snow slows armies in harsh terrain'},
  {name:'Spring',icon:'🌸',moveMod:1.0,incomeMod:1.0,desc:'Normal conditions'},
  {name:'Spring',icon:'🌸',moveMod:1.0,incomeMod:1.0,desc:'Normal conditions'},
  {name:'Summer',icon:'☀️',moveMod:1.0,incomeMod:1.10,desc:'Harvest season, +10% income'},
  {name:'Summer',icon:'☀️',moveMod:1.0,incomeMod:1.10,desc:'Harvest season'},
  {name:'Summer',icon:'☀️',moveMod:1.0,incomeMod:1.10,desc:'Harvest season'},
  {name:'Autumn',icon:'🍂',moveMod:1.0,incomeMod:1.0,desc:'Normal conditions'},
  {name:'Autumn',icon:'🍂',moveMod:1.0,incomeMod:1.0,desc:'Normal conditions'},
  {name:'Autumn',icon:'🍂',moveMod:0.9,incomeMod:1.0,desc:'Mud slows movement'},
  {name:'Winter',icon:'❄️',moveMod:.50,incomeMod:.90,winterTerrain:['tundra','mountain','forest'],desc:'Snow slows armies'},
  {name:'Winter',icon:'❄️',moveMod:.50,incomeMod:.90,winterTerrain:['tundra','mountain','forest'],desc:'Deep winter'},
  {name:'Winter',icon:'❄️',moveMod:.40,incomeMod:.85,winterTerrain:['tundra','mountain','forest','plains'],desc:'Severe winter'},
];
function getSeason(month){return SEASONS[month]||SEASONS[0];}

// ── PROVINCE HELPERS (depend on PROVINCES from map file) ─

const TOTAL=PROVINCES.length;
const LAND=PROVINCES.filter(p=>!p.isSea);
const P=0;

// Province index by id
const PIDX={};
PROVINCES.forEach((p,i)=>PIDX[p.id]=i);
const pidx=id=>PIDX[id]??-1;


// ── ADJACENCY (auto-computed from coordinates) ────────────
const NB=Array.from({length:100},()=>[]);
function ae(a,b){const ai=pidx(a),bi=pidx(b);if(ai<0||bi<0)return;if(!NB[ai].includes(bi))NB[ai].push(bi);if(!NB[bi].includes(ai))NB[bi].push(ai);}
[[0,1],[0,18],[1,2],[2,3],[3,4],[4,7],[5,6],[5,8],[6,7],[8,9],[9,10],[10,11],[11,12],[12,14],[13,15],[14,17],[15,16],[16,17],[18,23],[19,22],[19,30],[20,21],[20,23],[21,22],[24,25],[24,44],[25,26],[25,44],[26,27],[27,28],[27,45],[28,29],[29,30],[31,35],[31,36],[32,33],[32,51],[33,34],[34,35],[36,37],[37,38],[37,39],[37,40],[38,40],[39,40],[39,41],[41,42],[42,45],[43,44],[43,45],[46,47],[46,50],[47,49],[48,49],[48,53],[50,51],[52,54],[52,56],[53,54],[55,56],[55,57],[57,58],[58,74],[58,75],[60,61],[60,68],[60,77],[61,62],[61,67],[61,68],[62,63],[62,67],[63,64],[63,66],[63,67],[65,66],[65,67],[65,68],[65,73],[66,67],[67,68],[68,73],[68,77],[69,73],[69,74],[69,78],[70,71],[70,72],[71,72],[73,77],[73,78],[74,75],[74,78],[75,76],[75,78],[76,77],[76,78],[77,78]].forEach(([a,b])=>ae(a,b));

// ── NAVAL ZONES ───────────────────────────────────────────
const NAVAL_ZONES={
  atlantic:[0,1,2,3,4,5,8,13,18,21,22,23,24,25,129],
  north_sea:[15,16,17,22,23,24,25,26,28,35,36],
  norwegian:[31,32,33,52,109,129,137],
  baltic:[26,28,34,36,37,38,39,41,55,56,64,68,69],
  med_west:[8,10,11,44,50,51,114],
  med_central:[42,43,45,46,47,50,51,114],
  med_east:[42,46,47,83,84,85,89,91,92,115],
  adriatic:[42,45,46,83,87,88],
  aegean:[84,85,89,91,92,115],
  black_sea:[73,91,93,96,101,102],
  caspian:[104,113,140,146],
  arctic:[33,52,108,109,136,137],
};
function getNavalZones(provId){return Object.entries(NAVAL_ZONES).filter(([,ids])=>ids.includes(provId)).map(([z])=>z);}
function getNavalReach(fromIdx){
  const fId=PROVINCES[fromIdx].id,zones=getNavalZones(fId);
  if(!zones.length)return[];
  const reach=new Set();
  zones.forEach(z=>NAVAL_ZONES[z].forEach(id=>{if(id!==fId){const i=pidx(id);if(i>=0)reach.add(i);}}));
  return[...reach];
}
function hasPort(i){const p=PROVINCES[i];return(G.buildings[i]||[]).includes('port')||(p.isCapital&&p.isCoastal);}
function canLaunchNaval(i){const p=PROVINCES[i];return G.owner[i]===G.playerNation&&p.isCoastal&&hasPort(i)&&G.army[i]>100;}
function navalDests(fromIdx){return getNavalReach(fromIdx).filter(di=>{const p=PROVINCES[di];if(!p.isCoastal)return false;const o=G.owner[di];return o===G.playerNation||o<0||G.war[G.playerNation]?.[o];});}


// ── GAME STATE ────────────────────────────────────────────
