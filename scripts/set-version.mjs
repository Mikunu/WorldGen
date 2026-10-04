import {readFile,writeFile} from 'node:fs/promises';
import {existsSync,readFileSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const desktopRoot=fileURLToPath(new URL('../',import.meta.url));
const sourceRoot=path.resolve(desktopRoot,'..');
const semver=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const alpha=/^0\.(0|[1-9]\d*)\.(0|[1-9]\d*)-alpha\.(0|[1-9]\d*)$/;

const text=async file=>readFile(file,'utf8');
const write=async(file,value)=>writeFile(file,value,'utf8');
const replaceOne=(value,pattern,replacement,label)=>{
  let matches=0;
  const next=value.replace(pattern,(...args)=>{matches++;return typeof replacement==='function'?replacement(...args):replacement;});
  if(matches!==1)throw new Error(`${label}: expected exactly one managed value, found ${matches}`);
  return next;
};

export function parseVersion(version) {
  if(typeof version!=='string')throw new Error('Version must be a string.');
  const match=semver.exec(version);
  if(!match)throw new Error(`Invalid SemVer version: ${version}`);
  const [major,minor,patch]=match.slice(1,4).map(Number);
  if([major,minor,patch].some(value=>!Number.isSafeInteger(value)||value>65535))throw new Error('Windows version components must be finite integers from 0 through 65535.');
  const prerelease=match[4]??null;
  return {version,major,minor,patch,prereleaseIdentifier:prerelease,preRelease:prerelease!==null,windowsVersion:`${major}.${minor}.${patch}.0`,alpha:alpha.test(version)};
}

export function requireAlphaVersion(version) {
  const parsed=parseVersion(version);
  if(!parsed.alpha)throw new Error('Current pre-1.0 releases must use 0.x.y-alpha.N.');
  return parsed;
}

function managedRoots(options={}) {
  const desktop=path.resolve(options.desktopRoot??desktopRoot),source=path.resolve(options.sourceRoot??path.resolve(desktop,'..'));
  const canonicalPackage=path.join(source,'package.json'),canonicalIndex=path.join(source,'index.html');
  let canonical=false;
  if(existsSync(canonicalPackage)&&existsSync(canonicalIndex)) {
    try { canonical=JSON.parse(readFileSync(canonicalPackage,'utf8')).name==='worldgen-physical-prototype'; }
    catch { canonical=false; }
  }
  return {desktop,source,canonical};
}

function pathsFor(roots) {
  const paths={
    desktopPackage:path.join(roots.desktop,'package.json'),
    cargoToml:path.join(roots.desktop,'src-tauri','Cargo.toml'),
    cargoLock:path.join(roots.desktop,'src-tauri','Cargo.lock'),
    tauriConfig:path.join(roots.desktop,'src-tauri','tauri.conf.json'),
    desktopIndex:path.join(roots.desktop,'index.html'),
    start:path.join(roots.desktop,'start.cmd')
  };
  if(roots.canonical)Object.assign(paths,{canonicalPackage:path.join(roots.source,'package.json'),canonicalIndex:path.join(roots.source,'index.html')});
  return paths;
}

const jsonVersion=(value,label)=>{
  let data;try{data=JSON.parse(value);}catch{throw new Error(`${label}: invalid JSON`);}
  if(typeof data.version!=='string')throw new Error(`${label}: missing string version`);
  return data.version;
};
const cargoVersion=value=>{
  const match=/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m.exec(value);
  if(!match)throw new Error('Cargo.toml: missing package version');
  return match[1];
};
const cargoLockVersion=value=>{
  const match=/\[\[package\]\]\s*\r?\nname\s*=\s*"worldgen"\s*\r?\nversion\s*=\s*"([^"]+)"/.exec(value);
  if(!match)throw new Error('Cargo.lock: missing worldgen package version');
  return match[1];
};
const editionVersion=value=>{
  const match=/ПРОТОТИП\s+([^\s<]+)/.exec(value);
  if(!match)throw new Error('index.html: missing prototype edition marker');
  return match[1];
};
const startVersions=value=>{
  const versions=[...value.matchAll(/release\\WorldGen_([^"\\]+)\.exe/g)].map(match=>match[1]);
  if(!versions.length)throw new Error('start.cmd: missing versioned executable');
  return versions;
};

export async function metadata(options={}) {
  const roots=managedRoots(options),paths=pathsFor(roots),version=jsonVersion(await text(paths.desktopPackage),'tauri/package.json');
  return {...parseVersion(version),desktopRoot:roots.desktop,sourceRoot:roots.source,canonicalSource:roots.canonical};
}

export async function checkVersion(options={}) {
  const roots=managedRoots(options),paths=pathsFor(roots),desktopVersion=jsonVersion(await text(paths.desktopPackage),'tauri/package.json'),start= startVersions(await text(paths.start));
  if(start.some(version=>version!==desktopVersion))throw new Error(`start.cmd versioned executable differs: ${start.join(', ')}`);
  const values={
    'tauri/package.json':desktopVersion,
    'src-tauri/Cargo.toml':cargoVersion(await text(paths.cargoToml)),
    'src-tauri/Cargo.lock':cargoLockVersion(await text(paths.cargoLock)),
    'src-tauri/tauri.conf.json':jsonVersion(await text(paths.tauriConfig),'tauri.conf.json'),
    'tauri/index.html':editionVersion(await text(paths.desktopIndex)),
    'tauri/start.cmd':desktopVersion
  };
  if(roots.canonical) {
    values['package.json']=jsonVersion(await text(paths.canonicalPackage),'package.json');
    values['index.html']=editionVersion(await text(paths.canonicalIndex));
  }
  const unique=[...new Set(Object.values(values))];
  if(unique.length!==1)throw new Error(`Version metadata differs: ${Object.entries(values).map(([file,version])=>`${file}=${version}`).join(', ')}`);
  return {...parseVersion(unique[0]),files:values,canonicalSource:roots.canonical};
}

export async function setVersion(version,options={}) {
  const parsed=parseVersion(version),roots=managedRoots(options),paths=pathsFor(roots);
  const json=source=>replaceOne(source,/("version"\s*:\s*")[^"]+(")/,(match,prefix,suffix)=>`${prefix}${version}${suffix}`,'JSON version');
  const cargo=source=>replaceOne(source,/(^\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,(match,prefix,suffix)=>`${prefix}${version}${suffix}`,'Cargo.toml package version');
  const lock=source=>replaceOne(source,/(\[\[package\]\]\s*\r?\nname\s*=\s*"worldgen"\s*\r?\nversion\s*=\s*")[^"]+(")/,(match,prefix,suffix)=>`${prefix}${version}${suffix}`,'Cargo.lock worldgen version');
  const edition=source=>replaceOne(source,/ПРОТОТИП\s+[^\s<]+/,`ПРОТОТИП ${version}`,'index.html edition');
  const start=source=>{
    let matches=0;
    const next=source.replace(/release\\WorldGen_[^"\\]+\.exe/g,()=>{matches++;return `release\\WorldGen_${version}.exe`;});
    if(!matches)throw new Error('start.cmd executable: expected at least one versioned executable');
    return next;
  };
  const changes=[
    [paths.desktopPackage,json],[paths.cargoToml,cargo],[paths.cargoLock,lock],[paths.tauriConfig,json],[paths.desktopIndex,edition],[paths.start,start]
  ];
  if(roots.canonical)changes.push([paths.canonicalPackage,json],[paths.canonicalIndex,edition]);
  const prepared=await Promise.all(changes.map(async([file,transform])=>[file,transform(await text(file))]));
  await Promise.all(prepared.map(([file,value])=>write(file,value)));
  const checked=await checkVersion({desktopRoot:roots.desktop,sourceRoot:roots.source});
  return {...parsed,...checked};
}

function usage() { return 'Usage: node scripts/set-version.mjs --set <SemVer> | <SemVer> | --check | --metadata'; }
async function main() {
  const args=process.argv.slice(2);
  if(args.length===1&&args[0]==='--check'){console.log(JSON.stringify(await checkVersion()));return;}
  if(args.length===1&&args[0]==='--metadata'){console.log(JSON.stringify(await metadata()));return;}
  const version=args[0]==='--set'&&args.length===2?args[1]:args.length===1?args[0]:null;
  if(!version)throw new Error(usage());
  console.log(JSON.stringify(await setVersion(version)));
}
const invoked=process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked)main().catch(error=>{console.error(error.message);process.exitCode=1;});
