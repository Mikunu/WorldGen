import {makeGrid,normalize,cross,dot,clamp} from './grid.js';
import {hashSeed,fbm} from './random.js';
import {rocks} from './geology-catalog.js';
import {geologicalColumn} from './geological-atlas.js';

// Refinement inherits the saved planet's geology and resource bodies.
export function refineRegion(world,cell,{size=65,spanKm=700,centerPosition=null}={}) {
  if(!Number.isInteger(cell) || cell<0 || cell>=world.grid.size)throw new RangeError('Некорректный центр региона');
  if(!Number.isInteger(size) || size<15 || size>129 || size%2===0)throw new RangeError('Размер региональной сетки: нечётное число от 15 до 129');
  if(!Number.isFinite(spanKm) || spanKm<100 || spanKm>2500)throw new RangeError('Протяжённость региона: 100–2500 км');
  const grid=makeGrid(world.grid.width,world.grid.height,world.grid.radiusKm);
  if(centerPosition && (!Array.isArray(centerPosition) || centerPosition.length!==3 || centerPosition.some(v=>!Number.isFinite(v)) || Math.abs(Math.hypot(...centerPosition)-1)>1e-10 || grid.sample(centerPosition)!==cell))throw new RangeError('Некорректный центр региона на сфере');
  const center=centerPosition??grid.point(cell),reference=Math.abs(center[1])>.999999999?[0,0,1]:[0,1,0];
  const east=normalize(cross(center,reference)),north=normalize(cross(east,center)),noiseSeed=hashSeed(world.config.seed+':regional-detail');
  const count=size*size,parentCell=new Int32Array(count),elevation=new Float64Array(count),surfaceRock=new Uint8Array(count),provinceId=new Int32Array(count),latitude=new Float64Array(count),longitude=new Float64Array(count);
  const layerThicknessM=new Float64Array(count*4),layerRock=new Uint8Array(count*4),layerAgeMa=new Float64Array(count*4),hostNoise=new Map();
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const i=y*size+x,dx=(x/(size-1)-0.5)*spanKm,dy=(0.5-y/(size-1))*spanKm,distance=Math.hypot(dx,dy),angle=distance/grid.radiusKm;
    const tangent=distance?east.map((v,k)=>(v*dx+north[k]*dy)/distance):[0,0,0];
    const p=center.map((v,k)=>v*Math.cos(angle)+tangent[k]*Math.sin(angle)),host=grid.sample(p);
    parentCell[i]=host;surfaceRock[i]=world.atlas.surfaceRock[host];provinceId[i]=world.atlas.provinceId[host];
    latitude[i]=Math.asin(clamp(p[1],-1,1))*180/Math.PI;longitude[i]=Math.atan2(p[2],p[0])*180/Math.PI;
    if(!hostNoise.has(host))hostNoise.set(host,fbm(...grid.point(host),noiseSeed,150,3));
    const detail=fbm(...p,noiseSeed,150,3)-hostNoise.get(host),base=grid.sampleField(world.geology.elevation,p);
    const refined=base+detail*180*(0.4+rocks[surfaceRock[i]].resistance*0.6);
    elevation[i]=world.geology.elevation[host]>0?Math.max(0.01,refined):Math.min(0,refined);
    const column=geologicalColumn(world.atlas,host),factor=1+detail*0.18;let upperThickness=0;
    for(let k=0;k<4;k++) {
      const slot=i*4+k;layerRock[slot]=column[k].rock;layerAgeMa[slot]=column[k].ageMa;
      layerThicknessM[slot]=k<3?(column[k].bottomM-column[k].topM)*factor:12000-upperThickness;
      if(k<3)upperThickness+=layerThicknessM[slot];
    }
  }
  const deposits=[];
  for(const deposit of world.atlas.deposits) {
    const p=deposit.position,cos=clamp(dot(center,p),-1,1),angle=Math.acos(cos),length=Math.sin(angle);
    if(length<1e-9 && angle>1)continue;
    const factor=length>1e-9?angle/length:1,dx=dot(p,east)*factor*grid.radiusKm,dy=dot(p,north)*factor*grid.radiusKm;
    if(Math.abs(dx)<=spanKm/2 && Math.abs(dy)<=spanKm/2)deposits.push({id:deposit.id,oreBodyId:deposit.oreBodyId,sizeClass:deposit.sizeClass,mineral:deposit.mineral,x:(dx/spanKm+0.5)*(size-1),y:(0.5-dy/spanKm)*(size-1)});
  }
  return {centerCell:cell,centerPosition:[...center],size,spanKm,resolutionKm:spanKm/(size-1),parentCell,elevation,surfaceRock,provinceId,latitude,longitude,layerThicknessM,layerRock,layerAgeMa,deposits};
}
