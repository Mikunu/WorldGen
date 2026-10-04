import {clamp} from './grid.js';
import {random} from './random.js';
import {minerals} from './geology-catalog.js';
import {uniformSphere,pointCoordinates,proximityIndex,interpolateArc} from './spatial.js';
import {makeProspectivitySampler} from './mineralization.js';
import {effectiveDepositModels,resolveAtlasRules} from './atlas-rules.js';
import {makeFormulaEvaluator,MAX_FORMULA_OPERATIONS} from './generation-formulas.js';

export const depositModels=effectiveDepositModels();
export const depositClasses=[{id:'major',name:'Месторождения'},{id:'occurrence',name:'Малые проявления'}];
export function depositMatches(d,{resource='all',depositClass='all'}={}) {
  return (resource==='all' || d.mineral===Number(resource)) && (depositClass==='all' || d.sizeClass===depositClass);
}
export function resourceInventory(deposits) {
  return minerals.map(m=>({mineral:m.id,major:deposits.filter(d=>d.mineral===m.id && d.sizeClass==='major').length,
    occurrence:deposits.filter(d=>d.mineral===m.id && d.sizeClass==='occurrence').length}));
}
export function generateDeposits(grid,geology,water,atlas,config,options={}) {
  const density=config.resourceDensity??1,rules=resolveAtlasRules(config),resourceRules=rules.resources,deposits=[];
  if(!Number.isFinite(density) || density<0 || density>4)throw new RangeError('Плотность ресурсов должна быть от 0 до 4');
  if(density===0)return deposits;
  const formulas=makeFormulaEvaluator(config,config.seed),customBody=['mass','depth','grade','access'].some(id=>formulas.has('resources.'+id));
  // The geological field keeps its world seed when the editor changes placement seed.
  let bodyId=0;const sampler=makeProspectivitySampler(grid,geology,atlas),area=4*Math.PI*grid.radiusKm**2;
  const models=effectiveDepositModels(rules).filter(rule=>(!options.modelIds||options.modelIds.includes(rule.id))&&atlas.environments[rule.key]),intensities=new Map();
  let candidateBudget=0;
  for(const rule of models)for(const sizeClass of ['major','occurrence']) {
    const scale=sizeClass==='major'?resourceRules.majorIntensityScale:resourceRules.occurrenceIntensityScale,classFactor=sizeClass==='major'?(options.majorFactor??resourceRules.majorFactor):(options.occurrenceFactor??resourceRules.occurrenceFactor),builtin=area/scale*density*rule.frequency*classFactor;
    const intensity=classFactor===0||rule.frequency===0?0:formulas.evaluate('resources.intensity',{areaKm2:area,density,frequency:rule.frequency,intensityScale:scale,classFactor,isOccurrence:sizeClass==='occurrence'?1:0,latitudeDeg:0,longitudeDeg:0,elevationM:0,isOcean:0,season:-1,x:0,y:0,z:0},builtin,`${rule.id}:${sizeClass}`);
    intensities.set(`${rule.id}:${sizeClass}`,intensity);candidateBudget+=intensity;
  }
  if(candidateBudget>2000000)throw new Error('Слишком плотная генерация ресурсов: более 2000000 кандидатов');
  // Bound expensive overrides before proposing points, including editor options and placers.
  const proposals=Math.min(2100000,Math.ceil(candidateBudget+10*Math.sqrt(candidateBudget)+64)),components=Math.max(1,...models.map(rule=>rule.components.length));
  const cost=proposals*(formulas.cost('mineralization.formation')+2*(formulas.cost('resources.mass')+formulas.cost('resources.depth'))+(components+1)*(formulas.cost('resources.grade')+formulas.cost('resources.access')));
  if(cost>MAX_FORMULA_OPERATIONS)throw new Error('Слишком большой расчёт формул ресурсов: упростите выражения или уменьшите плотность / число кандидатов');
  let actualCandidates=0;
  const addBody=(site,rule,sizeClass,rng,sourceId=null)=>{
    const {cell,position,formationScore}=site;
    const small=sizeClass==='occurrence',massScale=(small?resourceRules.occurrenceMassFactor:1)*resourceRules.massScale;
    // Log-uniform masses avoid making almost every body approach the upper tonnage bound.
    const massSample=rng(),depthSample=rng();
    let oreMassMt=rule.mass[0]*(rule.mass[1]/rule.mass[0])**massSample*massScale;
    let depthM=(rule.depth[0]+depthSample*(rule.depth[1]-rule.depth[0]))*resourceRules.depthScale;
    const p=site.position,variables=customBody?{latitudeDeg:Math.asin(p[1])*180/Math.PI,longitudeDeg:Math.atan2(p[2],p[0])*180/Math.PI,elevationM:grid.sampleField(geology.elevation,p),isOcean:0,season:-1,x:p[0],y:p[1],z:p[2],environmentScore:site.environmentScore,beltStrength:site.beltStrength,threshold:rule.threshold,isOccurrence:small?1:0,mineralId:rule.components[0].mineral,gradeDenominator:minerals[rule.components[0].mineral].gradeDenominator}:null;
    const formulaLabel=site.placementId??rule.id;
    if(formulas.has('resources.mass'))oreMassMt=formulas.evaluate('resources.mass',{...variables,minValue:rule.mass[0],maxValue:rule.mass[1],scale:massScale,sample:massSample},oreMassMt,formulaLabel);
    if(formulas.has('resources.depth'))depthM=formulas.evaluate('resources.depth',{...variables,minValue:rule.depth[0],maxValue:rule.depth[1],scale:resourceRules.depthScale,sample:depthSample},depthM,formulaLabel);
    const oreBodyId=bodyId++;
    let componentFraction=0;
    for(const c of rule.components) {
      const m=minerals[c.mineral],gradeSample=rng();let grade=(c.grade[0]+gradeSample*(c.grade[1]-c.grade[0]))*resourceRules.gradeScale;
      if(formulas.has('resources.grade'))grade=formulas.evaluate('resources.grade',{...variables,minValue:c.grade[0],maxValue:c.grade[1],scale:resourceRules.gradeScale,sample:gradeSample,mineralId:c.mineral,gradeDenominator:m.gradeDenominator},grade,`${formulaLabel}, ${m.name}`);
      componentFraction+=grade/m.gradeDenominator;
      let accessDifficulty=clamp(depthM/1600*0.45+clamp(atlas.slope[cell]/0.025,0,1)*0.25+clamp(geology.elevation[cell]/4500,0,1)*0.3,0,1);
      if(formulas.has('resources.access'))accessDifficulty=formulas.evaluate('resources.access',{...variables,depthM,slope:atlas.slope[cell]},accessDifficulty,formulaLabel);
      deposits.push({id:deposits.length,oreBodyId,cell,position,...pointCoordinates(position),placementId:site.placementId,provinceId:atlas.provinceId[cell],mineral:c.mineral,modelId:rule.id,environmentKey:rule.key,
        kind:rule.kind,reason:rule.reason,oreMinerals:m.oreMinerals,sizeClass,formationScore,environmentScore:site.environmentScore,beltStrength:site.beltStrength,depthM,grade,gradeUnit:m.unit,oreMassMt,
        containedResourceTonnes:oreMassMt*1e6*grade/m.gradeDenominator,resourceBasis:m.resourceBasis,
        accessDifficulty,
        discovered:false,exploited:false,economicStatus:'not-assessed',sourceDepositId:sourceId});
    }
    if(componentFraction>1+1e-10)throw new Error(`Содержание компонентов тела ${formulaLabel} превышает массу тела`);
  };
  // A thinned Poisson process samples equal physical area on the sphere, independent of grid cells.
  // Separate class streams and stable placement ids keep body parameters independent of iteration order.
  for(const rule of models) {
    const majorSpacing=options.majorSpacing??resourceRules.majorSpacing,minorSpacing=options.minorSpacing??resourceRules.minorSpacing;
    const majorIndex=proximityIndex(grid.radiusKm,majorSpacing),smallIndex=proximityIndex(grid.radiusKm,minorSpacing);
    for(const sizeClass of ['major','occurrence']) {
      const placement=random(`${config.seed}:points:${rule.id}:${sizeClass}`),intensity=intensities.get(`${rule.id}:${sizeClass}`);let time=0,ordinal=0;
      while((time+=-Math.log(1-placement()))<intensity) {
        if(++actualCandidates>2100000)throw new Error('Достигнут предел 2100000 попыток размещения ресурсов');
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
  const placer=resourceRules.placer,primaryGold=placer.enabled?deposits.filter(d=>d.mineral===1 && d.sizeClass==='major'):[];
  for(const source of primaryGold) {
    const rng=random(`${config.seed}:placer:${source.cell}`);let cell=source.cell,travelKm=0;const seen=new Set();
    while(water.downstream[cell]>=0 && travelKm<placer.maxTravelKm) {
      seen.add(cell);const next=water.downstream[cell];if(seen.has(next) || geology.elevation[next]<=0)break;
      travelKm+=grid.distance(cell,next);if(travelKm>placer.maxTravelKm)break;cell=next;
      if(travelKm>placer.minTravelKm && atlas.slope[cell]<placer.maxSlope && water.discharge[cell]>placer.minDischarge && rng()<placer.chance) {
        // One placer per receiving cell; avoids duplicating a downstream accumulation.
        const end=water.downstream[cell]>=0?grid.point(water.downstream[cell]):grid.point(cell);
        const position=interpolateArc(grid.point(cell),end,.05+rng()*.3);
        if(options.sitePredicate && !options.sitePredicate(position,{id:'gold-vein'}))continue;
        if(grid.sample(position)!==cell || grid.sampleField(geology.elevation,position)<=0)continue;
        if(!deposits.some(d=>d.modelId==='gold-placer' && d.cell===cell))addBody({cell,position,placementId:`placer:${source.placementId}`,formationScore:source.formationScore*.6,environmentScore:source.environmentScore,beltStrength:source.beltStrength},
          {id:'gold-placer',key:'hydrothermal',threshold:0,kind:'Золотая россыпь',reason:`Речной перенос из первичного источника №${source.id+1} и накопление на малом уклоне.`,depth:[placer.depthMin,placer.depthMax],mass:[placer.massMin,placer.massMax],components:[{mineral:1,grade:[placer.gradeMin,placer.gradeMax]}]},
          'occurrence',rng,source.id);
        break;
      }
    }
  }
  return deposits;
}
