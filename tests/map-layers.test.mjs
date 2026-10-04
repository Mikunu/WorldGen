import test from 'node:test';
import assert from 'node:assert/strict';
import {MAP_LAYERS,layerOpacity,normalizeLayerOpacity,normalizeLayers,resolveLayers,visibleLayers} from '../src/core/map-layers.js';
import {drawMap} from '../src/render.js';

test('map layers are finite, canonical and preserve a saved selection in canonical order',()=>{
  assert.equal(new Set(MAP_LAYERS.map(layer=>layer.id)).size,MAP_LAYERS.length);
  assert.deepEqual(normalizeLayers(['resources','rocks','flow']),['rocks','resources','flow']);
  assert.deepEqual(resolveLayers({layer:'hazards'}),['hazards']);
  assert.deepEqual(resolveLayers({layers:['potential','elevation']}),['elevation','potential']);
  assert.deepEqual(visibleLayers({layers:[]}),['elevation']);
});

test('map layer validation rejects accidental duplicate or unknown data',()=>{
  assert.throws(()=>normalizeLayers('rocks'),TypeError);
  assert.throws(()=>normalizeLayers(['rocks','rocks']),/повторяется/);
  assert.throws(()=>normalizeLayers(['debug']),/Неизвестный/);
  assert.throws(()=>normalizeLayerOpacity({debug:.5}),/Неизвестный/);
  assert.throws(()=>normalizeLayerOpacity({rocks:1.01}),/от 0 до 1/);
});

test('opacity helpers keep descriptor defaults and accept explicit transparent overlays',()=>{
  const custom=normalizeLayerOpacity({rocks:.25,resources:0});
  assert.equal(layerOpacity(custom,'rocks'),.25);
  assert.equal(layerOpacity(custom,'resources'),0);
  assert.equal(layerOpacity(custom,'elevation'),1);
  assert.ok(layerOpacity({},'flow')>.45 && layerOpacity({},'flow')<.7);
});

function fakeCanvas(width=160,height=80) {
  const calls={images:[],arcs:[]};
  const ctx={globalAlpha:1,filter:'none',imageSmoothingEnabled:true,clearRect(){},fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},strokeRect(){},strokeText(){},fillText(){},
    drawImage(){calls.images.push({alpha:this.globalAlpha});},arc(...args){calls.arcs.push(args);},measureText(text){return {width:text.length*6};}};
  return {width,height,calls,getContext(){return ctx;}};
}
function renderFixture() {
  return {grid:{width:2,height:1,size:2},geology:{elevation:new Float64Array([50,80]),boundary:new Int8Array(2),plateId:new Int32Array(2)},
    climate:{seasons:[{temperature:new Float64Array([12,13]),precipitation:new Float64Array([400,500])}],biome:new Uint8Array(2)},water:{lakeDepth:new Float64Array(2),downstream:new Int32Array([-1,-1]),discharge:new Float64Array(2)},
    atlas:{surfaceRock:new Uint8Array(2),provinceType:new Uint8Array(2),sedimentThicknessM:new Float64Array(2),fertility:new Float64Array(2),hazards:{earthquake:new Float64Array(2)},provinceId:new Int32Array(2),deposits:[]},summary:{runoffM3s:0},editor:{appearance:{labels:false},annotations:[]}};
}
function withFakeRasterApi(run) {
  const imageData=globalThis.ImageData,document=globalThis.document;
  globalThis.ImageData=class {constructor(width,height){this.width=width;this.height=height;this.data=new Uint8ClampedArray(width*height*4);}};
  globalThis.document={createElement(){return {width:0,height:0,getContext(){return {putImageData(){}};}};}};
  try{return run();}finally {
    if(imageData===undefined)delete globalThis.ImageData;else globalThis.ImageData=imageData;
    if(document===undefined)delete globalThis.document;else globalThis.document=document;
  }
}

test('renderer keeps the fallback terrain opaque, honors explicit elevation opacity, and skips missing potential rasters',()=>withFakeRasterApi(()=>{
  const world=renderFixture(),fallback=fakeCanvas();
  drawMap(fallback,world,{layers:[],selected:null,season:0});
  assert.deepEqual(fallback.calls.images,[{alpha:1}]);
  const transparentElevation=fakeCanvas();
  drawMap(transparentElevation,world,{layers:['elevation'],layerOpacity:{elevation:.25},selected:null,season:0});
  assert.deepEqual(transparentElevation.calls.images,[{alpha:.25}]);
  const unavailablePotential=fakeCanvas();
  drawMap(unavailablePotential,world,{layers:['potential'],selected:null,season:0});
  assert.deepEqual(unavailablePotential.calls.images,[{alpha:1}]);
}));

test('renderer scales screen-sized selection markers up to bitmap pixels',()=>withFakeRasterApi(()=>{
  const canvas=fakeCanvas();
  drawMap(canvas,renderFixture(),{layers:[],selected:0,season:0,screenScale:2});
  assert.equal(canvas.calls.arcs.at(-1)[2],14);
}));
