import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFile,mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import os from 'node:os';
import path from 'node:path';
import {checkVersion,parseVersion,requireAlphaVersion,setVersion} from '../scripts/set-version.mjs';

async function fixture() {
  const root=await mkdtemp(path.join(os.tmpdir(),'worldgen-version-')),desktop=path.join(root,'tauri');
  await mkdir(path.join(desktop,'src-tauri'),{recursive:true});
  await Promise.all([writeFile(path.join(root,'package.json'),'{"name":"worldgen-physical-prototype","version":"0.9.0"}\n'),writeFile(path.join(root,'index.html'),'<span>ПРОТОТИП 0.9.0 · ТЕСТ</span>\n'),writeFile(path.join(desktop,'package.json'),'{"name":"worldgen-tauri","version":"0.9.0"}\n'),writeFile(path.join(desktop,'index.html'),'<span>ПРОТОТИП 0.9.0 · ТЕСТ</span>\n'),writeFile(path.join(desktop,'start.cmd'),'if exist "release\\WorldGen_0.9.0.exe" start "" "release\\WorldGen_0.9.0.exe"\n'),writeFile(path.join(desktop,'src-tauri','Cargo.toml'),'[package]\nname = "worldgen"\nversion = "0.9.0"\n'),writeFile(path.join(desktop,'src-tauri','Cargo.lock'),'version = 3\n\n[[package]]\nname = "worldgen"\nversion = "0.9.0"\n'),writeFile(path.join(desktop,'src-tauri','tauri.conf.json'),'{"version":"0.9.0"}\n')]);
  return {root,desktop};
}

test('set-version updates the bounded desktop and recognized canonical metadata together',async t=>{
  const {root,desktop}=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));
  const result=await setVersion('0.9.0-alpha.1',{desktopRoot:desktop,sourceRoot:root});
  assert.equal(result.version,'0.9.0-alpha.1');assert.equal(result.windowsVersion,'0.9.0.0');assert.equal(result.alpha,true);
  const checked=await checkVersion({desktopRoot:desktop,sourceRoot:root});
  assert.equal(checked.version,'0.9.0-alpha.1');assert.equal(checked.canonicalSource,true);
  for(const file of [path.join(desktop,'package.json'),path.join(desktop,'src-tauri','Cargo.toml'),path.join(desktop,'src-tauri','Cargo.lock'),path.join(desktop,'src-tauri','tauri.conf.json'),path.join(desktop,'index.html'),path.join(desktop,'start.cmd'),path.join(root,'package.json'),path.join(root,'index.html')])assert.match(await readFile(file,'utf8'),/0\.9\.0-alpha\.1/);
  assert.doesNotMatch(await readFile(path.join(desktop,'start.cmd'),'utf8'),/WorldGen_0\.9\.0\.exe/);
});

test('version parsing rejects malformed prereleases, shell text and unsupported Windows components',()=>{
  for(const bad of ['0.9.0-alpha.01','0.09.0-alpha.1','0.9.0-alpha.1;whoami','0.65536.0-alpha.1','0.9.0+meta;bad'])assert.throws(()=>parseVersion(bad),/Invalid SemVer|Windows version/);
  assert.equal(parseVersion('1.2.3-rc.1+build.7').windowsVersion,'1.2.3.0');
  const metadata=parseVersion('0.1.0-alpha.1');
  assert.equal(metadata.prereleaseIdentifier,'alpha.1');
  assert.equal(new Set(Object.keys(metadata).map(key=>key.toLowerCase())).size,Object.keys(metadata).length,'metadata keys must remain distinct for PowerShell ConvertFrom-Json');
  assert.throws(()=>requireAlphaVersion('0.9.0-alpha'),/0\.x\.y-alpha\.N/);assert.throws(()=>requireAlphaVersion('1.0.0'),/0\.x\.y-alpha\.N/);
});

test('standalone desktop metadata check does not require a parent prototype repository',async t=>{
  const {root,desktop}=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));
  await Promise.all([rm(path.join(root,'package.json')),rm(path.join(root,'index.html'))]);
  const script=path.join(desktop,'scripts','set-version.mjs');await mkdir(path.dirname(script));await copyFile(fileURLToPath(new URL('../scripts/set-version.mjs',import.meta.url)),script);
  const result=spawnSync(process.execPath,[script,'--check'],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);const checked=JSON.parse(result.stdout);
  assert.equal(checked.version,'0.9.0');assert.equal(checked.canonicalSource,false);
});

test('check catches a stale managed value and invalid set requests leave a fixture unchanged',async t=>{
  const {root,desktop}=await fixture();t.after(()=>rm(root,{recursive:true,force:true}));
  const before=await readFile(path.join(desktop,'package.json'),'utf8');
  await assert.rejects(()=>setVersion('0.9.0-alpha.1;bad',{desktopRoot:desktop,sourceRoot:root}),/Invalid SemVer/);
  assert.equal(await readFile(path.join(desktop,'package.json'),'utf8'),before);
  await writeFile(path.join(desktop,'src-tauri','Cargo.toml'),'[package]\nname = "worldgen"\nversion = "0.8.0"\n');
  await assert.rejects(()=>checkVersion({desktopRoot:desktop,sourceRoot:root}),/Version metadata differs/);
  await setVersion('0.9.0-alpha.1',{desktopRoot:desktop,sourceRoot:root});
  await writeFile(path.join(desktop,'start.cmd'),'if exist "release\\WorldGen_0.9.0-alpha.1.exe" start "" "release\\WorldGen_0.9.0.exe"\n');
  await assert.rejects(()=>checkVersion({desktopRoot:desktop,sourceRoot:root}),/start\.cmd versioned executable differs/);
});
