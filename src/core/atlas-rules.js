import {rocks as rockCatalog,minerals} from './geology-catalog.js';

// Bounded, serializable numeric controls; the separate expression engine supplies
// validated mathematical overrides without changing the resource catalogue.
const number=(defaultValue,min,max,label,integer=false)=>({default:defaultValue,min,max,label,...(integer?{integer:true}:{})});
const flag=(defaultValue,label)=>({default:defaultValue,label});

const component=(mineral,grade)=>({mineral,grade});
const model=(id,key,threshold,kind,reason,depth,mass,components)=>({id,key,threshold,kind,reason,depth,mass,components});

// Broad deposit families, not calibrated grade-tonnage models or economic reserves.
export const baseDepositModels=[
  model('porphyry','hydrothermal',0.22,'Медно-молибденовое порфировое','Магматический центр, трещины и гидротермальная циркуляция.',[100,1600],[30,600],[component(0,[0.3,1.5]),component(14,[0.01,0.15])]),
  model('gold-vein','hydrothermal',0.28,'Золоторудное жильное','Гидротермальные растворы в трещинах и разломах.',[30,900],[0.5,25],[component(1,[1,9])]),
  model('tin-greisen','felsic',0.24,'Оловянно-вольфрамовое грейзеновое','Эволюционировавшая гранитная интрузия и поздние растворы.',[60,1000],[1,60],[component(2,[0.2,1.3]),component(15,[0.1,0.9])]),
  model('iron-formation','iron',0.25,'Железистая формация','Древняя осадочная железистая толща и последующее преобразование.',[5,600],[30,1800],[component(3,[25,65])]),
  model('coal-basin','coal',0.24,'Угленосный бассейн','Древние заболоченные условия, захоронение органики в осадочной толще.',[15,650],[10,900],[component(4,[55,90])]),
  model('halite','evaporite',0.2,'Галитовое эвапоритовое','Древний замкнутый бассейн испарения с накоплением галита.',[5,700],[10,600],[component(5,[75,98])]),
  model('potash','evaporite',0.35,'Калийное эвапоритовое','Поздние стадии концентрации рассола в древнем бассейне испарения.',[30,900],[5,250],[component(27,[8,30])]),
  model('gypsum','evaporite',0.2,'Гипсовое эвапоритовое','Осаждение сульфатов в древнем бассейне испарения; отдельный пласт.',[1,200],[5,200],[component(28,[65,95])]),
  model('lead-zinc','carbonateBasin',0.24,'Свинцово-цинковое в карбонатах','Осадочная толща с карбонатными горизонтами и путями движения рассолов.',[20,900],[2,120],[component(6,[1,7]),component(7,[2,12]),component(8,[10,150])]),
  model('nickel-sulfide','maficIntrusion',0.24,'Медно-никелевое сульфидное','Процедурно восстановленная основная/ультраосновная интрузия; сегрегация сульфидов.',[30,1200],[3,180],[component(9,[0.3,2.5]),component(10,[0.02,0.15]),component(20,[0.2,5]),component(0,[0.2,1.2])]),
  model('nickel-laterite','ultramaficWeathering',0.25,'Никель-кобальтовое латеритное','Тёплое влажное выветривание предполагаемого ультраосновного материала.',[1,70],[5,150],[component(9,[0.7,2]),component(10,[0.03,0.2])]),
  model('manganese','marineBasin',0.3,'Марганцевое осадочное','Древняя морская осадочная обстановка; химическое осаждение марганца.',[5,350],[3,200],[component(11,[15,45])]),
  model('chromite','ultramafic',0.32,'Хромитовое','Предполагаемый ультраосновной интрузивный комплекс и магматическая концентрация.',[10,750],[1,70],[component(12,[20,48])]),
  model('titanomagnetite','maficIntrusion',0.24,'Титаномагнетитовое','Основная интрузия и накопление железо-титановых оксидов.',[10,600],[10,700],[component(13,[5,18]),component(25,[0.15,1.5])]),
  model('bauxite','weatheredPlatform',0.25,'Бокситовое','Продолжительное тёплое влажное выветривание на устойчивой континентальной поверхности.',[1,70],[5,400],[component(16,[35,60])]),
  model('sandstone-uranium','sandstoneRedox',0.24,'Урановое в песчаниках','Проницаемые осадочные горизонты с условной окислительно-восстановительной границей.',[20,650],[1,90],[component(17,[0.03,0.4])]),
  model('lct-pegmatite','pegmatite',0.2,'Литий-танталовое пегматитовое','Редкометалльная пегматитовая фаза эволюционировавшей гранитной системы.',[5,500],[1,100],[component(18,[0.5,2.2]),component(24,[0.005,0.05])]),
  model('carbonatite','alkalineIntrusion',0.28,'Редкоземельно-ниобиевое карбонатитовое','Условный щелочной/карбонатитовый комплекс в континентальной рифтовой области.',[5,700],[5,250],[component(19,[0.5,8]),component(23,[0.2,2])]),
  model('mercury','epithermal',0.25,'Ртутное эпитермальное','Приповерхностная низкотемпературная гидротермальная система.',[5,350],[0.1,8],[component(21,[0.1,1.5])]),
  model('antimony','orogenicFluid',0.25,'Сурьмяное жильное','Флюиды вдоль разломов в деформированных континентальных породах.',[10,600],[0.2,15],[component(22,[1,8])]),
  model('phosphorite','marineBasin',0.3,'Фосфоритовое осадочное','Древний морской бассейн и накопление фосфатного вещества.',[5,250],[10,500],[component(26,[15,32])]),
  model('graphite','metamorphicCarbon',0.25,'Графитовое метаморфическое','Углеродсодержащая осадочная предыстория и последующий метаморфизм.',[5,500],[1,80],[component(29,[3,18])]),
  model('fluorite','felsic',0.24,'Флюоритовое гидротермальное','Поздние фторсодержащие растворы гранитной системы.',[10,600],[1,60],[component(30,[15,70])]),
  model('barite','carbonateBasin',0.24,'Баритовое жильное / стратиформное','Бассейновые рассолы и осаждение сульфата бария.',[5,500],[1,90],[component(31,[25,85])])
];

const modelRules=Object.fromEntries(baseDepositModels.map(m=>[m.id,{
  enabled:flag(true,`Включить модель «${m.kind}»`),
  frequency:number(1,0,8,'Частота модели'),
  threshold:number(m.threshold,0,1,'Минимальная пригодность среды'),
  massMin:number(m.mass[0],0.001,100000,'Минимальная масса, млн т'),
  massMax:number(m.mass[1],0.001,100000,'Максимальная масса, млн т'),
  depthMin:number(m.depth[0],.001,12000,'Минимальная глубина, м'),
  depthMax:number(m.depth[1],.001,12000,'Максимальная глубина, м'),
  grades:Object.fromEntries(m.components.map(c=>[String(c.mineral),{
    gradeMin:number(c.grade[0],.000001,minerals[c.mineral].gradeDenominator,'Минимальное содержание'),
    gradeMax:number(c.grade[1],.000001,minerals[c.mineral].gradeDenominator,'Максимальное содержание')
  }]))
}]));

const rockRules=Object.fromEntries(rockCatalog.map(r=>[String(r.id),{
  resistance:number(r.resistance,0,1,`Сопротивление разрушению: ${r.name}`),
  permeability:number(r.permeability,0,1,`Проницаемость: ${r.name}`),
  nutrients:number(r.nutrients,0,1,`Питательность субстрата: ${r.name}`)
}]));

export const atlasRuleSchema={
  geology:{
    continentalCrustThreshold:number(.52,.3,.8,'Порог континентальной коры'), compressionMemoryM:number(1800,100,10000,'Масштаб памяти сжатия, м'), extensionMemoryM:number(1400,100,10000,'Масштаб памяти растяжения, м'),
    basinDepthOffsetM:number(100,0,2000,'Смещение глубины бассейна, м'), basinDepthScaleM:number(1800,100,10000,'Масштаб глубины бассейна, м'), basinElevationFactor:number(.5,0,1,'Вес низкой высоты бассейна'), basinSlopeScale:number(.015,.001,.2,'Масштаб уклона бассейна'), basinSlopeFactor:number(.3,0,1,'Вес малого уклона бассейна'), basinVariationOffset:number(.35,0,1,'Смещение вариации бассейна'),
    faultInfluenceLimitKm:number(1500,100,5000,'Радиус влияния разломов, км'), faultDecayKm:number(220,20,2000,'Затухание влияния разломов, км'),
    magmaticInfluenceLimitKm:number(1500,100,5000,'Радиус влияния магматизма, км'), magmaticDecayKm:number(200,20,2000,'Затухание влияния магматизма, км'),
    shelfMinElevationM:number(-1200,-5000,0,'Глубина континентального шельфа, м'), youngOceanAgeMa:number(50,1,500,'Возраст молодого океана, млн лет'),
    magmaticProvinceInfluence:number(.45,0,1,'Порог магматической области'), magmaticProvinceFault:number(.3,0,1,'Разломность магматической области'), magmaticProvinceMemory:number(.15,0,1,'Память магматизма'),
    riftExtension:number(.2,0,1,'Порог растяжения рифта'), foldCompression:number(.18,0,1,'Порог сжатия складчатого пояса'), upliftM:number(1700,0,8000,'Поднятие складчатого пояса, м'), highlandM:number(2400,0,9000,'Высота складчатого пояса, м'),
    alluvialElevationM:number(1000,0,6000,'Высота аллювиальной равнины, м'), alluvialSlope:number(.012,.001,.1,'Уклон аллювиальной равнины'), basinThreshold:number(.54,0,1,'Порог осадочного бассейна'), coastalBasinElevationM:number(650,0,4000,'Высота прибрежного бассейна, м'), coastalBasinDistanceKm:number(350,10,3000,'Дистанция прибрежного бассейна, км'), basinSlope:number(.012,.001,.1,'Уклон осадочного бассейна'),
    sedimentBasinBaseM:number(250,0,5000,'Базовая мощность бассейна, м'), sedimentBasinScoreM:number(2800,0,10000,'Мощность от бассейнового индекса, м'), sedimentVariationM:number(500,0,5000,'Мощность от вариации, м'), sedimentRiftBaseM:number(300,0,5000,'Базовая мощность рифта, м'), sedimentRiftExtensionM:number(1600,0,10000,'Мощность от растяжения, м'), sedimentOceanBaseM:number(80,0,5000,'Базовая океаническая мощность, м'), sedimentOceanAgeFactor:number(3,0,50,'Океаническая мощность на млн лет, м'), platformSedimentVariation:number(.45,0,1,'Вариация осадков платформы'), platformSedimentBaseM:number(150,0,5000,'Базовая мощность осадков платформы, м'), rockEvaporiteHistory:number(.39,0,1,'Исторический порог эвапоритов'), rockEvaporiteBasin:number(.65,0,1,'Бассейновый порог эвапоритов'), rockSedimentaryVariation:number(.48,0,1,'Порог песчаника по вариации'),
    columnCoverAlluvialM:number(15,1,1000,'Покров аллювия, м'), columnCoverAlluvialVariationM:number(80,0,1000,'Вариация покрова аллювия, м'), columnCoverMarineM:number(20,1,1000,'Покров морских илов, м'), columnCoverMarineVariationM:number(100,0,1000,'Вариация покрова морских илов, м'), columnCoverMinimumM:number(40,1,5000,'Минимум покрова колонки, м'), columnDepthM:number(12000,1000,50000,'Глубина геологической колонки, м'),
    environmentSedimentCarbonateM:number(200,0,5000,'Осадки для карбонатной среды, м'), environmentSedimentMarineM:number(250,0,5000,'Осадки для морской среды, м'), environmentSedimentSandstoneM:number(300,0,5000,'Осадки для песчаниковой среды, м'), environmentCoalM:number(400,0,5000,'Осадки для угленосной среды, м'), environmentHistoryCoalMa:number(20,0,500,'Возраст угленосной среды, млн лет'), hydrothermalMagmaticFactor:number(.7,0,2,'Магматический вклад гидротермальной среды'), hydrothermalMemoryFactor:number(.3,0,2,'Исторический вклад гидротермальной среды'), hydrothermalBase:number(.3,0,2,'Базовый гидротермальный фактор'), hydrothermalCompressionFactor:number(.5,0,2,'Сжатие гидротермальной среды'), hydrothermalFaultFactor:number(.2,0,2,'Разломы гидротермальной среды'), felsicBase:number(.18,0,1,'Базовый кислый магматизм'), felsicMemoryFactor:number(.5,0,2,'Исторический вклад кислого магматизма'), felsicMagmaticFactor:number(.4,0,2,'Текущий вклад кислого магматизма'), ironCompressionFactor:number(.5,0,2,'Сжатие железистой среды'), ironBasinFactor:number(.3,0,2,'Бассейновый вклад железистой среды'), ironGneissFactor:number(.25,0,2,'Гнейсовый вклад железистой среды')
  },
  soils:{
    baseDepthM:number(.15,0,2,'Базовая глубина почвы, м'), climateDepthM:number(1.9,0,6,'Климатическая глубина почвы, м'), alluvialDepthM:number(1.2,0,6,'Добавка аллювиальной почвы, м'), minDepthM:number(.03,.001,2,'Минимальная глубина почвы, м'), maxDepthM:number(4,.1,20,'Максимальная глубина почвы, м'),
    resistancePenalty:number(.35,0,1,'Влияние прочности породы'), fertilityRockFactor:number(.45,0,1,'Вклад питательности породы'), fertilityClimateFactor:number(.3,0,1,'Вклад климата в плодородие'), alluvialFertility:number(.25,0,1,'Плодородие аллювия'), leachingRainMm:number(1800,0,6000,'Осадки начала выщелачивания, мм'), leachingRangeMm:number(2200,100,6000,'Диапазон выщелачивания, мм'),
    retentionRockFactor:number(.5,0,1,'Вклад породы в удержание воды'), retentionSoilDivisor:number(6,.1,30,'Масштаб глубины для воды'), retentionClimateFactor:number(.2,0,1,'Вклад влаги в удержание воды'), aquiferSlope:number(.025,.001,.2,'Уклон снижения водоносности')
  },
  hazards:{
    stressScale:number(.0012,.00001,.02,'Масштаб напряжения'), volcanicScale:number(.85,0,2,'Масштаб вулканической опасности'), landslideSlope:number(.02,.001,.2,'Уклон оползней'), landslideRainMm:number(1800,100,6000,'Осадки оползней, мм'), landslideResistancePenalty:number(.65,0,1,'Защита прочности от оползней'), floodLogScale:number(5,.1,20,'Масштаб стока паводков'), floodSlope:number(.01,.001,.2,'Уклон защиты от паводков'), floodElevationM:number(1800,1,8000,'Высота защиты от паводков'), karstRainMm:number(1800,100,6000,'Осадки карста, мм'), karstBase:number(.15,0,1,'Базовый карстовый фактор')
  },
  mineralization:{
    structuralMaxEdgeKm:number(1800,10,10000,'Максимальная длина структурного сегмента, км'), structuralWidthMinKm:number(35,1,500,'Минимальная ширина структурной зоны, км'), structuralWidthRangeKm:number(45,0,500,'Разброс ширины структурной зоны, км'), intrusionThreshold:number(.15,0,1,'Порог интрузивного центра'), intrusionWidthMinKm:number(65,1,500,'Минимальная ширина интрузии, км'), intrusionWidthRangeKm:number(105,0,500,'Разброс ширины интрузии, км'), basinThresholdM:number(400,0,10000,'Порог бассейнового центра, м'), basinWidthMinKm:number(180,1,500,'Минимальная ширина бассейна, км'), basinWidthRangeKm:number(220,0,500,'Разброс ширины бассейна, км'), basinAspectMin:number(1.5,1,5,'Минимальная вытянутость бассейна'), basinAspectRange:number(1.5,0,5,'Разброс вытянутости бассейна'),
    beltStructuralFeature:number(.8,0,2,'Вклад структурных объектов'), beltStructuralRidge:number(.6,0,2,'Вклад структурного шума'), beltIntrusionFeature:number(.85,0,2,'Вклад интрузивных объектов'), beltIntrusionPatch:number(.45,0,2,'Вклад интрузивного шума'), beltBasinFeature:number(.65,0,2,'Вклад бассейновых объектов'), beltBasinPatch:number(.65,0,2,'Вклад бассейнового шума'), formationBase:number(.4,0,2,'Базовый коэффициент образования'), formationBelt:number(1.2,0,3,'Коэффициент рудного пояса')
  },
  resources:{
    majorFactor:number(1,0,8,'Множитель крупных месторождений'), occurrenceFactor:number(1,0,8,'Множитель малых проявлений'), majorSpacing:number(120,1,2000,'Шаг крупных месторождений, км'), minorSpacing:number(40,1,1000,'Шаг малых проявлений, км'), depthScale:number(1,.01,20,'Масштаб глубины'), gradeScale:number(1,.01,20,'Масштаб содержания'), massScale:number(1,.01,100,'Масштаб массы'), majorIntensityScale:number(650000,1000,10000000,'Площадь на крупное месторождение, км²'), occurrenceIntensityScale:number(130000,1000,10000000,'Площадь на малое проявление, км²'), occurrenceMassFactor:number(.002,.00001,1,'Доля массы малого проявления'),
    placer:{enabled:flag(true,'Включить россыпи'),maxTravelKm:number(2000,10,10000,'Максимальный путь россыпи, км'),minTravelKm:number(50,0,2000,'Минимальный путь россыпи, км'),maxSlope:number(.012,.0001,.2,'Максимальный уклон россыпи'),minDischarge:number(150,0,100000,'Минимальный сток россыпи, м³/с'),chance:number(.5,0,1,'Вероятность россыпи'),massMin:number(.2,.001,1000,'Минимальная масса россыпи, млн т'),massMax:number(15,.001,1000,'Максимальная масса россыпи, млн т'),depthMin:number(1,.001,12000,'Минимальная глубина россыпи, м'),depthMax:number(20,.001,12000,'Максимальная глубина россыпи, м'),gradeMin:number(.1,.000001,1000000,'Минимальное содержание золота'),gradeMax:number(1.8,.000001,1000000,'Максимальное содержание золота')}
  },
  rocks:rockRules,
  depositModels:modelRules
};

function defaultsOf(schema) {
  if(schema && typeof schema==='object' && 'default' in schema)return schema.default;
  return Object.fromEntries(Object.entries(schema).map(([key,value])=>[key,defaultsOf(value)]));
}
export const defaultAtlasRules=defaultsOf(atlasRuleSchema);

function mergeKnown(schema,value) {
  if(schema && typeof schema==='object' && 'default' in schema)return value===undefined?schema.default:value;
  const source=value&&typeof value==='object'?value:{};
  return Object.fromEntries(Object.entries(schema).map(([key,descriptor])=>[key,mergeKnown(descriptor,source[key])]));
}
export function resolveAtlasRules(rulesOrConfig={}) {
  const candidate=rulesOrConfig?.generationRules??rulesOrConfig;
  return {...mergeKnown(atlasRuleSchema,candidate),formulas:candidate?.formulas};
}

export function effectiveRocks(rules={}) {
  const resolved=resolveAtlasRules(rules);
  return rockCatalog.map(rock=>({...rock,...resolved.rocks[String(rock.id)]}));
}

export function effectiveDepositModels(rules={}) {
  const resolved=resolveAtlasRules(rules);
  return baseDepositModels.filter(model=>resolved.depositModels[model.id].enabled).map(model=>{
    const r=resolved.depositModels[model.id];
    return {...model,threshold:r.threshold,depth:[r.depthMin,r.depthMax],mass:[r.massMin,r.massMax],frequency:r.frequency,
      components:model.components.map(component=>({...component,grade:[r.grades[String(component.mineral)].gradeMin,r.grades[String(component.mineral)].gradeMax]}))};
  });
}
