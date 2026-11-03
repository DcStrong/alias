import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WORDS,HARD_WORDS} from '../words.js';
const normalize=word=>word.toLowerCase().replaceAll('ё','е').replace(/\s+/g,' ').trim();

test('Редакционный контракт наборов: объём, словосочетания, чистота и отсутствие дублей',()=>{
 assert.equal(WORDS.length,661,'Базовый набор сохранён целиком');assert.ok(HARD_WORDS.length>=400);
 assert.ok(HARD_WORDS.filter(w=>w.includes(' ')).length>=150);
 for(const entries of [WORDS,HARD_WORDS]){
  assert.equal(new Set(entries.map(normalize)).size,entries.length,'Дубль с учётом регистра, ё/е и пробелов');
  for(const word of entries){assert.equal(word,word.trim());assert.match(word,/^[а-яё]+(?:[ -][а-яё]+)*$/iu);}
 }
 const basic=new Set(WORDS.map(normalize));assert.ok(HARD_WORDS.every(w=>!basic.has(normalize(w))),'Наборы пересекаются');
 assert.ok(WORDS.includes('кот'));assert.ok(WORDS.includes('стул'));assert.ok(HARD_WORDS.includes('беспристрастность'));assert.ok(HARD_WORDS.includes('причинно-следственная связь'));
});
