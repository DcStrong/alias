// Применяет миграции. Запускать при деплое с правами мигратора: MIGRATE_DATABASE_URL=postgres://alias_migrator@... npm run migrate
import { migrate } from '../auth/store.js';
const url = process.env.MIGRATE_DATABASE_URL || process.env.DATABASE_URL;
if (!url) { console.error('Задайте MIGRATE_DATABASE_URL'); process.exit(1); }
const applied = await migrate(url);
console.log(applied.length ? `Применены: ${applied.join(', ')}` : 'Новых миграций нет');
