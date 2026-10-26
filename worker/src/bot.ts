import type { Env } from "./env";
import { callBot, openAppButton } from "./telegram";

interface Update {
  message?: {
    chat: { id: number; type: string };
    from?: { id: number; first_name: string; username?: string };
    text?: string;
  };
}

export async function handleWebhook(request: Request, env: Env): Promise<Response> {
  if (request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  const update = (await request.json()) as Update;
  const msg = update.message;
  if (!msg?.text || !msg.from || msg.chat.type !== "private") return new Response("ok");

  // Запоминаем chat_id, чтобы потом можно было присылать уведомления.
  await env.DB.prepare(
    `INSERT INTO users (id, first_name, username, chat_id) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(id) DO UPDATE SET first_name = ?2, username = ?3, chat_id = ?4`,
  )
    .bind(msg.from.id, msg.from.first_name, msg.from.username ?? null, msg.chat.id)
    .run();

  const [command, payload] = msg.text.trim().split(/\s+/, 2);
  if (command === "/start" && payload) {
    const family = await env.DB.prepare("SELECT name FROM families WHERE invite_code = ?1")
      .bind(payload)
      .first<{ name: string }>();
    if (family) {
      await callBot(env, "sendMessage", {
        chat_id: msg.chat.id,
        text: `Вас пригласили в список «${family.name}». Откройте его, чтобы присоединиться.`,
        reply_markup: openAppButton(env, "Открыть список", payload),
      });
      return new Response("ok");
    }
  }

  await callBot(env, "sendMessage", {
    chat_id: msg.chat.id,
    text: "Привет! Здесь общий список покупок для всей семьи. Откройте приложение, создайте список и пригласите близких.",
    reply_markup: openAppButton(env, "Открыть список покупок"),
  });
  return new Response("ok");
}
