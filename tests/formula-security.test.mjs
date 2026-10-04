import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultGenerationRules} from '../src/core/generation-rules.js';
import {generateWorld,validateConfig} from '../src/core/world.js';
import {generateDeposits} from '../src/core/deposit-models.js';
import {potentialRaster} from '../src/core/potential-raster.js';
import {FORMULA_DESCRIPTORS,FORMULA_ENVIRONMENTS} from '../src/core/generation-formulas.js';
import {makeGrid} from '../src/core/grid.js';

const documentFor=expressions=>({version:1,expressions});

test('workload validation charges mineralization formulas for every resource candidate',()=>{
  const depositModels=Object.fromEntries(Object.keys(defaultGenerationRules.depositModels).map(id=>[id,{enabled:id==='gold-vein'}]));
  const maximumCostFormula=`min(base${',1'.repeat(190)})`;
  assert.throws(()=>validateConfig({
    width:24,
    height:12,
    radiusKm:20000,
    resourceDensity:4,
    erosionPasses:0,
    generationRules:{
      depositModels,
      formulas:documentFor({
        'resources.intensity':'if(isOccurrence, 0, 2000000)',
        'mineralization.formation':maximumCostFormula
      })
    }
  }),/Слишком большой расчёт формул/);
});

test('workload validation skips resource streams disabled by a zero class factor',()=>{
  const depositModels=Object.fromEntries(Object.keys(defaultGenerationRules.depositModels).map(id=>[id,{enabled:id==='gold-vein'}]));
  assert.doesNotThrow(()=>validateConfig({
    width:24,
    height:12,
    generationRules:{
      resources:{occurrenceFactor:0},
      depositModels,
      formulas:documentFor({'resources.intensity':'1 / classFactor'})
    }
  }));
});

test('workload validation skips resource generation disabled by zero density or model frequency',()=>{
  const onlyGold=frequency=>Object.fromEntries(Object.keys(defaultGenerationRules.depositModels).map(id=>[id,{enabled:id==='gold-vein',...(id==='gold-vein'?{frequency}:{})}]));
  assert.doesNotThrow(()=>validateConfig({
    width:24,
    height:12,
    resourceDensity:0,
    generationRules:{
      formulas:documentFor({'resources.intensity':'1 / density'})
    }
  }));
  assert.doesNotThrow(()=>validateConfig({
    width:24,
    height:12,
    generationRules:{
      depositModels:onlyGold(0),
      formulas:documentFor({'resources.intensity':'1 / frequency'})
    }
  }));
});

test('editor-style resource overrides hit the formula-cost guard before proposing points',()=>{
  const depositModels=Object.fromEntries(Object.keys(defaultGenerationRules.depositModels).map(id=>[id,{enabled:id==='gold-vein'}]));
  const maximumCostFormula=`min(base${',1'.repeat(190)})`;
  const world=generateWorld({
    seed:'resource-override-guard',width:24,height:12,plateCount:3,epochs:1,erosionPasses:0,resourceDensity:.01,
    generationRules:{
      depositModels,
      formulas:documentFor({
        'resources.intensity':'min(2000000, density * classFactor * 100000)',
        'mineralization.formation':maximumCostFormula
      })
    }
  });
  let proposed=0;
  assert.throws(()=>generateDeposits(
    makeGrid(world.grid.width,world.grid.height,world.grid.radiusKm),
    world.geology,world.water,world.atlas,{...world.config,resourceDensity:4},
    {modelIds:['gold-vein'],majorFactor:4,occurrenceFactor:0,sitePredicate:()=>{proposed++;return false;}}
  ),/Слишком большой расчёт формул ресурсов/);
  assert.equal(proposed,0);
});

test('potential raster rejects excessive pixel-by-model formula work before sampling cells',()=>{
  const maximumCostFormula=`min(base${',1'.repeat(190)})`;
  const world=generateWorld({
    seed:'potential-cost-guard',width:24,height:12,plateCount:3,epochs:1,erosionPasses:0,resourceDensity:0,
    generationRules:{formulas:documentFor({'mineralization.formation':maximumCostFormula})}
  });
  let elevationReads=0;
  world.geology.elevation=new Proxy(world.geology.elevation,{get(target,key){if(/^\d+$/.test(String(key)))elevationReads++;return Reflect.get(target,key,target);}});
  assert.throws(()=>potentialRaster(world,'all',{width:768,height:384}),/Слишком большой расчёт формул рудного потенциала/);
  assert.equal(elevationReads,0);
});

test('formula capability metadata is deeply immutable',()=>{
  assert.ok(Object.isFrozen(FORMULA_DESCRIPTORS));
  assert.ok(Object.isFrozen(FORMULA_ENVIRONMENTS));
  assert.ok(FORMULA_DESCRIPTORS.every(descriptor=>Object.isFrozen(descriptor)&&Object.isFrozen(descriptor.variables)&&descriptor.variables.every(Object.isFrozen)));
  assert.throws(()=>FORMULA_DESCRIPTORS[0].variables.push({name:'constructor'}),TypeError);
  assert.throws(()=>FORMULA_ENVIRONMENTS.push('__proto__'),TypeError);
});

test('global workload validation does not charge regional formulas for unrelated erosion passes',()=>{
  const maximumCostFormula=`min(base${',50000'.repeat(190)})`;
  assert.doesNotThrow(()=>validateConfig({
    width:512,height:256,erosionPasses:8,
    generationRules:{formulas:documentFor({'region.elevation':maximumCostFormula})}
  }));
});
