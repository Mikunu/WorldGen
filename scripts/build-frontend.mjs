import {cp, mkdir, readdir, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {existsSync} from 'node:fs';
import {checkVersion} from './set-version.mjs';

// Only application assets are embedded; outputs, dependencies and Rust sources stay private.
const root=fileURLToPath(new URL('../',import.meta.url));
const dist=path.join(root,'dist');
// The standalone Git repository is buildable without the prototype beside it.
const syncUrl=new URL('../../scripts/sync-desktop.mjs',import.meta.url);
if(existsSync(fileURLToPath(syncUrl))){const {syncDesktop}=await import(syncUrl.href);await syncDesktop();}
await checkVersion();
await mkdir(dist,{recursive:true});
for(const entry of await readdir(dist))await rm(path.join(dist,entry),{recursive:true,force:true});
for(const entry of ['index.html','style.css','src'])await cp(path.join(root,entry),path.join(dist,entry),{recursive:true});
console.log('WorldGen: frontend assets staged in dist/');
