import {clamp} from './grid.js';
import {hashSeed,fbm} from './random.js';
import {rocks,provinceTypes,minerals,hazardTypes} from './geology-catalog.js';
import {generateDeposits,depositModels} from './deposit-models.js';
import {buildMineralization,makeProspectivitySampler} from './mineralization.js';
import {makeGrid} from './grid.js';
import {pointCoordinates} from './spatial.js';
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
  progress?.('Геологические провинции и породы');
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
  const environments=Object.fromEntries([...new Set(depositModels.map(m=>m.key))].map(key=>[key,new Float64Array(n)]));
  const sedimentHistoryAgeMa=new Float64Array(n),ancientWetland=new Float64Array(n);
  for(let i=0;i<n;i++) {
    const h=geology.elevation[i],p=grid.point(i),continental=geology.crust[i]>0.52;
    const variation=fbm(...p,noiseSeed,5,3),history=fbm(...p,noiseSeed+173,3.8,3);
    for(const j of grid.neighbors(i))slope[i]=Math.max(slope[i],Math.abs(h-geology.elevation[j])/Math.max(1,grid.distance(i,j)*1000));
    const faultInfluence=faultDistanceKm[i]<1500?Math.exp(-faultDistanceKm[i]/220):0,magmaticInfluence=magmaticDistanceKm[i]<1500?Math.exp(-magmaticDistanceKm[i]/200):0;
    const compression=clamp(compressionMemory[i]/1800,0,1),extension=clamp(extensionMemory[i]/1400,0,1);
    const oldMagmatism=clamp(magmaticMemory[i],0,1);
    const basinScore=clamp((1-clamp((h+100)/1800,0,1))*0.5+(1-clamp(slope[i]/0.015,0,1))*0.3+(variation-0.35),0,1);
    // Basin history is seeded independently of today's climate. Coal/salt require a past environment.
    ancientWetland[i]=clamp((history-0.38)*4,0,1);
    sedimentHistoryAgeMa[i]=Math.min(geology.ageMa[i]*0.6,20+history*100);
    const strongRiver=water.discharge[i]>Math.max(450,water.outputM3s/900);
    let type;
    if(h<=0)type=continental && h>-1200?8:geology.boundary[i]===-1 && geology.ageMa[i]<50?1:0;
    else if(magmaticInfluence>0.45 && (faultInfluence>0.3 || oldMagmatism>0.15))type=4;
    else if(extension>0.2 || geology.boundary[i]===-1)type=5;
    else if(compression>0.18 || geology.uplift[i]>1700 || h>2400)type=3;
    else if(strongRiver && h<1000 && slope[i]<0.012)type=7;
    else if(basinScore>0.54 || (h<650 && coastDistanceKm[i]<350 && slope[i]<0.012))type=6;
    else type=2;
    provinceType[i]=type;
    const isBasin=[6,7,8].includes(type),pastMarine=history>0.49;
    sedimentThicknessM[i]=isBasin?250+basinScore*2800+variation*500:type===5?300+extension*1600:type===0?80+Math.min(geology.ageMa[i],200)*3:type===2 && variation>0.45?150+variation*500:0;
    let rock;
    if(type===0)rock=geology.ageMa[i]>100?11:0;
    else if(type===1)rock=0;
    else if(type===8)rock=pastMarine?6:11;
    else if(type===7)rock=7;
    else if(type===4)rock=continental?10:0;
    else if(type===3)rock=pastMarine && compression>0.4?9:variation>0.47?2:3;
    else if(type===6 || type===5)rock=history<0.39 && basinScore>0.65?8:pastMarine?6:variation>0.48?4:5;
    else rock=sedimentThicknessM[i]>0?(pastMarine?6:4):(variation>0.47?1:2);
    surfaceRock[i]=rock;
    const basementAge=Math.max(10,geology.ageMa[i]),young=rock===7?0.05:rock===11?1:rock===0 || rock===10?Math.max(0.3,basementAge*0.08):sedimentThicknessM[i]>0?sedimentHistoryAgeMa[i]*0.3:basementAge*0.7;
    const ages=[young,Math.max(young,basementAge*0.55),Math.max(young,basementAge*0.8),basementAge];
    const basement=continental?(compression>0.2?2:1):0;
    const sediment=sedimentThicknessM[i];
    const columnRocks=[rock,sediment>0?(pastMarine?6:4):rock,sediment>0?(pastMarine?5:4):basement,basement];
    const cover=rock===7?15+variation*80:rock===11?20+variation*100:Math.max(40,sediment>0?sediment*0.2:180+variation*300);
    const thickness=[cover,Math.max(100,sediment*0.45),Math.max(100,sediment*0.35),0];
    thickness[3]=Math.max(1000,12000-thickness[0]-thickness[1]-thickness[2]);
    for(let k=0;k<LAYER_COUNT;k++){layerRock[i*LAYER_COUNT+k]=columnRocks[k];layerThicknessM[i*LAYER_COUNT+k]=thickness[k];layerAgeMa[i*LAYER_COUNT+k]=ages[k];}
    surfaceAgeMa[i]=ages[0];
    if(h>0) {
      const properties=rocks[rock],rain=weather.precipitation[i],temp=weather.temperature[i];
      const warmth=clamp((temp+8)/22,0,1),moisture=clamp(rain/1000,0,1),stability=1-clamp(slope[i]/0.02,0,0.9);
      soilDepthM[i]=clamp((0.15+moisture*warmth*1.9+(type===7?1.2:0))*stability*(1-properties.resistance*0.35),0.03,4);
      const leaching=clamp((rain-1800)/2200,0,0.55),salinity=rock===8?0.75:0;
      fertility[i]=clamp((properties.nutrients*0.45+warmth*moisture*0.3+(type===7?0.25:0))*stability*(1-leaching)*(1-salinity),0,1);
      waterRetention[i]=clamp((1-properties.permeability)*0.5+soilDepthM[i]/6+moisture*0.2,0,1);
      aquiferPotential[i]=clamp(properties.permeability*moisture*(1-clamp(slope[i]/0.025,0,0.8)),0,1);
    }
    const boundaryStrength=clamp(Math.abs(geology.stress[i])/0.0012,0.1,1);
    hazards.earthquake[i]=clamp(faultInfluence*boundaryStrength,0,1);
    hazards.volcanic[i]=clamp(magmaticInfluence*0.85,0,1);
    if(h>0) {
      const steepness=clamp(slope[i]/0.02,0,1),wetness=clamp(weather.precipitation[i]/1800,0,1);
      hazards.landslide[i]=clamp(steepness*wetness*(1-rocks[rock].resistance*0.65),0,1);
      hazards.flood[i]=clamp(Math.log10(1+water.discharge[i])/5*(1-clamp(slope[i]/0.01,0,1))*(1-clamp(h/1800,0,1)),0,1);
      hazards.karst[i]=[6,9,8].includes(rock)?clamp(wetness*rocks[rock].permeability+wetness*0.15,0,1):0;
    }
    environments.hydrothermal[i]=h>0?clamp((magmaticInfluence*0.7+oldMagmatism*0.3)*(0.3+compression*0.5+faultInfluence*0.2),0,1):0;
    environments.felsic[i]=h>0 && continental && (rock===1 || basement===1)?clamp(0.18+oldMagmatism*0.5+magmaticInfluence*0.4,0,1):0;
    environments.iron[i]=h>0 && continental?clamp(compression*0.5+(isBasin?0.3:0)+(rock===2?0.25:0),0,1):0;
    environments.coal[i]=h>0 && isBasin && sedimentHistoryAgeMa[i]>20 && sediment>400?ancientWetland[i]:0;
    environments.evaporite[i]=h>0 && [5,6].includes(type) && rock===8?clamp((0.45-history)*8,0,1):0;
    if(h>0) {
      const intrusions=clamp(oldMagmatism*0.7+magmaticInfluence*0.5,0,1);
      // Intrusion chemistry and redox histories are explicit procedural proxies, not surface lithology.
      const chemistry=fbm(...p,noiseSeed+941,7,3),alkaline=fbm(...p,noiseSeed+619,5,3);
      const warmWet=clamp((weather.temperature[i]-5)/18,0,1)*clamp((weather.precipitation[i]-400)/1200,0,1);
      const stable=1-clamp(slope[i]/0.02,0,1),maturity=clamp(geology.ageMa[i]/180,0,1);
      environments.carbonateBasin[i]=continental && sediment>200 && columnRocks.includes(6)?clamp(0.3+faultInfluence*0.4+basinScore*0.3,0,1):0;
      environments.maficIntrusion[i]=clamp(intrusions*(continental?0.75:1)*(0.4+chemistry),0,1);
      environments.ultramafic[i]=clamp(intrusions*clamp((chemistry-0.38)*3,0,1)*(0.4+extension+compression*0.5),0,1);
      environments.ultramaficWeathering[i]=environments.ultramafic[i]*warmWet*stable;
      environments.marineBasin[i]=continental && sediment>250 && pastMarine?clamp(basinScore*0.5+history*0.5,0,1):0;
      environments.weatheredPlatform[i]=continental && [2,6].includes(type)?warmWet*stable*maturity:0;
      environments.sandstoneRedox[i]=continental && sediment>300 && columnRocks.includes(4)?clamp(0.2+ancientWetland[i]*0.5+history*0.2,0,1):0;
      environments.pegmatite[i]=environments.felsic[i]*clamp((chemistry-0.3)*2.5,0,1);
      environments.alkalineIntrusion[i]=continental && (extension>0.1 || type===5)?intrusions*clamp((alkaline-0.3)*3,0,1):0;
      environments.epithermal[i]=environments.hydrothermal[i]*(0.5+magmaticInfluence*0.5);
      environments.orogenicFluid[i]=continental?faultInfluence*clamp(compression+oldMagmatism*0.3,0,1):0;
      environments.metamorphicCarbon[i]=continental && type===3?compression*ancientWetland[i]:0;
    }
  }
  const {provinceId,provinces}=identifyProvinces(grid,provinceType,surfaceAgeMa);
  progress?.('Месторождения, почвы и природные опасности');
  const atlas={provinceType,provinceId,provinces,surfaceRock,surfaceAgeMa,sedimentThicknessM,slope,faultDistanceKm,magmaticDistanceKm,coastDistanceKm,
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
  const a=world.atlas,type=a.provinceType[cell],rock=rocks[a.surfaceRock[cell]],texts=[`${provinceTypes[type].name}: на поверхности — ${rock.name.toLowerCase()}.`];
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
  const errors=[];
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
    const mineral=minerals[d.mineral],model=depositModels.find(m=>m.id===d.modelId),expected=d.oreMassMt*1e6*d.grade/mineral.gradeDenominator;
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
