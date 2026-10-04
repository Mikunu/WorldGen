import {MIN_ZOOM,MAX_ZOOM,bitmapCanvasSize,clamp,cssCanvasSize,normalizeView,normalizedCenter,scrollForNormalizedCenter,toNormalizedPoint,zoomAnchored} from './core/map-view.js';

const editable=target=>['INPUT','TEXTAREA','SELECT'].includes(target?.tagName)||target?.isContentEditable;

export function mountMapViewport({canvas,viewport,onChange,busy=()=>false,onInteraction}={}) {
  if(!canvas||!viewport)throw new TypeError('Для навигации карты нужны canvas и контейнер viewport');
  const documentRef=canvas.ownerDocument,windowRef=documentRef.defaultView;
  const byId=id=>documentRef.getElementById(id);
  const controls={in:byId('map-zoom-in'),out:byId('map-zoom-out'),reset:byId('map-zoom-reset'),label:byId('map-zoom-label'),pan:byId('map-pan-toggle')};
  let zoom=MIN_ZOOM,spaceHeld=false,panMode=false,panning=null,suppressClick=false,resizeFrame=0,mapHover=false,lastSize={width:0,height:0,viewportWidth:0,viewportHeight:0};

  const viewportSize=()=>({width:Math.max(1,viewport.clientWidth),height:Math.max(1,viewport.clientHeight)});
  const canvasSize=()=>cssCanvasSize(viewportSize().width,zoom);
  const mapCenter=()=>{
    const {width,height}=viewportSize(),size=lastSize.width?lastSize:canvasSize();
    return normalizedCenter(viewport.scrollLeft,viewport.scrollTop,width,height,size.width,size.height);
  };
  const screenScale=()=>canvas.width/Math.max(1,canvasSize().width);
  const serializeView=()=>({...normalizeView({zoom,...mapCenter()})});
  const updateClasses=()=>{
    viewport.classList.toggle('pan-mode',panMode);
    viewport.classList.toggle('is-panning',!!panning);
    canvas.classList.toggle('pan-mode',panMode);
    canvas.classList.toggle('is-panning',!!panning);
    if(controls.pan){controls.pan.checked=panMode;controls.pan.setAttribute('aria-pressed',String(panMode));}
  };
  const updateControls=()=>{
    const disabled=!!busy();
    for(const control of [controls.in,controls.out,controls.reset,controls.pan])if(control)control.disabled=disabled;
    if(controls.label)controls.label.textContent=`${Math.round(zoom*100)}%`;
  };
  const emit=(reason='view')=>{
    updateControls();
    onChange?.({...serializeView(),screenScale:screenScale(),reason});
    onInteraction?.(reason,serializeView());
  };
  const setScroll=point=>{
    viewport.scrollLeft=point.left;
    viewport.scrollTop=point.top;
  };
  const applyLayout=(center=mapCenter(),reason='layout')=>{
    const {width,height}=viewportSize(),css=cssCanvasSize(width,zoom),bitmap=bitmapCanvasSize(css.width);
    canvas.style.width=`${css.width}px`;
    canvas.style.height=`${css.height}px`;
    if(canvas.width!==bitmap.width)canvas.width=bitmap.width;
    if(canvas.height!==bitmap.height)canvas.height=bitmap.height;
    lastSize={width:css.width,height:css.height,viewportWidth:width,viewportHeight:height};
    setScroll(scrollForNormalizedCenter(center,width,height,css.width,css.height));
    emit(reason);
  };
  const setZoom=(target,anchorX,anchorY,reason='zoom')=>{
    if(busy())return;
    const {width,height}=viewportSize(),next=zoomAnchored({zoom,targetZoom:target,scrollLeft:viewport.scrollLeft,scrollTop:viewport.scrollTop,viewportWidth:width,viewportHeight:height,anchorX,anchorY});
    zoom=next.zoom;
    applyLayout(normalizedCenter(next.left,next.top,width,height,cssCanvasSize(width,zoom).width,cssCanvasSize(width,zoom).height),reason);
    // applyLayout normalizes through the new dimensions; write the exact anchored scroll after it.
    setScroll({left:next.left,top:next.top});
  };
  const zoomAtCenter=(factor,reason)=>{
    const {width,height}=viewportSize();
    setZoom(zoom*factor,width/2,height/2,reason);
  };
  const shouldPan=event=>panMode||spaceHeld||event?.button===1;
  const stopPanning=event=>{
    if(!panning||event?.pointerId!==panning.pointerId)return;
    event?.preventDefault();event?.stopImmediatePropagation();
    try{canvas.releasePointerCapture(panning.pointerId);}catch{}
    panning=null;updateClasses();
    suppressClick=true;
    windowRef?.setTimeout(()=>{suppressClick=false;},500);
    onInteraction?.('pan',serializeView());
  };
  const pointerDown=event=>{
    if(!shouldPan(event)||busy())return;
    if(event.button!==0&&event.button!==1)return;
    event.preventDefault();event.stopImmediatePropagation();
    panning={pointerId:event.pointerId,x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop,dragged:false};
    canvas.setPointerCapture(event.pointerId);updateClasses();
  };
  const pointerMove=event=>{
    if(!panning||event.pointerId!==panning.pointerId)return;
    event.preventDefault();event.stopImmediatePropagation();
    const dx=event.clientX-panning.x,dy=event.clientY-panning.y;
    if(Math.abs(dx)>3||Math.abs(dy)>3)panning.dragged=true;
    viewport.scrollLeft=panning.left-dx;viewport.scrollTop=panning.top-dy;
  };
  const wheel=event=>{
    if(busy())return;
    event.preventDefault();
    const rect=viewport.getBoundingClientRect();
    setZoom(zoom*(event.deltaY<0?1.2:1/1.2),event.clientX-rect.left,event.clientY-rect.top,'wheel');
  };
  const mapContext=()=>mapHover||documentRef.activeElement===canvas||viewport.contains(documentRef.activeElement);
  const keyDown=event=>{
    if(event.code==='Space'&&!editable(event.target)&&mapContext()) {event.preventDefault();spaceHeld=true;updateClasses();return;}
    if(event.key==='Escape') {
      if(panning)stopPanning({pointerId:panning.pointerId});
      if(panMode){panMode=false;updateClasses();onInteraction?.('pan-mode',serializeView());}
    }
    if(event.currentTarget!==canvas||busy())return;
    if(event.key==='+'||event.key==='='){event.preventDefault();zoomAtCenter(1.2,'keyboard');}
    else if(event.key==='-'||event.key==='_'){event.preventDefault();zoomAtCenter(1/1.2,'keyboard');}
    else if(event.key==='0'){event.preventDefault();api.reset();}
  };
  const keyUp=event=>{if(event.code==='Space'&&spaceHeld){event.preventDefault();spaceHeld=false;updateClasses();}};
  const cancelInteraction=()=>{
    spaceHeld=false;
    if(panning)stopPanning({pointerId:panning.pointerId,preventDefault(){},stopImmediatePropagation(){}});
    updateClasses();
  };
  const resize=()=>{
    if(resizeFrame)return;
    resizeFrame=windowRef.requestAnimationFrame(()=>{resizeFrame=0;const size=viewportSize(),css=canvasSize();if(css.width!==lastSize.width||css.height!==lastSize.height||size.width!==lastSize.viewportWidth||size.height!==lastSize.viewportHeight)applyLayout(mapCenter(),'resize');});
  };
  const api={
    shouldPan,
    get isPanning(){return !!panning;},
    get isPanMode(){return panMode;},
    get zoom(){return zoom;},
    get screenScale(){return screenScale();},
    reset(){if(busy())return;zoom=MIN_ZOOM;applyLayout({centerX:.5,centerY:.5},'reset');},
    serializeView,
    restoreView(view){if(busy())return;const next=normalizeView(view?.mapView??view);zoom=next.zoom;applyLayout(next,'restore');},
    toMapPoint(event){const rect=canvas.getBoundingClientRect();return {...toNormalizedPoint(event.clientX,event.clientY,rect),rect};},
    refresh(){updateControls();resize();},
    destroy(){resizeObserver?.disconnect();if(resizeFrame)windowRef.cancelAnimationFrame(resizeFrame);canvas.removeEventListener('pointerdown',pointerDown,true);canvas.removeEventListener('pointermove',pointerMove,true);canvas.removeEventListener('pointerup',stopPanning,true);canvas.removeEventListener('pointercancel',stopPanning,true);canvas.removeEventListener('click',suppressCanvasClick,true);canvas.removeEventListener('keydown',keyDown);viewport.removeEventListener('wheel',wheel);viewport.removeEventListener('pointerenter',enterViewport);viewport.removeEventListener('pointerleave',leaveViewport);documentRef.removeEventListener('keydown',keyDown);documentRef.removeEventListener('keyup',keyUp);windowRef.removeEventListener('blur',cancelInteraction);controls.in?.removeEventListener('click',zoomIn);controls.out?.removeEventListener('click',zoomOut);controls.reset?.removeEventListener('click',reset);controls.pan?.removeEventListener('change',togglePan);}
  };
  const suppressCanvasClick=event=>{if(suppressClick){suppressClick=false;event.preventDefault();event.stopImmediatePropagation();}};
  const zoomIn=()=>zoomAtCenter(1.2,'button');
  const zoomOut=()=>zoomAtCenter(1/1.2,'button');
  const reset=()=>api.reset();
  const togglePan=()=>{if(busy()){updateClasses();return;}panMode=!!controls.pan?.checked;updateClasses();onInteraction?.('pan-mode',serializeView());};
  const enterViewport=()=>{mapHover=true;};
  const leaveViewport=()=>{mapHover=false;if(!panning)spaceHeld=false;updateClasses();};
  const resizeObserver=typeof ResizeObserver==='undefined'?null:new ResizeObserver(resize);
  canvas.addEventListener('pointerdown',pointerDown,true);
  canvas.addEventListener('pointermove',pointerMove,true);
  canvas.addEventListener('pointerup',stopPanning,true);
  canvas.addEventListener('pointercancel',stopPanning,true);
  canvas.addEventListener('click',suppressCanvasClick,true);
  canvas.addEventListener('keydown',keyDown);
  viewport.addEventListener('wheel',wheel,{passive:false});
  viewport.addEventListener('pointerenter',enterViewport);
  viewport.addEventListener('pointerleave',leaveViewport);
  documentRef.addEventListener('keydown',keyDown);
  documentRef.addEventListener('keyup',keyUp);
  windowRef.addEventListener('blur',cancelInteraction);
  controls.in?.addEventListener('click',zoomIn);
  controls.out?.addEventListener('click',zoomOut);
  controls.reset?.addEventListener('click',reset);
  controls.pan?.addEventListener('change',togglePan);
  resizeObserver?.observe(viewport);
  updateClasses();
  applyLayout({centerX:.5,centerY:.5},'mount');
  return api;
}
