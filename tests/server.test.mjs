import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('local server serves the app and modules without exposing project files',async()=>{
  const child=spawn(process.execPath,[fileURLToPath(new URL('../server.mjs',import.meta.url))],{env:{...process.env,WORLDGEN_PORT:'0'},stdio:['ignore','pipe','pipe'],windowsHide:true});
  try {
    const url=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Server start timed out')),5000);
      child.stdout.on('data',chunk=>{const match=String(chunk).match(/http:\/\/127\.0\.0\.1:\d+/);if(match){clearTimeout(timer);resolve(match[0]);}});
      child.once('error',error=>{clearTimeout(timer);reject(error);});
      child.once('exit',code=>{clearTimeout(timer);reject(new Error(`Server exited ${code}`));});
    });
    const home=await fetch(url);assert.equal(home.status,200);assert.match(await home.text(),/<title>WorldGen/);
    for(const route of ['/style.css','/src/app.js','/src/worker.js','/src/core/world.js']) {
      const response=await fetch(url+route);assert.equal(response.status,200);
      assert.match(response.headers.get('content-type'),route.endsWith('.css')?/text\/css/:/javascript/);
    }
    for(const route of ['/package.json','/README.md','/.git/config','/src/%2e%2e/%70ackage.json','/src/%2e%2e%5cREADME.md'])assert.equal((await fetch(url+route)).status,404);
  } finally {child.kill();}
});
