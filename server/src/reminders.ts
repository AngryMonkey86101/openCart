import type { DB } from "./db.js";
import type { Notifier } from "./notifier.js";

export const DEFAULT_TIMEZONE = "Europe/Moscow";
/** Если сервер лежал и проснулся позже, напоминаем, только пока опоздание меньше этого окна. */
const LATE_WINDOW_MIN = 3 * 60;
const SHOW_ITEMS = 5;

export interface ReminderSettings {
  enabled: boolean;
  /** Местное время «ЧЧ:ММ». */
  time: string;
  /** Дни недели битами: Пн = 1, Вт = 2, … Вс = 64. */
  days: number;
  timezone: string;
}

export function isValidTimezone(tz: unknown): tz is string {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isValidTime(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

const WEEKDAYS: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Местная дата, минуты от полуночи и день недели (0 = Пн) в заданном часовом поясе. */
export function localClock(at: Date, timezone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday],
  };
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

interface Due {
  id: number;
  remind_time: string;
  remind_days: number;
  timezone: string | null;
  reminded_on: string | null;
}

/**
 * Раз в минуту проверяет, кому пора напомнить об активных списках (где есть некупленные товары),
 * и отправляет каждому одно сообщение по всем его спискам. Сообщения уходят тем же путём,
 * что и оповещения, — через посредника, потому что VPS может не достучаться до api.telegram.org.
 */
export class Reminders {
  private timer?: NodeJS.Timeout;

  constructor(
    private db: DB,
    private notifier: Notifier,
  ) {}

  start(intervalMs = 60_000) {
    this.timer = setInterval(() => this.tick().catch((err) => console.error("Напоминания:", err)), intervalMs);
    this.timer.unref();
  }

  stop() {
    clearInterval(this.timer);
  }

  async tick(at = new Date()): Promise<number> {
    if (!this.notifier.enabled) return 0;
    const users = this.db
      .prepare("SELECT id, remind_time, remind_days, timezone, reminded_on FROM users WHERE remind = 1")
      .all() as Due[];
    const markDone = this.db.prepare("UPDATE users SET reminded_on = ? WHERE id = ?");
    const messages: unknown[] = [];

    for (const u of users) {
      const tz = u.timezone && isValidTimezone(u.timezone) ? u.timezone : DEFAULT_TIMEZONE;
      const clock = localClock(at, tz);
      if (u.reminded_on === clock.date) continue;
      if (!(u.remind_days & (1 << clock.weekday))) continue;
      const [h, m] = u.remind_time.split(":").map(Number);
      const late = clock.minutes - (h * 60 + m);
      if (late < 0 || late >= LATE_WINDOW_MIN) continue;

      // Отмечаем день сразу: даже если списки пусты или посредник упал, второй раз за день не пишем.
      markDone.run(clock.date, u.id);
      const text = this.compose(u.id);
      if (text) messages.push({ chat_id: u.id, text, reply_markup: this.notifier.openButton() });
    }

    if (messages.length) {
      console.log(`Напоминания об активных списках: ${messages.length}`);
      await this.notifier.deliver(messages);
    }
    return messages.length;
  }

  /** Текст напоминания по всем спискам участника; null — покупать нечего. */
  compose(userId: number): string | null {
    const lists = this.db
      .prepare(
        `SELECT f.id, f.name FROM families f JOIN members m ON m.family_id = f.id
          WHERE m.user_id = ? AND EXISTS (SELECT 1 FROM items i WHERE i.family_id = f.id AND i.done = 0)
          ORDER BY m.joined_at`,
      )
      .all(userId) as { id: string; name: string }[];
    if (!lists.length) return null;

    const titles = this.db.prepare(
      "SELECT title FROM items WHERE family_id = ? AND done = 0 ORDER BY created_at DESC",
    );
    const blocks = lists.map((list) => {
      const all = titles.pluck().all(list.id) as string[];
      const shown = all.slice(0, SHOW_ITEMS).join(", ");
      const rest = all.length - SHOW_ITEMS;
      const tail = rest > 0 ? ` и ещё ${rest}` : "";
      return `«${list.name}» — ${all.length} ${plural(all.length, "товар", "товара", "товаров")}: ${shown}${tail}`;
    });
    return `🛒 Напоминание: есть что купить\n\n${blocks.join("\n")}`;
  }
}
