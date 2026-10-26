import { validateInitData, type TelegramUser } from "./auth";
import type { Env } from "./env";
import { inviteLink } from "./telegram";

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
  const bytes = crypto.getRandomValues(new Uint8Array(len));
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

async function authenticate(request: Request, env: Env): Promise<TelegramUser> {
  const header = request.headers.get("Authorization") ?? "";
  if (!header.startsWith("tma ")) throw new HttpError(401, "missing init data");
  const data = await validateInitData(header.slice(4), env.BOT_TOKEN);
  if (!data) throw new HttpError(401, "invalid init data");
  await env.DB.prepare(
    `INSERT INTO users (id, first_name, username) VALUES (?1, ?2, ?3)
     ON CONFLICT(id) DO UPDATE SET first_name = ?2, username = ?3`,
  )
    .bind(data.user.id, data.user.first_name, data.user.username ?? null)
    .run();
  return data.user;
}

async function requireMember(env: Env, familyId: string, userId: number) {
  const row = await env.DB.prepare("SELECT 1 FROM members WHERE family_id = ?1 AND user_id = ?2")
    .bind(familyId, userId)
    .first();
  if (!row) throw new HttpError(404, "list not found");
}

async function itemFamily(env: Env, itemId: number): Promise<string> {
  const row = await env.DB.prepare("SELECT family_id FROM items WHERE id = ?1")
    .bind(itemId)
    .first<{ family_id: string }>();
  if (!row) throw new HttpError(404, "item not found");
  return row.family_id;
}

async function listFamilies(env: Env, userId: number) {
  const { results } = await env.DB.prepare(
    `SELECT f.id, f.name, f.invite_code AS inviteCode,
            (SELECT COUNT(*) FROM members m2 WHERE m2.family_id = f.id) AS memberCount
       FROM families f JOIN members m ON m.family_id = f.id
      WHERE m.user_id = ?1 ORDER BY m.joined_at`,
  )
    .bind(userId)
    .all<{ id: string; name: string; inviteCode: string; memberCount: number }>();
  return results.map((f) => ({ ...f, inviteLink: inviteLink(env, f.inviteCode) }));
}

async function route(request: Request, env: Env, user: TelegramUser): Promise<Response> {
  const url = new URL(request.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const method = request.method;

  // GET /api/me
  if (method === "GET" && parts[0] === "me") {
    return json({ user, families: await listFamilies(env, user.id) });
  }

  // POST /api/families  { name }
  if (method === "POST" && parts[0] === "families" && parts.length === 1) {
    const body = await readBody<{ name?: unknown }>(request);
    const name = cleanText(body.name, 60) ?? "Наш список";
    const id = crypto.randomUUID();
    const ts = now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO families (id, name, invite_code, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
        .bind(id, name, randomCode(), user.id, ts),
      env.DB.prepare("INSERT INTO members (family_id, user_id, joined_at) VALUES (?1, ?2, ?3)").bind(id, user.id, ts),
    ]);
    return json({ id }, 201);
  }

  // POST /api/families/join  { code }
  if (method === "POST" && parts[0] === "families" && parts[1] === "join") {
    const body = await readBody<{ code?: unknown }>(request);
    const code = cleanText(body.code, 32);
    const family = code
      ? await env.DB.prepare("SELECT id FROM families WHERE invite_code = ?1").bind(code).first<{ id: string }>()
      : null;
    if (!family) throw new HttpError(404, "invite not found");
    await env.DB.prepare("INSERT OR IGNORE INTO members (family_id, user_id, joined_at) VALUES (?1, ?2, ?3)")
      .bind(family.id, user.id, now())
      .run();
    return json({ id: family.id });
  }

  // GET /api/families/:id/items
  if (method === "GET" && parts[0] === "families" && parts[2] === "items") {
    await requireMember(env, parts[1], user.id);
    const { results } = await env.DB.prepare(
      `SELECT i.id, i.title, i.qty, i.done, i.created_at AS createdAt, i.updated_at AS updatedAt,
              a.first_name AS addedBy, d.first_name AS doneBy
         FROM items i
         JOIN users a ON a.id = i.added_by
         LEFT JOIN users d ON d.id = i.done_by
        WHERE i.family_id = ?1
        ORDER BY i.done, i.created_at DESC`,
    )
      .bind(parts[1])
      .all();
    return json({ items: results.map((r) => ({ ...r, done: Boolean(r.done) })) });
  }

  // POST /api/families/:id/items  { title, qty? }
  if (method === "POST" && parts[0] === "families" && parts[2] === "items") {
    await requireMember(env, parts[1], user.id);
    const body = await readBody<{ title?: unknown; qty?: unknown }>(request);
    const title = cleanText(body.title, 120);
    if (!title) throw new HttpError(400, "title is required");
    const ts = now();
    const row = await env.DB.prepare(
      `INSERT INTO items (family_id, title, qty, added_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5) RETURNING id`,
    )
      .bind(parts[1], title, cleanText(body.qty, 30), user.id, ts)
      .first<{ id: number }>();
    return json({ id: row?.id }, 201);
  }

  // POST /api/families/:id/clear-done
  if (method === "POST" && parts[0] === "families" && parts[2] === "clear-done") {
    await requireMember(env, parts[1], user.id);
    await env.DB.prepare("DELETE FROM items WHERE family_id = ?1 AND done = 1").bind(parts[1]).run();
    return json({ ok: true });
  }

  // PATCH /api/items/:id  { done?, title?, qty? }
  if (method === "PATCH" && parts[0] === "items" && parts[1]) {
    const itemId = Number(parts[1]);
    await requireMember(env, await itemFamily(env, itemId), user.id);
    const body = await readBody<{ done?: unknown; title?: unknown; qty?: unknown }>(request);
    const ts = now();
    if (typeof body.done === "boolean") {
      await env.DB.prepare("UPDATE items SET done = ?1, done_by = ?2, updated_at = ?3 WHERE id = ?4")
        .bind(body.done ? 1 : 0, body.done ? user.id : null, ts, itemId)
        .run();
    }
    const title = cleanText(body.title, 120);
    if (title || body.qty !== undefined) {
      await env.DB.prepare("UPDATE items SET title = COALESCE(?1, title), qty = ?2, updated_at = ?3 WHERE id = ?4")
        .bind(title, cleanText(body.qty, 30), ts, itemId)
        .run();
    }
    return json({ ok: true });
  }

  // DELETE /api/items/:id
  if (method === "DELETE" && parts[0] === "items" && parts[1]) {
    const itemId = Number(parts[1]);
    await requireMember(env, await itemFamily(env, itemId), user.id);
    await env.DB.prepare("DELETE FROM items WHERE id = ?1").bind(itemId).run();
    return json({ ok: true });
  }

  throw new HttpError(404, "not found");
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  try {
    const user = await authenticate(request, env);
    return await route(request, env, user);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error(err);
    return json({ error: "internal error" }, 500);
  }
}
