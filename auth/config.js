import { createAuth } from './auth.js';
import { MemoryAccountStore, createPgStore } from './store.js';

// Вход включается, только если задан AUTH_SECRET. Без DATABASE_URL аккаунты живут в памяти (только для разработки).
export async function authFromEnv(env) {
  if (!env.AUTH_SECRET) { console.log('Вход через аккаунты выключен: нет AUTH_SECRET. Доступна только гостевая игра.'); return null; }
  let store;
  if (env.DATABASE_URL) store = await createPgStore(env.DATABASE_URL);
  else { if (env.NODE_ENV === 'production') console.warn('DATABASE_URL не задан: аккаунты в памяти исчезнут при перезапуске.'); store = new MemoryAccountStore(); }
  const publicOrigin = (env.PUBLIC_ORIGIN || '').replace(/\/$/, '');
  const auth = createAuth({store, secret: env.AUTH_SECRET, publicOrigin, secureCookies: publicOrigin.startsWith('https:') || env.COOKIE_SECURE === 'true',
    discord: {clientId: env.DISCORD_CLIENT_ID, clientSecret: env.DISCORD_CLIENT_SECRET},
    telegram: {botToken: env.TELEGRAM_BOT_TOKEN, botName: env.TELEGRAM_BOT_NAME}});
  console.log(`Вход: Discord ${auth.providers.discord ? 'включён' : 'выключен'}, Telegram ${auth.providers.telegram ? 'включён' : 'выключен'}, хранилище ${env.DATABASE_URL ? 'PostgreSQL' : 'память'}.`);
  return auth;
}
