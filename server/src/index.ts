import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { openDatabase } from "./db.js";
import { Notifier } from "./notifier.js";
import { setupBot } from "./telegram.js";

const config = loadConfig();
const db = openDatabase(config.databasePath);
const notifier = new Notifier(db, config);
const app = createApp(db, config, notifier);

function toRequest(req: IncomingMessage): Request {
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  const hasBody = req.method !== "GET" && req.method !== "HEAD";
  return new Request(url, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: hasBody ? (Readable.toWeb(req) as ReadableStream) : undefined,
    duplex: "half",
  } as RequestInit);
}

async function send(res: ServerResponse, response: Response) {
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}

const server = createServer(async (req, res) => {
  try {
    await send(res, await app(toRequest(req)));
  } catch (err) {
    console.error(err);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
});

server.listen(config.port, () => {
  console.log(`openCart слушает порт ${config.port}`);
  console.log(notifier.enabled ? "Оповещения в Telegram: через посредника" : "Оповещения в Telegram выключены (нет NOTIFY_RELAY_URL)");
  setupBot(config)
    .then(() => console.log(`Вебхук бота: ${config.webappUrl}/bot/webhook`))
    .catch((err) =>
      console.error(
        `Не удалось настроить бота: ${err.message}. Если сервер не может обратиться к api.telegram.org,`,
        "приложение всё равно работает; вебхук и Mini App настраиваются в BotFather вручную (см. README).",
      ),
    );
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () =>
    server.close(async () => {
      await notifier.flushAll();
      db.close();
      process.exit(0);
    }),
  );
}
