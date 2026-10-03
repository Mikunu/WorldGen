import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGrid,dot} from '../src/core/grid.js';
import {noise3,hashSeed} from '../src/core/random.js';
import {generateWorld,validateConfig,serializeWorld} from '../src/core/world.js';
import {hydrology} from '../src/core/hydrology.js';
import {climate} from '../src/core/climate.js';

const small={seed:'regression-world',width:64,height:32,epochs:8,plateCount:9,erosionPasses:1};
test('spherical cell areas cover the sphere, longitude and poles connect symmetrically',()=>{
  const grid=makeGrid(64,32,6371);
  const sum=grid.areaKm2.reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(sum/(4*Math.PI*6371**2)-1)<1e-12);
  assert.equal(grid.index(-1,12),grid.index(63,12));
  assert.equal(grid.index(0,-1),grid.index(32,0));
  assert.equal(grid.index(0,32),grid.index(32,31));
  for(let i=0;i<grid.size;i++)for(const j of grid.neighbors(i))assert.ok(grid.neighbors(j).includes(i));
  assert.ok(grid.distance(grid.index(0,16),grid.index(63,16))<700);
  assert.ok(grid.areaKm2[0]<grid.areaKm2[16*64]);
});
test('spherical noise is continuous at the map seam',()=>{
  const eps=1e-6,seed=hashSeed('noise');
  const left=noise3(Math.cos(-Math.PI+eps),0,Math.sin(-Math.PI+eps),seed);
  const right=noise3(Math.cos(Math.PI-eps),0,Math.sin(Math.PI-eps),seed);
  assert.ok(Math.abs(left-right)<1e-5);
});
test('same seed and parameters reproduce all saved state; another seed changes terrain',()=>{
  const a=generateWorld(small),b=generateWorld(small),c=generateWorld({...small,seed:'other'});
  assert.equal(serializeWorld(a),serializeWorld(b));
  assert.notDeepEqual(Array.from(a.geology.elevation),Array.from(c.geology.elevation));
  const restored=JSON.parse(serializeWorld(a));
  assert.equal(restored.algorithmVersion,a.algorithmVersion);
  assert.equal(restored.geology.elevation.length,a.grid.size);
});
test('epochs move plate centres and affect the generated geology',()=>{
  const a=generateWorld({...small,epochs:1}),b=generateWorld({...small,epochs:16});
  assert.notDeepEqual(a.geology.plates[0].center,b.geology.plates[0].center);
  assert.notDeepEqual(Array.from(a.geology.uplift),Array.from(b.geology.uplift));
  for(const plate of b.geology.plates)assert.ok(Math.abs(dot(plate.center,plate.center)-1)<1e-10);
  assert.ok(b.geology.boundary.some(x=>x===1));assert.ok(b.geology.boundary.some(x=>x===-1));
});
test('priority flood preserves a real depression and routes flats without cycles',()=>{
  const grid=makeGrid(24,12,6371),h=new Float64Array(grid.size).fill(100),runoff=new Float64Array(grid.size).fill(500);
  h[grid.index(0,6)]=-10;h[grid.index(12,6)]=20;
  const original=Array.from(h),water=hydrology(grid,h,runoff);
  assert.deepEqual(Array.from(h),original);
  assert.equal(water.lakeDepth[grid.index(12,6)],80);
  const rank=new Int32Array(grid.size);water.order.forEach((id,k)=>rank[id]=k);
  for(let i=0;i<grid.size;i++)if(h[i]>0)assert.ok(rank[water.downstream[i]]<rank[i]);
  assert.ok(Math.abs(water.inputM3s-water.outputM3s)<1e-6);
});
test('water from opposite sides of the seam can share an outlet',()=>{
  const grid=makeGrid(24,12,6371),h=new Float64Array(grid.size).fill(100),runoff=new Float64Array(grid.size).fill(100);
  const ocean=grid.index(0,6),adjacent=grid.index(23,6);h[ocean]=-10;h[adjacent]=10;
  const water=hydrology(grid,h,runoff);
  assert.equal(water.downstream[adjacent],ocean);
});
test('climate has opposite hemispheric seasons and a height lapse rate',()=>{
  const grid=makeGrid(64,32,6371),h=new Float64Array(grid.size).fill(100);
  const config=validateConfig({...small,axialTilt:23.4}),weather=climate(grid,h,config);
  const north=grid.index(10,8),south=grid.index(10,23);
  assert.ok(weather.seasons[2].temperature[north]>weather.seasons[0].temperature[north]);
  assert.ok(weather.seasons[2].temperature[south]<weather.seasons[0].temperature[south]);
  h[north]=2100;const mountainous=climate(grid,h,config);
  assert.ok(Math.abs(weather.temperature[north]-mountainous.temperature[north]-12)<1e-8);
  const noTilt=climate(grid,h,{...config,axialTilt:0});
  assert.deepEqual(Array.from(noTilt.seasons[0].temperature),Array.from(noTilt.seasons[2].temperature));
});
test('a mountain barrier condenses advected ocean moisture',()=>{
  const grid=makeGrid(64,32,6371),h=new Float64Array(grid.size).fill(-100);
  for(let y=0;y<32;y++)for(let x=15;x<=45;x++)h[grid.index(x,y)]=100;
  for(let y=0;y<32;y++)h[grid.index(25,y)]=4500;
  const weather=climate(grid,h,validateConfig(small));
  assert.ok(weather.precipitation[grid.index(25,8)]>weather.precipitation[grid.index(26,8)]);
});
test('moisture transport has comparable physical scale across resolutions',()=>{
  const averages=[];
  for(const width of [96,192,384]) {
    const grid=makeGrid(width,width/2,6371),h=new Float64Array(grid.size).fill(-100);
    for(let y=0;y<grid.height;y++)for(let x=0;x<grid.width;x++)if(x/grid.width>0.3 && x/grid.width<0.55)h[grid.index(x,y)]=100;
    const weather=climate(grid,h,validateConfig({...small,width,height:width/2}));
    let sum=0,area=0;
    for(let i=0;i<grid.size;i++)if(h[i]>0){sum+=weather.precipitation[i]*grid.areaKm2[i];area+=grid.areaKm2[i];}
    averages.push(sum/area);
  }
  assert.ok(Math.max(...averages)/Math.min(...averages)<1.15,`Rainfall across resolutions: ${averages}`);
});
test('generated worlds meet routing, finite value and area-weighted ocean checks across seeds',()=>{
  for(const seed of ['earth','desert','islands','polar','rift']) {
    const w=generateWorld({...small,seed});
    assert.deepEqual(w.validation.errors,[]);
    assert.ok(w.validation.balanceRelativeError<1e-9);
    assert.ok(Math.abs(w.summary.oceanFraction-w.config.oceanFraction)<0.005);
    assert.ok(w.summary.maxElevationM>0);assert.ok(w.summary.minElevationM<0);
    assert.ok(w.climate.precipitation.every(x=>x>=0));
  }
});
test('invalid or excessive configurations fail before generation',()=>{
  for(const c of [{width:25},{epochs:Infinity},{plateCount:2},{oceanFraction:1},{axialTilt:90},{height:12.5}])assert.throws(()=>validateConfig(c));
});
