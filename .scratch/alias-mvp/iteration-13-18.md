# Integration graph: локальная итерация 13–18

Spec: [spec.md](spec.md), секция «Локальная итерация 13–18».
Integration branch: **alias/local-room-improvements**.
Base: **f1b89e2a8cbc45e705e0678a2c7a38b16d842e12** (опубликованный main с документацией; runtime VPS 5a44917).

| Ticket | Blocked by | Branch | Progress |
| --- | --- | --- | --- |
| [13](issues/13-award-last-word.md) | Нет | alias/ticket-13 | merged: af45988; код 647f2c8; check, diff --check и 32/32 теста у implementer; merge без конфликтов, diff --check и check у merger |
| [14](issues/14-medium-difficulty.md) | Нет | alias/ticket-14 | в-работе, implement_ticket14 |
| [15](issues/15-select-spacing.md) | Нет | alias/ticket-15 | merged: 3a26df6; код 844be59; статический CSS-разбор, diff --check, check и 26/26 тестов у implementer; merge без конфликтов, diff --check у merger |
| [16](issues/16-team-order.md) | Нет | alias/ticket-16 | в-работе, implement_ticket16 |
| [17](issues/17-one-click-guesser.md) | 13 | alias/ticket-17 | готова к исполнению: 13 merged |
| [18](issues/18-end-game-to-lobby.md) | 13, 16 | alias/ticket-18 | заблокирована 16; 13 merged |

13 задаёт поздний endpoint/состояние, которые использует 17. 18 должен очищать состояние 13 и сохранять реализованный в 16 порядок. Остальные задачи независимы по поведению; пересечение файлов разрешает merger, не фиктивные зависимости.

Исполнение: fresh implementer/worktree на тикет, tdd на HTTP/SSE и уместных чистых границах; каждый перед завершением сливает актуальную integration branch в свою ветку. Fresh merger переносит готовое на integration. Статусы здесь и в тикетах обновляются с commit/test evidence. Финальные Standards/Spec review, единый fresh fixer при findings, полный suite, затем archive worktrees. Без PR, push или deploy. Ручная браузерная приёмка остаётся пользователю. CSS-тикет не требует бессмысленных тестов, зеркалящих декларации; статический разбор и общий suite.
