// Decimal arithmetic uses integer hundredths; no floating point money accumulation.
export function decimal(value){if(value==='')return null;if(!/^-?\d{1,9}(?:\.\d{1,2})?$/.test(value))throw Error('数字最多 9 位整数、2 位小数。');const negative=value.startsWith('-'),[whole,fraction='']=value.replace('-','').split('.');return BigInt(whole)*100n*(negative?-1n:1n)+BigInt(fraction.padEnd(2,'0'))*(negative?-1n:1n);}
export function format(value){if(value===null)return '';const negative=value<0n,n=negative?-value:value;return (negative?'-':'')+n/100n+'.'+String(n%100n).padStart(2,'0');}
export const operators={'+':'＋','-':'−','*':'×','/':'÷'};
function rounded(n,d){if(d===0n)throw Error('除数不能为 0');const sign=(n<0n)!==(d<0n)?-1n:1n;n=n<0n?-n:n;d=d<0n?-d:d;return sign*((n*2n+d)/(d*2n));}
export function cellValue(table,row,column){
 if(column.type!=='product')return ['number','money'].includes(column.type)?decimal(row[column.id]??''):null;
 const a=decimal(row[column.factors[0]]??''),b=decimal(row[column.factors[1]]??'');if(a===null||b===null)return null;
 switch(column.operator??'*'){case '+':return a+b;case '-':return a-b;case '*':return rounded(a*b,100n);case '/':return rounded(a*100n,b);default:throw Error('计算方式无效');}
}
export function formulaLabel(table,column){return column.factors.map(id=>table.columns.find(c=>c.id===id)?.name||'未命名列').join(' '+operators[column.operator??'*']+' ');}
export function total(table,column){return table.rows.reduce((sum,row)=>sum+(cellValue(table,row,column)??0n),0n);}
export function newTable(){return {columns:[{id:'name',name:'名称',type:'text'},{id:'value',name:'数值',type:'number',sum:false}],rows:[{}]};}
export function validateTable(table){
 if(!table||!Array.isArray(table.columns)||!table.columns.length||table.columns.length>12||!Array.isArray(table.rows)||table.rows.length>500)throw Error('表格最多 12 列、500 行。');
 const ids=new Set();const columns=table.columns.map(c=>{if(!c||typeof c.id!=='string'||!/^[-a-zA-Z0-9_]{1,80}$/.test(c.id)||ids.has(c.id)||['__proto__','constructor','prototype'].includes(c.id)||typeof c.name!=='string'||c.name.length>40||!['text','number','money','date','product'].includes(c.type)||c.sum!==undefined&&typeof c.sum!=='boolean')throw Error('表格列格式无效。');ids.add(c.id);return {id:c.id,name:c.name,type:c.type,...(c.sum!==undefined?{sum:c.sum}:{}),...(c.type==='product'?{factors:c.factors,...(c.operator!==undefined?{operator:c.operator}:{})}: {})};});
 for(const c of columns)if(c.type==='product'&&(!Object.hasOwn(operators,c.operator??'*')||!Array.isArray(c.factors)||c.factors.length!==2||c.factors.some(id=>!columns.some(x=>x.id===id&&['number','money'].includes(x.type)))))throw Error('计算列引用或运算方式无效。');
 const rows=table.rows.map(row=>{if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).some(id=>!ids.has(id)))throw Error('表格行格式无效。');const out={};for(const c of columns){const value=row[c.id]??'';if(typeof value!=='string'||value.length>500)throw Error('单元格最多 500 字。');if(['number','money'].includes(c.type))decimal(value);if(c.type==='date'&&value&&(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value))throw Error('表格日期无效。');if(c.type!=='product')out[c.id]=value;}return out;});return {columns,rows};
}
const display=fn=>{try{return format(fn());}catch(error){return error.message;}};
export function tableText(table){return [table.columns.map(c=>c.name).join('\t'),...table.rows.map(row=>table.columns.map(c=>c.type==='product'?display(()=>cellValue(table,row,c)):row[c.id]??'').join('\t')),'合计\t'+table.columns.filter(c=>c.sum).map(c=>c.name+'：'+display(()=>total(table,c))).join('\t')].join('\n');}


// Enable numeric totals without mutating the source when conversion fails.
export function tableWithTotal(table,columnId,enabled){
 const next=structuredClone(table),column=next.columns.find(c=>c.id===columnId);
 if(!column||column.type==='date')throw Error('这列不支持合计。');
 column.sum=Boolean(enabled);if(column.sum&&column.type==='text')column.type='number';
 return validateTable(next);
}


export function moveTableColumn(table,columnId,target){
 if(!Number.isInteger(target)||target<0||target>=table.columns.length)throw Error('列位置无效。');
 const index=table.columns.findIndex(c=>c.id===columnId);
 if(index<0)throw Error('找不到这列。');
 const next=structuredClone(table),[column]=next.columns.splice(index,1);next.columns.splice(target,0,column);
 return next;
}
