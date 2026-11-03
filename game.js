import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { WORDS } from './words.js';
const fail = (message) => { throw new Error(message); };
export class Game {
  constructor({now = Date.now, turnMs, graceMs = 15000} = {}) { this.rooms = new Map(); this.now = now; this.turnMs = turnMs; this.graceMs = graceMs; }
  device(room, token) { return room.devices.find(d => d.token === token && !d.left) || fail('Войдите в комнату заново'); }
  create() {
    let code; do { code = randomBytes(4).toString('hex').slice(0,6).toUpperCase(); } while(this.rooms.has(code));
    const room = {code, devices:[], players:[], host:null, phase:'lobby', settings:{mode:'pair',seconds:60,rounds:3,penalty:0}, version:0, touched:this.now(), history:[]};
    this.rooms.set(code, room); return room;
  }
  join(room, token) {
    let d = room.devices.find(d => d.token === token && !d.left);
    if (!d) { if(room.phase !== 'lobby') fail('Партия уже началась. Дождитесь новой игры'); if(room.devices.filter(d=>!d.left).length>=12) fail('В комнате уже 12 устройств'); d={id:randomUUID(),token:randomBytes(24).toString('hex'),ready:false,connections:0,disconnectedAt:this.now()}; room.devices.push(d); }
    if(!room.host) room.host=d.id; return d;
  }
  host(room,d) { if(room.host!==d.id) fail('Это действие доступно ведущему'); }
  active(room) { return room.players.find(p=>p.id===room.schedule?.[room.turn]); }
  connected(room,p) { return room.devices.some(d=>d.id===p.device && !d.left && d.connections>0); }
  view(room,d) {
    const active=this.active(room);
    return {code:room.code,version:room.version,phase:room.phase,host:room.host,you:d.id,settings:room.settings,
      players:room.players.map(p=>({...p,online:this.connected(room,p)})), devices:room.devices.filter(x=>!x.left).map(x=>({id:x.id,ready:x.ready,online:x.connections>0})),
      active:active?.id,turn:room.turn,turnCount:room.schedule?.length,round:room.schedule?Math.floor(room.turn/room.rosterSize)+1:0,
      deadline:room.deadline,serverNow:this.now(),card:room.phase==='playing' && active?.device===d.id?{id:room.cardId,word:room.word}:null,
      history:room.phase==='playing'?[]:room.history, scores:room.scores || {}, reason:room.reason || null};
  }
  resetReady(room) { room.devices.forEach(d=>d.ready=false); }
  nextCard(room) {
    if(!room.deck.length) { this.endTurn(room,'Словарь закончился'); room.phase='finished'; return; }
    room.word=room.deck.pop(); room.cardId=randomUUID();
  }
  endTurn(room,reason='Время вышло') {room.phase='summary';room.word=null;room.cardId=null;room.deadline=null;room.reason=reason;}
  score(room, key, delta) {room.scores[key]=(room.scores[key]||0)+delta;}
  advance(room) {
    do {room.turn++;} while(room.turn<room.schedule.length && !room.players.some(p=>p.id===room.schedule[room.turn]&&!p.left));
    room.phase=room.turn>=room.schedule.length?'finished':'handoff'; room.history=[];room.reason=null;
  }
  leave(room,d) {
    d.left=true; d.connections=0; room.players.filter(p=>p.device===d.id).forEach(p=>p.left=true);
    if(room.phase==='lobby') {room.players=room.players.filter(p=>!p.left);this.resetReady(room);}
    else if(room.players.filter(p=>!p.left).length<2 || (room.settings.mode==='teams' && ['A','B'].some(team=>room.players.filter(p=>!p.left&&p.team===team).length<2))) { this.endTurn(room,'Недостаточно игроков для продолжения');room.phase='finished'; }
    else if(this.active(room)?.device===d.id && ['playing','handoff'].includes(room.phase)) this.endTurn(room,'Объясняющий вышел');
    if(room.host===d.id) room.host=room.devices.find(x=>!x.left&&x.connections>0)?.id || room.devices.find(x=>!x.left)?.id || null;
  }
  tick(room) {
    let changed=false;
    if(room.phase==='playing'&&this.now()>=room.deadline) {this.endTurn(room);changed=true;}
    const host=room.devices.find(d=>d.id===room.host);
    if(host && !host.connections && this.now()-host.disconnectedAt>=this.graceMs) {
      const replacement=room.devices.find(d=>!d.left&&d.connections>0);
      if(replacement) {room.host=replacement.id;changed=true;}
    }
    if(changed) {room.version++;room.touched=this.now();} return changed;
  }
  action(room,d,a) {
    this.tick(room);
    if(a.version!==room.version) fail('Состояние уже изменилось. Повторите действие');
    const lobby = () => {if(room.phase!=='lobby') fail('Изменения доступны только до партии');};
    switch(a.type) {
      case 'addPlayer': {
        lobby(); const name=String(a.name||'').trim().slice(0,24);if(!name) fail('Введите имя');
        if(room.players.length>=16) fail('Максимум 16 игроков');
        if(room.players.some(p=>p.name.toLowerCase()===name.toLowerCase())) fail('Такое имя уже занято');
        room.players.push({id:randomUUID(),name,device:d.id,team:a.team==='B'?'B':'A',left:false});this.resetReady(room);break;
      }
      case 'removePlayer': {lobby(); const p=room.players.find(p=>p.id===a.player); if(!p) fail('Игрок не найден');if(p.device!==d.id) this.host(room,d); room.players=room.players.filter(x=>x!==p);this.resetReady(room);break;}
      case 'team': {lobby();const p=room.players.find(p=>p.id===a.player);if(!p) fail('Игрок не найден');if(p.device!==d.id)this.host(room,d);p.team=a.team==='B'?'B':'A';this.resetReady(room);break;}
      case 'settings': {
        lobby();this.host(room,d);const {mode,seconds,rounds,penalty}=a;
        if(!['pair','ffa','teams'].includes(mode)||![30,60,90,120].includes(seconds)||!Number.isInteger(rounds)||rounds<1||rounds>10||![0,1].includes(penalty)) fail('Некорректные настройки');
        room.settings={mode,seconds,rounds,penalty};this.resetReady(room);break;
      }
      case 'ready': lobby();d.ready=!d.ready;break;
      case 'start': {
        lobby();this.host(room,d);const ps=room.players;
        if(ps.length<2) fail('Нужно хотя бы два игрока');
        if(room.settings.mode==='pair'&&ps.length!==2) fail('Для пары нужно ровно два игрока');
        if(room.settings.mode==='teams'&&['A','B'].some(team=>ps.filter(p=>p.team===team).length<2)) fail('В каждой команде нужно хотя бы два игрока. Для двух или трёх людей выберите другой режим');
        if(room.devices.some(x=>!x.left&&(!x.ready||!x.connections))) fail('Все устройства должны подключиться и подтвердить готовность');
        room.deck=[...WORDS]; for(let i=room.deck.length-1;i>0;i--) {const j=randomInt(i+1);[room.deck[i],room.deck[j]]=[room.deck[j],room.deck[i]];}
        room.schedule=Array.from({length:room.settings.rounds},()=>ps.map(p=>p.id)).flat();room.rosterSize=ps.length;room.turn=0;room.scores={};room.history=[];room.phase='handoff';break;
      }
      case 'begin': {
        if(room.phase!=='handoff'||this.active(room)?.device!==d.id) fail('Только устройство объясняющего может начать ход');
        room.phase='playing';room.deadline=this.now()+(this.turnMs||room.settings.seconds*1000);this.nextCard(room);break;
      }
      case 'card': {
        const p=this.active(room);
        if(room.phase!=='playing'||p?.device!==d.id) fail('Карточкой управляет объясняющий');
        if(a.card!==room.cardId) fail('Карточка уже обработана');
        if(!['guess','skip','violation'].includes(a.result)) fail('Неизвестный результат');
        let winner;
        if(a.result==='guess'&&room.settings.mode==='ffa') {winner=room.players.find(x=>x.id===a.winner&&!x.left&&x.id!==p.id);if(!winner) fail('Укажите, кто первым угадал');}
        const delta=a.result==='guess'?1:-room.settings.penalty;
        if(room.settings.mode==='pair') this.score(room,'pair',delta);
        if(room.settings.mode==='teams') this.score(room,p.team,delta);
        if(room.settings.mode==='ffa') {this.score(room,p.id,delta);if(winner)this.score(room,winner.id,1);}
        room.history.push({word:room.word,result:a.result,winner:winner?.name,delta});this.nextCard(room);break;
      }
      case 'next': if(room.phase!=='summary') fail('Сначала завершите ход');this.host(room,d);this.advance(room);break;
      case 'recover': {
        this.host(room,d);const p=this.active(room);const owner=room.devices.find(x=>x.id===p?.device);
        if(!['handoff','playing'].includes(room.phase)||!owner||owner.connections||this.now()-owner.disconnectedAt<this.graceMs) fail('Завершить ход можно после 15 секунд отсутствия объясняющего');
        this.endTurn(room,'Ход завершён ведущим: устройство отключилось');break;
      }
      case 'restart': this.host(room,d);if(room.phase!=='finished') fail('Сначала закончите партию');room.phase='lobby';room.players=room.players.filter(p=>!p.left);room.history=[];room.scores={};room.schedule=null;room.turn=null;room.reason=null;this.resetReady(room);break;
      case 'removeDevice': {
        this.host(room,d);const target=room.devices.find(x=>x.id===a.device&&!x.left);
        if(!target||target===d||target.connections) fail('Исключить можно только отключённое устройство');
        if(this.now()-target.disconnectedAt<this.graceMs) fail('Подождите 15 секунд после отключения');
        this.leave(room,target);this.resetReady(room);break;
      }
      case 'leave': this.leave(room,d);break;
      default: fail('Неизвестное действие');
    }
    room.version++;room.touched=this.now();
  }
}
