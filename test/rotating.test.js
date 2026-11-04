import test from 'node:test';
import assert from 'node:assert/strict';
import { createRotatingSchedule } from '../rotating.js';

function seeded(seed) {
  return limit => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor(seed / 2 ** 32 * limit);
  };
}

test('в каждом блоке обе роли сбалансированы, в каждом цикле встречаются все направленные пары', () => {
  for (let n = 2; n <= 16; n++) {
    const ids = Object.freeze(Array.from({length: n}, (_, i) => 'p' + i));
    const players = new Set(ids);
    const expectedPairs = new Set(ids.flatMap(a => ids.filter(b => a !== b).map(b => a + '>' + b)));
    const cycleSize = n * (n - 1);
    for (const randomIndex of [seeded(0), seeded(33), seeded(658), () => 0, limit => limit - 1]) {
      const turns = createRotatingSchedule(ids, 10, randomIndex);
      assert.equal(turns.length, cycleSize * 10);
      for (let i = 0; i < turns.length; i += n) {
        const block = turns.slice(i, i + n);
        assert.deepEqual(new Set(block.map(pair => pair.explainer)), players);
        assert.deepEqual(new Set(block.map(pair => pair.guesser)), players);
      }
      for (let i = 0; i < turns.length; i += cycleSize) {
        const cycle = turns.slice(i, i + cycleSize);
        assert.deepEqual(new Set(cycle.map(pair => pair.explainer + '>' + pair.guesser)), expectedPairs);
      }
      for (let i = 1; i < turns.length; i++) {
        const previous = turns[i - 1], next = turns[i];
        assert.notEqual(previous.explainer, next.explainer);
        const reversed = next.explainer === previous.guesser && next.guesser === previous.explainer;
        assert.equal(reversed, n === 2);
      }
    }
  }
});

test('одинаковый источник случайности воспроизводит расписание, другой меняет его', () => {
  const ids = Object.freeze([1, 2, 3, 4, 5]);
  const schedule = createRotatingSchedule(ids, undefined, seeded(41));
  assert.equal(schedule.length, 20);
  assert.deepEqual(schedule, createRotatingSchedule(ids, 1, seeded(41)));
  assert.notDeepEqual(schedule, createRotatingSchedule(ids, 1, seeded(42)));
  assert.equal(createRotatingSchedule(ids).length, 20);
});

test('отклоняет неверный состав, число циклов и результаты генератора', () => {
  for (const ids of [null, [], [1], Array.from({length: 17}, (_, i) => i), [1, 1], [null, 2], Array(3)]) {
    assert.throws(() => createRotatingSchedule(ids));
  }
  for (const cycles of [0, 11, 1.5, '1', NaN]) {
    assert.throws(() => createRotatingSchedule([1, 2], cycles), RangeError);
  }
  for (const index of [-1, 2, 0.5, undefined]) {
    assert.throws(() => createRotatingSchedule([1, 2], 1, () => index), RangeError);
  }
});
