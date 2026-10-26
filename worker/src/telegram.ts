import type { Env } from "./env";

export async function callBot(env: Env, method: string, payload: unknown): Promise<Response> {
  return fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export function inviteLink(env: Env, code: string): string {
  return `https://t.me/${env.BOT_USERNAME}?start=${code}`;
}

export function openAppButton(env: Env, text: string, join?: string) {
  const url = join ? `${env.WEBAPP_URL}/?join=${encodeURIComponent(join)}` : env.WEBAPP_URL;
  return { inline_keyboard: [[{ text, web_app: { url } }]] };
}
