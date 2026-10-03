import {generateWorld} from './core/world.js';
self.onmessage=({data})=>{
  try {const started=performance.now();const world=generateWorld(data,message=>self.postMessage({type:'progress',message}));self.postMessage({type:'world',world,elapsedMs:performance.now()-started});}
  catch(error) {self.postMessage({type:'error',message:error.message});}
};
