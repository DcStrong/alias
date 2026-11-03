// Real public-route smoke: no credentials or cookie values are printed/saved.
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
const base=new URL(process.argv[2]||'https://144.31.97.89').origin;
const difficulty=process.argv.find(arg=>arg.startsWith('--difficulty='))?.split('=')[1]||'basic';
const quick=process.argv.includes('--quick');
const clients=[];
class Client {
 constructor(){clients.push(this);this.messages=[];}
 accept(state){this.messages.push(state);if(!this.state||state.version>=this.state.version)this.state=state;}
 async post(path,body={}) {
  const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...(this.cookie?{Cookie:this.cookie}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  const cookie=response.headers.get('set-cookie');if(cookie){this.cookie=cookie.split(';')[0];assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);if(base.startsWith('https:'))assert.match(cookie,/; Secure/);}
  return {status:response.status,data:await response.json()};
 }
 async create(){const r=await this.post('/api/rooms');assert.equal(r.status,201);this.accept(r.data);}
 async join(code){const r=await this.post(`/api/rooms/${code}/join`);assert.equal(r.status,200);this.accept(r.data);}
 async connect(){
  this.controller=new AbortController();const response=await fetch(base+`/api/rooms/${this.state.code}/events`,{headers:{Cookie:this.cookie},signal:this.controller.signal});assert.equal(response.status,200);assert.match(response.headers.get('content-type'),/text\/event-stream/);
  const reader=response.body.getReader(),controller=this.controller;
  this.reading=(async()=>{const decoder=new TextDecoder();let buffer='';try{while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let index;while((index=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,index);buffer=buffer.slice(index+2);if(event.startsWith('data: '))this.accept(JSON.parse(event.slice(6)));}}}catch(e){if(!controller.signal.aborted)throw e;}})();
  await this.wait(s=>s.devices.find(d=>d.id===s.you)?.online);
 }
 async wait(predicate,timeout=15000){const until=Date.now()+timeout;while(Date.now()<until){if(this.state&&predicate(this.state))return;await delay(50);}throw Error('Ожидание публичного состояния истекло');}
 async action(type,data={},expected=200){const r=await this.post(`/api/rooms/${this.state.code}/action`,{type,version:this.state.version,...data});assert.equal(r.status,expected,JSON.stringify(r.data));if(expected===200)this.accept(r.data);return r.data;}
 async leave(){
  // Closing a peer SSE stream may advance the version after its leave response.
  for(let attempt=0;attempt<8;attempt++){
   const response=await this.post(`/api/rooms/${this.state.code}/action`,{type:'leave',version:this.state.version});
   if(response.status===200){this.accept(response.data);return;}
   assert.equal(response.status,400);assert.match(response.data.error,/Состояние уже изменилось/);await delay(100);
  }
  throw Error('Не удалось очистить тестового участника после обновлений присутствия');
 }
 disconnect(){this.controller?.abort();}
}
try {
 const home=await fetch(base,{signal:AbortSignal.timeout(15000)});assert.equal(home.status,200);assert.match(await home.text(),/Скажи иначе/);
 assert.equal((await fetch(base+'/guesser.js')).status,200);
 const a=new Client(),b=new Client();await a.create();const code=a.state.code;await a.connect();await b.join(code);await b.connect();await a.wait(s=>s.devices.length===2&&s.devices.every(d=>d.online));
 await a.action('addPlayer',{name:'Проверка A'});await b.wait(s=>s.players.length===1);await b.action('addPlayer',{name:'Проверка B'});await a.wait(s=>s.players.length===2);
 await a.action('settings',{mode:'pair',difficulty,seconds:30,rounds:1,penalty:1});await b.wait(s=>s.version>=a.state.version);await b.action('ready');await a.wait(s=>s.devices.find(d=>d.id===b.state.you).ready);await a.action('ready');await a.action('start');await b.wait(s=>s.phase==='handoff');assert.equal(a.state.settings.difficulty,difficulty);assert.equal(b.state.settings.difficulty,difficulty);assert.equal(a.state.card,null);assert.equal(b.state.card,null);
 await b.action('begin',{},400);await a.action('begin');await b.wait(s=>s.phase==='playing');const firstWord=a.state.card.word;assert.ok(firstWord);assert.equal(b.state.card,null);assert.ok(!JSON.stringify(b.messages).includes(firstWord));
 const firstCard=a.state.card.id;await b.action('card',{card:firstCard,result:'guess'},400);await a.action('card',{card:firstCard,result:'guess'});await a.action('card',{card:firstCard,result:'guess'},400);await b.wait(s=>s.scores.pair===1);assert.equal(a.state.scores.pair,1);assert.equal(b.state.lastCompleted.word,firstWord);assert.equal(b.state.lastCompleted.result,'guess');
 const word=a.state.card.word,deadline=a.state.deadline,you=a.state.you,ids=a.state.players.map(p=>p.id);a.disconnect();await b.wait(s=>!s.devices.find(d=>d.id===you).online);await a.join(code);await a.connect();assert.equal(a.state.you,you);assert.equal(a.state.card.word,word);assert.equal(a.state.deadline,deadline);assert.deepEqual(a.state.players.map(p=>p.id),ids);await b.wait(s=>s.devices.every(d=>d.online));assert.equal(b.state.card,null);
 if(quick){
  const skipped=a.state.card;await a.action('card',{card:skipped.id,result:'skip'});await b.wait(s=>s.lastCompleted?.word===skipped.word);assert.equal(b.state.lastCompleted.result,'skip');assert.equal(b.state.card,null);assert.ok(!JSON.stringify(b.state).includes(a.state.card.word));assert.equal(b.state.scores.pair,0);
  console.log(`PASS ${difficulty}: HTTPS, module asset, Secure cookie, 2 clients, difficulty, rights, reveal guessed/skipped only, hidden active card, duplicate protection, reconnect.`);
 } else {
 console.log('PASS: HTTPS, Secure cookie, 2 клиента, синхронизация, права, скрытие слова, повторы, reconnect. Ожидаем серверный таймер первого хода.');
 await a.wait(s=>s.phase==='summary',40000);await b.wait(s=>s.phase==='summary');assert.equal(a.state.lastCard.word,word);assert.equal(b.state.lastCard,null);await a.action('next');await b.wait(s=>s.phase==='handoff');await b.action('begin');await a.wait(s=>s.phase==='playing');assert.equal(a.state.card,null);assert.ok(b.state.card.word);assert.notEqual(b.state.card.word,firstWord);await b.action('card',{card:b.state.card.id,result:'guess'});await a.wait(s=>s.scores.pair===2);
 console.log('PASS: первый таймер завершён сервером, ход и секретная карточка перешли второму клиенту. Ожидаем итог партии.');
 await a.wait(s=>s.phase==='summary',40000);await a.action('next');await b.wait(s=>s.phase==='finished');assert.equal(a.state.phase,'finished');assert.equal(a.state.scores.pair,2);assert.equal(a.state.turnCount,2);
 console.log('PASS: публичная партия из 2 полных ходов завершена, общий счёт 2.');
 }
 await b.leave();await a.wait(s=>s.devices.length===1);await a.leave();
} finally {clients.forEach(c=>c.disconnect());await Promise.allSettled(clients.map(c=>c.reading));}
