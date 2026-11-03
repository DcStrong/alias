import assert from 'node:assert/strict';

export function assertNoSecretValue(payload, secret) {
 if(typeof payload==='string')assert.notEqual(payload,secret,'Секретное слово раскрыто');
 else if(payload&&typeof payload==='object'){
  for(const value of Object.values(payload))assertNoSecretValue(value,secret);
 }
}
