import {random, hashSeed, fbm} from './random.js';
import {dot, cross, normalize, rotate, clamp} from './grid.js';

export function tectonics(grid, config, progress) {
  const rng = random(config.seed + ':tectonics'), noiseSeed = hashSeed(config.seed + ':crust');
  const plates = Array.from({length:config.plateCount}, (_,id) => {
    const y = 1 - 2*(id+0.5)/config.plateCount, angle=id*2.399963229728653+rng()*0.6;
    return {id, center:normalize([Math.sqrt(1-y*y)*Math.cos(angle),y,Math.sqrt(1-y*y)*Math.sin(angle)]),
      omega:normalize([rng()-0.5,rng()-0.5,rng()-0.5]).map(v=>v*(0.0007+rng()*0.0008)), continentalBias:rng()*0.3-0.15};
  });
  let plateId = new Uint16Array(grid.size), crust = new Float64Array(grid.size), uplift = new Float64Array(grid.size);
  let ageMa = new Float64Array(grid.size);
  let compressionMemory=new Float64Array(grid.size),extensionMemory=new Float64Array(grid.size),magmaticMemory=new Float64Array(grid.size);
  const boundary = new Int8Array(grid.size), stress = new Float64Array(grid.size), volcanism = new Float64Array(grid.size);
  function assign() {
    for (let i=0;i<grid.size;i++) {
      const p=grid.point(i); let best=-Infinity, id=0;
      for (const plate of plates) {const d=dot(p,plate.center); if(d>best) {best=d;id=plate.id;}}
      plateId[i]=id;
    }
  }
  assign();
  for (let i=0;i<grid.size;i++) {
    const p=grid.point(i), value=fbm(...p,noiseSeed,2.4,4)+plates[plateId[i]].continentalBias;
    crust[i]=clamp((value-0.39)*4,0,1);
    ageMa[i]=30+500*fbm(...p,noiseSeed+109,3,3);
  }
  const snapshots=[];
  for (let step=0;step<config.epochs;step++) {
    const oldIds=plateId, nextCrust=new Float64Array(grid.size), nextUplift=new Float64Array(grid.size), nextAge=new Float64Array(grid.size);
    const nextCompression=new Float64Array(grid.size),nextExtension=new Float64Array(grid.size),nextMagmatic=new Float64Array(grid.size);
    for(const plate of plates) plate.center=rotate(plate.center,plate.omega,config.epochMa);
    plateId=new Uint16Array(grid.size); assign();
    for(let i=0;i<grid.size;i++) {
      const p=grid.point(i), plate=plates[plateId[i]], origin=rotate(p,plate.omega,-config.epochMa),source=grid.sample(origin);
      nextCrust[i]=grid.sampleField(crust,origin); nextUplift[i]=grid.sampleField(uplift,origin)*0.987; nextAge[i]=grid.sampleField(ageMa,origin)+config.epochMa;
      nextCompression[i]=grid.sampleField(compressionMemory,origin)*0.99;
      nextExtension[i]=grid.sampleField(extensionMemory,origin)*0.99;
      nextMagmatic[i]=grid.sampleField(magmaticMemory,origin)*0.997;
      boundary[i]=0; stress[i]=0; volcanism[i]=0;
      let strongest=0;
      for(const j of grid.neighbors(i)) {
        if(plateId[j]===plateId[i]) continue;
        const q=grid.point(j), along=normalize(q.map((v,k)=>v-p[k]));
        const vi=cross(plate.omega,p), vj=cross(plates[plateId[j]].omega,q);
        const convergence=dot(vi.map((v,k)=>v-vj[k]),along);
        if(Math.abs(convergence)>Math.abs(strongest)) strongest=convergence;
      }
      stress[i]=strongest;
      if(Math.abs(strongest)>0.00012) {
        boundary[i]=strongest>0 ? 1 : -1;
        const continental=nextCrust[i]>0.52;
        nextUplift[i]+=strongest*config.epochMa*(strongest>0 ? (continental?145000:85000) : (continental?60000:18000));
        if(strongest>0 && nextCrust[i]<0.85) volcanism[i]=clamp(strongest/0.002,0,1);
        nextCompression[i]+=Math.max(0,strongest)*config.epochMa*145000;
        nextExtension[i]+=Math.max(0,-strongest)*config.epochMa*60000;
        nextMagmatic[i]=clamp(nextMagmatic[i]+volcanism[i]*config.epochMa*0.035,0,1);
        if(strongest<0 && !continental) nextAge[i]=Math.min(nextAge[i],config.epochMa*2);
      } else if(grid.neighbors(i).some(j=>plateId[j]!==plateId[i])) boundary[i]=2;
      nextUplift[i]=clamp(nextUplift[i],-2200,8500);
      // Newly assigned cells retain advected material: crust is not redrawn from plate identity.
      if(oldIds[source]!==plateId[i]) nextCrust[i]=0.95*nextCrust[i]+0.05*crust[i];
    }
    // Relax short-wavelength deformation while keeping old mountain belts.
    for(let i=0;i<grid.size;i++) {
      const ns=grid.neighbors(i), mean=ns.reduce((a,j)=>a+nextUplift[j],0)/ns.length;
      uplift[i]=nextUplift[i]*0.72+mean*0.28;
    }
    crust=nextCrust; ageMa=nextAge;compressionMemory=nextCompression;extensionMemory=nextExtension;magmaticMemory=nextMagmatic;
    if(step===0 || step===config.epochs-1 || (step+1)%8===0) snapshots.push({elapsedMa:(step+1)*config.epochMa,plateCenters:plates.map(p=>[...p.center])});
    if(step%4===0) progress?.(`Тектоника: ${step+1}/${config.epochs}`);
  }
  const elevation=new Float64Array(grid.size);
  for(let i=0;i<grid.size;i++) {
    const p=grid.point(i);
    const base=-4600+crust[i]*6500;
    elevation[i]=base+uplift[i]+(fbm(...p,noiseSeed+717,12,3)-0.5)*850;
  }
  // Sea level is chosen by area, not by number of distorted projection pixels.
  const sorted=Array.from(elevation, (height,i)=>({height,area:grid.areaKm2[i]})).sort((a,b)=>a.height-b.height);
  const target=4*Math.PI*grid.radiusKm**2*config.oceanFraction; let accumulated=0,seaLevel=sorted[0].height;
  for(const cell of sorted) {accumulated+=cell.area;seaLevel=cell.height;if(accumulated>=target)break;}
  for(let i=0;i<grid.size;i++) elevation[i]-=seaLevel;
  return {plates,plateId,crust,ageMa,uplift,elevation,boundary,stress,volcanism,compressionMemory,extensionMemory,magmaticMemory,snapshots,seaLevelOffsetM:seaLevel};
}
