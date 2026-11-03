import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {WORDS,HARD_WORDS,MEDIUM_WORDS} from '../words.js';
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


test('Средний набор самостоятелен, содержит практичные выражения и сохраняет прежние колоды',()=>{
 assert.equal(createHash('sha256').update(JSON.stringify(WORDS)).digest('hex'),'5b1345a7a156ab275467c282173c3e1d8029b1027872562d8499c1a1ddbc1f6a');
 assert.equal(createHash('sha256').update(JSON.stringify(HARD_WORDS)).digest('hex'),'e348e1b163d3cd0bb792f4fc10bb535e519e8ec89bb8522550aa8bb6852ba82d');
 assert.ok(MEDIUM_WORDS.length>=300);
 assert.ok(MEDIUM_WORDS.filter(w=>w.includes(' ')).length>=100);
 const existing=new Set([...WORDS,...HARD_WORDS].map(normalize));
 assert.equal(new Set(MEDIUM_WORDS.map(normalize)).size,MEDIUM_WORDS.length);
 for(const word of MEDIUM_WORDS){assert.equal(word,word.trim());assert.match(word,/^[а-яё]+(?:[ -][а-яё]+)*$/iu);assert.ok(!existing.has(normalize(word)),word);}
 assert.ok(MEDIUM_WORDS.includes('собеседование'));assert.ok(MEDIUM_WORDS.includes('испытательный срок'));
});
