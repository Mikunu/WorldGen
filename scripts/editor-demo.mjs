import {mkdir,writeFile} from 'node:fs/promises';
import {generateWorld} from '../src/core/world.js';
import {initializeEditor,applyEdit,serializeProject,parseProject} from '../src/core/editor.js';
import {sphericalPoint} from '../src/core/spatial.js';

let world=initializeEditor(generateWorld());
world=applyEdit(world,{type:'addBody',modelId:'porphyry',mode:'authored',position:sphericalPoint(-29.6,56.6),
  name:'Жила Северного кряжа',exceptionReason:'Древняя магматическая область, заданная автором.',locked:true,label:'Авторская залежь'});
world=applyEdit(world,{type:'brush',channel:'elevation',mode:'set',targetM:3000,strength:0,radiusKm:500,softness:.7,
  path:[sphericalPoint(55,-70),sphericalPoint(45,-62),sphericalPoint(35,-57)],label:'Горный хребет'});
world=applyEdit(world,{type:'annotation',position:sphericalPoint(45,-62),name:'Северный кряж',description:'Хребет создан кистью редактора.',locked:true,label:'Название хребта'});
world=applyEdit(world,{type:'locks',area:{center:sphericalPoint(-29.6,56.6),radiusKm:700},areaResources:true,areaTerrain:true,name:'Земля канона',label:'Закреплённая область'});
const text=serializeProject(world,{layer:'resources',resource:'all',depositClass:'all',rivers:true,coasts:true});
const restored=parseProject(text);if(restored.world.validation.errors.length)throw new Error('Ошибка проверки проекта');
await mkdir(new URL('../output/',import.meta.url),{recursive:true});
await writeFile(new URL('../output/editor-demo-project.json',import.meta.url),text);
console.log(JSON.stringify({file:'output/editor-demo-project.json',revision:world.editor.revision,bodies:world.summary.oreBodyCount,validation:world.validation}));
