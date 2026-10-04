import {compileExpression,EXPRESSION_VERSION} from './expression-engine.js';
import {hashSeed,noise3} from './random.js';

export const FORMULAS_VERSION=EXPRESSION_VERSION;
export const MAX_FORMULA_OPERATIONS=300000000;
export const FORMULA_ENVIRONMENTS=['hydrothermal','felsic','iron','coal','evaporite','carbonateBasin','maficIntrusion','ultramafic','ultramaficWeathering','marineBasin','weatheredPlatform','sandstoneRedox','pegmatite','alkalineIntrusion','epithermal','orogenicFluid','metamorphicCarbon'];
const variables={
  base:['Стандартный результат выбранного расчёта','единицы результата'],latitudeDeg:['Широта','°'],longitudeDeg:['Долгота','°'],elevationM:['Высота над уровнем моря','м'],isOcean:['Океан: 1, суша: 0','0 / 1'],season:['Сезон: зима 0, весна 1, лето 2, осень 3; год −1','индекс'],x:['Координата X на единичной сфере','−1…1'],y:['Координата Y на единичной сфере','−1…1'],z:['Координата Z на единичной сфере','−1…1'],
  crust:['Доля континентального материала','0…1'],upliftM:['Тектоническое поднятие','м'],noise:['Стандартный шум детали','0…1'],ageMa:['Возраст пород','млн лет'],sunlight:['Сезонное освещение','индекс'],annualTemperature:['Базовая годовая температура','°C'],seasonEffect:['Сезонная поправка','°C'],temperatureC:['Температура','°C'],precipitationMm:['Осадки','мм/год'],evaporationMm:['Испарение','мм/год'],availableMoisture:['Доступная влага','индекс'],stepScale:['Масштаб шага переноса','множитель'],baseFraction:['Исходная доля конденсации','0…1'],dischargeM3s:['Расход воды','м³/с'],slope:['Уклон','м/м'],resistance:['Устойчивость породы','0…1'],baseElevationM:['Интерполированная глобальная высота','м'],detailM:['Региональная деталь высоты','м'],
  nutrients:['Питательность породы','0…1'],permeability:['Проницаемость породы','0…1'],warmth:['Индекс тепла','0…1'],moisture:['Индекс влажности','0…1'],stability:['Устойчивость поверхности','0…1'],leaching:['Вымывание','0…1'],salinity:['Засоление','0…1'],soilDepthM:['Мощность почвы','м'],provinceTypeId:['Тип геологической провинции','индекс'],surfaceRockId:['Порода поверхности','индекс'],isContinental:['Континентальная кора','0 / 1'],faultInfluence:['Влияние разломов','0…1'],magmaticInfluence:['Влияние магматизма','0…1'],compression:['Сжатие','0…1'],extension:['Растяжение','0…1'],oldMagmatism:['Память магматизма','0…1'],basinScore:['Пригодность осадочного бассейна','0…1'],history:['Шум геологической истории','0…1'],ancientWetland:['Древняя заболоченность','0…1'],sedimentThicknessM:['Мощность осадочных пород','м'],environmentId:['Идентификатор рудообразующей среды (см. список)','индекс'],environmentScore:['Пригодность геологической среды','0…1'],beltStrength:['Интенсивность рудного пояса','0…1'],threshold:['Порог пригодности модели','0…1'],
  areaKm2:['Площадь планеты','км²'],density:['Плотность ресурсов','множитель'],frequency:['Частота семейства','множитель'],intensityScale:['Площадь на тело','км²'],classFactor:['Множитель класса залежи','множитель'],isOccurrence:['Проявление: 1, месторождение: 0','0 / 1'],minValue:['Нижняя граница модели','единицы результата'],maxValue:['Верхняя граница модели','единицы результата'],scale:['Масштаб результата','множитель'],sample:['Стандартная случайная выборка','0…1'],mineralId:['Идентификатор ресурса','индекс'],gradeDenominator:['Максимальное содержание компонента','единицы содержания'],depthM:['Глубина залежи','м'],
  windEast:['Зональная компонента ветрового пояса','индекс'],windNorth:['Меридиональная компонента ветрового пояса','индекс'],coriolisFactor:['Отклик на вращение планеты','индекс'],baselineTemperatureC:['Температура воздуха до влияния океана','°C'],oceanBaselineTemperatureC:['Базовая температура воды с учётом допустимого диапазона','°C'],seaTemperatureC:['Температура поверхности океана','°C'],currentEastMps:['Скорость течения на восток','м/с'],currentNorthMps:['Скорость течения на север','м/с'],speedMps:['Модуль скорости течения','м/с'],oceanAnomalyC:['Изменение температуры воды из-за переноса тепла','°C'],coastInfluence:['Сила влияния океана на участок','0…1'],coastalFraction:['Доля соседних участков суши','0…1'],
  freshwaterFluxMm:['Приток пресной воды минус испарение за сезон','мм/сезон'],waterDepthM:['Глубина океана','м'],salinityPsu:['Солёность поверхности','PSU'],densityKgM3:['Потенциальная плотность поверхности','кг/м³'],deepTemperatureC:['Температура глубинного слоя','°C'],deepSalinityPsu:['Солёность глубинного слоя','PSU'],deepDensityKgM3:['Потенциальная плотность глубинного слоя','кг/м³'],deepEastMps:['Глубинное течение на восток','м/с'],deepNorthMps:['Глубинное течение на север','м/с'],deepSpeedMps:['Скорость глубинного течения','м/с'],verticalVelocityMps:['Подъём воды положителен, погружение отрицательно','м/с'],deepMask:['Есть глубинный слой: 1, отсутствует: 0','0 / 1'],densityContrastKgM3:['Разность плотности поверхности и глубины при одном давлении','кг/м³']
};
const common=['base','latitudeDeg','longitudeDeg','elevationM','isOcean','season','x','y','z'];
const terrain=['temperatureC','precipitationMm','slope','ageMa','dischargeM3s','nutrients','resistance','permeability','provinceTypeId','surfaceRockId','isContinental','faultInfluence','magmaticInfluence','compression','extension','oldMagmatism','basinScore','history','ancientWetland','sedimentThicknessM'];
const soil=[...terrain,'warmth','moisture','stability','leaching','salinity','soilDepthM'];
const thermohaline=['windEast','windNorth','baselineTemperatureC','seaTemperatureC','waterDepthM','freshwaterFluxMm','salinityPsu','densityKgM3','deepTemperatureC','deepSalinityPsu','deepDensityKgM3','deepEastMps','deepNorthMps','deepSpeedMps','verticalVelocityMps','deepMask','densityContrastKgM3'];
const descriptor=(id,label,section,unit,min,max,extra,example,mapLayer,integer=false)=>({id,label,section,description:`Формула заменяет расчёт «${label.toLowerCase()}». Пустое поле сохраняет стандартный алгоритм.`,unit,min,max,integer,mapLayer,example,variables:[...new Set([...common,...extra])].map(name=>({name,label:variables[name][0],unit:variables[name][1]}))});
export const FORMULA_DESCRIPTORS=[
  descriptor('tectonics.elevation','Исходный рельеф','Рельеф','м',-50000,50000,['crust','upliftM','noise','ageMa'],'base + 200 * noise(x * 8, y * 8, z * 8)','elevation'),
  descriptor('climate.temperature','Температура','Климат','°C',-150,100,['sunlight','annualTemperature','seasonEffect','seaTemperatureC','oceanAnomalyC','coastInfluence'],'base + 5','temperature'),
  descriptor('climate.condensation','Конденсация влаги','Климат','доля',0,1,['availableMoisture','upliftM','stepScale','temperatureC','baseFraction'],'clamp(base * 1.2, 0, 1)','precipitation'),
  descriptor('climate.evaporation','Испарение суши','Климат','мм/год',0,10000,['precipitationMm','temperatureC'],'max(0, base * 0.7)','flow'),
  descriptor('climate.runoff','Поверхностный сток','Климат','мм/год',0,100000,['precipitationMm','temperatureC','evaporationMm'],'clamp(precipitationMm - evaporationMm, 0, precipitationMm)','flow'),
  descriptor('climate.biome','Классификация биома','Климат','ID биома',1,8,['temperatureC','precipitationMm'],'if(temperatureC < -15, 1, base)','biome',true),
  descriptor('ocean.east','Зональный дрейф воды','Океан','м/с',-5,5,['windEast','windNorth','coriolisFactor','coastalFraction','baselineTemperatureC'],'base','oceanCurrents'),
  descriptor('ocean.north','Меридиональный дрейф воды','Океан','м/с',-5,5,['windEast','windNorth','coriolisFactor','coastalFraction','baselineTemperatureC'],'base','oceanCurrents'),
  descriptor('ocean.temperature','Температура поверхности океана','Океан','°C',-10,60,['baselineTemperatureC','oceanBaselineTemperatureC','seaTemperatureC','currentEastMps','currentNorthMps','speedMps','oceanAnomalyC','coastInfluence'],'clamp(base + 2, -10, 60)','seaTemperature'),
  descriptor('ocean.coupling','Влияние океана на температуру воздуха','Океан','°C',-30,30,['windEast','windNorth','coriolisFactor','baselineTemperatureC','seaTemperatureC','currentEastMps','currentNorthMps','speedMps','oceanAnomalyC','coastInfluence'],'base * 0.8','temperature'),
  descriptor('ocean.salinity','Солёность поверхности','Океан','PSU',0,50,thermohaline,'clamp(base + 1, 0, 50)','seaSalinity'),
  descriptor('ocean.density','Потенциальная плотность поверхности','Океан','кг/м³',950,1100,thermohaline,'base','seaDensity'),
  descriptor('ocean.deepTemperature','Температура глубинного слоя','Океан','°C',-10,60,thermohaline,'clamp(base - 1, -10, 60)','deepTemperature'),
  descriptor('ocean.deepSalinity','Солёность глубинного слоя','Океан','PSU',0,50,thermohaline,'clamp(base + 0.2, 0, 50)','deepSalinity'),
  descriptor('ocean.deepDensity','Потенциальная плотность глубинного слоя','Океан','кг/м³',950,1200,thermohaline,'base','deepDensity'),
  descriptor('ocean.deepEast','Зональное глубинное течение','Океан','м/с',-1,1,thermohaline,'base','deepCurrents'),
  descriptor('ocean.deepNorth','Меридиональное глубинное течение','Океан','м/с',-1,1,thermohaline,'base','deepCurrents'),
  descriptor('ocean.vertical','Подъём и погружение воды','Океан','м/с',-1e-4,1e-4,thermohaline,'base * 0.8','oceanVerticalExchange'),
  descriptor('erosion.incision','Речной врез','Рельеф','м/проход',0,1000,['dischargeM3s','slope','resistance'],'base * (1 - 0.5 * resistance)','elevation'),
  descriptor('region.elevation','Региональные высоты','Рельеф','м',-50000,50000,['baseElevationM','detailM'],'baseElevationM + detailM * 0.5','elevation'),
  descriptor('geology.sediments','Осадочная толща','Геология','м',0,12000,terrain.filter(v=>!['nutrients','resistance','permeability','surfaceRockId','sedimentThicknessM'].includes(v)),'min(base * 1.2, 12000)','sediments'),
  descriptor('soils.depth','Мощность почвы','Почвы','м',0,20,soil,'clamp(base * 1.2, 0, 20)','fertility'),
  descriptor('soils.fertility','Плодородие','Почвы','индекс',0,1,soil,'clamp(0.6 * nutrients + 0.4 * moisture - 0.2 * salinity, 0, 1)','fertility'),
  descriptor('soils.retention','Удержание влаги','Почвы','индекс',0,1,soil,'clamp(base + 0.1 * moisture, 0, 1)','fertility'),
  descriptor('soils.aquifer','Водоносный потенциал','Почвы','индекс',0,1,soil,'clamp(permeability * moisture, 0, 1)','fertility'),
  ...[['earthquake','Землетрясения'],['volcanic','Вулканизм'],['landslide','Оползни'],['flood','Наводнения'],['karst','Карст']].map(([id,label])=>descriptor(`hazards.${id}`,label,'Опасности','индекс',0,1,soil,'clamp(base * 0.8, 0, 1)','hazards')),
  descriptor('geology.environment','Пригодность рудообразующей среды','Ресурсы','индекс',0,1,[...terrain,'environmentId'],'clamp(base * 1.15, 0, 1)','potential'),
  descriptor('mineralization.formation','Интенсивность рудообразования','Ресурсы','индекс',0,1,['environmentScore','beltStrength','threshold'],'clamp(environmentScore * (0.2 + 0.8 * beltStrength), 0, 1)','potential'),
  descriptor('resources.intensity','Количество кандидатов залежей','Ресурсы','число',0,2000000,['areaKm2','density','frequency','intensityScale','classFactor','isOccurrence'],'base * 0.5','resources'),
  ...[['mass','Масса залежи','млн т',1e-9,1e6],['depth','Глубина залежи','м',.01,12000],['grade','Содержание компонента','единицы ресурса',1e-9,1e6]].map(([id,label,unit,min,max])=>descriptor(`resources.${id}`,label,'Ресурсы',unit,min,max,['environmentScore','beltStrength','threshold','isOccurrence','minValue','maxValue','scale','sample','mineralId','gradeDenominator'],'base','resources')),
  descriptor('resources.access','Сложность доступа','Ресурсы','индекс',0,1,['depthM','slope'],'clamp(depthM / 2000 + slope * 5, 0, 1)','resources')
];
const byId=new Map(FORMULA_DESCRIPTORS.map(d=>[d.id,d]));
for(const descriptor of FORMULA_DESCRIPTORS){descriptor.variables.forEach(Object.freeze);Object.freeze(descriptor.variables);Object.freeze(descriptor);}
Object.freeze(FORMULA_DESCRIPTORS);Object.freeze(FORMULA_ENVIRONMENTS);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
const compiledCache=new Map();
function compiled(id,source) {
  const key=id+'\n'+source;
  if(!compiledCache.has(key)) {
    const d=byId.get(id);
    try{compiledCache.set(key,compileExpression(source,{variables:d.variables.map(v=>v.name)}));}catch(error){throw new Error(`${d.label}: ${error.message}`);}
    if(compiledCache.size>256)compiledCache.delete(compiledCache.keys().next().value);
  }
  return compiledCache.get(key);
}
export function normalizeFormulas(input) {
  if(input===undefined)return {version:FORMULAS_VERSION,expressions:{}};
  if(!plain(input)||Object.keys(input).some(k=>!['version','expressions'].includes(k)))throw new Error('Формулы: ожидается объект version / expressions');
  if(input.version!==FORMULAS_VERSION)throw new Error('Неподдерживаемая версия языка формул');
  if(!plain(input.expressions))throw new Error('Формулы: expressions должен быть объектом');
  const expressions={};
  for(const [id,value] of Object.entries(input.expressions)) {
    if(!byId.has(id))throw new Error(`Неизвестная формула: ${id}`);
    if(typeof value!=='string')throw new Error(`${id}: формула должна быть текстом`);
    const source=value.trim();if(!source)continue;
    compiled(id,source);expressions[id]=source;
  }
  return {version:FORMULAS_VERSION,expressions};
}
export function validateFormula(id,source) {
  if(!byId.has(id))throw new Error(`Неизвестная формула: ${id}`);
  return source.trim()?compiled(id,source.trim()):null;
}
export function makeFormulaEvaluator(configOrRules={},seed=configOrRules.seed??'world') {
  const rules=configOrRules.generationRules??configOrRules,normalized=normalizeFormulas(rules.formulas),programs=new Map(Object.entries(normalized.expressions).map(([id,source])=>[id,compiled(id,source)]));
  let operations=0;
  return {
    has:id=>programs.has(id),
    cost:id=>programs.get(id)?.nodeCount??0,
    evaluate(id,input,builtinValue,label='') {
      const program=programs.get(id);if(!program)return builtinValue;
      operations+=program.nodeCount;
      if(operations>MAX_FORMULA_OPERATIONS)throw new Error('Слишком большой расчёт формул: упростите выражения или уменьшите разрешение / число ресурсов');
      const d=byId.get(id),context={...input,base:builtinValue};
      const basis=`${seed}:${id}:${input.x??input.latitudeDeg??0}:${input.y??input.longitudeDeg??0}:${input.z??0}:${label}`;
      const functions={rand:(salt=0)=>hashSeed(`${basis}:${salt}`)/4294967296,noise:(x,y,z,scale=1)=>{if([x,y,z].some(v=>Math.abs(v)>1e6)||scale<=0||scale>1024)throw new Error('noise: координаты до 1000000, масштаб > 0 и ≤ 1024');return noise3(x*scale,y*scale,z*scale,hashSeed(`${seed}:${id}:noise`));}};
      try {
        const value=program.evaluate(context,functions);
        const maximum=id==='climate.runoff'?Math.min(d.max,input.precipitationMm):id==='resources.grade'?Math.min(d.max,input.gradeDenominator):d.max;
        if(!Number.isFinite(value)||value<d.min||value>maximum||(d.integer&&!Number.isInteger(value)))throw new Error(`результат ${value}; допустимо ${d.min}…${maximum} ${d.unit}${d.integer?', целое число':''}`);
        return value;
      }catch(error){throw new Error(`${d.label}${label?' · '+label:''}: ${error.message}`);}
    }
  };
}
