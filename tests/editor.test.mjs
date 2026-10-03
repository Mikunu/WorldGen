import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWorld,serializeWorld,validateWorld} from '../src/core/world.js';
import {makeGrid} from '../src/core/grid.js';
import {sphericalPoint,pointDistance} from '../src/core/spatial.js';
import {makeProspectivitySampler} from '../src/core/mineralization.js';
import {depositModels} from '../src/core/deposit-models.js';
import {applyEdit,initializeEditor,defaultRules,createHistory,serializeProject,parseProject,inArea,editImpact} from '../src/core/editor.js';

const base=initializeEditor(generateWorld({seed:'editor-regression',width:48,height:24,epochs:6,plateCount:8}));
const grid=makeGrid(48,24,6371),land=base.geology.elevation.findIndex(h=>h>0),p=grid.point(land);
const body=base.atlas.deposits.find(d=>base.atlas.deposits.filter(c=>c.oreBodyId===d.oreBodyId).length>1);
const group=(w,id)=>w.atlas.deposits.filter(d=>d.oreBodyId===id);
const brush=(w,extra={})=>applyEdit(w,{type:'brush',channel:'elevation',path:[p],radiusKm:1200,strength:400,softness:.7,...extra});

test('editing a polymetallic body updates shared mass/position and every component inventory without mutating its source',()=>{
  const before=serializeWorld(base),ds=group(base,body.oreBodyId);
  const next=applyEdit(base,{type:'editBody',bodyId:body.oreBodyId,patch:{oreMassMt:body.oreMassMt*2,latitudeDeg:0,longitudeDeg:179.9,name:'Авторская жила',exceptionReason:'Задано автором'}});
  assert.equal(serializeWorld(base),before);assert.deepEqual(validateWorld(next).errors,[]);
  for(const [i,d] of group(next,body.oreBodyId).entries()){assert.equal(d.oreMassMt,body.oreMassMt*2);assert.ok(Math.abs(d.containedResourceTonnes/ds[i].containedResourceTonnes-2)<1e-10);assert.equal(d.longitudeDeg,179.9);assert.equal(d.provenance,'authored');assert.equal(d.name,'Авторская жила');}
});

test('locked bodies reject edits/deletion and unlocking is a separate operation',()=>{
  const locked=applyEdit(base,{type:'editBody',bodyId:body.oreBodyId,patch:{locked:true}});
  assert.throws(()=>applyEdit(locked,{type:'deleteBody',bodyId:body.oreBodyId}),/закреплена/);
  assert.throws(()=>applyEdit(locked,{type:'editBody',bodyId:body.oreBodyId,patch:{locked:false,name:'Обход'}}),/закреплена/);
  const unlocked=applyEdit(locked,{type:'editBody',bodyId:body.oreBodyId,patch:{locked:false}});
  assert.equal(group(unlocked,body.oreBodyId)[0].locked,false);
  const removed=applyEdit(unlocked,{type:'deleteBody',bodyId:body.oreBodyId});assert.equal(group(removed,body.oreBodyId).length,0);assert.deepEqual(removed.validation.errors,[]);
});

test('a placer inside a locked area survives deletion of its unprotected source as an explicit exception',()=>{
  const placer=base.atlas.deposits.find(d=>d.modelId==='gold-placer');assert.ok(placer);
  const source=base.atlas.deposits[placer.sourceDepositId];
  const distance=pointDistance(source.position,placer.position,6371);assert.ok(distance>1);
  const locked=applyEdit(base,{type:'locks',area:{center:placer.position,radiusKm:Math.min(10,distance/2)},areaResources:true});
  const next=applyEdit(locked,{type:'deleteBody',bodyId:source.oreBodyId}),retained=group(next,placer.oreBodyId);
  assert.equal(retained.length,1);assert.equal(retained[0].provenance,'authored');assert.equal(retained[0].sourceDepositId,null);assert.deepEqual(next.validation.errors,[]);
});

test('regenerated bodies obey configured spacing including retained exterior neighbors',()=>{
  const area={center:body.position,radiusKm:2500},r={...defaultRules,density:3,majorSpacing:250,minorSpacing:100,modelIds:[body.modelId]};
  const next=applyEdit(base,{type:'regenerate',area,rules:r,seed:'spacing-replacement'}),ds=next.atlas.deposits.filter(d=>d.modelId===body.modelId);
  const bodies=[...new Map(ds.map(d=>[d.oreBodyId,d])).values()];
  for(const d of bodies.filter(d=>d.oreBodyId>=base.editor.nextBodyId))for(const other of bodies)if(d.oreBodyId!==other.oreBodyId)assert.ok(pointDistance(d.position,other.position,6371)+1e-8>=(d.sizeClass==='major'&&other.sizeClass==='major'?250:100));
});

test('local regeneration preserves exterior bodies, locked interiors, other families and all physical fields',()=>{
  const area={center:body.position,radiusKm:2500};
  const locked=applyEdit(base,{type:'editBody',bodyId:body.oreBodyId,patch:{locked:true}});
  const op={type:'regenerate',area,seed:'local-replacement',rules:{...defaultRules,density:3,modelIds:[body.modelId]}};
  const next=applyEdit(locked,op),again=applyEdit(locked,op);assert.deepEqual(next,again);
  for(const d of locked.atlas.deposits.filter(d=>!inArea(d.position,area,6371)||d.modelId!==body.modelId||d.locked)) {
    const c=next.atlas.deposits.find(c=>c.oreBodyId===d.oreBodyId&&c.mineral===d.mineral);assert.ok(c);assert.deepEqual(c.position,d.position);assert.equal(c.grade,d.grade);assert.equal(c.oreMassMt,d.oreMassMt);
  }
  for(const key of ['geology','climate','water'])assert.deepEqual(next[key],locked[key]);
  assert.ok(next.atlas.deposits.some(d=>d.oreBodyId>=locked.editor.nextBodyId));assert.deepEqual(next.validation.errors,[]);
});

test('locked areas and layers protect resources and terrain at their spherical positions',()=>{
  const area={center:p,radiusKm:800},locked=applyEdit(base,{type:'locks',area,areaTerrain:true,areaResources:true});
  const next=brush(locked);assert.equal(next.geology.elevation[land],base.geology.elevation[land]);
  const regenerated=applyEdit(locked,{type:'regenerate',area,seed:'protected',rules:{...defaultRules,density:0}});
  assert.deepEqual(regenerated.atlas.deposits,locked.atlas.deposits);
  const global=applyEdit(base,{type:'locks',terrain:true,resources:true});
  assert.throws(()=>brush(global),/закреплены/);assert.throws(()=>applyEdit(global,{type:'regenerate'}),/закреплён/);
});

test('terrain brushes are spatial, soften edges, recalculate dependencies and preserve protected ore bodies',()=>{
  const locked=applyEdit(base,{type:'editBody',bodyId:body.oreBodyId,patch:{locked:true}});
  const next=brush(locked);assert.equal(next.geology.elevation[land],base.geology.elevation[land]+400);
  for(let i=0;i<grid.size;i++)if(pointDistance(grid.point(i),p,6371)>=1200)assert.equal(next.geology.elevation[i],base.geology.elevation[i]);
  assert.notDeepEqual(next.climate.temperature,base.climate.temperature);assert.deepEqual(next.validation.errors,[]);assert.equal(group(next,body.oreBodyId).length,group(base,body.oreBodyId).length);
  const impact=editImpact(base,next,{type:'brush',channel:'elevation'});assert.ok(impact.cells>0);assert.ok(impact.recalculated.includes('водосборы'));
});

test('locked ore bodies that become submerged are retained as documented authorial exceptions',()=>{
  const locked=applyEdit(base,{type:'editBody',bodyId:body.oreBodyId,patch:{locked:true}});
  const next=brush(locked,{path:[body.position],radiusKm:1800,mode:'set',targetM:-2000,strength:0,softness:0});
  for(const d of group(next,body.oreBodyId)){assert.equal(d.provenance,'authored');assert.ok(d.exceptionReason);assert.equal(d.locked,true);}
  assert.deepEqual(next.validation.errors,[]);
});

test('rain edits affect rainfall/runoff and persist through later terrain recalculation',()=>{
  const rainy=brush(base,{channel:'rain',strength:200}),raised=brush(rainy);
  assert.ok(Math.abs(rainy.climate.precipitation[land]-base.climate.precipitation[land]-200)<1e-8);
  assert.ok(rainy.climate.runoffMm[land]>base.climate.runoffMm[land]);assert.equal(raised.editor.rainAdjustments[land],200);
  assert.deepEqual(raised.validation.errors,[]);
});

test('prospectivity paint changes the generation/potential field without inventing a geological setting',()=>{
  const rule=depositModels.find(m=>m.id===body.modelId),painted=brush(base,{channel:'potential',path:[body.position],strength:1,rules:{...defaultRules,modelIds:[rule.id]}});
  const old=makeProspectivitySampler(grid,base.geology,base.atlas),next=makeProspectivitySampler(grid,painted.geology,painted.atlas);
  assert.ok(next.potential([rule],body.position)>=old.potential([rule],body.position));
  assert.equal(next.potential([rule],grid.point(base.geology.elevation.findIndex(h=>h<=0))),0);
  assert.deepEqual(painted.geology,base.geology);assert.deepEqual(painted.atlas.deposits,base.atlas.deposits);
  const terrainLocked=applyEdit(base,{type:'locks',terrain:true});assert.doesNotThrow(()=>brush(terrainLocked,{channel:'potential',strength:1}));
});

test('natural placement requires geology; authored placement requires a reason and retains a shared body',()=>{
  const sea=grid.point(base.geology.elevation.findIndex(h=>h<=0));
  assert.throws(()=>applyEdit(base,{type:'addBody',position:sea,modelId:'porphyry',mode:'natural'}),/не подходят/);
  assert.throws(()=>applyEdit(base,{type:'addBody',position:sea,modelId:'porphyry',mode:'authored'}),/причину/);
  const next=applyEdit(base,{type:'addBody',position:sea,modelId:'porphyry',mode:'authored',exceptionReason:'Затопленная древняя интрузия'});
  const added=group(next,base.editor.nextBodyId);assert.equal(added.length,2);assert.ok(added.every(d=>d.locked&&d.provenance==='authored'));assert.deepEqual(next.validation.errors,[]);
});

test('invalid positions, grades and brush/rule settings fail without changing the committed world',()=>{
  const before=serializeWorld(base);
  assert.throws(()=>applyEdit(base,{type:'editBody',bodyId:body.oreBodyId,patch:{grades:{[body.mineral]:1e9},exceptionReason:'Ошибка'}}));
  assert.throws(()=>brush(base,{radiusKm:NaN}));assert.throws(()=>applyEdit(base,{type:'regenerate',rules:{density:Infinity}}));
  assert.throws(()=>applyEdit(base,{type:'addBody',position:[0,0,0],modelId:'porphyry'}));
  assert.equal(serializeWorld(base),before);
});

test('spherical selections wrap longitude and cover poles without selecting the opposite hemisphere',()=>{
  const area={center:sphericalPoint(0,179),radiusKm:500};assert.ok(inArea(sphericalPoint(0,-179),area,6371));assert.ok(!inArea(sphericalPoint(0,0),area,6371));
  const pole={center:sphericalPoint(90,0),radiusKm:300};assert.ok(inArea(sphericalPoint(89,-130),pole,6371));
});

test('undo/redo restores exact states, new changes discard redo, and history has a bounded size',()=>{
  const history=createHistory(2),a=applyEdit(base,{type:'province',provinceId:0,name:'А'}),b=applyEdit(a,{type:'province',provinceId:0,name:'Б'});
  history.push(base);history.push(a);assert.equal(history.undo(b),a);assert.equal(history.redo(a),b);
  assert.equal(history.undo(b),a);history.push(a);assert.equal(history.canRedo,false);
  history.push(b);history.push(base);assert.equal(history.undo(a),base);assert.equal(history.undo(base),b);assert.equal(history.undo(b),null);
});

test('projects round-trip authored edits, locks, rain, labels and view; ordinary 0.4 JSON remains importable',()=>{
  let next=applyEdit(base,{type:'annotation',position:p,name:'Земля канона',description:'Описание',tags:'кампания',locked:true});
  next=brush(next,{channel:'rain',strength:100});next=applyEdit(next,{type:'locks',area:{center:p,radiusKm:500},areaTerrain:true});
  const saved=serializeProject(next,{layer:'resources'}),restored=parseProject(saved);assert.deepEqual(restored.world,next);assert.equal(restored.view.layer,'resources');
  assert.ok(restored.world.geology.elevation instanceof Float64Array);assert.deepEqual(brush(restored.world),brush(next));
  const ordinary=structuredClone(base);delete ordinary.editor;assert.deepEqual(parseProject(serializeWorld(ordinary)).world.validation.errors,[]);
  const corrupt=JSON.parse(saved);corrupt.world.atlas.mineralization.features[0].widthKm=1e9;assert.throws(()=>parseProject(JSON.stringify(corrupt)),/Ширина/);
  corrupt.world.atlas.mineralization.features[0].widthKm=40;corrupt.world.climate.biome[0]=900;assert.throws(()=>parseProject(JSON.stringify(corrupt)),/biome|категории/);
});

test('locked annotations require a separate unlock; names and appearance survive later edits',()=>{
  const note=applyEdit(base,{type:'annotation',position:p,name:'Имя',locked:true}),id=note.editor.annotations[0].id;
  assert.throws(()=>applyEdit(note,{type:'annotation',id,name:'Обход',locked:false}),/закреплена/);
  const unlock=applyEdit(note,{type:'annotation',id,locked:false});assert.equal(unlock.editor.annotations[0].name,'Имя');
  const renamed=applyEdit(unlock,{type:'province',provinceId:base.atlas.provinceId[land],name:'Старый кряж'}),next=brush(renamed);
  assert.equal(next.atlas.provinces[next.atlas.provinceId[land]].name,'Старый кряж');
});
