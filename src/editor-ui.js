import {initializeEditor,createHistory,serializeProject,rulePresets,defaultRules} from './core/editor.js';
import {depositModels} from './core/deposit-models.js';
import {minerals} from './core/geology-catalog.js';
import {makeGrid,normalize,cross} from './core/grid.js';
import {sphericalPoint,pointDistance,mapPoint,pickDeposit} from './core/spatial.js';
import {isDesktop,saveJson,openJson} from './desktop.js';

const $=id=>document.getElementById(id),num=id=>Number($(id).value);
const ruleFields={density:'rule-density',majorFactor:'rule-major',occurrenceFactor:'rule-minor',depthScale:'rule-depth',gradeScale:'rule-grade',majorSpacing:'rule-major-spacing',minorSpacing:'rule-minor-spacing'};
const toolText={select:'Выберите участок или залежь. Карточка выбранного тела находится под картой.',area:'Нажмите для области заданного радиуса или протяните от центра к краю. Область пересекает стык карты.',add:'Выберите семейство и условия под картой, затем нажмите в месте новой залежи.',move:'Выберите залежь инструментом «Выбрать», снимите закрепление, затем нажмите в месте назначения.',brush:'Проведите кистью по карте. Результат появится в предпросмотре; сила применяется один раз за штрих.',note:'Заполните название и описание под картой, затем нажмите для размещения подписи.'};
export function mountEditor(api) {
  const canvas=$('map'),history=createHistory();let tool='select',area=null,drag=null,preview=null,job=null,lastOperation=null;
  const world=()=>api.getWorld(),display=()=>preview&&!$('compare-original').checked?preview:world();
  const message=(text,isError=false)=>{$('editor-instruction').textContent=text;$('editor-instruction').classList.toggle('error',isError);};
  const point=event=>{const rect=canvas.getBoundingClientRect(),x=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y=Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height));return sphericalPoint(90-y*180,x*360-180);};
  async function download(text,name) {try{const saved=await saveJson(text,name);if(saved)message(`Файл сохранён: ${saved}`);}catch(e){message(`Не удалось сохранить файл: ${e.message??e}`,true);}}
  function setTool(next) {
    if(job||preview)return;tool=next;document.querySelectorAll('[data-tool]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tool===tool)));
    if(['add','move'].includes(tool))api.setLayer('resources');
    if(tool==='brush'){const channel=$('brush-channel').value;api.setLayer(channel==='potential'?'potential':channel==='rain'?'precipitation':'elevation');}
    message(toolText[tool]);
  }
  function controls() {
    const pending=!!(job||preview);document.body.classList.toggle('edit-pending',pending);$('edit-busy').hidden=!job;
    $('undo-edit').disabled=pending||!history.canUndo;$('redo-edit').disabled=pending||!history.canRedo;
    $('save-project').disabled=!world()||pending;$('load-project').disabled=pending;$('generate').disabled=pending;$('random-seed').disabled=pending;
    $('export-json').disabled=!world()||pending;$('export-png').disabled=!world()||pending;
    $('save-version').disabled=!world()||pending;$('edit-preview').hidden=!preview;
  }
  function fillRules(r=defaultRules) {
    for(const [key,id] of Object.entries(ruleFields))$(id).value=r[key];
    for(const option of $('rule-models').options)option.selected=r.modelIds.includes(option.value);
  }
  function readRules() {return {...Object.fromEntries(Object.entries(ruleFields).map(([key,id])=>[key,num(id)])),modelIds:[...$('rule-models').selectedOptions].map(o=>o.value)};}
  for(const model of depositModels){$('add-model').append(new Option(model.kind,model.id));const o=new Option(model.kind,model.id);o.selected=true;$('rule-models').append(o);}
  function replace(next,{record=true}={}) {
    if(record&&world())history.push(world());api.setWorld(initializeEditor(next));preview=null;lastOperation=null;job?.terminate();job=null;$('compare-original').checked=false;
    sync();api.refresh();controls();
  }
  function request(operation) {
    if(!world()||job||preview)return;
    lastOperation=operation;job=new Worker('/src/editor-worker.js',{type:'module'});const current=world(),active=job;
    message('Подготовка предпросмотра…');controls();
    const fail=text=>{if(job!==active)return;job.terminate();job=null;lastOperation=null;message(text,true);controls();api.render();};
    job.onerror=e=>fail(`Ошибка редактора: ${e.message}`);
    job.onmessage=({data})=>{
      if(job!==active||world()!==current)return;
      if(data.type==='error'){fail(data.message);return;}
      job.terminate();job=null;preview=data.world;
      const i=data.impact;$('preview-title').textContent=operation.label??'Предпросмотр изменений';
      $('preview-impact').textContent=`Изменено ячеек рельефа: ${i.cells}; переходов суша / море: ${i.coastCells}. Добавлено тел: ${i.added}; удалено: ${i.removed}. Закреплённых тел сохранено: ${i.lockedBodies}. ${i.recalculated.length?`По всей планете пересчитаны: ${i.recalculated.join(', ')}.`:'Физические слои сохранены.'}`;
      message('На карте показан результат. Примените или отбросьте изменения.');controls();api.render();
    };
    job.postMessage({world:current,operation});
  }
  function restoreText(text) {
    if(job||preview)return;job=new Worker('/src/editor-worker.js',{type:'module'});const active=job;controls();message('Проверка проекта…');
    const fail=text=>{if(job!==active)return;job.terminate();job=null;message(text,true);controls();};
    job.onerror=e=>fail(e.message);job.onmessage=({data})=>{
      if(job!==active)return;if(data.type==='error'){fail(data.message);return;}
      job.terminate();job=null;replace(data.world);api.restoreView(data.view);message('Проект открыт. Загрузка доступна для отмены.');
    };job.postMessage({type:'import',text});
  }
  function sync() {
    const w=world();if(!w)return;initializeEditor(w);
    $('lock-terrain').checked=w.editor.locks.terrain;$('lock-resources').checked=w.editor.locks.resources;
    fillRules(w.editor.rules);const a=w.editor.appearance;$('map-theme').value=a.theme;$('marker-scale').value=a.markerScale;$('marker-opacity').value=a.opacity;$('show-labels').checked=a.labels;
    $('locked-areas').replaceChildren();for(const lock of w.editor.locks.areas){const row=document.createElement('div');row.className='editor-row';const text=document.createElement('span');text.textContent=`${lock.name} · ${Math.round(lock.area.radiusKm)} км · ${[lock.terrain?'рельеф / осадки':'',lock.resources?'ресурсы':''].filter(Boolean).join(', ')}`;const button=document.createElement('button');button.textContent='Снять закрепление';button.onclick=()=>request({type:'locks',removeId:lock.id,label:'Снять закрепление области'});row.append(text,button);$('locked-areas').append(row);}
    const chosen=$('note-list').value;$('note-list').replaceChildren(new Option('Новая подпись',''));
    for(const note of w.editor.annotations)$('note-list').append(new Option(note.name,note.id));$('note-list').value=chosen;
    selectionChanged();controls();
  }
  function selectionChanged() {
    const w=world(),d=api.getDeposit();$('body-editor').hidden=!d;if(!w)return;
    if(d) {
      $('body-editor-title').textContent=`${d.name||d.kind} · тело №${d.oreBodyId+1}`;
      $('body-provenance').textContent=`${d.provenance==='authored'?'Авторское исключение':d.provenance==='edited'?'Изменено автором':'Сгенерировано'} · ${d.locked?'закреплено':'может измениться при перегенерации'}. ${d.exceptionReason??''}`;
      for(const [id,key] of Object.entries({'body-name':'name','body-description':'description','body-tags':'tags','body-lat':'latitudeDeg','body-lon':'longitudeDeg','body-depth':'depthM','body-mass':'oreMassMt','body-class':'sizeClass','body-reason':'exceptionReason'}))$(id).value=d[key]??'';
      $('body-locked').checked=!!d.locked;$('toggle-body-lock').textContent=d.locked?'Снять закрепление':'Закрепить';$('body-grades').replaceChildren();
      for(const c of w.atlas.deposits.filter(c=>c.oreBodyId===d.oreBodyId)) {
        const div=document.createElement('div'),label=document.createElement('label'),input=document.createElement('input');div.className='grade-input';input.id=`grade-${c.mineral}`;input.type='number';input.step='any';input.min='0.000000001';input.max=String(minerals[c.mineral].gradeDenominator);input.value=c.grade;input.required=true;input.dataset.mineral=c.mineral;label.htmlFor=input.id;label.textContent=`${minerals[c.mineral].name}, ${c.gradeUnit}`;div.append(label,input);$('body-grades').append(div);
      }
      for(const input of $('body-form').querySelectorAll('input,select,textarea,button[type=submit]'))input.disabled=!!d.locked;
      $('delete-body').disabled=!!d.locked;
    }
    const selected=api.getSelected(),p=selected===null?null:w.atlas.provinces[w.atlas.provinceId[selected]];
    $('province-name').value=p?.name??'';$('province-target').textContent=p?`Область №${p.id+1}`:'Выберите участок на карте.';
  }
  function finishDrag(event) {
    if(!drag)return;const current=drag;drag=null;try{canvas.releasePointerCapture(event.pointerId);}catch{}
    if(tool==='area') {
      const distance=pointDistance(current.path[0],point(event),world().grid.radiusKm);
      area={center:current.path[0],radiusKm:distance>10?Math.min(distance,Math.PI*world().grid.radiusKm):num('edit-area-radius')};
      $('edit-area-radius').value=Math.round(area.radiusKm);$('edit-area-info').textContent=`Выбрана область радиусом ${Math.round(area.radiusKm)} км. Перегенерация действует внутри неё.`;api.render();return;
    }
    if(tool==='brush') {
      const channel=$('brush-channel').value,strength=num('brush-strength'),targets={mountain:3000,plain:200,bay:-300};
      request({type:'brush',channel:channel==='rain'?'rain':channel==='potential'?'potential':'elevation',path:current.path,radiusKm:num('edit-area-radius'),softness:num('brush-softness'),strength:channel==='lower'?-Math.abs(strength):strength,mode:channel in targets?'set':'add',targetM:targets[channel],rules:readRules(),label:`Кисть · ${$('brush-channel').selectedOptions[0].textContent}`});
    }
  }
  canvas.addEventListener('pointerdown',event=>{
    if(!world()||job||preview||event.button!==0)return;
    if(tool==='area'||tool==='brush'){event.preventDefault();drag={path:[point(event)],pointerId:event.pointerId};canvas.setPointerCapture(event.pointerId);api.render();}
  });
  canvas.addEventListener('pointermove',event=>{
    if(!drag)return;const p=point(event),last=drag.path.at(-1);
    if(tool==='area')drag.end=p;
    else if(drag.path.length<512&&pointDistance(last,p,world().grid.radiusKm)>Math.max(10,num('edit-area-radius')*.2))drag.path.push(p);
    api.render();
  });
  canvas.addEventListener('pointerup',finishDrag);canvas.addEventListener('pointercancel',()=>{drag=null;api.render();});
  canvas.addEventListener('click',event=>{
    if(!world())return;if(job||preview){event.stopImmediatePropagation();return;}
    if(tool==='select') {
      // Marker picking follows their visible positions and chosen filters.
      const rect=canvas.getBoundingClientRect(),d=pickDeposit(world().atlas.deposits,(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height,rect.width,rect.height,
        api.depositFilter,Math.max(10,10*(world().editor.appearance.markerScale??1)));
      if(api.getLayer()==='resources'&&d){event.stopImmediatePropagation();api.inspect(d.cell,d);}
      return;
    }
    event.stopImmediatePropagation();const p=point(event);
    if(tool==='add')request({type:'addBody',position:p,modelId:$('add-model').value,mode:$('add-mode').value,name:$('add-name').value,exceptionReason:$('add-reason').value,locked:$('add-locked').checked,label:'Добавить залежь'});
    if(tool==='move') {
      const d=api.getDeposit();if(!d){message('Сначала выберите залежь.',true);return;}
      request({type:'editBody',bodyId:d.oreBodyId,patch:{position:p,exceptionReason:$('body-reason').value||'Положение задано автором карты.'},label:'Переместить залежь'});
    }
    if(tool==='note') {
      if(!$('note-form').reportValidity())return;
      request({type:'annotation',position:p,name:$('note-name').value,description:$('note-description').value,tags:$('note-tags').value,locked:$('note-locked').checked,label:'Добавить подпись'});
    }
  },true);
  document.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
  $('brush-channel').onchange=()=>{const value=$('brush-channel').value;$('brush-strength').value=value==='potential'?'1':value==='rain'?'200':'500';if(tool==='brush')setTool('brush');};
  $('clear-area').onclick=()=>{area=null;$('edit-area-info').textContent='Область не выбрана: правила применяются ко всему миру.';api.render();};
  $('edit-area-radius').onchange=()=>{if(area){area.radiusKm=num('edit-area-radius');$('edit-area-info').textContent=`Выбрана область радиусом ${area.radiusKm} км.`;api.render();}};
  $('apply-preview').onclick=()=>{if(!preview)return;const next=preview,label=lastOperation?.label??'Изменения',oldIds=new Set(world().atlas.deposits.map(d=>d.oreBodyId)),added=lastOperation?.type==='addBody'?next.atlas.deposits.find(d=>!oldIds.has(d.oreBodyId)):null;replace(next);if(added)api.inspect(added.cell,added);message(`${label}: применено. Можно отменить.`);};
  $('cancel-preview').onclick=()=>{preview=null;lastOperation=null;$('compare-original').checked=false;sync();message('Предпросмотр отброшен.');controls();api.render();};
  $('compare-original').onchange=()=>api.render();
  $('undo-edit').onclick=()=>{if(job||preview)return;const previous=history.undo(world());if(previous){replace(previous,{record:false});message('Последнее изменение отменено.');}};
  $('redo-edit').onclick=()=>{if(job||preview)return;const next=history.redo(world());if(next){replace(next,{record:false});message('Изменение повторено.');}};
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&preview){$('cancel-preview').click();return;}if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)){e.preventDefault();(e.shiftKey?$('redo-edit'):$('undo-edit')).click();}});
  $('body-form').onsubmit=e=>{
    e.preventDefault();const d=api.getDeposit();if(!d)return;
    const patch={name:$('body-name').value,description:$('body-description').value,tags:$('body-tags').value,locked:$('body-locked').checked};
    const physical={latitudeDeg:num('body-lat'),longitudeDeg:num('body-lon'),depthM:num('body-depth'),oreMassMt:num('body-mass'),sizeClass:$('body-class').value};
    for(const [key,value] of Object.entries(physical))if(value!==d[key])patch[key]=value;
    const grades={};for(const input of $('body-grades').querySelectorAll('input')){const c=world().atlas.deposits.find(c=>c.oreBodyId===d.oreBodyId&&c.mineral===Number(input.dataset.mineral));if(Number(input.value)!==c.grade)grades[input.dataset.mineral]=Number(input.value);}
    if(Object.keys(grades).length)patch.grades=grades;patch.exceptionReason=$('body-reason').value;
    request({type:'editBody',bodyId:d.oreBodyId,patch,label:'Правка залежи'});
  };
  $('toggle-body-lock').onclick=()=>{const d=api.getDeposit();if(d)request({type:'editBody',bodyId:d.oreBodyId,patch:{locked:!d.locked},label:d.locked?'Снять закрепление тела':'Закрепить тело'});};
  $('delete-body').onclick=()=>{const d=api.getDeposit();if(d)request({type:'deleteBody',bodyId:d.oreBodyId,label:'Удалить залежь'});};
  for(const [id,key] of [['lock-terrain','terrain'],['lock-resources','resources']])$(id).onchange=()=>request({type:'locks',[key]:$(id).checked,label:'Закрепление слоя'});
  $('lock-area').onclick=()=>{if(!area){message('Сначала выделите область.',true);return;}if(!$('area-lock-terrain').checked&&!$('area-lock-resources').checked){message('Выберите, что закрепить в области.',true);return;}request({type:'locks',area,name:$('note-name').value||'Закреплённая область',areaTerrain:$('area-lock-terrain').checked,areaResources:$('area-lock-resources').checked,label:'Закрепить область'});};
  $('rule-preset').onchange=()=>fillRules(rulePresets[$('rule-preset').value]);
  $('all-models').onclick=()=>{for(const o of $('rule-models').options)o.selected=true;};$('no-models').onclick=()=>{for(const o of $('rule-models').options)o.selected=false;};
  $('resource-rules').onsubmit=e=>{e.preventDefault();api.setLayer('resources');request({type:'regenerate',area,rules:readRules(),seed:$('regeneration-seed').value,label:area?'Перегенерация ресурсов области':'Перегенерация ресурсов мира'});};
  $('save-rules').onclick=()=>{if($('resource-rules').reportValidity())request({type:'rules',rules:readRules(),label:'Сохранить правила наполнения'});};
  $('export-rules').onclick=()=>{if($('resource-rules').reportValidity())download(JSON.stringify({format:'worldgen-rules',version:1,rules:readRules()},null,2),'worldgen-rules.json');};
  function restoreRules(text) {const data=JSON.parse(text);if(data.format!=='worldgen-rules'||data.version!==1)throw new Error('Неподдерживаемый шаблон');request({type:'rules',rules:data.rules,label:'Импорт шаблона правил'});}
  $('import-rules').onclick=async()=>{if(!isDesktop()){$('rules-file').click();return;}try{const text=await openJson('rules');if(text!==null)restoreRules(text);}catch(e){message(e.message??e,true);}};
  $('rules-file').onchange=async()=>{try{const file=$('rules-file').files[0];if(!file)return;if(file.size>100000)throw new Error('Шаблон слишком велик');restoreRules(await file.text());}catch(e){message(e.message,true);}finally{$('rules-file').value='';}};
  $('clear-zones').onclick=()=>request({type:'clearZones',label:'Сбросить авторские зоны потенциала'});
  $('province-form').onsubmit=e=>{e.preventDefault();const selected=api.getSelected();if(selected===null){message('Выберите участок карты.',true);return;}request({type:'province',provinceId:world().atlas.provinceId[selected],name:$('province-name').value,label:'Название области'});};
  $('note-list').onchange=()=>{const note=world()?.editor.annotations.find(a=>a.id===$('note-list').value);if(!note)return;for(const [id,key] of [['note-name','name'],['note-description','description'],['note-tags','tags']])$(id).value=note[key];$('note-locked').checked=note.locked;api.inspect(makeGrid(world().grid.width,world().grid.height,world().grid.radiusKm).sample(note.position));};
  $('note-form').onsubmit=e=>{e.preventDefault();const note=world()?.editor.annotations.find(a=>a.id===$('note-list').value);if(!note){setTool('note');return;}request({type:'annotation',id:note.id,name:$('note-name').value,description:$('note-description').value,tags:$('note-tags').value,locked:$('note-locked').checked,label:'Правка подписи'});};
  $('delete-note').onclick=()=>{if($('note-list').value)request({type:'annotation',id:$('note-list').value,remove:true,label:'Удалить подпись'});};
  $('unlock-note').onclick=()=>{if($('note-list').value)request({type:'annotation',id:$('note-list').value,locked:false,label:'Снять закрепление подписи'});};
  $('appearance-form').onsubmit=e=>{e.preventDefault();request({type:'appearance',theme:$('map-theme').value,values:{labels:$('show-labels').checked,markerScale:num('marker-scale'),opacity:num('marker-opacity')},label:'Оформление карты'});};
  $('save-project').onclick=()=>download(serializeProject(world(),api.getView()),`worldgen-${world().config.seed.replace(/[^\p{L}\p{N}_-]/gu,'_')}-project.json`);
  $('load-project').onclick=async()=>{if(!isDesktop()){$('project-file').click();return;}try{const text=await openJson();if(text!==null)restoreText(text);}catch(e){message(e.message??e,true);}};
  $('project-file').onchange=async()=>{try{const file=$('project-file').files[0];if(!file)return;if(file.size>100*1024*1024)throw new Error('Проект превышает 100 МБ');restoreText(await file.text());}catch(e){message(e.message,true);}finally{$('project-file').value='';}};
  // IndexedDB can hold full world snapshots without localStorage's small size limit.
  const dbPromise=new Promise((resolve,reject)=>{const req=indexedDB.open('worldgen-editor',1);req.onupgradeneeded=()=>req.result.createObjectStore('versions',{keyPath:'id'});req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
  async function storage(action,value) {const db=await dbPromise;return new Promise((resolve,reject)=>{const tx=db.transaction('versions',action==='getAll'?'readonly':'readwrite'),store=tx.objectStore('versions'),r=store[action](value);tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('Сохранение версии прервано'));});}
  async function versions() {try{const entries=await storage('getAll');$('saved-versions').replaceChildren();for(const v of entries.sort((a,b)=>b.created-a.created)){const row=document.createElement('div');row.className='editor-row';const label=document.createElement('span');label.textContent=`${v.name} · ${new Date(v.created).toLocaleString('ru-RU')}`;const load=document.createElement('button'),remove=document.createElement('button');load.textContent='Открыть';remove.textContent='Удалить';load.onclick=()=>restoreText(v.text);remove.onclick=async()=>{try{await storage('delete',v.id);await versions();}catch(e){message(e.message,true);}};row.append(label,load,remove);$('saved-versions').append(row);}}catch(e){message(`Версии браузера недоступны: ${e.message}. Используйте файл проекта.`,true);}}
  $('save-version').onclick=async()=>{if(!world()||job||preview)return;try{$('save-version').disabled=true;await storage('put',{id:crypto.randomUUID(),name:$('version-name').value||`${world().config.seed} · правка ${world().editor.revision}`,created:Date.now(),text:serializeProject(world(),api.getView())});await versions();message('Версия сохранена на этом устройстве.');}catch(e){message(`Не удалось сохранить версию: ${e.message}. Сохраните файл проекта.`,true);}finally{controls();}};
  dbPromise.catch(()=>{});versions();if(isDesktop())$('save-version').textContent='Сохранить версию на устройстве';
  function ring(ctx,a,color,dashed=true) {
    const center=a.center,ref=Math.abs(center[1])>.99?[0,0,1]:[0,1,0],east=normalize(cross(center,ref)),north=normalize(cross(east,center)),angle=a.radiusKm/display().grid.radiusKm;
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.setLineDash(dashed?[7,5]:[]);ctx.beginPath();let previous=null;
    for(let k=0;k<=160;k++){const t=k/160*2*Math.PI,p=center.map((v,j)=>v*Math.cos(angle)+(east[j]*Math.cos(t)+north[j]*Math.sin(t))*Math.sin(angle)),m=mapPoint(p),x=m.x*canvas.width,y=m.y*canvas.height;if(previous&&Math.abs(x-previous.x)<canvas.width/2)ctx.lineTo(x,y);else ctx.moveTo(x,y);previous={x,y};}ctx.stroke();ctx.setLineDash([]);
  }
  function overlay() {if(!world())return;const ctx=canvas.getContext('2d');ctx.save();for(const lock of display().editor?.locks.areas??[])ring(ctx,lock.area,'#f6df9c',false);if(area)ring(ctx,area,'#ffffff');if(drag){if(tool==='area')ring(ctx,{center:drag.path[0],radiusKm:drag.end?pointDistance(drag.path[0],drag.end,world().grid.radiusKm):num('edit-area-radius')},'#ffffff');else{for(const p of drag.path)ring(ctx,{center:p,radiusKm:num('edit-area-radius')},'#fff8',false);}}ctx.restore();}
  return {displayWorld:display,overlay,selectionChanged,sync,busy:()=>!!(job||preview),reset(){job?.terminate();job=null;preview=null;area=null;drag=null;history.clear();lastOperation=null;$('compare-original').checked=false;$('edit-area-info').textContent='Область не выбрана: правила применяются ко всему миру.';sync();controls();message(toolText[tool]);}};
}
