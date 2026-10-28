export interface TelegramUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface InitData {
  user: TelegramUser;
  authDate: number;
  startParam?: string;
}

const encoder = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Проверяет подпись initData по алгоритму Telegram:
 * secret = HMAC_SHA256("WebAppData", bot_token), hash = HMAC_SHA256(secret, data_check_string).
 * Возвращает null, если подпись неверна или данные старше maxAgeSec.
 */
export async function validateInitData(
  raw: string,
  botToken: string,
  maxAgeSec = 24 * 60 * 60,
  now = Math.floor(Date.now() / 1000),
): Promise<InitData | null> {
  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = await hmac(encoder.encode("WebAppData"), botToken);
  const expected = toHex(await hmac(secret, dataCheckString));
  if (!safeEqual(expected, hash)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!authDate || now - authDate > maxAgeSec) return null;

  const userJson = params.get("user");
  if (!userJson) return null;
  const user = JSON.parse(userJson) as TelegramUser;

  return { user, authDate, startParam: params.get("start_param") ?? undefined };
}

/** Подписывает initData — используется в тестах и для локальной отладки. */
export async function signInitData(fields: Record<string, string>, botToken: string): Promise<string> {
  const params = new URLSearchParams(fields);
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = await hmac(encoder.encode("WebAppData"), botToken);
  params.set("hash", toHex(await hmac(secret, dataCheckString)));
  return params.toString();
}
