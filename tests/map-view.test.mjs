import test from 'node:test';
import assert from 'node:assert/strict';
import {bitmapCanvasSize,clampScroll,cssCanvasSize,normalizeView,normalizedCenter,scrollBounds,scrollForNormalizedCenter,toNormalizedPoint,zoomAnchored} from '../src/core/map-view.js';

test('zoom keeps the point beneath the anchor stable at centre and map edges',()=>{
  const centre=zoomAnchored({zoom:1,targetZoom:2,scrollLeft:0,scrollTop:0,viewportWidth:500,viewportHeight:250,anchorX:250,anchorY:125});
  assert.deepEqual(centre,{zoom:2,left:250,top:125});
  const middleSize=cssCanvasSize(500,2),zoomedSize=cssCanvasSize(500,4);
  assert.equal((centre.left+250)/middleSize.width,.5);
  assert.equal((centre.top+125)/middleSize.height,.5);
  const edge=zoomAnchored({zoom:2,targetZoom:4,scrollLeft:500,scrollTop:250,viewportWidth:500,viewportHeight:250,anchorX:500,anchorY:250});
  assert.equal(edge.left,zoomedSize.width-500);
  assert.equal(edge.top,zoomedSize.height-250);
  const topLeft=zoomAnchored({zoom:2,targetZoom:4,scrollLeft:0,scrollTop:0,viewportWidth:500,viewportHeight:250,anchorX:0,anchorY:0});
  assert.equal(topLeft.left,0);assert.equal(topLeft.top,0);
});

test('scroll bounds clamp pan positions and normalized centres round-trip',()=>{
  const bounds=scrollBounds(400,200,1000,500);
  assert.deepEqual(bounds,{left:600,top:300});
  assert.deepEqual(clampScroll(-3,999,bounds),{left:0,top:300});
  const center=normalizedCenter(300,150,400,200,1000,500);
  assert.deepEqual(center,{centerX:.5,centerY:.5});
  assert.deepEqual(scrollForNormalizedCenter(center,400,200,1000,500),{left:300,top:150});
  assert.deepEqual(scrollForNormalizedCenter({centerX:0,centerY:1},400,200,1000,500),{left:0,top:300});
});

test('view and projection normalization constrain invalid edges and preserve aspect',()=>{
  assert.deepEqual(normalizeView({zoom:99,centerX:-2,centerY:3}),{zoom:8,centerX:0,centerY:1});
  assert.deepEqual(toNormalizedPoint(60,40,{left:10,top:20,width:200,height:100}),{x:.25,y:.2});
  assert.deepEqual(toNormalizedPoint(-10,999,{left:10,top:20,width:200,height:100}),{x:0,y:1});
  assert.deepEqual(bitmapCanvasSize(12000),{width:8192,height:4096});
  assert.deepEqual(bitmapCanvasSize(401),{width:401,height:201});
});
