import assert from 'node:assert/strict';
import test from 'node:test';

class ImageDataMock {
  constructor(width,height) {this.width=width;this.height=height;this.data=new Uint8ClampedArray(width*height*4);}
}
class ContextMock {
  constructor() {this.images=[];this.path=[];this.lastPoint=null;}
  clearRect(){} fillRect(){} beginPath(){this.lastPoint=null;} stroke(){} arc(){} fill(){} strokeText(){} fillText(){}
  putImageData(image){this.image=image;}
  drawImage(source){this.images.push(source);}
  moveTo(x,y){this.lastPoint=[x,y];}
  lineTo(x,y){if(this.lastPoint)this.path.push([this.lastPoint,[x,y]]);this.lastPoint=[x,y];}
}
class CanvasMock {
  constructor() {this.width=400;this.height=200;this.context=new ContextMock();}
  getContext(){return this.context;}
}

globalThis.ImageData=ImageDataMock;
globalThis.document={createElement:name=>{assert.equal(name,'canvas');return new CanvasMock();}};
const {drawMap,color,palettes}=await import('../src/render.js');

function mapWorld(ocean) {
  const width=4,height=2,size=width*height,elevation=Float64Array.from([-100,-100,120,-100,-100,-100,120,-100]);
  return {grid:{width,height,size,latitude:Float64Array.from({length:size},()=>0)},geology:{elevation,plateId:new Uint8Array(size),boundary:new Int8Array(size),plates:[]},water:{lakeDepth:new Float64Array(size),discharge:new Float64Array(size),downstream:new Int32Array(size).fill(-1)},climate:{temperature:Float64Array.from({length:size},()=>10),precipitation:new Float64Array(size),biome:new Uint8Array(size),seasons:Array.from({length:4},()=>({temperature:Float64Array.from({length:size},()=>10),precipitation:new Float64Array(size)})),...(ocean?{ocean}:{}),},atlas:{deposits:[]},summary:{runoffM3s:0}};
}
function raster(canvas) {return canvas.context.images.at(-1).context.image;}
function ocean(enabled=true) {
  const size=8,east=Float64Array.from([1,1,0,1,1,1,0,1]),north=new Float64Array(size),speed=Float64Array.from(east,Math.abs),temperature=Float64Array.from([20,20,0,20,20,20,0,20]);
  return {enabled,modelVersion:'surface-ocean-1',eastMps:east,northMps:north,speedMps:speed,temperatureC:temperature,anomalyC:new Float64Array(size),coastInfluence:new Float64Array(size),airTemperatureCorrectionC:new Float64Array(size),seasons:[{enabled,modelVersion:'surface-ocean-1',eastMps:east,northMps:north,speedMps:speed,temperatureC:Float64Array.from(temperature,value=>value+5),anomalyC:new Float64Array(size),coastInfluence:new Float64Array(size),airTemperatureCorrectionC:new Float64Array(size)}]};
}

test('absent or disabled ocean overlays preserve the terrain raster exactly',()=>{
  const base=new CanvasMock(),absent=new CanvasMock(),disabled=new CanvasMock();
  drawMap(base,mapWorld(),{layers:['elevation']});
  drawMap(absent,mapWorld(),{layers:['elevation','seaTemperature','oceanCurrents']});
  drawMap(disabled,mapWorld(ocean(false)),{layers:['elevation','seaTemperature','oceanCurrents']});
  assert.deepEqual(raster(absent).data,raster(base).data);
  assert.deepEqual(raster(disabled).data,raster(base).data);
  assert.equal(absent.context.path.length,0);
});

test('SST masks land, reads the selected season, and currents use short local arrows',()=>{
  const world=mapWorld(ocean()),annual=new CanvasMock(),seasonal=new CanvasMock(),currents=new CanvasMock();
  drawMap(annual,world,{layers:['seaTemperature'],season:'annual'});
  drawMap(seasonal,world,{layers:['seaTemperature'],season:'0'});
  const annualRaster=raster(annual),seasonalRaster=raster(seasonal);
  assert.equal(annualRaster.data[2*4+3],0,'land is transparent in the SST overlay');
  assert.deepEqual([...annualRaster.data.slice(0,3)],color(20,palettes.temperature));
  assert.deepEqual([...seasonalRaster.data.slice(0,3)],color(25,palettes.temperature));
  drawMap(currents,world,{layers:['oceanCurrents'],season:'annual',mapZoom:8});
  assert.equal(raster(currents).data[2*4+3],0,'land is transparent in the current-speed overlay');
  assert.ok(currents.context.path.length>0,'ocean cells emit direction arrows');
  for(const [from,to] of currents.context.path)assert.ok(Math.hypot(to[0]-from[0],to[1]-from[1])<8,'arrow segments remain small and never span the seam');
});

test('thermohaline overlays mask shallow water and deep arrows remain local',()=>{
  const data=ocean(),fields={salinityPsu:Float64Array.from([35,35,0,35,35,35,0,35]),densityKgM3:Float64Array.from([1026,1026,0,1026,1026,1026,0,1026]),deepTemperatureC:Float64Array.from([4,0,0,4,4,4,0,4]),deepSalinityPsu:Float64Array.from([35,0,0,35,35,35,0,35]),deepDensityKgM3:Float64Array.from([1028,0,0,1028,1028,1028,0,1028]),deepEastMps:Float64Array.from([.2,0,0,.2,.2,.2,0,.2]),deepNorthMps:new Float64Array(8),deepSpeedMps:Float64Array.from([.2,0,0,.2,.2,.2,0,.2]),verticalVelocityMps:Float64Array.from([.00001,0,0,-.00001,.00001,.00001,0,-.00001]),deepMask:Uint8Array.from([1,0,0,1,1,1,0,1])};
  Object.assign(data,{thermodynamicsEnabled:true,...fields});Object.assign(data.seasons[0],{thermodynamicsEnabled:true,...fields});
  const canvas=new CanvasMock();drawMap(canvas,mapWorld(data),{layers:['deepTemperature','deepSalinity','deepDensity','deepCurrents','oceanVerticalExchange'],season:'annual',mapZoom:8});
  assert.equal(raster(canvas).data[4+3],0,'shallow ocean is transparent in deep overlays');
  assert.ok(canvas.context.path.length>0,'deep mask emits arrows');
});

test('every thermohaline raster respects its physical mask and season',()=>{
  const data=ocean(),fields={salinityPsu:Float64Array.from([35,35,0,35,35,35,0,35]),densityKgM3:Float64Array.from([1026,1026,0,1026,1026,1026,0,1026]),deepTemperatureC:Float64Array.from([4,0,0,4,4,4,0,4]),deepSalinityPsu:Float64Array.from([35,0,0,35,35,35,0,35]),deepDensityKgM3:Float64Array.from([1028,0,0,1028,1028,1028,0,1028]),deepEastMps:new Float64Array(8),deepNorthMps:new Float64Array(8),deepSpeedMps:new Float64Array(8),verticalVelocityMps:Float64Array.from([.00001,0,0,-.00001,.00001,.00001,0,-.00001]),deepMask:Uint8Array.from([1,0,0,1,1,1,0,1])};Object.assign(data,{thermodynamicsEnabled:true,...fields});Object.assign(data.seasons[0],{thermodynamicsEnabled:true,...fields,salinityPsu:Float64Array.from(fields.salinityPsu,value=>value+1)});
  const world=mapWorld(data);for(const layer of ['seaSalinity','seaDensity','deepTemperature','deepSalinity','deepDensity','deepCurrents','oceanVerticalExchange']){const canvas=new CanvasMock();drawMap(canvas,world,{layers:[layer],season:'0'});const image=raster(canvas);assert.equal(image.data[2*4+3],0,`${layer} masks land`);if(layer.startsWith('deep')||layer==='oceanVerticalExchange')assert.equal(image.data[4+3],0,`${layer} masks shallow ocean`);}
});
