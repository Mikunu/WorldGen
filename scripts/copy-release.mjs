import {cp,mkdir,readdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root=fileURLToPath(new URL('../',import.meta.url));
await mkdir(path.join(root,'release'),{recursive:true});
const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
const source=path.join(root,'src-tauri','target','release','worldgen.exe');
const versioned=path.join(root,'release',`WorldGen_${version}.exe`);
await cp(source,versioned);
console.log(`Portable app: release/WorldGen_${version}.exe`);
try{await cp(source,path.join(root,'release','WorldGen.exe'));console.log('Default app: release/WorldGen.exe');}
catch(error){if(!['EPERM','EBUSY'].includes(error.code))throw error;console.log('WorldGen.exe is in use; the new version is available at the versioned path.');}
const installers=path.join(root,'src-tauri','target','release','bundle','nsis');
for(const name of await readdir(installers).catch(error=>{if(error.code==='ENOENT')return [];throw error;})) {
  if(name.endsWith('-setup.exe'))await cp(path.join(installers,name),path.join(root,'release',name));
}
