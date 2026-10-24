// Dependency-free rasterization of the existing icon.svg brand geometry.
import {writeFile} from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const points=[[40,120],[40,68],[57,68],[57,75]];
function curve(x1,y1,x2,y2,x3,y3){const [x0,y0]=points.at(-1);for(let i=1;i<=24;i++){const t=i/24,u=1-t;points.push([u*u*u*x0+3*u*u*t*x1+3*u*t*t*x2+t*t*t*x3,u*u*u*y0+3*u*u*t*y1+3*u*t*t*y2+t*t*t*y3]);}}
curve(66,63,85,63,94,76);curve(107,61,132,64,132,89);points.push([132,120],[115,120],[115,91]);curve(115,75,98,76,98,92);points.push([98,120],[80,120],[80,91]);curve(80,75,58,76,58,92);points.push([58,120]);
function inside(x,y){let hit=false;for(let i=0,j=points.length-1;i<points.length;j=i++){const [a,b]=points[i],[c,d]=points[j];if((b>y)!==(d>y)&&x<(c-a)*(y-b)/(d-b)+a)hit=!hit;}return hit;}
function crc(bytes){let c=0xffffffff;for(const b of bytes){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;}
function chunk(type,data){const bytes=Buffer.concat([Buffer.from(type),data]),length=Buffer.alloc(4),sum=Buffer.alloc(4);length.writeUInt32BE(data.length);sum.writeUInt32BE(crc(bytes));return Buffer.concat([length,bytes,sum]);}
for(const [file,size] of [['icon-192.png',192],['icon-512.png',512],['apple-touch-icon.png',180]]){
 const scan=Buffer.alloc(size*(1+size*4));
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const color=[0,0,0];for(const [dx,dy] of [[.25,.25],[.75,.25],[.25,.75],[.75,.75]]){
   const px=(x+dx)*180/size,py=(y+dy)*180/size;
   const rgb=inside(px,py)?[255,255,255]:(px-145)**2+(py-119)**2<64?[183,242,209]:[83,85,220];
   rgb.forEach((v,i)=>color[i]+=v/4);
  }
  const pos=y*(size*4+1)+1+x*4;color.forEach((v,i)=>scan[pos+i]=Math.round(v));scan[pos+3]=255;
 }
 const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
 await writeFile(resolve(root,file),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]));
}
