// Вход через Discord и Telegram. Гостю ничего не нужно: он вводит имя в комнате, как раньше.
// Мы не запрашиваем и не храним телефон, почту и токены провайдеров.
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { loginPage } from './pages.js';

const DAY = 86400000, SESSION_MS = 30 * DAY, EXTEND_BELOW_MS = 15 * DAY, FLOW_MS = 10 * 60000, TELEGRAM_MAX_AGE_S = 300;
const SESSION_COOKIE = 'alias_session', FLOW_COOKIE = 'alias_flow';
const AVATAR_MAX = 131072, AVATAR_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const AVATAR_HOSTS = [/^cdn\.discordapp\.com$/, /^t\.me$/, /^([\w-]+\.)*telegram\.org$/, /^([\w-]+\.)*telegram-cdn\.org$/];

const b64url = buf => Buffer.from(buf).toString('base64url');
const sha256 = s => createHash('sha256').update(s).digest();
const safeEqual = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };
const clean = (s, max = 64) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
export const safeReturn = r => typeof r === 'string' && /^\/(?![\/\\])[\w\-.\/?=&%]{0,200}$/.test(r) ? r : '/';

export function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim()).filter(Boolean).map(c => { const i = c.indexOf('='); return [c.slice(0, i), c.slice(i + 1)]; }));
}

// Проверка подписи Telegram Login Widget: https://core.telegram.org/widgets/login#checking-authorization
export function verifyTelegram(params, botToken, nowMs) {
  const {hash, ...data} = params;
  if (!hash || !/^[a-f0-9]{64}$/.test(hash) || !/^\d{1,20}$/.test(String(data.id || '')) || !/^\d{1,12}$/.test(String(data.auth_date || ''))) return false;
  const check = Object.keys(data).sort().map(k => `${k}=${data[k]}`).join('\n');
  const expected = createHmac('sha256', sha256(botToken)).update(check).digest('hex');
  if (!safeEqual(expected, hash)) return false;
  const age = nowMs / 1000 - Number(data.auth_date);
  return age <= TELEGRAM_MAX_AGE_S && age >= -60;
}

function sniffImage(buf) {
  const hex = buf.subarray(0, 12).toString('hex');
  if (hex.startsWith('89504e47')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('47494638')) return 'image/gif';
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') return 'image/webp';
  return null;
}

// Аватар скачивает сервер: браузеры игроков не обращаются к Discord/Telegram. Только разрешённые хосты, https, размер и тип.
export async function fetchAvatar(url, fetchImpl) {
  try {
    for (let hop = 0; hop < 3; hop++) {
      const u = new URL(url);
      if (u.protocol !== 'https:' || u.username || u.port || !AVATAR_HOSTS.some(h => h.test(u.hostname))) return null;
      const res = await fetchImpl(u, {redirect: 'manual', signal: AbortSignal.timeout(5000)});
      if ([301, 302, 303, 307, 308].includes(res.status)) { url = new URL(res.headers.get('location'), u).href; continue; }
      if (!res.ok || Number(res.headers.get('content-length') || 0) > AVATAR_MAX) return null;
      const chunks = []; let size = 0;
      for await (const chunk of res.body) { size += chunk.length; if (size > AVATAR_MAX) return null; chunks.push(chunk); }
      const data = Buffer.concat(chunks), type = sniffImage(data);
      return type && AVATAR_TYPES.includes(type) ? {data, type} : null;
    }
  } catch { /* аватар необязателен */ }
  return null;
}

export function createAuth({store, secret, publicOrigin = '', discord = {}, telegram = {}, fetch: fetchImpl = globalThis.fetch, now = Date.now, secureCookies = false, rateLimit = 30}) {
  if (!secret || secret.length < 32) throw new Error('AUTH_SECRET должен быть не короче 32 символов');
  const discordOn = !!(discord.clientId && discord.clientSecret && publicOrigin), telegramOn = !!(telegram.botToken && telegram.botName);
  const redirectUri = `${publicOrigin}/auth/discord/callback`;
  const secure = secureCookies ? '; Secure' : '';
  const providerKey = (provider, id) => createHmac('sha256', secret).update(`${provider}:${id}`).digest('hex');
  const sign = payload => { const body = b64url(JSON.stringify(payload)); return `${body}.${b64url(createHmac('sha256', secret).update(`flow:${body}`).digest())}`; };
  const unsign = value => {
    const [body, mac] = String(value || '').split('.');
    if (!body || !mac || !safeEqual(mac, b64url(createHmac('sha256', secret).update(`flow:${body}`).digest()))) return null;
    try { const p = JSON.parse(Buffer.from(body, 'base64url')); return p.exp > now() ? p : null; } catch { return null; }
  };
  const usedTelegram = new Map(), hits = new Map();

  const setCookie = (res, value) => res.appendHeader('Set-Cookie', value);
  const redirect = (res, location) => { res.writeHead(302, {Location: location, 'Cache-Control': 'no-store'}); res.end(); };
  const fail = (res, status, message) => { res.writeHead(status, {'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store'}); res.end(message); };
  const clientIp = req => { const remote = req.socket.remoteAddress || ''; return /^(::ffff:)?127\.0\.0\.1$|^::1$/.test(remote) && req.headers['x-forwarded-for'] ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : remote; };
  const limited = req => {
    const ip = clientIp(req), t = now(), entry = hits.get(ip);
    if (!entry || t - entry.start > 60000) { hits.set(ip, {start: t, count: 1}); if (hits.size > 10000) hits.clear(); return false; }
    return ++entry.count > rateLimit;
  };

  async function startSession(res, account) {
    const token = randomBytes(32);
    await store.createSession(sha256(token), account.id, new Date(now() + SESSION_MS));
    setCookie(res, `${SESSION_COOKIE}=${b64url(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
  }
  async function finishLogin(res, provider, id, profile, ret) {
    const avatar = profile.avatarUrl ? await fetchAvatar(profile.avatarUrl, fetchImpl) : null;
    const account = await store.upsertAccount({provider, providerKey: providerKey(provider, id), displayName: clean(profile.displayName) || 'Игрок', username: clean(profile.username, 64) || null, avatar: avatar?.data, avatarType: avatar?.type});
    await startSession(res, account);
    setCookie(res, `${FLOW_COOKIE}=; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=0${secure}`);
    redirect(res, safeReturn(ret));
  }

  // Аккаунт текущего браузера или null. Сессию продлевает при использовании.
  async function account(req, res) {
    const raw = cookies(req)[SESSION_COOKIE];
    if (!raw || !/^[\w-]{43}$/.test(raw)) return null;
    const hash = sha256(Buffer.from(raw, 'base64url')), session = await store.getSession(hash);
    if (!session) return null;
    if (res && session.expiresAt.getTime() - now() < EXTEND_BELOW_MS) {
      await store.extendSession(hash, new Date(now() + SESSION_MS));
      setCookie(res, `${SESSION_COOKIE}=${raw}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
    }
    return store.getAccount(session.accountId);
  }
  const publicView = a => a && {id: a.id, provider: a.provider, displayName: a.displayName, username: a.username, avatar: a.hasAvatar ? `/avatars/${a.id}` : null};

  // Возвращает true, если запрос обработан.
  async function handle(req, res, url) {
    const path = url.pathname;
    if (req.method === 'GET' && path === '/login') {
      const me = publicView(await account(req, res)), ret = safeReturn(url.searchParams.get('return'));
      // Запоминаем, куда вернуть игрока после виджета Telegram.
      if (!me && telegramOn) setCookie(res, `${FLOW_COOKIE}=${sign({ret, exp: now() + FLOW_MS})}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=${FLOW_MS / 1000}${secure}`);
      res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' https://telegram.org; frame-src https://oauth.telegram.org; img-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"});
      res.end(loginPage({me, discordOn, telegramOn, botName: telegram.botName, ret, origin: publicOrigin}));
      return true;
    }
    const avatarMatch = path.match(/^\/avatars\/([0-9a-f-]{36})$/);
    if (req.method === 'GET' && avatarMatch) {
      const avatar = await store.getAvatar(avatarMatch[1]);
      if (!avatar) { fail(res, 404, 'Не найдено'); return true; }
      res.writeHead(200, {'Content-Type': avatar.type, 'Cache-Control': 'private, max-age=86400', 'Content-Security-Policy': "default-src 'none'; sandbox"});
      res.end(avatar.data); return true;
    }
    if (req.method === 'GET' && path === '/api/me') {
      const me = publicView(await account(req, res));
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'});
      res.end(JSON.stringify({account: me, providers: {discord: discordOn, telegram: telegramOn}})); return true;
    }
    if (!path.startsWith('/auth/')) return false;
    if (limited(req)) { fail(res, 429, 'Слишком много попыток входа. Подождите минуту'); return true; }

    if (req.method === 'GET' && path === '/auth/discord') {
      if (!discordOn) { fail(res, 404, 'Вход через Discord не настроен'); return true; }
      const state = b64url(randomBytes(24)), verifier = b64url(randomBytes(48));
      setCookie(res, `${FLOW_COOKIE}=${sign({state, verifier, ret: safeReturn(url.searchParams.get('return')), exp: now() + FLOW_MS})}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=${FLOW_MS / 1000}${secure}`);
      const q = new URLSearchParams({response_type: 'code', client_id: discord.clientId, scope: 'identify', redirect_uri: redirectUri, state, code_challenge: b64url(sha256(verifier)), code_challenge_method: 'S256', prompt: 'none'});
      redirect(res, `https://discord.com/oauth2/authorize?${q}`); return true;
    }
    if (req.method === 'GET' && path === '/auth/discord/callback') {
      if (!discordOn) { fail(res, 404, 'Вход через Discord не настроен'); return true; }
      const flow = unsign(cookies(req)[FLOW_COOKIE]), state = url.searchParams.get('state'), code = url.searchParams.get('code');
      if (!flow || !state || !safeEqual(flow.state, state)) { fail(res, 400, 'Сессия входа устарела. Попробуйте ещё раз'); return true; }
      if (!code || code.length > 200) { redirect(res, '/login'); return true; }
      try {
        const tokenRes = await fetchImpl('https://discord.com/api/v10/oauth2/token', {method: 'POST', signal: AbortSignal.timeout(8000), headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body: new URLSearchParams({grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: flow.verifier, client_id: discord.clientId, client_secret: discord.clientSecret})});
        if (!tokenRes.ok) throw new Error('token');
        const {access_token: accessToken, scope} = await tokenRes.json();
        if (!accessToken || String(scope).split(' ').some(s => s !== 'identify')) throw new Error('scope');
        const userRes = await fetchImpl('https://discord.com/api/v10/users/@me', {headers: {Authorization: `Bearer ${accessToken}`}, signal: AbortSignal.timeout(8000)});
        // Токен доступа больше не нужен: отзываем его и нигде не сохраняем.
        fetchImpl('https://discord.com/api/v10/oauth2/token/revoke', {method: 'POST', signal: AbortSignal.timeout(8000), headers: {'Content-Type': 'application/x-www-form-urlencoded'},
          body: new URLSearchParams({token: accessToken, token_type_hint: 'access_token', client_id: discord.clientId, client_secret: discord.clientSecret})}).catch(() => {});
        if (!userRes.ok) throw new Error('user');
        const user = await userRes.json();
        if (!/^\d{1,20}$/.test(String(user.id))) throw new Error('id');
        const avatarUrl = /^(a_)?[0-9a-f]{32}$/.test(user.avatar || '') ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=128` : null;
        await finishLogin(res, 'discord', user.id, {displayName: user.global_name || user.username, username: user.username, avatarUrl}, flow.ret);
      } catch { fail(res, 502, 'Discord не ответил. Попробуйте ещё раз позже'); }
      return true;
    }
    if (req.method === 'GET' && path === '/auth/telegram/callback') {
      if (!telegramOn) { fail(res, 404, 'Вход через Telegram не настроен'); return true; }
      const allowed = ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash'];
      const params = Object.fromEntries([...url.searchParams].filter(([k]) => allowed.includes(k)));
      if (!verifyTelegram(params, telegram.botToken, now())) { fail(res, 400, 'Подпись Telegram не прошла проверку. Попробуйте войти ещё раз'); return true; }
      for (const [h, exp] of usedTelegram) if (exp < now()) usedTelegram.delete(h);
      if (usedTelegram.has(params.hash)) { fail(res, 400, 'Эта ссылка входа уже использована'); return true; }
      usedTelegram.set(params.hash, now() + 2 * TELEGRAM_MAX_AGE_S * 1000);
      const flow = unsign(cookies(req)[FLOW_COOKIE]);
      await finishLogin(res, 'telegram', params.id, {displayName: [params.first_name, params.last_name].filter(Boolean).join(' '), username: params.username, avatarUrl: params.photo_url}, flow?.ret);
      return true;
    }
    if (req.method === 'POST' && (path === '/auth/logout' || path === '/auth/delete')) {
      const raw = cookies(req)[SESSION_COOKIE];
      if (path === '/auth/delete') { const me = await account(req); if (me) await store.deleteAccount(me.id); }
      else if (raw && /^[\w-]{43}$/.test(raw)) await store.deleteSession(sha256(Buffer.from(raw, 'base64url')));
      setCookie(res, `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
      res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store'}); res.end('{"ok":true}'); return true;
    }
    fail(res, 404, 'Не найдено'); return true;
  }

  const cleanup = setInterval(() => store.deleteExpiredSessions().catch(() => {}), 3600000); cleanup.unref();
  return {handle, account, publicView, providers: {discord: discordOn, telegram: telegramOn}, close: () => clearInterval(cleanup)};
}
