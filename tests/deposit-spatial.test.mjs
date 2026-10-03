import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGrid} from '../src/core/grid.js';
import {random} from '../src/core/random.js';
import {generateWorld,serializeWorld} from '../src/core/world.js';
import {generateDeposits,depositModels} from '../src/core/deposit-models.js';
import {makeProspectivitySampler} from '../src/core/mineralization.js';
import {validateAtlas} from '../src/core/geological-atlas.js';
import {refineRegion} from '../src/core/region.js';
import {potentialRaster} from '../src/core/potential-raster.js';
import {uniformSphere,sphericalPoint,pointDistance,arcDistance,mapPoint,pickDeposit,proximityIndex} from '../src/core/spatial.js';

function fixture(width=48) {
  const grid=makeGrid(width,width/2,6371),n=grid.size;
  return {grid,geology:{elevation:new Float64Array(n).fill(300)},water:{downstream:new Int32Array(n).fill(-1),discharge:new Float64Array(n)},
    atlas:{environments:{hydrothermal:new Float64Array(n).fill(.6)},slope:new Float64Array(n),provinceId:new Int32Array(n),mineralization:{version:1,seed:'spatial-fixture',features:[]}}};
}
const draw=f=>generateDeposits(f.grid,f.geology,f.water,f.atlas,{seed:'spatial-fixture',resourceDensity:.2});
const unique=ds=>[...new Map(ds.map(d=>[d.oreBodyId,d])).values()];

test('ore positions are independent of grid resolution and several bodies can occupy one coarse cell',()=>{
  const coarse=fixture(48),fine=fixture(192),a=unique(draw(coarse)),b=unique(draw(fine));
  assert.ok(a.length>100);
  assert.deepEqual(a.map(d=>[d.placementId,d.position]),b.map(d=>[d.placementId,d.position]));
  const cells=new Map();let offCenter=0;
  for(const d of a) {
    assert.equal(coarse.grid.sample(d.position),d.cell);assert.ok(Math.abs(Math.hypot(...d.position)-1)<1e-12);
    if(pointDistance(d.position,coarse.grid.point(d.cell),6371)>1)offCenter++;
    if(!cells.has(d.cell))cells.set(d.cell,[]);cells.get(d.cell).push(d);
  }
  assert.equal(offCenter,a.length);
  assert.ok([...cells.values()].some(ds=>ds.length>1 && ds[0].position.some((v,k)=>v!==ds[1].position[k])));
});
test('minimum separation uses actual ore positions, including major/minor proximity',()=>{
  const bodies=unique(draw(fixture()));let pairs=0;
  for(let i=0;i<bodies.length;i++)for(let j=i+1;j<bodies.length;j++) {
    const a=bodies[i],b=bodies[j];if(a.modelId!==b.modelId)continue;
    const minimum=a.sizeClass==='major' && b.sizeClass==='major'?120:40;
    assert.ok(pointDistance(a.position,b.position,6371)>=minimum-1e-6);pairs++;
  }
  assert.ok(pairs>1000);
});
test('equal-area sphere sampling does not crowd poles; distances and spatial hashing cross the seam',()=>{
  const rng=random('sphere-sampling'),points=Array.from({length:12000},()=>uniformSphere(rng));
  const cap=points.filter(p=>Math.abs(p[1])>.8).length/points.length;
  assert.ok(cap>.18 && cap<.22);
  const a=sphericalPoint(0,179.9),b=sphericalPoint(0,-179.9),index=proximityIndex(6371,40);index.add(a);
  assert.ok(index.near(b));assert.ok(Math.abs(pointDistance(a,b,6371)-6371*Math.PI/900)<1e-6);
  assert.ok(arcDistance(sphericalPoint(0,180),a,b,6371)<1e-6);
  assert.ok(Math.abs(arcDistance(sphericalPoint(1,0),sphericalPoint(0,-10),sphericalPoint(0,10),6371)-6371*Math.PI/180)<1e-6);
  const poleIndex=proximityIndex(6371,40);poleIndex.add(sphericalPoint(89.9,0));assert.ok(poleIndex.near(sphericalPoint(89.9,180)));
});
test('a fault arc concentrates subgrid mineralization and prospectivity remains continuous at longitude seams',()=>{
  const f=fixture(),rule=depositModels.find(m=>m.id==='gold-vein');
  f.atlas.mineralization.features=[{kind:'structural',a:sphericalPoint(-10,0),b:sphericalPoint(10,0),widthKm:50}];
  const sampler=makeProspectivitySampler(f.grid,f.geology,f.atlas);
  const on=sampler.sample(rule,sphericalPoint(0,0)),away=sampler.sample(rule,sphericalPoint(0,5));
  assert.ok(on.formationScore>away.formationScore+.1);
  const left=sampler.sample(rule,sphericalPoint(12,-180)),right=sampler.sample(rule,sphericalPoint(12,180));
  assert.ok(Math.abs(left.formationScore-right.formationScore)<1e-10);
  const values=Array.from({length:25},(_,i)=>sampler.sample(rule,sphericalPoint(.01+i*.08,.01+i*.08)).beltStrength);
  assert.ok(Math.max(...values)-Math.min(...values)>.1,'Fine potential must vary inside a parent grid cell');
});
test('marker picking follows stored spherical positions, respects filters and wraps the map edge',()=>{
  const d={id:7,mineral:6,position:sphericalPoint(10,20)},p=mapPoint(d.position);
  assert.equal(pickDeposit([d],p.x,p.y,1000,500)?.id,7);
  assert.equal(pickDeposit([d],p.x,p.y,1000,500,x=>x.mineral===1),null);
  assert.equal(pickDeposit([d],p.x+.05,p.y,1000,500),null);
  const seam={id:9,position:sphericalPoint(0,-179.9)};
  assert.equal(pickDeposit([seam],.9999,.5,1000,500)?.id,9);
});

const w=generateWorld({seed:'ore-spatial-world',width:64,height:32,epochs:8,erosionPasses:0});
test('regional maps preserve ore coordinates and can centre exactly on a selected body',()=>{
  const d=w.atlas.deposits[0],r=refineRegion(w,d.cell,{centerPosition:d.position}),local=r.deposits.find(x=>x.id===d.id);
  assert.ok(local);assert.ok(Math.abs(local.x-(r.size-1)/2)<1e-6);assert.ok(Math.abs(local.y-(r.size-1)/2)<1e-6);
  assert.deepEqual(r.centerPosition,d.position);
  const components=w.atlas.deposits.filter(x=>x.oreBodyId===d.oreBodyId);
  for(const c of components){assert.deepEqual(c.position,d.position);const projected=r.deposits.find(x=>x.id===c.id);assert.equal(projected.x,local.x);assert.equal(projected.y,local.y);}
  assert.throws(()=>refineRegion(w,d.cell,{centerPosition:[0,0,0]}),RangeError);
});
test('fine potential raster samples the same fields that accept ore positions; JSON validates exact coordinates',()=>{
  const before=serializeWorld(w),r=potentialRaster(w,'1',{width:64,height:32});
  assert.equal(r.values.length,2048);assert.ok(r.values.every(v=>v===-1 || v>=0 && v<=1));assert.ok(r.values.some(v=>v>0));
  const grid=makeGrid(w.grid.width,w.grid.height,w.grid.radiusKm),pixels=makeGrid(64,32,6371),sampler=makeProspectivitySampler(grid,w.geology,w.atlas);
  const rules=depositModels.filter(m=>m.components.some(c=>c.mineral===1));
  for(let i=0;i<r.values.length;i+=13)if(r.values[i]>=0)assert.ok(Math.abs(r.values[i]-sampler.potential(rules,pixels.point(i)))<1e-7);
  assert.equal(serializeWorld(w),before);
  const restored=JSON.parse(before);assert.deepEqual(restored.atlas.deposits[0].position,w.atlas.deposits[0].position);
  assert.deepEqual(validateAtlas(restored.atlas,restored.grid.size,restored.geology,restored.water),[]);
  restored.atlas.deposits[0].position=[0,0,0];assert.ok(validateAtlas(restored.atlas,restored.grid.size,restored.geology,restored.water).some(e=>e.includes('позиция')));
});
