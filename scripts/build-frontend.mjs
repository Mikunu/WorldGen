import {cp, mkdir, readdir, rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

// Only application assets are embedded; outputs, dependencies and Rust sources stay private.
const root=fileURLToPath(new URL('../',import.meta.url));
const dist=path.join(root,'dist');
await mkdir(dist,{recursive:true});
for(const entry of await readdir(dist))await rm(path.join(dist,entry),{recursive:true,force:true});
for(const entry of ['index.html','style.css','src'])await cp(path.join(root,entry),path.join(dist,entry),{recursive:true});
console.log('WorldGen: frontend assets staged in dist/');
