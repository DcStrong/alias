import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../game.js';

// Drive the normal join and SSE handlers, and inspect the HTML the host actually receives.
test('ведущий видит последнее обработанное слово во время хода, в итогах и после восстановления связи', async t => {
  const game = new Game();
  const room = game.create();
  const host = game.join(room), guest = game.join(room);
  room.players = [{id:'a', name:'Аня', device:host.id}, {id:'b', name:'Борис', device:guest.id}];
  Object.assign(room, {phase:'playing', turn:1, rosterSize:2, schedule:[{explainer:'a'}, {explainer:'b'}],
    word:'буксир', cardId:'first', deck:['секрет','ландыш'], deadline:Date.now()+60000, scores:{}});
  const app = {addEventListener(){}, querySelectorAll(){return [];}};
  const elements = new Map([['#app',app], ['#connection',{}], ['#copy',{}], ['#leave',{}]]);
  let stream;
  t.mock.timers.enable({apis:['setInterval']});
  const globals = {
    document:{querySelector:id=>elements.get(id)??null}, location:{search:'?room='+room.code},
    history:{replaceState(){}}, EventSource:class {constructor(){stream=this;}},
    fetch:async()=>({ok:true,json:async()=>game.view(room,host)})
  };
  for(const [key,value] of Object.entries(globals)) {
    const descriptor=Object.getOwnPropertyDescriptor(globalThis,key);
    Object.defineProperty(globalThis,key,{configurable:true,writable:true,value});
    t.after(()=>descriptor?Object.defineProperty(globalThis,key,descriptor):delete globalThis[key]);
  }

  async function join(suffix) {
    await import('../public/app.js?word-sync='+suffix);
    await new Promise(resolve=>setImmediate(resolve));
    assert.ok(stream?.onmessage);
  }
  function broadcast() {
    stream.onmessage({data:JSON.stringify(game.view(room,host))});
    assert.doesNotMatch(app.innerHTML,/секрет/);
  }
  await join('first');
  for(const [result,word] of [['guess','буксир'],['skip','ландыш']]) {
    game.action(room,guest,{type:'card',result,card:room.cardId,version:room.version});
    broadcast();
    assert.ok(app.innerHTML.includes(word));
  }
  room.deadline=Date.now()-1;
  game.tick(room);
  broadcast();
  assert.match(app.innerHTML,/ландыш/);
  game.action(room,host,{type:'next',version:room.version});
  assert.equal(game.view(room,host).lastCompleted.word,'ландыш');
  broadcast();
  assert.match(app.innerHTML,/Партия завершена/);
  assert.ok(app.innerHTML.includes('ландыш'), 'итог партии потерял пропущенное слово');
  stream=null;
  await join('reconnect');
  assert.match(app.innerHTML,/ландыш/);
  assert.doesNotMatch(app.innerHTML,/секрет/);
});
