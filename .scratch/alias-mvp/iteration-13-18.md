# Integration graph: локальная итерация 13–18

Spec: [spec.md](spec.md), секция «Локальная итерация 13–18».
Integration branch: **alias/local-room-improvements**.
Base: **f1b89e2a8cbc45e705e0678a2c7a38b16d842e12** (опубликованный main с документацией; runtime VPS 5a44917).

| Ticket | Blocked by | Branch | Progress |
| --- | --- | --- | --- |
| [13](issues/13-award-last-word.md) | Нет | alias/ticket-13 | merged: af45988; код 647f2c8; check, diff --check и 32/32 теста у implementer; merge без конфликтов, diff --check и check у merger |
| [14](issues/14-medium-difficulty.md) | Нет | alias/ticket-14 | merged: aa64cf6; код 4f487ac; 389 карточек / 196 словосочетаний; check, diff --check и 38/38 тестов у implementer (включая 13/15); merge без конфликтов, diff --check и check у merger |
| [15](issues/15-select-spacing.md) | Нет | alias/ticket-15 | merged: 3a26df6; код 844be59; статический CSS-разбор, diff --check, check и 26/26 тестов у implementer; merge без конфликтов, diff --check у merger |
| [16](issues/16-team-order.md) | Нет | alias/ticket-16 | merged: f1fb9ad; код db369d6; check, diff --check и 40/40 тестов у implementer (включая 13/14/15); merge без конфликтов, diff --check и check у merger |
| [17](issues/17-one-click-guesser.md) | 13 | alias/ticket-17 | merged: 999d75d; код 375671b; 34/34 теста до 14/16 и 9/9 целевых после b0507f4 у implementer; merge без конфликтов, diff --check и check у merger |
| [18](issues/18-end-game-to-lobby.md) | 13, 16 | alias/ticket-18 | merged: 67be055; код a15d8f1, готовая ветка a0bfdca; 6/6 целевых тестов, check и diff --check у implementer; merge без конфликтов, diff --check и check у merger |

13 задаёт поздний endpoint/состояние, которые использует 17. 18 должен очищать состояние 13 и сохранять реализованный в 16 порядок. Остальные задачи независимы по поведению; пересечение файлов разрешает merger, не фиктивные зависимости.

Исполнение: fresh implementer/worktree на тикет, tdd на HTTP/SSE и уместных чистых границах; каждый перед завершением сливает актуальную integration branch в свою ветку. Fresh merger переносит готовое на integration. Статусы здесь и в тикетах обновляются с commit/test evidence. Финальные Standards/Spec review, единый fresh fixer при findings, полный suite, затем archive worktrees. Без PR, push или deploy. Ручная браузерная приёмка остаётся пользователю. CSS-тикет не требует бессмысленных тестов, зеркалящих декларации; статический разбор и общий suite.

## Состояние после интеграции

2026-11-03: все шесть задач 13–18 merged в integration; финальные Standards/Spec review и исправление завершены (подробности ниже). Полный suite merger не повторял по указанию координатора: у implementer 18 после integration первый прогон 47/48, затем 48/48. Известная нестабильная прежняя проверка приватности `basic / ffa` в `test/integration.test.js:159` ищет слово через `JSON.includes(word)` по всему JSON; возможное совпадение с публичными метаданными сложности даёт ложный сбой. Передать это финальному review/fixer; в рамках merge не исправлялось. После финальных исправлений нужен общий suite. Без браузера, push/deploy и уборки worktrees на этом этапе.

## Финальное review и исправление — завершены

2026-11-03: Standards review — 1 P2, Spec review — 0 findings; единственное замечание исправлено в `14469470d8996d33c42c8b85aa7ece6c30e2b19f` (`alias/review-fixes`). Исправление влито без конфликтов: merge `15ff74c324449a1f6a4968f5a84d19f5acfa61ae`. Production-код не менялся. Доказательства fresh fixer: полный suite **49/49**, `npm run check`, `node --check deploy/smoke.mjs` и `git diff --check` прошли; regression тест подтверждает допустимость подстрок метаданных и обнаружение настоящей утечки. Merger выполнил только `git diff --check`, без повторного suite. Подробнее: [review и исправление](iteration-13-18-review.md).

Следующий шаг — coordinator убирает временные worktrees; ручная браузерная приёмка остаётся пользователю. Без push/deploy.
