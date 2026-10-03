import {mkdir,writeFile} from 'node:fs/promises';
import {generateWorld,serializeWorld} from '../src/core/world.js';
const args=process.argv.slice(2),config={};
for(let i=0;i<args.length;i+=2) {
  if(args[i]==='--seed')config.seed=args[i+1];
  else if(args[i]==='--width'){config.width=Number(args[i+1]);config.height=config.width/2;}
  else if(args[i]==='--epochs')config.epochs=Number(args[i+1]);
  else if(args[i]==='--resource-density')config.resourceDensity=Number(args[i+1]);
  else throw new Error(`Unknown argument ${args[i]}`);
}
const started=performance.now(),world=generateWorld(config,message=>console.log(message));
await mkdir(new URL('../output/',import.meta.url),{recursive:true});
await writeFile(new URL('../output/world.json',import.meta.url),serializeWorld(world));
console.log(JSON.stringify({elapsedMs:performance.now()-started,summary:world.summary,validation:world.validation},null,2));
console.log('Saved: output/world.json');
