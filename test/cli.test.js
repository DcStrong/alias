import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

test('CLI запускает HTTP-сервер через символьную ссылку релиза',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'alias-cli-'));
 const script=join(directory,'server.js');await symlink(fileURLToPath(new URL('../server.js',import.meta.url)),script);
 const child=spawn(process.execPath,[script],{env:{...process.env,HOST:'127.0.0.1',PORT:'0'},stdio:['ignore','pipe','pipe']});
 t.after(async()=>{child.kill('SIGTERM');await rm(directory,{recursive:true,force:true});});
 const address=await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('CLI не сообщил адрес')),5000);let output='';
  child.once('error',e=>{clearTimeout(timer);reject(e);});
  child.once('exit',code=>{clearTimeout(timer);reject(Error('CLI завершился до запуска: '+code));});
  child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/http:\/\/localhost:(\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}});
 });
 const response=await fetch(address);assert.equal(response.status,200);assert.match(await response.text(),/Скажи иначе/);
});
