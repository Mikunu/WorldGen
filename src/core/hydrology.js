import {physicalRulesFor} from './physical-rules.js';
import {makeFormulaEvaluator} from './generation-formulas.js';

class Heap {
  values=[];
  less(a,b) {return a.height<b.height || (a.height===b.height && a.id<b.id);}
  push(value) {
    let i=this.values.length;this.values.push(value);
    while(i>0) {const p=(i-1)>>1;if(!this.less(value,this.values[p]))break;this.values[i]=this.values[p];i=p;}
    this.values[i]=value;
  }
  pop() {
    const result=this.values[0],tail=this.values.pop();
    if(this.values.length) {
      let i=0;
      while(i*2+1<this.values.length) {
        let child=i*2+1;
        if(child+1<this.values.length && this.less(this.values[child+1],this.values[child]))child++;
        if(!this.less(this.values[child],tail))break;
        this.values[i]=this.values[child];i=child;
      }
      this.values[i]=tail;
    }
    return result;
  }
}
export function hydrology(grid,elevation,runoffMm) {
  const visited=new Uint8Array(grid.size), downstream=new Int32Array(grid.size).fill(-1);
  const spillElevation=new Float64Array(elevation), lakeDepth=new Float64Array(grid.size), discharge=new Float64Array(grid.size), catchmentKm2=new Float64Array(grid.size);
  const basin=new Int32Array(grid.size).fill(-1),order=[],heap=new Heap();
  for(let i=0;i<grid.size;i++) if(elevation[i]<=0) {visited[i]=1;heap.push({id:i,height:0});basin[i]=i;spillElevation[i]=0;}
  if(!heap.values.length) throw new Error('Для стока нужен хотя бы один океанический участок.');
  while(heap.values.length) {
    const current=heap.pop(),i=current.id;order.push(i);
    for(const j of grid.neighbors(i)) {
      if(visited[j])continue;
      visited[j]=1;downstream[j]=i;basin[j]=elevation[i]<=0?j:basin[i];
      spillElevation[j]=Math.max(elevation[j],current.height);
      lakeDepth[j]=Math.max(0,spillElevation[j]-elevation[j]);
      heap.push({id:j,height:spillElevation[j]});
    }
  }
  const secondsPerYear=365.25*86400;let inputM3s=0,outputM3s=0;
  for(let i=0;i<grid.size;i++) if(elevation[i]>0) {
    discharge[i]=runoffMm[i]*grid.areaKm2[i]*1000/secondsPerYear;
    inputM3s+=discharge[i];catchmentKm2[i]=grid.areaKm2[i];
  }
  for(let k=order.length-1;k>=0;k--) {
    const i=order[k],j=downstream[i];
    if(j>=0) {discharge[j]+=discharge[i];catchmentKm2[j]+=catchmentKm2[i];}
    else outputM3s+=discharge[i];
  }
  return {downstream,spillElevation,lakeDepth,discharge,catchmentKm2,basin,order:Int32Array.from(order),inputM3s,outputM3s};
}
export function erode(grid,elevation,water,resistance,config={}) {
  if(resistance && (resistance.length!==grid.size || resistance.some(x=>!Number.isFinite(x) || x<0 || x>1)))throw new Error('Некорректная устойчивость пород');
  const rules=physicalRulesFor(config,'erosion');
  const formulas=makeFormulaEvaluator(config,config.seed),incisionFormula=formulas.has('erosion.incision');
  const delta=new Float64Array(grid.size);
  for(let i=0;i<grid.size;i++) {
    const j=water.downstream[i];
    if(j<0 || elevation[i]<=0 || water.lakeDepth[i]>1)continue;
    const slope=Math.max(0,elevation[i]-elevation[j])/Math.max(grid.distance(i,j)*1000,1);
    const rockResistance=resistance?.[i]??0;
    const builtin=Math.min(rules.incisionMaximum,rules.incisionFactor*Math.sqrt(water.discharge[i])*Math.sqrt(slope))*(1-rules.resistanceEffect*rockResistance);
    let cut=builtin;
    if(incisionFormula) {
      const p=grid.point(i);
      cut=formulas.evaluate('erosion.incision',{base:builtin,dischargeM3s:water.discharge[i],slope,resistance:rockResistance,elevationM:elevation[i],latitudeDeg:Math.asin(p[1])*180/Math.PI,longitudeDeg:Math.atan2(p[2],p[0])*180/Math.PI,isOcean:0,season:-1,x:p[0],y:p[1],z:p[2]},builtin,'Речной врез');
    }
    delta[i]-=cut;
    // Deposit a fraction on low-gradient reaches; the remainder leaves the surface model.
    if(elevation[j]>0 && slope<rules.depositionSlope) delta[j]+=cut*rules.depositionFraction*grid.areaKm2[i]/grid.areaKm2[j];
  }
  for(let i=0;i<grid.size;i++) elevation[i]+=delta[i];
}
