import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guesserButtons} from '../public/guesser.js';

test('Кнопки угадавшего: допустимые игроки, выбранное имя, без списка и без HTML-инъекции',()=>{
 const players=[{id:'explainer',name:'Аня'},{id:'boris',name:'Борис'},{id:'vera',name:'Вера <img src=x onerror=1>'},{id:'left',name:'Вышел',left:true}];
 const markup=guesserButtons(players,'explainer','vera');assert.doesNotMatch(markup,/<select|<option|<img/);assert.doesNotMatch(markup,/data-winner="explainer"|data-winner="left"/);
 assert.match(markup,/role="group" aria-label="Кто первым угадал\?"/);assert.match(markup,/data-winner="vera" aria-pressed="true"/);assert.match(markup,/data-winner="boris" aria-pressed="false"/);assert.match(markup,/Вера &lt;img/);assert.equal((markup.match(/<button /g)||[]).length,2);
 const changed=guesserButtons(players,'explainer','boris');assert.match(changed,/data-winner="boris" aria-pressed="true"/);assert.match(changed,/data-winner="vera" aria-pressed="false"/);
 const newCard=guesserButtons(players,'explainer','');assert.doesNotMatch(newCard,/aria-pressed="true"/);
});
