import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.js';
import {HARD_WORDS} from '../words.js';
import {HARD_HINTS} from '../hints.js';

// Анна на устройстве ведущего, Борис на втором устройстве; третье устройство — наблюдатель без игроков.
function setup(settings={}) {
  let time=0;const game=new Game({now:()=>time}),room=game.create(),host=game.join(room),other=game.join(room),third=game.join(room);
  host.connections=other.connections=third.connections=1;
  const act=(device,type,data={})=>game.action(room,device,{type,version:room.version,...data});
  act(host,'addPlayer',{name:'Анна'});act(other,'addPlayer',{name:'Борис'});
  act(host,'settings',{mode:'pair',difficulty:'basic',seconds:60,rounds:1,cycles:1,penalty:0,...settings});
  for(const d of [host,other,third])act(d,'ready');act(host,'start');
  return {game,room,host,other,third,act,wait:ms=>{time+=ms;game.tick(room);}};
}

test('каждая карточка сложного набора имеет короткое толкование',()=>{
  const missing=HARD_WORDS.filter(w=>!HARD_HINTS[w]);
  assert.deepEqual(missing,[]);
  for(const w of HARD_WORDS){const h=HARD_HINTS[w];assert.ok(h.length<=120,w);assert.match(h,/^[а-яё].*\.$/u,w);}
  assert.deepEqual(Object.keys(HARD_HINTS).filter(w=>!HARD_WORDS.includes(w)),[],'Лишние толкования');
});

test('подсказки включаются только для сложного набора',()=>{
  const {room}=setup({difficulty:'medium',hints:true});
  assert.equal(room.settings.hints,false);
  const hard=setup({difficulty:'hard',hints:true});
  assert.equal(hard.room.settings.hints,true);
  assert.throws(()=>hard.act(hard.host,'settings',{mode:'pair',difficulty:'hard',seconds:60,rounds:1,cycles:1,penalty:0,hints:'yes'}));
});

test('подсказка активной карточки уходит только объясняющему, в итогах — всем',()=>{
  const {game,room,host,other,third,act,wait}=setup({difficulty:'hard',hints:true});
  act(host,'begin');
  const word=room.word;
  assert.equal(game.view(room,host).card.hint,HARD_HINTS[word]);
  for(const d of [other,third])assert.ok(!JSON.stringify(game.view(room,d)).includes(HARD_HINTS[word]));
  act(host,'card',{card:room.cardId,result:'guess'});
  wait(60000);
  for(const d of [host,other,third])assert.equal(game.view(room,d).history[0].hint,HARD_HINTS[word]);
});

test('без галочки подсказки не отправляются',()=>{
  const {game,room,host,act}=setup({difficulty:'hard',hints:false});
  act(host,'begin');
  assert.equal(game.view(room,host).card.hint,undefined);
});

test('пауза замораживает таймер, скрывает карточку и продолжает с остатка',()=>{
  const {game,room,host,other,third,act,wait}=setup();
  act(host,'begin');
  wait(20000);
  assert.throws(()=>act(third,'pause'),/объясняющий или ведущий/);
  act(host,'pause');
  assert.equal(room.pausedRemaining,40000);
  assert.equal(game.view(room,host).card,null);
  assert.equal(game.view(room,host).paused,true);
  assert.throws(()=>act(host,'card',{card:room.cardId,result:'guess'}),/паузе/);
  assert.throws(()=>act(host,'pause'));
  wait(600000);
  assert.equal(room.phase,'playing');
  act(host,'resume');
  assert.ok(game.view(room,host).card.word);
  wait(39000);assert.equal(room.phase,'playing');
  wait(1000);assert.equal(room.phase,'summary');
  assert.equal(room.paused,false);
  assert.throws(()=>act(host,'resume'));
});

test('паузу ставит ведущий, даже если ход объясняет другое устройство',()=>{
  const {room,host,other,act,wait}=setup();
  act(host,'begin');act(host,'card',{card:room.cardId,result:'skip'});wait(60000);
  act(host,'next',{discardLast:true});
  act(other,'begin');
  act(host,'pause');act(other,'resume');act(other,'pause');act(host,'resume');
  assert.equal(room.paused,false);
});
