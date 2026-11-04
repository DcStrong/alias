// Public HTTP/SSE acceptance. Cookie values, invitation codes and words are never printed.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {assertNoSecretValue} from '../test-support/privacy.js';
const base=new URL(process.argv[2]||'https://144.31.97.89').origin,clients=[];
class Client {
 constructor(){clients.push(this);}
 accept(state){if(!this.state||state.version>=this.state.version)this.state=state;}
 async post(path,body={}) {
  const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...(this.cookie?{Cookie:this.cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const cookie=response.headers.get('set-cookie');if(cookie){this.cookie=cookie.split(';')[0];if(base.startsWith('https:'))assert.match(cookie,/; Secure/);}
  return {status:response.status,data:await response.json()};
 }
 async join(code){const r=await this.post(code?`/api/rooms/${code}/join`:'/api/rooms');assert.equal(r.status,code?200:201);this.accept(r.data);}
 async connect(){
  this.controller=new AbortController();const response=await fetch(`${base}/api/rooms/${this.state.code}/events`,{headers:{Cookie:this.cookie},signal:this.controller.signal});assert.equal(response.status,200);
  const reader=response.body.getReader(),controller=this.controller;
  this.reading=(async()=>{let buffer='';const decoder=new TextDecoder();try{while(true){const {value,done}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let at;while((at=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,at);buffer=buffer.slice(at+2);if(event.startsWith('data: '))this.accept(JSON.parse(event.slice(6)));}}}catch(e){if(!controller.signal.aborted)throw e;}})();
  await this.wait(s=>s.devices.find(d=>d.id===s.you)?.online);
 }
 async wait(predicate,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(predicate(this.state))return;await delay(30);}throw Error('Public state did not reach expected condition');}
 async action(type,data={}){const r=await this.post(`/api/rooms/${this.state.code}/action`,{type,version:this.state.version,...data});assert.equal(r.status,200,r.data.error);this.accept(r.data);}
 disconnect(){this.controller?.abort();}
}
try {
 for(const path of ['/','/turns.js','/app.js'])assert.equal((await fetch(base+path,{signal:AbortSignal.timeout(15000)})).status,200);
 const a=new Client(),b=new Client();await a.join();await a.connect();await b.join(a.state.code);await b.connect();await a.wait(s=>s.devices.length===2&&s.devices.every(d=>d.online));
 for(let i=0;i<4;i++)await a.action('addPlayer',{name:`Smoke ${i+1}`});
 await a.action('settings',{mode:'rotating',difficulty:'medium',seconds:30,rounds:3,cycles:1,penalty:1});
 await b.wait(s=>s.version===a.state.version);await b.action('ready');await a.wait(s=>s.devices.every(d=>d.id===s.you||d.ready));await a.action('ready');await a.action('start');
 assert.equal(a.state.turnCount,12);assert.notEqual(a.state.active,a.state.guesser);
 const explainer=a.state.active,guesser=a.state.guesser;
 await a.action('begin');await b.wait(s=>s.phase==='playing');assert.equal(b.state.card,null);assertNoSecretValue(b.state,a.state.card.word);
 const guessed=a.state.card.word;await a.action('card',{card:a.state.card.id,result:'guess'});await b.wait(s=>s.lastCompleted?.word===guessed);assert.equal(b.state.scores[explainer],1);assert.equal(b.state.scores[guesser],1);
 const skipped=a.state.card.word;await a.action('card',{card:a.state.card.id,result:'skip'});await b.wait(s=>s.lastCompleted?.word===skipped);assert.equal(b.state.scores[explainer],0);
 const deadline=a.state.deadline;a.disconnect();await b.wait(s=>!s.devices.find(d=>d.id===a.state.you).online);await a.join(a.state.code);await a.connect();assert.equal(a.state.deadline,deadline);assert.equal(a.state.lastCompleted.word,skipped);
 await a.wait(s=>s.phase==='summary',35000);await b.wait(s=>s.phase==='summary');assert.equal(b.state.lastCompleted.word,skipped);assert.equal(b.state.lastCard,null);
 const entry=a.state.history[0].id;await a.action('setAward',{entry,awarded:false});await b.wait(s=>s.history[0].awarded===false);assert.equal(b.state.scores[explainer],-1);assert.equal(b.state.scores[guesser],0);
 await a.action('setAward',{entry,awarded:true});await b.wait(s=>s.history[0].awarded);assert.equal(b.state.scores[explainer],0);assert.equal(b.state.scores[guesser],1);
 await a.action('awardLast',{card:a.state.lastCard.id});await b.wait(s=>s.history.length===3);assert.equal(b.state.scores[guesser],2);
 await a.action('endGame');await b.wait(s=>s.phase==='lobby');assert.equal(b.state.players.length,4);assert.deepEqual(b.state.scores,{});
 await b.action('leave');await a.wait(s=>s.devices.length===1);await a.action('leave');
 console.log('PASS: HTTPS/assets, rotating roles, private card, guess/skip SSE, reconnect, timer summary, undo/restore, late award, same-room lobby.');
} finally {clients.forEach(c=>c.disconnect());await Promise.allSettled(clients.map(c=>c.reading));}
