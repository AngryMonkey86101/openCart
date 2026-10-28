import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { handleApi } from "./api.js";
import { handleWebhook } from "./bot.js";
import type { Config } from "./config.js";
import type { DB } from "./db.js";
import { Notifier } from "./notifier.js";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

async function serveStatic(pathname: string, config: Config): Promise<Response> {
  const root = resolve(config.staticDir);
  const file = resolve(join(root, normalize(decodeURIComponent(pathname))));
  if (file.startsWith(root + "/") && extname(file)) {
    try {
      const body = await readFile(file);
      // Имена файлов в assets/ содержат хэш, их можно кэшировать надолго.
      const cache = pathname.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache";
      return new Response(body, {
        headers: { "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream", "cache-control": cache },
      });
    } catch {
      // Нет такого файла: отдаём index.html ниже.
    }
  }
  const index = await readFile(join(root, "index.html"));
  return new Response(index, { headers: { "content-type": CONTENT_TYPES[".html"], "cache-control": "no-cache" } });
}

export function createApp(db: DB, config: Config, notifier = new Notifier(db, config)) {
  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) return handleApi(request, { db, config, notifier });
    if (pathname === "/bot/webhook" && request.method === "POST") return handleWebhook(request, db, config);
    if (pathname === "/healthz") return new Response("ok");
    return serveStatic(pathname, config);
  };
}
