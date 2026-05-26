# Fixture 01 / Variation: express-requireAuth

**Bug**: `/api/admin/export` ships full user data with no auth check.
**Fix**: route mounts `requireAuth()` middleware in front of the handler.

**What Pinned should do:**
1. See in the fix diff that `src/routes/admin.ts` added a `requireAuth()` call.
2. Generate an `auth-required` pin with the captured signature.
3. Run the pin at the fixed commit → file contains `requireAuth()` → **pass**.
4. Run the pin at the parent commit → file does NOT contain `requireAuth()` → **fail**.
5. Verdict: `real-catch` ★

This proves the canonical Express `requireAuth()` middleware pattern works.

Related variations of this same fixture (other auth-helper idioms):
- `fastify-app-hook/` — Fastify `app.addHook('preHandler', requireAuth)`
- `custom-helper/` — bespoke `authHeaders()` / `ensureAuthed()` style helpers (Quantasyte's shape)
