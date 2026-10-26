import { handleApi } from "./api";
import { handleWebhook } from "./bot";
import type { Env } from "./env";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith("/api/")) return handleApi(request, env);
    if (pathname === "/bot/webhook" && request.method === "POST") return handleWebhook(request, env);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
