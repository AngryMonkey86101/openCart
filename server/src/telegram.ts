import type { Config } from "./config.js";

export async function callBot(config: Config, method: string, payload: unknown): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${config.botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * Прямая ссылка на Mini App (startapp) работает без участия сервера: Telegram сам
 * открывает приложение и передаёт код в initData. Ссылка на бота (start) требует вебхука.
 */
export function inviteLink(config: Config, code: string): string {
  return config.botAppName
    ? `https://t.me/${config.botUsername}/${config.botAppName}?startapp=${code}`
    : `https://t.me/${config.botUsername}?start=${code}`;
}

export function openAppButton(config: Config, text: string, join?: string) {
  const url = join ? `${config.webappUrl}/?join=${encodeURIComponent(join)}` : config.webappUrl;
  return { inline_keyboard: [[{ text, web_app: { url } }]] };
}

/** Регистрирует вебхук и кнопку меню, чтобы не настраивать их вручную. */
export async function setupBot(config: Config): Promise<void> {
  const steps: [string, unknown][] = [
    ["setWebhook", { url: `${config.webappUrl}/bot/webhook`, secret_token: config.webhookSecret, allowed_updates: ["message"] }],
    ["setChatMenuButton", { menu_button: { type: "web_app", text: "Список", web_app: { url: config.webappUrl } } }],
  ];
  for (const [method, payload] of steps) {
    const res = await callBot(config, method, payload);
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
    if (!body.ok) throw new Error(`${method}: ${body.description ?? res.status}`);
  }
}
