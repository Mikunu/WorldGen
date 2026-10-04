import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGrid} from '../src/core/grid.js';
import {OCEAN_MODEL_VERSION,oceanDefaults,oceanRuleSchema,oceanSeason} from '../src/core/ocean.js';

function fixture(width=48,height=width/2) {
  const grid=makeGrid(width,height,6371),elevation=new Float64Array(grid.size).fill(-1000),windEast=new Float64Array(grid.size),windNorth=new Float64Array(grid.size),baselineTemperature=new Float64Array(grid.size);
  for(let i=0;i<grid.size;i++) {
    const latitude=grid.latitude[i],degrees=Math.abs(latitude)*180/Math.PI;
    windEast[i]=degrees<30||degrees>60?-1:1;
    windNorth[i]=(degrees<30?-Math.sign(latitude):Math.sign(latitude))*.16;
    baselineTemperature[i]=28-38*Math.abs(latitude)/(Math.PI/2);
  }
  return {grid,elevation,windEast,windNorth,baselineTemperature};
}

const run=(f,config={seed:'ocean-test'},season=0)=>oceanSeason(f.grid,f.elevation,f.windEast,f.windNorth,f.baselineTemperature,config,season);
const oceanConfig=values=>({seed:'ocean-test',generationRules:{ocean:values}});

test('surface ocean is deterministic, finite, bounded and does not mutate its inputs',()=>{
  const f=fixture(),snapshots=[...['elevation','windEast','windNorth','baselineTemperature'].map(key=>Float64Array.from(f[key]))];
  for(let y=5;y<19;y++)for(let x=0;x<7;x++)f.elevation[f.grid.index(x,y)]=600;
  snapshots[0]=Float64Array.from(f.elevation);
  const first=run(f),again=run(f);
  assert.deepEqual(first,again);assert.equal(first.enabled,true);assert.equal(first.modelVersion,OCEAN_MODEL_VERSION);
  for(const key of ['eastMps','northMps','speedMps','temperatureC','anomalyC','coastInfluence','airTemperatureCorrectionC']) {
    assert.equal(first[key].length,f.grid.size);assert.ok(first[key].every(Number.isFinite),key);
  }
  assert.ok(first.speedMps.every(value=>value>=0&&value<=oceanDefaults.maxCurrentMps+1e-12));
  assert.ok(first.temperatureC.every((value,i)=>f.elevation[i]>0?value===0:value>=oceanDefaults.minSstC&&value<=oceanDefaults.maxSstC));
  assert.ok(first.coastInfluence.every(value=>value>=0&&value<=1));
  assert.ok(first.airTemperatureCorrectionC.every(value=>Math.abs(value)<=oceanDefaults.maxAirCorrectionC+1e-12));
  for(const [key,snapshot] of ['elevation','windEast','windNorth','baselineTemperature'].map((key,i)=>[key,snapshots[i]]))assert.deepEqual(f[key],snapshot,key);
});

test('land is impermeable and all water-only fields remain exactly zero on land',()=>{
  const f=fixture();
  for(let y=0;y<f.grid.height;y++)for(let x=0;x<8;x++)f.elevation[f.grid.index(x,y)]=100;
  f.elevation[f.grid.index(28,12)]=100; // An island exercises all four coastal faces.
  const ocean=run(f),epsilon=1e-12;
  for(let i=0;i<f.grid.size;i++) {
    if(f.elevation[i]>0)for(const key of ['eastMps','northMps','speedMps','temperatureC','anomalyC'])assert.equal(ocean[key][i],0,`${key} at land ${i}`);
    else {
      const x=i%f.grid.width,y=Math.floor(i/f.grid.width);
      if(f.elevation[f.grid.index(x+1,y)]>0)assert.ok(ocean.eastMps[i]<=epsilon);
      if(f.elevation[f.grid.index(x-1,y)]>0)assert.ok(ocean.eastMps[i]>=-epsilon);
      if(f.elevation[f.grid.index(x,y-1)]>0)assert.ok(ocean.northMps[i]<=epsilon);
      if(f.elevation[f.grid.index(x,y+1)]>0)assert.ok(ocean.northMps[i]>=-epsilon);
    }
  }
});

test('closed basins stay disconnected while seams, islands and polar rows remain well behaved',()=>{
  const split=fixture();
  for(let y=0;y<split.grid.height;y++)for(const x of [0,split.grid.width/2])split.elevation[split.grid.index(x,y)]=100;
  const separated=run(split);assert.equal(separated.diagnostics.basinCount,2);
  const island=fixture();island.elevation[island.grid.index(17,9)]=100;
  const connected=run(island);assert.equal(connected.diagnostics.basinCount,1);
  for(const y of [0,island.grid.height-1])for(let x=0;x<island.grid.width;x++) {
    const i=island.grid.index(x,y);assert.ok(Number.isFinite(connected.speedMps[i]));assert.ok(connected.speedMps[i]<=oceanDefaults.maxCurrentMps+1e-12);
  }
  assert.ok(Array.from({length:island.grid.height},(_,y)=>connected.speedMps[island.grid.index(0,y)]+connected.speedMps[island.grid.index(island.grid.width-1,y)]).some(value=>value>0));
  const fragmented=fixture(64,32);
  for(let y=0;y<fragmented.grid.height;y++)for(let x=0;x<fragmented.grid.width;x++)fragmented.elevation[fragmented.grid.index(x,y)]=(x+y)%2?300:-1000;
  const manyBasins=run(fragmented);assert.equal(manyBasins.diagnostics.basinCount,fragmented.grid.size/2);
  assert.ok(manyBasins.temperatureC.every(Number.isFinite));
});

test('a meridional dead end does not collapse the velocity reconstruction',()=>{
  const f=fixture(24,12);f.elevation.fill(1000);f.windEast.fill(.8);f.windNorth.fill(.2);f.baselineTemperature.fill(10);
  for(let y=3;y<10;y++)for(let x=4;x<20;x++)f.elevation[f.grid.index(x,y)]=-3000;
  f.elevation[f.grid.index(10,2)]=-3000; // One rank-one, nearly meridional face.
  const ocean=run(f,oceanConfig({thermodynamicsEnabled:false})),speeds=Array.from(ocean.speedMps).filter(value=>value>0).sort((a,b)=>a-b);
  assert.ok(speeds.length>100);
  assert.ok(speeds[Math.floor(speeds.length*.5)]>.05);
  assert.ok(speeds.every(value=>Number.isFinite(value)&&value<=oceanDefaults.maxCurrentMps+1e-12));
});

test('conservative heat transport preserves the area-weighted mean without relaxation or clipping',()=>{
  const f=fixture(),ocean=run(f,oceanConfig({thermodynamicsEnabled:false,baselineRelaxation:0,lateralMixing:.08,minSstC:-10,maxSstC:60,heatSteps:32}));
  const mean=field=>field.reduce((sum,value,i)=>sum+value*f.grid.areaKm2[i],0)/f.grid.areaKm2.reduce((a,b)=>a+b,0);
  assert.ok(Math.abs(mean(ocean.temperatureC)-mean(f.baselineTemperature))<1e-10);
  assert.ok(ocean.anomalyC.some(value=>value>.05));assert.ok(ocean.anomalyC.some(value=>value<-.05));
  assert.ok(ocean.diagnostics.maximumDivergence<1e-6);
});

test('stronger currents transport more heat over the same bounded physical interval',()=>{
  const f=fixture(96,48);
  for(let i=0;i<f.grid.size;i++) {
    const p=f.grid.point(i);
    f.baselineTemperature[i]=15+8*Math.sin(Math.atan2(p[2],p[0]));
    f.windEast[i]=1;f.windNorth[i]=0;
  }
  const settings={thermodynamicsEnabled:false,baselineRelaxation:0,lateralMixing:0,heatSteps:12,maxCurrentMps:5,minSstC:-10,maxSstC:60};
  const weak=run(f,oceanConfig({...settings,windResponseMps:.1,coriolisTurn:0}));
  const strong=run(f,oceanConfig({...settings,windResponseMps:.4,coriolisTurn:0}));
  const transported=result=>result.anomalyC.reduce((sum,value)=>sum+Math.abs(value),0);
  assert.equal(weak.diagnostics.heatStepSeconds,strong.diagnostics.heatStepSeconds);
  assert.ok(transported(weak)>0);
  assert.ok(transported(strong)>transported(weak)*2);
});

test('divergence-free heat transport preserves a uniform tracer under strong polar flow',()=>{
  const f=fixture(192,96);f.baselineTemperature.fill(12);
  for(let i=0;i<f.grid.size;i++) {
    const highLatitude=Math.abs(f.grid.latitude[i])>65*Math.PI/180;
    f.windEast[i]=highLatitude?8:0;f.windNorth[i]=highLatitude?(f.grid.latitude[i]>0?4:-4):0;
  }
  const ocean=run(f,oceanConfig({thermodynamicsEnabled:false,windResponseMps:2,coriolisTurn:1.5,maxCurrentMps:5,heatSteps:64,baselineRelaxation:0,lateralMixing:0}));
  assert.ok(ocean.diagnostics.heatStepSeconds>0);
  assert.ok(ocean.temperatureC.every(value=>Math.abs(value-12)<1e-10));
  assert.ok(Math.abs(ocean.diagnostics.heatMeanAfterC-ocean.diagnostics.heatMeanBeforeC)<1e-10);
});

test('currents redistribute warm and cold water and couple transport anomalies to nearby land',()=>{
  const f=fixture();for(let y=0;y<f.grid.height;y++)for(let x=0;x<6;x++)f.elevation[f.grid.index(x,y)]=300;
  const ocean=run(f),landCorrections=[];
  for(let i=0;i<f.grid.size;i++)if(f.elevation[i]>0&&ocean.coastInfluence[i]>0)landCorrections.push(ocean.airTemperatureCorrectionC[i]);
  assert.ok(Math.max(...ocean.anomalyC)>.1);assert.ok(Math.min(...ocean.anomalyC)<-.1);
  assert.ok(Math.max(...landCorrections)>0);assert.ok(Math.min(...landCorrections)<0);
  assert.ok(ocean.coastInfluence.some((value,i)=>f.elevation[i]>0&&value>0&&value<1));
});

test('disabled mode and custom hooks obey the stable public contract',()=>{
  const f=fixture();for(let y=4;y<9;y++)for(let x=4;x<9;x++)f.elevation[f.grid.index(x,y)]=200;
  const disabled=run(f,oceanConfig({enabled:false}),2);
  assert.equal(disabled.enabled,false);assert.equal(disabled.modelVersion,OCEAN_MODEL_VERSION);
  for(let i=0;i<f.grid.size;i++) {
    assert.equal(disabled.temperatureC[i],f.elevation[i]<=0?f.baselineTemperature[i]:0);
    for(const key of ['eastMps','northMps','speedMps','anomalyC','coastInfluence','airTemperatureCorrectionC'])assert.equal(disabled[key][i],0);
  }
  const formulas={version:1,expressions:{'ocean.east':'0','ocean.north':'0','ocean.temperature':'base + 1','ocean.coupling':'0'}};
  const custom=run(f,{seed:'hook-test',generationRules:{ocean:{thermodynamicsEnabled:false,heatSteps:1,lateralMixing:0,baselineRelaxation:0},formulas}},1);
  assert.ok(custom.speedMps.every(value=>value===0));
  assert.ok(custom.anomalyC.every((value,i)=>f.elevation[i]>0?value===0:Math.abs(value-1)<1e-12));
  assert.ok(custom.airTemperatureCorrectionC.every(value=>value===0));
  assert.ok(Object.hasOwn(oceanRuleSchema,'projectionIterations'));
});

test('invalid fields, seasons and direct ocean options fail before computation',()=>{
  const f=fixture(24,12);
  assert.throws(()=>oceanSeason(f.grid,f.elevation,f.windEast,f.windNorth,new Float64Array(2),{},0),/ожидается/);
  assert.throws(()=>run(f,{},4),/Сезон/);
  assert.throws(()=>run(f,oceanConfig({heatSteps:0})),/ocean.heatSteps/);
  assert.throws(()=>run(f,oceanConfig({minSstC:20,maxSstC:20})),/minSstC/);
});
