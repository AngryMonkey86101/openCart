import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { signInitData } from "../src/auth.js";
import type { Config } from "../src/config.js";
import { openDatabase } from "../src/db.js";

const staticDir = mkdtempSync(join(tmpdir(), "opencart-web-"));
writeFileSync(join(staticDir, "index.html"), "<!doctype html><title>app</title>");

const config: Config = {
  botToken: "123456:TEST-TOKEN",
  webhookSecret: "secret",
  webappUrl: "https://list.example.ru",
  botUsername: "family_list_bot",
  port: 0,
  databasePath: ":memory:",
  staticDir,
};

async function auth(id: number, name: string) {
  const user = JSON.stringify({ id, first_name: name });
  return `tma ${await signInitData({ user, auth_date: String(Math.floor(Date.now() / 1000)) }, config.botToken)}`;
}

let app: ReturnType<typeof createApp>;
let mom: string;
let dad: string;

async function call(who: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = {};
  if (who) headers.Authorization = who;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app(
    new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
  return { status: res.status, data: (await res.json()) as any };
}

beforeEach(async () => {
  app = createApp(openDatabase(":memory:"), config);
  mom = await auth(1, "Мама");
  dad = await auth(2, "Папа");
});

describe("API списка покупок", () => {
  it("без initData не пускает", async () => {
    expect((await call(null, "GET", "/api/me")).status).toBe(401);
  });

  it("семья делит один список", async () => {
    const { data: created } = await call(mom, "POST", "/api/families", { name: "Дом" });
    const { data: me } = await call(mom, "GET", "/api/me");
    expect(me.families[0].inviteLink).toBe(`https://t.me/family_list_bot?start=${me.families[0].inviteCode}`);

    // До приглашения папа список не видит.
    expect((await call(dad, "GET", `/api/families/${created.id}/items`)).status).toBe(404);
    await call(dad, "POST", "/api/families/join", { code: me.families[0].inviteCode });
    const { data: people } = await call(dad, "GET", `/api/families/${created.id}/members`);
    expect(people.members).toMatchObject([
      { id: 1, firstName: "Мама", isOwner: true },
      { id: 2, firstName: "Папа", isOwner: false },
    ]);

    const { data: item } = await call(mom, "POST", `/api/families/${created.id}/items`, { title: "Молоко", qty: "2 л" });
    await call(dad, "PATCH", `/api/items/${item.id}`, { done: true });

    const { data: list } = await call(mom, "GET", `/api/families/${created.id}/items`);
    expect(list.items).toMatchObject([{ title: "Молоко", qty: "2 л", done: true, addedBy: "Мама", doneBy: "Папа" }]);

    await call(dad, "POST", `/api/families/${created.id}/clear-done`);
    expect((await call(mom, "GET", `/api/families/${created.id}/items`)).data.items).toEqual([]);
  });

  it("чужой товар нельзя удалить", async () => {
    const { data: created } = await call(mom, "POST", "/api/families", { name: "Дом" });
    const { data: item } = await call(mom, "POST", `/api/families/${created.id}/items`, { title: "Хлеб" });
    expect((await call(dad, "DELETE", `/api/items/${item.id}`)).status).toBe(404);
  });
});

describe("вебхук и статика", () => {
  it("вебхук без секрета отклоняется", async () => {
    const res = await app(new Request("http://localhost/bot/webhook", { method: "POST", body: "{}" }));
    expect(res.status).toBe(403);
  });

  it("бот отвечает прямо в ответе на вебхук, с приглашением в список", async () => {
    const { data: created } = await call(mom, "POST", "/api/families", { name: "Дом" });
    const { data: me } = await call(mom, "GET", "/api/me");
    const update = { message: { chat: { id: 2, type: "private" }, from: { id: 2, first_name: "Папа" }, text: `/start ${me.families[0].inviteCode}` } };
    const res = await app(
      new Request("http://localhost/bot/webhook", {
        method: "POST",
        headers: { "X-Telegram-Bot-Api-Secret-Token": "secret" },
        body: JSON.stringify(update),
      }),
    );
    const body = (await res.json()) as any;
    expect(body).toMatchObject({ method: "sendMessage", chat_id: 2 });
    expect(body.text).toContain("«Дом»");
    expect(body.reply_markup.inline_keyboard[0][0].web_app.url).toBe(
      `https://list.example.ru/?join=${me.families[0].inviteCode}`,
    );
    expect(created.id).toBeTruthy();
  });

  it("с BOT_APP_NAME приглашение ведёт прямо в Mini App", async () => {
    app = createApp(openDatabase(":memory:"), { ...config, botAppName: "list" });
    await call(mom, "POST", "/api/families", { name: "Дом" });
    const { data: me } = await call(mom, "GET", "/api/me");
    expect(me.families[0].inviteLink).toBe(`https://t.me/family_list_bot/list?startapp=${me.families[0].inviteCode}`);
  });

  it("неизвестный путь отдаёт index.html, выйти за каталог нельзя", async () => {
    for (const path of ["/", "/some/page", "/../package.json"]) {
      const res = await app(new Request(`http://localhost${path}`));
      expect(await res.text()).toContain("<title>app</title>");
    }
  });
});
