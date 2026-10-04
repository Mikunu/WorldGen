import {clamp} from './core/grid.js';
import {rocks,provinceTypes,minerals} from './core/geology-catalog.js';
import {geologicalColumn} from './core/geological-atlas.js';
import {depositMatches} from './core/deposit-models.js';
import {mapPoint} from './core/spatial.js';
import {layerOpacity,normalizeLayerOpacity,visibleLayers} from './core/map-layers.js';
export const palettes={
  elevation:[[-7000,[10,31,48]],[-3500,[18,60,83]],[-500,[43,103,119]],[0,[84,135,144]],[1,[132,158,102]],[450,[150,171,111]],[1200,[184,172,126]],[2400,[153,123,98]],[4200,[164,155,142]],[6500,[239,238,222]]],
  temperature:[[-45,[67,78,145]],[-15,[76,134,181]],[0,[170,201,207]],[15,[235,224,159]],[30,[204,112,63]],[50,[142,42,41]]],
  precipitation:[[0,[183,151,105]],[250,[212,195,139]],[700,[144,174,139]],[1500,[69,128,137]],[3000,[44,71,119]]],
  flow:[[0,[48,64,68]],[2,[75,112,122]],[3,[63,154,176]],[4,[122,218,225]],[5,[220,252,247]]],
  sediments:[[0,[198,192,179]],[500,[194,179,126]],[1500,[144,158,105]],[4000,[56,106,98]]],
  fertility:[[0,[180,160,120]],[0.35,[181,188,129]],[0.65,[99,145,101]],[1,[37,85,62]]],
  hazards:[[0,[220,220,200]],[0.3,[219,190,120]],[0.6,[196,118,69]],[1,[133,44,43]]]
};
palettes.potential=[[0,[151,153,128]],[0.3,[182,167,103]],[0.6,[194,133,62]],[1,[128,59,40]]];
palettes.seaTemperature=palettes.temperature;
palettes.oceanCurrents=[[0,[24,67,91]],[.1,[50,121,150]],[.5,[116,190,191]],[1.5,[237,225,151]]];
palettes.deepCurrents=[[0,[31,65,89]],[.15,[62,122,148]],[.5,[121,182,181]],[1,[225,202,134]]];
palettes.salinity=[[28,[87,145,177]],[34,[157,196,181]],[37,[229,189,115]],[41,[185,91,70]]];
palettes.density=[[1018,[86,137,167]],[1024,[136,180,170]],[1028,[225,193,115]],[1032,[172,78,69]]];
palettes.vertical=[[-.00001,[161,76,73]],[0,[217,216,188]],[.00001,[68,137,161]]];
export const biomeColors=['#143f54','#e5e9e3','#a7b3a1','#ceaf7b','#a9a367','#617f63','#8b9c57','#315e50','#999b94'];
export function color(value,stops) {
  for(let k=1;k<stops.length;k++)if(value<=stops[k][0]) {
    const a=stops[k-1],b=stops[k],t=clamp((value-a[0])/(b[0]-a[0]),0,1);
    return a[1].map((v,j)=>Math.round(v+(b[1][j]-v)*t));
  }
  return stops.at(-1)[1];
}
function plateColor(id) {
  const h=(id*137.508+25)%360,s=0.29,l=0.55;
  const f=n=>{const k=(n+h/30)%12,a=s*Math.min(l,1-l);return 255*(l-a*Math.max(-1,Math.min(k-3,9-k,1)));};
  return [f(0),f(8),f(4)];
}
const hexRgb=hex=>[1,3,5].map(k=>parseInt(hex.slice(k,k+2),16));
export function drawMap(canvas,w,options) {
  const ctx=canvas.getContext('2d'),{width,height}=w.grid,activeLayers=visibleLayers(options),opacities=normalizeLayerOpacity(options.layerOpacity),appearance=w.editor?.appearance??{};
  const screenScale=Number.isFinite(options.screenScale)&&options.screenScale>0?options.screenScale:1,unit=value=>value*screenScale,markerScale=(appearance.markerScale??1)*unit(1);
  const season=options.season==='annual'?w.climate:w.climate.seasons[Number(options.season)],ocean=w.climate.ocean,oceanSeason=options.season==='annual'?ocean:ocean?.seasons?.[Number(options.season)],oceanEnabled=!!ocean?.enabled&&!!oceanSeason,thermoEnabled=oceanEnabled&&!!ocean?.thermodynamicsEnabled&&!!oceanSeason?.thermodynamicsEnabled;
  const sea=i=>w.geology.elevation[i]<=0;
  const theme=appearance.theme==='parchment'?'sepia(0.7) saturate(0.65)':appearance.theme==='muted'?'saturate(0.55)':'none';
  const elevationRequested=Array.isArray(options.layers)?options.layers.includes('elevation'):options.layer==='elevation';
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#17282d';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.filter='none';ctx.globalAlpha=1;
  const renderRaster=(layer,opacity=layerOpacity(opacities,layer))=>{
    if(layer==='potential'&&!options.potentialRaster)return;
    if((layer==='seaTemperature'||layer==='oceanCurrents')&&!oceanEnabled)return;
    if(['seaSalinity','seaDensity','deepTemperature','deepSalinity','deepDensity','deepCurrents','oceanVerticalExchange'].includes(layer)&&!thermoEnabled)return;
    const potential=layer==='potential'&&options.potentialRaster;
    const sourceWidth=potential?options.potentialRaster.width:width,sourceHeight=potential?options.potentialRaster.height:height,image=new ImageData(sourceWidth,sourceHeight);
    if(potential) {
      for(let i=0;i<options.potentialRaster.values.length;i++) {
        const value=options.potentialRaster.values[i],rgb=value<0?[25,65,83]:color(value,palettes.potential),at=i*4;
        image.data[at]=rgb[0];image.data[at+1]=rgb[1];image.data[at+2]=rgb[2];image.data[at+3]=255;
      }
    } else for(let i=0;i<w.grid.size;i++) {
      let rgb,alpha=255,shade=1;
      if(layer==='plates')rgb=plateColor(w.geology.plateId[i]);
      else if(layer==='rocks')rgb=hexRgb(rocks[w.atlas.surfaceRock[i]].color);
      else if(layer==='provinces')rgb=hexRgb(provinceTypes[w.atlas.provinceType[i]].color);
      else if(layer==='sediments')rgb=sea(i)?[25,65,83]:color(w.atlas.sedimentThicknessM[i],palettes.sediments);
      else if(layer==='fertility')rgb=sea(i)?[25,65,83]:color(w.atlas.fertility[i],palettes.fertility);
      else if(layer==='hazards')rgb=sea(i)?[25,65,83]:color(w.atlas.hazards[options.hazard??'earthquake'][i],palettes.hazards);
      else if(layer==='resources') {rgb=sea(i)?[25,65,83]:[50,63,47];alpha=sea(i)?0:82;}
      else if(layer==='boundaries') {rgb=w.geology.boundary[i]===1?[216,110,72]:w.geology.boundary[i]===-1?[92,175,190]:[200,177,102];alpha=w.geology.boundary[i]?255:0;}
      else if(layer==='temperature')rgb=color(season.temperature[i],palettes.temperature);
      else if(layer==='precipitation')rgb=color(season.precipitation[i],palettes.precipitation);
      else if(layer==='seaTemperature') {rgb=color(oceanSeason.temperatureC[i],palettes.temperature);alpha=sea(i)?255:0;}
      else if(layer==='seaSalinity') {rgb=color(oceanSeason.salinityPsu[i],palettes.salinity);alpha=sea(i)?255:0;}
      else if(layer==='seaDensity') {rgb=color(oceanSeason.densityKgM3[i],palettes.density);alpha=sea(i)?255:0;}
      else if(layer==='oceanCurrents') {rgb=color(oceanSeason.speedMps[i],palettes.oceanCurrents);alpha=sea(i)?Math.round(clamp(oceanSeason.speedMps[i]/1.5,0,1)*210):0;}
      else if(layer==='deepTemperature') {rgb=color(oceanSeason.deepTemperatureC[i],palettes.temperature);alpha=oceanSeason.deepMask[i]?255:0;}
      else if(layer==='deepSalinity') {rgb=color(oceanSeason.deepSalinityPsu[i],palettes.salinity);alpha=oceanSeason.deepMask[i]?255:0;}
      else if(layer==='deepDensity') {rgb=color(oceanSeason.deepDensityKgM3[i],palettes.density);alpha=oceanSeason.deepMask[i]?255:0;}
      else if(layer==='deepCurrents') {const normalized=Math.log1p(Math.max(0,oceanSeason.deepSpeedMps[i])/1e-8)/Math.log1p(.2/1e-8);rgb=color(normalized,palettes.deepCurrents);alpha=oceanSeason.deepMask[i]?Math.round(clamp(normalized,0,1)*210):0;}
      else if(layer==='oceanVerticalExchange') {const velocity=oceanSeason.verticalVelocityMps[i],normalized=Math.sign(velocity)*Math.log1p(Math.abs(velocity)/1e-10)/Math.log1p(1e-5/1e-10);rgb=color(normalized*1e-5,palettes.vertical);alpha=oceanSeason.deepMask[i]?220:0;}
      else if(layer==='flow') {const flow=Math.log10(1+w.water.discharge[i]);rgb=color(flow,palettes.flow);alpha=sea(i)?0:Math.round(clamp(flow/5,0,1)*220);}
      else if(layer==='biome')rgb=hexRgb(biomeColors[w.climate.biome[i]]);
      else {
        rgb=color(w.geology.elevation[i],palettes.elevation);
        if(!sea(i)) {
          const x=i%width,y=Math.floor(i/width),west=y*width+(x-1+width)%width,north=Math.max(0,y-1)*width+x;
          shade=clamp(1-(w.geology.elevation[i]-w.geology.elevation[west])*0.00018-(w.geology.elevation[i]-w.geology.elevation[north])*0.00012,0.64,1.18);
          if(w.water.lakeDepth[i]>80)rgb=[70,133,156];
        }
      }
      const at=i*4;image.data[at]=clamp(rgb[0]*shade,0,255);image.data[at+1]=clamp(rgb[1]*shade,0,255);image.data[at+2]=clamp(rgb[2]*shade,0,255);image.data[at+3]=alpha;
    }
    const offscreen=document.createElement('canvas');offscreen.width=sourceWidth;offscreen.height=sourceHeight;offscreen.getContext('2d').putImageData(image,0,0);
    ctx.imageSmoothingEnabled=!['rocks','provinces','boundaries'].includes(layer);ctx.globalAlpha=opacity;ctx.filter=theme;
    ctx.drawImage(offscreen,0,0,canvas.width,canvas.height);ctx.filter='none';ctx.globalAlpha=1;
  };
  // Elevation remains the physical backdrop when it is absent from the layer list.
  renderRaster('elevation',elevationRequested?layerOpacity(opacities,'elevation'):1);
  for(const layer of activeLayers)if(layer!=='elevation')renderRaster(layer);
  const sx=canvas.width/width,sy=canvas.height/height;
  if(activeLayers.includes('oceanCurrents')&&oceanEnabled) {
    const stride=Math.max(1,Math.ceil(width/24));
    const arrowUnit=value=>unit(value/Math.max(1,options.mapZoom??1));
    ctx.strokeStyle='#edf8f2d9';ctx.fillStyle='#edf8f2d9';ctx.lineWidth=arrowUnit(1.15);ctx.lineCap='round';
    for(let y=stride>>1;y<height;y+=stride)for(let x=stride>>1;x<width;x+=stride) {
      const i=y*width+x,speed=oceanSeason.speedMps[i],east=oceanSeason.eastMps[i],north=oceanSeason.northMps[i];
      // East becomes undefined at the poles in an equirectangular display; avoid a false arrow there.
      if(!sea(i)||!Number.isFinite(speed)||speed<=1e-9||!Number.isFinite(east)||!Number.isFinite(north)||Math.abs(Math.cos(w.grid.latitude[i]))<.08)continue;
      const magnitude=Math.hypot(east,north);if(magnitude<=1e-9)continue;
      const length=arrowUnit(clamp(5+Math.sqrt(speed)*5,5,12)),dx=east/magnitude*length,dy=-north/magnitude*length;
      const ax=(x+.5)*sx,ay=(y+.5)*sy,bx=ax+dx,by=ay+dy,head=arrowUnit(3);
      ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.lineTo(bx-dx/length*head+dy/length*head*.65,by-dy/length*head-dx/length*head*.65);ctx.moveTo(bx,by);ctx.lineTo(bx-dx/length*head-dy/length*head*.65,by-dy/length*head+dx/length*head*.65);ctx.stroke();
    }
  }
  if(activeLayers.includes('deepCurrents')&&thermoEnabled) {
    const stride=Math.max(1,Math.ceil(width/24)),arrowUnit=value=>unit(value/Math.max(1,options.mapZoom??1));
    ctx.strokeStyle='#f4e9d5d9';ctx.lineWidth=arrowUnit(1.15);ctx.lineCap='round';
    for(let y=stride>>1;y<height;y+=stride)for(let x=stride>>1;x<width;x+=stride) {
      const i=y*width+x,speed=oceanSeason.deepSpeedMps[i],east=oceanSeason.deepEastMps[i],north=oceanSeason.deepNorthMps[i];
      if(!oceanSeason.deepMask[i]||!Number.isFinite(speed)||speed<=1e-9||!Number.isFinite(east)||!Number.isFinite(north)||Math.abs(Math.cos(w.grid.latitude[i]))<.08)continue;
      const magnitude=Math.hypot(east,north);if(magnitude<=1e-9)continue;
      const length=arrowUnit(clamp(5+Math.sqrt(speed)*5,5,12)),dx=east/magnitude*length,dy=-north/magnitude*length,ax=(x+.5)*sx,ay=(y+.5)*sy,bx=ax+dx,by=ay+dy,head=arrowUnit(3);
      ctx.beginPath();ctx.moveTo(ax,ay);ctx.lineTo(bx,by);ctx.lineTo(bx-dx/length*head+dy/length*head*.65,by-dy/length*head-dx/length*head*.65);ctx.moveTo(bx,by);ctx.lineTo(bx-dx/length*head-dy/length*head*.65,by-dy/length*head+dx/length*head*.65);ctx.stroke();
    }
  }
  if(options.coasts) {
    ctx.beginPath();ctx.strokeStyle=activeLayers.includes('elevation')?'#e1e7ca66':'#f4f2df88';ctx.lineWidth=unit(.8);
    for(let i=0;i<w.grid.size;i++) {
      const x=i%width,y=Math.floor(i/width),east=y*width+(x+1)%width,south=Math.min(height-1,y+1)*width+x;
      if(sea(i)!==sea(east)){ctx.moveTo((x+1)*sx,y*sy);ctx.lineTo((x+1)*sx,(y+1)*sy);}
      if(sea(i)!==sea(south)){ctx.moveTo(x*sx,(y+1)*sy);ctx.lineTo((x+1)*sx,(y+1)*sy);}
    }ctx.stroke();
  }
  if(options.rivers) {
    const threshold=Math.max(350,w.summary.runoffM3s/450);
    ctx.strokeStyle=activeLayers.includes('flow')?'#b1f0f5':'#78c5dc';
    for(let i=0;i<w.grid.size;i++) {
      const j=w.water.downstream[i],flow=w.water.discharge[i];if(j<0 || flow<threshold || sea(i))continue;
      const ax=(i%width+0.5)*sx,ay=(Math.floor(i/width)+0.5)*sy,bx=(j%width+0.5)*sx,by=(Math.floor(j/width)+0.5)*sy;
      // Split meridian crossings rather than drawing a line across the whole map.
      ctx.beginPath();ctx.lineWidth=unit(clamp(Math.log10(flow/threshold+1)*1.6,.6,3.3));
      if(Math.abs(bx-ax)>canvas.width/2) {
        const wrap=bx<ax?canvas.width:-canvas.width;ctx.moveTo(ax,ay);ctx.lineTo(bx+wrap,by);ctx.moveTo(ax-wrap,ay);ctx.lineTo(bx,by);
      } else if(Math.abs(by-ay)<canvas.height/4) {ctx.moveTo(ax,ay);ctx.lineTo(bx,by);}
      ctx.stroke();
    }
  }
  if(options.graticule) {
    ctx.beginPath();ctx.strokeStyle='#ffffff25';ctx.lineWidth=unit(1);
    for(let lon=1;lon<12;lon++){ctx.moveTo(canvas.width*lon/12,0);ctx.lineTo(canvas.width*lon/12,canvas.height);}
    for(let lat=1;lat<6;lat++){ctx.moveTo(0,canvas.height*lat/6);ctx.lineTo(canvas.width,canvas.height*lat/6);}ctx.stroke();
  }
  if(activeLayers.includes('provinces')) {
    ctx.beginPath();ctx.strokeStyle='#303d3655';ctx.lineWidth=unit(.7);
    for(let i=0;i<w.grid.size;i++) {
      const x=i%width,y=Math.floor(i/width),east=y*width+(x+1)%width,south=Math.min(height-1,y+1)*width+x;
      if(w.atlas.provinceId[i]!==w.atlas.provinceId[east]){ctx.moveTo((x+1)*sx,y*sy);ctx.lineTo((x+1)*sx,(y+1)*sy);}
      if(w.atlas.provinceId[i]!==w.atlas.provinceId[south]){ctx.moveTo(x*sx,(y+1)*sy);ctx.lineTo((x+1)*sx,(y+1)*sy);}
    }ctx.stroke();
  }
  if(activeLayers.includes('resources')) {
    ctx.globalAlpha=(appearance.opacity??1)*layerOpacity(opacities,'resources');
    ctx.font=`bold ${unit(11)}px Segoe UI`;ctx.textAlign='left';
    const bodies=new Map();
    for(const d of w.atlas.deposits)if(depositMatches(d,options) && !bodies.has(d.oreBodyId))bodies.set(d.oreBodyId,d);
    const visible=[...bodies.values()].sort((a,b)=>(a.sizeClass==='major')-(b.sizeClass==='major'));
    const labelRects=[];
    for(const d of visible) {
      const p=mapPoint(d.position),x=p.x*canvas.width,y=p.y*canvas.height,m=minerals[d.mineral];
      const radius=(d.sizeClass==='major'?5:2.2)*markerScale;
      ctx.beginPath();ctx.arc(x,y,radius,0,Math.PI*2);ctx.fillStyle=m.color;ctx.fill();ctx.strokeStyle='#20363a';ctx.lineWidth=unit(d.sizeClass==='major'?1:.5);ctx.stroke();
      const duplicate=x<unit(6)?x+canvas.width:x>canvas.width-unit(6)?x-canvas.width:null;
      if(duplicate!==null){ctx.beginPath();ctx.arc(duplicate,y,radius,0,Math.PI*2);ctx.fill();ctx.stroke();}
      if(d.locked){ctx.beginPath();ctx.arc(x,y,radius+unit(2),0,Math.PI*2);ctx.strokeStyle='#fff5d9';ctx.lineWidth=unit(1);ctx.stroke();}
      if(appearance.labels!==false && (d.name || options.resource!=='all') && (d.name || d.sizeClass==='major' || d.cell===options.selected)) {
        const label=d.name||m.symbol,right=x+unit(8)+ctx.measureText(label).width;
        if(!labelRects.some(r=>x+unit(7)<r.right && right>r.left && Math.abs(y-r.y)<unit(12))) {
          ctx.strokeStyle='#182c32';ctx.lineWidth=unit(3);ctx.strokeText(label,x+unit(7),y+unit(3));ctx.fillStyle=m.color;ctx.fillText(label,x+unit(7),y+unit(3));
          labelRects.push({left:x+unit(7),right,y});
        }
      }
    }
    ctx.globalAlpha=1;
  }
  if(activeLayers.includes('plates')) {
    ctx.font=`bold ${unit(15)}px Segoe UI`;ctx.textAlign='center';ctx.fillStyle='#172c33';
    for(const p of w.geology.plates) {
      const x=(Math.atan2(p.center[2],p.center[0])+Math.PI)/(2*Math.PI)*canvas.width,y=(Math.PI/2-Math.asin(p.center[1]))/Math.PI*canvas.height;
      ctx.fillText(String(p.id+1),x,y);
    }
  }
  if(options.selected!==null) {
    const p=options.selectedPosition?mapPoint(options.selectedPosition):null;
    const x=p?p.x*canvas.width:(options.selected%width+0.5)*sx,y=p?p.y*canvas.height:(Math.floor(options.selected/width)+0.5)*sy;
    ctx.beginPath();ctx.arc(x,y,unit(7),0,Math.PI*2);ctx.strokeStyle='#18272c';ctx.lineWidth=unit(3);ctx.stroke();ctx.strokeStyle='#fff8dc';ctx.lineWidth=unit(1.5);ctx.stroke();
  }
  if(appearance.labels!==false) {
    ctx.font=`${unit(12)}px Segoe UI`;ctx.textAlign='left';
    for(const note of w.editor?.annotations??[]) {
      const p=mapPoint(note.position),x=p.x*canvas.width,y=p.y*canvas.height;
      ctx.fillStyle='#fff6d7';ctx.beginPath();ctx.arc(x,y,unit(3),0,Math.PI*2);ctx.fill();ctx.strokeStyle='#23353b';ctx.lineWidth=unit(3);ctx.strokeText(note.name,x+unit(7),y+unit(4));ctx.fillText(note.name,x+unit(7),y+unit(4));
    }
  }
}

export function drawSection(canvas,world,cell) {
  const ctx=canvas.getContext('2d'),{width,radiusKm,latitude}=world.grid,centerX=cell%width,y=Math.floor(cell/width);
  const margin=60,top=34,bottom=245,columnWidth=(canvas.width-margin-20)/7,maxDepth=geologicalColumn(world.atlas,cell).at(-1).bottomM;
  ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#f6f4ed';ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.font='12px Segoe UI';ctx.textAlign='right';ctx.fillStyle='#657174';
  for(let depth=0;depth<=maxDepth;depth+=3000){const py=top+(bottom-top)*depth/maxDepth;ctx.fillText(`${depth/1000} км`,margin-9,py+4);ctx.strokeStyle='#d5d2c7';ctx.beginPath();ctx.moveTo(margin,py);ctx.lineTo(canvas.width-20,py);ctx.stroke();}
  for(let k=0;k<7;k++) {
    const x=(centerX+k-3+width)%width,i=y*width+x,left=margin+k*columnWidth;
    for(const layer of geologicalColumn(world.atlas,i)) {
      const sy=top+(bottom-top)*layer.topM/maxDepth,ey=top+(bottom-top)*Math.min(maxDepth,layer.bottomM)/maxDepth;
      ctx.fillStyle=rocks[layer.rock].color;ctx.fillRect(left,sy,columnWidth,ey-sy);ctx.strokeStyle='#fff9';ctx.lineWidth=0.6;ctx.strokeRect(left,sy,columnWidth,ey-sy);
    }
    ctx.fillStyle='#3a494e';ctx.textAlign='center';ctx.fillText(k===3?'Выбранный участок':`Ячейка ${i}`,left+columnWidth/2,20);
    if(k===3){ctx.strokeStyle='#245b64';ctx.lineWidth=3;ctx.strokeRect(left+1,top+1,columnWidth-2,bottom-top-2);}
  }
  const angular=2*Math.PI/width,lat=latitude[cell];
  const edgeKm=radiusKm*Math.acos(clamp(Math.sin(lat)**2+Math.cos(lat)**2*Math.cos(angular),-1,1));
  return edgeKm*6;
}

export function drawRegion(canvas,region,mode='elevation') {
  const ctx=canvas.getContext('2d'),size=region.size,image=new ImageData(size,size),offscreen=document.createElement('canvas');offscreen.width=size;offscreen.height=size;
  for(let i=0;i<size*size;i++) {
    const rgb=mode==='rocks'?hexRgb(rocks[region.surfaceRock[i]].color):color(region.elevation[i],palettes.elevation);
    let shade=1;
    if(mode==='elevation' && region.elevation[i]>0){const west=i%size?i-1:i,north=i>=size?i-size:i;shade=clamp(1-(region.elevation[i]-region.elevation[west])*0.001-(region.elevation[i]-region.elevation[north])*0.0006,0.6,1.2);}
    for(let k=0;k<3;k++)image.data[i*4+k]=clamp(rgb[k]*shade,0,255);image.data[i*4+3]=255;
  }
  offscreen.getContext('2d').putImageData(image,0,0);ctx.imageSmoothingEnabled=mode!=='rocks';ctx.drawImage(offscreen,0,0,canvas.width,canvas.height);
  const seenBodies=new Set();
  for(const d of region.deposits){if(seenBodies.has(d.oreBodyId))continue;seenBodies.add(d.oreBodyId);const x=(d.x+0.5)/size*canvas.width,y=(d.y+0.5)/size*canvas.height;ctx.beginPath();ctx.arc(x,y,d.sizeClass==='major'?5:2.5,0,Math.PI*2);ctx.fillStyle=minerals[d.mineral].color;ctx.fill();ctx.strokeStyle='#22363b';ctx.lineWidth=1;ctx.stroke();}
  ctx.strokeStyle='#fff9';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(canvas.width/2-8,canvas.height/2);ctx.lineTo(canvas.width/2+8,canvas.height/2);ctx.moveTo(canvas.width/2,canvas.height/2-8);ctx.lineTo(canvas.width/2,canvas.height/2+8);ctx.stroke();
}
