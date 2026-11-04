import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Game} from '../game.js';

function setup(mode) {
  let time=0;const game=new Game({now:()=>time}),room=game.create(),host=game.join(room),other=game.join(room);
  host.connections=other.connections=1;
  const act=(device,type,data={})=>game.action(room,device,{type,version:room.version,...data});
  for(const [i,name] of ['Анна','Борис','Вера','Глеб'].entries())act(host,'addPlayer',{name,team:i%2?'B':'A'});
  if(mode==='pair'){act(host,'removePlayer',{player:room.players[3].id});act(host,'removePlayer',{player:room.players[2].id});}
  act(host,'settings',{mode,seconds:30,rounds:1,cycles:1,penalty:1});act(host,'ready');act(other,'ready');act(host,'start');
  return {game,room,host,other,act,expire:()=>{time+=30000;game.tick(room);}};
}

for(const mode of ['pair','ffa','teams','rotating'])test(`${mode}: отмена и восстановление снимают только сохранённую награду`,()=>{
  const {game,room,host,other,act,expire}=setup(mode);
  act(host,'begin');
  const winner=room.players.find(p=>p.id!==game.active(room).id);
  act(host,'card',{card:room.cardId,result:'guess',winner:winner.id});
  const entry=room.history[0],awarded={...room.scores};
  act(host,'card',{card:room.cardId,result:'skip'});
  const before={...room.scores};
  assert.throws(()=>act(host,'setAward',{entry:entry.id,awarded:false}));
  expire();assert.throws(()=>act(other,'setAward',{entry:entry.id,awarded:false}));
  assert.throws(()=>act(host,'setAward',{entry:room.history[1].id,awarded:false}));
  assert.throws(()=>act(host,'setAward',{entry:entry.id,awarded:'false'}));
  assert.throws(()=>act(host,'setAward',{entry:'foreign',awarded:false}));
  const deck=room.deck.length,version=room.version;
  act(host,'setAward',{entry:entry.id,awarded:false});
  for(const award of entry.awards)assert.equal(room.scores[award.player],before[award.player]-award.delta);
  assert.equal(entry.delta,0);assert.equal(entry.awarded,false);assert.equal(room.deck.length,deck);
  assert.throws(()=>act(host,'setAward',{entry:entry.id,awarded:false,version}));
  const undone={...room.scores};act(host,'setAward',{entry:entry.id,awarded:false});assert.deepEqual(room.scores,undone);
  act(host,'setAward',{entry:entry.id,awarded:true});assert.deepEqual(room.scores,before);
  act(host,'setAward',{entry:entry.id,awarded:true});assert.deepEqual(room.scores,before);
  assert.ok(Object.values(awarded).some(n=>n===1));
  act(host,'next',{discardLast:true});assert.throws(()=>act(host,'setAward',{entry:entry.id,awarded:false}));
  assert.equal(room.history.length,0);
});

test('поздний зачёт отменяется в finished, не открывая право зачёта заново',()=>{
  const {game,room,host,act,expire}=setup('pair');
  act(host,'begin');expire();act(host,'next',{discardLast:true});
  act(host,'begin');expire();const card=game.view(room,host).lastCard.id;
  act(host,'next');assert.equal(room.phase,'finished');act(host,'awardLast',{card});
  const entry=room.history[0];act(host,'setAward',{entry:entry.id,awarded:false});assert.equal(room.scores.pair,0);
  assert.equal(game.view(room,host).lastCard.awarded,false);assert.equal(game.view(room,host).lastCompleted.awarded,false);
  assert.equal(room.lastCard.claimable,false);assert.throws(()=>act(host,'awardLast',{card}));
  act(host,'setAward',{entry:entry.id,awarded:true});assert.equal(room.scores.pair,1);
  act(host,'endGame');assert.deepEqual(room.history,[]);assert.deepEqual(room.scores,{});
  assert.throws(()=>act(host,'setAward',{entry:entry.id,awarded:true}));
});
