import {generateWorld} from './core/world.js';
import {refineRegion} from './core/region.js';
import {potentialRaster} from './core/potential-raster.js';
import {clamp,makeGrid} from './core/grid.js';
import {physicalRulesFor} from './core/physical-rules.js';
import {FORMULA_DESCRIPTORS,makeFormulaEvaluator} from './core/generation-formulas.js';

const descriptorById=new Map(FORMULA_DESCRIPTORS.map(item=>[item.id,item]));
function withoutFormula(config,id) {const next=structuredClone(config),expressions=next.generationRules?.formulas?.expressions;if(expressions)delete expressions[id];return next;}
function bodies(world) {const byId=new Map();for(const deposit of world.atlas.deposits)if(!byId.has(deposit.oreBodyId))byId.set(deposit.oreBodyId,deposit);return [...byId.values()];}
function evaporationValues(world) {
  const rules=physicalRulesFor(world.config,'climate'),formulas=makeFormulaEvaluator(world.config,world.config.seed),grid=makeGrid(world.grid.width,world.grid.height,world.grid.radiusKm),{geology,climate}=world;
  return Float64Array.from({length:grid.size},(_,index)=>{
    if(geology.elevation[index]<=0)return NaN;
    const base=clamp(rules.evaporationBase+climate.temperature[index]*rules.evaporationTemperatureFactor,rules.evaporationMin,rules.evaporationMax);
    if(!formulas.has('climate.evaporation'))return base;
    const point=grid.point(index);
    return formulas.evaluate('climate.evaporation',{latitudeDeg:grid.latitude[index]*180/Math.PI,longitudeDeg:Math.atan2(point[2],point[0])*180/Math.PI,elevationM:geology.elevation[index],isOcean:0,season:-1,x:point[0],y:point[1],z:point[2],precipitationMm:climate.precipitation[index],temperatureC:climate.temperature[index]},base,'Годовой климат');
  });
}
function oceanValues(world,field,label,unit,coastal=false,deep=false) {
  const ocean=world.climate.ocean;
  if(!ocean?.enabled||!ocean[field]||((deep||['salinityPsu','densityKgM3'].includes(field))&&!ocean.thermodynamicsEnabled))return {values:[],label,unit};
  return {values:Float64Array.from(ocean[field],(value,index)=>coastal?(ocean.coastInfluence[index]>0?value:NaN):(deep?(ocean.deepMask[index]?value:NaN):(world.geology.elevation[index]<=0?value:NaN))),label,unit};
}
function valuesFor(world,id) {
  const atlas=world.atlas;
  if(id==='climate.temperature')return {values:world.climate.temperature,label:'Температура',unit:'°C'};
  if(id==='climate.condensation')return {values:world.climate.precipitation,label:'Годовые осадки после конденсации',unit:'мм/год'};
  if(id==='climate.evaporation')return {values:evaporationValues(world),label:'Потенциальное испарение суши',unit:'мм/год'};
  if(id==='climate.runoff')return {values:world.climate.runoffMm,label:'Годовой поверхностный сток',unit:'мм/год'};
  if(id==='climate.biome')return {values:world.climate.biome,label:'ID итогового биома',unit:'ID'};
  if(id==='ocean.east')return oceanValues(world,'eastMps','Зональная скорость течения','м/с');
  if(id==='ocean.north')return oceanValues(world,'northMps','Меридиональная скорость течения','м/с');
  if(id==='ocean.temperature')return oceanValues(world,'temperatureC','Температура поверхности океана','°C');
  if(id==='ocean.coupling')return oceanValues(world,'airTemperatureCorrectionC','Поправка температуры воздуха у побережья','°C',true);
  if(id==='ocean.salinity')return oceanValues(world,'salinityPsu','Солёность поверхности','PSU');
  if(id==='ocean.density')return oceanValues(world,'densityKgM3','Потенциальная плотность поверхности','кг/м³');
  if(id==='ocean.deepTemperature')return oceanValues(world,'deepTemperatureC','Глубинная температура','°C',false,true);
  if(id==='ocean.deepSalinity')return oceanValues(world,'deepSalinityPsu','Глубинная солёность','PSU',false,true);
  if(id==='ocean.deepDensity')return oceanValues(world,'deepDensityKgM3','Потенциальная плотность глубинного слоя','кг/м³',false,true);
  if(id==='ocean.deepEast')return oceanValues(world,'deepEastMps','Зональная скорость глубинного течения','м/с',false,true);
  if(id==='ocean.deepNorth')return oceanValues(world,'deepNorthMps','Меридиональная скорость глубинного течения','м/с',false,true);
  if(id==='ocean.vertical')return oceanValues(world,'verticalVelocityMps','Вертикальная скорость: подъём (+), погружение (−)','м/с',false,true);
  if(id==='geology.sediments')return {values:atlas.sedimentThicknessM,label:'Мощность осадочной толщи',unit:'м'};
  if(id==='soils.depth')return {values:atlas.soilDepthM,label:'Мощность почвы',unit:'м'};
  if(id==='soils.fertility')return {values:atlas.fertility,label:'Плодородие',unit:'индекс'};
  if(id==='soils.retention')return {values:atlas.waterRetention,label:'Удержание влаги',unit:'индекс'};
  if(id==='soils.aquifer')return {values:atlas.aquiferPotential,label:'Водоносный потенциал',unit:'индекс'};
  if(id.startsWith('hazards.'))return {values:atlas.hazards[id.slice(8)],label:descriptorById.get(id).label,unit:'индекс'};
  if(id==='geology.environment')return {values:Object.values(atlas.environments).flatMap(value=>Array.from(value)),label:'Пригодность всех рудообразующих сред',unit:'индекс'};
  if(id==='mineralization.formation')return {values:atlas.deposits.map(item=>item.formationScore),label:'Интенсивность рудообразования у созданных залежей',unit:'индекс'};
  if(id==='resources.intensity')return {values:[bodies(world).length],label:'Число созданных рудных тел',unit:'число'};
  if(id==='resources.mass')return {values:bodies(world).map(item=>item.oreMassMt),label:'Масса рудного тела',unit:'млн т'};
  if(id==='resources.depth')return {values:bodies(world).map(item=>item.depthM),label:'Глубина рудного тела',unit:'м'};
  if(id==='resources.grade')return {values:atlas.deposits.map(item=>item.grade),label:'Содержание компонента (единицы зависят от минерала)',unit:'единицы ресурса'};
  if(id==='resources.access')return {values:atlas.deposits.map(item=>item.accessDifficulty),label:'Сложность доступа',unit:'индекс'};
  return {values:world.geology.elevation,label:id==='erosion.incision'?'Итоговая высота после эрозии':'Итоговая высота',unit:'м'};
}
function statistics(values) {let min=Infinity,max=-Infinity,sum=0,count=0;for(const value of values)if(Number.isFinite(value)){min=Math.min(min,value);max=Math.max(max,value);sum+=value;count++;}return count?{min,max,mean:sum/count}:{min:null,max:null,mean:null};}
self.onmessage=({data})=>{try {const original=generateWorld(withoutFormula(data.config,data.formulaId)),custom=generateWorld(data.config),originalField=valuesFor(original,data.formulaId),customField=valuesFor(custom,data.formulaId),response={type:'preview',original,custom,originalStats:statistics(originalField.values),customStats:statistics(customField.values),fieldLabel:customField.label,unit:customField.unit};if(data.formulaId==='region.elevation'){const cell=original.geology.elevation.findIndex(value=>value>0);if(cell<0)throw new Error('Для регионального предпросмотра нужна хотя бы одна ячейка суши');response.originalRegion=refineRegion(original,cell);response.customRegion=refineRegion(custom,cell);response.originalStats=statistics(response.originalRegion.elevation);response.customStats=statistics(response.customRegion.elevation);response.fieldLabel='Региональная высота';response.unit='м';}if(descriptorById.get(data.formulaId)?.mapLayer==='potential'){response.originalPotential=potentialRaster(original);response.customPotential=potentialRaster(custom);}self.postMessage(response);}catch(error){self.postMessage({type:'error',message:error.message??String(error)});}};
