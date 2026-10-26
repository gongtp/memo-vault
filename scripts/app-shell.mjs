import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

export const shellFiles=['index.html','app.js','vault.mjs','module-vault.mjs','lifecycle.mjs','notes.js','notes-model.mjs','table-model.mjs','offline.js','styles.css','icon.svg','manifest.webmanifest','icon-192.png','icon-512.png','apple-touch-icon.png'];
export const publicFiles=[...shellFiles,'sw.js'];
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function workerSource(root){
 const entries=await Promise.all(shellFiles.map(async file=>[file,digest(await readFile(resolve(root,file)))]));
 const template=await readFile(resolve(root,'sw.js'),'utf8');
 const version=digest(JSON.stringify(entries)+template).slice(0,24);
 return template.replace("'__BUILD_ID__'",JSON.stringify(version)).replace('/*__ASSETS__*/[]',JSON.stringify(entries));
}
