import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { signInitData } from "../src/auth.js";
import type { Config } from "../src/config.js";
import { openDatabase, type DB } from "../src/db.js";
import { Notifier } from "../src/notifier.js";
import { localClock, Reminders } from "../src/reminders.js";

const staticDir = mkdtempSync(join(tmpdir(), "opencart-web-"));
writeFileSync(join(staticDir, "index.html"), "<!doctype html>");

const config: Config = {
  botToken: "123456:TEST-TOKEN",
  webhookSecret: "secret",
  webappUrl: "https://list.example.ru",
  botUsername: "family_list_bot",
  botAppName: "list",
  notifyRelayUrl: "https://relay.test",
  notifyRelaySecret: "x",
  port: 0,
  databasePath: ":memory:",
  staticDir,
};

async function auth(id: number, name: string) {
  const user = JSON.stringify({ id, first_name: name });
  return `tma ${await signInitData({ user, auth_date: String(Math.floor(Date.now() / 1000)) }, config.botToken)}`;
}

let db: DB;
let app: ReturnType<typeof createApp>;
let reminders: Reminders;
let sent: any[];
let mom: string;
let dad: string;

async function call(who: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { Authorization: who };
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await app(
    new Request(`http://localhost${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
  );
  return { status: res.status, data: (await res.json()) as any };
}

// Пятница, 13 ноября 2026, 15:00 UTC = 18:00 по Москве.
const FRIDAY_18_MSK = new Date("2026-11-13T15:00:00Z");
const ALL_DAYS = 127;

beforeEach(async () => {
  db = openDatabase(":memory:");
  sent = [];
  const notifier = new Notifier(db, config, 60_000, async (messages) => void sent.push(...messages));
  app = createApp(db, config, notifier);
  reminders = new Reminders(db, notifier);
  mom = await auth(1, "Мама");
  dad = await auth(2, "Папа");
});

async function familyWithItems(titles: string[]) {
  const { data: created } = await call(mom, "POST", "/api/families", { name: "Дом" });
  const { data: me } = await call(mom, "GET", "/api/me");
  await call(dad, "POST", "/api/families/join", { code: me.families[0].inviteCode });
  for (const title of titles) await call(mom, "POST", `/api/families/${created.id}/items`, { title });
  return created.id as string;
}

describe("напоминания об активном списке", () => {
  it("местное время считается в часовом поясе участника", () => {
    expect(localClock(FRIDAY_18_MSK, "Europe/Moscow")).toEqual({ date: "2026-11-13", minutes: 18 * 60, weekday: 4 });
    expect(localClock(FRIDAY_18_MSK, "Asia/Vladivostok")).toEqual({ date: "2026-11-14", minutes: 1 * 60, weekday: 5 });
  });

  it("настройки по умолчанию выключены и проверяются", async () => {
    const { data: me } = await call(mom, "GET", "/api/me");
    expect(me.reminder).toEqual({ enabled: false, time: "18:00", days: ALL_DAYS, timezone: "Europe/Moscow" });
    const ok = { enabled: true, time: "09:30", days: 31, timezone: "Asia/Yekaterinburg" };
    expect((await call(mom, "POST", "/api/me/reminder", ok)).status).toBe(200);
    expect((await call(mom, "GET", "/api/me")).data.reminder).toEqual(ok);
    expect((await call(mom, "POST", "/api/me/reminder", { ...ok, time: "25:00" })).status).toBe(400);
    expect((await call(mom, "POST", "/api/me/reminder", { ...ok, days: 0 })).status).toBe(400);
    expect((await call(mom, "POST", "/api/me/reminder", { ...ok, timezone: "Mars/Olympus" })).status).toBe(400);
  });

  it("в назначенное время приходит одно сообщение с товарами, второй раз за день — нет", async () => {
    await familyWithItems(["Молоко", "Хлеб", "Яйца", "Сыр", "Чай", "Кофе", "Сахар"]);
    await call(dad, "POST", "/api/me/reminder", { enabled: true, time: "18:00", days: ALL_DAYS, timezone: "Europe/Moscow" });

    expect(await reminders.tick(new Date("2026-11-13T14:59:00Z"))).toBe(0); // 17:59 — ещё рано
    expect(await reminders.tick(FRIDAY_18_MSK)).toBe(1);
    expect(sent).toEqual([
      {
        chat_id: 2,
        text: "🛒 Напоминание: есть что купить\n\n«Дом» — 7 товаров: Сахар, Кофе, Чай, Сыр, Яйца и ещё 2",
        reply_markup: { inline_keyboard: [[{ text: "Открыть список", url: "https://t.me/family_list_bot/list" }]] },
      },
    ]);
    expect(await reminders.tick(new Date("2026-11-13T15:30:00Z"))).toBe(0);
    // На следующий день — снова.
    expect(await reminders.tick(new Date("2026-11-14T15:01:00Z"))).toBe(1);
  });

  it("не пишет, если всё куплено, если день недели выключен или напоминание выключено", async () => {
    const familyId = await familyWithItems(["Молоко"]);
    // Только по субботам (бит 5), а сегодня пятница.
    await call(dad, "POST", "/api/me/reminder", { enabled: true, time: "18:00", days: 1 << 5, timezone: "Europe/Moscow" });
    expect(await reminders.tick(FRIDAY_18_MSK)).toBe(0);

    await call(dad, "POST", "/api/me/reminder", { enabled: true, time: "18:00", days: ALL_DAYS, timezone: "Europe/Moscow" });
    const { data } = await call(mom, "GET", `/api/families/${familyId}/items`);
    await call(mom, "PATCH", `/api/items/${data.items[0].id}`, { done: true });
    expect(await reminders.tick(FRIDAY_18_MSK)).toBe(0);

    expect(sent).toEqual([]);
  });

  it("после долгого простоя сервера старое напоминание не догоняет", async () => {
    await familyWithItems(["Молоко"]);
    await call(dad, "POST", "/api/me/reminder", { enabled: true, time: "08:00", days: ALL_DAYS, timezone: "Europe/Moscow" });
    expect(await reminders.tick(FRIDAY_18_MSK)).toBe(0); // 18:00, опоздание 10 часов
  });
});
