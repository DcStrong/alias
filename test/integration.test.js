import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from '../server.js';

async function fixture(t){
 let clock=Date.now();const {server}=createServer({now:()=>clock});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`,clients=[];
 t.after(async()=>{clients.forEach(c=>c.disconnect());server.closeAllConnections();await new Promise(r=>server.close(r));});
 class Client {
  constructor(){clients.push(this);this.messages=[];}
  accept(s){this.messages.push(s);if(!this.state||s.version>=this.state.version)this.state=s;}
  async post(path,body={}){const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(this.cookie?{cookie:this.cookie}:{})},body:JSON.stringify(body)});const cookie=response.headers.get('set-cookie');if(cookie)this.cookie=cookie.split(';')[0];return {status:response.status,data:await response.json()};}
  async create(){const r=await this.post('/api/rooms');assert.equal(r.status,201);this.accept(r.data);return this.state.code;}
  async join(code){this.code=code;const r=await this.post(`/api/rooms/${code}/join`);assert.equal(r.status,200,JSON.stringify(r));this.accept(r.data);}
  async connect(){this.controller=new AbortController();const response=await fetch(base+`/api/rooms/${this.state.code}/events`,{headers:{cookie:this.cookie},signal:this.controller.signal});assert.equal(response.status,200);const reader=response.body.getReader();this.reading=(async()=>{let buffer='';const decoder=new TextDecoder();try{while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let index;while((index=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,index);buffer=buffer.slice(index+2);if(event.startsWith('data: '))this.accept(JSON.parse(event.slice(6)));}}}catch(error){if(error.name!=='AbortError'&&!this.controller.signal.aborted)throw error;}})();await this.wait(s=>s.devices.find(d=>d.id===s.you)?.online);}
  disconnect(){this.controller?.abort();}
  async wait(predicate){for(let i=0;i<200;i++){if(this.state&&predicate(this.state))return this.state;await delay(5);}throw Error('Ожидание состояния истекло: '+JSON.stringify(this.state));}
  async action(type,data={},expected=200){const r=await this.post(`/api/rooms/${this.state.code}/action`,{type,version:this.state.version,...data});assert.equal(r.status,expected,JSON.stringify(r.data));if(r.status===200)this.accept(r.data);return r.data;}
 }
 return {client:()=>new Client(),base,advance:async ms=>{clock+=ms;await delay(280);}};
}
async function prepare(f,{mode='pair',rounds=1,penalty=0,online=false,names=['Аня','Борис']}={}){
 const a=f.client();const code=await a.create();await a.connect();let b;
 if(online){b=f.client();await b.join(code);await b.connect();await a.wait(s=>s.devices.length===2&&s.devices.every(d=>d.online));}
 for(let i=0;i<names.length;i++){const c=online&&i===1?b:a;await c.wait(s=>s.players.length===i);await c.action('addPlayer',{name:names[i],team:i%2?'B':'A'});}
 await a.wait(s=>s.players.length===names.length);
 await a.action('settings',{mode,seconds:60,rounds,penalty});
 if(b){await b.wait(s=>s.version>=a.state.version);await b.action('ready');await a.wait(s=>s.devices.find(d=>d.id===b.state.you).ready);}
 await a.action('ready');await a.action('start');if(b)await b.wait(s=>s.phase==='handoff');return {a,b,code};
}

test('Локальная пара: передача, штраф, полные круги, итог и новая игра',async t=>{
 const f=await fixture(t),{a}=await prepare(f,{rounds:2,penalty:1});const words=new Set();
 assert.equal(a.state.players.length,2);assert.equal(a.state.devices.length,1);assert.equal(a.state.turnCount,4);
 for(let turn=0;turn<4;turn++){
  assert.equal(a.state.phase,'handoff');assert.equal(a.state.card,null);assert.equal(a.state.active,a.state.players[turn%2].id);
  await a.action('begin');assert.ok(a.state.card.word);assert.equal(a.state.deadline-a.state.serverNow,60000);
  const word=a.state.card.word;assert.ok(!words.has(word));words.add(word);
  await a.action('card',{card:a.state.card.id,result:'guess'});
  if(turn===0)await a.action('card',{card:a.state.card.id,result:'skip'});
  await f.advance(60000);await a.wait(s=>s.phase==='summary');assert.equal(a.state.card,null);
  assert.equal(a.state.history[0].word,word);await a.action('next');
 }
 assert.equal(a.state.phase,'finished');assert.equal(a.state.scores.pair,3);
 await a.action('restart');assert.equal(a.state.phase,'lobby');assert.deepEqual(a.state.scores,{});assert.equal(a.state.players.length,2);assert.ok(a.state.devices.every(d=>!d.ready));
});

test('Два клиента: скрытая карточка, права, повтор команды и reconnect',async t=>{
 const f=await fixture(t),{a,b,code}=await prepare(f,{online:true});
 await b.action('begin',{},400);await a.action('begin');await b.wait(s=>s.phase==='playing');
 assert.equal(b.state.card,null);assert.ok(!JSON.stringify(b.messages).includes(a.state.card.word));
 await b.action('card',{card:a.state.card.id,result:'guess'},400);await b.action('next',{},400);
 const card=a.state.card.id, version=a.state.version;await a.action('card',{card,result:'guess'});
 await a.action('card',{card,result:'guess',version},400);
 await a.action('card',{card,result:'guess'},400);assert.equal(a.state.scores.pair,1);
 const word=a.state.card.word, deadline=a.state.deadline,players=a.state.players;
 a.disconnect();await b.wait(s=>!s.devices.find(d=>d.id===a.state.you).online);
 await a.join(code);await a.connect();assert.equal(a.state.card.word,word);assert.equal(a.state.deadline,deadline);assert.deepEqual(a.state.players,players);
 await b.wait(s=>s.devices.every(d=>d.online));assert.equal(b.state.card,null);
 await f.advance(60000);await a.wait(s=>s.phase==='summary');await a.action('next');await b.wait(s=>s.phase==='handoff');await b.action('begin');await a.wait(s=>s.phase==='playing');assert.equal(a.state.card,null);assert.ok(b.state.card.word);
});

test('Каждый за себя: три игрока, выбор угадавшего, очки и штрафы',async t=>{
 const f=await fixture(t),{a,b}=await prepare(f,{online:true,mode:'ffa',names:['Аня','Борис','Вера'],penalty:1});
 const [p1,p2,p3]=a.state.players;
 await a.action('begin');await a.action('card',{card:a.state.card.id,result:'guess'},400);
 await a.action('card',{card:a.state.card.id,result:'guess',winner:p1.id},400);
 await a.action('card',{card:a.state.card.id,result:'guess',winner:p3.id});assert.equal(a.state.scores[p1.id],1);assert.equal(a.state.scores[p3.id],1);
 await a.action('card',{card:a.state.card.id,result:'violation'});assert.equal(a.state.scores[p1.id],0);
 await f.advance(60000);await a.wait(s=>s.phase==='summary');await a.action('next');await b.wait(s=>s.active===p2.id);await b.action('begin');await f.advance(60000);await a.wait(s=>s.phase==='summary');await a.action('next');assert.equal(a.state.active,p3.id);await a.action('begin');await f.advance(60000);await a.wait(s=>s.phase==='summary');await a.action('next');assert.equal(a.state.phase,'finished');assert.equal(a.state.turnCount,3);
});

test('Команды: очки, пропуск и завершение по кругу',async t=>{
 const f=await fixture(t),{a}=await prepare(f,{mode:'teams',penalty:1,names:['Аня','Борис','Вера','Глеб']});
 for(let i=0;i<4;i++){await a.action('begin');await a.action('card',{card:a.state.card.id,result:'guess'});if(i===0)await a.action('card',{card:a.state.card.id,result:'skip'});await f.advance(60000);await a.wait(s=>s.phase==='summary');await a.action('next');}
 assert.equal(a.state.phase,'finished');assert.deepEqual(a.state.scores,{A:1,B:2});
});

test('Команда без угадывающего не может стартовать',async t=>{
 const f=await fixture(t);const a=f.client();await a.create();await a.connect();await a.action('addPlayer',{name:'Аня',team:'A'});await a.action('addPlayer',{name:'Борис',team:'B'});await a.action('settings',{mode:'teams',seconds:60,rounds:1,penalty:0});await a.action('ready');await a.action('start',{},400);
});

test('Отключённое устройство исключается ведущим; лобби не застревает',async t=>{
 const f=await fixture(t),a=f.client(),b=f.client();const code=await a.create();await a.connect();await b.join(code);await b.connect();await a.wait(s=>s.devices.length===2);
 await a.action('addPlayer',{name:'Аня'});await a.action('addPlayer',{name:'Борис'});await b.wait(s=>s.players.length===2);await b.action('addPlayer',{name:'Вера'});await a.wait(s=>s.players.length===3);
 b.disconnect();await a.wait(s=>!s.devices.find(d=>d.id===b.state.you).online);await a.action('removeDevice',{device:b.state.you},400);await f.advance(15000);await a.action('removeDevice',{device:b.state.you});assert.equal(a.state.devices.length,1);assert.equal(a.state.players.length,2);await a.action('ready');await a.action('start');assert.equal(a.state.phase,'handoff');
});

test('Ведущий меняется после разрыва; отсутствующий ход можно завершить',async t=>{
 const f=await fixture(t),{a,b,code}=await prepare(f,{online:true,mode:'ffa',names:['Аня','Борис','Вера']});await a.action('begin');const deadline=a.state.deadline;
 a.disconnect();await b.wait(s=>!s.devices.find(d=>d.id===a.state.you).online);await b.action('recover',{},400);await f.advance(15000);await b.wait(s=>s.host===s.you);assert.equal(b.state.deadline,deadline);
 await b.action('recover');assert.equal(b.state.phase,'summary');await a.join(code);await a.connect();assert.notEqual(a.state.host,a.state.you);await a.action('next',{},400);await b.wait(s=>s.devices.every(d=>d.online));await b.action('next');assert.equal(b.state.active,b.state.players[1].id);await b.action('begin');
 await b.action('leave');await a.wait(s=>s.host===s.you&&s.phase==='summary');await a.action('next');assert.equal(a.state.active,a.state.players[2].id);
});

test('Явный выход ведущего завершает пару и даёт второму новую игру',async t=>{
 const f=await fixture(t),{a,b}=await prepare(f,{online:true});await a.action('begin');await b.wait(s=>s.phase==='playing');await a.action('leave');await b.wait(s=>s.host===s.you&&s.phase==='finished');assert.match(b.state.reason,/Недостаточно/);await b.action('restart');assert.equal(b.state.players.length,1);assert.equal(b.state.phase,'lobby');await b.action('addPlayer',{name:'Вера'});await b.action('ready');await b.action('start');assert.equal(b.state.phase,'handoff');
});

test('Граница таймера, недопустимые запросы и защита лобби',async t=>{
 const f=await fixture(t),{a,b,code}=await prepare(f,{online:true});await b.action('settings',{mode:'ffa',seconds:60,rounds:1,penalty:0},400);await a.action('begin');const card=a.state.card.id;await f.advance(60000);await a.wait(s=>s.phase==='summary');await a.action('card',{card,result:'guess'},400);assert.equal(a.state.scores.pair||0,0);
 const foreign=await fetch(f.base+`/api/rooms/${code}/action`,{method:'POST',headers:{'Content-Type':'application/json',cookie:a.cookie,origin:'https://example.invalid'},body:JSON.stringify({type:'next',version:a.state.version})});assert.equal(foreign.status,403);
 const stranger=f.client();const response=await stranger.post(`/api/rooms/${code}/action`,{type:'next',version:a.state.version});assert.equal(response.status,400);
 const late=await stranger.post(`/api/rooms/${code}/join`);assert.equal(late.status,400);assert.equal((await fetch(f.base+'/words.js')).status,404);
 const home=await fetch(f.base);assert.equal(home.status,200);assert.match(home.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});

test('Собственный словарь: сотни карточек без повторов в партии',async t=>{
 const f=await fixture(t),{a}=await prepare(f);await a.action('begin');const words=new Set();
 for(let i=0;i<500;i++){assert.equal(a.state.phase,'playing');assert.ok(a.state.card.word);assert.ok(!words.has(a.state.card.word),'Повтор слова');words.add(a.state.card.word);await a.action('card',{card:a.state.card.id,result:'skip'});}
 assert.equal(words.size,500);assert.equal(a.state.scores.pair,0);
});
