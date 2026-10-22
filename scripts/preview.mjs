import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { networkInterfaces } from 'node:os';
const root = resolve(import.meta.dirname, '..');
const types = { '.html':'text/html; charset=utf-8', '.css':'text/css; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.mjs':'text/javascript; charset=utf-8', '.svg':'image/svg+xml', '.md':'text/plain; charset=utf-8' };
const publicFiles=new Set(['/index.html','/app.js','/vault.mjs','/lifecycle.mjs','/styles.css','/icon.svg']);
const server=createServer(async(req,res)=>{
 try {
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  if(!publicFiles.has(pathname==='/'?'/index.html':pathname)){res.writeHead(404);res.end('Not found');return;}
  const file=resolve(root, '.' + (pathname==='/'?'/index.html':pathname));
  if (!file.startsWith(root+sep)||!['.html','.css','.js','.mjs','.svg','.md'].includes(extname(file))) {res.writeHead(404);res.end('Not found');return;}
  if(!(await stat(file)).isFile())throw Error();
  res.writeHead(200,{'Content-Type':types[extname(file)],'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(await readFile(file));
 }catch{res.writeHead(404);res.end('Not found');}
});
const port=Number(process.argv[2]??4173);
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Invalid preview port');
server.listen(port,'0.0.0.0',()=>{
  console.log(`Local: http://127.0.0.1:${port}`);
  for(const addresses of Object.values(networkInterfaces()))for(const address of addresses??[])if(address.family==='IPv4'&&!address.internal&&!address.address.startsWith('169.254.'))console.log(`Network: http://${address.address}:${port}`);
  console.log('LAN HTTP previews need trusted HTTPS for vault encryption/unlock.');
});
