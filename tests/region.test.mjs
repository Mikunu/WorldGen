import test from 'node:test';
import assert from 'node:assert/strict';
import {generateWorld,serializeWorld} from '../src/core/world.js';
import {refineRegion} from '../src/core/region.js';
import {geologicalColumn} from '../src/core/geological-atlas.js';
const w=generateWorld({seed:'regional-world',width:64,height:32,epochs:8,erosionPasses:0});

test('regional refinement preserves the chosen centre, layers, parent geology and resource identities',()=>{
  const cell=w.atlas.deposits[0]?.cell??1200,region=refineRegion(w,cell),center=(region.size**2-1)/2,column=geologicalColumn(w.atlas,cell);
  assert.equal(region.parentCell[center],cell);assert.ok(Math.abs(region.elevation[center]-w.geology.elevation[cell])<1e-7);
  for(let k=0;k<4;k++){assert.equal(region.layerRock[center*4+k],column[k].rock);assert.ok(Math.abs(region.layerThicknessM[center*4+k]-(column[k].bottomM-column[k].topM))<1e-7);}
  for(let i=0;i<region.parentCell.length;i++) {
    const parent=region.parentCell[i];assert.equal(region.surfaceRock[i],w.atlas.surfaceRock[parent]);assert.equal(region.provinceId[i],w.atlas.provinceId[parent]);
    assert.equal(region.elevation[i]>0,w.geology.elevation[parent]>0);
    let thickness=0;for(let k=0;k<4;k++){assert.ok(region.layerThicknessM[i*4+k]>0);thickness+=region.layerThicknessM[i*4+k];}assert.ok(Math.abs(thickness-12000)<1e-8);
  }
  for(const d of region.deposits){assert.equal(d.mineral,w.atlas.deposits[d.id].mineral);assert.ok(d.x>=0 && d.x<=region.size-1 && d.y>=0 && d.y<=region.size-1);}
  if(w.atlas.deposits.length)assert.ok(region.deposits.some(d=>d.id===w.atlas.deposits[0].id));
});
test('regional generation is deterministic and cannot mutate the saved global world',()=>{
  const before=serializeWorld(w),a=refineRegion(w,1000),b=refineRegion(w,1000);
  assert.deepEqual(a,b);assert.equal(serializeWorld(w),before);
});
test('local sampling handles poles and the longitude seam with north upward and east rightward',()=>{
  for(const cell of [0,63,64*16,64*31]){
    const r=refineRegion(w,cell,{size:15,spanKm:200});assert.ok(r.elevation.every(Number.isFinite));assert.ok(r.latitude.every(x=>x>=-90 && x<=90));assert.ok(r.longitude.every(x=>x>=-180 && x<=180));
  }
  const r=refineRegion(w,64*16+32,{size:15,spanKm:200}),center=7*15+7;
  assert.ok(r.latitude[center-15]>r.latitude[center]);assert.ok(r.longitude[center+1]>r.longitude[center]);
});
test('regional controls reject invalid dimensions and oversized refinement requests',()=>{
  for(const args of [[-1,{}],[0,{size:16}],[0,{size:501}],[0,{spanKm:NaN}],[0,{spanKm:9999}]])assert.throws(()=>refineRegion(w,...args),RangeError);
});
