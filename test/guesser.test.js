import {test} from 'node:test';
import assert from 'node:assert/strict';
import {guesserButtons,createCardSubmitter} from '../public/guesser.js';

test('Имена угадавших доступны одним нажатием, без выбора и HTML-инъекции',()=>{
 const players=[{id:'explainer',name:'Аня'},{id:'boris',name:'Борис'},{id:'vera',name:'Вера <img src=x onerror=1>'},{id:'left',name:'Вышел',left:true}];
 const markup=guesserButtons(players,'explainer');
 assert.doesNotMatch(markup,/<select|<option|<img|aria-pressed/);
 assert.doesNotMatch(markup,/data-winner="explainer"|data-winner="left"/);
 assert.match(markup,/role="group" aria-label="Кто первым угадал\?"/);
 assert.match(markup,/data-winner="boris"/);assert.match(markup,/data-winner="vera"/);
 assert.match(markup,/Вера &lt;img/);assert.equal((markup.match(/<button /g)||[]).length,2);
});

test('Одно имя отправляет captured карточку и угадавшего; повтор в полёте и после перерисовки заблокирован',async()=>{
 let current={type:'card',card:'first'},time=1000,finish;
 const calls=[];
 const submit=createCardSubmitter({current:()=>current,now:()=>time,send:async(type,data)=>{calls.push({type,...data});await new Promise(resolve=>finish=resolve);}});
 const first=submit({type:'card',card:'first',result:'guess',winner:'boris'});
 await submit({type:'card',card:'first',result:'guess',winner:'vera'});
 current={type:'card',card:'second'};
 await submit({type:'card',card:'second',result:'guess',winner:'boris'});
 finish();await first;
 await submit({type:'card',card:'second',result:'guess',winner:'boris'});
 assert.deepEqual(calls,[{type:'card',card:'first',result:'guess',winner:'boris'}]);
 time+=500;
 await submit({type:'card',card:'first',result:'guess',winner:'boris'});
 assert.equal(calls.length,1);
 const next=submit({type:'card',card:'second',result:'guess',winner:'vera'});
 finish();await next;
 assert.deepEqual(calls[1],{type:'card',card:'second',result:'guess',winner:'vera'});
});

test('Позднее имя сразу отправляет awardLast, устаревшая фаза и повтор клавиши/двойного клика не отправляются',async()=>{
 let current={type:'awardLast',card:'last'},time=1000;
 const calls=[];
 const submit=createCardSubmitter({current:()=>current,now:()=>time,send:async(type,data)=>calls.push({type,...data})});
 const intent={type:'awardLast',card:'last',winner:'vera'};
 await submit({...intent,type:'card',result:'guess'});
 await submit(intent,{repeat:true});
 await submit(intent,{detail:2});
 assert.equal(calls.length,0);
 await submit(intent);
 assert.deepEqual(calls,[{type:'awardLast',card:'last',winner:'vera'}]);
 time+=1000;current=null;await submit(intent);
 assert.equal(calls.length,1);
});
