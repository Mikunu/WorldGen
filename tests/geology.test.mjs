import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWorld,serializeWorld} from '../src/core/world.js';
import {makeGrid} from '../src/core/grid.js';
import {distanceField,geologicalAtlas,geologicalColumn,validateAtlas,generateDeposits} from '../src/core/geological-atlas.js';
import {rocks,provinceTypes,minerals} from '../src/core/geology-catalog.js';
import {hydrology,erode} from '../src/core/hydrology.js';
import {makeProspectivitySampler} from '../src/core/mineralization.js';
import {depositModels} from '../src/core/deposit-models.js';

const config={seed:'Ember-001',width:96,height:48,plateCount:14,epochs:24,erosionPasses:1};
let cached;
const world=()=>cached??=generateWorld(config);
test('atlas columns cover 12 km with valid ordered layers and matching surface rocks',()=>{
  const w=world();
  for(let i=0;i<w.grid.size;i++) {
    const column=geologicalColumn(w.atlas,i);
    assert.equal(column[0].rock,w.atlas.surfaceRock[i]);
    assert.equal(column[0].topM,0);assert.ok(Math.abs(column.at(-1).bottomM-12000)<1e-8);
    for(let k=0;k<column.length;k++){assert.ok(rocks[column[k].rock]);assert.ok(column[k].bottomM>column[k].topM);if(k){assert.equal(column[k].topM,column[k-1].bottomM);assert.ok(column[k].ageMa>=column[k-1].ageMa);}}
  }
  assert.throws(()=>geologicalColumn(w.atlas,-1),RangeError);
});
test('province areas partition the sphere and each province is connected across spherical neighbors',()=>{
  const w=world(),grid=makeGrid(w.grid.width,w.grid.height,w.grid.radiusKm),a=w.atlas;
  assert.ok(Math.abs(a.provinces.reduce((s,p)=>s+p.areaKm2,0)/w.summary.totalAreaKm2-1)<1e-10);
  for(const p of a.provinces) {
    assert.ok(provinceTypes[p.type]);const visited=new Set([p.representativeCell]),queue=[p.representativeCell];
    for(let k=0;k<queue.length;k++)for(const j of grid.neighbors(queue[k]))if(a.provinceId[j]===p.id && !visited.has(j)){visited.add(j);queue.push(j);}
    assert.equal(visited.size,p.cells);
    for(const i of visited)assert.equal(a.provinceType[i],p.type);
  }
});
test('geological distance fields cross the longitude seam and respect physical distance',()=>{
  const grid=makeGrid(64,32,6371),sources=new Uint8Array(grid.size),start=grid.index(0,16),neighbor=grid.index(63,16);sources[start]=1;
  const distance=distanceField(grid,sources);
  assert.equal(distance[start],0);assert.ok(Math.abs(distance[neighbor]-grid.distance(start,neighbor))<1e-8);
  assert.ok(distance.every(x=>Number.isFinite(x) && x>=0));
});
test('deposits have resource units, reserves, geological prerequisites and explicit unused status',()=>{
  const w=world(),a=w.atlas,grid=makeGrid(w.grid.width,w.grid.height,w.grid.radiusKm),sampler=makeProspectivitySampler(grid,w.geology,a);
  assert.ok(a.deposits.length>0);
  for(const d of a.deposits) {
    assert.ok(w.geology.elevation[d.cell]>0);assert.ok(minerals[d.mineral]);assert.equal(d.discovered,false);assert.equal(d.exploited,false);
    assert.ok(a.depositsByCell[d.cell].includes(d.id));assert.equal(d.provinceId,a.provinceId[d.cell]);
    const expected=d.oreMassMt*1e6*d.grade/minerals[d.mineral].gradeDenominator;
    assert.ok(Math.abs(d.containedResourceTonnes/expected-1)<1e-12);
    if(d.sourceDepositId!==null){let cell=a.deposits[d.sourceDepositId].cell,steps=0;while(cell!==d.cell && cell>=0 && steps++<w.grid.size)cell=w.water.downstream[cell];assert.equal(cell,d.cell);}
    else {
      const key=d.environmentKey;
      const local=sampler.sample(depositModels.find(m=>m.id===d.modelId),d.position);
      assert.equal(d.formationScore,local.formationScore);assert.equal(d.environmentScore,local.environmentScore);
      assert.ok(grid.sampleField(a.environments[key],d.position)>=depositModels.find(m=>m.id===d.modelId).threshold);
    }
  }
});
test('a homogeneous old platform without magmatism cannot produce hydrothermal copper or gold',()=>{
  const grid=makeGrid(48,24,6371),n=grid.size,geology={elevation:new Float64Array(n).fill(1000),crust:new Float64Array(n).fill(1),boundary:new Int8Array(n),volcanism:new Float64Array(n),stress:new Float64Array(n),ageMa:new Float64Array(n).fill(300),uplift:new Float64Array(n)};
  const weather={temperature:new Float64Array(n).fill(15),precipitation:new Float64Array(n).fill(800)},water={discharge:new Float64Array(n),outputM3s:0,downstream:new Int32Array(n).fill(-1)};
  const a=geologicalAtlas(grid,geology,weather,water,{seed:'no-magma'});
  assert.ok(a.environments.hydrothermal.every(x=>x===0));assert.ok(a.hazards.volcanic.every(x=>x===0));
  assert.ok(!a.deposits.some(d=>d.mineral===0 || d.mineral===1));
});
test('ocean cells have no soil and all fertility and hazard indices stay in range',()=>{
  const w=world(),a=w.atlas;
  for(let i=0;i<w.grid.size;i++) {
    for(const value of [a.fertility[i],a.waterRetention[i],a.aquiferPotential[i],...Object.values(a.hazards).map(h=>h[i])])assert.ok(value>=0 && value<=1);
    if(w.geology.elevation[i]<=0){assert.equal(a.soilDepthM[i],0);assert.equal(a.fertility[i],0);}
  }
});
test('atlas, strata and deposits survive JSON export and reproduce with the same seed',()=>{
  const a=world(),b=generateWorld(config),restored=JSON.parse(serializeWorld(a));
  assert.equal(serializeWorld(a),serializeWorld(b));assert.equal(restored.atlas.layerRock.length,a.grid.size*4);
  assert.deepEqual(restored.atlas.deposits,a.atlas.deposits);
  for(const d of restored.atlas.deposits)assert.equal(restored.catalogs.minerals[d.mineral].unit,d.gradeUnit);
  assert.deepEqual(validateAtlas(restored.atlas,a.grid.size,restored.geology,restored.water),[]);
});
test('atlas validation detects corrupt stratigraphy and negative reserves',()=>{
  const original=world(),copy=JSON.parse(serializeWorld(original));
  copy.atlas.layerThicknessM[0]=-5;
  assert.ok(validateAtlas(copy.atlas,copy.grid.size,copy.geology,copy.water).some(x=>x.includes('колонка')));
  copy.atlas.layerThicknessM[0]=original.atlas.layerThicknessM[0];copy.atlas.deposits[0].oreMassMt=-1;
  assert.ok(validateAtlas(copy.atlas,copy.grid.size,copy.geology,copy.water).some(x=>x.includes('месторождение')));
});
test('resistant rock reduces river incision without changing the erosion flow direction',()=>{
  const grid=makeGrid(24,12,6371),h=new Float64Array(grid.size).fill(100),runoff=new Float64Array(grid.size).fill(2000),peak=grid.index(1,6);
  h[grid.index(0,6)]=-100;h[peak]=4000;const water=hydrology(grid,h,runoff),soft=h.slice(),hard=h.slice();
  erode(grid,soft,water,new Float64Array(grid.size));erode(grid,hard,water,new Float64Array(grid.size).fill(0.9));
  assert.ok(soft[peak]<h[peak]);assert.ok(hard[peak]>soft[peak]);assert.equal(water.downstream[peak],grid.index(0,6));
  assert.throws(()=>erode(grid,hard,water,new Float64Array(2)));
});
test('a gold-bearing catchment actually generates placers downstream with a primary source',()=>{
  const grid=makeGrid(64,32,6371),n=grid.size;
  const environments=Object.fromEntries(['hydrothermal','felsic','iron','coal','evaporite'].map(key=>[key,new Float64Array(n)]));
  for(let y=10;y<16;y++)for(let x=5;x<17;x++)environments.hydrothermal[grid.index(x,y)]=1;
  const downstream=new Int32Array(n).fill(-1);
  for(let y=0;y<32;y++)for(let x=0;x<63;x++)downstream[grid.index(x,y)]=grid.index(x+1,y);
  const deposits=generateDeposits(grid,{elevation:new Float64Array(n).fill(300)},{downstream,discharge:new Float64Array(n).fill(1000)},{environments,slope:new Float64Array(n),provinceId:new Int32Array(n)},{seed:'placer-fixture'});
  const placers=deposits.filter(d=>d.sourceDepositId!==null);assert.ok(placers.length>0,'Fixture must exercise placer generation');
  for(const d of placers){const source=deposits[d.sourceDepositId];assert.equal(source.mineral,1);let cell=source.cell,km=0;while(cell!==d.cell && cell>=0){const next=downstream[cell];if(next<0)break;km+=grid.distance(cell,next);cell=next;}assert.equal(cell,d.cell);assert.ok(km<=2000 && km>50);assert.ok(d.depthM<=20);}
});
