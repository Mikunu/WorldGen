import {serializeWorld,explainCell} from './core/world.js';
import {biomeNames} from './core/climate.js';
import {drawMap,drawSection,drawRegion,palettes,biomeColors} from './render.js';
import {rocks,provinceTypes,minerals,hazardTypes} from './core/geology-catalog.js';
import {geologicalColumn,atlasExplanation} from './core/geological-atlas.js';
import {refineRegion} from './core/region.js';
import {depositMatches} from './core/deposit-models.js';
import {pickDeposit} from './core/spatial.js';
import {mountEditor} from './editor-ui.js';
import {initializeEditor} from './core/editor.js';
import {mountGenerationRules} from './generation-rules-ui.js';
import {mountMapViewport} from './map-viewport.js';
import {MAP_LAYERS,normalizeLayers,resolveLayers,normalizeLayerOpacity,layerOpacity} from './core/map-layers.js';
import {saveBlob} from './desktop.js';
const $=id=>document.getElementById(id),canvas=$('map');
let world=null,selected=null,selectedDeposit=null,layer='elevation',worker=null,region=null;
let potentialJob=null,potentialPending=null,potentialError=null,potentialErrorResource=null;
let editor=null,potentialWorld=null;
let generationRulesUI=null;
let mapView=null,layers=['elevation'],layerOpacities={};
const hasLayer=id=>layers.includes(id);
const potentialCache=new Map();
const number=(n,d=0)=>n.toLocaleString('ru-RU',{maximumFractionDigits:d});
const oceanNumber=(n,d=2)=>n!==0&&Math.abs(n)<10**-d?n.toExponential(2):number(n,d);
const names={elevation:['Рельеф планеты','Высоты, океанические глубины и речная сеть'],plates:['Литосферные плиты','Положение плит после выбранного числа эпох'],boundaries:['Тектонические границы','Схождение, расхождение и сдвиг соседних плит'],temperature:['Температура','Широта, сезон, высота и влияние океана'],precipitation:['Осадки','Приближённый перенос влаги и орографические осадки'],seaTemperature:['Температура моря','Температура поверхности океана выбранного сезона'],seaSalinity:['Солёность моря','Солёность поверхности океана'],seaDensity:['Плотность моря','Потенциальная плотность поверхности океана'],oceanCurrents:['Океанские течения','Скорость и направление поверхностного переноса воды'],deepTemperature:['Глубинная температура','Температура глубокого слоя океана'],deepSalinity:['Глубинная солёность','Солёность глубокого слоя океана'],deepDensity:['Глубинная плотность','Потенциальная плотность глубокого слоя океана'],deepCurrents:['Глубинные течения','Скорость и направление глубоких течений'],oceanVerticalExchange:['Вертикальный обмен','Положительное значение — апвеллинг, отрицательное — погружение'],flow:['Речной сток','Средний расход воды и накопление по водосборам'],biome:['Природные области','Классификация по среднегодовому климату']};
Object.assign(names,{rocks:['Породы поверхности','Магматические, осадочные и метаморфические породы'],provinces:['Геологические провинции','Связные области общей геологической обстановки'],sediments:['Осадочный покров','Приближённая мощность накопленных отложений'],resources:['Месторождения','Ресурсные тела, связанные с геологической обстановкой'],fertility:['Почвы','Потенциальное плодородие по породе, климату и рельефу'],hazards:['Природные опасности','Относительный индекс от 0 до 1; не вероятность события']});
names.potential=['Рудный потенциал','Разломы, магматические центры и осадочные линзы · относительный индекс'];
function getConfig() {
  const data=new FormData($('config-form')),width=Number(data.get('resolution'));
  const generationRules=generationRulesUI.read();
  return {seed:data.get('seed'),width,height:width/2,generationRules,...generationRules.world};
}
function setStatus(message,error=false){$('status').textContent=message;$('status').parentElement.classList.toggle('error',error);}
function generate() {
  if(editor?.busy())return;
  if(!$('config-form').reportValidity())return;
  let config;try{config=getConfig();}catch(error){setStatus(error.message,true);return;}
  worker?.terminate();worker=new Worker('/src/worker.js',{type:'module'});
  $('generate').disabled=true;$('export-json').disabled=true;$('export-png').disabled=true;$('progress').hidden=false;setStatus('Запуск расчётов…');
  worker.onmessage=({data})=>{
    if(data.type==='progress')setStatus(data.message);
    else if(data.type==='world') {
      world=initializeEditor(data.world);selected=null;potentialJob?.terminate();potentialJob=null;potentialPending=null;potentialError=null;potentialCache.clear();$('map-placeholder').hidden=true;catalog();stats();clearInspector();editor?.reset();
      setStatus(`Готово за ${number(data.elapsedMs/1000,2)} с · ${number(world.grid.size)} ячеек · проверки пройдены`);finish();
      mapView?.reset();render();
    } else {setStatus(data.message,true);finish(false);}
  };
  worker.onerror=event=>{setStatus(`Ошибка расчёта: ${event.message}`,true);finish(false);};
  editor?.controls();generationRulesUI.setBusy(true);worker.postMessage(config);
}
function finish(success=true) {$('generate').disabled=false;$('progress').hidden=true;$('export-json').disabled=!world;$('export-png').disabled=!world;worker?.terminate();worker=null;editor?.controls();generationRulesUI?.setBusy(false);mapView?.refresh();}
function render() {
  if(!world)return;
  const displayed=editor?.displayWorld()??world;
  if(potentialWorld!==displayed){potentialJob?.terminate();potentialJob=null;potentialPending=null;potentialError=null;potentialCache.clear();potentialWorld=displayed;}
  const resource=$('resource-filter').value;if(hasLayer('potential'))ensurePotential(resource,displayed);
  const activeDeposit=displayed.atlas.deposits.find(d=>d.oreBodyId===selectedDeposit?.oreBodyId);
  drawMap(canvas,displayed,{layers,layerOpacity:layerOpacities,screenScale:mapView?.screenScale??1,mapZoom:mapView?.zoom??1,potentialRaster:potentialCache.get(resource),season:$('season').value,rivers:$('show-rivers').checked,coasts:$('show-coasts').checked,graticule:$('show-grid').checked,selected,selectedPosition:hasLayer('resources')?activeDeposit?.position:null,...resourceOptions(),hazard:$('hazard-filter').value});
  editor?.overlay();
  $('map-title').textContent=layers.length===1?names[layers[0]][0]:'Карта планеты';$('map-description').textContent=layers.length>1?MAP_LAYERS.filter(l=>hasLayer(l.id)).map(l=>l.name).join(' · '):names[layers[0]??'elevation'][1];
  $('season').disabled=!layers.some(id=>['temperature','precipitation','seaTemperature','seaSalinity','seaDensity','oceanCurrents','deepTemperature','deepSalinity','deepDensity','deepCurrents','oceanVerticalExchange'].includes(id));legend();
  $('resource-option').hidden=!hasLayer('resources')&&!hasLayer('potential');$('class-option').hidden=!hasLayer('resources');$('resource-catalog').hidden=!hasLayer('resources');$('hazard-option').hidden=!hasLayer('hazards');
  const visible=displayed.atlas.deposits.filter(d=>depositMatches(d,resourceOptions()));
  const notes=[];
  if(hasLayer('resources'))notes.push(`${number(new Set(visible.map(d=>d.oreBodyId)).size)} залежей · нажмите на маркер`);
  if(hasLayer('hazards'))notes.push(hazardTypes.find(h=>h.id===$('hazard-filter').value).name);
  if(hasLayer('potential'))notes.push(potentialError??(potentialCache.has(resource)?'Потенциал: индекс 0–1; не запас руды':'Рассчитываются рудные пояса…'));
  if((hasLayer('seaTemperature')||hasLayer('oceanCurrents'))&&!displayed.climate.ocean?.enabled)notes.push('Океанская модель отключена или отсутствует в старом проекте');
  if(layers.some(id=>['seaSalinity','seaDensity','deepTemperature','deepSalinity','deepDensity','deepCurrents','oceanVerticalExchange'].includes(id))&&!displayed.climate.ocean?.thermodynamicsEnabled)notes.push('Термохалинная модель отключена или отсутствует в старом проекте');
  $('layer-note').textContent=notes.join(' · ');
  $('export-png').disabled=editor?.busy() || hasLayer('potential') && !potentialCache.has(resource);
}
function ensurePotential(resource,currentWorld=world) {
  if(potentialErrorResource!==resource){potentialError=null;potentialErrorResource=null;}
  if(potentialCache.has(resource) || potentialPending===resource || potentialError)return;
  potentialJob?.terminate();potentialJob=new Worker('/src/potential-worker.js',{type:'module'});potentialPending=resource;
  const job=potentialJob;
  const fail=message=>{if(job!==potentialJob)return;potentialError=message;potentialErrorResource=resource;potentialPending=null;job.terminate();potentialJob=null;render();};
  job.onerror=e=>fail(`Ошибка расчёта потенциала: ${e.message}`);
  job.onmessage=({data})=>{
    if(job!==potentialJob || potentialWorld!==currentWorld)return;
    if(data.type==='error'){fail(data.message);return;}
    potentialCache.set(resource,data.raster);potentialPending=null;job.terminate();potentialJob=null;render();
  };
  job.postMessage({world:currentWorld,resource});
}
function resourceOptions(){return {resource:$('resource-filter').value,depositClass:$('class-filter').value};}
function catalog() {
  const previous=$('resource-filter').value,groups=new Map();$('resource-filter').replaceChildren(new Option('Все ресурсы','all'));
  const rows=world.summary.resourceInventory.map(r=>{
    const m=minerals[r.mineral];let group=groups.get(m.group);
    if(!group){group=document.createElement('optgroup');group.label=m.group;groups.set(m.group,group);$('resource-filter').append(group);}
    group.append(new Option(`${m.name} · ${r.major+r.occurrence}`,String(m.id)));
    const button=document.createElement('button');button.className='catalog-resource';button.textContent=m.name;
    button.addEventListener('click',()=>{$('resource-filter').value=String(m.id);$('class-filter').value='all';render();});
    return [button,m.oreMinerals,String(r.major),String(r.occurrence),m.unit];
  });
  $('resource-filter').value=previous;$('resource-inventory').replaceChildren(makeTable(['Сырьё','Рудные минералы / носитель','Месторождения','Проявления','Содержание'],rows));
}
function legend() {
  const el=$('legend'),opened=new Set([...el.querySelectorAll('details[open]')].map(d=>d.dataset.legend));el.replaceChildren();
  for(const id of layers.length?layers:['elevation']) {
    const group=document.createElement('details'),summary=document.createElement('summary'),items=document.createElement('div');group.dataset.legend=id;group.className='legend-layer';items.className='legend-items';summary.textContent=MAP_LAYERS.find(l=>l.id===id).name;group.open=opened.has(id);group.append(summary,items);appendLegend(id,items);el.append(group);
  }
}
function appendLegend(layer,el) {
  const swatch=(label,rgb)=>{const span=document.createElement('span'),box=document.createElement('i');box.className='legend-swatch';box.style.background=rgb;span.append(box,document.createTextNode(label));el.append(span);};
  if(layer==='plates'){el.textContent=`${world.config.plateCount} плит · ${world.config.epochs*world.config.epochMa} млн лет движения`;return;}
  if(layer==='boundaries'){swatch('Схождение','#d86e48');swatch('Расхождение','#5cafbe');swatch('Сдвиг','#c8b166');return;}
  if(layer==='biome'){for(let i=1;i<biomeNames.length;i++)swatch(biomeNames[i],biomeColors[i]);return;}
  if(layer==='rocks'){for(const rock of rocks)swatch(rock.name,rock.color);return;}
  if(layer==='provinces'){for(const p of provinceTypes)swatch(p.name,p.color);return;}
  if(layer==='resources'){const m=minerals[Number($('resource-filter').value)];if($('resource-filter').value!=='all' && m)swatch(`${m.symbol} · ${m.name}`,m.color);el.append(document.createTextNode('Крупный круг — месторождение · малый — проявление'));return;}
  if(layer==='oceanCurrents'){const bar=document.createElement('span');bar.className='legend-bar';bar.style.background=`linear-gradient(to right,${palettes.oceanCurrents.map(s=>`rgb(${s[1].join(',')}) ${100*s[0]/1.5}%`).join(',')})`;el.append(document.createTextNode('0 м/с'),bar,document.createTextNode('1,5 м/с · стрелки: итоговый вектор, не среднее направление'));return;}
  if(layer==='deepCurrents'){const bar=document.createElement('span');bar.className='legend-bar';bar.style.background=`linear-gradient(to right,${palettes.deepCurrents.map(s=>`rgb(${s[1].join(',')}) ${100*s[0]}%`).join(',')})`;el.append(document.createTextNode('0 м/с'),bar,document.createTextNode('≥ 0,2 м/с · лог. шкала; стрелки: итоговый вектор'));return;}
  const labels={elevation:['≤ −7 000 м','≥ 6 500 м'],temperature:['≤ −45 °C','≥ 50 °C'],seaTemperature:['≤ −45 °C','≥ 50 °C'],seaSalinity:['28 PSU','41 PSU'],seaDensity:['1 018 кг/м³','1 032 кг/м³'],deepTemperature:['≤ −45 °C','≥ 50 °C'],deepSalinity:['28 PSU','41 PSU'],deepDensity:['1 018 кг/м³','1 032 кг/м³'],oceanVerticalExchange:['≤ −0,86 м/сут · погружение','≥ +0,86 м/сут · апвеллинг · лог. шкала'],precipitation:['0 мм/год','≥ 3 000 мм/год'],flow:['0 м³/с','≥ 100 000 м³/с · лог. шкала'],sediments:['0 м','≥ 4 000 м'],fertility:['0 · бедные','1 · плодородные'],hazards:['0 · слабый','1 · сильный'],potential:['0 · слабый','1 · сильный']};
  const stops=layer==='seaTemperature'||layer==='deepTemperature'?palettes.temperature:layer==='seaSalinity'||layer==='deepSalinity'?palettes.salinity:layer==='seaDensity'||layer==='deepDensity'?palettes.density:layer==='oceanVerticalExchange'?palettes.vertical:palettes[layer],bar=document.createElement('span');bar.className='legend-bar';bar.style.background=`linear-gradient(to right,${stops.map(s=>`rgb(${s[1].join(',')}) ${100*(s[0]-stops[0][0])/(stops.at(-1)[0]-stops[0][0])}%`).join(',')})`;
  el.append(document.createTextNode(labels[layer][0]),bar,document.createTextNode(labels[layer][1]));
}
function stats() {
  const s=world.summary,items=[['Суша',number(s.landAreaKm2/1e6,1)+' млн км²'],['Океан',number(s.oceanFraction*100,1)+'%'],['Высшая точка',number(s.maxElevationM)+' м'],['Осадки на суше',number(s.landPrecipitationMm)+' мм/год'],['Геологические области',number(s.provinceCount)],['Месторождения',number(s.depositCount)],['Малые проявления',number(s.occurrenceCount)],['Баланс стока',world.validation.balanceRelativeError<1e-9?'сходится':'ошибка']];
  $('world-stats').replaceChildren();
  for(const [label,value] of items){const row=document.createElement('div');row.className='stat';const a=document.createElement('span'),b=document.createElement('strong');a.textContent=label;b.textContent=value;row.append(a,b);$('world-stats').append(row);}
}
function clearInspector() {region=null;selectedDeposit=null;$('region-details').hidden=true;$('coordinates').textContent='Выберите точку на карте';$('cell-values').replaceChildren();$('season-values').replaceChildren();$('geology-details').hidden=true;$('explanation').textContent='Нажмите на карту, чтобы увидеть данные и причины формирования участка.';}
function inspect(i,deposit=null) {
  selected=i;selectedDeposit=deposit;render();const w=world,h=w.geology.elevation[i],lat=w.grid.latitude[i]*180/Math.PI,lon=(i%w.grid.width+0.5)/w.grid.width*360-180;
  $('coordinates').textContent=`${number(Math.abs(lat),1)}° ${lat>=0?'N':'S'} · ${number(Math.abs(lon),1)}° ${lon>=0?'E':'W'} · ячейка ${i}`;
  const boundary={0:'Внутри плиты',1:'Схождение','-1':'Расхождение',2:'Сдвиг'}[w.geology.boundary[i]];
  const items=[['Высота',number(h)+' м'],['Плита',String(w.geology.plateId[i]+1)],['Температура',number(w.climate.temperature[i],1)+' °C'],['Осадки',number(w.climate.precipitation[i])+' мм/год'],['Расход воды',number(w.water.discharge[i],1)+' м³/с'],['Тип коры',w.geology.crust[i]>0.52?'Континентальная':'Океаническая'],['Возраст материала',number(w.geology.ageMa[i])+' млн лет'],['Тектоника',boundary],['Водосбор',number(w.water.catchmentKm2[i])+' км²'],['Природная область',biomeNames[w.climate.biome[i]]]];
  const annualOcean=w.climate.ocean,ocean=$('season').value==='annual'?annualOcean:annualOcean?.seasons?.[Number($('season').value)];
  if(ocean?.enabled) {
    if(h<=0&&ocean.eastMps?.[i]!==undefined) {
      const east=ocean.eastMps[i],north=ocean.northMps[i],speed=ocean.speedMps[i],bearing=Math.atan2(east,north)*180/Math.PI;
      const vector=Math.hypot(east,north),direction=speed===0?'нет потока':vector<Math.max(1e-9,speed*1e-6)?'итоговый вектор компенсирован':`${number((bearing+360)%360)}°`;
      items.push(['Температура моря',number(ocean.temperatureC[i],1)+' °C'],['Аномалия SST',number(ocean.anomalyC[i],2)+' °C'],['Течение',`${oceanNumber(speed,3)} м/с · ${direction}`]);
      if(ocean.thermodynamicsEnabled){items.push(['Солёность поверхности',number(ocean.salinityPsu[i],2)+' PSU'],['Плотность поверхности',number(ocean.densityKgM3[i],2)+' кг/м³ (то же давление)']);if(ocean.deepMask[i]){const de=ocean.deepEastMps[i],dn=ocean.deepNorthMps[i],ds=ocean.deepSpeedMps[i],db=Math.atan2(de,dn)*180/Math.PI,deepVector=Math.hypot(de,dn),deepDirection=ds===0?'нет потока':deepVector<Math.max(1e-9,ds*1e-6)?'итоговый вектор компенсирован':`${number((db+360)%360)}°`,vertical=ocean.verticalVelocityMps[i]*86400,verticalText=vertical===0?'нет обмена':`${oceanNumber(vertical,4)} м/сут · ${vertical>0?'апвеллинг':'погружение'}`;items.push(['Глубинная температура',number(ocean.deepTemperatureC[i],1)+' °C'],['Глубинная солёность',number(ocean.deepSalinityPsu[i],2)+' PSU'],['Глубинная плотность',number(ocean.deepDensityKgM3[i],2)+' кг/м³ (то же давление)'],['Глубинное течение',`${oceanNumber(ds,3)} м/с · ${deepDirection}`],['Вертикальный обмен',verticalText]);}}
    } else if(h>0&&ocean.coastInfluence?.[i]>0)items.push(['Влияние моря',number(ocean.coastInfluence[i],2)+'/1'],['Поправка воздуха',number(ocean.airTemperatureCorrectionC?.[i]??0,2)+' °C']);
  }
  $('cell-values').replaceChildren();
  for(const [label,value] of items){const el=document.createElement('div');el.className='cell-value';const a=document.createElement('small'),b=document.createElement('strong');a.textContent=label;b.textContent=value;el.append(a,b);$('cell-values').append(el);}
  $('explanation').textContent=explainCell(w,i);
  inspectGeology(i);
  const table=document.createElement('table'),header=document.createElement('tr');
  for(const label of ['Северный сезон','Температура','Осадки, годовой эквивалент']){const th=document.createElement('th');th.textContent=label;header.append(th);}table.append(header);
  w.climate.seasons.forEach((s,k)=>{const row=document.createElement('tr');for(const text of [['Зима','Весна','Лето','Осень'][k],number(s.temperature[i],1)+' °C',number(s.precipitation[i])+' мм/год']){const td=document.createElement('td');td.textContent=text;row.append(td);}table.append(row);});$('season-values').replaceChildren(table);
  editor?.selectionChanged();
}
function makeTable(headers,rows) {
  const table=document.createElement('table'),head=document.createElement('tr');
  for(const text of headers){const th=document.createElement('th');th.textContent=text;head.append(th);}table.append(head);
  for(const values of rows){const tr=document.createElement('tr');for(const value of values){const td=document.createElement('td');if(value instanceof Node)td.append(value);else td.textContent=value;tr.append(td);}table.append(tr);}return table;
}
function inspectGeology(i) {
  region=null;$('region-details').hidden=true;
  const a=world.atlas,province=a.provinces[a.provinceId[i]];const rock=rocks[a.surfaceRock[i]];
  $('geology-details').hidden=false;$('geology-explanation').textContent=`${province.name} · ${number(province.areaKm2)} км². ${atlasExplanation(world,i)}`;
  const rows=geologicalColumn(a,i).map(l=>{
    const label=document.createElement('span'),chip=document.createElement('i');chip.className='rock-chip';chip.style.background=rocks[l.rock].color;label.append(chip,document.createTextNode(rocks[l.rock].name));
    return [label,`${number(l.topM)}–${number(l.bottomM)} м`,number(l.ageMa,2)+' млн лет'];
  });$('column-values').replaceChildren(makeTable(['Порода','Глубина','Условный возраст'],rows));
  $('deposit-values').replaceChildren();
  const deposits=a.depositsByCell[i].map(id=>a.deposits[id]).sort((a,b)=>(b.oreBodyId===selectedDeposit?.oreBodyId)-(a.oreBodyId===selectedDeposit?.oreBodyId));
  if(!deposits.length){const p=document.createElement('p');p.textContent='Ресурсные тела в этой ячейке не созданы. Это не означает отсутствия геологического потенциала.';$('deposit-values').append(p);}
  for(const d of deposits) {
    const entry=document.createElement('div');entry.className='resource-entry';const title=document.createElement('strong'),details=document.createElement('small'),reason=document.createElement('p');
    const mass=d.oreMassMt<1?`${number(d.oreMassMt*1000,2)} тыс. т`:`${number(d.oreMassMt,1)} млн т`;
    title.textContent=`${d.oreBodyId===selectedDeposit?.oreBodyId?'Выбрано · ':''}${d.name?d.name+' · ':''}${minerals[d.mineral].name} · ${d.sizeClass==='major'?'месторождение':'малое проявление'} · ${d.kind}`;
    details.textContent=`Тело №${d.oreBodyId+1} · ${number(d.latitudeDeg,3)}° широты, ${number(d.longitudeDeg,3)}° долготы · глубина ${number(d.depthM)} м · масса тела ${mass} · содержание ${number(d.grade,3)} ${d.gradeUnit}. Содержащийся ресурс (${d.resourceBasis}) ${number(d.containedResourceTonnes,2)} т. Сложность доступа ${number(d.accessDifficulty,2)}/1. Не открыто, не освоено. Рентабельность не оценена.`;
    reason.textContent=`Минералы / носитель: ${d.oreMinerals}. ${d.reason} ${d.exceptionReason??''} ${d.description??''}`;
    const choose=document.createElement('button');choose.textContent='Редактировать тело';choose.addEventListener('click',()=>{inspect(d.cell,d);$('body-editor').scrollIntoView({block:'nearest',behavior:'smooth'});});entry.append(title,details,reason,choose);$('deposit-values').append(entry);
  }
  const values=[['Поверхностная порода',rock.name],['Устойчивость породы',number(rock.resistance,2)+'/1'],['Мощность осадков',number(a.sedimentThicknessM[i])+' м'],['Глубина почвы',number(a.soilDepthM[i],2)+' м'],['Плодородие',number(a.fertility[i],2)+'/1'],['Удержание влаги',number(a.waterRetention[i],2)+'/1'],['Водоносный потенциал',number(a.aquiferPotential[i],2)+'/1'],...hazardTypes.map(h=>[h.name,number(a.hazards[h.id][i],2)+'/1'])];
  $('geology-values').replaceChildren();for(const [label,value] of values){const entry=document.createElement('div');entry.className='cell-value';const small=document.createElement('small'),strong=document.createElement('strong');small.textContent=label;strong.textContent=value;entry.append(small,strong);$('geology-values').append(entry);}
  const distance=drawSection($('section-map'),world,i);$('section-distance').textContent=`Протяжённость между центрами крайних ячеек: ${number(distance)} км. Цвета соответствуют карте пород; складки и наклон слоёв пока не моделируются.`;
}
async function download(blob,extension) {
  const name=`world-${world.config.seed.replace(/[^\p{L}\p{N}_-]/gu,'_').slice(0,50)}-${layer}.${extension}`;
  try{const saved=await saveBlob(blob,name,extension);if(saved)setStatus(`Файл сохранён: ${saved}`);}catch(error){setStatus(`Не удалось сохранить файл: ${error.message}`,true);}
}
$('config-form').addEventListener('submit',e=>{e.preventDefault();generate();});
$('random-seed').addEventListener('click',()=>{$('seed').value=`world-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36)}`;generate();});
for(const id of ['oceanFraction','axialTilt'])$(id).addEventListener('input',()=>{$('ocean-output').value=number(Number($('oceanFraction').value)*100)+'%';$('tilt-output').value=number(Number($('axialTilt').value),1)+'°';});
function syncLayerControls() {
  document.querySelectorAll('[data-layer]').forEach(input=>input.checked=hasLayer(input.dataset.layer));
  const controls=$('map-layer-opacity-controls');controls.replaceChildren();
  for(const item of MAP_LAYERS.filter(l=>hasLayer(l.id))) {
    const label=document.createElement('label'),title=document.createElement('span'),output=document.createElement('output'),input=document.createElement('input');
    title.textContent=item.name;input.type='range';input.min='0';input.max='100';input.step='1';input.value=Math.round(layerOpacity(layerOpacities,item.id)*100);input.dataset.opacity=item.id;input.setAttribute('aria-label',`Непрозрачность: ${item.name}`);output.value=`${input.value}%`;
    input.addEventListener('input',()=>{layerOpacities[item.id]=Number(input.value)/100;output.value=`${input.value}%`;render();});
    label.append(title,output,input);controls.append(label);
  }
  if(!layers.length){const hint=document.createElement('p');hint.className='hint';hint.textContent='Слои выключены. Показана подложка рельефа.';controls.append(hint);}
}
function enableLayer(next) {if(!names[next])return;layer=next;if(!hasLayer(next))layers=normalizeLayers([...layers,next]);syncLayerControls();render();}
document.querySelectorAll('[data-layer]').forEach(input=>input.addEventListener('change',()=>{layers=normalizeLayers([...document.querySelectorAll('[data-layer]:checked')].map(b=>b.dataset.layer));layer=input.checked?input.dataset.layer:layers.at(-1)??'elevation';syncLayerControls();render();}));
for(const id of ['show-rivers','show-coasts','show-grid','resource-filter','class-filter','hazard-filter'])$(id).addEventListener('change',render);
$('season').addEventListener('change',()=>selected===null?render():inspect(selected,selectedDeposit));
canvas.addEventListener('click',event=>{
  if(!world || editor?.busy() || mapView?.shouldPan(event))return;const rect=canvas.getBoundingClientRect(),fx=(event.clientX-rect.left)/rect.width,fy=(event.clientY-rect.top)/rect.height;
  const x=Math.min(world.grid.width-1,Math.max(0,Math.floor(fx*world.grid.width))),y=Math.min(world.grid.height-1,Math.max(0,Math.floor(fy*world.grid.height)));
  const deposit=hasLayer('resources')?pickDeposit(world.atlas.deposits,fx,fy,rect.width,rect.height,d=>depositMatches(d,resourceOptions())):null;
  inspect(deposit?.cell??y*world.grid.width+x,deposit);
});
canvas.addEventListener('keydown',event=>{
  if(!world || editor?.busy() || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key))return;event.preventDefault();
  let i=selected??Math.floor(world.grid.size/2),x=i%world.grid.width,y=Math.floor(i/world.grid.width);
  x+=(event.key==='ArrowRight')-(event.key==='ArrowLeft');y+=(event.key==='ArrowDown')-(event.key==='ArrowUp');x=(x+world.grid.width)%world.grid.width;y=Math.max(0,Math.min(world.grid.height-1,y));inspect(y*world.grid.width+x);
});
$('export-json').addEventListener('click',()=>download(new Blob([serializeWorld(world)],{type:'application/json'}),'json'));
$('export-png').addEventListener('click',()=>canvas.toBlob(blob=>download(blob,'png')));
$('refine-region').addEventListener('click',()=>{
  if(selected===null || !world)return;
  region=refineRegion(world,selected,{centerPosition:selectedDeposit?.position??null});$('region-details').hidden=false;drawRegion($('region-map'),region,$('region-layer').value);
  $('region-summary').textContent=`${region.size} × ${region.size} ячеек · область ${region.spanKm} × ${region.spanKm} км · шаг ${number(region.resolutionKm,1)} км. Породы и ресурсы наследуются из глобального атласа; детализация рельефа процедурная.`;
  $('region-cell').textContent='Нажмите на локальную карту, чтобы увидеть данные и родительскую ячейку.';
});
$('region-layer').addEventListener('change',()=>{if(region)drawRegion($('region-map'),region,$('region-layer').value);});
$('region-map').addEventListener('click',event=>{
  if(!region)return;const rect=$('region-map').getBoundingClientRect(),x=Math.max(0,Math.min(region.size-1,Math.floor((event.clientX-rect.left)/rect.width*region.size))),y=Math.max(0,Math.min(region.size-1,Math.floor((event.clientY-rect.top)/rect.height*region.size))),i=y*region.size+x;
  let picked=null,best=10;
  for(const d of region.deposits) {
    const distance=Math.hypot((d.x+.5)/region.size*rect.width-(event.clientX-rect.left),(d.y+.5)/region.size*rect.height-(event.clientY-rect.top));
    if(distance<best){best=distance;picked=d;}
  }
  if(picked) {
    const d=world.atlas.deposits[picked.id],components=world.atlas.deposits.filter(c=>c.oreBodyId===d.oreBodyId).map(c=>minerals[c.mineral].name);
    $('region-cell').textContent=`Залежь №${d.oreBodyId+1} · ${components.join(', ')} · ${number(d.latitudeDeg,3)}° широты, ${number(d.longitudeDeg,3)}° долготы · ${d.sizeClass==='major'?'месторождение':'малое проявление'}.`;
    return;
  }
  $('region-cell').textContent=`${number(region.latitude[i],2)}° широты · ${number(region.longitude[i],2)}° долготы · высота ${number(region.elevation[i])} м · ${rocks[region.surfaceRock[i]].name} · родительская ячейка ${region.parentCell[i]}. Верхний слой ${number(region.layerThicknessM[i*4])} м.`;
});
mapView=mountMapViewport({canvas,viewport:$('map-viewport'),onChange:view=>{document.querySelector('.map-coordinate').style.visibility=view.zoom>1?'hidden':'visible';render();},busy:()=>!!worker});
syncLayerControls();
editor=mountEditor({
  getWorld:()=>world,getDeposit:()=>selectedDeposit,getSelected:()=>selected,getLayer:()=>layer,isLayerEnabled:hasLayer,
  shouldPan:event=>mapView.shouldPan(event),screenScale:()=>mapView.screenScale,refreshNavigation:()=>mapView.refresh(),closeRules:()=>generationRulesUI?.close(),
  syncGenerationRules(rules){generationRulesUI?.sync(rules);},
  rulesBusy:value=>generationRulesUI?.setBusy(value),
  generationBusy:()=>!!worker,
  depositFilter:d=>depositMatches(d,resourceOptions()),
  setWorld(next){const bodyId=selectedDeposit?.oreBodyId;world=next;selected=selected===null?null:Math.min(selected,next.grid.size-1);selectedDeposit=next.atlas.deposits.find(d=>d.oreBodyId===bodyId)??null;if(selectedDeposit)selected=selectedDeposit.cell;region=null;},
  refresh(){catalog();stats();if(selected!==null)inspect(selected,selectedDeposit);else clearInspector();render();setStatus(`Мир · правка ${world.editor.revision} · проверки пройдены`);},
  inspect,render,setLayer:enableLayer,
  getView:()=>({layer,layers:[...layers],layerOpacity:{...layerOpacities},mapView:mapView.serializeView(),season:$('season').value,resource:$('resource-filter').value,depositClass:$('class-filter').value,hazard:$('hazard-filter').value,rivers:$('show-rivers').checked,coasts:$('show-coasts').checked,graticule:$('show-grid').checked}),
  restoreView(view={}) {
    try{layers=Object.hasOwn(view,'layers')||view.layer?resolveLayers(view):['elevation'];layerOpacities=normalizeLayerOpacity(view.layerOpacity);layer=hasLayer(view.layer)?view.layer:layers.at(-1)??'elevation';}catch(error){layers=['elevation'];layerOpacities={};layer='elevation';setStatus(`Настройки слоёв сброшены: ${error.message}`,true);}
    for(const [key,id] of [['season','season'],['resource','resource-filter'],['depositClass','class-filter'],['hazard','hazard-filter']])if([...$(id).options].some(o=>o.value===view[key]))$(id).value=view[key];
    for(const [key,id] of [['rivers','show-rivers'],['coasts','show-coasts'],['graticule','show-grid']])if(typeof view[key]==='boolean')$(id).checked=view[key];
    $('seed').value=world.config.seed;if(![...$('resolution').options].some(o=>o.value===String(world.config.width)))$('resolution').add(new Option(`${world.config.width} × ${world.config.height} · из проекта`,String(world.config.width)));$('resolution').value=world.config.width;syncLayerControls();mapView.restoreView(view.mapView??{});render();
  }
});
generationRulesUI=mountGenerationRules({onSave:rules=>editor.saveGenerationRules(rules),busy:()=>!!worker||editor.busy(),onChange(rules){
  $('epoch-description').textContent=`Одна эпоха — ${number(rules.world.epochMa,1)} млн лет в приближённой модели.`;
  for(const key of ['plateCount','epochs','oceanFraction','axialTilt','resourceDensity']) {
    const el=$(key),value=rules.world[key];if(!Number.isFinite(value))continue;
    if(el.tagName==='SELECT'&&![...el.options].some(o=>o.value===String(value)))el.add(new Option(`Особая · ×${value}`,String(value)));
    el.value=value;
  }
  if(Number.isFinite(rules.world.oceanFraction))$('ocean-output').value=number(rules.world.oceanFraction*100)+'%';if(Number.isFinite(rules.world.axialTilt))$('tilt-output').value=number(rules.world.axialTilt,1)+'°';
}});
for(const key of ['plateCount','epochs','oceanFraction','axialTilt','resourceDensity'])$(key).addEventListener('input',()=>generationRulesUI.setWorldValue(key,Number($(key).value)));
generate();
