import {physicalRuleSchema} from './physical-rules.js';
import {atlasRuleSchema} from './atlas-rules.js';
import {normalizeFormulas,makeFormulaEvaluator,MAX_FORMULA_OPERATIONS} from './generation-formulas.js';
import {oceanRuleSchema} from './ocean.js';

export const RULES_FORMAT='worldgen-generation-rules';
export const RULES_VERSION=2;
export const MAX_RULES_BYTES=100000;
const number=(value,min,max,label,integer=false)=>({default:value,min,max,label,integer});
export const generationRuleSchema={
  world:{radiusKm:number(6371,1000,20000,'Радиус планеты, км'),plateCount:number(14,3,40,'Количество плит',true),epochs:number(24,1,80,'Количество эпох',true),epochMa:number(5,.1,20,'Длительность эпохи, млн лет'),oceanFraction:number(.7,.15,.95,'Доля океана'),axialTilt:number(23.4,0,45,'Наклон оси, °'),erosionPasses:number(2,0,8,'Проходы эрозии',true),resourceDensity:number(1,0,4,'Плотность ресурсов, ×')},
  ...physicalRuleSchema,ocean:oceanRuleSchema,...atlasRuleSchema
};
export const ruleSectionNames={world:'Планета',tectonics:'Тектоника и рельеф',climate:'Климат и сток',ocean:'Океан: поверхность и глубина',biomes:'Биомы',erosion:'Эрозия',geology:'Геология и подземные слои',soils:'Почвы и подземные воды',hazards:'Природные опасности',mineralization:'Рудные пояса и потенциал',resources:'Размещение ресурсов',rocks:'Свойства пород',depositModels:'Семейства месторождений',region:'Региональные детали'};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&(Object.getPrototypeOf(value)===Object.prototype||Object.getPrototypeOf(value)===null);
function normalize(schema,input,path) {
  if(Object.hasOwn(schema,'default')) {
    const value=input===undefined?schema.default:input;
    if(typeof schema.default==='boolean') {if(typeof value!=='boolean')throw new Error(`${path}: ожидается true или false`);}
    else if(!Number.isFinite(value)||value<schema.min||value>schema.max||(schema.integer&&!Number.isInteger(value)))throw new Error(`${path}: допустимо ${schema.min}–${schema.max}${schema.integer?', целое число':''}`);
    return value;
  }
  if(input!==undefined&&!object(input))throw new Error(`${path||'Правила'}: ожидается объект`);
  for(const key of Object.keys(input??{}))if(!Object.hasOwn(schema,key))throw new Error(`Неизвестное правило: ${path?path+'.':''}${key}`);
  return Object.fromEntries(Object.entries(schema).map(([key,entry])=>[key,normalize(entry,input?.[key],path?`${path}.${key}`:key)]));
}
export function normalizeGenerationRules(input) {
  if(input!==undefined&&!object(input))throw new Error('Правила: ожидается объект');
  const numeric=input===undefined?undefined:Object.fromEntries(Object.entries(input).filter(([key])=>key!=='formulas'));
  const r=normalize(generationRuleSchema,numeric,'');r.formulas=normalizeFormulas(input?.formulas);
  if(r.climate.moistureZonalShare+r.climate.moistureMeridionalShare>1+1e-10)throw new Error('climate: суммарная доля переноса влаги не может превышать 1');
  const ordered=(section,a,b)=>{if(r[section][a]>r[section][b])throw new Error(`${section}.${a} не может превышать ${section}.${b}`);};
  for(const [s,a,b] of [['tectonics','upliftMin','upliftMax'],['climate','oceanMoistureMin','oceanMoistureMax'],['climate','condensationMin','condensationMax'],['climate','evaporationMin','evaporationMax'],['biomes','iceTemperature','tundraTemperature'],['biomes','desertPrecipitation','steppePrecipitation']])if(a in r[s]&&b in r[s])ordered(s,a,b);
  ordered('soils','minDepthM','maxDepthM');
  if(r.ocean.minSstC>=r.ocean.maxSstC)throw new Error('ocean.minSstC должен быть меньше ocean.maxSstC');
  if(r.ocean.deepMinimumDepthM<=r.ocean.surfaceLayerDepthM)throw new Error('ocean.deepMinimumDepthM должен быть больше ocean.surfaceLayerDepthM');
  const placer=r.resources.placer;
  for(const [a,b] of [['massMin','massMax'],['depthMin','depthMax'],['gradeMin','gradeMax'],['minTravelKm','maxTravelKm']])if(placer[a]>placer[b])throw new Error(`resources.placer.${a} не может превышать ${b}`);
  for(const kind of ['structural','intrusion','basin'])if(r.mineralization[kind+'WidthMinKm']+r.mineralization[kind+'WidthRangeKm']>1000)throw new Error(`mineralization: ширина ${kind} не может превышать 1000 км`);
  if(r.mineralization.basinAspectMin+r.mineralization.basinAspectRange>10)throw new Error('mineralization: вытянутость бассейна не может превышать 10');
  const physicalBody=(m,path)=>{if(m.depthMin*r.resources.depthScale<.01||m.depthMax*r.resources.depthScale>12000)throw new Error(`${path}: глубина с учётом масштаба должна быть 0.01–12000 м`);if(m.massMax*r.resources.massScale>1e6||m.massMin*r.resources.massScale*r.resources.occurrenceMassFactor<1e-9)throw new Error(`${path}: масса с учётом масштаба выходит за допустимый диапазон`);};
  if(placer.enabled){physicalBody(placer,'resources.placer');if(placer.gradeMax*r.resources.gradeScale>1e6)throw new Error('resources.placer: содержание с учётом масштаба превышает массу тела');}
  for(const [id,m] of Object.entries(r.depositModels??{})) {
    for(const [a,b] of [['massMin','massMax'],['depthMin','depthMax']])if(m[a]>m[b])throw new Error(`depositModels.${id}.${a} не может превышать ${b}`);
    let fraction=0;
    for(const [mineral,g] of Object.entries(m.grades??{})) {
      if(g.gradeMin>g.gradeMax)throw new Error(`depositModels.${id}.grades.${mineral}: минимум превышает максимум`);
      // The grade schema's upper bound is the component's mass denominator.
      fraction+=g.gradeMax/generationRuleSchema.depositModels[id].grades[mineral].gradeMax.max;
    }
    if(fraction>1+1e-10||(m.enabled&&fraction*r.resources.gradeScale>1+1e-10))throw new Error(`depositModels.${id}: суммарное содержание компонентов с учётом масштаба превышает массу тела`);
    if(m.enabled)physicalBody(m,`depositModels.${id}`);
  }
  return r;
}
export function validateGenerationWorkload(config) {
  const r=config.generationRules,area=4*Math.PI*config.radiusKm**2;
  const formulas=makeFormulaEvaluator(config,config.seed);let candidates=0;
  for(const [id,m] of Object.entries(r.depositModels).filter(([,m])=>m.enabled))for(const isOccurrence of [0,1]) {
    const intensityScale=isOccurrence?r.resources.occurrenceIntensityScale:r.resources.majorIntensityScale,classFactor=isOccurrence?r.resources.occurrenceFactor:r.resources.majorFactor,base=area/intensityScale*config.resourceDensity*m.frequency*classFactor;
    if(config.resourceDensity>0&&classFactor>0&&m.frequency>0)candidates+=formulas.evaluate('resources.intensity',{areaKm2:area,density:config.resourceDensity,frequency:m.frequency,intensityScale,classFactor,isOccurrence,latitudeDeg:0,longitudeDeg:0,elevationM:0,isOcean:0,season:-1,x:0,y:0,z:0},base,`${id}:${isOccurrence?'occurrence':'major'}`);
  }
  if(candidates>2000000)throw new Error('Слишком плотная генерация ресурсов: увеличьте площадь на месторождение или уменьшите плотность / частоту');
  const stepScale=192/config.width*config.radiusKm/6371,iterations=Math.max(16,Math.ceil(r.climate.transportDistance/stepScale/2)*2);
  const thermo=r.ocean.enabled&&r.ocean.thermodynamicsEnabled,atmospherePasses=thermo?2:1;
  if(iterations*config.width*config.height*4*(config.erosionPasses?2:1)*atmospherePasses>(thermo?480000000:240000000))throw new Error('Слишком большой расчёт климата: уменьшите сетку или дальность переноса влаги');
  const cells=config.width*config.height,climatePasses=config.erosionPasses?2:1;
  const oceanWork=r.ocean.enabled?cells*4*climatePasses*(r.ocean.projectionIterations+r.ocean.heatSteps+r.ocean.coastReachCells+12+(thermo?2*r.ocean.projectionIterations+4*r.ocean.thermodynamicSteps+32:0)):0;
  if(oceanWork>(thermo?320000000:160000000))throw new Error('Слишком большой расчёт океана: уменьшите сетку или число итераций течений / переноса тепла');
  const components=Math.max(1,...Object.values(r.depositModels).filter(m=>m.enabled).map(m=>Object.keys(m.grades).length));
  function evaluations(id) {
    if(id==='climate.condensation')return cells*iterations*4*climatePasses*atmospherePasses;
    if(id==='climate.temperature')return cells*4*climatePasses;
    if(id==='climate.evaporation'||id==='climate.runoff')return cells*climatePasses*(thermo?5:1);
    if(id.startsWith('climate.'))return cells*climatePasses;
    if(['ocean.salinity','ocean.density','ocean.deepTemperature','ocean.deepSalinity','ocean.deepDensity','ocean.deepEast','ocean.deepNorth','ocean.vertical'].includes(id))return thermo?cells*4*climatePasses*(['ocean.density','ocean.deepDensity'].includes(id)?2:1):0;
    if(id.startsWith('ocean.'))return r.ocean.enabled?cells*4*climatePasses:0;
    if(id==='geology.environment')return cells*17*climatePasses;
    // Formation is sampled when placing bodies and when validating their components.
    if(id==='mineralization.formation')return candidates*(climatePasses+components);
    if(id==='resources.intensity')return Object.values(r.depositModels).filter(m=>m.enabled).length*2*climatePasses;
    if(id==='resources.grade'||id==='resources.access')return candidates*(components+1)*climatePasses;
    if(id.startsWith('resources.'))return candidates*2*climatePasses;
    if(id==='region.elevation')return 0;
    if(id==='tectonics.elevation')return cells;
    if(id==='erosion.incision')return cells*config.erosionPasses;
    return cells*climatePasses;
  }
  const cost=Object.keys(r.formulas.expressions).reduce((sum,id)=>sum+evaluations(id)*formulas.cost(id),0);
  if(cost>MAX_FORMULA_OPERATIONS)throw new Error('Слишком большой расчёт формул: упростите выражения или уменьшите разрешение');
}
export const defaultGenerationRules=normalizeGenerationRules();
export function serializeGenerationRules(rules) {return JSON.stringify({format:RULES_FORMAT,version:RULES_VERSION,rules:normalizeGenerationRules(rules)},null,2);}
export function parseGenerationRules(text) {
  if(typeof text!=='string'||new TextEncoder().encode(text).length>MAX_RULES_BYTES)throw new Error('Файл правил превышает 100 КБ');
  let data;try{data=JSON.parse(text);}catch{throw new Error('Не удалось прочитать JSON правил');}
  if(!object(data))throw new Error('Файл правил должен содержать объект JSON');
  if(Object.hasOwn(data,'format')) {
    if(data.format!==RULES_FORMAT||![1,RULES_VERSION].includes(data.version))throw new Error('Неподдерживаемый формат или версия правил генерации');
    if(Object.keys(data).some(k=>!['format','version','rules'].includes(k))||!Object.hasOwn(data,'rules'))throw new Error('Повреждён документ правил генерации');
    return normalizeGenerationRules(data.rules);
  }
  return normalizeGenerationRules(data);
}
export function ruleFields(schema=generationRuleSchema,path=[]) {
  return Object.entries(schema).flatMap(([key,entry])=>Object.hasOwn(entry,'default')?[{path:[...path,key],...entry}]:ruleFields(entry,[...path,key]));
}
