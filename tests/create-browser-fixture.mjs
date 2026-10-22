// Synthetic credentials only; isolated browser test origin, never the user's vault.
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {VaultSession,DEFAULT_PASSWORD} from '../vault.mjs';
const store={value:null,async read(){return this.value;},async write(value){this.value=value;}};
const session=new VaultSession(store);await session.create(DEFAULT_PASSWORD);
await session.save([
 {id:1,name:'GitHub（测试）',username:'demo@example.com',password:'demo-github-123',category:'开发工具',method:'密码登录',url:'https://github.com',note:'虚构账号，用于验证查看、复制、编辑与备份。',favorite:true,date:'2026.10.22',color:'#efefff',ink:'#7a77ca',letter:'G'},
 {id:2,name:'Notion（测试）',username:'notion@example.com',password:'',category:'工作效率',method:'Google 登录',url:'https://notion.so',note:'用于验证第三方登录与空密码。',favorite:false,date:'2026.10.21',color:'#f0f1f4',ink:'#454a56',letter:'N'},
 {id:3,name:'生活账号（测试）',username:'demo_life',password:'demo-life-456',category:'日常生活',method:'密码登录',url:'https://example.com',note:'用于验证搜索、分类和收藏。',favorite:false,date:'2026.10.20',color:'#edf8ef',ink:'#60b678',letter:'生'}
]);
const directory=resolve(import.meta.dirname,'../examples');await mkdir(directory,{recursive:true});
const file=join(directory,'demo.vault.json');await writeFile(file,await session.exportFile());console.log(file);
