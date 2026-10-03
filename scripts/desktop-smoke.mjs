import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

// Run against a test instance started with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=
// "--remote-debugging-port=9437 --remote-debugging-address=127.0.0.1".
const base=process.env.WORLDGEN_DEBUG_URL??'http://127.0.0.1:9437';
const targets=await (await fetch(`${base}/json/list`)).json();
const target=targets.find(t=>t.type==='page'&&t.url==='http://tauri.localhost/');
assert.ok(target,'Running release Tauri WebView not found');
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.addEventListener('open',resolve,{once:true});socket.addEventListener('error',reject,{once:true});});
let nextId=0;
const pending=new Map(),errors=[];
socket.addEventListener('message',({data})=>{
  const message=JSON.parse(data);
  if(message.id){const p=pending.get(message.id);if(!p)return;pending.delete(message.id);clearTimeout(p.timer);message.error?p.reject(new Error(JSON.stringify(message.error))):p.resolve(message.result);}
  else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails);
  else if(message.method==='Log.entryAdded'&&message.params.entry.level==='error')errors.push(message.params.entry);
});
function send(method,params={}) {return new Promise((resolve,reject)=>{const id=++nextId,timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} timed out`));},30000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));});}
async function evaluate(expression) {const result=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
async function waitFor(expression) {for(let i=0;i<60;i++){if(await evaluate(expression))return;await new Promise(r=>setTimeout(r,1000));}throw new Error(`Timed out: ${expression}`);}
const report={};
try {
  await send('Runtime.enable');await send('Log.enable');
  await waitFor("document.querySelector('#map-placeholder').hidden && !document.querySelector('#generate').disabled");
  report.initial=await evaluate("({title:document.title,url:location.href,desktop:!!window.__TAURI__?.core?.invoke,status:document.querySelector('#status').textContent,canvas:[document.querySelector('#map').width,document.querySelector('#map').height]})");
  assert.equal(report.initial.desktop,true);assert.match(report.initial.status,/проверки пройдены/);
  await evaluate("document.querySelector('[data-layer=potential]').click()");
  await waitFor("!document.querySelector('#layer-note').textContent.includes('Расчёт') && !document.querySelector('#layer-note').textContent.includes('Расчет')");
  await new Promise(r=>setTimeout(r,4000));
  report.potential=await evaluate("({note:document.querySelector('#layer-note').textContent,layer:document.querySelector('[data-layer=potential]').getAttribute('aria-pressed')})");
  assert.equal(report.potential.layer,'true');assert.doesNotMatch(report.potential.note,/ошибка/i);
  await evaluate("document.querySelector('[data-layer=resources]').click()");
  // The rules operation exercises the real editor worker and preview/apply/undo path.
  await evaluate("document.querySelector('#rule-density').value='1.5'; document.querySelector('#save-rules').click()");
  await waitFor("!document.querySelector('#edit-preview').hidden");
  report.preview=await evaluate("document.querySelector('#preview-title').textContent");
  await evaluate("document.querySelector('#apply-preview').click()");
  await waitFor("document.querySelector('#edit-preview').hidden && !document.querySelector('#undo-edit').disabled");
  assert.equal(await evaluate("document.querySelector('#rule-density').value"),'1.5');
  await evaluate("document.querySelector('#undo-edit').click()");
  assert.equal(await evaluate("document.querySelector('#rule-density').value"),'1');
  await evaluate("document.querySelector('#redo-edit').click()");
  assert.equal(await evaluate("document.querySelector('#rule-density').value"),'1.5');
  report.editor='preview, apply, undo and redo passed';
  await evaluate("document.querySelector('#version-name').value='Tauri smoke test';document.querySelector('#save-version').click()");
  await waitFor("document.querySelector('#saved-versions').textContent.includes('Tauri smoke test') && !document.querySelector('#save-version').disabled");
  report.versions='IndexedDB snapshot saved';
  await evaluate("document.querySelector('[data-layer=elevation]').click();window.scrollTo(0,0)");
  await send('Page.enable');
  const {data}=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  const output=fileURLToPath(new URL('../output/',import.meta.url));
  await mkdir(output,{recursive:true});
  await writeFile(`${output}/tauri-preview.png`,Buffer.from(data,'base64'));
  assert.deepEqual(errors,[],'WebView console errors');
  report.consoleErrors=errors;
  await writeFile(`${output}/tauri-smoke-report.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
} finally {socket.close();}
