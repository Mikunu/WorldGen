// Browser fallback keeps this copy usable with the original local web server.
export function isDesktop() {return typeof globalThis.__TAURI__?.core?.invoke==='function';}

export async function saveBlob(blob,name,kind) {
  if(!blob)throw new Error('Не удалось подготовить файл.');
  if(isDesktop()) {
    let content;
    if(kind==='png') {
      const bytes=new Uint8Array(await blob.arrayBuffer());
      let binary='';
      for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
      content=btoa(binary);
    } else content=await blob.text();
    return globalThis.__TAURI__.core.invoke('save_document',{name,kind,content});
  }
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  return name;
}

export async function saveJson(text,name) {return saveBlob(new Blob([text],{type:'application/json'}),name,'json');}
export async function openJson(kind='project') {
  if(!isDesktop())throw new Error('Нативный диалог доступен в приложении WorldGen.');
  return globalThis.__TAURI__.core.invoke('open_document',{kind});
}
