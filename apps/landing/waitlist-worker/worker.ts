// Cloudflare Worker — Founder Pro waitlist email collector.
//
// Deploy:
//   1. cd apps/landing/waitlist-worker
//   2. npx wrangler login   (one time)
//   3. npx wrangler kv:namespace create PINNED_WAITLIST    (one time)
//      Copy the returned id into wrangler.toml.
//   4. npx wrangler deploy
//   5. Copy the deployed URL.
//   6. Set VITE_PINNED_WAITLIST_ENDPOINT=<url> in the landing build env.
//
// What it does:
//   - POST /  { email, mostWantedFeature?, source }  → 200 { ok: true }
//   - GET  /count  → 200 { count: N }   (for ops dashboards)
//
// Storage: a single KV namespace (PINNED_WAITLIST). Each signup is one
// key (email-as-key) so a returning email overwrites rather than dupes.
// CORS open to pinnedai.dev + preview deployments.

export interface Env {
  PINNED_WAITLIST: KVNamespace;
  ALLOWED_ORIGINS?: string;  // comma-separated, e.g. "https://pinnedai.dev,http://localhost:5173"
}

const DEFAULT_ALLOWED = [
  "https://pinnedai.dev",
  "https://www.pinnedai.dev",
  "http://localhost:5173",
  "http://localhost:4173",
];

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const allowed = (env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const list = allowed.length > 0 ? allowed : DEFAULT_ALLOWED;
  const origin = req.headers.get("Origin") ?? "";
  const match = list.includes(origin) ? origin : list[0];
  return {
    "Access-Control-Allow-Origin": match,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(body: unknown, status: number, cors: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(req, env);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(req.url);
    if (req.method === "GET" && url.pathname === "/count") {
      // Best-effort count — KV list is paginated, but for waitlist
      // size this is reasonable.
      const list = await env.PINNED_WAITLIST.list({ limit: 1000 });
      return jsonResponse({ count: list.keys.length, truncated: list.list_complete === false }, 200, cors);
    }

    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, cors);
    }

    let payload: { email?: string; mostWantedFeature?: string; source?: string; submittedAt?: string };
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400, cors);
    }

    const email = (payload.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@") || email.length > 254) {
      return jsonResponse({ error: "Invalid email" }, 400, cors);
    }

    const record = {
      email,
      mostWantedFeature: payload.mostWantedFeature ?? "",
      source: payload.source ?? "unknown",
      submittedAt: payload.submittedAt ?? new Date().toISOString(),
      userAgent: req.headers.get("User-Agent") ?? "",
      cf: { country: (req as Request & { cf?: { country?: string } }).cf?.country ?? "" },
    };

    try {
      await env.PINNED_WAITLIST.put(email, JSON.stringify(record));
    } catch (e) {
      return jsonResponse({ error: "Storage write failed", detail: (e as Error).message }, 500, cors);
    }

    return jsonResponse({ ok: true, email }, 200, cors);
  },
};
