import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWorld,validateWorld} from '../src/core/world.js';
import {applyEdit,createHistory,initializeEditor,parseProject,serializeProject} from '../src/core/editor.js';
import {makeGrid} from '../src/core/grid.js';
import {OCEAN_FIELDS,THERMODYNAMIC_FIELDS} from '../src/core/ocean-validation.js';
import {oceanThermodynamicRuleSchema} from '../src/core/ocean-thermodynamics.js';

const input={seed:'ocean-projects',width:48,height:24,plateCount:7,epochs:5,erosionPasses:1};
const land=world=>world.geology.elevation.findIndex(value=>value>0);
const thermodynamicRules=Object.keys(oceanThermodynamicRuleSchema);
const oceanFrames=ocean=>[ocean,...ocean.seasons];
const savedSurface=ocean=>oceanFrames(ocean).map(frame=>Object.fromEntries(OCEAN_FIELDS.map(field=>[field,[...frame[field]]])));
function eraseThermodynamics(world) {
  for(const holder of [world.config,world.atlas,world.editor])for(const field of thermodynamicRules)delete holder.generationRules.ocean[field];
  for(const frame of oceanFrames(world.climate.ocean)) {
    delete frame.thermodynamicsEnabled;delete frame.thermodynamicsModelVersion;
    for(const field of THERMODYNAMIC_FIELDS)delete frame[field];
  }
}

test('projects restore the complete typed ocean archive and active metadata',()=>{
  const source=initializeEditor(generateWorld(input)),restored=parseProject(serializeProject(source)).world,ocean=restored.climate.ocean;
  assert.equal(ocean.enabled,true);
  assert.equal(ocean.modelVersion,'surface-ocean-1');
  assert.equal(ocean.seasons.length,4);
  for(const layer of [ocean,...ocean.seasons])for(const field of OCEAN_FIELDS)assert.ok(layer[field] instanceof Float64Array,field);
  assert.deepEqual(validateWorld(restored).errors,[]);
});

test('projects restore every thermodynamic field with its saved typed-array shape',()=>{
  const restored=parseProject(serializeProject(initializeEditor(generateWorld(input)))).world,ocean=restored.climate.ocean;
  assert.equal(ocean.thermodynamicsEnabled,true);
  assert.equal(ocean.thermodynamicsModelVersion,'two-layer-thermohaline-1');
  for(const frame of oceanFrames(ocean)) {
    assert.equal(frame.thermodynamicsEnabled,true);
    assert.equal(frame.thermodynamicsModelVersion,'two-layer-thermohaline-1');
    for(const field of THERMODYNAMIC_FIELDS)assert.ok(frame[field] instanceof (field==='deepMask'?Uint8Array:Float64Array),field);
  }
  assert.deepEqual(validateWorld(restored).errors,[]);
});

test('0.8 surface oceans migrate disabled thermodynamics without changing saved surface layers',()=>{
  const project=JSON.parse(serializeProject(initializeEditor(generateWorld(input)))),old=project.world,surface=savedSurface(old.climate.ocean);
  eraseThermodynamics(old);
  const restored=parseProject(JSON.stringify(project)).world,ocean=restored.climate.ocean;
  assert.equal(restored.config.generationRules.ocean.enabled,true);
  assert.equal(restored.config.generationRules.ocean.thermodynamicsEnabled,false);
  assert.equal(restored.atlas.generationRules.ocean.thermodynamicsEnabled,false);
  assert.equal(restored.editor.generationRules.ocean.thermodynamicsEnabled,true);
  assert.deepEqual(savedSurface(ocean),surface);
  for(const frame of oceanFrames(ocean)) {
    assert.equal(frame.thermodynamicsEnabled,false);
    for(const field of THERMODYNAMIC_FIELDS)assert.ok([...frame[field]].every(value=>value===0),field);
  }
  assert.deepEqual(validateWorld(restored).errors,[]);
});

test('thermodynamics migration keeps atlas rule consistency checks',()=>{
  const project=JSON.parse(serializeProject(initializeEditor(generateWorld(input)))),old=project.world;
  eraseThermodynamics(old);
  old.atlas.generationRules.climate.latitudeCooling+=1;
  assert.throws(()=>parseProject(JSON.stringify(project)),/Правила атласа не согласованы с правилами мира/);
});

test('partial thermodynamic metadata is corruption rather than a legacy migration',()=>{
  const project=JSON.parse(serializeProject(initializeEditor(generateWorld(input)))),old=project.world;
  eraseThermodynamics(old);
  old.climate.ocean.seasons[0].thermodynamicsModelVersion='two-layer-thermohaline-1';
  assert.throws(()=>parseProject(JSON.stringify(project)),/глубин|слой/i);
});

test('old projects without an ocean section migrate to disabled active rules without recalculating climate',()=>{
  const project=JSON.parse(serializeProject(initializeEditor(generateWorld(input)))),old=project.world,temperature=[...old.climate.temperature],seasonal=old.climate.seasons.map(season=>[...season.temperature]);
  delete old.climate.ocean;
  delete old.config.generationRules.ocean;
  delete old.atlas.generationRules.ocean;
  delete old.editor.generationRules.ocean;
  const restored=parseProject(JSON.stringify(project)).world,ocean=restored.climate.ocean;
  assert.equal(restored.config.generationRules.ocean.enabled,false);
  assert.equal(restored.atlas.generationRules.ocean.enabled,false);
  assert.equal(restored.editor.generationRules.ocean.enabled,true);
  assert.equal(ocean.enabled,false);
  assert.deepEqual([...restored.climate.temperature],temperature);
  assert.deepEqual(restored.climate.seasons.map(season=>[...season.temperature]),seasonal);
  for(let i=0;i<restored.grid.size;i++)if(restored.geology.elevation[i]>0)for(const field of ['eastMps','northMps','speedMps','temperatureC','anomalyC'])assert.equal(ocean[field][i],0);
  assert.deepEqual(validateWorld(restored).errors,[]);
});

test('legacy ocean migration keeps atlas rule consistency checks',()=>{
  const project=JSON.parse(serializeProject(initializeEditor(generateWorld(input)))),old=project.world;
  delete old.climate.ocean;
  delete old.config.generationRules.ocean;
  delete old.atlas.generationRules.ocean;
  delete old.editor.generationRules.ocean;
  old.atlas.generationRules.climate.latitudeCooling+=1;
  assert.throws(()=>parseProject(JSON.stringify(project)),/Правила атласа не согласованы с правилами мира/);
});

test('projects reject corrupted ocean fields, metadata and land-only values',()=>{
  const corrupt=mutate=>{
    const project=JSON.parse(serializeProject(initializeEditor(generateWorld(input))));
    mutate(project.world);
    assert.throws(()=>parseProject(JSON.stringify(project)),/океан|Океан|слой/i);
  };
  corrupt(world=>{world.climate.ocean.eastMps[world.geology.elevation.findIndex(value=>value>0)]=.1;});
  corrupt(world=>{world.climate.ocean.seasons[2].modelVersion='wrong';});
  corrupt(world=>{world.climate.ocean.temperatureC.pop();});
  corrupt(world=>{delete world.climate.ocean;});
  corrupt(world=>{delete world.climate.ocean.deepMask;});
  corrupt(world=>{world.climate.ocean.deepMask[land(world)]=1;});
});

test('terrain recompute and undo preserve active ocean rules while pending rules may disable them',()=>{
  const world=initializeEditor(generateWorld(input)),staged=applyEdit(world,{type:'generationRules',rules:{ocean:{enabled:false}}});
  assert.equal(staged.config.generationRules.ocean.enabled,true);
  assert.equal(staged.editor.generationRules.ocean.enabled,false);
  const cell=land(staged),grid=makeGrid(staged.grid.width,staged.grid.height,staged.grid.radiusKm),edited=applyEdit(staged,{type:'brush',channel:'rain',path:[grid.point(cell)],radiusKm:300,strength:150,softness:0});
  assert.equal(edited.climate.ocean.enabled,true);
  assert.equal(edited.config.generationRules.ocean.enabled,true);
  assert.equal(edited.editor.generationRules.ocean.enabled,false);
  assert.deepEqual(validateWorld(edited).errors,[]);
  const history=createHistory();history.push(staged);
  const undone=history.undo(edited);
  assert.equal(undone.climate.ocean.enabled,true);
  assert.equal(undone.editor.generationRules.ocean.enabled,false);
});

test('terrain recompute and undo preserve active thermodynamics while pending rules may disable them',()=>{
  const world=initializeEditor(generateWorld(input)),staged=applyEdit(world,{type:'generationRules',rules:{ocean:{thermodynamicsEnabled:false}}});
  assert.equal(staged.config.generationRules.ocean.thermodynamicsEnabled,true);
  assert.equal(staged.editor.generationRules.ocean.thermodynamicsEnabled,false);
  const cell=land(staged),grid=makeGrid(staged.grid.width,staged.grid.height,staged.grid.radiusKm),edited=applyEdit(staged,{type:'brush',channel:'rain',path:[grid.point(cell)],radiusKm:300,strength:150,softness:0});
  assert.equal(edited.climate.ocean.thermodynamicsEnabled,true);
  assert.equal(edited.config.generationRules.ocean.thermodynamicsEnabled,true);
  assert.equal(edited.editor.generationRules.ocean.thermodynamicsEnabled,false);
  assert.deepEqual(validateWorld(edited).errors,[]);
  const history=createHistory();history.push(staged);
  const undone=history.undo(edited);
  assert.equal(undone.climate.ocean.thermodynamicsEnabled,true);
  assert.equal(undone.editor.generationRules.ocean.thermodynamicsEnabled,false);
});
