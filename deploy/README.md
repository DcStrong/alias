# VPS: публикация и эксплуатация

Адрес игры: **https://144.31.97.89/**. HTTP перенаправляется на HTTPS (308). Домен не требуется и не подключался.

## Что установлено

- Ubuntu 22.04 LTS x86_64; ОС сохранена, переустановка не потребовалась.
- Node.js 24.22.2 из официального дистрибутива, SHA256 проверен по официальному SHASUMS256.txt.
- Один процесс Node.js: `alias.service`, системный пользователь `alias` без входа в shell, только `127.0.0.1:3000`.
- Текущий код в `/opt/alias/releases/8a8d7dfe0210a234d24b0c49c9938d5d8b2ecd42`, файл `REVISION` содержит этот SHA; `/opt/alias/current` указывает на активный релиз. Node: `/opt/alias/node/bin/node`.
- Nginx слушает 80/443, проксирует JSON и SSE без буферизации. Секретное состояние по-прежнему формирует сервер приложения.
- `COOKIE_SECURE=true` включает Secure у HttpOnly cookie за HTTPS-прокси. При обычном локальном запуске без этой переменной HTTP продолжает работать.
- systemd: запуск при загрузке, перезапуск через 4 секунды, лимит памяти 512 МБ, непривилегированный runtime, read-only файловая система сервиса.
- UFW разрешает только 22/tcp, 80/tcp, 443/tcp (IPv4/IPv6). SSH не отключён.
- Старая x-ui/Xray-служба сначала была отключена для освобождения 443. По отдельному запросу пользователя 2026-11-03 удалены её программа, VPN-база/настройки, управляющий скрипт, systemd unit и собственные логи; освобождено около 256 MiB. Службы игры и Nginx не перезапускались.

## HTTPS без домена

Получен публично доверенный сертификат Let’s Encrypt для IP 144.31.97.89, issuer YE2, SAN IP Address:144.31.97.89. Это не самоподписанный сертификат. Первый сертификат действует до **10 ноября 2026**, далее должен продлеваться автоматически.

Используется Certbot 5.9.0 в `/opt/alias-certbot`, профиль `shortlived`, webroot `/var/www/alias-acme`. Проверка IP-сертификатов поддерживается [официальной инструкцией Let’s Encrypt](https://letsencrypt.org/2026/03/11/shorter-certs-certbot). Сертификаты короткоживущие, поэтому timer `alias-certbot-renew.timer` проверяет продление каждые шесть часов с небольшим случайным сдвигом. Deploy-hook перезагружает Nginx после продления.

Certbot обновляется отдельно и проверенно: текущий Python 3.10 Ubuntu 22.04 поддерживается установленной версией, но предупреждает о прекращении поддержки в следующем выпуске Certbot. Не обновляйте venv вслепую: при будущем обновлении Certbot сначала потребуется совместимый Python либо обновление Ubuntu. Текущая установленная версия продление поддерживает.

## Управление

Войти обычным SSH под администратором:

```sh
ssh root@144.31.97.89
systemctl status alias nginx --no-pager
systemctl restart alias
journalctl -u alias -n 100 --no-pager
systemctl list-timers alias-certbot-renew.timer
```

**Перезапуск приложения или VPS удаляет текущие комнаты**, так как MVP хранит их в памяти. Обновляйте между партиями. Перезагрузка Nginx при обновлении сертификата не перезапускает Node.js.

Журналы приложения ограничены rate limit systemd и не содержат cookie/слов по каждому запросу. Nginx пишет `/var/log/nginx/alias.access.log` и `alias.error.log`, обслуживаемые системным logrotate. Не публикуйте логи доступа: они могут содержать коды приглашений в URL.

Проверка сертификата и немедленная проба продления:

```sh
/opt/alias-certbot/bin/certbot certificates
/opt/alias-certbot/bin/certbot renew --dry-run --run-deploy-hooks --no-random-sleep-on-renew
journalctl -u alias-certbot-renew.service -n 100 --no-pager
```

Порт 80 и путь ACME challenge должны оставаться доступны снаружи для продления.

## Обновление кода без GitHub-доступа с VPS

На компьютере разработчика из корня проекта:

```sh
npm run check
npm test
COPYFILE_DISABLE=1 tar --no-xattrs -czf /tmp/alias-release.tar.gz server.js game.js words.js rotating.js package.json public
scp /tmp/alias-release.tar.gz root@144.31.97.89:/tmp/alias-release.tar.gz
ssh root@144.31.97.89
```

На VPS (обновляет только код, не конфигурацию системы):

```sh
set -e
release="/opt/alias/releases/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$release"
tar -xzf /tmp/alias-release.tar.gz -C "$release"
/opt/alias/node/bin/node --check "$release/server.js"
/opt/alias/node/bin/node --check "$release/game.js"
/opt/alias/node/bin/node --check "$release/public/app.js"
ln -sfn "$release" /opt/alias/current.next
mv -Tf /opt/alias/current.next /opt/alias/current
systemctl restart alias
systemctl status alias --no-pager
```

Затем с компьютера разработчика:

```sh
node deploy/smoke.mjs https://144.31.97.89
```

Для быстрой проверки уровня добавьте `--difficulty=basic --quick` или `--difficulty=hard --quick`. Quick проверяет два клиента, права, раскрытие завершённой/скрытие активной карточки и reconnect, без ожидания таймеров.

Полный smoke создаёт временную комнату, использует два независимых клиента, два реальных хода по 30 секунд и очищает своих участников. Cookie и слова не выводятся и не сохраняются. Нельзя запускать с отключённой проверкой TLS.

Для отката переключите `/opt/alias/current` на предыдущий каталог релиза и перезапустите `alias`. Старые релизы не удаляются автоматически. При изменении конфигурации отдельно установите соответствующие файлы из `deploy/`, выполните `systemctl daemon-reload` для systemd и `nginx -t` перед reload Nginx.

`provision.sh` предназначен для первоначальной установки на этот выделенный VPS: он устанавливает Node.js/Nginx/Certbot/UFW и отключает конфликтующую x-ui-службу. Не запускайте его как обычную команду обновления приложения или на чужой серверной конфигурации.

## Ограничения

Один процесс, комнаты в памяти. Нет общей БД, мониторинга доступности/уведомлений, автоматического масштабирования или сохранения партий. Ссылка/код — приглашение без аккаунтов. Пароль SSH не хранится в репозитории и для обновления вводится обычным SSH-клиентом пользователя.

## Вход через Discord и Telegram (задачи 28–31)

Без `AUTH_SECRET` сервер работает как раньше: только гостевая игра. Включение на новом сервере:

1. PostgreSQL 16+, слушает только `127.0.0.1`, `password_encryption = scram-sha-256`, порт 5432 закрыт файрволом.
2. Роли: `sudo -u postgres psql -v app_password='…' -v migrator_password='…' -f deploy/postgres-roles.sql`.
3. В каталоге релиза: `npm ci --omit=dev`, затем `MIGRATE_DATABASE_URL=postgres://alias_migrator:…@127.0.0.1/alias npm run migrate`.
4. `/etc/alias/env` (владелец `root:alias`, права `640`):

```
AUTH_SECRET=<openssl rand -base64 48>
DATABASE_URL=postgres://alias_app:…@127.0.0.1/alias
PUBLIC_ORIGIN=https://<домен>
DISCORD_CLIENT_ID=…
DISCORD_CLIENT_SECRET=…
TELEGRAM_BOT_TOKEN=…
TELEGRAM_BOT_NAME=<имя бота без @>
```

`AUTH_SECRET` не менять после запуска: от него зависят ключи аккаунтов (смена = все войдут как новые пользователи).

5. Discord Developer Portal → OAuth2 → Redirects: `https://<домен>/auth/discord/callback`. Scope только `identify`.
6. @BotFather → `/setdomain` → `<домен>`.
7. Резервные копии: `pg_dump -Fc alias | age -r <ключ> > alias-$(date +%F).dump.age`, хранить 14 дней, ключ расшифровки — не на сервере.
8. Nginx: ограничение `limit_req` на `location /auth/` (дополнительно к ограничению в приложении).
