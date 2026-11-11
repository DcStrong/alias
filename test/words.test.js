import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {WORDS,HARD_WORDS,MEDIUM_WORDS} from '../words.js';
const normalize=word=>word.toLowerCase().replaceAll('ё','е').replace(/\s+/g,' ').trim();

test('Редакционный контракт наборов: объём, словосочетания, чистота и отсутствие дублей',()=>{
 assert.equal(WORDS.length,811,'Базовый набор расширен до 811 карточек');assert.equal(HARD_WORDS.length,666);assert.equal(MEDIUM_WORDS.length,539);
 assert.ok(HARD_WORDS.filter(w=>w.includes(' ')).length>=150);
 for(const entries of [WORDS,HARD_WORDS]){
  assert.equal(new Set(entries.map(normalize)).size,entries.length,'Дубль с учётом регистра, ё/е и пробелов');
  for(const word of entries){assert.equal(word,word.trim());assert.match(word,/^[а-яё]+(?:[ -][а-яё]+)*$/iu);}
 }
 const basic=new Set(WORDS.map(normalize));assert.ok(HARD_WORDS.every(w=>!basic.has(normalize(w))),'Наборы пересекаются');
 assert.ok(WORDS.includes('кот'));assert.ok(WORDS.includes('стул'));assert.ok(HARD_WORDS.includes('беспристрастность'));assert.ok(HARD_WORDS.includes('причинно-следственная связь'));
});


test('Средний набор самостоятелен, содержит практичные выражения и сохраняет прежние колоды',()=>{
 assert.equal(createHash('sha256').update(JSON.stringify(WORDS)).digest('hex'),'ff33090e8130b65b34e7c3ee6a806a2ad0d336df368368b832c7f6af6ec7d666');
 assert.equal(createHash('sha256').update(JSON.stringify(HARD_WORDS)).digest('hex'),'b92472a3399374fc16cc0eea0b1fba6ce0b0bb40d94f249121924fd81104b7ab');
 assert.ok(MEDIUM_WORDS.length>=300);
 assert.ok(MEDIUM_WORDS.filter(w=>w.includes(' ')).length>=100);
 const existing=new Set([...WORDS,...HARD_WORDS].map(normalize));
 assert.equal(new Set(MEDIUM_WORDS.map(normalize)).size,MEDIUM_WORDS.length);
 for(const word of MEDIUM_WORDS){assert.equal(word,word.trim());assert.match(word,/^[а-яё]+(?:[ -][а-яё]+)*$/iu);assert.ok(!existing.has(normalize(word)),word);}
 assert.ok(MEDIUM_WORDS.includes('собеседование'));assert.ok(MEDIUM_WORDS.includes('испытательный срок'));
});
