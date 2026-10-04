// Layer identity is intentionally finite: saved views and UI controls cannot
// inject arbitrary render callbacks or reorder the scientific base map.
export const MAP_LAYERS=Object.freeze([
  {id:'elevation',name:'Рельеф',description:'Высота, океаны и озёра',opacity:1,raster:true},
  {id:'plates',name:'Плиты',description:'Текущие тектонические плиты',opacity:.55,raster:true},
  {id:'rocks',name:'Породы',description:'Поверхностные горные породы',opacity:.62,raster:true},
  {id:'provinces',name:'Провинции',description:'Геологические провинции',opacity:.58,raster:true},
  {id:'sediments',name:'Осадки',description:'Мощность осадочной толщи',opacity:.58,raster:true},
  {id:'fertility',name:'Почвы',description:'Плодородие почв',opacity:.58,raster:true},
  {id:'hazards',name:'Опасности',description:'Выбранный индекс природной опасности',opacity:.58,raster:true},
  {id:'resources',name:'Ресурсы',description:'Рудные тела и их проявления',opacity:.62,raster:true,overlay:true},
  {id:'boundaries',name:'Границы',description:'Границы литосферных плит',opacity:.7,raster:true,overlay:true},
  {id:'temperature',name:'Температура',description:'Температура выбранного сезона',opacity:.55,raster:true},
  {id:'precipitation',name:'Осадки',description:'Осадки выбранного сезона',opacity:.55,raster:true},
  {id:'seaTemperature',name:'Температура моря',description:'Температура поверхности океана выбранного сезона',opacity:.58,raster:true},
  {id:'seaSalinity',name:'Солёность моря',description:'Солёность поверхности океана выбранного сезона',opacity:.58,raster:true},
  {id:'seaDensity',name:'Плотность моря',description:'Потенциальная плотность поверхности океана',opacity:.58,raster:true},
  {id:'oceanCurrents',name:'Течения',description:'Скорость и направление поверхностных океанских течений',opacity:.72,raster:true,overlay:true},
  {id:'deepTemperature',name:'Глубинная температура',description:'Температура глубокого слоя океана',opacity:.58,raster:true},
  {id:'deepSalinity',name:'Глубинная солёность',description:'Солёность глубокого слоя океана',opacity:.58,raster:true},
  {id:'deepDensity',name:'Глубинная плотность',description:'Потенциальная плотность глубокого слоя океана',opacity:.58,raster:true},
  {id:'deepCurrents',name:'Глубинные течения',description:'Скорость и направление глубоких течений',opacity:.72,raster:true,overlay:true},
  {id:'oceanVerticalExchange',name:'Вертикальный обмен',description:'Апвеллинг и погружение между слоями океана',opacity:.62,raster:true},
  {id:'flow',name:'Сток',description:'Плотность речного стока',opacity:.6,raster:true,overlay:true},
  {id:'biome',name:'Биомы',description:'Климатические биомы',opacity:.55,raster:true},
  {id:'potential',name:'Потенциал',description:'Рудный потенциал выбранного ресурса',opacity:.6,raster:true}
]);

const byId=new Map(MAP_LAYERS.map(layer=>[layer.id,layer]));

export function normalizeLayers(input=[]) {
  if(input===undefined || input===null)return [];
  if(!Array.isArray(input))throw new TypeError('Слои карты должны быть массивом');
  const selected=new Set();
  for(const id of input) {
    if(typeof id!=='string' || !byId.has(id))throw new RangeError(`Неизвестный слой карты: ${id}`);
    if(selected.has(id))throw new RangeError(`Слой карты повторяется: ${id}`);
    selected.add(id);
  }
  return MAP_LAYERS.filter(layer=>selected.has(layer.id)).map(layer=>layer.id);
}

export function resolveLayers(view={}) {
  if(Array.isArray(view.layers))return normalizeLayers(view.layers);
  return view.layer===undefined || view.layer===null?[]:normalizeLayers([view.layer]);
}

export function layerOpacity(opacities,id) {
  const layer=byId.get(id);
  if(!layer)throw new RangeError(`Неизвестный слой карты: ${id}`);
  const value=opacities?.[id];
  return value===undefined?layer.opacity:value;
}

export function normalizeLayerOpacity(input={}) {
  if(input===undefined || input===null)return {};
  if(typeof input!=='object' || Array.isArray(input))throw new TypeError('Непрозрачность слоёв должна быть объектом');
  const result={};
  for(const [id,value] of Object.entries(input)) {
    if(!byId.has(id))throw new RangeError(`Неизвестный слой карты: ${id}`);
    if(!Number.isFinite(value) || value<0 || value>1)throw new RangeError(`Непрозрачность слоя ${id} должна быть от 0 до 1`);
    result[id]=value;
  }
  return result;
}

export function visibleLayers(options={}) {
  const layers=options.layers!==undefined?normalizeLayers(options.layers):options.layer===undefined?[]:normalizeLayers([options.layer]);
  return layers.length?layers:['elevation'];
}
