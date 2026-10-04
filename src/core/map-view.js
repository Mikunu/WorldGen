export const MIN_ZOOM=1;
export const MAX_ZOOM=8;
export const MAP_ASPECT=2;

export function clamp(value,min,max) {
  return Math.max(min,Math.min(max,value));
}

export function normalizeView(view={}) {
  return {
    zoom:clamp(Number.isFinite(view.zoom)?view.zoom:MIN_ZOOM,MIN_ZOOM,MAX_ZOOM),
    centerX:clamp(Number.isFinite(view.centerX)?view.centerX:.5,0,1),
    centerY:clamp(Number.isFinite(view.centerY)?view.centerY:.5,0,1)
  };
}

export function cssCanvasSize(viewportWidth,zoom=MIN_ZOOM,aspect=MAP_ASPECT) {
  const width=Math.max(1,viewportWidth*clamp(zoom,MIN_ZOOM,MAX_ZOOM));
  return {width,height:width/aspect};
}

export function bitmapCanvasSize(cssWidth,aspect=MAP_ASPECT,maxSide=8192) {
  const width=Math.max(1,Math.min(maxSide,Math.round(cssWidth)));
  return {width,height:Math.max(1,Math.round(width/aspect))};
}

export function scrollBounds(viewportWidth,viewportHeight,contentWidth,contentHeight) {
  return {left:Math.max(0,contentWidth-viewportWidth),top:Math.max(0,contentHeight-viewportHeight)};
}

export function clampScroll(scrollLeft,scrollTop,bounds) {
  return {left:clamp(scrollLeft,0,bounds.left),top:clamp(scrollTop,0,bounds.top)};
}

export function normalizedCenter(scrollLeft,scrollTop,viewportWidth,viewportHeight,contentWidth,contentHeight) {
  return {
    centerX:clamp((scrollLeft+viewportWidth/2)/Math.max(1,contentWidth),0,1),
    centerY:clamp((scrollTop+viewportHeight/2)/Math.max(1,contentHeight),0,1)
  };
}

export function scrollForNormalizedCenter(center,viewportWidth,viewportHeight,contentWidth,contentHeight) {
  const bounds=scrollBounds(viewportWidth,viewportHeight,contentWidth,contentHeight);
  return clampScroll(center.centerX*contentWidth-viewportWidth/2,center.centerY*contentHeight-viewportHeight/2,bounds);
}

export function zoomAnchored({zoom,targetZoom,scrollLeft=0,scrollTop=0,viewportWidth,viewportHeight,anchorX,anchorY,aspect=MAP_ASPECT}) {
  const current=cssCanvasSize(viewportWidth,zoom,aspect),next=cssCanvasSize(viewportWidth,targetZoom,aspect);
  const x=clamp(anchorX,0,viewportWidth),y=clamp(anchorY,0,viewportHeight);
  const mapX=(scrollLeft+x)/current.width,mapY=(scrollTop+y)/current.height;
  return {
    zoom:clamp(targetZoom,MIN_ZOOM,MAX_ZOOM),
    ...clampScroll(mapX*next.width-x,mapY*next.height-y,scrollBounds(viewportWidth,viewportHeight,next.width,next.height))
  };
}

export function toNormalizedPoint(clientX,clientY,rect) {
  return {
    x:clamp((clientX-rect.left)/Math.max(1,rect.width),0,1),
    y:clamp((clientY-rect.top)/Math.max(1,rect.height),0,1)
  };
}
