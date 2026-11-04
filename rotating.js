import { randomInt } from 'node:crypto';

function shuffle(items, randomIndex) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1);
    if (!Number.isInteger(j) || j < 0 || j > i) throw new RangeError('Индекс вне диапазона');
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

function orderBlock(pairs, previous) {
  // Candidates are already shuffled. Backtrack when only a reversed pair remains.
  const used = new Set();
  function extend(last) {
    if (used.size === pairs.length) return true;
    for (const pair of pairs) {
      if (used.has(pair) || pair.explainer === last?.explainer) continue;
      if (pairs.length > 2 && pair.explainer === last?.guesser && pair.guesser === last.explainer) continue;
      used.add(pair);
      if (extend(pair)) return true;
      used.delete(pair);
    }
    return false;
  }
  if (!extend(previous)) throw new Error('Не удалось составить порядок пар');
  return [...used];
}

export function createRotatingSchedule(playerIds, cycles = 1, randomIndex = randomInt) {
  if (!Array.isArray(playerIds) || playerIds.length < 2 || playerIds.length > 16) {
    throw new RangeError('Нужно от 2 до 16 игроков');
  }
  const players = [...playerIds];
  if (players.some(id => !(typeof id === 'string' && id.length > 0) && !Number.isSafeInteger(id)) ||
      new Set(players).size !== players.length) {
    throw new TypeError('У каждого игрока должен быть уникальный идентификатор');
  }
  if (!Number.isInteger(cycles) || cycles < 1 || cycles > 10) throw new RangeError('Нужно от 1 до 10 циклов');

  const schedule = [];
  for (let cycle = 0; cycle < cycles; cycle++) {
    shuffle(players, randomIndex);
    const offsets = Array.from({length: players.length - 1}, (_, i) => i + 1);
    for (const offset of shuffle(offsets, randomIndex)) {
      const pairs = players.map((explainer, i) => ({explainer, guesser: players[(i + offset) % players.length]}));
      schedule.push(...orderBlock(shuffle(pairs, randomIndex), schedule.at(-1)));
    }
  }
  return schedule;
}
