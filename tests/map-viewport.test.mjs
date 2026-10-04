import test from 'node:test';
import assert from 'node:assert/strict';
import {mountMapViewport} from '../src/map-viewport.js';

class ClassList {
  values=new Set();
  toggle(name,force) {if(force)this.values.add(name);else this.values.delete(name);}
  contains(name) {return this.values.has(name);}
}

class Target {
  listeners=[];
  classList=new ClassList();
  style={};
  attributes=new Map();
  setAttribute(name,value) {this.attributes.set(name,String(value));}
  getAttribute(name) {return this.attributes.get(name)??null;}
  addEventListener(type,listener,options=false) {this.listeners.push({type,listener,capture:options===true||options?.capture===true});}
  removeEventListener(type,listener,options=false) {const capture=options===true||options?.capture===true;this.listeners=this.listeners.filter(entry=>entry.type!==type||entry.listener!==listener||entry.capture!==capture);}
  dispatch(type,values={}) {
    let stopped=false,prevented=false;
    const event={type,target:values.target??this,currentTarget:null,button:0,pointerId:1,clientX:0,clientY:0,deltaY:0,key:'',code:'',...values,
      preventDefault(){prevented=true;},stopImmediatePropagation(){stopped=true;},get defaultPrevented(){return prevented;}};
    for(const capture of [true,false])for(const entry of this.listeners)if(entry.type===type&&entry.capture===capture&&!stopped){event.currentTarget=this;entry.listener(event);}
    return event;
  }
}

function fakeDom() {
  const window=new Target();window.requestAnimationFrame=()=>1;window.cancelAnimationFrame=()=>{};window.setTimeout=(callback)=>setTimeout(callback,0);
  const document=new Target(),controls=new Map();document.defaultView=window;document.getElementById=id=>controls.get(id)??null;document.activeElement=null;
  const canvas=new Target();canvas.ownerDocument=document;canvas.width=200;canvas.height=100;canvas.tabIndex=0;canvas.setPointerCapture=()=>{};canvas.releasePointerCapture=()=>{};canvas.getBoundingClientRect=()=>({left:0,top:0,width:Number.parseFloat(canvas.style.width)||200,height:Number.parseFloat(canvas.style.height)||100});
  const viewport=new Target();viewport.ownerDocument=document;viewport.clientWidth=200;viewport.clientHeight=100;viewport.scrollLeft=0;viewport.scrollTop=0;viewport.getBoundingClientRect=()=>({left:0,top:0,width:200,height:100});viewport.contains=value=>value===canvas||value===viewport;
  for(const id of ['map-zoom-in','map-zoom-out','map-zoom-reset','map-pan-toggle','map-zoom-label']) {const control=new Target();control.ownerDocument=document;control.disabled=false;if(id==='map-pan-toggle')control.checked=false;controls.set(id,control);}
  return {canvas,viewport,document,window,controls};
}

test('mounted viewport zooms under the wheel anchor and saves/restores a normalized view',()=>{
  const {canvas,viewport}=fakeDom(),changes=[];
  const view=mountMapViewport({canvas,viewport,onChange:state=>changes.push(state)});
  const wheel=viewport.dispatch('wheel',{target:canvas,clientX:100,clientY:50,deltaY:-1});
  assert.equal(wheel.defaultPrevented,true);
  assert.equal(view.zoom,1.2);
  assert.equal(viewport.scrollLeft,20);
  assert.equal(viewport.scrollTop,10);
  assert.equal(canvas.style.width,'240px');
  assert.deepEqual(view.serializeView(),{zoom:1.2,centerX:.5,centerY:.5});
  view.restoreView({zoom:2,centerX:.25,centerY:.75});
  assert.equal(viewport.scrollLeft,0);
  assert.equal(viewport.scrollTop,100);
  assert.deepEqual(view.serializeView(),{zoom:2,centerX:.25,centerY:.75});
  assert.ok(changes.some(change=>change.reason==='wheel'));
  view.destroy();
});

test('checkbox pan mode, capture ordering and Escape prevent editor actions',()=>{
  const {canvas,viewport,controls}=fakeDom();
  let editorPointers=0,editorClicks=0;
  canvas.addEventListener('pointerdown',()=>editorPointers++);
  canvas.addEventListener('pointermove',()=>editorPointers++);
  canvas.addEventListener('pointerup',()=>editorPointers++);
  canvas.addEventListener('click',()=>editorClicks++);
  const view=mountMapViewport({canvas,viewport});
  const pan=controls.get('map-pan-toggle');pan.checked=true;pan.dispatch('change');
  assert.equal(view.isPanMode,true);
  canvas.dispatch('pointerdown',{button:0,pointerId:7,clientX:100,clientY:50});
  canvas.dispatch('pointermove',{pointerId:7,clientX:70,clientY:35});
  canvas.dispatch('pointerup',{pointerId:7,clientX:70,clientY:35});
  canvas.dispatch('click',{clientX:70,clientY:35});
  assert.equal(editorPointers,0);
  assert.equal(editorClicks,0);
  assert.equal(viewport.classList.contains('is-panning'),false);
  canvas.dispatch('keydown',{key:'Escape'});
  assert.equal(view.isPanMode,false);
  assert.equal(pan.checked,false);
  view.destroy();
});

test('a pan intent without movement still suppresses the next canvas click',()=>{
  const {canvas,viewport,controls}=fakeDom();
  let clicks=0;canvas.addEventListener('click',()=>clicks++);
  const view=mountMapViewport({canvas,viewport});
  const pan=controls.get('map-pan-toggle');pan.checked=true;pan.dispatch('change');
  canvas.dispatch('pointerdown',{button:0,pointerId:3,clientX:10,clientY:10});
  canvas.dispatch('pointerup',{button:0,pointerId:3,clientX:10,clientY:10});
  canvas.dispatch('click',{clientX:10,clientY:10});
  assert.equal(clicks,0);
  view.destroy();
});
