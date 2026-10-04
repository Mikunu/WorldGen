import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWorld,serializeWorld,validateConfig} from '../src/core/world.js';
import {makeGrid} from '../src/core/grid.js';
import {hydrology,erode} from '../src/core/hydrology.js';
import {refineRegion} from '../src/core/region.js';

const input={seed:'formula-regression',width:48,height:24,plateCount:7,epochs:5,erosionPasses:1};
const formulas={version:1,expressions:{
  'tectonics.elevation':'base * 0.85',
  'climate.temperature':'base + 3',
  'climate.condensation':'base * 0.5',
  'climate.evaporation':'base * 0.5',
  'climate.runoff':'precipitationMm * 0.5',
  'climate.biome':'1',
  'erosion.incision':'base * 0',
  'region.elevation':'baseElevationM'
}};

test('an empty formula set preserves the complete default generation byte-for-byte',()=>{
  const standard=generateWorld(input);
  const empty=generateWorld({...input,generationRules:{formulas:{version:1,expressions:{}}}});
  assert.equal(serializeWorld(empty),serializeWorld(standard));
});

test('physical formulas change every hooked generation stage and remain deterministic',()=>{
  const standard=generateWorld(input),configured={...input,generationRules:{formulas}};
  const first=generateWorld(configured),second=generateWorld(configured);
  assert.equal(serializeWorld(first),serializeWorld(second));
  assert.notDeepEqual(Array.from(first.geology.elevation),Array.from(standard.geology.elevation));
  assert.notDeepEqual(Array.from(first.climate.temperature),Array.from(standard.climate.temperature));
  assert.notDeepEqual(Array.from(first.climate.precipitation),Array.from(standard.climate.precipitation));
  assert.notDeepEqual(Array.from(first.climate.runoffMm),Array.from(standard.climate.runoffMm));
  for(let i=0;i<first.grid.size;i++)if(first.geology.elevation[i]>0)assert.equal(first.climate.biome[i],1);

  const cell=first.geology.elevation.findIndex(value=>value>0),withoutRegionalFormula={...first,config:structuredClone(first.config)};
  delete withoutRegionalFormula.config.generationRules.formulas.expressions['region.elevation'];
  const regional=refineRegion(first,cell,{size:15,spanKm:200}),standardRegional=refineRegion(withoutRegionalFormula,cell,{size:15,spanKm:200});
  assert.notDeepEqual(Array.from(regional.elevation),Array.from(standardRegional.elevation));
});

test('erosion incision formula changes the erosion result without changing routing',()=>{
  const grid=makeGrid(24,12,6371),original=new Float64Array(grid.size).fill(1000),runoff=new Float64Array(grid.size).fill(1200);
  original[grid.index(0,6)]=-100;
  const water=hydrology(grid,original,runoff),ordinary=Float64Array.from(original),custom=Float64Array.from(original);
  erode(grid,ordinary,water,new Float64Array(grid.size),validateConfig(input));
  erode(grid,custom,water,new Float64Array(grid.size),validateConfig({...input,generationRules:{formulas:{version:1,expressions:{'erosion.incision':'base * 0'}}}}));
  assert.notDeepEqual(Array.from(custom),Array.from(ordinary));
  assert.deepEqual(Array.from(water.downstream),Array.from(hydrology(grid,original,runoff).downstream));
});
