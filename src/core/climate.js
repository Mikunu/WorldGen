import {clamp} from './grid.js';
import {physicalRulesFor} from './physical-rules.js';
import {makeFormulaEvaluator} from './generation-formulas.js';
import {oceanSeason,OCEAN_MODEL_VERSION,THERMODYNAMIC_MODEL_VERSION} from './ocean.js';
import {hydrology} from './hydrology.js';
import {OCEAN_FIELDS,THERMODYNAMIC_FIELDS} from './ocean-validation.js';

const degrees=value=>value*180/Math.PI;
function climateVariables(grid,index,elevation,season) {
  const p=grid.point(index);
  return {latitudeDeg:degrees(grid.latitude[index]),longitudeDeg:degrees(Math.atan2(p[2],p[0])),elevationM:elevation[index],isOcean:elevation[index]<=0?1:0,season,x:p[0],y:p[1],z:p[2]};
}

// formulaContext is deliberately optional so editor helpers retain their previous API.
export function runoffFor(precipitation,temperature,rules,formulaContext) {
  const potentialEvaporation=clamp(rules.evaporationBase+temperature*rules.evaporationTemperatureFactor,rules.evaporationMin,rules.evaporationMax);
  const evaluator=formulaContext?.evaluator;
  const evaporation=evaluator?.has('climate.evaporation')
    ? evaluator.evaluate('climate.evaporation',{...formulaContext.variables,base:potentialEvaporation,precipitationMm:precipitation,temperatureC:temperature},potentialEvaporation,formulaContext.label??'Испарение')
    : potentialEvaporation;
  const builtin=Math.max(precipitation*rules.runoffMinimumFraction,precipitation-evaporation);
  if(!evaluator?.has('climate.runoff'))return builtin;
  return clamp(evaluator.evaluate('climate.runoff',{...formulaContext.variables,base:builtin,precipitationMm:precipitation,temperatureC:temperature,evaporationMm:evaporation},builtin,formulaContext.label??'Сток'),0,precipitation);
}

export function biomeFor(elevation,temperature,precipitation,rules,formulaContext) {
  let biome=temperature<rules.iceTemperature ? 1 : temperature<rules.tundraTemperature ? 2 : precipitation<rules.desertPrecipitation ? 3 : precipitation<rules.steppePrecipitation ? 4 : temperature>rules.tropicalTemperature && precipitation>rules.tropicalPrecipitation ? 7 : temperature>rules.savannaTemperature ? 6 : 5;
  if(elevation>rules.alpineElevation && temperature<rules.alpineTemperature)biome=8;
  const evaluator=formulaContext?.evaluator;
  if(!evaluator?.has('climate.biome'))return biome;
  return clamp(Math.round(evaluator.evaluate('climate.biome',{...formulaContext.variables,base:biome,elevationM:elevation,temperatureC:temperature,precipitationMm:precipitation},biome,formulaContext.label??'Биом')),1,8);
}

function atmosphericRain(grid,elevation,rules,formulas,temp,windEast,windNorth,declination,season,ocean) {
  const rain=new Float64Array(grid.size),condensationFormula=formulas.has('climate.condensation');
  let moisture=new Float64Array(grid.size);
  const stepScale=192/grid.width*grid.radiusKm/6371,iterations=Math.max(16,Math.ceil(rules.transportDistance/stepScale/2)*2);
  for(let step=0;step<iterations;step++) {
    const next=new Float64Array(grid.size);
    for(let i=0;i<grid.size;i++) {
      const x=i%grid.width,y=Math.floor(i/grid.width),upstream=grid.index(x-windEast[i],y),upstreamMeridian=grid.index(x,y+(windNorth[i]>0?1:-1));
      let available=moisture[upstream]*rules.moistureZonalShare+moisture[upstreamMeridian]*rules.moistureMeridionalShare;
      if(elevation[i]<=0) {
        const sourceTemperature=ocean?.enabled?ocean.temperatureC[i]:temp[i];
        available+=clamp(rules.oceanMoistureBase+sourceTemperature*rules.oceanMoistureTemperatureFactor,rules.oceanMoistureMin,rules.oceanMoistureMax)*stepScale;
      }
      const uplift=Math.max(0,elevation[i]-Math.max(0,elevation[upstream])),equatorial=Math.exp(-(((grid.latitude[i]-declination*.45)/rules.equatorialBeltWidth)**2)),stormTrack=Math.exp(-(((Math.abs(grid.latitude[i])-rules.stormTrackLatitude)/rules.stormTrackWidth)**2));
      const baseFraction=clamp(rules.baseCondensation+equatorial*rules.equatorialCondensation+stormTrack*rules.stormTrackCondensation,.02,.3);
      const builtinFraction=clamp(1-(1-baseFraction)**stepScale*Math.exp(-uplift/rules.orographyScale),rules.condensationMin,rules.condensationMax);
      const fraction=condensationFormula?formulas.evaluate('climate.condensation',{...climateVariables(grid,i,elevation,season),base:builtinFraction,availableMoisture:available,upliftM:uplift,stepScale,temperatureC:temp[i],baseFraction},builtinFraction,`Конденсация, сезон ${season+1}`):builtinFraction;
      const condensed=available*fraction;next[i]=available-condensed;if(step>=iterations/2)rain[i]+=condensed*2;
    }
    moisture=next;
  }
  return rain;
}

// A fixed preliminary atmosphere/routing pass supplies freshwater forcing. The
// final pass uses the coupled ocean SST; no unbounded climate/sea iteration occurs.
function freshwaterForSeason(grid,elevation,rules,formulas,temp,rain,season) {
  const runoff=new Float64Array(grid.size),forcing=new Float64Array(grid.size),secondsPerYear=365.25*86400;
  if(!elevation.some(value=>value<=0))return forcing;
  for(let i=0;i<grid.size;i++)if(elevation[i]>0) {
    const context={evaluator:formulas,variables:climateVariables(grid,i,elevation,season),label:`Речной приток, сезон ${season+1}`};
    runoff[i]=runoffFor(rain[i],temp[i],rules,context);
  }
  const water=hydrology(grid,elevation,runoff);
  for(let i=0;i<grid.size;i++)if(elevation[i]<=0) {
    const riverMm=water.discharge[i]*secondsPerYear/(grid.areaKm2[i]*1000),evaporation=clamp(rules.evaporationBase+temp[i]*rules.evaporationTemperatureFactor,rules.evaporationMin,rules.evaporationMax);
    forcing[i]=(rain[i]+riverMm-evaporation)/4;
  }
  return forcing;
}

export function climate(grid, elevation, config) {
  const rules=physicalRulesFor(config,'climate'),biomeRules=physicalRulesFor(config,'biomes');
  const formulas=makeFormulaEvaluator(config,config.seed),temperatureFormula=formulas.has('climate.temperature'),thermodynamicsEnabled=config.generationRules?.ocean?.enabled!==false&&config.generationRules?.ocean?.thermodynamicsEnabled!==false;
  const seasons=[],oceanSeasons=[],temperature=new Float64Array(grid.size),precipitation=new Float64Array(grid.size);
  const tilt=config.axialTilt*Math.PI/180;
  for(let season=0;season<4;season++) {
    const declination=-tilt*Math.cos(season*Math.PI/2), temp=new Float64Array(grid.size);
    const windEast=new Int8Array(grid.size), windNorth=new Float64Array(grid.size);
    for(let i=0;i<grid.size;i++) {
      const lat=grid.latitude[i], hour=Math.acos(clamp(-Math.tan(lat)*Math.tan(declination),-1,1));
      const sunlight=Math.max(0,(hour*Math.sin(lat)*Math.sin(declination)+Math.cos(lat)*Math.cos(declination)*Math.sin(hour))/Math.PI);
      const annual=rules.equatorialTemperature-rules.latitudeCooling*Math.sin(lat)**2;
      const seasonal=(sunlight-Math.cos(lat)/Math.PI)*rules.seasonalAmplitude;
      const builtinTemperature=annual+seasonal*(elevation[i]<=0?rules.oceanSeasonModeration:rules.landSeasonModeration)-Math.max(elevation[i],0)*rules.lapseRate;
      temp[i]=builtinTemperature;
      const relativeLat=lat-declination*0.45, belt=Math.abs(relativeLat)*180/Math.PI;
      windEast[i]=belt<30 || belt>60 ? -1 : 1;
      windNorth[i]=(belt<30 ? -Math.sign(relativeLat) : Math.sign(relativeLat))*0.16;
    }
    // Wind belts force the surface ocean; transported heat modifies air before
    // atmospheric moisture transport and before an authored temperature override.
    const preliminaryRain=thermodynamicsEnabled?atmosphericRain(grid,elevation,rules,formulas,temp,windEast,windNorth,declination,season,null):null;
    const freshwaterFlux=thermodynamicsEnabled?freshwaterForSeason(grid,elevation,rules,formulas,temp,preliminaryRain,season):null;
    const ocean=oceanSeason(grid,elevation,windEast,windNorth,temp,config,season,freshwaterFlux);oceanSeasons.push(ocean);
    for(let i=0;i<grid.size;i++) {
      const builtinTemperature=temp[i]+ocean.airTemperatureCorrectionC[i];
      if(temperatureFormula) {
        const lat=grid.latitude[i],hour=Math.acos(clamp(-Math.tan(lat)*Math.tan(declination),-1,1));
        const sunlight=Math.max(0,(hour*Math.sin(lat)*Math.sin(declination)+Math.cos(lat)*Math.cos(declination)*Math.sin(hour))/Math.PI);
        const annual=rules.equatorialTemperature-rules.latitudeCooling*Math.sin(lat)**2,seasonal=(sunlight-Math.cos(lat)/Math.PI)*rules.seasonalAmplitude;
        temp[i]=formulas.evaluate('climate.temperature',{...climateVariables(grid,i,elevation,season),sunlight,annualTemperature:annual,seasonEffect:seasonal,seaTemperatureC:ocean.temperatureC[i],oceanAnomalyC:ocean.anomalyC[i],coastInfluence:ocean.coastInfluence[i]},builtinTemperature,`Температура, сезон ${season+1}`);
      }else temp[i]=builtinTemperature;
    }
    const rain=atmosphericRain(grid,elevation,rules,formulas,temp,windEast,windNorth,declination,season,ocean);
    for(let i=0;i<grid.size;i++) {temperature[i]+=temp[i]/4;precipitation[i]+=rain[i]/4;}
    seasons.push({temperature:temp,precipitation:rain,windEast,windNorth});
  }
  const runoffMm=new Float64Array(grid.size), snowFraction=new Float64Array(grid.size), biome=new Uint8Array(grid.size);
  for(let i=0;i<grid.size;i++) {
    if(elevation[i]<=0) continue;
    // Annual snow melts within the annual routing approximation; no glacier mass model yet.
    const variables=(formulas.has('climate.evaporation')||formulas.has('climate.runoff')||formulas.has('climate.biome'))?climateVariables(grid,i,elevation,-1):null;
    const formulaContext=variables?{evaluator:formulas,variables,label:'Годовой климат'}:undefined;
    runoffMm[i]=runoffFor(precipitation[i],temperature[i],rules,formulaContext);
    snowFraction[i]=seasons.filter(s=>s.temperature[i]<0).reduce((a,s)=>a+s.precipitation[i]/4,0)/Math.max(precipitation[i],1e-9);
    biome[i]=biomeFor(elevation[i],temperature[i],precipitation[i],biomeRules,formulaContext);
  }
  const ocean={enabled:oceanSeasons[0].enabled,modelVersion:OCEAN_MODEL_VERSION,thermodynamicsEnabled:oceanSeasons[0].thermodynamicsEnabled,thermodynamicsModelVersion:THERMODYNAMIC_MODEL_VERSION,seasons:oceanSeasons};
  for(const field of [...OCEAN_FIELDS,...THERMODYNAMIC_FIELDS.filter(field=>field!=='deepMask')])ocean[field]=Float64Array.from({length:grid.size},(_,i)=>oceanSeasons.reduce((sum,s)=>sum+s[field][i]/4,0));
  ocean.deepMask=Uint8Array.from(oceanSeasons[0].deepMask);
  return {temperature,precipitation,runoffMm,snowFraction,biome,seasons,ocean};
}
export const biomeNames=['Океан','Ледяная область','Тундра','Пустыня','Степь','Умеренный лес','Саванна / сезонный лес','Влажный тропический лес','Высокогорье'];
