import {clamp,dot,cross,normalize} from './grid.js';

export function sphericalPoint(latitudeDeg,longitudeDeg) {
  const lat=latitudeDeg*Math.PI/180,lon=longitudeDeg*Math.PI/180;
  return [Math.cos(lat)*Math.cos(lon),Math.sin(lat),Math.cos(lat)*Math.sin(lon)];
}
export function pointCoordinates(p) {
  return {latitudeDeg:Math.asin(clamp(p[1],-1,1))*180/Math.PI,longitudeDeg:Math.atan2(p[2],p[0])*180/Math.PI};
}
export function uniformSphere(rng) {
  // Uniform sin(latitude), not uniform latitude: equal physical area near the poles.
  const y=rng()*2-1,lon=rng()*2*Math.PI-Math.PI,r=Math.sqrt(Math.max(0,1-y*y));
  return [r*Math.cos(lon),y,r*Math.sin(lon)];
}
export function pointDistance(a,b,radiusKm) {
  return radiusKm*Math.atan2(Math.hypot(...cross(a,b)),clamp(dot(a,b),-1,1));
}
export function interpolateArc(a,b,t) {
  const angle=Math.acos(clamp(dot(a,b),-1,1)),s=Math.sin(angle);
  if(Math.abs(s)<1e-10)return normalize(a.map((v,k)=>v*(1-t)+b[k]*t));
  return a.map((v,k)=>(v*Math.sin((1-t)*angle)+b[k]*Math.sin(t*angle))/s);
}
export function arcDistance(p,a,b,radiusKm) {
  const normal=cross(a,b),length=Math.hypot(...normal);
  if(length<1e-10)return Math.min(pointDistance(p,a,radiusKm),pointDistance(p,b,radiusKm));
  const n=normal.map(v=>v/length),projection=p.map((v,k)=>v-dot(p,n)*n[k]);
  if(Math.hypot(...projection)<1e-10)return Math.min(pointDistance(p,a,radiusKm),pointDistance(p,b,radiusKm));
  const q=normalize(projection),lengthKm=pointDistance(a,b,radiusKm);
  if(pointDistance(a,q,radiusKm)+pointDistance(q,b,radiusKm)<=lengthKm+1e-6)return pointDistance(p,q,radiusKm);
  return Math.min(pointDistance(p,a,radiusKm),pointDistance(p,b,radiusKm));
}
export function mapPoint(p) {
  const {latitudeDeg,longitudeDeg}=pointCoordinates(p);
  return {x:(longitudeDeg+180)/360,y:(90-latitudeDeg)/180};
}
export function pickDeposit(deposits,x,y,width,height,filter=()=>true,maxPixels=10) {
  let nearest=null,best=maxPixels;
  for(const d of deposits) {
    if(!filter(d))continue;const p=mapPoint(d.position);
    const dx=Math.abs(p.x-x),distance=Math.hypot(Math.min(dx,1-dx)*width,(p.y-y)*height);
    if(distance<best){best=distance;nearest=d;}
  }
  return nearest;
}

// Hash the Cartesian unit sphere, so proximity works across longitude seams and poles.
export function proximityIndex(radiusKm,spacingKm) {
  const step=2*Math.sin(spacingKm/(2*radiusKm)),buckets=new Map();
  const coord=p=>p.map(v=>Math.floor(v/step)),key=c=>c.join(',');
  return {
    add(p){const c=coord(p),k=key(c);if(!buckets.has(k))buckets.set(k,[]);buckets.get(k).push(p);},
    near(p,distanceKm=spacingKm){
      const c=coord(p),reach=Math.ceil(2*Math.sin(distanceKm/(2*radiusKm))/step);
      for(let x=-reach;x<=reach;x++)for(let y=-reach;y<=reach;y++)for(let z=-reach;z<=reach;z++) {
        for(const q of buckets.get(key([c[0]+x,c[1]+y,c[2]+z]))??[])if(pointDistance(p,q,radiusKm)<distanceKm)return true;
      }
      return false;
    }
  };
}
