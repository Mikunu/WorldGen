import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWorld,validateConfig,serializeWorld} from '../src/core/world.js';
import {generateDeposits,depositModels,depositMatches,resourceInventory} from '../src/core/deposit-models.js';
import {validateAtlas} from '../src/core/geological-atlas.js';
import {minerals} from '../src/core/geology-catalog.js';
import {makeGrid} from '../src/core/grid.js';

function fixture(width=96,score=1) {
  const grid=makeGrid(width,width/2,6371),n=grid.size;
  return {grid,geology:{elevation:new Float64Array(n).fill(300)},water:{downstream:new Int32Array(n).fill(-1),discharge:new Float64Array(n)},
    atlas:{environments:Object.fromEntries([...new Set(depositModels.map(m=>m.key))].map(key=>[key,new Float64Array(n).fill(score)])),slope:new Float64Array(n),provinceId:new Int32Array(n)}};
}
const draw=(f,seed='resources-fixture',resourceDensity=1)=>generateDeposits(f.grid,f.geology,f.water,f.atlas,{seed,resourceDensity});

test('all 32 real-world commodities are reachable through deposit families, with carrier minerals and unambiguous units',()=>{
  assert.equal(minerals.length,32);assert.equal(new Set(minerals.map(m=>m.symbol)).size,32);
  const deposits=draw(fixture());
  assert.equal(new Set(deposits.map(d=>d.mineral)).size,32);
  for(const m of minerals){assert.ok(m.oreMinerals && m.group && m.resourceBasis);assert.equal(m.gradeDenominator,m.unit.startsWith('г/т')?1e6:100);}
  for(const d of deposits) {
    const m=minerals[d.mineral];assert.equal(d.gradeUnit,m.unit);assert.equal(d.oreMinerals,m.oreMinerals);
    assert.ok(Math.abs(d.containedResourceTonnes/(d.oreMassMt*1e6*d.grade/m.gradeDenominator)-1)<1e-12);
  }
});
test('unsuitable geological settings and zero density produce no resources, regardless of abundance',()=>{
  assert.equal(draw(fixture(48,0),'no-environment',4).length,0);
  assert.equal(draw(fixture(48),'empty-world',0).length,0);
  for(const resourceDensity of [-1,NaN,Infinity,4.1])assert.throws(()=>validateConfig({resourceDensity}));
  assert.throws(()=>draw(fixture(48),'invalid',NaN));
});
test('coexisting metals share one body and mass; separate evaporite layers do not exceed a shared mass budget',()=>{
  const deposits=draw(fixture(48)),bodies=new Map();
  for(const d of deposits){if(!bodies.has(d.oreBodyId))bodies.set(d.oreBodyId,[]);bodies.get(d.oreBodyId).push(d);}
  const lead=bodies.values().find(ds=>ds.some(d=>d.mineral===6));assert.deepEqual(lead.map(d=>d.mineral),[6,7,8]);
  const nickel=bodies.values().find(ds=>ds[0].modelId==='nickel-sulfide');assert.deepEqual(nickel.map(d=>d.mineral),[9,10,20,0]);
  for(const ds of bodies.values()) {
    const first=ds[0];for(const d of ds){assert.equal(d.cell,first.cell);assert.equal(d.oreMassMt,first.oreMassMt);assert.equal(d.depthM,first.depthM);}
    const massFractions=ds.reduce((s,d)=>s+d.grade/minerals[d.mineral].gradeDenominator,0);assert.ok(massFractions<=1);
    if(ds.some(d=>[5,27,28].includes(d.mineral)))assert.equal(ds.length,1);
  }
});
test('small manifestations have lower masses than the corresponding major deposit family',()=>{
  const deposits=draw(fixture(48));
  for(const model of depositModels) {
    const major=deposits.filter(d=>d.modelId===model.id && d.sizeClass==='major');
    const small=deposits.filter(d=>d.modelId===model.id && d.sizeClass==='occurrence');
    assert.ok(major.length && small.length);
    assert.ok(Math.max(...small.map(d=>d.oreMassMt))<Math.min(...major.map(d=>d.oreMassMt)));
  }
});
test('resource filtering and counts distinguish components from shared ore bodies',()=>{
  const deposits=draw(fixture(48));
  const inventory=resourceInventory(deposits),lead=inventory[6],zinc=inventory[7];assert.equal(lead.major,zinc.major);assert.equal(lead.occurrence,zinc.occurrence);
  const filtered=deposits.filter(d=>depositMatches(d,{resource:'6',depositClass:'occurrence'}));
  assert.equal(filtered.length,lead.occurrence);assert.ok(filtered.every(d=>d.mineral===6 && d.sizeClass==='occurrence'));
  assert.ok(deposits.length>new Set(deposits.map(d=>d.oreBodyId)).size);
});
test('area-weighted resource frequencies remain comparable when a uniform test planet doubles its resolution',()=>{
  const totals=width=>Array.from({length:4},(_,i)=>{
    const f=fixture(width,0.6);for(const key of Object.keys(f.atlas.environments))if(key!=='hydrothermal')f.atlas.environments[key].fill(0);
    return new Set(draw(f,`area-${i}`,0.5).map(d=>d.oreBodyId)).size;
  }).reduce((a,b)=>a+b,0);
  const coarse=totals(96),fine=totals(192);assert.ok(fine/coarse>0.85 && fine/coarse<1.25,`${coarse} -> ${fine}`);
});
test('density changes resource placement but preserves physical geography, soils and climate',()=>{
  const config={seed:'density-isolation',width:48,height:24,epochs:8,plateCount:8};
  const empty=generateWorld({...config,resourceDensity:0}),rich=generateWorld({...config,resourceDensity:4});
  assert.equal(empty.atlas.deposits.length,0);assert.ok(rich.atlas.deposits.length>100);
  for(const key of ['geology','climate','water'])assert.deepEqual(empty[key],rich[key]);
  for(const key of ['surfaceRock','layerRock','soilDepthM','fertility','environments'])assert.deepEqual(empty.atlas[key],rich.atlas[key]);
  assert.equal(rich.summary.oreBodyCount,rich.summary.depositCount+rich.summary.occurrenceCount);
  assert.equal(rich.summary.oreBodyCount,new Set(rich.atlas.deposits.map(d=>d.oreBodyId)).size);
  const restored=JSON.parse(serializeWorld(rich));assert.equal(restored.config.resourceDensity,4);assert.equal(restored.catalogs.minerals.length,32);
  assert.deepEqual(validateAtlas(restored.atlas,restored.grid.size,restored.geology,restored.water),[]);
  restored.atlas.deposits[0].containedResourceTonnes*=100;
  assert.ok(validateAtlas(restored.atlas,restored.grid.size,restored.geology,restored.water).length>0);
});
