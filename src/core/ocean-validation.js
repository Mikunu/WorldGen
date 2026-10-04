import {OCEAN_MODEL_VERSION,THERMODYNAMIC_MODEL_VERSION} from './ocean.js';

export const OCEAN_FIELDS=Object.freeze(['eastMps','northMps','speedMps','temperatureC','anomalyC','coastInfluence','airTemperatureCorrectionC']);
export const THERMODYNAMIC_FIELDS=Object.freeze(['salinityPsu','densityKgM3','deepTemperatureC','deepSalinityPsu','deepDensityKgM3','deepEastMps','deepNorthMps','deepSpeedMps','verticalVelocityMps','deepMask']);
const deepOnly=new Set(THERMODYNAMIC_FIELDS.filter(field=>!['salinityPsu','densityKgM3'].includes(field)));
const waterOnly=new Set(['eastMps','northMps','speedMps','temperatureC','anomalyC']);
const close=(a,b)=>Math.abs(a-b)<=1e-9*Math.max(1,Math.abs(a),Math.abs(b));

// Validate both generated typed arrays and restored JSON arrays without modifying them.
export function validateOcean(ocean,elevation,expected) {
  const errors=[],size=elevation.length;
  const options=typeof expected==='boolean'?{surfaceEnabled:expected}:expected??{},expectedEnabled=options.surfaceEnabled;
  if(!ocean||ocean.modelVersion!==OCEAN_MODEL_VERSION||typeof ocean.enabled!=='boolean'||(expectedEnabled!==undefined&&ocean.enabled!==expectedEnabled))return ['Некорректная версия или состояние океанской модели'];
  if(!Array.isArray(ocean.seasons)||ocean.seasons.length!==4)return ['Повреждены сезоны океана'];
  const frames=[ocean,...ocean.seasons];
  if(ocean.thermodynamicsModelVersion!==THERMODYNAMIC_MODEL_VERSION||typeof ocean.thermodynamicsEnabled!=='boolean'||(ocean.thermodynamicsEnabled&&!ocean.enabled)||(options.thermodynamicsEnabled!==undefined&&options.thermodynamicsEnabled!==ocean.thermodynamicsEnabled))return ['Некорректная версия или состояние глубинной модели океана'];
  for(const [frameIndex,frame] of frames.entries()) {
    if(!frame||frame.modelVersion!==OCEAN_MODEL_VERSION||frame.enabled!==ocean.enabled)return ['Сезоны океана не согласованы с годовой моделью'];
    if(frame.thermodynamicsModelVersion!==THERMODYNAMIC_MODEL_VERSION||frame.thermodynamicsEnabled!==ocean.thermodynamicsEnabled)return ['Сезоны глубинного океана не согласованы с годовой моделью'];
    for(const field of THERMODYNAMIC_FIELDS) {
      const values=frame[field];if(!values||values.length!==size)return [`Повреждён слой глубинного океана ${field}`];
      for(let i=0;i<size;i++) {
        const value=values[i],land=elevation[i]>0,deep=frame.deepMask?.[i]===1;
        const inactive=!ocean.thermodynamicsEnabled||land||(deepOnly.has(field)&&field!=='deepMask'&&!deep);
        if(!Number.isFinite(value)||(inactive&&value!==0))return [`Некорректный слой глубинного океана ${field}, ячейка ${i}`];
        if(field==='deepMask') {
          if(value!==0&&value!==1)return ['Глубинная маска должна содержать только 0 и 1'];
          if(options.rules) {
            const mask=ocean.thermodynamicsEnabled&&!land&&-elevation[i]>=options.rules.deepMinimumDepthM&&-elevation[i]>options.rules.surfaceLayerDepthM?1:0;
            if(value!==mask)return ['Глубинная маска не согласована с рельефом и правилами'];
          }
          if(frameIndex>0&&value!==ocean.deepMask[i])return ['Глубинная маска меняется между сезонами'];
        } else if(!inactive) {
          const min=field.endsWith('SalinityPsu')||field==='salinityPsu'||field==='deepSpeedMps'?0:field.endsWith('DensityKgM3')||field==='densityKgM3'?950:field==='deepTemperatureC'?-10:field==='verticalVelocityMps'?-1e-4:-1;
          const max=field.endsWith('SalinityPsu')||field==='salinityPsu'?50:field==='densityKgM3'?1100:field==='deepDensityKgM3'?1200:field==='deepTemperatureC'?60:field==='verticalVelocityMps'?1e-4:1;
          if(value<min-1e-9||value>max+1e-9)return [`Слой глубинного океана ${field} выходит за допустимый диапазон`];
        }
      }
    }
    for(const field of OCEAN_FIELDS) {
      const values=frame[field];
      if(!values||values.length!==size)return [`Повреждён слой океана ${field}`];
      for(let i=0;i<size;i++) {
        const value=values[i],land=elevation[i]>0;
        const min=field==='speedMps'||field==='coastInfluence'?0:field==='temperatureC'?(ocean.enabled?-10:-Infinity):field==='anomalyC'?-70:field==='airTemperatureCorrectionC'?-30:-5;
        const max=field==='coastInfluence'?1:field==='temperatureC'?(ocean.enabled?60:Infinity):field==='anomalyC'?70:field==='airTemperatureCorrectionC'?30:5;
        if(!Number.isFinite(value)||value<min-1e-9||value>max+1e-9||(land&&waterOnly.has(field)&&value!==0))return [`Некорректный слой океана ${field}, ячейка ${i}`];
        if(!ocean.enabled&&field!=='temperatureC'&&value!==0)return [`Отключённый океан содержит активный слой ${field}`];
      }
    }
    for(let i=0;i<size;i++) {
      const vectorSpeed=Math.hypot(frame.eastMps[i],frame.northMps[i]);
      // Annual speed is the mean of seasonal speeds, rather than the magnitude
      // of a mean vector: opposing seasonal directions may cancel.
      if(frameIndex===0?vectorSpeed>frame.speedMps[i]+1e-9:!close(vectorSpeed,frame.speedMps[i]))return [`Скорость океана не согласована с направлением, ячейка ${i}`];
      const deepSpeed=Math.hypot(frame.deepEastMps[i],frame.deepNorthMps[i]);
      if(frameIndex===0?deepSpeed>frame.deepSpeedMps[i]+1e-9:!close(deepSpeed,frame.deepSpeedMps[i]))return [`Глубинная скорость не согласована с направлением, ячейка ${i}`];
    }
  }
  for(const field of [...OCEAN_FIELDS,...THERMODYNAMIC_FIELDS.filter(field=>field!=='deepMask')])for(let i=0;i<size;i++) {
    const average=ocean.seasons.reduce((sum,season)=>sum+season[field][i]/4,0);
    if(!close(average,ocean[field][i]))return [`Годовой слой океана ${field} не согласован с сезонами`];
  }
  return errors;
}
