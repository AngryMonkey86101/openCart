# openCart — общий список покупок для семьи

Telegram Mini App: один список на всю семью. Создаёте список, отправляете приглашение близким,
все видят одни и те же товары, отмечают купленное, изменения подтягиваются за несколько секунд.

## Как устроено

| Часть | Где | Что делает |
|---|---|---|
| `web/` | React + Vite + TypeScript | Сам Mini App. Цвета берёт из темы Telegram. |
| `server/` | Node.js + SQLite (better-sqlite3) | REST API `/api/*`, вебхук бота `/bot/webhook`, раздача собранного `web/dist`. |
| `Caddyfile`, `docker-compose.yml` | Caddy + Docker | HTTPS-сертификат Let's Encrypt и проксирование на сервер. |

Всё работает на одном VPS, база — один файл SQLite в Docker-томе.
Авторизация — через `initData` Telegram: клиент шлёт `Authorization: tma <initData>`, сервер проверяет HMAC-подпись токеном бота.
Приглашение — ссылка `https://t.me/<бот>?start=<код>`: бот отвечает кнопкой, которая открывает Mini App и добавляет человека в список.

## Запуск на VPS

Нужны VPS с Docker (подойдёт минимальный тариф любого российского хостинга) и домен.

1. Создать бота у [@BotFather](https://t.me/BotFather) (`/newbot`), сохранить токен и имя бота.
2. Направить домен (A-запись) на IP сервера. Открыть порты 80 и 443.
3. На сервере:
   ```sh
   git clone https://github.com/AngryMonkey86101/openCart.git && cd openCart
   cp .env.example .env   # заполнить DOMAIN, WEBAPP_URL, BOT_TOKEN, BOT_USERNAME, WEBHOOK_SECRET
   docker compose up -d --build
   ```
4. Готово: при старте сервер сам регистрирует вебхук и кнопку меню бота. Проверить: `docker compose logs app` —
   там должна быть строка «Вебхук бота: …». Напишите боту `/start`.

Обновление: `git pull && docker compose up -d --build`. Резервная копия базы:
`docker compose exec app node -e "require('better-sqlite3')('/data/opencart.db').backup('/data/backup.db')"`,
затем `docker compose cp app:/data/backup.db ./backup.db`.

## Локальная разработка

```sh
npm install
npm run build -w web
BOT_TOKEN=123456:TEST WEBHOOK_SECRET=dev WEBAPP_URL=http://localhost:3000 BOT_USERNAME=test_bot \
  npm run dev:server     # http://localhost:3000
npm run dev:web          # Vite на :5173 с прокси /api → :3000
npm test                 # тесты API и проверки initData
```

Вне Telegram приложение покажет подсказку «Откройте через бота» — `initData` есть только внутри Telegram.
Для проверки на телефоне без VPS удобно поднять туннель до `localhost:3000` и указать его адрес в `WEBAPP_URL`.
