import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWorld,serializeWorld,validateConfig,validateWorld} from '../src/core/world.js';
import {normalizeGenerationRules,parseGenerationRules,RULES_FORMAT,RULES_VERSION,serializeGenerationRules} from '../src/core/generation-rules.js';
import {makeFormulaEvaluator} from '../src/core/generation-formulas.js';
import {initializeEditor,applyEdit,serializeProject,parseProject} from '../src/core/editor.js';
import {makeGrid} from '../src/core/grid.js';
import {potentialRaster} from '../src/core/potential-raster.js';

const input={seed:'formula-contract',width:48,height:24,plateCount:7,epochs:5,erosionPasses:1,resourceDensity:2};
const documentFor=expressions=>({version:1,expressions});
const generated=expressions=>generateWorld({...input,generationRules:{formulas:documentFor(expressions)}});

test('normalizes formula documents and reads both generation-rule format versions',()=>{
  const rules={world:{epochs:6},formulas:documentFor({'climate.temperature':'base + 1'})};
  const normalized=normalizeGenerationRules(rules);
  assert.equal(normalized.formulas.expressions['climate.temperature'],'base + 1');
  const current=JSON.parse(serializeGenerationRules(rules));
  assert.equal(current.format,RULES_FORMAT);
  assert.equal(current.version,RULES_VERSION);
  assert.deepEqual(parseGenerationRules(JSON.stringify({...current,version:1})).formulas,normalized.formulas);
});

test('formula rand and noise are deterministic for a seed and differ for another seed',()=>{
  const rules={formulas:documentFor({'climate.condensation':'clamp((rand(7) + noise(x, y, z, 2)) / 2, 0, 1)'})};
  const values={latitudeDeg:10,longitudeDeg:20,elevationM:300,isOcean:0,season:2,x:.1,y:.2,z:.3};
  const first=makeFormulaEvaluator(rules,'same').evaluate('climate.condensation',values,.4,'cell 9');
  const repeat=makeFormulaEvaluator(rules,'same').evaluate('climate.condensation',values,.4,'cell 9');
  const other=makeFormulaEvaluator(rules,'other').evaluate('climate.condensation',values,.4,'cell 9');
  assert.equal(first,repeat);
  assert.notEqual(first,other);
});

test('soil, hazard, sediment and geological-environment formulas update atlas layers',()=>{
  const ordinary=generated({});
  const custom=generated({
    'geology.sediments':'0',
    'soils.depth':'0',
    'soils.fertility':'0',
    'hazards.earthquake':'0',
    'geology.environment':'0'
  });
  assert.deepEqual(custom.validation.errors,[]);
  assert.ok(custom.atlas.sedimentThicknessM.every(value=>value===0));
  assert.ok(custom.atlas.soilDepthM.every(value=>value===0));
  assert.ok(custom.atlas.fertility.every(value=>value===0));
  assert.ok(custom.atlas.hazards.earthquake.every(value=>value===0));
  assert.ok(Object.values(custom.atlas.environments).every(layer=>layer.every(value=>value===0)));
  assert.notDeepEqual(Array.from(ordinary.atlas.sedimentThicknessM),Array.from(custom.atlas.sedimentThicknessM));
});

test('mineralization formula persists in the atlas and changes potential raster',()=>{
  const ordinary=generated({}),custom=generated({'mineralization.formation':'0'});
  assert.deepEqual(custom.validation.errors,[]);
  assert.equal(custom.atlas.generationRules.formulas.expressions['mineralization.formation'],'0');
  const baseline=potentialRaster(ordinary,'all',{width:32,height:16}),changed=potentialRaster(custom,'all',{width:32,height:16});
  assert.ok(baseline.values.some(value=>value>0));
  assert.ok(changed.values.every(value=>value<=0));
});

test('active rand/noise mineralization remains valid during resource regeneration with another placement seed',()=>{
  const world=generated({'mineralization.formation':'clamp((rand(4) + noise(x, y, z, 6)) / 2, 0, 1)'}),geologicalSeed=world.atlas.mineralization.seed;
  const regenerated=applyEdit(initializeEditor(world),{type:'regenerate',seed:'different-placement-seed'});
  assert.deepEqual(validateWorld(regenerated).errors,[]);
  assert.equal(regenerated.atlas.mineralization.seed,geologicalSeed);
  const restored=parseProject(serializeProject(regenerated)).world;
  assert.deepEqual(validateWorld(restored).errors,[]);
  assert.equal(restored.atlas.mineralization.seed,geologicalSeed);
  assert.equal(restored.config.generationRules.formulas.expressions['mineralization.formation'],'clamp((rand(4) + noise(x, y, z, 6)) / 2, 0, 1)');
});

test('resource formulas can suppress candidates and set generated body mass, depth and grade',()=>{
  const none=generated({'resources.intensity':'0'});
  assert.equal(none.atlas.deposits.length,0);
  const world=generated({'resources.mass':'minValue * scale','resources.depth':'minValue * scale','resources.grade':'minValue * scale'});
  const deposit=world.atlas.deposits.find(value=>value.modelId!=='gold-placer');
  assert.ok(deposit,'expected at least one generated primary body');
  const model=world.catalogs.depositModels.find(value=>value.id===deposit.modelId),component=model.components.find(value=>value.mineral===deposit.mineral);
  const resources=world.config.generationRules.resources,small=deposit.sizeClass==='occurrence';
  assert.equal(deposit.oreMassMt,model.mass[0]*(small?resources.occurrenceMassFactor:1)*resources.massScale);
  assert.equal(deposit.depthM,model.depth[0]*resources.depthScale);
  assert.equal(deposit.grade,component.grade[0]*resources.gradeScale);
});

test('manual addBody uses active resource formulas while the formula-free minimum stays compatible',()=>{
  const add=(world,expressions={})=>{
    const editor=initializeEditor(world),grid=makeGrid(editor.grid.width,editor.grid.height,editor.grid.radiusKm),cell=editor.geology.elevation.findIndex(value=>value>0),oreBodyId=editor.editor.nextBodyId;
    editor.config={...editor.config,generationRules:normalizeGenerationRules({formulas:documentFor(expressions)})};
    const next=applyEdit(editor,{type:'addBody',position:grid.point(cell),modelId:'gold-vein',mode:'authored',exceptionReason:'Проверка формул ручного тела'});
    return next.atlas.deposits.find(value=>value.oreBodyId===oreBodyId);
  };
  const ordinary=add(generated({}));
  assert.equal(ordinary.oreMassMt,.5);
  assert.equal(ordinary.depthM,30);
  assert.equal(ordinary.grade,1);
  assert.equal(ordinary.accessDifficulty,30/1600);

  const custom=add(generated({}),{'resources.mass':'minValue * scale * 2','resources.depth':'minValue * scale * 2','resources.grade':'minValue * scale * 2','resources.access':'0.75'});
  assert.equal(custom.oreMassMt,1);
  assert.equal(custom.depthM,60);
  assert.equal(custom.grade,2);
  assert.equal(custom.accessDifficulty,.75);
});

test('pending project formulas stay pending while rain editing keeps active runoff formula',()=>{
  const active=generated({'climate.runoff':'0'}),editor=initializeEditor(active);
  const pending=applyEdit(editor,{type:'generationRules',rules:{formulas:documentFor({'climate.runoff':'precipitationMm'})}});
  assert.equal(pending.config.generationRules.formulas.expressions['climate.runoff'],'0');
  assert.equal(pending.editor.generationRules.formulas.expressions['climate.runoff'],'precipitationMm');
  const cell=pending.geology.elevation.findIndex(value=>value>0),grid=makeGrid(pending.grid.width,pending.grid.height,pending.grid.radiusKm);
  const edited=applyEdit(pending,{type:'brush',channel:'rain',path:[grid.point(cell)],radiusKm:400,strength:200,softness:0});
  assert.equal(edited.climate.runoffMm[cell],0);
  const restored=parseProject(serializeProject(edited)).world;
  assert.equal(restored.config.generationRules.formulas.expressions['climate.runoff'],'0');
  assert.equal(restored.editor.generationRules.formulas.expressions['climate.runoff'],'precipitationMm');
});

test('out-of-range output and excessive formula work fail before a committed world changes',()=>{
  const committed=generated({}),snapshot=serializeWorld(committed);
  assert.throws(()=>generated({'climate.runoff':'precipitationMm + 1'}),/Поверхностный сток/);
  assert.equal(serializeWorld(committed),snapshot);
  assert.throws(()=>validateConfig({width:512,height:256,radiusKm:20000,generationRules:{formulas:documentFor({'climate.condensation':'base + 0 + 0 + 0'})}}),/Слишком большой расчёт формул/);
});
