import {makeGrid} from './grid.js';
import {tectonics} from './tectonics.js';
import {climate} from './climate.js';
import {hydrology,erode} from './hydrology.js';
import {geologicalAtlas,validateAtlas} from './geological-atlas.js';
import {rocks,provinceTypes,minerals,hazardTypes} from './geology-catalog.js';
import {depositModels,depositClasses,resourceInventory} from './deposit-models.js';
import {normalizeGenerationRules,validateGenerationWorkload} from './generation-rules.js';
import {effectiveRocks,effectiveDepositModels} from './atlas-rules.js';
import {validateOcean} from './ocean-validation.js';

export const ALGORITHM_VERSION='geological-atlas-0.4.0';
export const defaults={seed:'Ember-001',width:192,height:96,radiusKm:6371,plateCount:14,epochs:24,epochMa:5,oceanFraction:0.7,axialTilt:23.4,erosionPasses:2,resourceDensity:1};
export function validateConfig(input={}) {
  const generationRules=normalizeGenerationRules(input.generationRules);
  const c={...defaults,...generationRules.world,...input,generationRules};c.seed=String(c.seed);
  for(const [key,min,max] of [['width',24,512],['height',12,256],['radiusKm',1000,20000],['plateCount',3,40],['epochs',1,80],['epochMa',0.1,20],['oceanFraction',0.15,0.95],['axialTilt',0,45],['erosionPasses',0,8],['resourceDensity',0,4]]) {
    if(!Number.isFinite(c[key]) || c[key]<min || c[key]>max) throw new Error(`Недопустимый параметр ${key}: ${c[key]}`);
  }
  for(const key of ['width','height','plateCount','epochs','erosionPasses']) if(!Number.isInteger(c[key]))throw new Error(`${key} должен быть целым.`);
  if(c.width%2)throw new Error('Ширина сетки должна быть чётной для перехода через полюса.');
  for(const key of Object.keys(generationRules.world))generationRules.world[key]=c[key];
  validateGenerationWorkload(c);
  return c;
}
export function generateWorld(input={},progress) {
  const config=validateConfig(input),grid=makeGrid(config.width,config.height,config.radiusKm);
  progress?.('Формирование коры и движение плит');
  const geology=tectonics(grid,config,progress);
  progress?.('Сезонный океан, климат и перенос влаги');
  let weather=climate(grid,geology.elevation,config),water;
  if(config.erosionPasses) {
    progress?.('Устойчивость пород и эрозия');
    water=hydrology(grid,geology.elevation,weather.runoffMm);
    const initialAtlas=geologicalAtlas(grid,geology,weather,water,config);
    const rockCatalog=effectiveRocks(config.generationRules);
    geology.erosionResistance=Float64Array.from(initialAtlas.surfaceRock,id=>rockCatalog[id].resistance);
  }
  for(let pass=0;pass<config.erosionPasses;pass++) {
    progress?.(`Сток и эрозия: ${pass+1}/${config.erosionPasses}`);
    water=hydrology(grid,geology.elevation,weather.runoffMm);erode(grid,geology.elevation,water,geology.erosionResistance,config);
  }
  if(config.erosionPasses)weather=climate(grid,geology.elevation,config);
  water=hydrology(grid,geology.elevation,weather.runoffMm);
  const atlas=geologicalAtlas(grid,geology,weather,water,config,progress);
  const world={algorithmVersion:ALGORITHM_VERSION,config,catalogs:{rocks:effectiveRocks(config.generationRules),provinceTypes,minerals,hazardTypes,depositModels:effectiveDepositModels(config.generationRules),depositClasses},grid:{width:grid.width,height:grid.height,size:grid.size,radiusKm:grid.radiusKm,latitude:grid.latitude,areaKm2:grid.areaKm2},geology,climate:weather,water,atlas};
  world.summary=summarize(world);world.validation=validateWorld(world);
  if(world.validation.errors.length)throw new Error(world.validation.errors.join('\n'));
  progress?.('Готово');return world;
}
export function summarize(w) {
  let totalArea=0,landArea=0,sumRain=0,minHeight=Infinity,maxHeight=-Infinity,lakeArea=0;
  for(let i=0;i<w.grid.size;i++) {
    const a=w.grid.areaKm2[i],h=w.geology.elevation[i];totalArea+=a;
    if(h>0) {landArea+=a;sumRain+=w.climate.precipitation[i]*a;if(w.water.lakeDepth[i]>80)lakeArea+=a;}
    minHeight=Math.min(minHeight,h);maxHeight=Math.max(maxHeight,h);
  }
  const major=new Set(w.atlas.deposits.filter(d=>d.sizeClass==='major').map(d=>d.oreBodyId)).size;
  const occurrence=new Set(w.atlas.deposits.filter(d=>d.sizeClass==='occurrence').map(d=>d.oreBodyId)).size;
  return {totalAreaKm2:totalArea,landAreaKm2:landArea,oceanFraction:1-landArea/totalArea,minElevationM:minHeight,maxElevationM:maxHeight,landPrecipitationMm:sumRain/landArea,potentialLakeAreaKm2:lakeArea,runoffM3s:w.water.outputM3s,provinceCount:w.atlas.provinces.length,depositCount:major,occurrenceCount:occurrence,oreBodyCount:major+occurrence,resourceComponentCount:w.atlas.deposits.length,resourceInventory:resourceInventory(w.atlas.deposits)};
}
export function validateWorld(w) {
  const errors=[],n=w.grid.size;
  for(const [label,array] of [['elevation',w.geology.elevation],['temperature',w.climate.temperature],['rain',w.climate.precipitation],['flow',w.water.discharge]]) {
    if(array.length!==n || array.some(x=>!Number.isFinite(x)))errors.push(`Некорректный слой ${label}`);
  }
  const rank=new Int32Array(n);w.water.order.forEach((id,k)=>rank[id]=k);
  for(let i=0;i<n;i++) {
    const j=w.water.downstream[i];
    if(j>=0 && (j>=n || rank[j]>=rank[i] || w.water.spillElevation[j]>w.water.spillElevation[i]+1e-6)) {errors.push(`Ошибка стока ${i}`);break;}
    if(w.geology.elevation[i]>0 && j<0) {errors.push(`Суша без пути стока ${i}`);break;}
    if(w.climate.precipitation[i]<0 || w.water.discharge[i]<0) {errors.push(`Отрицательный водный показатель ${i}`);break;}
  }
  const balanceRelativeError=Math.abs(w.water.inputM3s-w.water.outputM3s)/Math.max(w.water.inputM3s,1);
  if(balanceRelativeError>1e-9)errors.push('Нарушен баланс маршрутизации стока');
  if(w.atlas)errors.push(...validateAtlas(w.atlas,n,w.geology,w.water));
  if(w.climate.ocean) {
    const rules=w.config.generationRules?.ocean;
    errors.push(...validateOcean(w.climate.ocean,w.geology.elevation,rules?{surfaceEnabled:rules.enabled,thermodynamicsEnabled:rules.enabled&&rules.thermodynamicsEnabled,rules}:undefined));
  }
  else if(w.config.generationRules?.ocean!==undefined)errors.push('Отсутствуют сохранённые слои океана');
  return {errors,balanceRelativeError,checkedCells:n};
}
export function serializeWorld(world) {
  return JSON.stringify(world,(_,value)=>ArrayBuffer.isView(value)?Array.from(value):value);
}
export function explainCell(world,i) {
  const h=world.geology.elevation[i],boundary=world.geology.boundary[i],rain=world.climate.precipitation[i],temp=world.climate.temperature[i];
  const text=[h<=0?'Участок ниже выбранного уровня моря.':'Суша: результат состава коры и накопленных тектонических деформаций.'];
  if(boundary===1)text.push('Соседние плиты сходятся; модель добавляет поднятие.');
  if(boundary===-1)text.push('Соседние плиты расходятся; модель формирует растяжение.');
  if(boundary===2)text.push('Граница плит с преобладающим сдвигом в принятом приближении.');
  if(world.config.generationRules?.formulas?.expressions?.['climate.temperature'])text.push('Температура рассчитана по пользовательской формуле.');
  else if(h>1500)text.push(`Высота снижает расчётную температуру примерно на ${(h*(world.config.generationRules?.climate.lapseRate??0.006)).toFixed(1)} °C.`);
  const ocean=world.climate.ocean;
  if(ocean?.enabled&&h<=0)text.push(`Поверхностное течение ${ocean.speedMps[i].toFixed(2)} м/с переносит тепло; температура воды ${ocean.temperatureC[i].toFixed(1)} °C.`);
  else if(ocean?.enabled&&ocean.coastInfluence[i]>0)text.push(`Океанические течения меняют расчётную температуру воздуха на ${ocean.airTemperatureCorrectionC[i].toFixed(2)} °C.`);
  if(h>0)text.push(`Осадки ${Math.round(rain)} мм/год, температура ${temp.toFixed(1)} °C; сток направлен по водосбору к океану.`);
  if(world.water.lakeDepth[i]>80)text.push('Замкнутая впадина: показана потенциальная глубина до перелива; водный баланс озера пока не моделируется.');
  return text.join(' ');
}
