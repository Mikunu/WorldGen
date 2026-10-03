import {clamp} from './grid.js';

export function climate(grid, elevation, config) {
  const seasons=[], temperature=new Float64Array(grid.size), precipitation=new Float64Array(grid.size);
  const tilt=config.axialTilt*Math.PI/180;
  for(let season=0;season<4;season++) {
    const declination=-tilt*Math.cos(season*Math.PI/2), temp=new Float64Array(grid.size), rain=new Float64Array(grid.size);
    const windEast=new Int8Array(grid.size), windNorth=new Float64Array(grid.size);
    for(let i=0;i<grid.size;i++) {
      const lat=grid.latitude[i], hour=Math.acos(clamp(-Math.tan(lat)*Math.tan(declination),-1,1));
      const sunlight=Math.max(0,(hour*Math.sin(lat)*Math.sin(declination)+Math.cos(lat)*Math.cos(declination)*Math.sin(hour))/Math.PI);
      const annual=29-49*Math.sin(lat)**2;
      const seasonal=(sunlight-Math.cos(lat)/Math.PI)*100;
      temp[i]=annual+seasonal*(elevation[i]<=0?0.36:0.85)-Math.max(elevation[i],0)*0.006;
      const relativeLat=lat-declination*0.45, belt=Math.abs(relativeLat)*180/Math.PI;
      windEast[i]=belt<30 || belt>60 ? -1 : 1;
      windNorth[i]=(belt<30 ? -Math.sign(relativeLat) : Math.sign(relativeLat))*0.16;
    }
    let moisture=new Float64Array(grid.size);
    // Match a fixed travel distance/time when resolution or planet radius changes.
    const stepScale=192/grid.width*grid.radiusKm/6371;
    const iterations=Math.max(16,Math.ceil(64/stepScale/2)*2);
    for(let step=0;step<iterations;step++) {
      const next=new Float64Array(grid.size);
      for(let i=0;i<grid.size;i++) {
        const x=i%grid.width,y=Math.floor(i/grid.width);
        const upstream=grid.index(x-windEast[i],y);
        const upstreamMeridian=grid.index(x,y+(windNorth[i]>0?1:-1));
        // A heuristic moisture transport, not a conservative atmosphere solver.
        let available=moisture[upstream]*0.84+moisture[upstreamMeridian]*0.16;
        if(elevation[i]<=0) available+=clamp(24+temp[i]*0.5,3,44)*stepScale;
        const uplift=Math.max(0,elevation[i]-Math.max(0,elevation[upstream]));
        const equatorial=Math.exp(-(((grid.latitude[i]-declination*0.45)/0.24)**2));
        const stormTrack=Math.exp(-(((Math.abs(grid.latitude[i])-0.87)/0.22)**2));
        const baseFraction=clamp(0.025+equatorial*0.075+stormTrack*0.04,0.02,0.3);
        const fraction=clamp(1-(1-baseFraction)**stepScale*Math.exp(-uplift/7000),0.001,0.8);
        const condensed=available*fraction;
        next[i]=available-condensed;
        if(step>=iterations/2) rain[i]+=condensed*2;
      }
      moisture=next;
    }
    for(let i=0;i<grid.size;i++) {temperature[i]+=temp[i]/4;precipitation[i]+=rain[i]/4;}
    seasons.push({temperature:temp,precipitation:rain,windEast,windNorth});
  }
  const runoffMm=new Float64Array(grid.size), snowFraction=new Float64Array(grid.size), biome=new Uint8Array(grid.size);
  for(let i=0;i<grid.size;i++) {
    if(elevation[i]<=0) continue;
    const potentialEvaporation=clamp(350+temperature[i]*24,70,1700);
    // Annual snow melts within the annual routing approximation; no glacier mass model yet.
    runoffMm[i]=Math.max(precipitation[i]*0.12,precipitation[i]-potentialEvaporation);
    snowFraction[i]=seasons.filter(s=>s.temperature[i]<0).reduce((a,s)=>a+s.precipitation[i]/4,0)/Math.max(precipitation[i],1e-9);
    biome[i]=temperature[i]<-8 ? 1 : temperature[i]<2 ? 2 : precipitation[i]<250 ? 3 : precipitation[i]<650 ? 4 : temperature[i]>22 && precipitation[i]>1500 ? 7 : temperature[i]>18 ? 6 : 5;
    if(elevation[i]>3400 && temperature[i]<4) biome[i]=8;
  }
  return {temperature,precipitation,runoffMm,snowFraction,biome,seasons};
}
export const biomeNames=['Океан','Ледяная область','Тундра','Пустыня','Степь','Умеренный лес','Саванна / сезонный лес','Влажный тропический лес','Высокогорье'];
