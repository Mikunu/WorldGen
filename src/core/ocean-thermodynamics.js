import {clamp} from './grid.js';

export const THERMODYNAMIC_MODEL_VERSION='two-layer-thermohaline-1';
export const THERMODYNAMIC_FIELDS=Object.freeze(['salinityPsu','densityKgM3','deepTemperatureC','deepSalinityPsu','deepDensityKgM3','deepEastMps','deepNorthMps','deepSpeedMps','verticalVelocityMps','deepMask']);

const leaf=(defaultValue,min,max,label,integer=false)=>integer?{default:defaultValue,min,max,label,integer:true}:{default:defaultValue,min,max,label};
export const oceanThermodynamicRuleSchema={
  thermodynamicsEnabled:{default:true,label:'Включить термохалинную циркуляцию'},
  referenceSalinityPsu:leaf(35,0,50,'Опорная солёность, PSU'),
  freshwaterSalinityRangePsu:leaf(2,0,8,'Предельная аномалия солёности, PSU'),
  surfaceLayerDepthM:leaf(200,20,1000,'Толщина поверхностного слоя, м'),
  deepMinimumDepthM:leaf(700,100,10000,'Минимальная глубина глубокого слоя, м'),
  deepTemperatureOffsetC:leaf(8,0,30,'Охлаждение глубокого слоя, °C'),
  deepSalinityOffsetPsu:leaf(.2,-5,5,'Смещение глубинной солёности, PSU'),
  overturningStrengthMps:leaf(2e-5,0,1e-4,'Сила опрокидывания, м/с'),
  densityContrastScaleKgM3:leaf(1,.05,10,'Масштаб контраста плотности, кг/м³'),
  maxDeepCurrentMps:leaf(.2,.01,1,'Максимальная глубинная скорость, м/с'),
  thermodynamicSteps:leaf(12,1,64,'Шаги термохалинного переноса',true),
  verticalExchangeCourant:leaf(.15,0,.4,'Доля обмена между слоями'),
  deepLateralMixing:leaf(.02,0,.25,'Глубинное боковое перемешивание'),
  surfaceFeedback:leaf(.6,0,1,'Воздействие глубинного тепла на поверхность')
};

const HARD_MAX_VERTICAL_MPS=1e-4;
const RHO_REFERENCE=1027;
const THERMAL_EXPANSION=2e-4;
const HALINE_CONTRACTION=7.6e-4;

// A transparent linear potential-density approximation around 10 °C / 35 PSU.
// Pressure is deliberately absent: buoyancy compares both layers at one
// reference pressure rather than making every deep cell dense by construction.
export function potentialDensityKgM3(temperatureC,salinityPsu) {
  return RHO_REFERENCE*(1-THERMAL_EXPANSION*(temperatureC-10)+HALINE_CONTRACTION*(salinityPsu-35));
}

export function emptyThermodynamics(size,enabled=false) {
  return {thermodynamicsEnabled:enabled,thermodynamicsModelVersion:THERMODYNAMIC_MODEL_VERSION,salinityPsu:new Float64Array(size),densityKgM3:new Float64Array(size),deepTemperatureC:new Float64Array(size),deepSalinityPsu:new Float64Array(size),deepDensityKgM3:new Float64Array(size),deepEastMps:new Float64Array(size),deepNorthMps:new Float64Array(size),deepSpeedMps:new Float64Array(size),verticalVelocityMps:new Float64Array(size),deepMask:new Uint8Array(size),thermodynamicDiagnostics:{deepCells:0,deepBasinCount:0,heatStepSeconds:0,maximumBasinVerticalImbalanceM3s:0,heatMeanBeforeC:0,heatMeanAfterC:0,salinityMeanBeforePsu:0,salinityMeanAfterPsu:0,rawReconstructedMaximumMps:0,rawEdgeMaximumMps:0,currentLimitScale:1,transportCourantScale:1}};
}

function topologyFor(mask,edges,size) {
  const adjacency=Array.from({length:size},()=>[]),deepEdges=[];
  for(const source of edges)if(mask[source.a]&&mask[source.b]) {
    const edge={...source,flux:0,crossSectionM2:source.faceLengthM};
    const id=deepEdges.length;deepEdges.push(edge);adjacency[edge.a].push(id);adjacency[edge.b].push(id);
  }
  const components=[],seen=new Uint8Array(size),parent=new Int32Array(size).fill(-1),parentEdge=new Int32Array(size).fill(-1);
  for(let start=0;start<size;start++)if(mask[start]&&!seen[start]) {
    const cells=[],queue=[start];seen[start]=1;
    for(let k=0;k<queue.length;k++) {
      const i=queue[k];cells.push(i);
      for(const edgeId of adjacency[i]) {const edge=deepEdges[edgeId],j=edge.a===i?edge.b:edge.a;if(!seen[j]){seen[j]=1;parent[j]=i;parentEdge[j]=edgeId;queue.push(j);}}
    }
    components.push({cells,root:start});
  }
  return {edges:deepEdges,adjacency,components,parent,parentEdge};
}

function enforceDivergence(topology,target,iterations) {
  const {edges,adjacency,components,parent,parentEdge}=topology,size=target.length,current=new Float64Array(size),potential=new Float64Array(size);
  for(const edge of edges){current[edge.a]+=edge.flux;current[edge.b]-=edge.flux;}
  const needed=Float64Array.from(target,(value,i)=>value-current[i]);
  for(let pass=0;pass<iterations;pass++)for(const component of components) {
    for(const i of component.cells) {
      let sum=0,weight=0;
      for(const edgeId of adjacency[i]) {const edge=edges[edgeId],j=edge.a===i?edge.b:edge.a;sum+=edge.conductance*potential[j];weight+=edge.conductance;}
      if(weight)potential[i]+=.72*((needed[i]+sum)/weight-potential[i]);
    }
    const offset=potential[component.root];for(const i of component.cells)potential[i]-=offset;
  }
  for(const edge of edges)edge.flux+=edge.conductance*(potential[edge.a]-potential[edge.b]);
  const residual=Float64Array.from(target);
  for(const edge of edges){residual[edge.a]-=edge.flux;residual[edge.b]+=edge.flux;}
  for(const component of components)for(let k=component.cells.length-1;k>0;k--) {
    const i=component.cells[k],edge=edges[parentEdge[i]],amount=residual[i];
    if(edge.a===i)edge.flux+=amount;else edge.flux-=amount;
    residual[parent[i]]+=amount;residual[i]=0;
  }
  return residual;
}

function reconstruct(grid,mask,topology,limit) {
  const eastMps=new Float64Array(grid.size),northMps=new Float64Array(grid.size),speedMps=new Float64Array(grid.size);
  const calculate=()=>{
    let maximum=0,edgeMaximum=0,limitingCell=-1;
    for(const edge of topology.edges)edgeMaximum=Math.max(edgeMaximum,Math.abs(edge.flux)/edge.crossSectionM2);
    for(let i=0;i<grid.size;i++)if(mask[i]) {
      let xx=0,xy=0,yy=0,bx=0,by=0;
      for(const edgeId of topology.adjacency[i]) {
        const edge=topology.edges[edgeId],atA=edge.a===i,q=(atA?edge.flux:-edge.flux)/edge.crossSectionM2,x=atA?edge.ea:edge.eb,y=atA?edge.na:edge.nb;
        xx+=x*x;xy+=x*y;yy+=y*y;bx+=q*x;by+=q*y;
      }
      const determinant=xx*yy-xy*xy,trace=xx+yy;
      const fullRank=trace>0&&determinant>1e-10*trace*trace;
      // At dead ends and polar/coastal cells only one velocity component is
      // observable. b / trace is the minimum-norm rank-one pseudoinverse. An
      // independent bx/xx, by/yy fallback turns a harmless ~1e-16 direction
      // cosine into a ~1e16 velocity and globally scales circulation to zero.
      const u=fullRank?(bx*yy-by*xy)/determinant:(trace?bx/trace:0);
      const v=fullRank?(by*xx-bx*xy)/determinant:(trace?by/trace:0);
      eastMps[i]=u;northMps[i]=v;const speed=Math.hypot(u,v);if(speed>maximum){maximum=speed;limitingCell=i;}
    }
    return {maximum,edgeMaximum,limitingCell};
  };
  const raw=calculate(),maximum=Math.max(raw.maximum,raw.edgeMaximum);
  const scale=maximum>limit?limit/maximum:1;
  if(scale<1){for(const edge of topology.edges)edge.flux*=scale;for(let i=0;i<grid.size;i++){eastMps[i]*=scale;northMps[i]*=scale;}}
  for(let i=0;i<grid.size;i++)if(mask[i])speedMps[i]=Math.hypot(eastMps[i],northMps[i]);
  return {eastMps,northMps,speedMps,scale,rawReconstructedMaximumMps:raw.maximum,rawEdgeMaximumMps:raw.edgeMaximum,limitingCell:raw.limitingCell};
}

function freshwaterField(grid,ocean,surfaceComponents,surfaceTemperatureC,windEast,windNorth,season,input) {
  const values=new Float64Array(grid.size);
  if(input)values.set(input);
  else {
    const seasonalShift=Math.cos(season*Math.PI/2)*-12;
    for(let i=0;i<grid.size;i++)if(ocean[i]) {
      const latitude=grid.latitude[i]*180/Math.PI,wind=Math.hypot(windEast[i],windNorth[i]);
      const precipitation=520*Math.exp(-(((latitude-seasonalShift)/16)**2))+180*Math.exp(-(((Math.abs(latitude)-52)/14)**2));
      const evaporation=Math.max(0,surfaceTemperatureC[i]+2)*12*(.7+.3*Math.min(2,wind));
      values[i]=precipitation-evaporation;
    }
  }
  for(const component of surfaceComponents) {
    let weighted=0,area=0;for(const i of component.cells){weighted+=values[i]*grid.areaKm2[i];area+=grid.areaKm2[i];}
    const mean=area?weighted/area:0;for(const i of component.cells)values[i]-=mean;
  }
  return values;
}

export function thermodynamicsSeason({grid,elevation,ocean,surfaceEdges,surfaceComponents,surfaceTemperatureC,windEast,windNorth,rules,season,freshwaterFluxMm,evaluate,hasFormula}) {
  const result=emptyThermodynamics(grid.size,true),areaM2=Float64Array.from(grid.areaKm2,value=>value*1e6),surfaceThickness=new Float64Array(grid.size),surfaceVolume=new Float64Array(grid.size),deepVolume=new Float64Array(grid.size);
  const deepThickness=new Float64Array(grid.size);
  for(let i=0;i<grid.size;i++)if(ocean[i]) {
    const depth=Math.max(0,-elevation[i]);surfaceThickness[i]=Math.max(1,Math.min(rules.surfaceLayerDepthM,depth));surfaceVolume[i]=areaM2[i]*surfaceThickness[i];
    if(depth>=rules.deepMinimumDepthM){result.deepMask[i]=1;deepThickness[i]=depth-rules.surfaceLayerDepthM;deepVolume[i]=areaM2[i]*deepThickness[i];result.thermodynamicDiagnostics.deepCells++;}
  }
  const topology=topologyFor(result.deepMask,surfaceEdges,grid.size);result.thermodynamicDiagnostics.deepBasinCount=topology.components.length;
  const deepBaseTemperature=new Float64Array(grid.size);
  for(const component of topology.components) {
    let weighted=0,volume=0;for(const i of component.cells){weighted+=surfaceTemperatureC[i]*deepVolume[i];volume+=deepVolume[i];}
    const temperature=clamp((volume?weighted/volume:0)-rules.deepTemperatureOffsetC,rules.minSstC,rules.maxSstC);for(const i of component.cells)deepBaseTemperature[i]=temperature;
  }
  const freshwater=freshwaterField(grid,ocean,surfaceComponents,surfaceTemperatureC,windEast,windNorth,season,freshwaterFluxMm);
  for(const component of surfaceComponents) {
    const raw=new Float64Array(component.cells.length);let correction=0,volume=0;
    for(let k=0;k<component.cells.length;k++) {const i=component.cells[k],depth=Math.max(1,Math.min(rules.surfaceLayerDepthM,-elevation[i]));raw[k]=-rules.referenceSalinityPsu*freshwater[i]/(1000*depth);correction+=raw[k]*surfaceVolume[i];volume+=surfaceVolume[i];}
    correction=volume?correction/volume:0;
    let maximum=0;for(let k=0;k<component.cells.length;k++)maximum=Math.max(maximum,Math.abs(raw[k]-correction));
    const amplitude=Math.min(rules.freshwaterSalinityRangePsu,rules.referenceSalinityPsu,50-rules.referenceSalinityPsu),scale=maximum>amplitude?amplitude/maximum:1;
    for(let k=0;k<component.cells.length;k++) {const i=component.cells[k];let value=rules.referenceSalinityPsu+(raw[k]-correction)*scale;if(evaluate)value=evaluate('ocean.salinity',i,value,{freshwaterFluxMm:freshwater[i],waterDepthM:-elevation[i],salinityPsu:value,deepMask:result.deepMask[i]});result.salinityPsu[i]=value;}
  }
  for(let i=0;i<grid.size;i++)if(ocean[i]) {
    let density=potentialDensityKgM3(surfaceTemperatureC[i],result.salinityPsu[i]);
    if(evaluate)density=evaluate('ocean.density',i,density,{freshwaterFluxMm:freshwater[i],waterDepthM:-elevation[i],salinityPsu:result.salinityPsu[i],densityKgM3:density,deepMask:result.deepMask[i]});
    result.densityKgM3[i]=density;
    if(result.deepMask[i]) {
      let temperature=deepBaseTemperature[i],salinity=clamp(rules.referenceSalinityPsu+rules.deepSalinityOffsetPsu,0,50);
      if(evaluate)temperature=evaluate('ocean.deepTemperature',i,temperature,{freshwaterFluxMm:freshwater[i],waterDepthM:-elevation[i],salinityPsu:result.salinityPsu[i],densityKgM3:density,deepTemperatureC:temperature,deepMask:1});
      if(evaluate)salinity=evaluate('ocean.deepSalinity',i,salinity,{freshwaterFluxMm:freshwater[i],waterDepthM:-elevation[i],salinityPsu:result.salinityPsu[i],densityKgM3:density,deepTemperatureC:temperature,deepSalinityPsu:salinity,deepMask:1});
      let deepDensity=potentialDensityKgM3(temperature,salinity);
      if(evaluate)deepDensity=evaluate('ocean.deepDensity',i,deepDensity,{freshwaterFluxMm:freshwater[i],waterDepthM:-elevation[i],salinityPsu:result.salinityPsu[i],densityKgM3:density,deepTemperatureC:temperature,deepSalinityPsu:salinity,deepDensityKgM3:deepDensity,deepMask:1,densityContrastKgM3:density-deepDensity});
      result.deepTemperatureC[i]=temperature;result.deepSalinityPsu[i]=salinity;result.deepDensityKgM3[i]=deepDensity;
    }
  }
  for(const edge of topology.edges){edge.crossSectionM2=edge.faceLengthM*Math.min(deepThickness[edge.a],deepThickness[edge.b]);edge.conductance=edge.crossSectionM2/Math.max(1,edge.faceLengthM/edge.conductance);}
  const targetDivergence=new Float64Array(grid.size);
  for(const component of topology.components) {
    let mean=0,area=0;for(const i of component.cells){mean+=(result.densityKgM3[i]-result.deepDensityKgM3[i])*areaM2[i];area+=areaM2[i];}mean=area?mean/area:0;
    let weighted=0;
    for(const i of component.cells) {
      let w=clamp(-rules.overturningStrengthMps*((result.densityKgM3[i]-result.deepDensityKgM3[i])-mean)/rules.densityContrastScaleKgM3,-HARD_MAX_VERTICAL_MPS,HARD_MAX_VERTICAL_MPS);
      if(evaluate)w=evaluate('ocean.vertical',i,w,{freshwaterFluxMm:freshwater[i],waterDepthM:-elevation[i],salinityPsu:result.salinityPsu[i],densityKgM3:result.densityKgM3[i],deepTemperatureC:result.deepTemperatureC[i],deepSalinityPsu:result.deepSalinityPsu[i],deepDensityKgM3:result.deepDensityKgM3[i],densityContrastKgM3:result.densityKgM3[i]-result.deepDensityKgM3[i],deepMask:1,verticalVelocityMps:w});
      result.verticalVelocityMps[i]=w;weighted+=w*areaM2[i];
    }
    const offset=area?weighted/area:0;let maximum=0;for(const i of component.cells){result.verticalVelocityMps[i]-=offset;maximum=Math.max(maximum,Math.abs(result.verticalVelocityMps[i]));}
    const scale=maximum>HARD_MAX_VERTICAL_MPS?HARD_MAX_VERTICAL_MPS/maximum:1;for(const i of component.cells){result.verticalVelocityMps[i]*=scale;targetDivergence[i]=-areaM2[i]*result.verticalVelocityMps[i];}
  }
  enforceDivergence(topology,targetDivergence,rules.projectionIterations);
  let velocity=reconstruct(grid,result.deepMask,topology,rules.maxDeepCurrentMps);
  let currentLimitScale=velocity.scale,rawReconstructedMaximumMps=velocity.rawReconstructedMaximumMps,rawEdgeMaximumMps=velocity.rawEdgeMaximumMps;
  if(velocity.scale<1){for(let i=0;i<grid.size;i++){result.verticalVelocityMps[i]*=velocity.scale;targetDivergence[i]*=velocity.scale;}}
  if(hasFormula?.('ocean.deepEast')||hasFormula?.('ocean.deepNorth')) {
    for(let i=0;i<grid.size;i++)if(result.deepMask[i]) {
      const extra={freshwaterFluxMm:freshwater[i],waterDepthM:-elevation[i],salinityPsu:result.salinityPsu[i],densityKgM3:result.densityKgM3[i],deepTemperatureC:result.deepTemperatureC[i],deepSalinityPsu:result.deepSalinityPsu[i],deepDensityKgM3:result.deepDensityKgM3[i],deepEastMps:velocity.eastMps[i],deepNorthMps:velocity.northMps[i],deepSpeedMps:velocity.speedMps[i],verticalVelocityMps:result.verticalVelocityMps[i],deepMask:1,densityContrastKgM3:result.densityKgM3[i]-result.deepDensityKgM3[i]};
      velocity.eastMps[i]=evaluate('ocean.deepEast',i,velocity.eastMps[i],extra);extra.deepEastMps=velocity.eastMps[i];velocity.northMps[i]=evaluate('ocean.deepNorth',i,velocity.northMps[i],extra);
    }
    for(const edge of topology.edges) {
      const towardB=velocity.eastMps[edge.a]*edge.ea+velocity.northMps[edge.a]*edge.na,towardA=velocity.eastMps[edge.b]*edge.eb+velocity.northMps[edge.b]*edge.nb;
      edge.flux=.5*(towardB-towardA)*edge.crossSectionM2;
    }
    enforceDivergence(topology,targetDivergence,rules.projectionIterations);
    velocity=reconstruct(grid,result.deepMask,topology,rules.maxDeepCurrentMps);
    currentLimitScale=velocity.scale;rawReconstructedMaximumMps=velocity.rawReconstructedMaximumMps;rawEdgeMaximumMps=velocity.rawEdgeMaximumMps;
    if(velocity.scale<1){for(let i=0;i<grid.size;i++){result.verticalVelocityMps[i]*=velocity.scale;targetDivergence[i]*=velocity.scale;}}
  }
  const dt=rules.verticalExchangeCourant>0?rules.verticalExchangeCourant*rules.surfaceLayerDepthM/HARD_MAX_VERTICAL_MPS:0;
  let transportCourantScale=1;
  if(dt) {
    const surfaceOut=new Float64Array(grid.size),deepOut=new Float64Array(grid.size);
    for(const edge of topology.edges){if(edge.flux>=0){deepOut[edge.a]+=edge.flux;surfaceOut[edge.b]+=edge.flux;}else{deepOut[edge.b]-=edge.flux;surfaceOut[edge.a]-=edge.flux;}}
    for(let i=0;i<grid.size;i++)if(result.deepMask[i]){const q=areaM2[i]*result.verticalVelocityMps[i];if(q>=0)deepOut[i]+=q;else surfaceOut[i]-=q;}
    let maximumFraction=0;for(let i=0;i<grid.size;i++)if(result.deepMask[i])maximumFraction=Math.max(maximumFraction,dt*surfaceOut[i]/surfaceVolume[i],dt*deepOut[i]/deepVolume[i]);
    transportCourantScale=maximumFraction>rules.verticalExchangeCourant?rules.verticalExchangeCourant/maximumFraction:1;
    if(transportCourantScale<1){for(const edge of topology.edges)edge.flux*=transportCourantScale;for(let i=0;i<grid.size;i++)result.verticalVelocityMps[i]*=transportCourantScale;velocity=reconstruct(grid,result.deepMask,topology,rules.maxDeepCurrentMps);}
  }
  result.deepEastMps=velocity.eastMps;result.deepNorthMps=velocity.northMps;result.deepSpeedMps=velocity.speedMps;
  result.thermodynamicDiagnostics.rawReconstructedMaximumMps=rawReconstructedMaximumMps;result.thermodynamicDiagnostics.rawEdgeMaximumMps=rawEdgeMaximumMps;result.thermodynamicDiagnostics.currentLimitScale=currentLimitScale;result.thermodynamicDiagnostics.transportCourantScale=transportCourantScale;
  let maximumImbalance=0;for(const component of topology.components){let sum=0;for(const i of component.cells)sum+=areaM2[i]*result.verticalVelocityMps[i];maximumImbalance=Math.max(maximumImbalance,Math.abs(sum));}result.thermodynamicDiagnostics.maximumBasinVerticalImbalanceM3s=maximumImbalance;

  result.thermodynamicDiagnostics.heatStepSeconds=dt;
  let surfaceWindScale=1;
  if(dt) {
    const outflow=new Float64Array(grid.size);
    for(const edge of surfaceEdges){const q=edge.flux*Math.min(surfaceThickness[edge.a],surfaceThickness[edge.b]);if(q>=0)outflow[edge.a]+=q;else outflow[edge.b]-=q;}
    let maximumFraction=0;for(let i=0;i<grid.size;i++)if(ocean[i])maximumFraction=Math.max(maximumFraction,dt*outflow[i]/surfaceVolume[i]);
    if(maximumFraction>rules.verticalExchangeCourant)surfaceWindScale=rules.verticalExchangeCourant/maximumFraction;
  }
  let totalVolume=0,heatBefore=0,saltBefore=0;for(let i=0;i<grid.size;i++)if(ocean[i]){totalVolume+=surfaceVolume[i];heatBefore+=surfaceTemperatureC[i]*surfaceVolume[i];saltBefore+=result.salinityPsu[i]*surfaceVolume[i];if(result.deepMask[i]){totalVolume+=deepVolume[i];heatBefore+=result.deepTemperatureC[i]*deepVolume[i];saltBefore+=result.deepSalinityPsu[i]*deepVolume[i];}}
  const heatReference=totalVolume?heatBefore/totalVolume:0,saltReference=totalVolume?saltBefore/totalVolume:0;
  const surfaceHeat=Float64Array.from(surfaceTemperatureC),dSH=new Float64Array(grid.size),dSS=new Float64Array(grid.size),dDH=new Float64Array(grid.size),dDS=new Float64Array(grid.size);
  for(let step=0;step<rules.thermodynamicSteps;step++) {
    dSH.fill(0);dSS.fill(0);dDH.fill(0);dDS.fill(0);
    if(dt)for(const edge of topology.edges) {
      const q=edge.flux,deepSource=q>=0?edge.a:edge.b,deepTarget=q>=0?edge.b:edge.a,surfaceQ=-q,surfaceSource=surfaceQ>=0?edge.a:edge.b,surfaceTarget=surfaceQ>=0?edge.b:edge.a,deepAmount=dt*Math.abs(q),surfaceAmount=deepAmount;
      const deepHeat=deepAmount*(result.deepTemperatureC[deepSource]-heatReference)*rules.surfaceFeedback;dDH[deepSource]-=deepHeat;dDH[deepTarget]+=deepHeat;
      const surfaceTransportHeat=surfaceAmount*(surfaceHeat[surfaceSource]-heatReference)*rules.surfaceFeedback;dSH[surfaceSource]-=surfaceTransportHeat;dSH[surfaceTarget]+=surfaceTransportHeat;
      const deepSalt=deepAmount*(result.deepSalinityPsu[deepSource]-saltReference);dDS[deepSource]-=deepSalt;dDS[deepTarget]+=deepSalt;
      const surfaceSalt=surfaceAmount*(result.salinityPsu[surfaceSource]-saltReference);dSS[surfaceSource]-=surfaceSalt;dSS[surfaceTarget]+=surfaceSalt;
    }
    if(dt&&surfaceWindScale)for(const edge of surfaceEdges) {
      const q=edge.flux*Math.min(surfaceThickness[edge.a],surfaceThickness[edge.b])*surfaceWindScale,source=q>=0?edge.a:edge.b,target=q>=0?edge.b:edge.a,amount=dt*Math.abs(q),salt=amount*(result.salinityPsu[source]-saltReference);dSS[source]-=salt;dSS[target]+=salt;
    }
    if(dt)for(let i=0;i<grid.size;i++)if(result.deepMask[i]) {
      const q=areaM2[i]*result.verticalVelocityMps[i],amount=dt*Math.abs(q);
      if(q>=0){const heat=amount*(result.deepTemperatureC[i]-heatReference)*rules.surfaceFeedback;dDH[i]-=heat;dSH[i]+=heat;const salt=amount*(result.deepSalinityPsu[i]-saltReference);dDS[i]-=salt;dSS[i]+=salt;}
      else {const heat=amount*(surfaceHeat[i]-heatReference)*rules.surfaceFeedback;dSH[i]-=heat;dDH[i]+=heat;const salt=amount*(result.salinityPsu[i]-saltReference);dSS[i]-=salt;dDS[i]+=salt;}
    }
    if(rules.deepLateralMixing)for(const edge of topology.edges) {
      const volume=rules.deepLateralMixing*.25*Math.min(deepVolume[edge.a],deepVolume[edge.b]),heat=volume*(result.deepTemperatureC[edge.b]-result.deepTemperatureC[edge.a]),salt=volume*(result.deepSalinityPsu[edge.b]-result.deepSalinityPsu[edge.a]);
      dDH[edge.a]+=heat;dDH[edge.b]-=heat;dDS[edge.a]+=salt;dDS[edge.b]-=salt;
    }
    for(let i=0;i<grid.size;i++)if(ocean[i]) {surfaceHeat[i]+=dSH[i]/surfaceVolume[i];result.salinityPsu[i]+=dSS[i]/surfaceVolume[i];if(result.deepMask[i]){result.deepTemperatureC[i]+=dDH[i]/deepVolume[i];result.deepSalinityPsu[i]+=dDS[i]/deepVolume[i];}}
  }
  let heatAfter=0,saltAfter=0;for(let i=0;i<grid.size;i++)if(ocean[i]) {
    if(result.deepMask[i])surfaceTemperatureC[i]=surfaceHeat[i];
    const density=potentialDensityKgM3(surfaceTemperatureC[i],result.salinityPsu[i]);result.densityKgM3[i]=density;heatAfter+=surfaceTemperatureC[i]*surfaceVolume[i];saltAfter+=result.salinityPsu[i]*surfaceVolume[i];
    if(result.deepMask[i]){let deepDensity=potentialDensityKgM3(result.deepTemperatureC[i],result.deepSalinityPsu[i]);if(evaluate)deepDensity=evaluate('ocean.deepDensity',i,deepDensity,{freshwaterFluxMm:freshwater[i],waterDepthM:-elevation[i],salinityPsu:result.salinityPsu[i],densityKgM3:density,deepTemperatureC:result.deepTemperatureC[i],deepSalinityPsu:result.deepSalinityPsu[i],deepDensityKgM3:deepDensity,deepEastMps:result.deepEastMps[i],deepNorthMps:result.deepNorthMps[i],deepSpeedMps:result.deepSpeedMps[i],verticalVelocityMps:result.verticalVelocityMps[i],deepMask:1,densityContrastKgM3:density-deepDensity});result.deepDensityKgM3[i]=deepDensity;heatAfter+=result.deepTemperatureC[i]*deepVolume[i];saltAfter+=result.deepSalinityPsu[i]*deepVolume[i];}
  }
  result.thermodynamicDiagnostics.heatMeanBeforeC=totalVolume?heatBefore/totalVolume:0;result.thermodynamicDiagnostics.heatMeanAfterC=totalVolume?heatAfter/totalVolume:0;result.thermodynamicDiagnostics.salinityMeanBeforePsu=totalVolume?saltBefore/totalVolume:0;result.thermodynamicDiagnostics.salinityMeanAfterPsu=totalVolume?saltAfter/totalVolume:0;
  for(const field of THERMODYNAMIC_FIELDS)if(field!=='deepMask'){const values=result[field];for(let i=0;i<values.length;i++)if(Object.is(values[i],-0))values[i]=0;}
  Object.defineProperty(result,'freshwaterFluxMmUsed',{value:freshwater,enumerable:false});
  return result;
}
