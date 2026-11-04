import {test} from 'node:test';
import assert from 'node:assert/strict';
import {turnRoles,historyMarkup,rotationEstimate,settingsMarkup} from '../public/turns.js';

const players=[{id:'a',name:'Анна <img>',team:'A'},{id:'b',name:'Борис',team:'B'},{id:'c',name:'Вера',team:'A'}];
test('в каждом режиме явно названы угадывающие, имена экранированы',()=>{
 const state={players,active:'a',guesser:'b',settings:{mode:'rotating'}};
 assert.match(turnRoles(state),/Объясняет Анна &lt;img&gt; → угадывает Борис/);
 assert.doesNotMatch(turnRoles(state),/<img>/);
 state.settings.mode='pair';assert.match(turnRoles(state),/угадывает Борис/);
 state.settings.mode='ffa';assert.match(turnRoles(state),/угадывают все остальные/);
 state.settings.mode='teams';assert.match(turnRoles(state),/команда A: Вера/);
});
test('исправления видны всем, управление только ведущему в итогах',()=>{
 const state={you:'host',host:'host',phase:'summary',history:[{id:'x',word:'<слово>',result:'guess',awarded:false,delta:0}]};
 assert.match(historyMarkup(state),/Зачёт отменён/);assert.match(historyMarkup(state),/Восстановить/);assert.match(historyMarkup(state),/&lt;слово&gt;/);
 state.you='guest';assert.doesNotMatch(historyMarkup(state),/<button/);
 state.you='host';state.phase='playing';assert.doesNotMatch(historyMarkup(state),/<button/);
 state.phase='finished';assert.match(historyMarkup(state),/data-awarded="true"/);
});
test('оценка партии считает все направленные пары и независимые циклы',()=>{
 assert.match(rotationEstimate(4,1,60),/12 ходов.*12 мин.*по 3 раз/);
 assert.match(rotationEstimate(6,2,30),/60 ходов.*30 мин.*по 10 раз/);
 assert.match(rotationEstimate(1,1,60),/хотя бы двух/);
 const markup=settingsMarkup({you:'h',host:'h',settings:{mode:'rotating',cycles:1,rounds:7,seconds:30,penalty:0,difficulty:'basic'},difficulties:[{id:'basic',label:'Базовый',count:661}]});
 assert.match(markup,/Сменные пары/);assert.match(markup,/id="cycles"/);assert.match(markup,/id="rounds"/);
});
