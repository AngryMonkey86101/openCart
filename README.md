# openCart — общий список покупок для семьи

Telegram Mini App: один список на всю семью. Создаёте список, отправляете приглашение близким,
все видят одни и те же товары, отмечают купленное, изменения подтягиваются за несколько секунд.

## Как устроено

| Часть | Где | Что делает |
|---|---|---|
| `web/` | React + Vite + TypeScript | Сам Mini App. Цвета берёт из темы Telegram. |
| `worker/` | Cloudflare Worker + D1 (SQLite) | REST API `/api/*`, вебхук бота `/bot/webhook`, раздача собранного `web/dist`. |

Авторизация — через `initData` Telegram: клиент шлёт `Authorization: tma <initData>`, воркер проверяет HMAC-подпись токеном бота.
Приглашение — ссылка `https://t.me/<бот>?start=<код>`: бот отвечает кнопкой, которая открывает Mini App и добавляет человека в список.

## Первый запуск

1. Создать бота у [@BotFather](https://t.me/BotFather) (`/newbot`), сохранить токен.
2. Установить зависимости: `npm install`.
3. Создать базу: `cd worker && npx wrangler d1 create opencart` и вписать `database_id` в `worker/wrangler.jsonc`.
4. В `worker/wrangler.jsonc` заполнить `BOT_USERNAME` (без @). `WEBAPP_URL` — адрес воркера, его покажет первый деплой.
5. Секреты:
   ```sh
   npx wrangler secret put BOT_TOKEN       # токен от BotFather
   npx wrangler secret put WEBHOOK_SECRET  # любая случайная строка
   ```
6. Миграции и деплой (из корня): `npm run db:migrate:remote -w worker && npm run deploy`.
7. Подключить вебхук:
   ```sh
   curl "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=<WEBAPP_URL>/bot/webhook&secret_token=<WEBHOOK_SECRET>"
   ```
8. В BotFather: `/setmenubutton` → URL `WEBAPP_URL`, чтобы приложение открывалось кнопкой меню.

## Локальная разработка

```sh
printf 'BOT_TOKEN="123456:TEST"\nWEBHOOK_SECRET="dev"\n' > worker/.dev.vars
npm run db:migrate:local -w worker
npm run build && npm run dev:worker   # http://localhost:8787
npm test                              # тесты проверки initData
```

Вне Telegram приложение покажет подсказку «Откройте через бота» — `initData` есть только внутри Telegram.
Для проверки на телефоне удобно поднять туннель (`cloudflared tunnel --url http://localhost:8787`) и указать его адрес в BotFather.
