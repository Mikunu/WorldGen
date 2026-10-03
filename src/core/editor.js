import {makeGrid,clamp,normalize} from './grid.js';
import {pointDistance,pointCoordinates,sphericalPoint} from './spatial.js';
import {climate} from './climate.js';
import {hydrology} from './hydrology.js';
import {geologicalAtlas} from './geological-atlas.js';
import {makeProspectivitySampler} from './mineralization.js';
import {depositModels,generateDeposits} from './deposit-models.js';
import {minerals} from './geology-catalog.js';
import {summarize,validateWorld,validateConfig,ALGORITHM_VERSION,serializeWorld} from './world.js';

export const defaultRules={density:1,majorFactor:1,occurrenceFactor:1,majorSpacing:120,minorSpacing:40,depthScale:1,gradeScale:1,modelIds:depositModels.map(m=>m.id)};
export const rulePresets={
  ordinary:{...defaultRules},
  poor:{...defaultRules,density:.5,majorFactor:.5},
  rich:{...defaultRules,density:3},
  coal:{...defaultRules,density:3,modelIds:['coal-basin']},
  gold:{...defaultRules,density:.5,gradeScale:1.5,modelIds:['gold-vein']}
};
const gridOf=w=>makeGrid(w.grid.width,w.grid.height,w.grid.radiusKm);
const clone=value=>structuredClone(value);
function bounded(value,min,max,label) {
  if(!Number.isFinite(value)||value<min||value>max)throw new Error(`${label}: допустимо ${min}–${max}`);
  return value;
}
function position(p) {
  if(!Array.isArray(p)||p.length!==3||p.some(x=>!Number.isFinite(x))||Math.abs(Math.hypot(...p)-1)>1e-9)throw new Error('Некорректные координаты на сфере');
  return normalize(p);
}
export function validateArea(area,radiusKm) {
  if(!area)return null;
  return {center:position(area.center),radiusKm:bounded(area.radiusKm,1,Math.PI*radiusKm,'Радиус области')};
}
export function inArea(p,area,radiusKm) {return !area||pointDistance(p,area.center,radiusKm)<=area.radiusKm;}
export function initializeEditor(world) {
  if(world.editor)return world;
  world.editor={version:1,revision:0,nextBodyId:Math.max(-1,...world.atlas.deposits.map(d=>d.oreBodyId))+1,
    locks:{terrain:false,resources:false,areas:[]},rainAdjustments:new Float64Array(world.grid.size),
    rules:{...clone(defaultRules),density:world.config.resourceDensity??1},zones:[],annotations:[],appearance:{theme:'natural',labels:true,markerScale:1,opacity:1},events:[]};
  return world;
}
function protectedPoint(w,p,domain) {
  return w.editor.locks[domain]||w.editor.locks.areas.some(a=>a[domain]&&inArea(p,a.area,w.grid.radiusKm));
}
function authored(d,reason) {d.provenance='authored';d.exceptionReason=reason;d.sourceDepositId=null;}
function updateResource(d,w,grid) {
  d.cell=grid.sample(d.position);Object.assign(d,pointCoordinates(d.position));d.provinceId=w.atlas.provinceId[d.cell];
  const mineral=minerals[d.mineral];d.gradeUnit=mineral.unit;d.resourceBasis=mineral.resourceBasis;d.oreMinerals=mineral.oreMinerals;
  d.containedResourceTonnes=d.oreMassMt*1e6*d.grade/mineral.gradeDenominator;
}
function reindex(w) {
  const ds=w.atlas.deposits,ids=new Map(ds.map((d,i)=>[d.id,i]));
  for(const [i,d] of ds.entries()) {
    if(d.sourceDepositId!==null) {
      if(ids.has(d.sourceDepositId))d.sourceDepositId=ids.get(d.sourceDepositId);
      else if(d.locked||d.provenance==='authored'||protectedPoint(w,d.position,'resources'))authored(d,'Источник россыпи изменён автором; тело сохранено.');
      else d._remove=true;
    }
    d.id=i;
  }
  if(ds.some(d=>d._remove)){w.atlas.deposits=ds.filter(d=>!d._remove);return reindex(w);}
  w.atlas.depositsByCell=Array.from({length:w.grid.size},()=>[]);
  for(const d of ds)w.atlas.depositsByCell[d.cell].push(d.id);
}
function checkBody(ds) {
  for(const d of ds) {
    bounded(d.depthM,.01,12000,'Глубина');bounded(d.oreMassMt,1e-9,1e6,'Масса тела');
    bounded(d.grade,1e-9,minerals[d.mineral].gradeDenominator,'Содержание');
  }
  if(ds.reduce((sum,d)=>sum+d.grade/minerals[d.mineral].gradeDenominator,0)>1+1e-10)throw new Error('Суммарное содержание компонентов превышает массу тела');
}
function editBody(w,op) {
  const grid=gridOf(w),ds=w.atlas.deposits.filter(d=>d.oreBodyId===op.bodyId);
  if(!ds.length)throw new Error('Залежь не найдена');
  const patch=op.patch??{};
  const unlocking=Object.keys(patch).length===1&&patch.locked===false;
  if(!unlocking&&(ds[0].locked||protectedPoint(w,ds[0].position,'resources')))throw new Error('Залежь закреплена. Сначала снимите закрепление.');
  if(op.type==='deleteBody') {
    w.atlas.deposits=w.atlas.deposits.filter(d=>d.oreBodyId!==op.bodyId);return;
  }
  const changesPhysics=['position','latitudeDeg','longitudeDeg','depthM','oreMassMt','grades','sizeClass'].some(key=>key in patch);
  if('sizeClass' in patch&&!['major','occurrence'].includes(patch.sizeClass))throw new Error('Некорректный размер залежи');
  let target=ds[0].position;
  if(patch.position)target=position(patch.position);
  else if('latitudeDeg' in patch||'longitudeDeg' in patch) {
    const lat=bounded(patch.latitudeDeg??ds[0].latitudeDeg,-90,90,'Широта'),lon=bounded(patch.longitudeDeg??ds[0].longitudeDeg,-180,180,'Долгота');
    target=sphericalPoint(lat,lon);
  }
  if(!unlocking&&protectedPoint(w,target,'resources'))throw new Error('Точка назначения находится в закреплённой области');
  if(changesPhysics&&!patch.exceptionReason?.trim())throw new Error('Укажите пояснение к авторской правке');
  for(const d of ds) {
    for(const key of ['name','description','tags','locked','depthM','oreMassMt','sizeClass'])if(key in patch)d[key]=patch[key];
    if(patch.grades&&String(d.mineral) in patch.grades)d.grade=patch.grades[d.mineral];
    d.position=[...target];updateResource(d,w,grid);
    if(changesPhysics)authored(d,patch.exceptionReason);
    else if(!unlocking)d.provenance=d.provenance??'edited';
  }
  checkBody(ds);
}
function addBody(w,op) {
  const grid=gridOf(w),p=position(op.position),cell=grid.sample(p),rule=depositModels.find(m=>m.id===op.modelId);
  if(!rule)throw new Error('Выберите семейство месторождения');
  if(protectedPoint(w,p,'resources'))throw new Error('Ресурсы в этом участке закреплены');
  const sampler=makeProspectivitySampler(grid,w.geology,w.atlas),site=sampler.sample(rule,p);
  if(op.mode!=='authored'&&site.formationScore<=0)throw new Error('Геологические условия не подходят. Выберите другое место или авторское исключение.');
  if(op.mode==='authored'&&!op.exceptionReason?.trim())throw new Error('Укажите причину авторского исключения');
  const oreBodyId=w.editor.nextBodyId++,small=op.sizeClass==='occurrence',oreMassMt=rule.mass[0]*(small?.002:1),depthM=rule.depth[0];
  const ds=rule.components.map(c=>({id:w.atlas.deposits.length,oreBodyId,cell,position:[...p],...pointCoordinates(p),provinceId:w.atlas.provinceId[cell],
    placementId:`editor:${oreBodyId}`,mineral:c.mineral,modelId:rule.id,environmentKey:rule.key,kind:rule.kind,reason:rule.reason,
    ...site,sizeClass:small?'occurrence':'major',oreMassMt,depthM,grade:c.grade[0],accessDifficulty:clamp(depthM/1600,0,1),
    discovered:false,exploited:false,economicStatus:'not-assessed',sourceDepositId:null,name:op.name??'',description:'',tags:'',locked:op.locked??true,provenance:'edited'}));
  for(const [i,d] of ds.entries()){d.id=w.atlas.deposits.length+i;updateResource(d,w,grid);if(op.mode==='authored')authored(d,op.exceptionReason);}
  checkBody(ds);w.atlas.deposits.push(...ds);
}
function rules(input) {
  const r={...clone(defaultRules),...input};
  for(const [key,min,max] of [['density',0,4],['majorFactor',0,4],['occurrenceFactor',0,4],['majorSpacing',1,2000],['minorSpacing',1,2000],['depthScale',.1,5],['gradeScale',.1,5]])bounded(r[key],min,max,key);
  if(!Array.isArray(r.modelIds)||r.modelIds.some(id=>!depositModels.some(m=>m.id===id)))throw new Error('Некорректные семейства месторождений');
  return r;
}
function regenerate(w,op) {
  if(w.editor.locks.resources)throw new Error('Слой ресурсов закреплён');
  const area=validateArea(op.area,w.grid.radiusKm),r=rules(op.rules??w.editor.rules),grid=gridOf(w);w.editor.rules=r;
  const affected=d=>inArea(d.position,area,grid.radiusKm)&&(r.modelIds.includes(d.modelId)||(d.modelId==='gold-placer'&&r.modelIds.includes('gold-vein')))&&!d.locked&&!protectedPoint(w,d.position,'resources');
  const keep=w.atlas.deposits.filter(d=>!affected(d));
  const generated=generateDeposits(grid,w.geology,w.water,w.atlas,{...w.config,seed:String(op.seed??`${w.config.seed}:editor:${w.editor.revision}`),resourceDensity:r.density},
    {...r,sitePredicate:p=>inArea(p,area,grid.radiusKm)&&!protectedPoint(w,p,'resources')});
  const keptByModel=new Map();for(const d of keep){if(!keptByModel.has(d.modelId))keptByModel.set(d.modelId,[]);keptByModel.get(d.modelId).push(d);}
  const oldToNew=new Map(),newBodies=new Map();
  for(const d of generated) {
    const id=d.oreBodyId;if(newBodies.has(id))continue;
    if((keptByModel.get(d.modelId)??[]).some(k=>pointDistance(k.position,d.position,grid.radiusKm)<(d.sizeClass==='major'&&k.sizeClass==='major'?r.majorSpacing:r.minorSpacing)))newBodies.set(id,null);
    else newBodies.set(id,w.editor.nextBodyId++);
  }
  const added=generated.filter(d=>newBodies.get(d.oreBodyId)!==null);
  const nextId=Math.max(-1,...keep.map(d=>d.id))+1;
  for(const [i,d] of added.entries()){oldToNew.set(d.id,nextId+i);d.id=nextId+i;d.oreBodyId=newBodies.get(d.oreBodyId);d.depthM=clamp(d.depthM*r.depthScale,.01,12000);}
  const groups=new Map();for(const d of added){if(!groups.has(d.oreBodyId))groups.set(d.oreBodyId,[]);groups.get(d.oreBodyId).push(d);}
  for(const ds of groups.values()) {
    const fraction=ds.reduce((s,d)=>s+d.grade*r.gradeScale/minerals[d.mineral].gradeDenominator,0),scale=r.gradeScale/Math.max(1,fraction);
    for(const d of ds){d.grade*=scale;updateResource(d,w,grid);if(d.sourceDepositId!==null)d.sourceDepositId=oldToNew.get(d.sourceDepositId)??-1;}
  }
  w.atlas.deposits=[...keep,...added];
}
function applyRain(w) {
  const offsets=w.editor.rainAdjustments;
  for(let i=0;i<w.grid.size;i++) {
    if(!offsets[i])continue;
    for(const s of w.climate.seasons)s.precipitation[i]=Math.max(0,s.precipitation[i]+offsets[i]);
    w.climate.precipitation[i]=w.climate.seasons.reduce((sum,s)=>sum+s.precipitation[i]/4,0);
    if(w.geology.elevation[i]<=0)continue;
    const rain=w.climate.precipitation[i],temp=w.climate.temperature[i];
    w.climate.runoffMm[i]=Math.max(rain*.12,rain-clamp(350+temp*24,70,1700));
    w.climate.snowFraction[i]=w.climate.seasons.filter(s=>s.temperature[i]<0).reduce((sum,s)=>sum+s.precipitation[i]/4,0)/Math.max(rain,1e-9);
    w.climate.biome[i]=temp< -8?1:temp<2?2:rain<250?3:rain<650?4:temp>22&&rain>1500?7:temp>18?6:5;
    if(w.geology.elevation[i]>3400&&temp<4)w.climate.biome[i]=8;
  }
}
function recompute(w) {
  const grid=gridOf(w),old=w.atlas,previous=old.deposits;
  w.climate=climate(grid,w.geology.elevation,w.config);applyRain(w);
  w.water=hydrology(grid,w.geology.elevation,w.climate.runoffMm);
  w.atlas=geologicalAtlas(grid,w.geology,w.climate,w.water,{...w.config,resourceDensity:0});
  w.atlas.prospectivityZones=w.editor.zones;
  // Existing ore bodies stay in place. Only invalid unprotected generated bodies are removed.
  const sampler=makeProspectivitySampler(grid,w.geology,w.atlas),retained=[];
  for(const d of previous) {
    updateResource(d,w,grid);const rule=depositModels.find(m=>m.id===d.modelId),site=rule?sampler.sample(rule,d.position):null;
    const invalid=site?site.formationScore<=0:w.geology.elevation[d.cell]<=0;
    if(invalid && d.provenance!=='authored') {
      if(d.locked||protectedPoint(w,d.position,'resources'))authored(d,'Закреплённая залежь сохранена после изменения природных условий.');
      else continue;
    }
    if(site&&d.provenance!=='authored')Object.assign(d,site);
    if(d.modelId==='gold-placer') {
      const source=previous.find(s=>s.id===d.sourceDepositId);let cell=source?.cell,steps=0;
      while(cell!==undefined&&cell!==d.cell&&cell>=0&&steps++<grid.size)cell=w.water.downstream[cell];
      if(cell!==d.cell){if(d.locked||d.provenance==='authored'||protectedPoint(w,d.position,'resources'))authored(d,'Россыпь сохранена автором после изменения водосбора.');else continue;}
    }
    retained.push(d);
  }
  w.atlas.deposits=retained;
  for(const province of old.provinces)if(province.authorName) {
    const id=w.atlas.provinceId[province.representativeCell];w.atlas.provinces[id].name=province.name;w.atlas.provinces[id].authorName=true;
  }
}
function brush(w,op) {
  const grid=gridOf(w),path=(op.path??[]).map(position),radius=bounded(op.radiusKm,10,5000,'Радиус кисти'),strength=bounded(op.strength,-5000,5000,'Сила кисти'),softness=bounded(op.softness??.7,0,1,'Мягкость кисти');
  if(!path.length||path.length>512)throw new Error('Проведите кистью по карте');
  if(op.channel==='potential') {
    if(w.editor.locks.resources)throw new Error('Ресурсы закреплены');
    if(w.editor.zones.length+path.length>4096)throw new Error('Достигнут предел зон потенциала; сбросьте зоны или отмените часть правок');
    const modelIds=rules(op.rules??w.editor.rules).modelIds;
    for(const p of path)if(!protectedPoint(w,p,'resources'))w.editor.zones.push({area:{center:p,radiusKm:radius},strength:bounded(strength,-1,4,'Изменение потенциала'),modelIds});
    w.atlas.prospectivityZones=w.editor.zones;return;
  }
  if(w.editor.locks.terrain)throw new Error('Изменения природных слоёв закреплены');
  if(!['elevation','rain'].includes(op.channel))throw new Error('Неизвестная кисть');
  for(let i=0;i<grid.size;i++) {
    const p=grid.point(i);if(protectedPoint(w,p,'terrain'))continue;
    let distance=Infinity;for(const center of path)distance=Math.min(distance,pointDistance(p,center,grid.radiusKm));
    if(distance>=radius)continue;
    const t=distance/radius,weight=softness===0?1:clamp((1-t)/softness,0,1)**2;
    if(op.channel==='rain')w.editor.rainAdjustments[i]=clamp(w.editor.rainAdjustments[i]+strength*weight,-10000,10000);
    else if(op.mode==='set')w.geology.elevation[i]+=((bounded(op.targetM,-12000,12000,'Целевая высота')-w.geology.elevation[i])*weight);
    else w.geology.elevation[i]=clamp(w.geology.elevation[i]+strength*weight,-12000,12000);
  }
  if(!w.geology.elevation.some(h=>h<=0)||!w.geology.elevation.some(h=>h>0))throw new Error('На планете должны оставаться суша и океан');
  recompute(w);
}
export function applyEdit(world,op) {
  const w=initializeEditor(clone(world));
  if(!op||typeof op.type!=='string')throw new Error('Неизвестное действие редактора');
  if(op.type==='editBody'||op.type==='deleteBody')editBody(w,op);
  else if(op.type==='addBody')addBody(w,op);
  else if(op.type==='regenerate')regenerate(w,op);
  else if(op.type==='brush')brush(w,op);
  else if(op.type==='locks') {
    for(const key of ['terrain','resources'])if(key in op)w.editor.locks[key]=Boolean(op[key]);
    if(op.area)w.editor.locks.areas.push({id:`area-${w.editor.revision}`,area:validateArea(op.area,w.grid.radiusKm),name:String(op.name??'Закреплённая область'),terrain:!!op.areaTerrain,resources:!!op.areaResources});
    if(op.removeId)w.editor.locks.areas=w.editor.locks.areas.filter(a=>a.id!==op.removeId);
  } else if(op.type==='appearance') {
    if(op.theme && !['natural','muted','parchment'].includes(op.theme))throw new Error('Неизвестный стиль');
    w.editor.appearance={...w.editor.appearance,...op.values,...(op.theme?{theme:op.theme}:{})};
    bounded(w.editor.appearance.markerScale,.5,2,'Масштаб значков');bounded(w.editor.appearance.opacity,.2,1,'Непрозрачность');
  } else if(op.type==='rules')w.editor.rules=rules(op.rules);
  else if(op.type==='clearZones'){if(w.editor.locks.resources)throw new Error('Ресурсы закреплены');w.editor.zones=[];w.atlas.prospectivityZones=[];}
  else if(op.type==='province') {
    const p=w.atlas.provinces[op.provinceId];if(!p)throw new Error('Область не найдена');
    p.name=String(op.name).slice(0,160);p.authorName=true;
  } else if(op.type==='annotation') {
    const existing=w.editor.annotations.find(a=>a.id===op.id);
    const unlockOnly=op.locked===false&&!['name','description','tags','position','remove'].some(key=>key in op);
    if(existing?.locked && !unlockOnly)throw new Error('Подпись закреплена');
    if(op.remove)w.editor.annotations=w.editor.annotations.filter(a=>a.id!==op.id);
    else {const a={id:op.id??`note-${w.editor.revision}`,position:position(op.position??existing?.position),name:String(op.name??existing?.name??'').slice(0,160),description:String(op.description??existing?.description??'').slice(0,5000),tags:String(op.tags??existing?.tags??'').slice(0,500),locked:!!op.locked};
      if(existing)Object.assign(existing,a);else w.editor.annotations.push(a);}
  } else throw new Error('Неизвестное действие редактора');
  reindex(w);w.summary=summarize(w);w.validation=validateWorld(w);
  if(w.validation.errors.length)throw new Error(w.validation.errors.join('\n'));
  w.editor.revision++;w.editor.events.push({revision:w.editor.revision,type:op.type,label:String(op.label??op.type)});w.editor.events=w.editor.events.slice(-100);
  return w;
}
export function editImpact(before,after,op) {
  const oldIds=new Set(before.atlas.deposits.map(d=>d.oreBodyId)),newIds=new Set(after.atlas.deposits.map(d=>d.oreBodyId));
  let cells=0,land=0;for(let i=0;i<before.grid.size;i++){if(before.geology.elevation[i]!==after.geology.elevation[i])cells++;if((before.geology.elevation[i]>0)!==(after.geology.elevation[i]>0))land++;}
  return {cells,coastCells:land,added:[...newIds].filter(id=>!oldIds.has(id)).length,removed:[...oldIds].filter(id=>!newIds.has(id)).length,
    recalculated:op.type==='brush'&&op.channel!=='potential'?['климат','водосборы','биомы','геология','почвы','опасности']:[],lockedBodies:new Set(after.atlas.deposits.filter(d=>d.locked).map(d=>d.oreBodyId)).size};
}
export function estimateBytes(value) {
  if(ArrayBuffer.isView(value))return value.byteLength;
  if(Array.isArray(value))return value.reduce((n,v)=>n+estimateBytes(v),0);
  if(value&&typeof value==='object')return Object.values(value).reduce((n,v)=>n+estimateBytes(v),0);
  return typeof value==='string'?value.length*2:8;
}
export function createHistory(maxEntries=16,maxBytes=64*1024*1024) {
  let past=[],future=[];
  return {push(w){past.push(w);future=[];while(past.length>maxEntries||(past.length>1&&past.reduce((s,v)=>s+estimateBytes(v),0)>maxBytes))past.shift();},
    undo(w){if(!past.length)return null;future.push(w);return past.pop();},redo(w){if(!future.length)return null;past.push(w);return future.pop();},clear(){past=[];future=[];},get canUndo(){return past.length>0;},get canRedo(){return future.length>0;}};
}
export function serializeProject(world,view={}) {return serializeWorld({format:'worldgen-project',version:1,world,view});}
export function parseProject(text) {
  if(text.length>100*1024*1024)throw new Error('Проект превышает 100 МБ');
  const data=JSON.parse(text),w=data.format==='worldgen-project'?data.world:data;
  if(data.format==='worldgen-project'&&data.version!==1)throw new Error('Версия проекта не поддерживается');
  if(w?.algorithmVersion!==ALGORITHM_VERSION)throw new Error('Поддерживаются миры версии 0.4 и проекты редактора 0.5');
  const c=validateConfig(w.config);if(w.grid?.size!==c.width*c.height||w.grid.width!==c.width||w.grid.height!==c.height||w.grid.radiusKm!==c.radiusKm)throw new Error('Повреждена сетка проекта');
  const n=w.grid.size,field=(obj,key,length=n,Type=Float64Array)=>{
    const a=obj?.[key];if(!Array.isArray(a)||a.length!==length||a.some(v=>!Number.isFinite(v)))throw new Error(`Повреждён слой ${key}`);
    if(Type!==Float64Array&&a.some(v=>!Number.isInteger(v)||v<(Type===Uint8Array||Type===Uint16Array?0:Type===Int8Array?-128:-2147483648)||v>(Type===Uint8Array?255:Type===Uint16Array?65535:Type===Int8Array?127:2147483647)))throw new Error(`Повреждён целочисленный слой ${key}`);
    obj[key]=new Type(a);
  };
  for(const key of ['latitude','areaKm2'])field(w.grid,key);
  for(const key of ['crust','ageMa','uplift','elevation','stress','volcanism','compressionMemory','extensionMemory','magmaticMemory'])field(w.geology,key);
  if(w.geology.erosionResistance)field(w.geology,'erosionResistance');
  field(w.geology,'plateId',n,Uint16Array);field(w.geology,'boundary',n,Int8Array);
  for(const key of ['temperature','precipitation','runoffMm','snowFraction'])field(w.climate,key);field(w.climate,'biome',n,Uint8Array);
  if(w.climate.seasons?.length!==4)throw new Error('Повреждены сезоны');
  for(const s of w.climate.seasons){for(const key of ['temperature','precipitation','windNorth'])field(s,key);field(s,'windEast',n,Int8Array);}
  for(const key of ['spillElevation','lakeDepth','discharge','catchmentKm2'])field(w.water,key);
  for(const key of ['downstream','basin','order'])field(w.water,key,n,Int32Array);
  for(const key of ['surfaceAgeMa','sedimentThicknessM','slope','faultDistanceKm','magmaticDistanceKm','coastDistanceKm','soilDepthM','fertility','waterRetention','aquiferPotential','sedimentHistoryAgeMa','ancientWetland'])field(w.atlas,key);
  for(const key of ['surfaceRock','provinceType'])field(w.atlas,key,n,Uint8Array);field(w.atlas,'provinceId',n,Int32Array);
  for(const key of ['layerThicknessM','layerAgeMa'])field(w.atlas,key,n*4);field(w.atlas,'layerRock',n*4,Uint8Array);
  for(const key of Object.keys(w.atlas.hazards))field(w.atlas.hazards,key);
  for(const key of Object.keys(w.atlas.environments))field(w.atlas.environments,key);
  if(!Array.isArray(w.atlas.deposits)||w.atlas.deposits.length>100000||!Array.isArray(w.atlas.provinces))throw new Error('Повреждены объекты атласа');
  if(w.geology.plates?.length!==c.plateCount)throw new Error('Повреждены плиты');
  for(const plate of w.geology.plates)position(plate.center);
  if(w.climate.biome.some(v=>!Number.isInteger(v)||v<0||v>8)||w.geology.plateId.some(v=>v>=c.plateCount)||w.grid.areaKm2.some(v=>v<=0))throw new Error('Повреждены категории карты');
  if(new Set(w.water.order).size!==n||w.water.order.some(v=>v<0||v>=n)||w.water.downstream.some(v=>v< -1||v>=n))throw new Error('Повреждена сеть стока');
  const features=w.atlas.mineralization?.features;
  if(!Array.isArray(features)||features.length>50000||typeof w.atlas.mineralization.seed!=='string')throw new Error('Повреждены структуры минерализации');
  for(const f of features) {
    if(!['structural','intrusion','basin'].includes(f.kind))throw new Error('Неизвестная геологическая структура');
    bounded(f.widthKm,1,1000,'Ширина геологической структуры');
    if(f.kind==='structural'){position(f.a);position(f.b);}else position(f.center);
    if(f.aspect!==undefined){bounded(f.aspect,1,10,'Вытянутость');bounded(f.bearing,0,Math.PI*2,'Направление');}
  }
  initializeEditor(w);if(Array.isArray(w.editor.rainAdjustments))field(w.editor,'rainAdjustments');
  if(w.editor.rainAdjustments.length!==n)throw new Error('Повреждены правки осадков');
  if(w.editor.version!==1||!Array.isArray(w.editor.locks.areas)||!Array.isArray(w.editor.zones)||!Array.isArray(w.editor.annotations)||w.editor.annotations.length>10000)throw new Error('Повреждены данные редактора');
  const appearance=w.editor.appearance;
  if(!['natural','muted','parchment'].includes(appearance.theme)||typeof appearance.labels!=='boolean')throw new Error('Повреждён стиль карты');
  bounded(appearance.markerScale,.5,2,'Размер значков');bounded(appearance.opacity,.2,1,'Непрозрачность');
  w.editor.rules=rules(w.editor.rules);w.editor.locks.areas.forEach(a=>validateArea(a.area,c.radiusKm));
  if(w.editor.zones.length>4096)throw new Error('Слишком много зон потенциала');
  for(const z of w.editor.zones){validateArea(z.area,c.radiusKm);bounded(z.strength,-1,4,'Потенциал');rules({modelIds:z.modelIds});}
  for(const a of w.editor.annotations)position(a.position);
  if(!Number.isInteger(w.editor.nextBodyId)||w.editor.nextBodyId<=Math.max(-1,...w.atlas.deposits.map(d=>d.oreBodyId)))throw new Error('Повреждены идентификаторы объектов');
  w.atlas.prospectivityZones=w.editor.zones;reindex(w);w.validation=validateWorld(w);if(w.validation.errors.length)throw new Error(w.validation.errors.join('\n'));
  w.summary=summarize(w);return {world:w,view:data.view??{}};
}
