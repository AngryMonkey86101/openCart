// Посредник между сервером и Telegram для случая, когда хостинг VPS блокирует Telegram.
//
// POST /notify — сервер присылает оповещения, Worker отправляет их через бота.
//   Переменные: BOT_TOKEN (секрет) и RELAY_SECRET (то же, что NOTIFY_RELAY_SECRET в .env).
// POST / — вебхук бота (необязательно): на /start отвечает кнопкой, открывающей Mini App.
//   Переменные: WEBAPP_URL (https://ваш-домен) и WEBHOOK_SECRET.

async function notify(request, env) {
  if (!env.RELAY_SECRET || request.headers.get("X-Relay-Secret") !== env.RELAY_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const { messages = [] } = await request.json().catch(() => ({}));
  const results = await Promise.all(
    messages.slice(0, 50).map((m) =>
      fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(m),
      }).then((r) => r.status),
    ),
  );
  return Response.json({ results });
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("ok");
    if (new URL(request.url).pathname === "/notify") return notify(request, env);
    if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
      return new Response("forbidden", { status: 403 });
    }

    const update = await request.json().catch(() => ({}));
    const msg = update.message;
    if (!msg || msg.chat?.type !== "private") return new Response("ok");

    // «/start КОД» из старых ссылок-приглашений: передаём код в приложение.
    const [command, payload] = (msg.text ?? "").trim().split(/\s+/, 2);
    const base = env.WEBAPP_URL.replace(/\/+$/, "");
    const join = command === "/start" && payload ? payload : null;
    const url = join ? `${base}/?join=${encodeURIComponent(join)}` : base;
    const text = join
      ? "Вас пригласили в общий список покупок. Откройте его, чтобы присоединиться."
      : "Привет! Здесь общий список покупок для всей семьи. Откройте приложение, создайте список и пригласите близких.";

    return Response.json({
      method: "sendMessage",
      chat_id: msg.chat.id,
      text,
      reply_markup: { inline_keyboard: [[{ text: join ? "Открыть список" : "Открыть список покупок", web_app: { url } }]] },
    });
  },
};
