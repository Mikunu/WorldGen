import {makeGrid} from './grid.js';
import {makeProspectivitySampler} from './mineralization.js';
import {effectiveDepositModels} from './atlas-rules.js';
import {minerals} from './geology-catalog.js';
import {makeFormulaEvaluator,MAX_FORMULA_OPERATIONS} from './generation-formulas.js';

export function potentialRaster(world,resource='all',{width=384,height=192}={}) {
  if(!Number.isInteger(width) || !Number.isInteger(height) || width<32 || width>768 || height<16 || height>384)throw new RangeError('Некорректный размер карты рудного потенциала');
  const mineral=Number(resource);
  if(resource!=='all' && (!Number.isInteger(mineral) || !minerals[mineral]))throw new RangeError('Неизвестный ресурс');
  const rules=effectiveDepositModels(world.atlas.generationRules??world.config).filter(m=>resource==='all' || m.components.some(c=>c.mineral===mineral));
  const formulas=makeFormulaEvaluator(world.atlas.generationRules??world.config);
  if(width*height*rules.length*formulas.cost('mineralization.formation')>MAX_FORMULA_OPERATIONS)throw new Error('Слишком большой расчёт формул рудного потенциала: упростите формулу или уменьшите размер карты');
  const grid=makeGrid(world.grid.width,world.grid.height,world.grid.radiusKm),pixels=makeGrid(width,height,world.grid.radiusKm);
  const sampler=makeProspectivitySampler(grid,world.geology,world.atlas),values=new Float32Array(pixels.size);
  for(let i=0;i<pixels.size;i++) {
    const p=pixels.point(i),cell=grid.sample(p);
    values[i]=world.geology.elevation[cell]<=0?-1:sampler.potential(rules,p);
  }
  return {width,height,resource,values};
}
