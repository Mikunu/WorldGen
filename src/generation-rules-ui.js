import {generationRuleSchema,ruleSectionNames,defaultGenerationRules,normalizeGenerationRules,parseGenerationRules,serializeGenerationRules,ruleFields,MAX_RULES_BYTES} from './core/generation-rules.js';
import {rocks,minerals} from './core/geology-catalog.js';
import {depositModels} from './core/deposit-models.js';
import {isDesktop,openJson,saveJson} from './desktop.js';
import {FORMULA_DESCRIPTORS,FORMULA_ENVIRONMENTS,normalizeFormulas,validateFormula} from './core/generation-formulas.js';
import {biomeNames} from './core/climate.js';
import {drawMap,drawRegion} from './render.js';

const $=id=>document.getElementById(id);
export function mountGenerationRules({onSave,onChange,busy}) {
  const normalizeDraft=input=>{const source=input??{},formulas=normalizeFormulas(source.formulas);const {formulas:ignored,...rules}=source;return {...normalizeGenerationRules(rules),formulas};};
  let draft=normalizeDraft(defaultGenerationRules),disabled=false,lastSaved=null,formulaWorker=null,formulaPreviewBusy=false;
  const section=$('generation-rule-section'),fields=$('generation-rule-fields'),form=$('generation-rules-form'),dialog=$('generation-rules-dialog'),resourceForm=$('resource-rules');
  function cancelFormulaPreview({hide=false}={}) {
    formulaWorker?.terminate();formulaWorker=null;formulaPreviewBusy=false;
    const previewButton=$('formula-preview');if(previewButton)previewButton.disabled=false;
    if(hide&&$('formula-preview-panel'))$('formula-preview-panel').hidden=true;
  }
  const close=()=>{cancelFormulaPreview();if(dialog?.open)dialog.close();};
  function selectTab(tab) {
    for(const button of document.querySelectorAll('[data-rules-tab]'))button.setAttribute('aria-selected',String(button.dataset.rulesTab===tab));
    for(const panel of document.querySelectorAll('[data-rules-panel]'))panel.hidden=panel.dataset.rulesPanel!==tab;
    $('generation-rules-description').textContent=tab==='world'?'Изменения применяются к следующему созданному миру.':tab==='resources'?'Эти параметры применяются к ресурсам текущей карты через предпросмотр.':'Формула проходит проверку до сохранения и не исполняет JavaScript.';
    dialog?.classList.toggle('resources-tab',tab==='resources');
  }
  const open=tab=>{selectTab(tab);if(!dialog?.open)dialog.showModal();};
  $('open-generation-rules').onclick=()=>open('world');
  $('open-resource-rules').onclick=()=>open('resources');
  document.querySelectorAll('[data-rules-tab]').forEach(button=>button.onclick=()=>selectTab(button.dataset.rulesTab));
  $('close-generation-rules').onclick=close;
  dialog?.addEventListener('cancel',event=>{event.preventDefault();close();});
  dialog?.addEventListener('click',event=>{const rect=dialog.getBoundingClientRect();if(event.target===dialog&&(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom))close();});
  for(const key of Object.keys(generationRuleSchema))section.add(new Option(ruleSectionNames[key]??key,key));
  const status=(text,error=false)=>{$('generation-rule-status').textContent=text;$('generation-rule-status').classList.toggle('error',error);};
  const valueAt=path=>path.reduce((value,key)=>value[key],draft);
  function setAt(path,value) {let target=draft;for(const key of path.slice(0,-1))target=target[key];target[path.at(-1)]=value;}
  function render() {
    fields.replaceChildren();let previousGroup=null;
    for(const field of ruleFields({[section.value]:generationRuleSchema[section.value]})) {
      const path=field.path,group=path.length>2?path[1]:null;
      if(group!==previousGroup&&group!==null) {
        const heading=document.createElement('h3');heading.className='generation-rule-group';
        heading.textContent=section.value==='rocks'?rocks[Number(group)]?.name??group:section.value==='depositModels'?depositModels.find(m=>m.id===group)?.kind??group:group;
        fields.append(heading);previousGroup=group;
      }
      const label=document.createElement('label'),input=document.createElement('input'),title=document.createElement('span');
      title.textContent=path.includes('grades')?`${minerals[Number(path.at(-2))]?.name??path.at(-2)} · ${field.label}`:field.label;
      label.className='generation-rule-field';input.id='generation-'+path.join('-');input.dataset.rule=path.join('.');
      if(typeof field.default==='boolean'){input.type='checkbox';input.checked=valueAt(path);label.classList.add('generation-rule-flag');}
      else {input.type='number';input.min=field.min;input.max=field.max;input.step=field.integer?'1':'any';input.required=true;input.value=valueAt(path);}
      input.oninput=()=>{setAt(path,input.type==='checkbox'?input.checked:input.value===''?NaN:Number(input.value));onChange?.(draft);status('Есть изменения. «Создать мир» применит их к новой карте.');};
      input.disabled=disabled;label.append(title,input);
      const hint=document.createElement('small');hint.textContent=`По умолчанию: ${field.default}${typeof field.default==='number'?` · ${field.min}–${field.max}`:''}`;label.append(hint);fields.append(label);
    }
  }
  function read() {
    if(!commitCurrentFormula()) {open('formulas');throw new Error('Исправьте формулу перед сохранением правил или созданием мира');}
    if(!form.checkValidity()){open('world');form.reportValidity();throw new Error('Исправьте выделенные поля правил');}
    try{return normalizeDraft(draft);}catch(error){open('world');status(error.message,true);throw error;}
  }
  function adopt(rules,message='Правила загружены из проекта.') {draft=normalizeDraft(rules);render();$('generation-rule-json').value=serializeGenerationRules(draft);renderFormula();onChange?.(draft);status(message);}
  async function action(fn) {if(disabled||busy?.())return;try{await fn();}catch(error){status(error.message??String(error),true);}}
  section.onchange=render;
  form.onsubmit=e=>{e.preventDefault();action(async()=>{await onSave(read());close();});};
  // Registered after editor-ui's property handlers: close only when a valid operation starts.
  resourceForm?.addEventListener('submit',()=>close());
  $('save-rules')?.addEventListener('click',()=>{if(resourceForm.reportValidity())close();});
  $('rules-file')?.addEventListener('change',()=>{if($('rules-file').files[0])close();});
  $('generation-rule-reset').onclick=()=>action(()=>adopt(defaultGenerationRules,'Восстановлены стандартные правила для следующего мира.'));
  $('generation-rule-export').onclick=()=>action(async()=>{const result=await saveJson(serializeGenerationRules(read()),'worldgen-generation-rules.json');if(result!==null)status('Правила экспортированы.');});
  function importText(text) {adopt(parseGenerationRules(text),'Правила импортированы. Нажмите «Создать мир» или сохраните их в проект.');}
  $('generation-rule-import').onclick=()=>action(async()=>{if(isDesktop()){const text=await openJson('rules');if(text!==null)importText(text);}else $('generation-rule-file').click();});
  $('generation-rule-file').onchange=()=>action(async()=>{try{const file=$('generation-rule-file').files[0];if(!file)return;if(file.size>MAX_RULES_BYTES)throw new Error('Файл правил превышает 100 КБ');importText(await file.text());}finally{$('generation-rule-file').value='';}});
  $('generation-rule-read-json').onclick=()=>action(()=>importText($('generation-rule-json').value));
  $('generation-rule-show-json').onclick=()=>action(()=>{$('generation-rule-json').value=serializeGenerationRules(read());status('JSON обновлён из полей правил.');});
  const formulaById=new Map(FORMULA_DESCRIPTORS.map(descriptor=>[descriptor.id,descriptor]));
  const formulaPanel=document.createElement('section'),formulaTab=document.createElement('button');
  formulaPanel.id='generation-rules-formulas';formulaPanel.dataset.rulesPanel='formulas';formulaPanel.setAttribute('role','tabpanel');formulaPanel.hidden=true;
  formulaTab.type='button';formulaTab.dataset.rulesTab='formulas';formulaTab.setAttribute('role','tab');formulaTab.setAttribute('aria-selected','false');formulaTab.setAttribute('aria-controls',formulaPanel.id);formulaTab.textContent='Формулы';
  document.querySelector('.generation-rules-tabs').append(formulaTab);document.querySelector('.generation-rules-dialog-body').append(formulaPanel);
  formulaPanel.innerHTML='<div class="formula-editor"><label for="formula-select">Расчёт</label><select id="formula-select"></select><p id="formula-description" class="hint"></p><label for="formula-expression">Выражение</label><textarea id="formula-expression" rows="4" spellcheck="false" placeholder="Пусто — встроенная формула"></textarea><p class="hint">Несохранённый текст проверяется и сохраняется перед сохранением правил или созданием мира.</p><details class="formula-help"><summary>Синтаксис выражений</summary><p><code>^</code>, условие <code>if(условие, да, нет)</code> или <code>условие ? да : нет</code>; <code>min</code>, <code>max</code>, <code>clamp</code>, <code>sin</code>, <code>cos</code>, <code>tan</code>, <code>abs</code>, <code>sqrt</code>, <code>pow</code>, <code>exp</code>, <code>log</code>, <code>floor</code>, <code>ceil</code>, <code>round</code>, <code>sign</code>, <code>lerp</code>, <code>smoothstep</code>, <code>rand()</code>, <code>noise(x, y, z[, scale])</code>, константы <code>pi</code> и <code>e</code>. Тригонометрия использует радианы: <code>sin(latitudeDeg * pi / 180)</code>.</p></details><p id="formula-validation" class="hint" role="status"></p><div class="formula-actions"><button id="formula-insert-example" type="button">Вставить пример</button><button id="formula-store" type="button">Проверить и сохранить</button><button id="formula-clear" type="button">Вернуть встроенную</button><button id="formula-clear-all" type="button">Сбросить все формулы</button><button id="formula-preview" type="button">Предпросмотр</button></div><div id="formula-variables"></div><section id="formula-preview-panel" hidden><p id="formula-preview-caption" class="hint"></p><div class="formula-preview-maps"><figure><figcaption>Встроенный расчёт</figcaption><canvas id="formula-preview-original" width="480" height="240"></canvas></figure><figure><figcaption>С выбранной формулой</figcaption><canvas id="formula-preview-custom" width="480" height="240"></canvas></figure></div><table><thead><tr><th></th><th>Мин.</th><th>Макс.</th><th>Среднее</th></tr></thead><tbody id="formula-preview-stats"></tbody></table></section></div>';
  const variablesList=$('formula-variables'),variablesReference=document.createElement('details'),variablesSummary=document.createElement('summary');
  variablesReference.className='formula-help';variablesSummary.textContent='Переменные и единицы';
  variablesList.replaceWith(variablesReference);variablesReference.append(variablesSummary,variablesList);$('formula-preview-panel').after(variablesReference);
  const formulaSelect=$('formula-select'),formulaExpression=$('formula-expression'),formulaValidation=$('formula-validation');
  for(const descriptor of FORMULA_DESCRIPTORS)formulaSelect.add(new Option(`${descriptor.section} · ${descriptor.label}`,descriptor.id));
  let activeFormulaId=formulaSelect.value;
  function selectedFormula(){return formulaById.get(formulaSelect.value);}
  function validateCurrent() {try{const program=validateFormula(formulaSelect.value,formulaExpression.value);formulaValidation.textContent=program?`Проверено: ${program.nodeCount} узлов.`:'Встроенная формула будет сохранена.';formulaValidation.classList.remove('error');return true;}catch(error){formulaValidation.textContent=error.message;formulaValidation.classList.add('error');return false;}}
  function renderFormula() {const descriptor=selectedFormula();if(!descriptor)return;formulaExpression.value=draft.formulas.expressions[descriptor.id]??'';$('formula-description').textContent=`${descriptor.description} Результат: ${descriptor.min}…${descriptor.max} ${descriptor.unit}.`;$('formula-variables').replaceChildren();const title=document.createElement('h3');title.textContent='Разрешённые переменные';const table=document.createElement('table'),head=document.createElement('tr');for(const text of ['Имя','Значение','Единицы']){const th=document.createElement('th');th.textContent=text;head.append(th);}table.append(head);for(const variable of descriptor.variables){const row=document.createElement('tr');for(const text of [variable.name,variable.label,variable.unit]){const cell=document.createElement('td');cell.textContent=text;row.append(cell);}table.append(row);}$('formula-variables').append(title,table);const addHint=text=>{const hint=document.createElement('p');hint.className='hint';hint.textContent=text;$('formula-variables').append(hint);};if(descriptor.id==='climate.biome')addHint(`ID биома: ${biomeNames.map((name,id)=>`${id} — ${name}`).join('; ')}.`);if(descriptor.variables.some(variable=>variable.name==='environmentId'))addHint(`environmentId: ${FORMULA_ENVIRONMENTS.map((name,id)=>`${id} — ${name}`).join('; ')}.`);if(descriptor.id==='resources.intensity')addHint('Расчёт выполняется один раз для каждой модели и класса залежи: latitudeDeg, longitudeDeg, elevationM, isOcean, x, y и z здесь равны нулю; season равен −1 (годовой расчёт).');if(descriptor.id==='resources.grade')addHint('Содержание измеряется в единицах конкретного минерала; статистика предпросмотра объединяет разные единицы только как ориентир.');validateCurrent();}
  function storeFormula() {if(!validateCurrent())return false;const expressions={...draft.formulas.expressions},source=formulaExpression.value.trim();if(source)expressions[formulaSelect.value]=source;else delete expressions[formulaSelect.value];draft.formulas=normalizeFormulas({version:draft.formulas.version,expressions});onChange?.(draft);status(`Формула «${selectedFormula().label}» сохранена в черновик.`);return true;}
  function commitCurrentFormula() {const saved=draft.formulas.expressions[formulaSelect.value]??'';return formulaExpression.value.trim()===saved||storeFormula();}
  function previewConfig() {return {...draft.world,seed:$('seed').value,width:48,height:24,plateCount:Number($('plateCount').value),epochs:Math.min(Number($('epochs').value),6),generationRules:read(),resourceDensity:Math.min(1,draft.world.resourceDensity??1)};}
  function previewOptions(descriptor,potentialRaster) {
    return {layer:descriptor.mapLayer??'elevation',hazard:descriptor.id.startsWith('hazards.')?descriptor.id.split('.')[1]:'earthquake',resource:'all',depositClass:'all',season:'annual',rivers:false,coasts:true,graticule:false,potentialRaster};
  }
  function renderPreview(data,descriptor) {
    if(descriptor.id==='region.elevation') {
      drawRegion($('formula-preview-original'),data.originalRegion,'elevation');
      drawRegion($('formula-preview-custom'),data.customRegion,'elevation');
    } else {
      drawMap($('formula-preview-original'),data.original,previewOptions(descriptor,data.originalPotential));
      drawMap($('formula-preview-custom'),data.custom,previewOptions(descriptor,data.customPotential));
    }
    $('formula-preview-caption').textContent=`${data.fieldLabel}${data.unit?` · ${data.unit}`:''}. Выборка: 48 × 24, до 6 эпох.`;
    const body=$('formula-preview-stats');body.replaceChildren();
    for(const [label,stats] of [['Встроенный',data.originalStats],['Формула',data.customStats]]) {
      const row=document.createElement('tr');
      for(const value of [label,stats.min,stats.max,stats.mean]) {
        const cell=document.createElement('td');
        cell.textContent=typeof value==='number'?value.toLocaleString('ru-RU',{maximumFractionDigits:2}):value??'—';
        row.append(cell);
      }
      body.append(row);
    }
  }
  function preview() {
    if(formulaPreviewBusy||!commitCurrentFormula())return;
    let config;
    try {config=previewConfig();} catch(error) {cancelFormulaPreview();status(error.message??String(error),true);return;}
    cancelFormulaPreview();
    formulaPreviewBusy=true;$('formula-preview').disabled=true;$('formula-preview-panel').hidden=false;
    const formulaId=formulaSelect.value,worker=formulaWorker=new Worker('/src/formula-preview-worker.js',{type:'module'});
    const finish=()=>{if(worker!==formulaWorker)return;worker.terminate();formulaWorker=null;formulaPreviewBusy=false;$('formula-preview').disabled=false;};
    worker.onmessage=({data})=>{
      if(worker!==formulaWorker||formulaId!==formulaSelect.value)return;
      if(data.type==='error') {finish();formulaValidation.textContent=data.message;formulaValidation.classList.add('error');return;}
      try {renderPreview(data,selectedFormula());} catch(error) {formulaValidation.textContent=error.message??String(error);formulaValidation.classList.add('error');}
      finish();
    };
    worker.onerror=event=>{if(worker!==formulaWorker)return;finish();formulaValidation.textContent=event.message;formulaValidation.classList.add('error');};
    worker.postMessage({config,formulaId});
  }
  formulaTab.onclick=()=>selectTab('formulas');formulaSelect.onchange=()=>{const nextId=formulaSelect.value;formulaSelect.value=activeFormulaId;if(!commitCurrentFormula()){open('formulas');return;}cancelFormulaPreview({hide:true});formulaSelect.value=nextId;activeFormulaId=nextId;renderFormula();};formulaExpression.oninput=validateCurrent;$('formula-insert-example').onclick=()=>{formulaExpression.value=selectedFormula().example;validateCurrent();};$('formula-store').onclick=storeFormula;$('formula-clear').onclick=()=>{formulaExpression.value='';storeFormula();renderFormula();};$('formula-clear-all').onclick=()=>{draft.formulas=normalizeFormulas();cancelFormulaPreview({hide:true});renderFormula();onChange?.(draft);status('Все пользовательские формулы сброшены.');};$('formula-preview').onclick=preview;
  render();renderFormula();$('generation-rule-json').value=serializeGenerationRules(draft);
  return {read,adopt,close,sync(rules){const signature=JSON.stringify(rules);if(signature!==lastSaved){lastSaved=signature;adopt(rules);}},setWorldValue(key,value){if(Object.hasOwn(draft.world,key)){draft.world[key]=value;if(section.value==='world')render();}},setBusy(value){disabled=value;dialog.querySelectorAll('input,button,select,textarea').forEach(el=>{if(el.id!=='close-generation-rules')el.disabled=value;});$('generation-rule-save').disabled=value||$('save-project').disabled;}};
}
