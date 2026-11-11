// Хранилище аккаунтов и сессий. Один интерфейс для памяти (разработка, тесты) и PostgreSQL (прод).
//
// upsertAccount({provider, providerKey, displayName, username, avatar, avatarType}) -> account
// getAccount(id) -> account | null
// getAvatar(id) -> {data: Buffer, type} | null
// deleteAccount(id)
// createSession(tokenHash: Buffer, accountId, expiresAt: Date)
// getSession(tokenHash) -> {accountId, expiresAt: Date} | null   (просроченные не возвращаются)
// extendSession(tokenHash, expiresAt)
// deleteSession(tokenHash)
// deleteExpiredSessions()
// close()
import { randomUUID } from 'node:crypto';

const publicAccount = a => a && ({id: a.id, provider: a.provider, displayName: a.displayName, username: a.username ?? null, hasAvatar: !!a.avatar});

export class MemoryAccountStore {
  constructor({now = Date.now} = {}) { this.now = now; this.accounts = new Map(); this.sessions = new Map(); }
  async upsertAccount({provider, providerKey, displayName, username, avatar, avatarType}) {
    let a = [...this.accounts.values()].find(x => x.provider === provider && x.providerKey === providerKey);
    if (!a) { a = {id: randomUUID(), provider, providerKey, createdAt: new Date(this.now())}; this.accounts.set(a.id, a); }
    Object.assign(a, {displayName, username: username ?? null, avatar: avatar ?? null, avatarType: avatar ? avatarType : null, lastLoginAt: new Date(this.now())});
    return publicAccount(a);
  }
  async getAccount(id) { return publicAccount(this.accounts.get(id)) ?? null; }
  async getAvatar(id) { const a = this.accounts.get(id); return a?.avatar ? {data: a.avatar, type: a.avatarType} : null; }
  async deleteAccount(id) {
    this.accounts.delete(id);
    for (const [k, s] of this.sessions) if (s.accountId === id) this.sessions.delete(k);
  }
  async createSession(tokenHash, accountId, expiresAt) { this.sessions.set(tokenHash.toString('hex'), {accountId, expiresAt}); }
  async getSession(tokenHash) {
    const s = this.sessions.get(tokenHash.toString('hex'));
    return s && s.expiresAt.getTime() > this.now() && this.accounts.has(s.accountId) ? {...s} : null;
  }
  async extendSession(tokenHash, expiresAt) { const s = this.sessions.get(tokenHash.toString('hex')); if (s) s.expiresAt = expiresAt; }
  async deleteSession(tokenHash) { this.sessions.delete(tokenHash.toString('hex')); }
  async deleteExpiredSessions() { for (const [k, s] of this.sessions) if (s.expiresAt.getTime() <= this.now()) this.sessions.delete(k); }
  async close() {}
}

// Драйвер pg загружается только когда задан DATABASE_URL: локальная игра работает без npm install.
export async function createPgStore(connectionString) {
  const {default: pg} = await import('pg');
  const pool = new pg.Pool({connectionString, max: 5, idleTimeoutMillis: 30000, statement_timeout: 5000, application_name: 'alias'});
  const row = r => r && ({id: r.id, provider: r.provider, displayName: r.display_name, username: r.username, hasAvatar: r.has_avatar});
  const cols = 'id, provider, display_name, username, avatar IS NOT NULL AS has_avatar';
  return {
    pool,
    async upsertAccount({provider, providerKey, displayName, username, avatar, avatarType}) {
      const {rows} = await pool.query(
        `INSERT INTO accounts (id, provider, provider_key, display_name, username, avatar, avatar_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (provider, provider_key) DO UPDATE SET display_name = EXCLUDED.display_name, username = EXCLUDED.username,
           avatar = EXCLUDED.avatar, avatar_type = EXCLUDED.avatar_type, last_login_at = now()
         RETURNING ${cols}`,
        [randomUUID(), provider, providerKey, displayName, username ?? null, avatar ?? null, avatar ? avatarType : null]);
      return row(rows[0]);
    },
    async getAccount(id) { const {rows} = await pool.query(`SELECT ${cols} FROM accounts WHERE id = $1`, [id]); return row(rows[0]) ?? null; },
    async getAvatar(id) { const {rows} = await pool.query('SELECT avatar, avatar_type FROM accounts WHERE id = $1 AND avatar IS NOT NULL', [id]); return rows[0] ? {data: rows[0].avatar, type: rows[0].avatar_type} : null; },
    async deleteAccount(id) { await pool.query('DELETE FROM accounts WHERE id = $1', [id]); },
    async createSession(tokenHash, accountId, expiresAt) { await pool.query('INSERT INTO sessions (token_hash, account_id, expires_at) VALUES ($1, $2, $3)', [tokenHash, accountId, expiresAt]); },
    async getSession(tokenHash) {
      const {rows} = await pool.query('SELECT account_id, expires_at FROM sessions WHERE token_hash = $1 AND expires_at > now()', [tokenHash]);
      return rows[0] ? {accountId: rows[0].account_id, expiresAt: rows[0].expires_at} : null;
    },
    async extendSession(tokenHash, expiresAt) { await pool.query('UPDATE sessions SET expires_at = $2 WHERE token_hash = $1', [tokenHash, expiresAt]); },
    async deleteSession(tokenHash) { await pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]); },
    async deleteExpiredSessions() { await pool.query('DELETE FROM sessions WHERE expires_at <= now()'); },
    async close() { await pool.end(); },
  };
}

// Применяет migrations/*.sql по порядку один раз. Запускается ролью-мигратором при деплое, не приложением.
export async function migrate(connectionString, dir = new URL('../migrations/', import.meta.url)) {
  const {default: pg} = await import('pg');
  const {readdir, readFile} = await import('node:fs/promises');
  const client = new pg.Client({connectionString});
  await client.connect();
  try {
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
    const applied = [];
    for (const name of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) {
      if (done.has(name)) continue;
      await client.query('BEGIN');
      try {
        await client.query(await readFile(new URL(name, dir), 'utf8'));
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [name]);
        await client.query('COMMIT'); applied.push(name);
      } catch (e) { await client.query('ROLLBACK'); throw e; }
    }
    return applied;
  } finally { await client.end(); }
}
