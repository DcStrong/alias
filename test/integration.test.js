import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {createServer} from '../server.js';
import {WORDS, HARD_WORDS, MEDIUM_WORDS} from '../words.js';

async function fixture(t){
 let clock=Date.now();const {server}=createServer({now:()=>clock});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}`,clients=[];
 t.after(async()=>{clients.forEach(c=>c.disconnect());server.closeAllConnections();await new Promise(r=>server.close(r));});
 class Client {
  constructor(){clients.push(this);this.messages=[];}
  accept(s){this.messages.push(s);if(!this.state||s.version>=this.state.version)this.state=s;}
  async post(path,body={}){const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(this.cookie?{cookie:this.cookie}:{})},body:JSON.stringify(body)});const cookie=response.headers.get('set-cookie');if(cookie){this.lastSetCookie=cookie;this.cookie=cookie.split(';')[0];}return {status:response.status,data:await response.json()};}
  async create(){const r=await this.post('/api/rooms');assert.equal(r.status,201);this.accept(r.data);return this.state.code;}
  async join(code){this.code=code;const r=await this.post(`/api/rooms/${code}/join`);assert.equal(r.status,200,JSON.stringify(r));this.accept(r.data);}
  async connect(){this.controller=new AbortController();const response=await fetch(base+`/api/rooms/${this.state.code}/events`,{headers:{cookie:this.cookie},signal:this.controller.signal});assert.equal(response.status,200);const reader=response.body.getReader();this.reading=(async()=>{let buffer='';const decoder=new TextDecoder();try{while(true){const {done,value}=await reader.read();if(done)break;buffer+=decoder.decode(value,{stream:true});let index;while((index=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,index);buffer=buffer.slice(index+2);if(event.startsWith('data: '))this.accept(JSON.parse(event.slice(6)));}}}catch(error){if(error.name!=='AbortError'&&!this.controller.signal.aborted)throw error;}})();await this.wait(s=>s.devices.find(d=>d.id===s.you)?.online);}
  disconnect(){this.controller?.abort();}
  async wait(predicate){for(let i=0;i<200;i++){if(this.state&&predicate(this.state))return this.state;await delay(5);}throw Error('Ожидание состояния истекло: '+JSON.stringify(this.state));}
  async action(type,data={},expected=200){const r=await this.post(`/api/rooms/${this.state.code}/action`,{type,version:this.state.version,...data});assert.equal(r.status,expected,JSON.stringify(r.data));if(r.status===200)this.accept(r.data);return r.data;}
 }
 return {client:()=>new Client(),base,advance:async ms=>{clock+=ms;await delay(280);}};
}
async function prepare(f,{mode='pair',rounds=1,penalty=0,online=false,difficulty='basic',names=['Аня','Борис']}={}){
 const a=f.client();const code=await a.create();await a.connect();let b;
 if(online){b=f.client();await b.join(code);await b.connect();await a.wait(s=>s.devices.length===2&&s.devices.every(d=>d.online));}
 for(let i=0;i<names.length;i++){const c=online&&i===1?b:a;await c.wait(s=>s.players.length===i);await c.action('addPlayer',{name:names[i],team:i%2?'B':'A'});}
 await a.wait(s=>s.players.length===names.length);
 await a.action('settings',{mode,difficulty,seconds:60,rounds,penalty});
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
 assert.equal((await fetch(f.base+'/guesser.js')).status,200);const home=await fetch(f.base);assert.equal(home.status,200);assert.match(home.headers.get('content-security-policy'),/frame-ancestors 'none'/);
});

test('Собственный словарь: сотни карточек без повторов в партии',async t=>{
 const f=await fixture(t),{a}=await prepare(f);await a.action('begin');const words=new Set();
 for(let i=0;i<500;i++){assert.equal(a.state.phase,'playing');assert.ok(a.state.card.word);assert.ok(!words.has(a.state.card.word),'Повтор слова');words.add(a.state.card.word);await a.action('card',{card:a.state.card.id,result:'skip'});}
 assert.equal(words.size,500);assert.equal(a.state.scores.pair,0);
});

test('Выход из лобби сбрасывает готовность оставшихся устройств',async t=>{
 const f=await fixture(t),a=f.client(),b=f.client();const code=await a.create();await a.connect();await b.join(code);await b.connect();await a.wait(s=>s.devices.length===2);
 await a.action('addPlayer',{name:'Аня'});await a.action('addPlayer',{name:'Вера'});await b.wait(s=>s.players.length===2);await b.action('addPlayer',{name:'Борис'});await a.wait(s=>s.players.length===3);await a.action('settings',{mode:'ffa',seconds:60,rounds:1,penalty:0});await b.wait(s=>s.version>=a.state.version);await b.action('ready');await a.wait(s=>s.devices.some(d=>d.id===b.state.you&&d.ready));await a.action('ready');await b.wait(s=>s.devices.every(d=>d.ready));await b.action('leave');await a.wait(s=>s.devices.length===1);assert.equal(a.state.devices[0].ready,false);await a.action('start',{},400);await a.action('ready');await a.action('start');assert.equal(a.state.phase,'handoff');
});

test('Сессионная cookie сохраняет возврат в долго открытую комнату',async t=>{
 const f=await fixture(t),{a,code}=await prepare(f);assert.match(a.lastSetCookie,/HttpOnly/);assert.match(a.lastSetCookie,/SameSite=Strict/);assert.doesNotMatch(a.lastSetCookie,/Max-Age|Expires/i);
 const you=a.state.you,ids=a.state.players.map(p=>p.id);await f.advance(25*60*60*1000);a.disconnect();await delay(20);await a.join(code);await a.connect();assert.equal(a.state.you,you);assert.deepEqual(a.state.players.map(p=>p.id),ids);assert.equal(a.state.phase,'handoff');await a.action('begin');assert.ok(a.state.card.word);
});

for(const selectedDifficulty of ['medium','hard'])test(`Сложность: базовая по умолчанию, ${selectedDifficulty} синхронизируется и сбрасывает готовность`,async t=>{
 const f=await fixture(t),a=f.client(),b=f.client();const code=await a.create();assert.equal(a.state.settings.difficulty,'basic');await a.connect();await b.join(code);await b.connect();await a.wait(s=>s.devices.length===2);
 await a.action('addPlayer',{name:'Аня'});await b.wait(s=>s.players.length===1);await b.action('addPlayer',{name:'Борис'});await a.wait(s=>s.players.length===2);
 await a.action('ready');await b.wait(s=>s.devices.find(d=>d.id===a.state.you).ready);await b.action('ready');await a.wait(s=>s.devices.every(d=>d.ready));
 await a.action('settings',{mode:'pair',seconds:60,rounds:1,penalty:0,difficulty:selectedDifficulty});await b.wait(s=>s.settings.difficulty===selectedDifficulty);assert.ok(a.state.devices.every(d=>!d.ready));assert.ok(b.state.devices.every(d=>!d.ready));assert.ok(a.state.difficulties.some(d=>d.id===selectedDifficulty&&d.count>=300));
 await b.action('settings',{mode:'pair',seconds:60,rounds:1,penalty:0,difficulty:'basic'},400);assert.equal(b.state.settings.difficulty,selectedDifficulty);
 for(const difficulty of ['expert','__proto__',null,42])await a.action('settings',{mode:'pair',seconds:60,rounds:1,penalty:0,difficulty},400);
 // Legacy clients omit the new field: preserve the chosen difficulty.
 await a.action('settings',{mode:'pair',seconds:90,rounds:1,penalty:0});assert.equal(a.state.settings.difficulty,selectedDifficulty);
 await b.wait(s=>s.version>=a.state.version);await b.action('ready');await a.wait(s=>s.devices.find(d=>d.id===b.state.you).ready);await a.action('ready');await a.action('start');await a.action('settings',{mode:'pair',seconds:60,rounds:1,penalty:0,difficulty:'basic'},400);
});

for(const [difficulty,entries] of [['basic',WORDS],['medium',MEDIUM_WORDS],['hard',HARD_WORDS]]) {
 test(`Набор ${difficulty}: полная колода без повторов и подмешивания другой сложности`,async t=>{
  const f=await fixture(t),{a}=await prepare(f,{difficulty});assert.equal(a.state.settings.difficulty,difficulty);
  const metadata=a.state.difficulties.find(d=>d.id===difficulty);assert.equal(metadata.count,entries.length);assert.deepEqual(Object.keys(metadata).sort(),['count','description','id','label']);
  assert.ok(a.state.difficulties.every(d=>!Object.hasOwn(d,'words')));await a.action('begin');const seen=new Set();
  for(let i=0;i<entries.length;i++){
   assert.equal(a.state.phase,'playing');assert.ok(entries.includes(a.state.card.word),'Карточка из другого набора');assert.ok(!seen.has(a.state.card.word),'Повтор карточки');seen.add(a.state.card.word);
   await a.action('card',{card:a.state.card.id,result:'skip'});
  }
  assert.equal(seen.size,entries.length);assert.equal(a.state.phase,'finished');assert.equal(a.state.card,null);assert.equal(a.state.reason,'Словарь закончился');
  if(difficulty!=='basic')assert.ok([...seen].some(word=>word.includes(' ')),'В игре нет словосочетаний');
  await a.action('restart');assert.equal(a.state.settings.difficulty,difficulty);assert.equal(a.state.phase,'lobby');
  const other=difficulty==='basic'?'hard':'basic';await a.action('settings',{mode:'pair',difficulty:other,seconds:60,rounds:1,penalty:0});await a.action('ready');await a.action('start');await a.action('begin');assert.ok((other==='hard'?HARD_WORDS:WORDS).includes(a.state.card.word));
 });
}

for(const difficulty of ['basic','medium','hard'])for(const mode of ['pair','ffa','teams']) {
 test(`${difficulty} / ${mode}: два устройства, очки, таймер, смена роли и reconnect`,async t=>{
  const f=await fixture(t),names=mode==='pair'?['Аня','Борис']:mode==='ffa'?['Аня','Борис','Вера']:['Аня','Борис','Вера','Глеб'];
  const {a,b,code}=await prepare(f,{mode,difficulty,online:true,names,penalty:1});
  await a.action('begin');await b.wait(s=>s.phase==='playing');const word=a.state.card.word;
  assert.ok(({basic:WORDS,medium:MEDIUM_WORDS,hard:HARD_WORDS}[difficulty]).includes(word));assert.equal(b.state.card,null);assert.ok(!JSON.stringify(b.messages).includes(word));assert.equal(b.state.settings.difficulty,difficulty);
  await a.action('card',{card:a.state.card.id,result:'guess',winner:a.state.players[1].id});
  const key=mode==='pair'?'pair':mode==='teams'?'A':a.state.players[0].id;assert.equal(a.state.scores[key],1);if(mode==='ffa')assert.equal(a.state.scores[a.state.players[1].id],1);
  await a.action('card',{card:a.state.card.id,result:'skip'});assert.equal(a.state.scores[key],0);
  const deadline=a.state.deadline, card=a.state.card;a.disconnect();await b.wait(s=>!s.devices.find(d=>d.id===a.state.you).online);await a.join(code);await a.connect();assert.equal(a.state.settings.difficulty,difficulty);assert.deepEqual(a.state.card,card);assert.equal(a.state.deadline,deadline);
  await f.advance(60000);await a.wait(s=>s.phase==='summary');await a.action('next');await b.wait(s=>s.phase==='handoff');assert.equal(b.state.card,null);await b.action('begin');await a.wait(s=>s.phase==='playing');assert.equal(a.state.card,null);assert.ok(({basic:WORDS,medium:MEDIUM_WORDS,hard:HARD_WORDS}[difficulty]).includes(b.state.card.word));
  await f.advance(60000);await a.wait(s=>s.phase==='summary');await a.action('next');
  for(let turn=2;turn<names.length;turn++){assert.equal(a.state.phase,'handoff');await a.action('begin');await f.advance(60000);await a.wait(s=>s.phase==='summary');await a.action('next');}
  assert.equal(a.state.phase,'finished');assert.equal(a.state.turnCount,names.length);assert.equal(a.state.settings.difficulty,difficulty);
 });
}

test('Завершённая карточка раскрывается, следующая скрыта, нарушение не раскрывается',async t=>{
 const f=await fixture(t),{a,b}=await prepare(f,{online:true,difficulty:'hard'});await a.action('begin');await b.wait(s=>s.phase==='playing');assert.equal(b.state.lastCompleted,null);
 const first=a.state.card;await a.action('card',{card:first.id,result:'guess'});await b.wait(s=>s.lastCompleted?.word===first.word);assert.equal(b.state.lastCompleted.result,'guess');assert.equal(b.state.card,null);assert.ok(!JSON.stringify(b.state).includes(a.state.card.word));
 const second=a.state.card;await a.action('card',{card:second.id,result:'skip'});await b.wait(s=>s.lastCompleted?.word===second.word);assert.equal(b.state.lastCompleted.result,'skip');assert.equal(b.state.scores.pair,1);
 const third=a.state.card;await b.wait(s=>s.version>=a.state.version);await b.action('card',{card:third.id,result:'guess'},400);await a.action('card',{card:second.id,result:'guess'},400);assert.equal(a.state.lastCompleted.word,second.word);
 await a.action('card',{card:third.id,result:'violation'});await b.wait(s=>s.version>=a.state.version);assert.equal(b.state.lastCompleted.word,second.word);assert.ok(!JSON.stringify(b.state).includes(third.word));assert.ok(!JSON.stringify(b.state).includes(a.state.card.word));
});

test('Последнее слово после таймера доступно объясняющему, сохраняется в итогах партии и не засчитывается',async t=>{
 const f=await fixture(t),{a,b,code}=await prepare(f,{online:true});await a.action('begin');const first=a.state.card;await f.advance(60000);await a.wait(s=>s.phase==='summary');await b.wait(s=>s.phase==='summary');
 assert.equal(a.state.card,null);assert.equal(a.state.lastCard.word,first.word);assert.equal(a.state.lastCard.result,'unplayed');assert.equal(b.state.lastCard,null);assert.ok(!JSON.stringify(b.state).includes(first.word));
 await a.action('card',{card:first.id,result:'guess'},400);assert.deepEqual(a.state.scores,{});await a.join(code);assert.equal(a.state.lastCard.word,first.word);await a.action('next');assert.equal(a.state.phase,'handoff');assert.equal(a.state.lastCard,null);assert.equal(a.state.lastCompleted,null);
 await b.wait(s=>s.phase==='handoff');await b.action('begin');const last=b.state.card;await f.advance(60000);await a.wait(s=>s.phase==='summary');await b.wait(s=>s.phase==='summary');await a.action('next');await b.wait(s=>s.phase==='finished');assert.equal(b.state.lastCard.word,last.word);assert.equal(a.state.lastCard,null);assert.equal(b.state.deadline,null);assert.deepEqual(b.state.scores,{});
 await a.action('restart');await b.wait(s=>s.phase==='lobby');assert.equal(b.state.lastCard,null);assert.equal(b.state.lastCompleted,null);
});
