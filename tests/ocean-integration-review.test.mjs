import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGrid} from '../src/core/grid.js';
import {climate} from '../src/core/climate.js';
import {normalizeGenerationRules} from '../src/core/generation-rules.js';
import {OCEAN_FIELDS,THERMODYNAMIC_FIELDS,validateOcean} from '../src/core/ocean-validation.js';

const grid=makeGrid(32,16,6371);
const elevation=Float64Array.from({length:grid.size},(_,i)=>{
  const x=i%grid.width,y=Math.floor(i/grid.width);
  return x>=9&&x<=14&&y>=6&&y<=9?600:-1800;
});
const config=(ocean={},expressions={})=>({seed:'ocean-integration-review',radiusKm:6371,axialTilt:23.4,generationRules:normalizeGenerationRules({ocean,formulas:{version:1,expressions}})});
const frames=ocean=>[ocean,...ocean.seasons];

test('climate supplies seasonal freshwater forcing to the thermohaline salinity hook',()=>{
  const world=climate(grid,elevation,config({}, {'ocean.salinity':'clamp(35 + freshwaterFluxMm / 100, 0, 50)'})),ocean=world.ocean;
  const values=[];
  for(let i=0;i<grid.size;i++)if(elevation[i]<=0)values.push(ocean.seasons[0].salinityPsu[i]);
  assert.ok(Math.max(...values)-Math.min(...values)>1e-8,'freshwater forcing must vary salinity');
  assert.deepEqual(validateOcean(ocean,elevation,{surfaceEnabled:true,thermodynamicsEnabled:true,rules:config().generationRules.ocean}),[]);
});

test('disabled thermodynamics produces canonical zero deep layers without changing surface validation',()=>{
  const rules=config({thermodynamicsEnabled:false}).generationRules.ocean,ocean=climate(grid,elevation,{seed:'ocean-integration-review',radiusKm:6371,axialTilt:23.4,generationRules:{...config().generationRules,ocean:rules}}).ocean;
  assert.equal(ocean.thermodynamicsEnabled,false);
  for(const frame of frames(ocean))for(const field of THERMODYNAMIC_FIELDS)assert.ok([...frame[field]].every(value=>value===0),field);
  assert.deepEqual(validateOcean(ocean,elevation,{surfaceEnabled:true,thermodynamicsEnabled:false,rules}),[]);
});

test('annual deep mask is shared by seasons and thermodynamic formula is reflected in deep circulation',()=>{
  const active=config({deepMinimumDepthM:700},{'ocean.vertical':'0'}),ocean=climate(grid,elevation,active).ocean;
  assert.ok(ocean.deepMask.some(value=>value===1));
  for(let i=0;i<grid.size;i++) {
    for(const season of ocean.seasons)assert.equal(season.deepMask[i],ocean.deepMask[i]);
    if(ocean.deepMask[i])assert.equal(ocean.verticalVelocityMps[i],0);
  }
  for(const field of OCEAN_FIELDS)assert.equal(ocean[field].length,grid.size);
  assert.deepEqual(validateOcean(ocean,elevation,{surfaceEnabled:true,thermodynamicsEnabled:true,rules:active.generationRules.ocean}),[]);
});
