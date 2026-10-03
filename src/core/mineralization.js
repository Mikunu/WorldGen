import {clamp,normalize,dot,cross} from './grid.js';
import {random,hashSeed,fbm} from './random.js';
import {pointDistance,arcDistance,interpolateArc} from './spatial.js';

export function mineralizationPattern(key) {
  if(['hydrothermal','epithermal','orogenicFluid','metamorphicCarbon','iron'].includes(key))return 'structural';
  if(['felsic','maficIntrusion','ultramafic','pegmatite','alkalineIntrusion'].includes(key))return 'intrusion';
  if(['weatheredPlatform','ultramaficWeathering'].includes(key))return 'weathering';
  return 'basin';
}
export function buildMineralization(grid,geology,atlas,seed) {
  const features=[],rng=random(seed+':geological-features');
  // Nearby points form spherical fault arcs. No line is drawn through the map seam in pixel space.
  if(geology.boundary)for(let i=0;i<grid.size;i++) {
    if(!geology.boundary[i])continue;
    for(const j of grid.neighbors(i))if(j>i && geology.boundary[j] && grid.distance(i,j)<1800) {
      features.push({kind:'structural',a:grid.point(i),b:grid.point(j),widthKm:35+45*rng()});
    }
  }
  const magma=geology.magmaticMemory??geology.volcanism;
  const basin=atlas.sedimentThicknessM;
  for(let i=0;i<grid.size;i++) {
    if(geology.elevation[i]<=0)continue;
    const value=magma?.[i]??0,depth=basin?.[i]??0;
    const peak=(field,v)=>grid.neighbors(i).every(j=>field[j]<v || (field[j]===v && j>i));
    const center=grid.point(i);
    const east=normalize(cross(center,[0,1,0])),north=normalize(cross(east,center));
    const makeCenter=()=>{
      const shift=(rng()-.5)*Math.sqrt(grid.areaKm2[i])*.5,angle=shift/grid.radiusKm,bearing=rng()*Math.PI*2;
      const tangent=east.map((v,k)=>v*Math.cos(bearing)+north[k]*Math.sin(bearing));
      return center.map((v,k)=>v*Math.cos(angle)+tangent[k]*Math.sin(angle));
    };
    if(value>0.15 && peak(magma,value))features.push({kind:'intrusion',center:makeCenter(),widthKm:65+105*rng()});
    if(depth>400 && peak(basin,depth))features.push({kind:'basin',center:makeCenter(),widthKm:180+220*rng(),aspect:1.5+1.5*rng(),bearing:rng()*Math.PI*2});
  }
  return {version:1,seed,features};
}
function featureIndex(features,radiusKm) {
  const step=600/radiusKm,buckets=new Map();
  for(const f of features) {
    const center=f.center??interpolateArc(f.a,f.b,.5);
    const reach=((f.a?pointDistance(f.a,f.b,radiusKm)/2:0)+f.widthKm*3)/radiusKm;
    const low=center.map(v=>Math.floor((v-reach)/step)),high=center.map(v=>Math.floor((v+reach)/step));
    for(let x=low[0];x<=high[0];x++)for(let y=low[1];y<=high[1];y++)for(let z=low[2];z<=high[2];z++) {
      const key=`${x},${y},${z}`;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(f);
    }
  }
  return p=>buckets.get(p.map(v=>Math.floor(v/step)).join(','))??[];
}
function lensDistance(p,f,radiusKm) {
  if(!f.aspect)return pointDistance(p,f.center,radiusKm)/f.widthKm;
  const center=f.center,east=normalize(cross(center,[0,1,0])),north=normalize(cross(east,center));
  const length=pointDistance(p,center,radiusKm),tangent=p.map((v,k)=>v-dot(p,center)*center[k]),norm=Math.hypot(...tangent);
  if(norm<1e-12)return length/f.widthKm;
  const x=dot(tangent,east)/norm*length,y=dot(tangent,north)/norm*length;
  const u=x*Math.cos(f.bearing)+y*Math.sin(f.bearing),v=-x*Math.sin(f.bearing)+y*Math.cos(f.bearing);
  return Math.hypot(u/f.widthKm,v/(f.widthKm/f.aspect));
}
export function makeProspectivitySampler(grid,geology,atlas,seed=atlas.mineralization?.seed??'world') {
  const metadata=atlas.mineralization??{seed,features:[]},near=featureIndex(metadata.features,grid.radiusKm),noiseSeed=hashSeed(metadata.seed+':ore-belts');
  function detail(p) {
    const influences={structural:0,intrusion:0,basin:0,weathering:0};
    for(const f of near(p)) {
      const distance=f.kind==='structural'?arcDistance(p,f.a,f.b,grid.radiusKm)/f.widthKm:lensDistance(p,f,grid.radiusKm);
      if(distance<=3)influences[f.kind]=Math.max(influences[f.kind],Math.exp(-distance*distance));
    }
    // Domain-warped noise in Cartesian space makes continuous subgrid belts without latitude rows.
    const warp=p.map((v,k)=>v+(fbm(...p,noiseSeed+731*k,12,2)-.5)*.12);
    const ridge=Math.exp(-(((fbm(...warp,noiseSeed+47,48,3)-.5)/.065)**2));
    const patches=clamp((fbm(...warp,noiseSeed+137,65,3)-.25)*2,0,1);
    return {
      structural:clamp(influences.structural*.8+ridge*.6,0,1),
      intrusion:clamp(influences.intrusion*.85+patches*.45,0,1),
      basin:clamp(influences.basin*.65+patches*.65,0,1),
      weathering:patches
    };
  }
  function sample(rule,p,patternValues) {
    const cell=grid.sample(p);
    if(geology.elevation[cell]<=0 || grid.sampleField(geology.elevation,p)<=0)return {cell,environmentScore:0,beltStrength:0,formationScore:0};
    const env=atlas.environments[rule.key],environmentScore=env?clamp(grid.sampleField(env,p),0,1):0;
    if(environmentScore<rule.threshold)return {cell,environmentScore,beltStrength:0,formationScore:0};
    const beltStrength=(patternValues??detail(p))[mineralizationPattern(rule.key)];
    const formationScore=clamp(environmentScore*(.4+1.2*beltStrength),0,1);
    return {cell,environmentScore,beltStrength,formationScore};
  }
  function potential(rules,p) {
    let max=0,values;
    for(const rule of rules) {
      const env=atlas.environments[rule.key];if(!env || grid.sampleField(env,p)<rule.threshold)continue;
      values??=detail(p);max=Math.max(max,acceptance(rule,p,sample(rule,p,values)));
    }
    return max;
  }
  function acceptance(rule,p,site=sample(rule,p)) {
    let value=site.formationScore;
    if(value<=0)return 0;
    for(const zone of atlas.prospectivityZones??[]) {
      if(zone.modelIds && !zone.modelIds.includes(rule.id))continue;
      const distance=pointDistance(p,zone.area.center,grid.radiusKm);
      if(distance>=zone.area.radiusKm)continue;
      const weight=(1-distance/zone.area.radiusKm)**2;
      value*=1+zone.strength*weight;
    }
    return clamp(value,0,1);
  }
  return {sample,potential,detail,acceptance};
}
