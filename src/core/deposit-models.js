import {clamp} from './grid.js';
import {random} from './random.js';
import {minerals} from './geology-catalog.js';
import {uniformSphere,pointCoordinates,proximityIndex,interpolateArc} from './spatial.js';
import {makeProspectivitySampler} from './mineralization.js';

// Broad deposit families, not calibrated grade-tonnage models or economic reserves.
const component=(mineral,grade)=>({mineral,grade});
const model=(id,key,threshold,kind,reason,depth,mass,components)=>({id,key,threshold,kind,reason,depth,mass,components});
export const depositModels=[
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
export const depositClasses=[{id:'major',name:'Месторождения'},{id:'occurrence',name:'Малые проявления'}];
export function depositMatches(d,{resource='all',depositClass='all'}={}) {
  return (resource==='all' || d.mineral===Number(resource)) && (depositClass==='all' || d.sizeClass===depositClass);
}
export function resourceInventory(deposits) {
  return minerals.map(m=>({mineral:m.id,major:deposits.filter(d=>d.mineral===m.id && d.sizeClass==='major').length,
    occurrence:deposits.filter(d=>d.mineral===m.id && d.sizeClass==='occurrence').length}));
}
export function generateDeposits(grid,geology,water,atlas,config,options={}) {
  const density=config.resourceDensity??1,deposits=[];
  if(!Number.isFinite(density) || density<0 || density>4)throw new RangeError('Плотность ресурсов должна быть от 0 до 4');
  let bodyId=0;const sampler=makeProspectivitySampler(grid,geology,atlas,config.seed),area=4*Math.PI*grid.radiusKm**2;
  const addBody=(site,rule,sizeClass,rng,sourceId=null)=>{
    const {cell,position,formationScore}=site;
    const small=sizeClass==='occurrence',massScale=small?0.002:1;
    // Log-uniform masses avoid making almost every body approach the upper tonnage bound.
    const oreMassMt=rule.mass[0]*(rule.mass[1]/rule.mass[0])**rng()*massScale;
    const depthM=rule.depth[0]+rng()*(rule.depth[1]-rule.depth[0]);
    const oreBodyId=bodyId++;
    for(const c of rule.components) {
      const m=minerals[c.mineral],grade=c.grade[0]+rng()*(c.grade[1]-c.grade[0]);
      deposits.push({id:deposits.length,oreBodyId,cell,position,...pointCoordinates(position),placementId:site.placementId,provinceId:atlas.provinceId[cell],mineral:c.mineral,modelId:rule.id,environmentKey:rule.key,
        kind:rule.kind,reason:rule.reason,oreMinerals:m.oreMinerals,sizeClass,formationScore,environmentScore:site.environmentScore,beltStrength:site.beltStrength,depthM,grade,gradeUnit:m.unit,oreMassMt,
        containedResourceTonnes:oreMassMt*1e6*grade/m.gradeDenominator,resourceBasis:m.resourceBasis,
        accessDifficulty:clamp(depthM/1600*0.45+clamp(atlas.slope[cell]/0.025,0,1)*0.25+clamp(geology.elevation[cell]/4500,0,1)*0.3,0,1),
        discovered:false,exploited:false,economicStatus:'not-assessed',sourceDepositId:sourceId});
    }
  };
  // A thinned Poisson process samples equal physical area on the sphere, independent of grid cells.
  // Separate class streams and stable placement ids keep body parameters independent of iteration order.
  for(const rule of depositModels) {
    if(options.modelIds && !options.modelIds.includes(rule.id))continue;
    const env=atlas.environments[rule.key];if(!env)continue;
    const majorSpacing=options.majorSpacing??120,minorSpacing=options.minorSpacing??40;
    const majorIndex=proximityIndex(grid.radiusKm,majorSpacing),smallIndex=proximityIndex(grid.radiusKm,minorSpacing);
    for(const sizeClass of ['major','occurrence']) {
      const placement=random(`${config.seed}:points:${rule.id}:${sizeClass}`),scale=sizeClass==='major'?650000:130000;
      const intensity=area/scale*density*(sizeClass==='major'?(options.majorFactor??1):(options.occurrenceFactor??1));let time=0,ordinal=0;
      while((time+=-Math.log(1-placement()))<intensity) {
        const position=uniformSphere(placement),accept=placement(),placementId=`${rule.id}:${sizeClass}:${ordinal++}`;
        if(options.sitePredicate && !options.sitePredicate(position,rule))continue;
        const site=sampler.sample(rule,position);
        if(sampler.acceptance(rule,position,site)<=accept)continue;
        if(majorIndex.near(position,sizeClass==='major'?majorSpacing:minorSpacing) || smallIndex.near(position,minorSpacing))continue;
        (sizeClass==='major'?majorIndex:smallIndex).add(position);
        addBody({...site,position,placementId},rule,sizeClass,random(`${config.seed}:body:${placementId}`));
      }
    }
  }
  const primaryGold=deposits.filter(d=>d.mineral===1 && d.sizeClass==='major');
  for(const source of primaryGold) {
    const rng=random(`${config.seed}:placer:${source.cell}`);let cell=source.cell,travelKm=0;const seen=new Set();
    while(water.downstream[cell]>=0 && travelKm<2000) {
      seen.add(cell);const next=water.downstream[cell];if(seen.has(next) || geology.elevation[next]<=0)break;
      travelKm+=grid.distance(cell,next);if(travelKm>2000)break;cell=next;
      if(travelKm>50 && atlas.slope[cell]<0.012 && water.discharge[cell]>150 && rng()<0.5) {
        // One placer per receiving cell; avoids duplicating a downstream accumulation.
        const end=water.downstream[cell]>=0?grid.point(water.downstream[cell]):grid.point(cell);
        const position=interpolateArc(grid.point(cell),end,.05+rng()*.3);
        if(options.sitePredicate && !options.sitePredicate(position,{id:'gold-vein'}))continue;
        if(grid.sample(position)!==cell || grid.sampleField(geology.elevation,position)<=0)continue;
        if(!deposits.some(d=>d.modelId==='gold-placer' && d.cell===cell))addBody({cell,position,placementId:`placer:${source.placementId}`,formationScore:source.formationScore*.6,environmentScore:source.environmentScore,beltStrength:source.beltStrength},
          model('gold-placer','hydrothermal',0,'Золотая россыпь',`Речной перенос из первичного источника №${source.id+1} и накопление на малом уклоне.`,[1,20],[0.2,15],[component(1,[0.1,1.8])]),
          'occurrence',rng,source.id);
        break;
      }
    }
  }
  return deposits;
}
