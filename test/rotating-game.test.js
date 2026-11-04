import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../game.js';
import { assertNoSecretValue } from '../test-support/privacy.js';

for(const role of ['active','guesser'])test(`уход ${role} после таймера закрывает недоступный поздний зачёт`,()=>{
  const f=table();f.configure({cycles:1});f.start();
  const owner=f.owner(f.view().active),departing=f.owner(f.view()[role]);
  f.begin();f.advance(60000);assert.equal(f.view().pendingLast,true);
  f.act(departing,'leave');assert.equal(f.view(f.host()).pendingLast,false);
  if(!owner.left)assert.throws(()=>f.act(owner,'awardLast',{card:f.view(owner).lastCard.id}));
});

function table() {
  let now = 1000;
  const game = new Game({now: () => now});
  const room = game.create();
  const devices = ['Аня', 'Борис', 'Вера', 'Денис'].map(name => {
    const device = game.join(room);
    device.connections = 1;
    game.action(room, device, {type:'addPlayer', name, version:room.version});
    return device;
  });
  const view = (device = devices[0]) => game.view(room, device);
  const act = (device, type, data = {}) => game.action(room, device, {type, ...data, version:view().version});
  const host = () => devices.find(d => d.id === view().host);
  const owner = id => devices.find(d => d.id === view().players.find(p => p.id === id).device);
  const configure = data => act(host(), 'settings', {...view().settings, mode:'rotating', ...data});
  const start = () => {
    devices.filter(d => !d.left).forEach(d => act(d, 'ready'));
    act(host(), 'start');
  };
  const advance = ms => { now += ms; game.tick(room); };
  const begin = () => act(owner(view().active), 'begin');
  const next = () => act(host(), 'next', {discardLast:true});
  return {game, room, devices, view, act, host, owner, configure, start, advance, begin, next};
}

test('четыре игрока проходят два полных цикла; роли и текущая карточка после повторного входа', () => {
  const f = table();
  assert.equal(f.view().settings.cycles, 1);
  for (const cycles of [0, 11, 1.5, '2']) assert.throws(() => f.configure({cycles}));
  f.configure({cycles:2, rounds:7});
  f.start();
  const ids = f.view().players.map(p => p.id);
  const expected = new Set(ids.flatMap(a => ids.filter(b => a !== b).map(b => a + '/' + b)));
  for (let cycle = 1; cycle <= 2; cycle++) {
    const all = [];
    for (let i = 0; i < 12; i++) {
      const {active, guesser, turn, turnCount, round, phase} = f.view();
      assert.equal(turnCount, 24);
      assert.equal(phase, 'handoff');
      assert.equal(turn, (cycle - 1) * 12 + i);
      assert.equal(round, cycle);
      all.push(active + '/' + guesser);
      f.begin();
      const card = f.view(f.owner(active)).card;
      for (const d of f.devices) {
        const state = f.view(f.game.join(f.room, d.token));
        assert.deepEqual([state.active, state.guesser, state.turn], [active, guesser, turn]);
        if (d === f.owner(active)) assert.deepEqual(state.card, card);
        else {
          assert.equal(state.card, null);
          assertNoSecretValue(state, card.word);
        }
      }
      f.advance(60000);
      f.next();
    }
    assert.deepEqual(new Set(all), expected);
  }
  assert.equal(f.view().phase, 'finished');
  f.act(f.host(), 'endGame');
  const lobby = f.view();
  assert.equal(lobby.phase, 'lobby');
  assert.deepEqual([lobby.active, lobby.guesser, lobby.turnCount], [undefined, undefined, undefined]);
  assert.deepEqual(lobby.players.map(p => p.id), ids);
  assert.equal(lobby.settings.cycles, 2);
  assert.equal(lobby.settings.rounds, 7);
  f.configure({mode:'ffa'});
  f.start();
  assert.equal(f.view().turnCount, 28);
  assert.equal(f.view().guesser, undefined);
});

test('за обычный и поздний ответ получают балл назначенные игроки, за обе ошибки платит объясняющий', () => {
  const f = table();
  f.configure({penalty:1});
  f.start();
  assert.equal(f.view().turnCount, 12);
  const {active, guesser, players} = f.view();
  const speaker = f.owner(active);
  const outsider = players.find(p => ![active, guesser].includes(p.id));
  f.begin();
  for (const [result, speakerScore] of [['guess',1], ['skip',0], ['violation',-1]]) {
    const card = f.view(speaker).card;
    f.act(speaker, 'card', {result, card:card.id, winner:outsider.id});
    assert.deepEqual(f.view().scores, {[active]:speakerScore, [guesser]:1});
  }
  const last = f.view(speaker).card;
  f.advance(60000);
  assert.equal(f.view(f.owner(guesser)).lastCard, null);
  assert.throws(() => f.act(f.owner(guesser), 'awardLast', {card:last.id}));
  f.act(speaker, 'awardLast', {card:last.id, winner:outsider.id});
  assert.deepEqual(f.view().scores, {[active]:0, [guesser]:2});
  assert.equal(f.view().history.at(-1).winner, players.find(p => p.id === guesser).name);
  assert.throws(() => f.act(speaker, 'awardLast', {card:last.id}));
});

for (const role of ['active','guesser']) {
  test('уход текущего игрока (' + role + ') завершает ход и пропускает его пары в исходном порядке', () => {
    const f = table();
    f.configure({});
    f.start();
    // Replay a copy of this exact draw through public actions to obtain the reference order.
    const reference = structuredClone(f.room);
    const expected = [];
    const host = f.host();
    while (f.game.view(reference, host).phase === 'handoff') {
      const v = f.game.view(reference, host);
      expected.push([v.active, v.guesser]);
      f.game.action(reference, f.owner(v.active), {type:'begin', version:v.version});
      f.advance(60000);
      f.game.tick(reference);
      f.game.action(reference, host, {type:'next', discardLast:true, version:f.game.view(reference, host).version});
    }
    f.begin();
    const departed = f.view()[role];
    f.act(f.owner(departed), 'leave');
    assert.equal(f.view().phase, 'summary');
    assert.equal(f.view().pendingLast, false);
    f.next();
    const remaining = [];
    while (f.view().phase === 'handoff') {
      remaining.push([f.view().active, f.view().guesser]);
      f.begin();
      f.advance(60000);
      f.next();
    }
    assert.equal(f.view().phase, 'finished');
    assert.deepEqual(remaining, expected.filter(pair => !pair.includes(departed)));
  });
}

test('отключение угадывающего не ставит таймер на паузу; через 15 секунд ведущий завершает ход без позднего зачёта', () => {
  const f = table();
  f.configure({});
  f.start();
  f.begin();
  const {guesser, active, deadline} = f.view();
  const receiver = f.owner(guesser), speaker = f.owner(active);
  const card = f.view(speaker).card;
  receiver.connections = 0;
  receiver.disconnectedAt = f.view().serverNow;
  f.advance(14999);
  assert.equal(f.view().phase, 'playing');
  assert.equal(f.view().deadline, deadline);
  assert.throws(() => f.act(f.host(), 'recover'));
  f.advance(1);
  assert.equal(f.view().phase, 'playing');
  f.act(f.host(), 'recover');
  assert.equal(f.view().phase, 'summary');
  assert.equal(f.view(speaker).pendingLast, false);
  assert.throws(() => f.act(speaker, 'awardLast', {card:card.id}));
  assert.deepEqual(f.view().scores, {});
});
