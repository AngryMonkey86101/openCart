import type { Config } from "./config.js";
import type { DB } from "./db.js";

export type EventType = "added" | "done" | "undone";

interface PendingEvent {
  actorId: number;
  actorName: string;
  type: EventType;
  itemTitle: string;
}

const ACTIONS: Record<EventType, string> = {
  added: "добавил(а)",
  done: "купил(а)",
  undone: "вернул(а) в список",
};

/**
 * Отправляет оповещения в Telegram через посредника (bot-relay/worker.js), потому что
 * сервер может не иметь доступа к api.telegram.org. События копятся BATCH_MS и уходят
 * одним сообщением, чтобы десяток отметок подряд не превращался в десяток сообщений.
 */
export class Notifier {
  private pending = new Map<string, { events: PendingEvent[]; timer: NodeJS.Timeout }>();

  constructor(
    private db: DB,
    private config: Config,
    private batchMs = 30_000,
    private send: (messages: unknown[]) => Promise<void> = (messages) => this.post(messages),
  ) {}

  get enabled(): boolean {
    return Boolean(this.config.notifyRelayUrl && this.config.notifyRelaySecret);
  }

  push(familyId: string, event: PendingEvent) {
    if (!this.enabled) return;
    const entry = this.pending.get(familyId);
    if (entry) {
      entry.events.push(event);
      return;
    }
    const timer = setTimeout(() => this.flush(familyId), this.batchMs);
    timer.unref();
    this.pending.set(familyId, { events: [event], timer });
  }

  /** Отправить накопленное сразу (при остановке сервера и в тестах). */
  async flushAll() {
    await Promise.all([...this.pending.keys()].map((id) => this.flush(id)));
  }

  private async flush(familyId: string) {
    const entry = this.pending.get(familyId);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(familyId);

    const family = this.db.prepare("SELECT name FROM families WHERE id = ?").get(familyId) as { name: string } | undefined;
    if (!family) return;
    const recipients = this.db
      .prepare("SELECT u.id FROM members m JOIN users u ON u.id = m.user_id WHERE m.family_id = ? AND u.notify = 1")
      .pluck()
      .all(familyId) as number[];

    const button = this.config.botAppName
      ? { inline_keyboard: [[{ text: "Открыть список", url: `https://t.me/${this.config.botUsername}/${this.config.botAppName}` }]] }
      : undefined;
    const messages = recipients.flatMap((chatId) => {
      // Свои действия человеку не присылаем.
      const lines = entry.events.filter((e) => e.actorId !== chatId).map((e) => `${e.actorName} ${ACTIONS[e.type]} «${e.itemTitle}»`);
      if (!lines.length) return [];
      return [{ chat_id: chatId, text: `🛒 ${family.name}\n${lines.join("\n")}`, reply_markup: button }];
    });
    if (!messages.length) {
      console.log(`Оповещения для «${family.name}»: некому отправлять (никто, кроме автора, не включил оповещения)`);
      return;
    }
    try {
      await this.send(messages);
    } catch (err) {
      console.error("Не удалось отправить оповещения:", (err as Error).message);
    }
  }

  private async post(messages: unknown[]) {
    const res = await fetch(`${this.config.notifyRelayUrl!.replace(/\/+$/, "")}/notify`, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Relay-Secret": this.config.notifyRelaySecret! },
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`посредник ответил ${res.status}${res.status === 403 ? " (не совпадает RELAY_SECRET)" : ""}`);
    // Ответ посредника: по строке на получателя, ошибки Telegram пишем в лог.
    const { results = [] } = (await res.json().catch(() => ({}))) as {
      results?: { chat_id: number; ok: boolean; error?: string }[];
    };
    for (const r of results) {
      if (r.ok) console.log(`Оповещение отправлено пользователю ${r.chat_id}`);
      else console.error(`Telegram не принял оповещение для ${r.chat_id}: ${r.error}`);
    }
  }
}
