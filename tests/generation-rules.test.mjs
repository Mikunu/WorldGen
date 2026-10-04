import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultGenerationRules,generationRuleSchema,normalizeGenerationRules,parseGenerationRules,ruleFields,serializeGenerationRules} from '../src/core/generation-rules.js';
import {generateWorld,serializeWorld,validateConfig} from '../src/core/world.js';
import {refineRegion} from '../src/core/region.js';
import {applyEdit,initializeEditor,parseProject,serializeProject} from '../src/core/editor.js';
import {runoffFor} from '../src/core/climate.js';
import {makeGrid} from '../src/core/grid.js';
import {geologicalColumn} from '../src/core/geological-atlas.js';
import {potentialRaster} from '../src/core/potential-raster.js';

const input={seed:'generation-rules-test',width:48,height:24,plateCount:8,epochs:6};
const land=world=>world.geology.elevation.findIndex(value=>value>0);

test('adding a body uses active model ranges and resource scales',()=>{
  const world=initializeEditor(generateWorld({...input,generationRules:{resources:{gradeScale:.5,massScale:2,depthScale:1.5}}}));
  const grid=makeGrid(world.grid.width,world.grid.height,world.grid.radiusKm),cell=land(world);
  const next=applyEdit(world,{type:'addBody',position:grid.point(cell),modelId:'gold-vein',mode:'authored',exceptionReason:'Проверка настройки правил'});
  const d=next.atlas.deposits.find(d=>d.oreBodyId===world.editor.nextBodyId);
  assert.equal(d.depthM,45);assert.equal(d.oreMassMt,1);assert.equal(d.grade,.5);
  assert.deepEqual(next.validation.errors,[]);
});
const customRules={
  geology:{columnDepthM:1000},
  rocks:{'0':{resistance:.17}},
  depositModels:{'gold-vein':{threshold:0.73}},
  resources:{placer:{enabled:false}}
};
let customWorld;
const worldWithCustomRules=()=>customWorld??=generateWorld({...input,generationRules:customRules});

test('generation-rule schema resolves partial plain objects and describes every public field',()=>{
  const rules=normalizeGenerationRules({world:{radiusKm:7000},climate:{equatorialTemperature:34},rocks:{'0':{resistance:.4}},depositModels:{'gold-vein':{enabled:false}}});
  assert.equal(rules.world.radiusKm,7000);
  assert.equal(rules.climate.equatorialTemperature,34);
  assert.equal(rules.climate.lapseRate,defaultGenerationRules.climate.lapseRate);
  assert.equal(rules.rocks['0'].resistance,.4);
  assert.equal(rules.depositModels['gold-vein'].enabled,false);
  assert.ok(ruleFields().length>100);
  assert.equal(ruleFields(generationRuleSchema).every(field=>field.path.length>=2&&'default' in field),true);
});

test('generation-rule validation rejects unknown, exotic, invalid and inconsistent values',()=>{
  assert.throws(()=>normalizeGenerationRules({climate:{notAControl:1}}),/Неизвестное правило/);
  assert.throws(()=>normalizeGenerationRules({climate:[]}),/ожидается объект/);
  assert.throws(()=>normalizeGenerationRules(Object.assign(Object.create({world:{radiusKm:1}}),{world:{radiusKm:6371}})),/ожидается объект/);
  assert.throws(()=>normalizeGenerationRules({world:{radiusKm:Infinity}}),/допустимо/);
  assert.throws(()=>normalizeGenerationRules({world:{epochs:2.5}}),/целое/);
  assert.throws(()=>normalizeGenerationRules({world:{radiusKm:999}}),/допустимо/);
  assert.throws(()=>normalizeGenerationRules({depositModels:{'gold-vein':{massMin:30,massMax:1}}}),/не может превышать/);
  assert.throws(()=>normalizeGenerationRules({depositModels:{'gold-vein':{grades:{'1':{gradeMin:9,gradeMax:1}}}}}),/минимум превышает максимум/);
  assert.throws(()=>normalizeGenerationRules({resources:{gradeScale:20}}),/с учётом масштаба/);
  assert.throws(()=>normalizeGenerationRules({resources:{depthScale:20}}),/глубина с учётом масштаба/);
  assert.throws(()=>normalizeGenerationRules({soils:{minDepthM:2,maxDepthM:.1}}),/minDepthM не может превышать/);
  assert.throws(()=>normalizeGenerationRules({climate:{moistureZonalShare:.8,moistureMeridionalShare:.3}}),/суммарная доля переноса влаги/);
});

test('configuration rejects excessive climate and resource candidate work before generation',()=>{
  assert.throws(()=>validateConfig({width:512,height:256,radiusKm:1000,generationRules:{climate:{transportDistance:256}}}),/Слишком большой расчёт климата/);
  assert.throws(()=>validateConfig({radiusKm:20000,resourceDensity:4,generationRules:{resources:{majorIntensityScale:1000,occurrenceIntensityScale:1000},depositModels:{'gold-vein':{frequency:8}}}}),/Слишком плотная генерация ресурсов/);
});

test('generation-rule files round-trip and reject malformed or unsupported documents',()=>{
  const source={world:{epochs:9},resources:{placer:{enabled:false}},depositModels:{'gold-vein':{frequency:2}}};
  const text=serializeGenerationRules(source);
  assert.deepEqual(parseGenerationRules(text),normalizeGenerationRules(source));
  assert.deepEqual(parseGenerationRules(JSON.stringify(source)),normalizeGenerationRules(source));
  assert.throws(()=>parseGenerationRules('{'),/Не удалось прочитать/);
  assert.throws(()=>parseGenerationRules(JSON.stringify({format:'worldgen-generation-rules',version:99,rules:{}})),/Неподдерживаемый/);
  assert.throws(()=>parseGenerationRules(JSON.stringify({format:'worldgen-generation-rules',version:1,rules:{},extra:true})),/Повреждён/);
  assert.throws(()=>parseGenerationRules('x'.repeat(100001)),/100 КБ/);
});

test('active generation rules deterministically affect climate, biomes, erosion and regional detail',()=>{
  const rules={
    climate:{equatorialTemperature:42,evaporationBase:900},
    biomes:{desertPrecipitation:600},
    erosion:{incisionFactor:1.5,incisionMaximum:250},
    region:{detailAmplitude:0},
    world:{epochs:8},
    resources:{placer:{enabled:false}}
  };
  const base=generateWorld(input);
  const changed=generateWorld({...input,generationRules:rules});
  const again=generateWorld({...input,generationRules:rules});
  assert.equal(serializeWorld(changed),serializeWorld(again));
  assert.equal(changed.config.epochs,input.epochs);
  assert.equal(changed.config.generationRules.world.epochs,input.epochs);
  assert.notDeepEqual([...changed.climate.temperature],[...base.climate.temperature]);
  assert.notDeepEqual([...changed.climate.biome],[...base.climate.biome]);
  assert.notDeepEqual([...changed.geology.elevation],[...base.geology.elevation]);
  const cell=land(changed),standardRegion=refineRegion(base,land(base)),flatDetailRegion=refineRegion(changed,cell);
  assert.notDeepEqual([...flatDetailRegion.elevation],[...standardRegion.elevation]);
  assert.equal(changed.atlas.generationRules.climate.equatorialTemperature,42);
});

test('disabled deposit models are absent from the generated catalog and atlas',()=>{
  const world=generateWorld({...input,generationRules:{depositModels:{'gold-vein':{enabled:false}},resources:{placer:{enabled:false}}}});
  assert.equal(world.catalogs.depositModels.some(model=>model.id==='gold-vein'),false);
  assert.equal(world.atlas.deposits.some(deposit=>deposit.modelId==='gold-vein'||deposit.modelId==='gold-placer'),false);
});

test('all disabled models keep a known mineral potential at zero without errors',()=>{
  const depositModels=Object.fromEntries(Object.keys(defaultGenerationRules.depositModels).map(id=>[id,{enabled:false}]));
  const world=generateWorld({...input,generationRules:{depositModels,resources:{placer:{enabled:false}}}});
  assert.deepEqual(world.catalogs.depositModels,[]);
  assert.equal(world.atlas.deposits.length,0);
  const potential=potentialRaster(world,'1',{width:32,height:16});
  assert.ok(potential.values.every(value=>value===0||value===-1));
});

test('custom column depth remains exact and positive in global and regional columns',()=>{
  const world=worldWithCustomRules(),cell=land(world),region=refineRegion(world,cell,{size:15,spanKm:200});
  for(let i=0;i<world.grid.size;i++) {
    const column=geologicalColumn(world.atlas,i);
    assert.ok(column.every(layer=>layer.bottomM>layer.topM));
    assert.ok(Math.abs(column.at(-1).bottomM-1000)<1e-9);
  }
  for(let i=0;i<region.size**2;i++) {
    const layers=Array.from({length:4},(_,k)=>region.layerThicknessM[i*4+k]);
    assert.ok(layers.every(value=>value>0));
    assert.ok(Math.abs(layers.reduce((sum,value)=>sum+value,0)-1000)<1e-9);
  }
});

test('custom model thresholds remain active through terrain editing and project reload',()=>{
  const world=initializeEditor(worldWithCustomRules()),cell=land(world),grid=makeGrid(world.grid.width,world.grid.height,world.grid.radiusKm);
  assert.ok(world.atlas.deposits.some(deposit=>deposit.modelId==='gold-vein'));
  const edited=applyEdit(world,{type:'brush',channel:'elevation',path:[grid.point(cell)],radiusKm:400,strength:150,softness:.5,label:'Проверка активной модели'});
  assert.equal(edited.config.generationRules.depositModels['gold-vein'].threshold,.73);
  assert.equal(edited.atlas.generationRules.depositModels['gold-vein'].threshold,.73);
  const reloaded=parseProject(serializeProject(edited)).world;
  assert.equal(reloaded.config.generationRules.depositModels['gold-vein'].threshold,.73);
  assert.equal(reloaded.atlas.generationRules.depositModels['gold-vein'].threshold,.73);
});

test('effective rock resistance feeds the matching erosion-resistance layer',()=>{
  const world=worldWithCustomRules(),basalt=[];
  assert.equal(world.catalogs.rocks[0].resistance,.17);
  for(let i=0;i<world.grid.size;i++) {
    const rock=world.atlas.surfaceRock[i];
    assert.equal(world.geology.erosionResistance[i],world.catalogs.rocks[rock].resistance);
    if(rock===0)basalt.push(i);
  }
  assert.ok(basalt.length>0);
  assert.ok(basalt.every(i=>world.geology.erosionResistance[i]===.17));
});

test('project preserves pending rules separately and rain recalculation continues to use active rules',()=>{
  const active={climate:{evaporationBase:900,evaporationTemperatureFactor:0,evaporationMin:400,evaporationMax:500}};
  const generated=initializeEditor(generateWorld({...input,generationRules:active}));
  const pending={climate:{evaporationBase:0,evaporationTemperatureFactor:0,evaporationMin:0,evaporationMax:500}};
  const staged=applyEdit(generated,{type:'generationRules',rules:pending,label:'Новые правила'});
  assert.equal(staged.config.generationRules.climate.evaporationBase,900);
  assert.equal(staged.editor.generationRules.climate.evaporationBase,0);
  const reloaded=parseProject(serializeProject(staged)).world;
  assert.equal(reloaded.config.generationRules.climate.evaporationBase,900);
  assert.equal(reloaded.editor.generationRules.climate.evaporationBase,0);

  const cell=land(reloaded),grid=makeGrid(reloaded.grid.width,reloaded.grid.height,reloaded.grid.radiusKm),next=applyEdit(reloaded,{type:'brush',channel:'rain',path:[grid.point(cell)],radiusKm:10,strength:200,softness:0,label:'Дождь'});
  const rules=next.config.generationRules.climate;
  assert.equal(next.climate.runoffMm[cell],runoffFor(next.climate.precipitation[cell],next.climate.temperature[cell],rules));
  assert.ok(next.climate.runoffMm[cell]<next.climate.precipitation[cell]);
});
