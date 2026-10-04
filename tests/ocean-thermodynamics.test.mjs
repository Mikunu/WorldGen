import test from 'node:test';
import assert from 'node:assert/strict';
import {makeGrid} from '../src/core/grid.js';
import {oceanSeason,THERMODYNAMIC_FIELDS,THERMODYNAMIC_MODEL_VERSION} from '../src/core/ocean.js';
import {potentialDensityKgM3} from '../src/core/ocean-thermodynamics.js';
import {generateWorld} from '../src/core/world.js';

function fixture(width=48,height=width/2,depth=3000) {
  const grid=makeGrid(width,height,6371),elevation=new Float64Array(grid.size).fill(-depth),windEast=new Float64Array(grid.size),windNorth=new Float64Array(grid.size),baselineTemperature=new Float64Array(grid.size);
  for(let i=0;i<grid.size;i++) {const latitude=grid.latitude[i];windEast[i]=Math.abs(latitude)<Math.PI/3?-1:1;windNorth[i]=-.15*Math.sign(latitude);baselineTemperature[i]=24-26*Math.abs(latitude)/(Math.PI/2);}
  return {grid,elevation,windEast,windNorth,baselineTemperature};
}

const config=(ocean={},expressions={})=>({seed:'thermodynamic-test',generationRules:{ocean,formulas:{version:1,expressions}}});
const run=(f,ocean={},freshwater=null,expressions={})=>oceanSeason(f.grid,f.elevation,f.windEast,f.windNorth,f.baselineTemperature,config(ocean,expressions),0,freshwater);

test('linear potential density exposes the documented thermal and haline coefficients',()=>{
  assert.equal(potentialDensityKgM3(10,35),1027);
  assert.ok(Math.abs(potentialDensityKgM3(9,35)-1027-1027*2e-4)<1e-12);
  assert.ok(Math.abs(potentialDensityKgM3(10,36)-1027-1027*7.6e-4)<1e-12);
  assert.ok(potentialDensityKgM3(5,35)>potentialDensityKgM3(15,35));
  assert.ok(potentialDensityKgM3(10,36)>potentialDensityKgM3(10,34));
});

test('disabled thermodynamics retains canonical metadata and zero typed fields',()=>{
  const f=fixture(),ocean=run(f,{thermodynamicsEnabled:false});
  assert.equal(ocean.thermodynamicsEnabled,false);assert.equal(ocean.thermodynamicsModelVersion,THERMODYNAMIC_MODEL_VERSION);
  for(const field of THERMODYNAMIC_FIELDS) {
    assert.equal(ocean[field].length,f.grid.size);assert.ok(ocean[field].every(value=>value===0),field);
    assert.equal(field==='deepMask'?ocean[field] instanceof Uint8Array:ocean[field] instanceof Float64Array,true);
  }
});

test('bathymetry gates the deep layer and actual freshwater forcing changes surface salinity',()=>{
  const f=fixture(),freshwater=new Float64Array(f.grid.size);
  for(let i=0;i<f.grid.size;i++) {const x=i%f.grid.width,y=Math.floor(i/f.grid.width);freshwater[i]=x<f.grid.width/2?500:-500;if(x<4)f.elevation[i]=300;else if(y===10)f.elevation[i]=-400;}
  const snapshot=Float64Array.from(freshwater),ocean=run(f,{},freshwater);let wet=0,dry=0,wetN=0,dryN=0;
  assert.deepEqual(freshwater,snapshot);assert.equal(ocean.thermodynamicsEnabled,true);
  for(let i=0;i<f.grid.size;i++) {
    const expected=f.elevation[i]<=-700?1:0;assert.equal(ocean.deepMask[i],expected);
    if(f.elevation[i]>0)for(const field of THERMODYNAMIC_FIELDS)assert.equal(ocean[field][i],0,`${field} land ${i}`);
    if(!expected)for(const field of ['deepTemperatureC','deepSalinityPsu','deepDensityKgM3','deepEastMps','deepNorthMps','deepSpeedMps','verticalVelocityMps'])assert.equal(ocean[field][i],0,`${field} shallow ${i}`);
    if(f.elevation[i]<=0){assert.ok(ocean.salinityPsu[i]>=0&&ocean.salinityPsu[i]<=50);assert.ok(ocean.densityKgM3[i]>=950&&ocean.densityKgM3[i]<=1100);if(i%f.grid.width<f.grid.width/2){wet+=ocean.salinityPsu[i];wetN++;}else{dry+=ocean.salinityPsu[i];dryN++;}}
  }
  assert.ok(wet/wetN<dry/dryN);
  assert.ok(Math.abs(ocean.thermodynamicDiagnostics.heatMeanAfterC-ocean.thermodynamicDiagnostics.heatMeanBeforeC)<1e-10);
  assert.ok(Math.abs(ocean.thermodynamicDiagnostics.salinityMeanAfterPsu-ocean.thermodynamicDiagnostics.salinityMeanBeforePsu)<1e-10);
});

test('wind-driven surface currents advect salinity without changing the salt budget',()=>{
  const moving=fixture(),calm=fixture(),freshwater=new Float64Array(moving.grid.size);calm.windEast.fill(0);calm.windNorth.fill(0);
  for(let i=0;i<moving.grid.size;i++)freshwater[i]=(i%moving.grid.width)<moving.grid.width/2?600:-600;
  const settings={overturningStrengthMps:0,deepLateralMixing:0,thermodynamicSteps:8},advected=run(moving,settings,freshwater),still=run(calm,settings,freshwater);
  const difference=advected.salinityPsu.reduce((sum,value,i)=>sum+Math.abs(value-still.salinityPsu[i]),0);assert.ok(difference>.01);
  assert.ok(Math.abs(advected.thermodynamicDiagnostics.salinityMeanAfterPsu-advected.thermodynamicDiagnostics.salinityMeanBeforePsu)<1e-10);
});

test('balanced overturning preserves uniform heat and salt in a closed basin',()=>{
  const f=fixture(96,48);f.baselineTemperature.fill(12);f.windEast.fill(0);f.windNorth.fill(0);
  const freshwater=new Float64Array(f.grid.size),expressions={'ocean.density':'base + latitudeDeg / 90'};
  const ocean=run(f,{freshwaterSalinityRangePsu:0,deepTemperatureOffsetC:0,deepSalinityOffsetPsu:0,deepLateralMixing:0,thermodynamicSteps:24,surfaceFeedback:1},freshwater,expressions);
  assert.ok(ocean.verticalVelocityMps.some(value=>value>0));assert.ok(ocean.verticalVelocityMps.some(value=>value<0));
  assert.ok(ocean.temperatureC.every(value=>Math.abs(value-12)<1e-10));assert.ok(ocean.deepTemperatureC.every(value=>Math.abs(value-12)<1e-10));
  assert.ok(ocean.salinityPsu.every(value=>Math.abs(value-35)<1e-10));assert.ok(ocean.deepSalinityPsu.every(value=>Math.abs(value-35)<1e-10));
  assert.ok(ocean.thermodynamicDiagnostics.maximumBasinVerticalImbalanceM3s<1e-5);
  assert.ok(Math.abs(ocean.thermodynamicDiagnostics.heatMeanAfterC-12)<1e-10);assert.ok(Math.abs(ocean.thermodynamicDiagnostics.salinityMeanAfterPsu-35)<1e-10);
});

test('temperature alone drives cold sinking, warm upwelling and a conservative SST feedback',()=>{
  const f=fixture(96,48);f.windEast.fill(0);f.windNorth.fill(0);const freshwater=new Float64Array(f.grid.size);
  const base={freshwaterSalinityRangePsu:0,deepSalinityOffsetPsu:0,deepLateralMixing:0,thermodynamicSteps:20,overturningStrengthMps:1e-5,densityContrastScaleKgM3:2};
  const uncoupled=run(f,{...base,surfaceFeedback:0},freshwater),coupled=run(f,{...base,surfaceFeedback:1},freshwater);
  let coldW=0,coldN=0,warmW=0,warmN=0,difference=0;
  for(let i=0;i<f.grid.size;i++){if(f.baselineTemperature[i]<5){coldW+=coupled.verticalVelocityMps[i];coldN++;}if(f.baselineTemperature[i]>18){warmW+=coupled.verticalVelocityMps[i];warmN++;}difference+=Math.abs(coupled.temperatureC[i]-uncoupled.temperatureC[i]);}
  assert.ok(coldW/coldN<0,'cold surface water sinks');assert.ok(warmW/warmN>0,'warm surface water upwells');assert.ok(coupled.deepSpeedMps.some(value=>value>0),'vertical sources drive a horizontal deep return');assert.ok(difference>.01,'deep heat exchange feeds back into SST');
  assert.ok(Math.abs(coupled.thermodynamicDiagnostics.heatMeanAfterC-coupled.thermodynamicDiagnostics.heatMeanBeforeC)<1e-10);
});

test('overturning strength changes circulation and heat feedback below the stability limiter',()=>{
  const f=fixture(48,24);f.windEast.fill(0);f.windNorth.fill(0);const freshwater=new Float64Array(f.grid.size),base={freshwaterSalinityRangePsu:0,deepSalinityOffsetPsu:0,deepLateralMixing:0,thermodynamicSteps:6,densityContrastScaleKgM3:5,surfaceFeedback:1,lateralMixing:0,baselineRelaxation:0,heatSteps:1};
  const weak=run(f,{...base,overturningStrengthMps:2e-6},freshwater),strong=run(f,{...base,overturningStrengthMps:8e-6},freshwater);
  const motion=ocean=>ocean.verticalVelocityMps.reduce((sum,value)=>sum+Math.abs(value),0),feedback=ocean=>ocean.temperatureC.reduce((sum,value,i)=>sum+Math.abs(value-f.baselineTemperature[i]),0);
  assert.ok(motion(strong)>motion(weak)*3.5);assert.ok(feedback(strong)>feedback(weak)*2);
});

test('each disconnected deep basin balances sinking and upwelling independently',()=>{
  const f=fixture(48,24),freshwater=new Float64Array(f.grid.size);
  for(let y=0;y<f.grid.height;y++)for(const x of [0,f.grid.width/2])f.elevation[f.grid.index(x,y)]=500;
  for(let i=0;i<f.grid.size;i++)freshwater[i]=(i%f.grid.width)<f.grid.width/2?250:-250;
  const ocean=run(f,{},freshwater);assert.equal(ocean.thermodynamicDiagnostics.deepBasinCount,2);assert.ok(ocean.thermodynamicDiagnostics.maximumBasinVerticalImbalanceM3s<1e-5);
  assert.ok(ocean.deepSpeedMps.every(value=>value>=0&&value<=.2+1e-12));assert.ok(ocean.verticalVelocityMps.every(value=>Math.abs(value)<=1e-4+1e-15));
});

test('all thermodynamic hooks receive the declared numeric context without breaking continuity',()=>{
  const f=fixture(24,12),freshwater=new Float64Array(f.grid.size).fill(20);
  const names=['windEast','windNorth','baselineTemperatureC','seaTemperatureC','waterDepthM','freshwaterFluxMm','salinityPsu','densityKgM3','deepTemperatureC','deepSalinityPsu','deepDensityKgM3','deepEastMps','deepNorthMps','deepSpeedMps','verticalVelocityMps','deepMask','densityContrastKgM3'];
  const expression=`base + 0 * (${names.join(' + ')})`,expressions=Object.fromEntries(['salinity','density','deepTemperature','deepSalinity','deepDensity','deepEast','deepNorth','vertical'].map(name=>[`ocean.${name}`,expression]));
  const first=run(f,{thermodynamicSteps:2},freshwater,expressions),again=run(f,{thermodynamicSteps:2},freshwater,expressions);assert.deepEqual(first,again);
  assert.ok(first.thermodynamicDiagnostics.maximumBasinVerticalImbalanceM3s<1e-5);assert.ok(first.deepSpeedMps.every(value=>value<=.2+1e-12));
});

test('default Ember-001 has material deep circulation and thermodynamic SST feedback',()=>{
  const input={seed:'Ember-001',width:192,height:96,resourceDensity:0,epochs:24};
  const active=generateWorld(input),disabled=generateWorld({...input,generationRules:{ocean:{thermodynamicsEnabled:false}}});
  const percentile=(values,fraction)=>{const sorted=values.sort((a,b)=>a-b);return sorted[Math.floor((sorted.length-1)*fraction)];};
  for(let season=0;season<4;season++) {
    const ocean=active.climate.ocean.seasons[season],without=disabled.climate.ocean.seasons[season],speed=[],verticalPerDay=[],sstDifference=[];
    for(let i=0;i<ocean.deepMask.length;i++)if(ocean.deepMask[i]) {
      speed.push(Math.abs(ocean.deepSpeedMps[i]));verticalPerDay.push(Math.abs(ocean.verticalVelocityMps[i])*86400);sstDifference.push(Math.abs(ocean.temperatureC[i]-without.temperatureC[i]));
    }
    assert.ok(speed.length>10000);
    assert.ok(percentile(speed,.9)>5e-6,`season ${season} deep p90`);
    assert.ok(percentile(verticalPerDay,.9)>1e-4,`season ${season} vertical p90`);
    assert.ok(percentile(sstDifference,.9)>1e-4,`season ${season} SST p90`);
    assert.ok(ocean.deepSpeedMps.every(value=>Number.isFinite(value)&&value<=.2+1e-12));
    assert.ok(ocean.verticalVelocityMps.every(value=>Number.isFinite(value)&&Math.abs(value)<=1e-4+1e-15));
    assert.ok(Math.abs(ocean.thermodynamicDiagnostics.heatMeanAfterC-ocean.thermodynamicDiagnostics.heatMeanBeforeC)<1e-10);
    assert.ok(Math.abs(ocean.thermodynamicDiagnostics.salinityMeanAfterPsu-ocean.thermodynamicDiagnostics.salinityMeanBeforePsu)<1e-10);
    assert.ok(ocean.thermodynamicDiagnostics.rawReconstructedMaximumMps<100,'rank-deficient reconstruction remains bounded');
    assert.ok(ocean.thermodynamicDiagnostics.rawEdgeMaximumMps<100,'projected face flow remains bounded');
  }
});
