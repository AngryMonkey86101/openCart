// Мини-бот для случая, когда хостинг VPS блокирует Telegram.
// Telegram шлёт сообщения сюда (Cloudflare Worker), а бот отвечает кнопкой,
// которая открывает Mini App на вашем сервере. Базы и токена бота не нужно:
// ответ передаётся прямо в ответе на вебхук.
//
// Переменные окружения Worker: WEBAPP_URL (https://ваш-домен) и WEBHOOK_SECRET.

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return new Response("ok");
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
