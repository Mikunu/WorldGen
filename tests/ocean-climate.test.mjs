import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGrid} from '../src/core/grid.js';
import {climate} from '../src/core/climate.js';
import {validateConfig,generateWorld,validateWorld} from '../src/core/world.js';
import {validateOcean} from '../src/core/ocean-validation.js';

const grid=makeGrid(48,24,6371),elevation=new Float64Array(grid.size).fill(-1000);
for(let y=0;y<grid.height;y++)for(let x=0;x<6;x++)elevation[grid.index(x,y)]=150;
const config=(ocean={},expressions={})=>validateConfig({seed:'ocean-climate',width:48,height:24,epochs:3,erosionPasses:0,resourceDensity:0,generationRules:{ocean,formulas:{version:1,expressions}}});

test('seasonal ocean heat corrections feed air temperature and ocean moisture feeds rainfall',()=>{
  const off=climate(grid,elevation,config({enabled:false})),on=climate(grid,elevation,config());
  assert.deepEqual(validateOcean(on.ocean,elevation,true),[]);
  assert.ok(on.ocean.anomalyC.some(v=>v>.01)&&on.ocean.anomalyC.some(v=>v<-.01));
  assert.ok(on.ocean.airTemperatureCorrectionC.some((v,i)=>elevation[i]>0&&Math.abs(v)>.001));
  for(let season=0;season<4;season++)for(let i=0;i<grid.size;i++)assert.ok(Math.abs(on.seasons[season].temperature[i]-off.seasons[season].temperature[i]-on.ocean.seasons[season].airTemperatureCorrectionC[i])<1e-10);
  assert.notDeepEqual([...on.precipitation],[...off.precipitation]);
});

test('temperature formulas receive the ocean-adjusted base and SST overrides affect climate',()=>{
  const base=climate(grid,elevation,config()),authored=climate(grid,elevation,config({}, {'climate.temperature':'base + 3'}));
  for(let i=0;i<grid.size;i++)assert.ok(Math.abs(authored.temperature[i]-base.temperature[i]-3)<1e-10);
  assert.deepEqual(authored.ocean,base.ocean);
  const warmer=climate(grid,elevation,config({}, {'ocean.temperature':'min(base + 2, 38)'}));
  assert.ok(warmer.ocean.temperatureC.some((v,i)=>v>base.ocean.temperatureC[i]+1));
  assert.notDeepEqual([...warmer.precipitation],[...base.precipitation]);
  assert.notDeepEqual([...warmer.temperature],[...base.temperature]);
  const uncoupled=climate(grid,elevation,config({}, {'ocean.coupling':'0'}));
  assert.ok(uncoupled.ocean.airTemperatureCorrectionC.every(v=>v===0));
  assert.deepEqual(uncoupled.ocean.temperatureC,base.ocean.temperatureC);
});

test('disabled ocean skips runtime formulas and retains ordinary air climate',()=>{
  const off=config({enabled:false}),unused=config({enabled:false},{'ocean.east':'1 / 0','ocean.north':'1 / 0','ocean.temperature':'1 / 0','ocean.coupling':'1 / 0'});
  assert.deepEqual(climate(grid,elevation,off),climate(grid,elevation,unused));
  assert.deepEqual(generateWorld(unused).validation.errors,[]);
});

test('ocean workload rejects oversized iteration settings before allocation',()=>{
  const input={width:512,height:256,erosionPasses:8,generationRules:{climate:{transportDistance:8},ocean:{projectionIterations:96,heatSteps:64,coastReachCells:16}}};
  assert.throws(()=>validateConfig(input),/Слишком большой расчёт океана/);
  assert.doesNotThrow(()=>validateConfig({...input,generationRules:{...input.generationRules,ocean:{...input.generationRules.ocean,enabled:false}}}));
});

test('world validation rejects a missing ocean frame when ocean rules are explicit',()=>{
  const world=generateWorld(config({enabled:false}));
  delete world.climate.ocean;
  assert.ok(validateWorld(world).errors.some(error=>error.includes('слои океана')));
  delete world.config.generationRules.ocean;
  assert.deepEqual(validateWorld(world).errors,[]);
});
