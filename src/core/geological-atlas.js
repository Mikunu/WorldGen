import {clamp} from './grid.js';
import {makeFormulaEvaluator,FORMULA_ENVIRONMENTS} from './generation-formulas.js';
import {hashSeed,fbm} from './random.js';
import {provinceTypes,minerals,hazardTypes} from './geology-catalog.js';
import {generateDeposits} from './deposit-models.js';
import {buildMineralization,makeProspectivitySampler} from './mineralization.js';
import {makeGrid} from './grid.js';
import {pointCoordinates} from './spatial.js';
import {baseDepositModels,effectiveDepositModels,effectiveRocks,resolveAtlasRules} from './atlas-rules.js';
export {generateDeposits} from './deposit-models.js';

export const LAYER_COUNT=4;

// Multi-source shortest paths use spherical edge distances (including the map seam).
export function distanceField(grid,sources,limitKm=1500) {
  const distance=new Float64Array(grid.size).fill(limitKm),heap=[];
  const push=(id,d)=>{let k=heap.length;heap.push([id,d]);while(k){const p=(k-1)>>1;if(heap[p][1]<=d)break;heap[k]=heap[p];k=p;}heap[k]=[id,d];};
  const pop=()=>{const first=heap[0],tail=heap.pop();if(heap.length){let k=0;while(k*2+1<heap.length){let j=k*2+1;if(j+1<heap.length && heap[j+1][1]<heap[j][1])j++;if(heap[j][1]>=tail[1])break;heap[k]=heap[j];k=j;}heap[k]=tail;}return first;};
  for(let i=0;i<grid.size;i++)if(sources[i]){distance[i]=0;push(i,0);}
  while(heap.length){const [i,d]=pop();if(d!==distance[i])continue;for(const j of grid.neighbors(i)){const next=d+grid.distance(i,j);if(next<distance[j]){distance[j]=next;push(j,next);}}}
  return distance;
}

export function geologicalAtlas(grid,geology,weather,water,config,progress) {
  const formulas=makeFormulaEvaluator(config,config.seed),custom=Object.keys(config.generationRules?.formulas?.expressions??{}).some(id=>id.startsWith('soils.')||id.startsWith('hazards.')||id.startsWith('geology.'));
  progress?.('Геологические провинции и породы');
  const rules=resolveAtlasRules(config),g=rules.geology,soil=rules.soils,hazard=rules.hazards,rocks=effectiveRocks(rules);
  const n=grid.size,noiseSeed=hashSeed(config.seed+':atlas');
  const faultSources=Uint8Array.from(geology.boundary,b=>b!==0),magmaticSources=Uint8Array.from(geology.volcanism,v=>v>0.1);
  const coastSources=new Uint8Array(n);
  for(let i=0;i<n;i++)if(grid.neighbors(i).some(j=>(geology.elevation[j]>0)!==(geology.elevation[i]>0)))coastSources[i]=1;
  const faultDistanceKm=distanceField(grid,faultSources),magmaticDistanceKm=distanceField(grid,magmaticSources),coastDistanceKm=distanceField(grid,coastSources);
  const provinceType=new Uint8Array(n),surfaceRock=new Uint8Array(n),surfaceAgeMa=new Float64Array(n),sedimentThicknessM=new Float64Array(n),slope=new Float64Array(n);
  const layerRock=new Uint8Array(n*LAYER_COUNT),layerThicknessM=new Float64Array(n*LAYER_COUNT),layerAgeMa=new Float64Array(n*LAYER_COUNT);
  const soilDepthM=new Float64Array(n),fertility=new Float64Array(n),waterRetention=new Float64Array(n),aquiferPotential=new Float64Array(n);
  const hazards=Object.fromEntries(hazardTypes.map(h=>[h.id,new Float64Array(n)]));
  const compressionMemory=geology.compressionMemory??new Float64Array(n),extensionMemory=geology.extensionMemory??new Float64Array(n),magmaticMemory=geology.magmaticMemory??new Float64Array(n);
  const environments=Object.fromEntries([...new Set(baseDepositModels.map(m=>m.key))].map(key=>[key,new Float64Array(n)]));
  const sedimentHistoryAgeMa=new Float64Array(n),ancientWetland=new Float64Array(n);
  for(let i=0;i<n;i++) {
    const h=geology.elevation[i],p=grid.point(i),continental=geology.crust[i]>g.continentalCrustThreshold;
    const variation=fbm(...p,noiseSeed,5,3),history=fbm(...p,noiseSeed+173,3.8,3);
    for(const j of grid.neighbors(i))slope[i]=Math.max(slope[i],Math.abs(h-geology.elevation[j])/Math.max(1,grid.distance(i,j)*1000));
    const faultInfluence=faultDistanceKm[i]<g.faultInfluenceLimitKm?Math.exp(-faultDistanceKm[i]/g.faultDecayKm):0,magmaticInfluence=magmaticDistanceKm[i]<g.magmaticInfluenceLimitKm?Math.exp(-magmaticDistanceKm[i]/g.magmaticDecayKm):0;
    const compression=clamp(compressionMemory[i]/g.compressionMemoryM,0,1),extension=clamp(extensionMemory[i]/g.extensionMemoryM,0,1);
    const oldMagmatism=clamp(magmaticMemory[i],0,1);
    const basinScore=clamp((1-clamp((h+g.basinDepthOffsetM)/g.basinDepthScaleM,0,1))*g.basinElevationFactor+(1-clamp(slope[i]/g.basinSlopeScale,0,1))*g.basinSlopeFactor+(variation-g.basinVariationOffset),0,1);
    // Basin history is seeded independently of today's climate. Coal/salt require a past environment.
    ancientWetland[i]=clamp((history-0.38)*4,0,1);
    sedimentHistoryAgeMa[i]=Math.min(geology.ageMa[i]*0.6,20+history*100);
    const strongRiver=water.discharge[i]>Math.max(450,water.outputM3s/900);
    let type;
    if(h<=0)type=continental && h>g.shelfMinElevationM?8:geology.boundary[i]===-1 && geology.ageMa[i]<g.youngOceanAgeMa?1:0;
    else if(magmaticInfluence>g.magmaticProvinceInfluence && (faultInfluence>g.magmaticProvinceFault || oldMagmatism>g.magmaticProvinceMemory))type=4;
    else if(extension>g.riftExtension || geology.boundary[i]===-1)type=5;
    else if(compression>g.foldCompression || geology.uplift[i]>g.upliftM || h>g.highlandM)type=3;
    else if(strongRiver && h<g.alluvialElevationM && slope[i]<g.alluvialSlope)type=7;
    else if(basinScore>g.basinThreshold || (h<g.coastalBasinElevationM && coastDistanceKm[i]<g.coastalBasinDistanceKm && slope[i]<g.basinSlope))type=6;
    else type=2;
    provinceType[i]=type;
    const isBasin=[6,7,8].includes(type),pastMarine=history>0.49;
    sedimentThicknessM[i]=isBasin?g.sedimentBasinBaseM+basinScore*g.sedimentBasinScoreM+variation*g.sedimentVariationM:type===5?g.sedimentRiftBaseM+extension*g.sedimentRiftExtensionM:type===0?g.sedimentOceanBaseM+Math.min(geology.ageMa[i],200)*g.sedimentOceanAgeFactor:type===2 && variation>g.platformSedimentVariation?g.platformSedimentBaseM+variation*g.sedimentVariationM:0;
    const formulaVariables=custom?{latitudeDeg:grid.latitude[i]*180/Math.PI,longitudeDeg:Math.atan2(p[2],p[0])*180/Math.PI,elevationM:h,isOcean:h<=0?1:0,season:-1,x:p[0],y:p[1],z:p[2],temperatureC:weather.temperature[i],precipitationMm:weather.precipitation[i],slope:slope[i],ageMa:geology.ageMa[i],dischargeM3s:water.discharge[i],provinceTypeId:type,isContinental:continental?1:0,faultInfluence,magmaticInfluence,compression,extension,oldMagmatism,basinScore,history,ancientWetland:ancientWetland[i]}:null;
    if(formulas.has('geology.sediments'))sedimentThicknessM[i]=formulas.evaluate('geology.sediments',formulaVariables,sedimentThicknessM[i],`ячейка ${i}`);
    let rock;
    if(type===0)rock=geology.ageMa[i]>100?11:0;
    else if(type===1)rock=0;
    else if(type===8)rock=pastMarine?6:11;
    else if(type===7)rock=7;
    else if(type===4)rock=continental?10:0;
    else if(type===3)rock=pastMarine && compression>0.4?9:variation>0.47?2:3;
    else if(type===6 || type===5)rock=history<g.rockEvaporiteHistory && basinScore>g.rockEvaporiteBasin?8:pastMarine?6:variation>g.rockSedimentaryVariation?4:5;
    else rock=sedimentThicknessM[i]>0?(pastMarine?6:4):(variation>0.47?1:2);
    surfaceRock[i]=rock;
    const basementAge=Math.max(10,geology.ageMa[i]),young=rock===7?0.05:rock===11?1:rock===0 || rock===10?Math.max(0.3,basementAge*0.08):sedimentThicknessM[i]>0?sedimentHistoryAgeMa[i]*0.3:basementAge*0.7;
    const ages=[young,Math.max(young,basementAge*0.55),Math.max(young,basementAge*0.8),basementAge];
    const basement=continental?(compression>0.2?2:1):0;
    const sediment=sedimentThicknessM[i];
    const columnRocks=[rock,sediment>0?(pastMarine?6:4):rock,sediment>0?(pastMarine?5:4):basement,basement];
    const cover=rock===7?g.columnCoverAlluvialM+variation*g.columnCoverAlluvialVariationM:rock===11?g.columnCoverMarineM+variation*g.columnCoverMarineVariationM:Math.max(g.columnCoverMinimumM,sediment>0?sediment*0.2:180+variation*300);
    const thickness=[cover,Math.max(100,sediment*0.45),Math.max(100,sediment*0.35),0];
    // The user-selected column depth is exact.  At shallow custom depths the
    // cover is proportionally compressed, retaining every positive layer.
    const upperTotal=thickness[0]+thickness[1]+thickness[2],maximumUpper=Math.max(0,g.columnDepthM-1);
    if(upperTotal>maximumUpper)for(let k=0;k<3;k++)thickness[k]*=maximumUpper/upperTotal;
    thickness[3]=g.columnDepthM-thickness[0]-thickness[1]-thickness[2];
    for(let k=0;k<LAYER_COUNT;k++){layerRock[i*LAYER_COUNT+k]=columnRocks[k];layerThicknessM[i*LAYER_COUNT+k]=thickness[k];layerAgeMa[i*LAYER_COUNT+k]=ages[k];}
    surfaceAgeMa[i]=ages[0];
    if(custom)Object.assign(formulaVariables,{surfaceRockId:rock,sedimentThicknessM:sediment,soilDepthM:0,nutrients:rocks[rock].nutrients,resistance:rocks[rock].resistance,permeability:rocks[rock].permeability});
    if(h>0) {
      const properties=rocks[rock],rain=weather.precipitation[i],temp=weather.temperature[i];
      const warmth=clamp((temp+8)/22,0,1),moisture=clamp(rain/1000,0,1),stability=1-clamp(slope[i]/0.02,0,0.9);
      soilDepthM[i]=clamp((soil.baseDepthM+moisture*warmth*soil.climateDepthM+(type===7?soil.alluvialDepthM:0))*stability*(1-properties.resistance*soil.resistancePenalty),soil.minDepthM,soil.maxDepthM);
      const leaching=clamp((rain-soil.leachingRainMm)/soil.leachingRangeMm,0,0.55),salinity=rock===8?0.75:0;
      if(custom)Object.assign(formulaVariables,{warmth,moisture,stability,leaching,salinity,soilDepthM:soilDepthM[i]});
      if(formulas.has('soils.depth'))soilDepthM[i]=formulas.evaluate('soils.depth',formulaVariables,soilDepthM[i],`ячейка ${i}`);
      if(custom)formulaVariables.soilDepthM=soilDepthM[i];
      fertility[i]=clamp((properties.nutrients*soil.fertilityRockFactor+warmth*moisture*soil.fertilityClimateFactor+(type===7?soil.alluvialFertility:0))*stability*(1-leaching)*(1-salinity),0,1);
      if(formulas.has('soils.fertility'))fertility[i]=formulas.evaluate('soils.fertility',formulaVariables,fertility[i],`ячейка ${i}`);
      waterRetention[i]=clamp((1-properties.permeability)*soil.retentionRockFactor+soilDepthM[i]/soil.retentionSoilDivisor+moisture*soil.retentionClimateFactor,0,1);
      if(formulas.has('soils.retention'))waterRetention[i]=formulas.evaluate('soils.retention',formulaVariables,waterRetention[i],`ячейка ${i}`);
      aquiferPotential[i]=clamp(properties.permeability*moisture*(1-clamp(slope[i]/soil.aquiferSlope,0,0.8)),0,1);
      if(formulas.has('soils.aquifer'))aquiferPotential[i]=formulas.evaluate('soils.aquifer',formulaVariables,aquiferPotential[i],`ячейка ${i}`);
    }
    const boundaryStrength=clamp(Math.abs(geology.stress[i])/hazard.stressScale,0.1,1);
    hazards.earthquake[i]=clamp(faultInfluence*boundaryStrength,0,1);
    hazards.volcanic[i]=clamp(magmaticInfluence*hazard.volcanicScale,0,1);
    if(custom&&h<=0)Object.assign(formulaVariables,{warmth:0,moisture:0,stability:0,leaching:0,salinity:0});
    if(h>0) {
      const steepness=clamp(slope[i]/hazard.landslideSlope,0,1),wetness=clamp(weather.precipitation[i]/hazard.landslideRainMm,0,1);
      hazards.landslide[i]=clamp(steepness*wetness*(1-rocks[rock].resistance*hazard.landslideResistancePenalty),0,1);
      hazards.flood[i]=clamp(Math.log10(1+water.discharge[i])/hazard.floodLogScale*(1-clamp(slope[i]/hazard.floodSlope,0,1))*(1-clamp(h/hazard.floodElevationM,0,1)),0,1);
      hazards.karst[i]=[6,9,8].includes(rock)?clamp(wetness*rocks[rock].permeability+wetness*hazard.karstBase,0,1):0;
    }
    environments.hydrothermal[i]=h>0?clamp((magmaticInfluence*g.hydrothermalMagmaticFactor+oldMagmatism*g.hydrothermalMemoryFactor)*(g.hydrothermalBase+compression*g.hydrothermalCompressionFactor+faultInfluence*g.hydrothermalFaultFactor),0,1):0;
    environments.felsic[i]=h>0 && continental && (rock===1 || basement===1)?clamp(g.felsicBase+oldMagmatism*g.felsicMemoryFactor+magmaticInfluence*g.felsicMagmaticFactor,0,1):0;
    environments.iron[i]=h>0 && continental?clamp(compression*g.ironCompressionFactor+(isBasin?g.ironBasinFactor:0)+(rock===2?g.ironGneissFactor:0),0,1):0;
    environments.coal[i]=h>0 && isBasin && sedimentHistoryAgeMa[i]>g.environmentHistoryCoalMa && sediment>g.environmentCoalM?ancientWetland[i]:0;
    environments.evaporite[i]=h>0 && [5,6].includes(type) && rock===8?clamp((0.45-history)*8,0,1):0;
    if(h>0) {
      const intrusions=clamp(oldMagmatism*0.7+magmaticInfluence*0.5,0,1);
      // Intrusion chemistry and redox histories are explicit procedural proxies, not surface lithology.
      const chemistry=fbm(...p,noiseSeed+941,7,3),alkaline=fbm(...p,noiseSeed+619,5,3);
      const warmWet=clamp((weather.temperature[i]-5)/18,0,1)*clamp((weather.precipitation[i]-400)/1200,0,1);
      const stable=1-clamp(slope[i]/0.02,0,1),maturity=clamp(geology.ageMa[i]/180,0,1);
      environments.carbonateBasin[i]=continental && sediment>g.environmentSedimentCarbonateM && columnRocks.includes(6)?clamp(0.3+faultInfluence*0.4+basinScore*0.3,0,1):0;
      environments.maficIntrusion[i]=clamp(intrusions*(continental?0.75:1)*(0.4+chemistry),0,1);
      environments.ultramafic[i]=clamp(intrusions*clamp((chemistry-0.38)*3,0,1)*(0.4+extension+compression*0.5),0,1);
      environments.ultramaficWeathering[i]=environments.ultramafic[i]*warmWet*stable;
      environments.marineBasin[i]=continental && sediment>g.environmentSedimentMarineM && pastMarine?clamp(basinScore*0.5+history*0.5,0,1):0;
      environments.weatheredPlatform[i]=continental && [2,6].includes(type)?warmWet*stable*maturity:0;
      environments.sandstoneRedox[i]=continental && sediment>g.environmentSedimentSandstoneM && columnRocks.includes(4)?clamp(0.2+ancientWetland[i]*0.5+history*0.2,0,1):0;
      environments.pegmatite[i]=environments.felsic[i]*clamp((chemistry-0.3)*2.5,0,1);
      environments.alkalineIntrusion[i]=continental && (extension>0.1 || type===5)?intrusions*clamp((alkaline-0.3)*3,0,1):0;
      environments.epithermal[i]=environments.hydrothermal[i]*(0.5+magmaticInfluence*0.5);
      environments.orogenicFluid[i]=continental?faultInfluence*clamp(compression+oldMagmatism*0.3,0,1):0;
      environments.metamorphicCarbon[i]=continental && type===3?compression*ancientWetland[i]:0;
    }
    if(custom) {
      for(const kind of hazardTypes)if((h>0||['earthquake','volcanic'].includes(kind.id))&&formulas.has(`hazards.${kind.id}`))hazards[kind.id][i]=formulas.evaluate(`hazards.${kind.id}`,formulaVariables,hazards[kind.id][i],`ячейка ${i}`);
      if(h>0&&formulas.has('geology.environment'))for(const [environmentId,key] of FORMULA_ENVIRONMENTS.entries())environments[key][i]=formulas.evaluate('geology.environment',{...formulaVariables,environmentId},environments[key][i],`ячейка ${i}, среда ${key}`);
    }
  }
  const {provinceId,provinces}=identifyProvinces(grid,provinceType,surfaceAgeMa);
  progress?.('Месторождения, почвы и природные опасности');
  const atlas={generationRules:config.generationRules??rules,provinceType,provinceId,provinces,surfaceRock,surfaceAgeMa,sedimentThicknessM,slope,faultDistanceKm,magmaticDistanceKm,coastDistanceKm,
    layerCount:LAYER_COUNT,layerRock,layerThicknessM,layerAgeMa,soilDepthM,fertility,waterRetention,aquiferPotential,hazards,environments,sedimentHistoryAgeMa,ancientWetland};
  atlas.spatialGrid={width:grid.width,height:grid.height,radiusKm:grid.radiusKm};
  atlas.mineralization=buildMineralization(grid,geology,atlas,config.seed);
  atlas.deposits=generateDeposits(grid,geology,water,atlas,config);
  atlas.depositsByCell=Array.from({length:n},()=>[]);
  atlas.deposits.forEach(d=>atlas.depositsByCell[d.cell].push(d.id));
  return atlas;
}

function identifyProvinces(grid,type,age) {
  const provinceId=new Int32Array(grid.size).fill(-1),provinces=[];
  for(let start=0;start<grid.size;start++) {
    if(provinceId[start]>=0)continue;
    const id=provinces.length,queue=[start];provinceId[start]=id;
    let area=0,ageSum=0;
    for(let k=0;k<queue.length;k++) {
      const i=queue[k];area+=grid.areaKm2[i];ageSum+=age[i]*grid.areaKm2[i];
      for(const j of grid.neighbors(i))if(provinceId[j]<0 && type[j]===type[start]){provinceId[j]=id;queue.push(j);}
    }
    provinces.push({id,type:type[start],name:`${provinceTypes[type[start]].name} ${id+1}`,areaKm2:area,meanSurfaceAgeMa:ageSum/area,cells:queue.length,representativeCell:start});
  }
  return {provinceId,provinces};
}

export function geologicalColumn(atlas,cell) {
  if(!Number.isInteger(cell) || cell<0 || cell>=atlas.surfaceRock.length)throw new RangeError('Некорректная ячейка геологической колонки');
  let depth=0;const layers=[];
  for(let k=0;k<atlas.layerCount;k++) {
    const index=cell*atlas.layerCount+k,thickness=atlas.layerThicknessM[index];
    layers.push({rock:atlas.layerRock[index],topM:depth,bottomM:depth+thickness,ageMa:atlas.layerAgeMa[index]});depth+=thickness;
  }
  return layers;
}
export function atlasExplanation(world,cell) {
  const a=world.atlas,type=a.provinceType[cell],rock=effectiveRocks(a.generationRules)[a.surfaceRock[cell]],texts=[`${provinceTypes[type].name}: на поверхности — ${rock.name.toLowerCase()}.`];
  if(type===3)texts.push('Породы связаны с накопленным сжатием и поднятием; часть материала преобразована метаморфизмом.');
  if(type===4)texts.push('Близость магматических центров повышает вероятность гидротермальной минерализации.');
  if([6,7,8].includes(type))texts.push(`Осадочная толща около ${Math.round(a.sedimentThicknessM[cell])} м; модель использует отдельное поле древней среды накопления.`);
  if(type===5)texts.push('Растяжение коры создаёт условия для рифтового бассейна и накопления осадков.');
  if(type===2)texts.push('Здесь нет сильного текущего поднятия; обнажается фундамент или сохранившийся осадочный покров.');
  if(world.geology.elevation[cell]>0)texts.push('Почва зависит от породы, осадков, температуры и устойчивости склонов.');
  texts.push('Колонка — процедурная реконструкция; оценки опасностей выражены относительными индексами.');
  return texts.join(' ');
}

export function validateAtlas(atlas,n,geology,water) {
  const errors=[],rules=resolveAtlasRules(atlas.generationRules),rocks=effectiveRocks(rules),models=effectiveDepositModels(rules);
  for(const key of ['surfaceRock','provinceType','provinceId','surfaceAgeMa','sedimentThicknessM','fertility','soilDepthM','waterRetention','aquiferPotential','slope']) {
    const a=atlas[key];if(a.length!==n || a.some(x=>!Number.isFinite(x) || x<0))errors.push(`Некорректный слой атласа ${key}`);
  }
  for(let i=0;i<n;i++) {
    if(!rocks[atlas.surfaceRock[i]] || !provinceTypes[atlas.provinceType[i]] || !atlas.provinces[atlas.provinceId[i]]){errors.push(`Некорректная геологическая категория ${i}`);break;}
    const layers=geologicalColumn(atlas,i);
    if(layers.some((l,k)=>!Number.isFinite(l.bottomM) || l.bottomM<=l.topM || !rocks[l.rock] || !Number.isFinite(l.ageMa) || l.ageMa<0 || (k && l.ageMa<layers[k-1].ageMa))){errors.push(`Некорректная колонка ${i}`);break;}
    if(layers[0].rock!==atlas.surfaceRock[i]){errors.push(`Колонка не согласована с поверхностью ${i}`);break;}
    if([atlas.fertility[i],atlas.waterRetention[i],atlas.aquiferPotential[i],...Object.values(atlas.hazards).map(a=>a[i])].some(x=>!Number.isFinite(x) || x<0 || x>1)){errors.push(`Индекс вне диапазона ${i}`);break;}
    if(geology.elevation[i]<=0 && (atlas.fertility[i]!==0 || atlas.soilDepthM[i]!==0)){errors.push(`Почва на океанском дне ${i}`);break;}
  }
  const shape=atlas.spatialGrid;
  if(!shape || shape.width*shape.height!==n || !Number.isFinite(shape.radiusKm) || shape.radiusKm<=0){errors.push('Некорректная геометрия атласа');return errors;}
  const grid=makeGrid(shape.width,shape.height,shape.radiusKm),sampler=makeProspectivitySampler(grid,geology,atlas);
  const bodies=new Map(),componentKeys=new Set(),fractions=new Map();
  for(const [index,d] of atlas.deposits.entries()) {
    const authored=d.provenance==='authored';
    if((d.locked!==undefined&&typeof d.locked!=='boolean')||(d.provenance!==undefined&&!['generated','edited','authored'].includes(d.provenance))||['name','description','tags','exceptionReason'].some(key=>d[key]!==undefined&&typeof d[key]!=='string')){errors.push(`Некорректные авторские данные ${d.id}`);break;}
    if(authored && (typeof d.exceptionReason!=='string' || !d.exceptionReason.trim())){errors.push(`Авторская залежь без пояснения ${d.id}`);break;}
    if(!minerals[d.mineral] || !Number.isInteger(d.cell) || d.cell<0 || d.cell>=n || (!authored && geology.elevation[d.cell]<=0) || [d.grade,d.depthM,d.oreMassMt,d.containedResourceTonnes].some(x=>!Number.isFinite(x)||x<=0)){errors.push(`Некорректное месторождение ${d.id}`);break;}
    const mineral=minerals[d.mineral],model=models.find(m=>m.id===d.modelId),expected=d.oreMassMt*1e6*d.grade/mineral.gradeDenominator;
    const p=d.position;
    if(!Array.isArray(p) || p.length!==3 || p.some(v=>!Number.isFinite(v)) || Math.abs(Math.hypot(...p)-1)>1e-10 || grid.sample(p)!==d.cell || (!authored && grid.sampleField(geology.elevation,p)<=0)){errors.push(`Некорректная позиция месторождения ${d.id}`);break;}
    const coords=pointCoordinates(p);
    if(!Number.isFinite(d.latitudeDeg) || !Number.isFinite(d.longitudeDeg) || Math.abs(coords.latitudeDeg-d.latitudeDeg)>1e-9 || Math.abs(coords.longitudeDeg-d.longitudeDeg)>1e-9 || [d.formationScore,d.environmentScore,d.beltStrength].some(v=>!Number.isFinite(v) || v<0 || v>1)){errors.push(`Некорректные координаты или потенциал месторождения ${d.id}`);break;}
    if(d.id!==index || !Number.isInteger(d.oreBodyId) || d.oreBodyId<0 || !['major','occurrence'].includes(d.sizeClass) || d.gradeUnit!==mineral.unit || d.resourceBasis!==mineral.resourceBasis || Math.abs(d.containedResourceTonnes/expected-1)>1e-10 || (mineral.gradeDenominator===100 && d.grade>100) || d.discovered!==false || d.exploited!==false || d.economicStatus!=='not-assessed' || d.provinceId!==atlas.provinceId[d.cell]){errors.push(`Некорректные данные месторождения ${d.id}`);break;}
    const body=bodies.get(d.oreBodyId),componentKey=`${d.oreBodyId}:${d.mineral}`;
    if(componentKeys.has(componentKey) || (body && (['cell','oreMassMt','depthM','sizeClass','modelId','placementId','locked','name','description','tags','provenance','exceptionReason'].some(key=>body[key]!==d[key]) || body.position.some((v,k)=>v!==p[k])))){errors.push(`Несогласованное рудное тело ${d.oreBodyId}`);break;}
    bodies.set(d.oreBodyId,d);componentKeys.add(componentKey);
    fractions.set(d.oreBodyId,(fractions.get(d.oreBodyId)??0)+d.grade/mineral.gradeDenominator);
    if(d.sourceDepositId===null && !authored) {
      const expectedScore=model?sampler.sample(model,p):null;
      if(!model || !model.components.some(c=>c.mineral===d.mineral) || d.environmentKey!==model.key || expectedScore.environmentScore<model.threshold || ['environmentScore','formationScore','beltStrength'].some(key=>Math.abs(d[key]-expectedScore[key])>1e-12)){errors.push(`Нарушены условия образования месторождения ${d.id}`);break;}
    }
    if(d.sourceDepositId!==null && !authored) {
      const source=atlas.deposits[d.sourceDepositId];let i=source?.cell,steps=0;
      while(i!==undefined && i!==d.cell && i>=0 && steps++<n)i=water.downstream[i];
      if(!source || source.sourceDepositId!==null || source.mineral!==1 || d.mineral!==1 || d.modelId!=='gold-placer' || d.sizeClass!=='occurrence' || i!==d.cell){errors.push(`Россыпь без источника выше по стоку ${d.id}`);break;}
    }
  }
  for(const [bodyId,fraction] of fractions) {
    if(fraction>1+1e-10){errors.push(`Содержание компонентов превышает массу тела ${bodyId}`);break;}
  }
  return errors;
}
