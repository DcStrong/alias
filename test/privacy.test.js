import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertNoSecretValue} from '../test-support/privacy.js';

test('Проверка приватности допускает подстроку в метаданных, но обнаруживает полное секретное значение',()=>{
 const state={card:null,lastCard:null,difficulties:[{description:'Слова и выражения для компании'}]};
 assert.doesNotThrow(()=>assertNoSecretValue([state],'выражения'));
 assert.doesNotThrow(()=>assertNoSecretValue([state],'для'));
 assert.throws(()=>assertNoSecretValue([{...state,unexpected:{word:'для'}}],'для'),assert.AssertionError);
 assert.throws(()=>assertNoSecretValue({...state,unexpected:['для']},'для'),assert.AssertionError);
});
