-- Роли PostgreSQL для Alias. Выполнить один раз суперпользователем: psql -v app_password=... -v migrator_password=... -f postgres-roles.sql
-- alias_migrator владеет схемой и применяет миграции; alias_app — только чтение и запись строк, без DDL.
CREATE ROLE alias_migrator LOGIN PASSWORD :'migrator_password';
CREATE ROLE alias_app LOGIN PASSWORD :'app_password' CONNECTION LIMIT 20;
CREATE DATABASE alias OWNER alias_migrator;
\connect alias
REVOKE ALL ON DATABASE alias FROM PUBLIC;
GRANT CONNECT ON DATABASE alias TO alias_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO alias_migrator;
GRANT USAGE ON SCHEMA public TO alias_app;
-- Права на будущие таблицы, созданные мигратором.
ALTER DEFAULT PRIVILEGES FOR ROLE alias_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO alias_app;
ALTER ROLE alias_app SET statement_timeout = '5s';
