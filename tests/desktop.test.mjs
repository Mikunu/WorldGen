import test from 'node:test';
import assert from 'node:assert/strict';
import {saveBlob,saveJson,openJson,isDesktop} from '../src/desktop.js';

test('native bridge preserves UTF-8 JSON, binary PNG and picker cancellation',async()=>{
  const calls=[];
  globalThis.__TAURI__={core:{invoke:async(command,args)=>{calls.push({command,args});return command==='open_document'?null:'D:\\карты\\Эмбер.json';}}};
  try {
    assert.equal(isDesktop(),true);
    assert.equal(await saveJson('{"seed":"Эмбер"}','Эмбер.json'),'D:\\карты\\Эмбер.json');
    assert.deepEqual(calls[0],{command:'save_document',args:{name:'Эмбер.json',kind:'json',content:'{"seed":"Эмбер"}'}});
    const png=new Uint8Array(20000);png.set([137,80,78,71,13,10,26,10]);png[19999]=255;
    await saveBlob(new Blob([png]),'map.png','png');
    assert.deepEqual(Buffer.from(calls[1].args.content,'base64'),Buffer.from(png));
    assert.equal(await openJson(),null);
    assert.deepEqual(calls[2],{command:'open_document',args:{kind:'project'}});
    await openJson('rules');assert.equal(calls[3].args.kind,'rules');
  } finally {delete globalThis.__TAURI__;}
  assert.equal(isDesktop(),false);
});

test('native IO errors propagate to callers and failed canvas output is rejected',async()=>{
  globalThis.__TAURI__={core:{invoke:async()=>{throw new Error('access denied');}}};
  try {
    await assert.rejects(saveJson('{}','world.json'),/access denied/);
    await assert.rejects(openJson(),/access denied/);
    await assert.rejects(saveBlob(null,'map.png','png'),/подготовить файл/);
  } finally {delete globalThis.__TAURI__;}
});
