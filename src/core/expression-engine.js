export const EXPRESSION_VERSION=1;

class ExpressionError extends Error {
  constructor(message,column=1) {
    super(`${message} (столбец ${column})`);
    this.name='ExpressionError';
    this.column=column;
  }
}

const identifier=/^[A-Za-z_][A-Za-z0-9_]*$/;
const builtinArity={sin:[1,1],cos:[1,1],tan:[1,1],abs:[1,1],min:[2,Infinity],max:[2,Infinity],clamp:[3,3],sqrt:[1,1],pow:[2,2],exp:[1,1],log:[1,1],log10:[1,1],floor:[1,1],ceil:[1,1],round:[1,1],sign:[1,1],lerp:[3,3],smoothstep:[3,3],if:[3,3],rand:[0,1],noise:[3,4]};

function fail(message,position) {throw new ExpressionError(message,position+1);}
function finite(value,position) {
  if(!Number.isFinite(value))fail('Результат должен быть конечным числом',position);
  return value;
}

class Lexer {
  constructor(source) {this.source=source;this.index=0;}
  next() {
    const {source}=this;
    while(this.index<source.length && /\s/.test(source[this.index]))this.index++;
    const position=this.index;
    if(position>=source.length)return {type:'eof',value:'',position};
    const rest=source.slice(position),char=source[position];
    if(/[0-9.]/.test(char)) {
      const match=rest.match(/^(?:(?:\d+(?:\.\d*)?)|(?:\.\d+))(?:[eE][+-]?\d+)?/);
      if(!match)fail('Некорректное число',position);
      const value=Number(match[0]);
      if(!Number.isFinite(value))fail('Число должно быть конечным',position);
      this.index+=match[0].length;
      if(source[this.index]==='.')fail('Некорректное число',this.index);
      return {type:'number',value,position};
    }
    if(/[A-Za-z_]/.test(char)) {
      const match=rest.match(/^[A-Za-z_][A-Za-z0-9_]*/)[0];this.index+=match.length;
      return {type:'identifier',value:match,position};
    }
    for(const operator of ['<=','>=','==','!=','&&','||'])if(rest.startsWith(operator)) {this.index+=operator.length;return {type:'operator',value:operator,position};}
    if('+-*/%^<>()?:,!'.includes(char)) {this.index++;return {type:'operator',value:char,position};}
    fail('Недопустимый символ',position);
  }
}

class Parser {
  constructor(source,allowed,maxNodes,maxDepth) {
    this.lexer=new Lexer(source);this.source=source;this.allowed=allowed;this.maxNodes=maxNodes;this.maxDepth=maxDepth;this.nodeCount=0;this.groupDepth=0;this.used=new Set();this.variablePositions=new Map();this.token=this.lexer.next();
  }
  advance() {const previous=this.token;this.token=this.lexer.next();return previous;}
  match(value) {if(this.token.value!==value)return false;this.advance();return true;}
  expect(value,message=`Ожидается «${value}»`) {if(!this.match(value))fail(message,this.token.position);}
  node(value) {
    this.nodeCount++;if(this.nodeCount>this.maxNodes)fail(`Превышен предел узлов выражения: ${this.maxNodes}`,value.position);
    const children=value.type==='unary'?[value.argument]:value.type==='binary'?[value.left,value.right]:value.type==='ternary'?[value.test,value.consequent,value.alternate]:value.type==='call'?value.arguments:[];
    value.depth=1+Math.max(0,...children.map(child=>child.depth));
    if(value.depth>this.maxDepth)fail(`Превышена максимальная глубина выражения: ${this.maxDepth}`,value.position);
    return value;
  }
  parse() {const result=this.ternary();if(this.token.type!=='eof')fail('Лишний фрагмент выражения',this.token.position);return result;}
  ternary() {
    const test=this.logicalOr();
    if(!this.match('?'))return test;
    const position=test.position,consequent=this.ternary();this.expect(':','В тернарном операторе ожидается «:»');
    return this.node({type:'ternary',test,consequent,alternate:this.ternary(),position});
  }
  logicalOr() {return this.binary(()=>this.logicalAnd(),['||']);}
  logicalAnd() {return this.binary(()=>this.comparison(),['&&']);}
  comparison() {return this.binary(()=>this.additive(),['<','<=','>','>=','==','!=']);}
  additive() {return this.binary(()=>this.multiplicative(),['+','-']);}
  multiplicative() {return this.binary(()=>this.unary(),['*','/','%']);}
  binary(next,operators) {
    let left=next();
    while(operators.includes(this.token.value)) {const token=this.advance(),right=next();left=this.node({type:'binary',operator:token.value,left,right,position:token.position});}
    return left;
  }
  unary() {
    if(['+','-','!'].includes(this.token.value)) {const token=this.advance();return this.node({type:'unary',operator:token.value,argument:this.unary(),position:token.position});}
    return this.power();
  }
  power() {
    const left=this.primary();
    if(this.token.value!=='^')return left;
    const token=this.advance();
    return this.node({type:'binary',operator:'^',left,right:this.unary(),position:token.position});
  }
  primary() {
    if(this.token.type==='number') {const token=this.advance();return this.node({type:'number',value:token.value,position:token.position});}
    if(this.token.type==='identifier') {
      const token=this.advance();
      if(this.match('(')) {
        this.groupDepth++;if(this.groupDepth>this.maxDepth)fail(`Превышена максимальная глубина выражения: ${this.maxDepth}`,token.position);
        const args=[];
        if(!this.match(')')) {do{args.push(this.ternary());}while(this.match(','));this.expect(')','Ожидается «)» после аргументов функции');}
        this.groupDepth--;
        if(!Object.hasOwn(builtinArity,token.value))fail(`Неизвестная функция «${token.value}»`,token.position);
        const range=builtinArity[token.value];
        if(args.length<range[0] || args.length>range[1])fail(`Неверное число аргументов функции «${token.value}»`,token.position);
        return this.node({type:'call',name:token.value,arguments:args,position:token.position});
      }
      if(token.value==='pi')return this.node({type:'number',value:Math.PI,position:token.position});
      if(token.value==='e')return this.node({type:'number',value:Math.E,position:token.position});
      if(!this.allowed.has(token.value))fail(`Неизвестная переменная «${token.value}»`,token.position);
      this.used.add(token.value);if(!this.variablePositions.has(token.value))this.variablePositions.set(token.value,token.position);return this.node({type:'variable',name:token.value,position:token.position});
    }
    if(this.match('(')) {
      this.groupDepth++;if(this.groupDepth>this.maxDepth)fail(`Превышена максимальная глубина выражения: ${this.maxDepth}`,this.token.position);
      const value=this.ternary();this.expect(')','Ожидается «)»');this.groupDepth--;return value;
    }
    fail('Ожидается число, переменная или «(»',this.token.position);
  }
}

function callBuiltin(name,args,functions,position) {
  if(name==='if')return null;
  if(name==='rand' || name==='noise') {
    const callback=functions?.[name];
    if(typeof callback!=='function')fail(`Функция «${name}» недоступна`,position);
    try{return finite(callback(...args),position);}catch(error) {if(error instanceof ExpressionError)throw error;fail(`Ошибка функции «${name}»`,position);}
  }
  const implementations={sin:Math.sin,cos:Math.cos,tan:Math.tan,abs:Math.abs,min:Math.min,max:Math.max,clamp:(x,min,max)=>Math.min(Math.max(x,min),max),sqrt:Math.sqrt,pow:Math.pow,exp:Math.exp,log:Math.log,log10:Math.log10,floor:Math.floor,ceil:Math.ceil,round:Math.round,sign:Math.sign,lerp:(a,b,t)=>a+(b-a)*t,smoothstep:(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t);}};
  return finite(implementations[name](...args),position);
}

function evaluateNode(node,values,functions) {
  if(node.type==='number')return node.value;
  if(node.type==='variable')return values[node.name];
  if(node.type==='unary') {
    const value=evaluateNode(node.argument,values,functions);
    return finite(node.operator==='-'?-value:node.operator==='!'?(value===0?1:0):value,node.position);
  }
  if(node.type==='ternary')return evaluateNode(evaluateNode(node.test,values,functions)!==0?node.consequent:node.alternate,values,functions);
  if(node.type==='call') {
    if(node.name==='if')return evaluateNode(evaluateNode(node.arguments[0],values,functions)!==0?node.arguments[1]:node.arguments[2],values,functions);
    return callBuiltin(node.name,node.arguments.map(arg=>evaluateNode(arg,values,functions)),functions,node.position);
  }
  if(node.operator==='&&') {const left=evaluateNode(node.left,values,functions);return left===0?0:(evaluateNode(node.right,values,functions)!==0?1:0);}
  if(node.operator==='||') {const left=evaluateNode(node.left,values,functions);return left!==0?1:(evaluateNode(node.right,values,functions)!==0?1:0);}
  const left=evaluateNode(node.left,values,functions),right=evaluateNode(node.right,values,functions);
  if((node.operator==='/' || node.operator==='%') && right===0)fail('Деление на ноль',node.position);
  const result=node.operator==='+'?left+right:node.operator==='-'?left-right:node.operator==='*'?left*right:node.operator==='/'?left/right:node.operator==='%'?left%right:node.operator==='^'?left**right:node.operator==='<'?(left<right?1:0):node.operator==='<='?(left<=right?1:0):node.operator==='>'?(left>right?1:0):node.operator==='>='?(left>=right?1:0):node.operator==='=='?(left===right?1:0):(left!==right?1:0);
  return finite(result,node.position);
}

export function compileExpression(source,{variables=[],maxLength=2048,maxNodes=192,maxDepth=32}={}) {
  if(typeof source!=='string')throw new TypeError('Выражение должно быть строкой');
  if(!Number.isInteger(maxLength)||maxLength<1||source.length>maxLength)throw new ExpressionError(`Длина выражения не должна превышать ${maxLength}`,Math.min(source.length,maxLength));
  if(!Number.isInteger(maxNodes)||maxNodes<1||!Number.isInteger(maxDepth)||maxDepth<1)throw new TypeError('Пределы выражения должны быть положительными целыми числами');
  if(!Array.isArray(variables))throw new TypeError('Список переменных должен быть массивом');
  const allowed=new Set();
  for(const name of variables) {
    if(typeof name!=='string'||!identifier.test(name)||name==='pi'||name==='e')throw new TypeError(`Недопустимое имя переменной «${name}»`);
    if(allowed.has(name))throw new TypeError(`Переменная «${name}» указана дважды`);allowed.add(name);
  }
  const parser=new Parser(source,allowed,maxNodes,maxDepth),ast=parser.parse(),used=[...parser.used].sort(),variablePositions=parser.variablePositions;
  return Object.freeze({source,variables:Object.freeze(used),nodeCount:parser.nodeCount,evaluate(context={},functions={}) {
    if(context===null||typeof context!=='object'||Array.isArray(context)||!([Object.prototype,null].includes(Object.getPrototypeOf(context))))throw new ExpressionError('Контекст должен быть плоским объектом');
    const values=Object.create(null);
    for(const name of used) {
      if(!Object.hasOwn(context,name)||!Number.isFinite(context[name]))throw new ExpressionError(`Переменная «${name}» должна быть конечным числом`,variablePositions.get(name)+1);
      values[name]=context[name];
    }
    return finite(evaluateNode(ast,values,functions),ast.position);
  }});
}
