export interface Config {
  botToken: string;
  webhookSecret: string;
  /** Публичный адрес приложения, например https://list.example.ru */
  webappUrl: string;
  /** Имя бота без @, нужно для ссылок-приглашений. */
  botUsername: string;
  port: number;
  databasePath: string;
  /** Каталог с собранным Mini App (web/dist). */
  staticDir: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана переменная окружения ${name}`);
  return value;
}

export function loadConfig(): Config {
  return {
    botToken: required("BOT_TOKEN"),
    webhookSecret: required("WEBHOOK_SECRET"),
    webappUrl: required("WEBAPP_URL").replace(/\/+$/, ""),
    botUsername: required("BOT_USERNAME").replace(/^@/, ""),
    port: Number(process.env.PORT ?? 3000),
    databasePath: process.env.DATABASE_PATH ?? "data/opencart.db",
    staticDir: process.env.STATIC_DIR ?? "../web/dist",
  };
}
