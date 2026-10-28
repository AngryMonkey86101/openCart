import { randomUUID, getRandomValues } from "node:crypto";
import { validateInitData, type TelegramUser } from "./auth.js";
import type { Config } from "./config.js";
import type { DB } from "./db.js";
import { inviteLink } from "./telegram.js";

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const now = () => Date.now();

function randomCode(len = 10): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join("");
}

async function readBody<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "invalid json");
  }
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().slice(0, max);
  return v.length ? v : null;
}

async function authenticate(request: Request, db: DB, config: Config): Promise<TelegramUser> {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("tma ")) throw new HttpError(401, "missing init data");
  const data = await validateInitData(header.slice(4), config.botToken);
  if (!data) throw new HttpError(401, "invalid init data");
  db.prepare(
    `INSERT INTO users (id, first_name, username) VALUES (@id, @name, @username)
     ON CONFLICT(id) DO UPDATE SET first_name = @name, username = @username`,
  ).run({ id: data.user.id, name: data.user.first_name, username: data.user.username ?? null });
  return data.user;
}

function requireMember(db: DB, familyId: string, userId: number) {
  const row = db.prepare("SELECT 1 FROM members WHERE family_id = ? AND user_id = ?").get(familyId, userId);
  if (!row) throw new HttpError(404, "list not found");
}

function itemFamily(db: DB, itemId: number): string {
  const row = db.prepare("SELECT family_id FROM items WHERE id = ?").get(itemId) as { family_id: string } | undefined;
  if (!row) throw new HttpError(404, "item not found");
  return row.family_id;
}

const EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type EventType = "added" | "done" | "undone";

/** Записывает событие для оповещений остальных участников; старше 30 дней — удаляет. */
function logEvent(db: DB, familyId: string, actorId: number, type: EventType, itemTitle: string) {
  const ts = now();
  db.prepare("INSERT INTO events (family_id, actor_id, type, item_title, created_at) VALUES (?, ?, ?, ?, ?)").run(
    familyId,
    actorId,
    type,
    itemTitle,
    ts,
  );
  db.prepare("DELETE FROM events WHERE family_id = ? AND created_at < ?").run(familyId, ts - EVENT_TTL_MS);
}

function listFamilies(db: DB, config: Config, userId: number) {
  const rows = db
    .prepare(
      `SELECT f.id, f.name, f.invite_code AS inviteCode,
              (SELECT COUNT(*) FROM members m2 WHERE m2.family_id = f.id) AS memberCount
         FROM families f JOIN members m ON m.family_id = f.id
        WHERE m.user_id = ? ORDER BY m.joined_at`,
    )
    .all(userId) as { id: string; name: string; inviteCode: string; memberCount: number }[];
  return rows.map((f) => ({ ...f, inviteLink: inviteLink(config, f.inviteCode) }));
}

async function route(request: Request, db: DB, config: Config, user: TelegramUser): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = request.method;

  // GET /api/me
  if (method === "GET" && parts[0] === "me") {
    return json({ user, families: listFamilies(db, config, user.id) });
  }

  // POST /api/families  { name }
  if (method === "POST" && parts[0] === "families" && parts.length === 1) {
    const body = await readBody<{ name?: unknown }>(request);
    const name = cleanText(body.name, 60) ?? "Наш список";
    const id = randomUUID();
    const ts = now();
    db.transaction(() => {
      db.prepare("INSERT INTO families (id, name, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, ?)").run(
        id,
        name,
        randomCode(),
        user.id,
        ts,
      );
      db.prepare("INSERT INTO members (family_id, user_id, joined_at) VALUES (?, ?, ?)").run(id, user.id, ts);
    })();
    return json({ id }, 201);
  }

  // POST /api/families/join  { code }
  if (method === "POST" && parts[0] === "families" && parts[1] === "join") {
    const body = await readBody<{ code?: unknown }>(request);
    const code = cleanText(body.code, 32);
    const family = code
      ? (db.prepare("SELECT id FROM families WHERE invite_code = ?").get(code) as { id: string } | undefined)
      : undefined;
    if (!family) throw new HttpError(404, "invite not found");
    db.prepare("INSERT OR IGNORE INTO members (family_id, user_id, joined_at) VALUES (?, ?, ?)").run(
      family.id,
      user.id,
      now(),
    );
    return json({ id: family.id });
  }

  // GET /api/families/:id/members — все участники могут отмечать покупки
  if (method === "GET" && parts[0] === "families" && parts[2] === "members") {
    requireMember(db, parts[1], user.id);
    const members = db
      .prepare(
        `SELECT u.id, u.first_name AS firstName, u.username, m.joined_at AS joinedAt,
                u.id = f.created_by AS isOwner
           FROM members m
           JOIN users u ON u.id = m.user_id
           JOIN families f ON f.id = m.family_id
          WHERE m.family_id = ?
          ORDER BY m.joined_at`,
      )
      .all(parts[1]) as { isOwner: number }[];
    return json({ members: members.map((m) => ({ ...m, isOwner: Boolean(m.isOwner) })) });
  }

  // GET /api/families/:id/events?after=<id> — изменения от других участников
  if (method === "GET" && parts[0] === "families" && parts[2] === "events") {
    requireMember(db, parts[1], user.id);
    const after = Number(url.searchParams.get("after") ?? 0) || 0;
    const events = db
      .prepare(
        `SELECT e.id, e.type, e.item_title AS itemTitle, e.created_at AS createdAt, u.first_name AS actor
           FROM events e JOIN users u ON u.id = e.actor_id
          WHERE e.family_id = ? AND e.id > ? AND e.actor_id != ?
          ORDER BY e.id DESC LIMIT 50`,
      )
      .all(parts[1], after, user.id);
    const last = db.prepare("SELECT MAX(id) FROM events WHERE family_id = ?").pluck().get(parts[1]) as number | null;
    return json({ events: events.reverse(), lastId: last ?? 0 });
  }

  // GET /api/families/:id/items
  if (method === "GET" && parts[0] === "families" && parts[2] === "items") {
    requireMember(db, parts[1], user.id);
    const rows = db
      .prepare(
        `SELECT i.id, i.title, i.qty, i.done, i.created_at AS createdAt, i.updated_at AS updatedAt,
                a.first_name AS addedBy, d.first_name AS doneBy
           FROM items i
           JOIN users a ON a.id = i.added_by
           LEFT JOIN users d ON d.id = i.done_by
          WHERE i.family_id = ?
          ORDER BY i.done, i.created_at DESC`,
      )
      .all(parts[1]) as { done: number }[];
    return json({ items: rows.map((r) => ({ ...r, done: Boolean(r.done) })) });
  }

  // POST /api/families/:id/items  { title, qty? }
  if (method === "POST" && parts[0] === "families" && parts[2] === "items") {
    requireMember(db, parts[1], user.id);
    const body = await readBody<{ title?: unknown; qty?: unknown }>(request);
    const title = cleanText(body.title, 120);
    if (!title) throw new HttpError(400, "title is required");
    const ts = now();
    const result = db
      .prepare(
        `INSERT INTO items (family_id, title, qty, added_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(parts[1], title, cleanText(body.qty, 30), user.id, ts, ts);
    logEvent(db, parts[1], user.id, "added", title);
    return json({ id: Number(result.lastInsertRowid) }, 201);
  }

  // POST /api/families/:id/clear-done
  if (method === "POST" && parts[0] === "families" && parts[2] === "clear-done") {
    requireMember(db, parts[1], user.id);
    db.prepare("DELETE FROM items WHERE family_id = ? AND done = 1").run(parts[1]);
    return json({ ok: true });
  }

  // PATCH /api/items/:id  { done?, title?, qty? }
  if (method === "PATCH" && parts[0] === "items" && parts[1]) {
    const itemId = Number(parts[1]);
    const familyId = itemFamily(db, itemId);
    requireMember(db, familyId, user.id);
    const body = await readBody<{ done?: unknown; title?: unknown; qty?: unknown }>(request);
    const ts = now();
    const before = db.prepare("SELECT title, done FROM items WHERE id = ?").get(itemId) as { title: string; done: number };
    if (typeof body.done === "boolean" && body.done !== Boolean(before.done)) {
      logEvent(db, familyId, user.id, body.done ? "done" : "undone", before.title);
    }
    if (typeof body.done === "boolean") {
      db.prepare("UPDATE items SET done = ?, done_by = ?, updated_at = ? WHERE id = ?").run(
        body.done ? 1 : 0,
        body.done ? user.id : null,
        ts,
        itemId,
      );
    }
    const title = cleanText(body.title, 120);
    if (title || body.qty !== undefined) {
      db.prepare("UPDATE items SET title = COALESCE(?, title), qty = ?, updated_at = ? WHERE id = ?").run(
        title,
        cleanText(body.qty, 30),
        ts,
        itemId,
      );
    }
    return json({ ok: true });
  }

  // DELETE /api/items/:id
  if (method === "DELETE" && parts[0] === "items" && parts[1]) {
    const itemId = Number(parts[1]);
    requireMember(db, itemFamily(db, itemId), user.id);
    db.prepare("DELETE FROM items WHERE id = ?").run(itemId);
    return json({ ok: true });
  }

  throw new HttpError(404, "not found");
}

export async function handleApi(request: Request, db: DB, config: Config): Promise<Response> {
  try {
    const user = await authenticate(request, db, config);
    return await route(request, db, config, user);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "internal error" }, 500);
  }
}
