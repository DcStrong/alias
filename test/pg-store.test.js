import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, randomUUID} from 'node:crypto';
import {createPgStore, migrate} from '../auth/store.js';

// Запуск: ALIAS_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/alias_test npm test
// Тест создаёт отдельную базу с ролями как в deploy/postgres-roles.sql и удаляет её в конце.
const admin = process.env.ALIAS_TEST_DATABASE_URL;

test('PostgreSQL: роли, миграции, аккаунты, сессии, каскадное удаление', {skip: !admin && 'нет ALIAS_TEST_DATABASE_URL'}, async t => {
  const {default: pg} = await import('pg');
  const db = 'alias_t_' + randomBytes(4).toString('hex'), suffix = db.slice(8), pass = randomBytes(12).toString('hex');
  const root = new pg.Client({connectionString: admin}); await root.connect();
  const url = (user, database = db) => { const u = new URL(admin); u.username = user; u.password = pass; u.pathname = '/' + database; return u.href; };
  const migrator = `alias_migrator_${suffix}`, app = `alias_app_${suffix}`;
  await root.query(`CREATE ROLE ${migrator} LOGIN PASSWORD '${pass}'`);
  await root.query(`CREATE ROLE ${app} LOGIN PASSWORD '${pass}'`);
  await root.query(`CREATE DATABASE ${db} OWNER ${migrator}`);
  t.after(async () => {
    await store?.close();
    await root.query(`DROP DATABASE IF EXISTS ${db} WITH (FORCE)`);
    await root.query(`DROP ROLE IF EXISTS ${app}`); await root.query(`DROP ROLE IF EXISTS ${migrator}`);
    await root.end();
  });
  const rootDb = new pg.Client({connectionString: (() => { const u = new URL(admin); u.pathname = '/' + db; return u.href; })()}); await rootDb.connect();
  for (const sql of [`REVOKE ALL ON DATABASE ${db} FROM PUBLIC`, `GRANT CONNECT ON DATABASE ${db} TO ${app}`, 'REVOKE CREATE ON SCHEMA public FROM PUBLIC', `ALTER SCHEMA public OWNER TO ${migrator}`, `GRANT USAGE ON SCHEMA public TO ${app}`,
    `ALTER DEFAULT PRIVILEGES FOR ROLE ${migrator} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${app}`]) await rootDb.query(sql);
  await rootDb.end();

  assert.deepEqual(await migrate(url(migrator)), ['001_accounts.sql']);
  assert.deepEqual(await migrate(url(migrator)), [], 'Повторный запуск ничего не меняет');

  var store = await createPgStore(url(app));
  for (const ddl of ['DROP TABLE sessions', 'CREATE TABLE evil (x int)', 'ALTER TABLE accounts ADD COLUMN phone text', 'TRUNCATE accounts'])
    await assert.rejects(store.pool.query(ddl), /permission denied|must be owner/, `Роль приложения не может: ${ddl}`);

  const key = 'a'.repeat(64), avatar = Buffer.from('89504e470d0a1a0a', 'hex');
  const a = await store.upsertAccount({provider: 'telegram', providerKey: key, displayName: 'Иван', username: 'ivan', avatar, avatarType: 'image/png'});
  const again = await store.upsertAccount({provider: 'telegram', providerKey: key, displayName: 'Иван Новый', username: null});
  assert.equal(again.id, a.id); assert.equal(again.displayName, 'Иван Новый'); assert.equal(again.hasAvatar, false);
  await assert.rejects(store.upsertAccount({provider: 'vk', providerKey: key, displayName: 'x'}), /check/i, 'Неизвестный провайдер');
  await assert.rejects(store.upsertAccount({provider: 'discord', providerKey: 'short', displayName: 'x'}), /check/i);
  const injection = await store.upsertAccount({provider: 'discord', providerKey: 'b'.repeat(64), displayName: "'); DROP TABLE accounts; --"});
  assert.equal((await store.getAccount(injection.id)).displayName, "'); DROP TABLE accounts; --");

  const hash = randomBytes(32);
  await store.createSession(hash, a.id, new Date(Date.now() + 60000));
  assert.equal((await store.getSession(hash)).accountId, a.id);
  const old = randomBytes(32); await store.createSession(old, a.id, new Date(Date.now() - 1000));
  assert.equal(await store.getSession(old), null, 'Просроченная сессия не возвращается');
  await store.deleteExpiredSessions();
  await store.deleteAccount(a.id);
  assert.equal(await store.getSession(hash), null, 'Сессии удаляются вместе с аккаунтом');
  assert.equal(await store.getAccount(a.id), null);
  assert.equal(await store.getAccount(randomUUID()), null);
});
