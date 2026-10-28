# openCart — общий список покупок для семьи

Telegram Mini App: один список на всю семью. Создаёте список, отправляете приглашение близким,
все видят одни и те же товары, отмечают купленное, изменения подтягиваются за несколько секунд.

## Как устроено

| Часть | Где | Что делает |
|---|---|---|
| `web/` | React + Vite + TypeScript | Сам Mini App. Зелёная тема со светлым и тёмным вариантом, см. [design.md](design.md). |
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
4. В [@BotFather](https://t.me/BotFather): `/newapp` → выбрать бота → указать URL `https://<домен>` и короткое имя
   (например `list`). Вписать это имя в `BOT_APP_NAME` и перезапустить: `docker compose up -d`.
   Тогда приглашения открывают приложение сразу, без ответа бота.
5. При старте сервер пробует сам зарегистрировать вебхук и кнопку меню. Проверить: `docker compose logs app` —
   там должна быть строка «Вебхук бота: …». Напишите боту `/start`.

### Если хостинг блокирует Telegram

В логе будет «Не удалось настроить бота: fetch failed». Приложение при этом работает: телефон открывает его
напрямую с вашего сервера, а бот отвечает прямо в ответе на вебхук, без исходящих запросов. Нужно только один раз
настроить бота вручную, с любого устройства, где открывается Telegram:

- кнопка меню: в BotFather `/setmenubutton` → бот → URL `https://<домен>`;
- вебхук (чтобы бот отвечал на `/start`): открыть в браузере
  `https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<домен>/bot/webhook&secret_token=<WEBHOOK_SECRET>`.
  Ответ `"ok":true` значит, что всё готово.

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

### Посредник на Cloudflare: оповещения в Telegram и ответ на /start

Если хостинг не пускает сервер к Telegram, сообщения от бота отправляет бесплатный Cloudflare Worker
(`bot-relay/worker.js`). Сервер передаёт ему оповещения коротким запросом, а Worker отправляет их через бота.
Пользователи к Cloudflare не обращаются.

1. [dash.cloudflare.com](https://dash.cloudflare.com) → Workers & Pages → Create → Worker → Deploy, затем Edit code:
   вставить содержимое `bot-relay/worker.js`, Deploy.
2. Settings → Variables and Secrets, тип Secret: `BOT_TOKEN` — токен бота, `RELAY_SECRET` — случайная строка
   (`openssl rand -hex 32`).
3. В `.env` на сервере: `NOTIFY_RELAY_URL=https://<адрес worker>.workers.dev` и `NOTIFY_RELAY_SECRET` — та же строка,
   что `RELAY_SECRET`. Перезапустить: `docker compose up -d`. В логе появится «Оповещения в Telegram: через посредника».
4. В приложении каждый участник нажимает «Оповещения в Telegram» и разрешает боту писать ему.

Оповещения копятся 30 секунд и приходят одним сообщением; свои действия человеку не присылаются.

Чтобы Worker ещё и отвечал на `/start`: добавить переменные `WEBAPP_URL` = `https://<домен>` и
`WEBHOOK_SECRET` = то же, что в `.env`, и направить вебхук на Worker:
`https://api.telegram.org/bot<BOT_TOKEN>/setWebhook?url=https://<адрес worker>.workers.dev&secret_token=<WEBHOOK_SECRET>`.
