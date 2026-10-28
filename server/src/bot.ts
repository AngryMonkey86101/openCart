import type { Config } from "./config.js";
import type { DB } from "./db.js";
import { openAppButton } from "./telegram.js";

interface Update {
  message?: {
    chat: { id: number; type: string };
    from?: { id: number; first_name: string; username?: string };
    text?: string;
  };
}

/**
 * Отвечаем прямо в ответе на вебхук: так серверу не нужен исходящий доступ к api.telegram.org,
 * который некоторые хостинги блокируют.
 */
function reply(chatId: number, text: string, replyMarkup: unknown): Response {
  return new Response(JSON.stringify({ method: "sendMessage", chat_id: chatId, text, reply_markup: replyMarkup }), {
    headers: { "content-type": "application/json" },
  });
}

export async function handleWebhook(request: Request, db: DB, config: Config): Promise<Response> {
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== config.webhookSecret) {
    return new Response("forbidden", { status: 403 });
  }
  const update = (await request.json()) as Update;
  const msg = update.message;
  if (!msg?.text || !msg.from || msg.chat.type !== "private") return new Response("ok");

  // Запоминаем chat_id, чтобы потом можно было присылать уведомления.
  db.prepare(
    `INSERT INTO users (id, first_name, username, chat_id) VALUES (@id, @name, @username, @chatId)
     ON CONFLICT(id) DO UPDATE SET first_name = @name, username = @username, chat_id = @chatId`,
  ).run({ id: msg.from.id, name: msg.from.first_name, username: msg.from.username ?? null, chatId: msg.chat.id });

  const [command, payload] = msg.text.trim().split(/\s+/, 2);
  if (command === "/start" && payload) {
    const family = db.prepare("SELECT name FROM families WHERE invite_code = ?").get(payload) as
      | { name: string }
      | undefined;
    if (family) {
      return reply(
        msg.chat.id,
        `Вас пригласили в список «${family.name}». Откройте его, чтобы присоединиться.`,
        openAppButton(config, "Открыть список", payload),
      );
    }
  }

  return reply(
    msg.chat.id,
    "Привет! Здесь общий список покупок для всей семьи. Откройте приложение, создайте список и пригласите близких.",
    openAppButton(config, "Открыть список покупок"),
  );
}
