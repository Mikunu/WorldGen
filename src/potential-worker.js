import {potentialRaster} from './core/potential-raster.js';
self.onmessage=({data})=>{
  try {
    const raster=potentialRaster(data.world,data.resource);
    self.postMessage({type:'raster',raster},[raster.values.buffer]);
  } catch(error){self.postMessage({type:'error',message:error.message});}
};
