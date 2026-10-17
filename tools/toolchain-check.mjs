import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,copyFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn,spawnSync} from 'node:child_process';
import {createServer,request} from 'node:http';
import {once} from 'node:events';
const root=fileURLToPath(new URL('..',import.meta.url));
const temp=await mkdtemp(join(tmpdir(),'guinea-toolchain-'));
let child;
try{
  const fixture=join(temp,'带 空格的工程');
  await Promise.all(['tools','core','web'].map(p=>mkdir(join(fixture,p),{recursive:true})));
  await copyFile(join(root,'tools/build-web.mjs'),join(fixture,'tools/build-web.mjs'));
  await writeFile(join(fixture,'core/a.ts'),'export const n: number = 1;');
  await writeFile(join(fixture,'web/main.ts'),"import {n} from '../core/a.ts'; console.log(n);");
  const result=spawnSync(process.execPath,[join(fixture,'tools/build-web.mjs')],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(await readFile(join(fixture,'web/gen/main.js'),'utf8'),/\.\/core\/a\.js/);
  console.log('PASS 含中文和空格的工程路径可构建，模块引用正确');
  const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  child=spawn(process.execPath,[join(root,'tools/serve.mjs'),String(port)],{stdio:['ignore','pipe','pipe']});
  await Promise.race([once(child.stdout,'data'),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(Error('server startup timeout')),4000);timer.unref();})]);
  const get=path=>new Promise((resolve,reject)=>{const req=request({host:'127.0.0.1',port,path},r=>{let text='';r.on('data',b=>text+=b);r.on('end',()=>resolve({status:r.statusCode,text}));});req.on('error',reject);req.end();});
  assert.equal((await get('/%ZZ')).status,400);const healthy=await get('/');assert.equal(healthy.status,200);assert.match(healthy.text,/几尼/);assert.equal(child.exitCode,null);
  console.log('PASS 非法 URI 返回 400，开发服务仍能正常返回首页');
}finally{if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit');}await rm(temp,{recursive:true,force:true});}
