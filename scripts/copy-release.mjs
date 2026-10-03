import {cp,mkdir,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(path.join(root,'release'),{recursive:true});
await cp(path.join(root,'src-tauri','target','release','worldgen.exe'),path.join(root,'release','WorldGen.exe'));
console.log('Portable app: release/WorldGen.exe');
const installers=path.join(root,'src-tauri','target','release','bundle','nsis');
for(const name of await readdir(installers).catch(error=>{if(error.code==='ENOENT')return [];throw error;})) {
  if(name.endsWith('-setup.exe'))await cp(path.join(installers,name),path.join(root,'release',name));
}
