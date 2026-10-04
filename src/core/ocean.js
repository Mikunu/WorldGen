import {clamp,dot} from './grid.js';
import {makeFormulaEvaluator} from './generation-formulas.js';
import {THERMODYNAMIC_MODEL_VERSION,THERMODYNAMIC_FIELDS,oceanThermodynamicRuleSchema,emptyThermodynamics,potentialDensityKgM3,thermodynamicsSeason} from './ocean-thermodynamics.js';

export const OCEAN_MODEL_VERSION='surface-ocean-1';
export {THERMODYNAMIC_MODEL_VERSION,THERMODYNAMIC_FIELDS};
const HARD_MAX_CURRENT_MPS=5;

const leaf=(defaultValue,min,max,label,integer=false)=>integer?{default:defaultValue,min,max,label,integer:true}:{default:defaultValue,min,max,label};
export const oceanRuleSchema={
  enabled:{default:true,label:'Включить поверхностную циркуляцию океана'},
  windResponseMps:leaf(.32,0,2,'Скорость ветрового дрейфа, м/с'),
  coriolisTurn:leaf(.55,0,1.5,'Поворот течения вращением планеты'),
  equatorialCoriolisWidthDeg:leaf(8,1,30,'Ширина экваториального перехода, °'),
  coastDrag:leaf(.55,0,1,'Торможение течения у берега'),
  projectionIterations:leaf(40,4,96,'Итерации согласования потока',true),
  heatSteps:leaf(24,1,64,'Шаги переноса тепла',true),
  advectionCourant:leaf(.22,0,.45,'Доля переноса за шаг'),
  lateralMixing:leaf(.05,0,.25,'Боковое перемешивание'),
  baselineRelaxation:leaf(.06,0,.5,'Возврат к сезонной температуре'),
  maxCurrentMps:leaf(1.5,.05,HARD_MAX_CURRENT_MPS,'Максимальная скорость течения, м/с'),
  minSstC:leaf(-2,-10,10,'Минимальная температура поверхности, °C'),
  maxSstC:leaf(38,20,60,'Максимальная температура поверхности, °C'),
  coastReachCells:leaf(5,1,16,'Дальность влияния океана на сушу',true),
  coastDecay:leaf(.62,.1,1,'Затухание влияния океана на суше'),
  airCoupling:leaf(.35,0,1,'Связь аномалии океана с воздухом'),
  maxAirCorrectionC:leaf(8,0,30,'Максимальная поправка воздуха, °C'),
  ...oceanThermodynamicRuleSchema
};

const defaultsFor=schema=>Object.fromEntries(Object.entries(schema).map(([key,value])=>[key,value.default]));
export const oceanDefaults=Object.freeze(defaultsFor(oceanRuleSchema));

function rulesFor(config) {
  const candidate=config?.generationRules?.ocean??config?.ocean??{};
  const rules={...oceanDefaults,...candidate};
  for(const [key,schema] of Object.entries(oceanRuleSchema)) {
    const value=rules[key];
    if(typeof schema.default==='boolean') {
      if(typeof value!=='boolean')throw new TypeError(`ocean.${key}: ожидается true или false`);
    } else if(!Number.isFinite(value)||value<schema.min||value>schema.max||(schema.integer&&!Number.isInteger(value)))throw new RangeError(`ocean.${key}: допустимо ${schema.min}–${schema.max}${schema.integer?', целое число':''}`);
  }
  if(rules.minSstC>=rules.maxSstC)throw new RangeError('ocean.minSstC должен быть меньше ocean.maxSstC');
  if(rules.thermodynamicsEnabled&&rules.deepMinimumDepthM<=rules.surfaceLayerDepthM)throw new RangeError('ocean.deepMinimumDepthM должен быть больше ocean.surfaceLayerDepthM');
  return rules;
}

function checkField(field,size,label) {
  if(!field||field.length!==size)throw new RangeError(`${label}: ожидается ${size} значений`);
  for(let i=0;i<size;i++)if(!Number.isFinite(field[i]))throw new RangeError(`${label}: значение ${i} должно быть конечным`);
}

function localBasis(p) {
  const horizontal=Math.hypot(p[0],p[2]);
  if(horizontal<=1e-15)return {east:[0,0,1],north:[1,0,0]};
  return {east:[-p[2]/horizontal,0,p[0]/horizontal],north:[-p[0]*p[1]/horizontal,horizontal,-p[2]*p[1]/horizontal]};
}

function formulaContext(grid,i,elevation,baselineTemperature,windEast,windNorth,season,extra={}) {
  const p=grid.point(i),latitudeDeg=grid.latitude[i]*180/Math.PI;
  return {latitudeDeg,longitudeDeg:Math.atan2(p[2],p[0])*180/Math.PI,elevationM:elevation[i],isOcean:elevation[i]<=0?1:0,season,x:p[0],y:p[1],z:p[2],windEast:windEast[i],windNorth:windNorth[i],baselineTemperatureC:baselineTemperature[i],...extra};
}

function emptyResult(size,elevation,baselineTemperature,enabled) {
  const temperatureC=new Float64Array(size);
  for(let i=0;i<size;i++)if(elevation[i]<=0)temperatureC[i]=baselineTemperature[i];
  return {enabled,modelVersion:OCEAN_MODEL_VERSION,...emptyThermodynamics(size,false),eastMps:new Float64Array(size),northMps:new Float64Array(size),speedMps:new Float64Array(size),temperatureC,anomalyC:new Float64Array(size),coastInfluence:new Float64Array(size),airTemperatureCorrectionC:new Float64Array(size),diagnostics:{oceanCells:temperatureC.reduce((n,_,i)=>n+(elevation[i]<=0),0),basinCount:0,edgeCount:0,maximumDivergence:0,heatStepSeconds:0,heatMeanBeforeC:0,heatMeanAfterC:0}};
}

function makeEdges(grid,ocean,eastTarget,northTarget) {
  const bases=Array.from({length:grid.size},(_,i)=>localBasis(grid.point(i))),edges=[],adjacency=Array.from({length:grid.size},()=>[]);
  for(let i=0;i<grid.size;i++)if(ocean[i])for(const j of grid.neighbors(i))if(ocean[j]&&i<j) {
    const xi=i%grid.width,yi=Math.floor(i/grid.width),xj=j%grid.width,yj=Math.floor(j/grid.width),polarPointContact=yi===yj&&Math.abs(xi-xj)===grid.width/2;
    if(polarPointContact)continue;
    const a=grid.point(i),b=grid.point(j),cosine=clamp(dot(a,b),-1,1),sa=Math.sqrt(Math.max(1e-30,1-cosine*cosine));
    if(sa<1e-12)continue;
    const tangentA=b.map((value,k)=>(value-cosine*a[k])/sa),tangentB=a.map((value,k)=>(value-cosine*b[k])/sa);
    const ea=dot(bases[i].east,tangentA),na=dot(bases[i].north,tangentA),eb=dot(bases[j].east,tangentB),nb=dot(bases[j].north,tangentB);
    const faceLengthM=Math.sqrt(Math.min(grid.areaKm2[i],grid.areaKm2[j]))*1000,distanceM=Math.max(1,grid.distance(i,j)*1000);
    const towardB=eastTarget[i]*ea+northTarget[i]*na,towardA=eastTarget[j]*eb+northTarget[j]*nb;
    const edge={a:i,b:j,flux:.5*(towardB-towardA)*faceLengthM,faceLengthM,conductance:faceLengthM/distanceM,ea,na,eb,nb};
    const id=edges.length;edges.push(edge);adjacency[i].push(id);adjacency[j].push(id);
  }
  return {edges,adjacency,bases};
}

function componentsFor(ocean,edges,adjacency) {
  const components=[],seen=new Uint8Array(ocean.length),parent=new Int32Array(ocean.length).fill(-1),parentEdge=new Int32Array(ocean.length).fill(-1);
  for(let start=0;start<ocean.length;start++)if(ocean[start]&&!seen[start]) {
    const cells=[],queue=[start];seen[start]=1;
    for(let k=0;k<queue.length;k++) {
      const i=queue[k];cells.push(i);
      for(const edgeId of adjacency[i]) {const edge=edges[edgeId],j=edge.a===i?edge.b:edge.a;if(!seen[j]){seen[j]=1;parent[j]=i;parentEdge[j]=edgeId;queue.push(j);}}
    }
    components.push({cells,root:start});
  }
  return {components,parent,parentEdge};
}

function projectFluxes(ocean,edges,adjacency,topology,iterations) {
  const {components,parent,parentEdge}=topology;
  const divergence=new Float64Array(ocean.length),potential=new Float64Array(ocean.length);
  for(const edge of edges){divergence[edge.a]+=edge.flux;divergence[edge.b]-=edge.flux;}
  for(let pass=0;pass<iterations;pass++)for(const component of components) {
    for(const i of component.cells) {
      let sum=0,weight=0;
      for(const edgeId of adjacency[i]) {const edge=edges[edgeId],j=edge.a===i?edge.b:edge.a;sum+=edge.conductance*potential[j];weight+=edge.conductance;}
      if(weight)potential[i]+=.72*((divergence[i]+sum)/weight-potential[i]);
    }
    const offset=potential[component.root];for(const i of component.cells)potential[i]-=offset;
  }
  for(const edge of edges)edge.flux-=edge.conductance*(potential[edge.a]-potential[edge.b]);
  const residual=new Float64Array(ocean.length);
  for(const edge of edges){residual[edge.a]+=edge.flux;residual[edge.b]-=edge.flux;}
  // Route the small remaining projection residual through each basin tree. This
  // makes every closed basin exactly non-divergent, including across the seam.
  for(const component of components)for(let k=component.cells.length-1;k>0;k--) {
    const i=component.cells[k],edge=edges[parentEdge[i]],amount=residual[i];
    if(edge.a===i)edge.flux-=amount;else edge.flux+=amount;
    residual[parent[i]]+=amount;residual[i]=0;
  }
  return residual;
}

function velocitiesFromFluxes(grid,ocean,edges,adjacency,maxCurrentMps) {
  const eastMps=new Float64Array(grid.size),northMps=new Float64Array(grid.size),speedMps=new Float64Array(grid.size);
  const reconstruct=()=>{
    let maximum=0;
    for(let i=0;i<grid.size;i++)if(ocean[i]) {
      let xx=0,xy=0,yy=0,bx=0,by=0;
      for(const edgeId of adjacency[i]) {
        const edge=edges[edgeId],atA=edge.a===i,q=(atA?edge.flux:-edge.flux)/edge.faceLengthM,x=atA?edge.ea:edge.eb,y=atA?edge.na:edge.nb;
        xx+=x*x;xy+=x*y;yy+=y*y;bx+=q*x;by+=q*y;
      }
      const determinant=xx*yy-xy*xy,trace=xx+yy;
      let u=0,v=0;
      if(trace>0&&determinant>1e-10*trace*trace){u=(bx*yy-by*xy)/determinant;v=(by*xx-bx*xy)/determinant;}
      // A coast, pole, or one-edge cell constrains only the velocity normal to
      // its face. The rank-one Moore-Penrose solution is b / trace; dividing
      // its tiny east and north terms independently amplifies roundoff near a
      // meridional face and can collapse every current through the global cap.
      else if(trace>0){u=bx/trace;v=by/trace;}
      eastMps[i]=u;northMps[i]=v;maximum=Math.max(maximum,Math.hypot(u,v));
    }
    return maximum;
  };
  const maximum=reconstruct();let maximumEdgeSpeed=0;
  for(const edge of edges)maximumEdgeSpeed=Math.max(maximumEdgeSpeed,Math.abs(edge.flux)/edge.faceLengthM);
  const fluxMaximum=Math.max(maximum,maximumEdgeSpeed);
  if(fluxMaximum>maxCurrentMps){const scale=maxCurrentMps/fluxMaximum;for(const edge of edges)edge.flux*=scale;reconstruct();}
  for(let i=0;i<grid.size;i++)if(ocean[i]) {
    const x=i%grid.width,y=Math.floor(i/grid.width);
    if(!ocean[grid.index(x+1,y)]&&eastMps[i]>0)eastMps[i]=0;
    if(!ocean[grid.index(x-1,y)]&&eastMps[i]<0)eastMps[i]=0;
    if(!ocean[grid.index(x,y-1)]&&northMps[i]>0)northMps[i]=0;
    if(!ocean[grid.index(x,y+1)]&&northMps[i]<0)northMps[i]=0;
    const speed=Math.hypot(eastMps[i],northMps[i]),scale=speed>maxCurrentMps?maxCurrentMps/speed:1;
    eastMps[i]*=scale;northMps[i]*=scale;speedMps[i]=Math.hypot(eastMps[i],northMps[i]);
  }
  return {eastMps,northMps,speedMps};
}

function transportHeat(grid,ocean,edges,baseline,rules) {
  const temperatureC=Float64Array.from(baseline),areaM2=Float64Array.from(grid.areaKm2,value=>value*1e6),maximumOutflow=new Float64Array(grid.size);
  // All projected edge fluxes are capped at the schema's hard 5 m/s ceiling.
  // Deriving one timestep from that fixed worst case keeps it independent of
  // actual wind strength while bounding every cell's exported water fraction.
  for(const edge of edges){const bound=HARD_MAX_CURRENT_MPS*edge.faceLengthM;maximumOutflow[edge.a]+=bound;maximumOutflow[edge.b]+=bound;}
  let maximumBoundRate=0;for(let i=0;i<grid.size;i++)if(ocean[i])maximumBoundRate=Math.max(maximumBoundRate,maximumOutflow[i]/areaM2[i]);
  const dt=maximumBoundRate>0?rules.advectionCourant/maximumBoundRate:0;
  const delta=new Float64Array(grid.size);
  for(let step=0;step<rules.heatSteps;step++) {
    delta.fill(0);
    if(dt)for(const edge of edges) {
      const source=edge.flux>=0?edge.a:edge.b,target=edge.flux>=0?edge.b:edge.a,heat=dt*Math.abs(edge.flux)*temperatureC[source];
      delta[source]-=heat;delta[target]+=heat;
    }
    if(rules.lateralMixing)for(const edge of edges) {
      const heat=rules.lateralMixing*.25*Math.min(areaM2[edge.a],areaM2[edge.b])*(temperatureC[edge.b]-temperatureC[edge.a]);
      delta[edge.a]+=heat;delta[edge.b]-=heat;
    }
    for(let i=0;i<grid.size;i++)if(ocean[i]) {
      temperatureC[i]+=delta[i]/areaM2[i];
      temperatureC[i]+=rules.baselineRelaxation*(baseline[i]-temperatureC[i]);
      temperatureC[i]=clamp(temperatureC[i],rules.minSstC,rules.maxSstC);
    }
  }
  return {temperatureC,heatStepSeconds:dt};
}

function coastalCoupling(grid,ocean,anomaly,rules) {
  const coastInfluence=new Float64Array(grid.size),signal=new Float64Array(grid.size),frontier=[];
  for(let i=0;i<grid.size;i++)if(ocean[i]){coastInfluence[i]=1;signal[i]=anomaly[i];frontier.push(i);}
  let current=frontier;
  for(let distance=1;distance<=rules.coastReachCells&&current.length;distance++) {
    const next=[],candidates=new Set();for(const i of current)for(const j of grid.neighbors(i))if(!ocean[j]&&!coastInfluence[j])candidates.add(j);
    for(const i of candidates) {
      let weighted=0,total=0,best=0;
      for(const j of grid.neighbors(i))if(coastInfluence[j]>0){weighted+=signal[j]*coastInfluence[j];total+=coastInfluence[j];best=Math.max(best,coastInfluence[j]);}
      if(total){coastInfluence[i]=best*rules.coastDecay;signal[i]=weighted/total;next.push(i);}
    }
    current=next;
  }
  return {coastInfluence,signal};
}

export function oceanSeason(grid,elevation,windEast,windNorth,baselineTemperature,config={},season=0,freshwaterFluxMm=null) {
  if(!grid||!Number.isInteger(grid.size)||grid.size<1)throw new TypeError('Океан: требуется корректная сетка');
  for(const [field,label] of [[elevation,'Высоты'],[windEast,'Зональный ветер'],[windNorth,'Меридиональный ветер'],[baselineTemperature,'Базовая температура']])checkField(field,grid.size,label);
  if(!Number.isInteger(season)||season<0||season>3)throw new RangeError('Сезон океана должен быть от 0 до 3');
  if(freshwaterFluxMm!==null){checkField(freshwaterFluxMm,grid.size,'Пресноводный баланс');for(let i=0;i<grid.size;i++)if(Math.abs(freshwaterFluxMm[i])>1e12)throw new RangeError(`Пресноводный баланс: значение ${i} должно быть от -1000000000000 до 1000000000000 мм`);}
  const rules=rulesFor(config),ocean=Uint8Array.from(elevation,value=>value<=0?1:0);
  if(!rules.enabled)return emptyResult(grid.size,elevation,baselineTemperature,false);
  const formulas=makeFormulaEvaluator(config,config.seed),eastTarget=new Float64Array(grid.size),northTarget=new Float64Array(grid.size),oceanBaseline=new Float64Array(grid.size);
  let oceanCells=0,totalArea=0,heatBefore=0;
  for(let i=0;i<grid.size;i++)if(ocean[i]) {
    oceanCells++;const latitude=grid.latitude[i],coriolisFactor=Math.tanh(latitude/(rules.equatorialCoriolisWidthDeg*Math.PI/180)),neighbors=grid.neighbors(i),coastalFraction=neighbors.reduce((sum,j)=>sum+!ocean[j],0)/neighbors.length;
    let east=rules.windResponseMps*(windEast[i]+rules.coriolisTurn*coriolisFactor*windNorth[i]);
    let north=rules.windResponseMps*(windNorth[i]-rules.coriolisTurn*coriolisFactor*windEast[i]);
    const context=formulaContext(grid,i,elevation,baselineTemperature,windEast,windNorth,season,{coriolisFactor,coastalFraction});
    if(formulas.has('ocean.east'))east=formulas.evaluate('ocean.east',context,east,`Океан, сезон ${season+1}`);
    if(formulas.has('ocean.north'))north=formulas.evaluate('ocean.north',context,north,`Океан, сезон ${season+1}`);
    const drag=1-rules.coastDrag*coastalFraction,speed=Math.hypot(east,north),limit=speed>rules.maxCurrentMps?rules.maxCurrentMps/speed:1;
    eastTarget[i]=east*drag*limit;northTarget[i]=north*drag*limit;
    oceanBaseline[i]=clamp(baselineTemperature[i],rules.minSstC,rules.maxSstC);totalArea+=grid.areaKm2[i];heatBefore+=oceanBaseline[i]*grid.areaKm2[i];
  }
  if(!oceanCells){const empty=emptyResult(grid.size,elevation,baselineTemperature,true),thermodynamics=emptyThermodynamics(grid.size,rules.thermodynamicsEnabled);return {...empty,...thermodynamics,diagnostics:{oceanCells:0,basinCount:0,edgeCount:0,maximumDivergence:0,heatStepSeconds:0,heatMeanBeforeC:0,heatMeanAfterC:0}};}
  const {edges,adjacency}=makeEdges(grid,ocean,eastTarget,northTarget),topology=componentsFor(ocean,edges,adjacency),residual=projectFluxes(ocean,edges,adjacency,topology,rules.projectionIterations);
  const {eastMps,northMps,speedMps}=velocitiesFromFluxes(grid,ocean,edges,adjacency,rules.maxCurrentMps);
  const {temperatureC,heatStepSeconds}=transportHeat(grid,ocean,edges,oceanBaseline,rules),anomalyC=new Float64Array(grid.size);
  let thermodynamics=emptyThermodynamics(grid.size,false);
  if(rules.thermodynamicsEnabled) {
    const thermodynamicFormulaIds=['ocean.salinity','ocean.density','ocean.deepTemperature','ocean.deepSalinity','ocean.deepDensity','ocean.deepEast','ocean.deepNorth','ocean.vertical'],hasThermodynamicFormula=thermodynamicFormulaIds.some(id=>formulas.has(id));
    const evaluate=hasThermodynamicFormula?(id,i,base,extra={})=>{
      if(!formulas.has(id))return base;
      const all={freshwaterFluxMm:freshwaterFluxMm?.[i]??0,waterDepthM:Math.max(0,-elevation[i]),seaTemperatureC:temperatureC[i],salinityPsu:0,densityKgM3:0,deepTemperatureC:0,deepSalinityPsu:0,deepDensityKgM3:0,deepEastMps:0,deepNorthMps:0,deepSpeedMps:0,verticalVelocityMps:0,deepMask:0,densityContrastKgM3:0,...extra};
      return formulas.evaluate(id,formulaContext(grid,i,elevation,baselineTemperature,windEast,windNorth,season,all),base,`Океан, сезон ${season+1}`);
    }:null;
    thermodynamics=thermodynamicsSeason({grid,elevation,ocean,surfaceEdges:edges,surfaceComponents:topology.components,surfaceTemperatureC:temperatureC,windEast,windNorth,rules,season,freshwaterFluxMm,evaluate,hasFormula:id=>formulas.has(id)});
  }
  for(let i=0;i<grid.size;i++)if(ocean[i]) {
    const context=formulaContext(grid,i,elevation,baselineTemperature,windEast,windNorth,season,{oceanBaselineTemperatureC:oceanBaseline[i],seaTemperatureC:temperatureC[i],currentEastMps:eastMps[i],currentNorthMps:northMps[i],speedMps:speedMps[i],oceanAnomalyC:temperatureC[i]-oceanBaseline[i],coastInfluence:1});
    if(formulas.has('ocean.temperature'))temperatureC[i]=formulas.evaluate('ocean.temperature',context,temperatureC[i],`Океан, сезон ${season+1}`);
    temperatureC[i]=clamp(temperatureC[i],rules.minSstC,rules.maxSstC);anomalyC[i]=temperatureC[i]-oceanBaseline[i];
    if(rules.thermodynamicsEnabled){let density=potentialDensityKgM3(temperatureC[i],thermodynamics.salinityPsu[i]);if(formulas.has('ocean.density'))density=formulas.evaluate('ocean.density',formulaContext(grid,i,elevation,baselineTemperature,windEast,windNorth,season,{freshwaterFluxMm:thermodynamics.freshwaterFluxMmUsed?.[i]??freshwaterFluxMm?.[i]??0,waterDepthM:Math.max(0,-elevation[i]),seaTemperatureC:temperatureC[i],salinityPsu:thermodynamics.salinityPsu[i],densityKgM3:density,deepTemperatureC:thermodynamics.deepTemperatureC[i],deepSalinityPsu:thermodynamics.deepSalinityPsu[i],deepDensityKgM3:thermodynamics.deepDensityKgM3[i],deepEastMps:thermodynamics.deepEastMps[i],deepNorthMps:thermodynamics.deepNorthMps[i],deepSpeedMps:thermodynamics.deepSpeedMps[i],verticalVelocityMps:thermodynamics.verticalVelocityMps[i],deepMask:thermodynamics.deepMask[i],densityContrastKgM3:density-thermodynamics.deepDensityKgM3[i]}),density,`Океан, сезон ${season+1}`);thermodynamics.densityKgM3[i]=density;}
  }
  const {coastInfluence,signal}=coastalCoupling(grid,ocean,anomalyC,rules),airTemperatureCorrectionC=new Float64Array(grid.size);
  for(let i=0;i<grid.size;i++)if(coastInfluence[i]>0) {
    let correction=clamp(signal[i]*coastInfluence[i]*rules.airCoupling,-rules.maxAirCorrectionC,rules.maxAirCorrectionC);
    const context=formulaContext(grid,i,elevation,baselineTemperature,windEast,windNorth,season,{coriolisFactor:Math.tanh(grid.latitude[i]/(rules.equatorialCoriolisWidthDeg*Math.PI/180)),oceanBaselineTemperatureC:oceanBaseline[i],seaTemperatureC:ocean[i]?temperatureC[i]:0,currentEastMps:eastMps[i],currentNorthMps:northMps[i],speedMps:speedMps[i],oceanAnomalyC:signal[i],coastInfluence:coastInfluence[i]});
    if(formulas.has('ocean.coupling'))correction=formulas.evaluate('ocean.coupling',context,correction,`Океан, сезон ${season+1}`);
    airTemperatureCorrectionC[i]=clamp(correction,-rules.maxAirCorrectionC,rules.maxAirCorrectionC);
  }
  let heatAfter=0,maximumDivergence=0;for(let i=0;i<grid.size;i++){if(ocean[i])heatAfter+=temperatureC[i]*grid.areaKm2[i];maximumDivergence=Math.max(maximumDivergence,Math.abs(residual[i]));}
  return {enabled:true,modelVersion:OCEAN_MODEL_VERSION,...thermodynamics,eastMps,northMps,speedMps,temperatureC,anomalyC,coastInfluence,airTemperatureCorrectionC,diagnostics:{oceanCells,basinCount:topology.components.length,edgeCount:edges.length,maximumDivergence,heatStepSeconds,heatMeanBeforeC:heatBefore/totalArea,heatMeanAfterC:heatAfter/totalArea}};
}
