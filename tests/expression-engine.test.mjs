import test from 'node:test';
import assert from 'node:assert/strict';
import {EXPRESSION_VERSION,compileExpression} from '../src/core/expression-engine.js';

test('numeric grammar implements precedence, scientific literals and constants',()=>{
  assert.equal(EXPRESSION_VERSION,1);
  assert.equal(compileExpression('-2^2').evaluate(),-4);
  assert.equal(compileExpression('2^-2').evaluate(),.25);
  assert.equal(compileExpression('2^3^2').evaluate(),512);
  assert.equal(compileExpression('1.5e2 + .5').evaluate(),150.5);
  assert.ok(Math.abs(compileExpression('sin(pi / 2) + log(e)').evaluate()-2)<1e-12);
  assert.equal(compileExpression('clamp(lerp(2,6,.25),1,4)').evaluate(),3);
});

test('comparison, boolean and conditional expressions return numbers and evaluate branches lazily',()=>{
  const expression=compileExpression('if(x > 0 && y != 0, x / y, z ? 7 : 9)',{variables:['x','y','z']});
  assert.deepEqual(expression.variables,['x','y','z']);
  assert.equal(expression.evaluate({x:6,y:2,z:0}),3);
  assert.equal(expression.evaluate({x:6,y:0,z:1}),7);
  assert.equal(compileExpression('0 && (1 / 0)').evaluate(),0);
  assert.equal(compileExpression('1 || (1 / 0)').evaluate(),1);
  assert.equal(compileExpression('0 ? 1 / 0 : 4').evaluate(),4);
  assert.equal(compileExpression('!5 + (3 < 4) + (4 == 5)').evaluate(),1);
});

test('only declared numeric variables and reserved numerical callbacks can run',()=>{
  const formula=compileExpression('noise(x, y, 0, 2) + rand(1)',{variables:['x','y']});
  assert.equal(formula.evaluate({x:2,y:3},{noise:(x,y,z,scale)=>x+y+z+scale,rand:seed=>seed*.25}),7.25);
  assert.throws(()=>formula.evaluate({x:2,y:Infinity},{noise:()=>0,rand:()=>0}),/конечным числом/);
  assert.throws(()=>formula.evaluate({x:2,y:3},{noise:()=>0}),/rand.*недоступна/);
  assert.throws(()=>compileExpression('rand(1, 2)'),/Неверное число аргументов/);
  assert.throws(()=>compileExpression('noise(1, 2)'),/Неверное число аргументов/);
});

test('a variable may share a builtin name while call syntax remains restricted',()=>{
  const formula=compileExpression('noise + noise(x, y, z)',{variables:['noise','x','y','z']});
  assert.equal(formula.evaluate({noise:4,x:1,y:2,z:3},{noise:(x,y,z)=>x+y+z}),10);
  assert.throws(()=>compileExpression('constructor()'),/Неизвестная функция/);
  assert.throws(()=>compileExpression('toString()'),/Неизвестная функция/);
  assert.throws(()=>compileExpression('__proto__()'),/Неизвестная функция/);
});

test('parser rejects JavaScript access, unknown names and invalid source before evaluation',()=>{
  for(const source of ['Math.sin(1)','x.constructor','globalThis','[1,2]','"text"','{x:1}','x;1'])assert.throws(()=>compileExpression(source,{variables:['x']}),/столбец/);
  assert.throws(()=>compileExpression('unknown + 1'),/Неизвестная переменная/);
  assert.throws(()=>compileExpression('alert(1)'),/Неизвестная функция/);
  assert.throws(()=>compileExpression('1..2'),/Некорректное число/);
  assert.throws(()=>compileExpression('1 + 2',{maxLength:3}),/Длина выражения/);
});

test('complexity and runtime errors are bounded and point to a source column',()=>{
  assert.throws(()=>compileExpression('1+2+3+4+5',{maxNodes:4}),/предел узлов/);
  assert.throws(()=>compileExpression('((((1))))',{maxDepth:3}),/максимальная глубина/);
  assert.throws(()=>compileExpression('1 / 0').evaluate(),/Деление на ноль.*столбец 3/);
  assert.throws(()=>compileExpression('sqrt(-1)').evaluate(),/конечным числом.*столбец/);
  assert.throws(()=>compileExpression('x + 1',{variables:['x']}).evaluate({}),/Переменная.*конечным числом/);
});
