// Physical controls exposed to the generator UI and import/export format.
// Defaults intentionally reproduce the original geological-atlas-0.4 equations.
const leaf = (value, min, max, label, integer=false) => integer ? {default:value,min,max,label,integer:true} : {default:value,min,max,label};

export const physicalRuleSchema={
  tectonics:{
    plateVelocityBase:leaf(0.0007,0.0001,0.003,'Базовая скорость плит'),
    plateVelocityVariation:leaf(0.0008,0,0.003,'Разброс скорости плит'),
    crustNoiseScale:leaf(2.4,0.5,8,'Масштаб шума коры'),
    crustNoiseOctaves:leaf(4,1,8,'Октавы шума коры',true),
    continentalBiasRange:leaf(0.15,0,0.5,'Континентальный разброс плит'),
    crustThreshold:leaf(0.39,0,1,'Порог континентальной коры'),
    crustContrast:leaf(4,0.5,10,'Контраст коры'),
    continentalCrustThreshold:leaf(0.52,0,1,'Порог континентальной плиты'),
    convergenceThreshold:leaf(0.00012,0.00001,0.001,'Порог границы плит'),
    continentalUplift:leaf(145000,10000,400000,'Поднятие континентальной коллизии'),
    oceanicUplift:leaf(85000,10000,300000,'Поднятие океанической коллизии'),
    continentalExtension:leaf(60000,1000,250000,'Опускание континентального рифта'),
    oceanicExtension:leaf(18000,1000,150000,'Опускание океанического рифта'),
    compressionMemoryGain:leaf(145000,1000,400000,'Накопление сжатия'),
    extensionMemoryGain:leaf(60000,1000,250000,'Накопление растяжения'),
    magmaticMemoryGain:leaf(0.035,0,0.25,'Накопление магматической памяти'),
    upliftRetention:leaf(0.987,0.8,1,'Сохранение поднятия'),
    compressionMemoryRetention:leaf(0.99,0.8,1,'Сохранение памяти сжатия'),
    extensionMemoryRetention:leaf(0.99,0.8,1,'Сохранение памяти растяжения'),
    magmaticMemoryRetention:leaf(0.997,0.8,1,'Сохранение магматической памяти'),
    upliftMin:leaf(-2200,-10000,0,'Минимум тектонического рельефа'),
    upliftMax:leaf(8500,1000,20000,'Максимум тектонического рельефа'),
    smoothingSelf:leaf(0.72,0,1,'Сохранение рельефа при сглаживании'),
    elevationNoiseScale:leaf(12,1,40,'Масштаб шума высот'),
    elevationNoiseOctaves:leaf(3,1,8,'Октавы шума высот',true),
    elevationNoiseAmplitude:leaf(850,0,3000,'Амплитуда шума высот')
  },
  climate:{
    equatorialTemperature:leaf(29,5,45,'Температура экватора'),
    latitudeCooling:leaf(49,10,80,'Похолодание к полюсам'),
    seasonalAmplitude:leaf(100,0,200,'Сезонная амплитуда'),
    oceanSeasonModeration:leaf(0.36,0,1,'Смягчение сезонов океаном'),
    landSeasonModeration:leaf(0.85,0,1,'Сезонная амплитуда суши'),
    lapseRate:leaf(0.006,0,0.012,'Понижение температуры с высотой'),
    moistureZonalShare:leaf(0.84,0,1,'Доля зонального переноса влаги'),
    moistureMeridionalShare:leaf(0.16,0,1,'Доля меридионального переноса влаги'),
    oceanMoistureBase:leaf(24,0,80,'Базовое испарение океана'),
    oceanMoistureTemperatureFactor:leaf(0.5,0,3,'Влияние температуры на испарение океана'),
    oceanMoistureMin:leaf(3,0,20,'Минимум испарения океана'),
    oceanMoistureMax:leaf(44,30,120,'Максимум испарения океана'),
    transportDistance:leaf(64,8,256,'Дальность переноса влаги'),
    equatorialBeltWidth:leaf(0.24,0.05,1,'Ширина экваториального пояса'),
    stormTrackLatitude:leaf(0.87,0.2,1.4,'Широта штормовых путей'),
    stormTrackWidth:leaf(0.22,0.05,1,'Ширина штормовых путей'),
    baseCondensation:leaf(0.025,0.001,0.2,'Базовая конденсация'),
    equatorialCondensation:leaf(0.075,0,0.3,'Экваториальная конденсация'),
    stormTrackCondensation:leaf(0.04,0,0.2,'Штормовая конденсация'),
    condensationMin:leaf(0.001,0.00001,0.1,'Минимум конденсации'),
    condensationMax:leaf(0.8,0.1,0.99,'Максимум конденсации'),
    orographyScale:leaf(7000,500,20000,'Масштаб орографических осадков'),
    evaporationBase:leaf(350,0,1000,'Базовое испарение суши'),
    evaporationTemperatureFactor:leaf(24,0,80,'Влияние температуры на испарение суши'),
    evaporationMin:leaf(70,0,400,'Минимум испарения суши'),
    evaporationMax:leaf(1700,500,5000,'Максимум испарения суши'),
    runoffMinimumFraction:leaf(0.12,0,1,'Минимальная доля стока')
  },
  biomes:{
    iceTemperature:leaf(-8,-30,-1,'Температура ледяной области'),
    tundraTemperature:leaf(2,0,15,'Температура тундры'),
    desertPrecipitation:leaf(250,0,600,'Осадки пустыни'),
    steppePrecipitation:leaf(650,600,2500,'Осадки степи'),
    tropicalTemperature:leaf(22,21,35,'Температура влажных тропиков'),
    tropicalPrecipitation:leaf(1500,200,5000,'Осадки влажных тропиков'),
    savannaTemperature:leaf(18,0,20,'Температура саванны'),
    alpineElevation:leaf(3400,500,8000,'Высота высокогорья'),
    alpineTemperature:leaf(4,-15,15,'Температура высокогорья')
  },
  erosion:{
    incisionMaximum:leaf(55,0,500,'Максимальный речной врез'),
    incisionFactor:leaf(0.22,0,3,'Интенсивность речного вреза'),
    resistanceEffect:leaf(0.8,0,1,'Влияние устойчивости пород'),
    depositionFraction:leaf(0.35,0,1,'Доля речного накопления'),
    depositionSlope:leaf(0.006,0.0001,0.1,'Порог уклона для накопления')
  },
  region:{
    detailFrequency:leaf(150,10,1000,'Частота деталей региона'),
    detailOctaves:leaf(3,1,8,'Октавы деталей региона',true),
    detailAmplitude:leaf(180,0,1500,'Амплитуда деталей региона'),
    rockDetailBase:leaf(0.4,0,2,'Базовая связь деталей с породой'),
    rockResistanceFactor:leaf(0.6,0,2,'Влияние устойчивости породы на детали'),
    thicknessVariation:leaf(0.18,0,0.8,'Вариация мощности слоёв')
  }
};

function defaultsFor(schema) {
  return Object.fromEntries(Object.entries(schema).map(([key,value])=>[
    key, value && typeof value==='object' && 'default' in value ? value.default : defaultsFor(value)
  ]));
}

export const defaultPhysicalRules=defaultsFor(physicalRuleSchema);

export function physicalRulesFor(config,section) {
  return config?.generationRules?.[section]??defaultPhysicalRules[section];
}
