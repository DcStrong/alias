import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash, createHmac} from 'node:crypto';
import {createServer} from '../server.js';
import {createAuth, verifyTelegram, safeReturn, fetchAvatar} from '../auth/auth.js';
import {MemoryAccountStore} from '../auth/store.js';

const SECRET = 'test-secret-'.padEnd(48, 'x'), BOT = '123456:TEST-bot-token', DISCORD_ID = '80351110224678912', TG_ID = '987654321';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

function telegramParams(over = {}, nowS = Math.floor(Date.now() / 1000)) {
  const data = {id: TG_ID, first_name: 'Иван', username: 'ivan_tg', photo_url: 'https://t.me/i/userpic/320/x.jpg', auth_date: String(nowS), ...over};
  const check = Object.keys(data).sort().map(k => `${k}=${data[k]}`).join('\n');
  return {...data, hash: createHmac('sha256', createHash('sha256').update(BOT).digest()).update(check).digest('hex')};
}

// Подделанные Discord и CDN: проверяем, что уходит наружу и что сохраняется.
function fakeFetch(log) {
  return async (url, init = {}) => {
    const u = String(url); log.push({url: u, init});
    const ok = body => new Response(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body), {status: 200, headers: {'content-type': Buffer.isBuffer(body) ? 'image/png' : 'application/json'}});
    if (u.endsWith('/oauth2/token')) { const p = new URLSearchParams(init.body); return p.get('code') === 'good' ? ok({access_token: 'AT-secret', token_type: 'Bearer', scope: 'identify'}) : new Response('{}', {status: 400}); }
    if (u.endsWith('/oauth2/token/revoke')) return ok({});
    if (u.endsWith('/users/@me')) return ok({id: DISCORD_ID, username: 'nelly', global_name: 'Нелли', avatar: 'a'.repeat(32), email: 'leak@example.com', phone: '+70000000000'});
    if (u.startsWith('https://cdn.discordapp.com/') || u.startsWith('https://t.me/')) return ok(PNG);
    return new Response('no', {status: 404});
  };
}

async function setup(t, opts = {}) {
  const log = [], store = new MemoryAccountStore();
  const auth = createAuth({store, secret: SECRET, publicOrigin: 'https://alias.test', discord: {clientId: 'cid', clientSecret: 'csecret'}, telegram: {botToken: BOT, botName: 'alias_bot'}, fetch: fakeFetch(log), ...opts});
  const {server} = createServer({auth});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { auth.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const jar = {};
  const keep = res => { for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v) jar[k] = v; else delete jar[k]; } return res; };
  const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
  const get = async (path, c = cookie()) => keep(await fetch(base + path, {redirect: 'manual', headers: c ? {cookie: c} : {}}));
  const post = async (path, body = {}, headers = {}) => keep(await fetch(base + path, {method: 'POST', redirect: 'manual', headers: {'content-type': 'application/json', cookie: cookie(), ...headers}, body: JSON.stringify(body)}));
  const discordLogin = async (ret = '/') => {
    const start = await get('/auth/discord?return=' + encodeURIComponent(ret));
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    return get(`/auth/discord/callback?code=good&state=${state}`);
  };
  return {log, store, base, jar, get, post, discordLogin};
}

test('Discord: PKCE, state, scope identify; токен отозван и не сохранён; email и телефон не попадают в базу', async t => {
  const {log, store, get, discordLogin, jar} = await setup(t);
  const start = await get('/auth/discord?return=/?room=ABC123');
  const loc = new URL(start.headers.get('location'));
  assert.equal(loc.origin + loc.pathname, 'https://discord.com/oauth2/authorize');
  assert.equal(loc.searchParams.get('scope'), 'identify');
  assert.equal(loc.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(loc.searchParams.get('redirect_uri'), 'https://alias.test/auth/discord/callback');
  const done = await get(`/auth/discord/callback?code=good&state=${loc.searchParams.get('state')}`);
  assert.equal(done.status, 302); assert.equal(done.headers.get('location'), '/?room=ABC123');
  assert.match(jar.alias_session, /^[\w-]{43}$/);
  assert.ok(log.some(x => x.url.endsWith('/oauth2/token/revoke')), 'Токен доступа отозван');
  const dump = JSON.stringify([...store.accounts.values()], (k, v) => (v?.type === 'Buffer' ? '[bytes]' : v)) + JSON.stringify([...store.sessions.entries()]);
  for (const secret of ['AT-secret', DISCORD_ID, 'leak@example.com', '+70000000000', jar.alias_session]) assert.ok(!dump.includes(secret), `В хранилище не должно быть ${secret}`);
  const me = await (await get('/api/me')).json();
  assert.deepEqual({...me.account, id: undefined}, {id: undefined, provider: 'discord', displayName: 'Нелли', username: 'nelly', avatar: `/avatars/${me.account.id}`});
  const avatar = await get(me.account.avatar);
  assert.equal(avatar.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await avatar.arrayBuffer()), PNG);
  await discordLogin();
  assert.equal(store.accounts.size, 1, 'Повторный вход находит тот же аккаунт');
});

test('Discord: чужой или отсутствующий state и повтор колбэка отклоняются', async t => {
  const {get, jar} = await setup(t);
  await get('/auth/discord');
  assert.equal((await get('/auth/discord/callback?code=good&state=forged')).status, 400);
  delete jar.alias_flow;
  assert.equal((await get('/auth/discord/callback?code=good&state=x')).status, 400);
  assert.equal(jar.alias_session, undefined);
});

test('Telegram: подпись, свежесть, повтор и лишние поля', async t => {
  const {get, store, jar} = await setup(t);
  const q = p => '/auth/telegram/callback?' + new URLSearchParams(p);
  assert.equal((await get(q({...telegramParams(), first_name: 'Подмена'}))).status, 400, 'Изменённые данные');
  assert.equal((await get(q(telegramParams({}, Math.floor(Date.now() / 1000) - 3600)))).status, 400, 'Устаревший auth_date');
  const good = telegramParams();
  const res = await get(q({...good, phone_number: '+70000000000'}));
  assert.equal(res.status, 302);
  assert.ok(jar.alias_session);
  assert.equal((await get(q(good))).status, 400, 'Повтор той же подписи');
  const dump = JSON.stringify([...store.accounts.values()]);
  assert.ok(!dump.includes(TG_ID) && !dump.includes('+70000000000'));
  const [account] = store.accounts.values();
  assert.equal(account.displayName, 'Иван'); assert.equal(account.username, 'ivan_tg');
});

test('verifyTelegram и safeReturn отбрасывают подделки и внешние адреса', () => {
  const now = Date.now();
  assert.ok(verifyTelegram(telegramParams({}, Math.floor(now / 1000)), BOT, now));
  assert.ok(!verifyTelegram(telegramParams({}, Math.floor(now / 1000)), 'другой:токен', now));
  assert.ok(!verifyTelegram({...telegramParams(), hash: 'zz'}, BOT, now));
  for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'javascript:alert(1)', '/<script>', null]) assert.equal(safeReturn(bad), '/');
  assert.equal(safeReturn('/?room=ABC123'), '/?room=ABC123');
});

test('аватар скачивается только с разрешённых https-хостов и только как картинка', async () => {
  const seen = [];
  const f = async url => { seen.push(String(url)); return String(url).includes('html') ? new Response('<script>', {status: 200}) : new Response(PNG, {status: 200}); };
  assert.equal(await fetchAvatar('https://evil.com/a.png', f), null);
  assert.equal(await fetchAvatar('http://cdn.discordapp.com/a.png', f), null);
  assert.equal(await fetchAvatar('https://cdn.discordapp.com/html.png', f), null, 'Не картинка');
  assert.deepEqual((await fetchAvatar('https://cdn.discordapp.com/a.png', f)).type, 'image/png');
  const redirect = async url => String(url).includes('evil') ? new Response(PNG) : new Response(null, {status: 302, headers: {location: 'https://evil.com/x.png'}});
  assert.equal(await fetchAvatar('https://t.me/i/userpic/1.jpg', redirect), null, 'Редирект на чужой хост');
  assert.ok(!seen.some(u => u.includes('evil')));
});

test('выход отзывает сессию на сервере, удаление стирает аккаунт и аватар', async t => {
  const {get, post, discordLogin, jar, store} = await setup(t);
  await discordLogin();
  const stolen = jar.alias_session;
  const {account} = await (await get('/api/me')).json();
  assert.equal((await post('/auth/logout', {}, {origin: 'https://evil.com'})).status, 403, 'Чужой источник');
  await post('/auth/logout');
  assert.equal((await (await get('/api/me', `alias_session=${stolen}`)).json()).account, null, 'Старый токен больше не работает');
  await discordLogin();
  await post('/auth/delete');
  assert.equal(store.accounts.size, 0); assert.equal(store.sessions.size, 0);
  assert.equal((await get(`/avatars/${account.id}`)).status, 404);
});

test('частота запросов на /auth ограничена', async t => {
  const {get} = await setup(t, {rateLimit: 3});
  for (let i = 0; i < 3; i++) assert.notEqual((await get('/auth/discord')).status, 429);
  assert.equal((await get('/auth/discord')).status, 429);
});

test('игрок с аккаунтом: ник, @username и аватар в комнате, без внутреннего id; один аккаунт — один игрок', async t => {
  const {get, post, discordLogin} = await setup(t);
  await discordLogin();
  const room = await (await post('/api/rooms')).json();
  const act = async (type, data = {}) => { const {version} = await (await post(`/api/rooms/${room.code}/join`)).json(); return post(`/api/rooms/${room.code}/action`, {type, version, ...data}); };
  const added = await (await act('addPlayer', {asAccount: true})).json();
  const p = added.players[0];
  assert.equal(p.name, 'Нелли'); assert.equal(p.username, 'nelly'); assert.match(p.avatar, /^\/avatars\/[0-9a-f-]{36}$/); assert.equal(p.linked, true);
  assert.equal(p.account, undefined);
  assert.equal((await act('addPlayer', {asAccount: true, name: 'Второй'})).status, 400);
  const guest = await (await act('addPlayer', {name: 'Гость Петя'})).json();
  assert.equal(guest.players[1].linked, false);
  assert.ok(!JSON.stringify(guest).includes(DISCORD_ID));
});

test('без AUTH_SECRET вход выключен, гостевая игра работает', async t => {
  const {server} = createServer();
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(base + '/api/me')).json(), {account: null, providers: {discord: false, telegram: false}});
  assert.equal((await fetch(base + '/api/rooms', {method: 'POST', headers: {'content-type': 'application/json'}, body: '{}'})).status, 201);
  assert.throws(() => createAuth({store: new MemoryAccountStore(), secret: 'short'}));
});
