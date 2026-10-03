import {applyEdit,editImpact,parseProject} from './core/editor.js';
self.onmessage=({data})=>{
  try {
    if(data.type==='import'){self.postMessage({type:'import',...parseProject(data.text)});return;}
    const next=applyEdit(data.world,data.operation);
    self.postMessage({type:'preview',world:next,impact:editImpact(data.world,next,data.operation)});
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
