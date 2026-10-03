import {spawnSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const cli=path.join(root,'node_modules','@tauri-apps','cli','tauri.js');
if(!existsSync(cli)) {
  console.error('Сначала запустите setup.cmd, чтобы установить зависимости сборки.');
  process.exit(1);
}
const action=process.argv[2]??'dev';
const args=action==='build'?['build']:action==='portable'?['build','--no-bundle']:['dev'];
const result=spawnSync(process.execPath,[cli,...args],{cwd:root,stdio:'inherit',windowsHide:true});
if(result.error)console.error(result.error.message);
if(result.status===0&&['build','portable'].includes(action))await import('./copy-release.mjs');
process.exit(result.status??1);
