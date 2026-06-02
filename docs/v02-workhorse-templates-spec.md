# v0.2 — Three Workhorse Templates: spec

Status: **DECISIONS LOCKED 2026-06-02** — open questions are closed. Implementation can start.

Source of priority: Claude session feedback on 2026-06-02 — *"Until you cover ~8-10 common contract shapes, the conversation with a paying customer is 'I love this, but my codebase has 40 contracts and you can pin 4.' That's a hard sell."* The three below are the most universal subset of Claude's 8-10 goal:

1. **`page-renders`** — *"GET /path renders an HTML response without React-error markers"*
2. **`validation-rejects-bad`** — *"POST /api/X with each of {missing required field, bad type, oversized payload, malformed JSON} returns 4xx"*
3. **`happy-path-with-side-effect`** — *"POST /api/X with valid body returns 200 AND a downstream side-effect is verifiably emitted"* (via Option C — `X-Pinned-Side-Effect` response header, with the wrapper added by the customer's AI agent via the new AI-instruction primitive)

The other ~5 from Claude's broader list (form-validation-error-shows, redirect-after-action, session-set, CORS, email-sent, etc.) defer to v0.3+ — we'll prioritize them based on which feedback we get most often after v0.2 ships.

---

## Locked decisions (2026-06-02)

Per the [[frictionless-onboarding-required]] memory + the user's "minimal user friction is always the answer" + "AI can do setup, no human intervention" constraints:

- **Q1 (side-effect kinds) → db-write only for v0.2.** Other kinds (queue-enqueue, email-send, storage-write) use the same X-Pinned-Side-Effect header convention; the wrapper extends trivially in v0.3+ based on customer demand.
- **Q2 (happy-path mechanism) → Option C: X-Pinned-Side-Effect response header.** Customer's AI agent adds a ~5-10 LOC wrapper via a new AGENT SETUP REQUIRED prompt primitive. No DB connection, no polling endpoint, no per-provider SDK plumbing. Recursive protection: once added, the wrapper is itself guarded by Pinned.
- **Q3 (approve Option A polling) → no.** Polling requires 30-50 LOC from the AI, new auth surface, and per-framework variation. Option C wins on every axis.
- **Q4 (polling endpoint config) → mooted by Q3.**
- **Q5 (page-renders min bytes) → 500 default, configurable per-pin.**
- **Q6 (page-renders auth handling) → re-use `authResponseIsValid` from auth-required template.** Accepts login-redirect / login-form / 401/403 as legitimate "this page is auth-gated, not broken."
- **Q7 (validation-rejects-bad — one pin or N pins) → one pin with N sub-tests.** Matches existing multi-direction pattern (auth-required, permission-required).

---

## 1. `page-renders`

### Claim shape

```ts
export type PageRendersClaim = {
  template: "page-renders";
  route: string;              // "/about", "/dashboard"
  minBodyBytes?: number;      // default 500, configurable per-pin
  raw: string;
};
```

### Parser phrasings

- `GET /path renders` / `GET /path renders without crashing`
- `Page /path renders`
- `/path returns a working page` / `/path returns a rendered page`

### Test mechanism (emitted to customer's tests/pinned/)

```ts
const res = await pinnedFetch(PREVIEW_URL + ROUTE, {
  method: "GET",
  headers: { Accept: "text/html" },
  redirect: "manual",
});

// Auth-gated pages: re-use the auth validator. Login-redirect /
// login-form / 401/403 all count as "auth-gated but not broken."
if (looksAuthGated(res)) {
  // skip — out of scope for page-renders; the auth-required pin
  // for this route covers auth verification separately
  return;
}

// Live render: 200 (or 304) with non-empty HTML body, no error markers.
expect([200, 304]).toContain(res.status);
const body = await res.text();
expect(body.length).toBeGreaterThanOrEqual(MIN_BODY_BYTES);
expect(body).toMatch(/<html/i);
for (const marker of ERROR_MARKERS) {
  expect(body).not.toContain(marker);
}
```

Error markers:
- `Application error: a client-side exception` (Next.js client error overlay)
- `Internal Server Error` (Next.js default 500 page)
- `__NEXT_ERROR_CODE` (Next.js error boundary)
- `Cannot read prop` / `Cannot read property` (React common runtime errors)
- `Uncaught (in promise)` (unhandled rejection)
- `ReferenceError:` / `TypeError:` exposed in HTML (bundler swallowing failed)
- `[Vue warn]` (Vue render error)
- `Vite Error` / `[vite]` overlay markers

### Customer setup required

**None.** Auto-protect detects rendered pages from existing route files; the parser handles natural-language claim phrasings. Test runs against `PREVIEW_URL` (already required by the framework).

### False-positive risks + mitigation

- **Hydration mismatch in dev mode** → not a concern; PREVIEW_URL is prod-shaped.
- **CDN-cached error page served as 200** → error markers catch the body content.
- **Legitimately small pages (single-paragraph landing)** → per-pin `minBodyBytes` override.
- **Skeleton/loading states with low byte count** → server-rendered pages always include skeleton + initial state; if a real customer hits this, they override `minBodyBytes`.

### FP-check plan

Before shipping:
1. `pinnedai.dev` — Vite SPA. Run pin generation, confirm pass.
2. `quantasyte` — Vite app. Same.
3. `socialideagen` — Next.js app router with SSR. Same.
4. Adversarial: deliberately introduce a render error (broken import in a page component), confirm pin fails with clear error.

### Estimated effort: ~1.5 working days (11 hrs)

---

## 2. `validation-rejects-bad`

### Claim shape

```ts
export type ValidationRejectsBadClaim = {
  template: "validation-rejects-bad";
  route: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  fields: Array<{
    name: string;
    type: "string" | "number" | "boolean" | "object" | "array";
    required: boolean;
  }>;
  // Cases to test (default all). Empty body means require auto-detection.
  cases?: Array<"missing-required" | "wrong-type" | "oversized" | "malformed-json">;
  raw: string;
};
```

### Parser phrasings

- `POST /api/X validates body schema Y`
- `POST /api/X requires fields A, B, C`
- `POST /api/X rejects bodies without [field]`
- `POST /api/X rejects oversized bodies`

### Schema auto-detection

At pin-generation time, the auto-protect detector looks for:
- **zod**: `z.object({ ... })` with `.required()` / required keys
- **yup**: `yup.object().shape({ ... .required() })`
- **joi**: `Joi.object({ ... }).required()`
- **Manual**: `if (!req.body.X) return res.status(400)` patterns

When schema is detected, the auto-generated pin includes the field list + types. When not detected, falls back to:
- `missing-required` — POST with empty body, expect 4xx
- `malformed-json` — POST with `not-json`, expect 400 (or 415)

### Test mechanism

```ts
describe("validation-rejects-bad: " + METHOD + " " + ROUTE, () => {
  if (cases.includes("missing-required")) {
    for (const field of REQUIRED_FIELDS) {
      it("rejects body missing required field: " + field.name, async () => {
        const body = buildValidBody();
        delete body[field.name];
        const res = await pinnedFetch(url, { method, body: JSON.stringify(body) });
        expect(res.status).toBeGreaterThanOrEqual(400);
        expect(res.status).toBeLessThan(500);
      });
    }
  }
  if (cases.includes("wrong-type")) {
    for (const field of FIELDS_WITH_TYPES) {
      it("rejects body with wrong type for " + field.name, async () => {
        const body = buildValidBody();
        body[field.name] = wrongTypeFor(field.type);
        // ...
      });
    }
  }
  // oversized + malformed-json sub-tests similar
});
```

Each sub-test independently `expect(res.status).toBe(4xx)`; one pin overall.

### Customer setup required

**None.** Schema is auto-detected. If detection misses, the pin falls back to the minimal `missing-required` + `malformed-json` cases.

### Required fixtures / env

- `PREVIEW_URL`
- Auth token if the route requires auth (re-use existing `PREVIEW_TEST_TOKEN_AUTH` convention)

### False-positive risks + mitigation

- **Endpoint legitimately accepts oversized payloads** (file upload, logs) → schema detection sees high `bodyParser.sizeLimit` or no limit, skip the `oversized` case for that route.
- **Endpoint coerces types** (number ↔ string) → for non-strict schemas (no `.strict()`), skip `wrong-type` case.
- **Schema detection misses the actual validation** → pin's failure message lists exactly which fields were tested + which the customer can override in PINS.md.

### FP-check plan

1. `quantasyte` POST /api/signup, /api/billing endpoints. Confirm sub-tests detect required fields from zod schemas.
2. `socialideagen` POST /api/admin/login. Confirm method-aware test (#45 fix).
3. Adversarial: remove a required-field check from a quantasyte endpoint, confirm the pin catches.

### Estimated effort: ~2.5 working days (20 hrs)

---

## 3. `happy-path-with-side-effect` — Option C (X-Pinned-Side-Effect header)

### Claim shape

```ts
export type HappyPathWithSideEffectClaim = {
  template: "happy-path-with-side-effect";
  route: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  sideEffect: {
    kind: "db-write";              // v0.2 scope; other kinds in v0.3+
    target: string;                // table/model name
  };
  raw: string;
};
```

### Parser phrasings

- `POST /api/X creates a Y record` (route + action + table)
- `POST /api/X writes a row to Y`
- `POST /api/X with valid body returns 200 + writes Y row`

### Test mechanism

```ts
const validBody = buildValidBody();
const res = await pinnedFetch(PREVIEW_URL + ROUTE, {
  method: METHOD,
  headers: {
    "content-type": "application/json",
    "X-Pinned-Test": "1",
  },
  body: JSON.stringify(validBody),
});

expect(res.status).toBe(200);

const sideEffectKind = res.headers.get("X-Pinned-Side-Effect");
const sideEffectTarget = res.headers.get("X-Pinned-Side-Effect-Target");
const sideEffectId = res.headers.get("X-Pinned-Side-Effect-Id");

if (!sideEffectKind || !sideEffectId) {
  throw new Error(
    "Pinned: " + METHOD + " " + ROUTE + " returned 200 but no X-Pinned-Side-Effect headers. " +
    "The endpoint may be a stub returning 200 without doing the work (misleading-green). " +
    "Add the side-effect wrapper to your route handler — see https://pinnedai.dev/docs/x-pinned-side-effect"
  );
}

expect(sideEffectKind).toBe(EXPECTED_KIND);  // "db-write"
expect(sideEffectTarget).toBe(EXPECTED_TARGET);  // "users"
expect(sideEffectId).toBeTruthy();
```

### Customer setup required (done by AI agent, not human)

Add a response wrapper to the route handler (~5-10 LOC). For Next.js app router:

```ts
export async function POST(req: Request) {
  const body = await req.json();
  const result = await createUser(body);    // existing logic
  return Response.json(result, {
    headers: req.headers.get("X-Pinned-Test") === "1" ? {
      "X-Pinned-Side-Effect": "db-write",
      "X-Pinned-Side-Effect-Target": "users",
      "X-Pinned-Side-Effect-Id": result.id,
    } : {},
  });
}
```

This wrapper:
- Only emits headers when `X-Pinned-Test: 1` is set → zero impact on prod traffic
- Once added, IS guarded by Pinned itself → AI can't silently remove it
- ~5-10 LOC, framework-pattern-matching

`pinned init` emits the wrapper code as part of a new **AGENT SETUP REQUIRED** prompt that the customer's AI agent reads + executes. See task #50 below.

### FP-check plan

1. quantasyte POST /api/signup — AI adds wrapper, generate pin, verify it passes.
2. socialideagen POST endpoints — same.
3. Adversarial: remove the wrapper, confirm pin fails with a clear "endpoint may be a stub" message.

### Estimated effort: ~3 working days (24 hrs) — includes the AI-instruction primitive

---

## AI-instruction primitive (foundational for #3 + future templates)

`pinned init` (and `pinned generate` for new pins) now emits structured prompts when a pin needs customer-side instrumentation. The block:

```
════════════════════════════════════════════════════════
AGENT SETUP REQUIRED — Pinned needs side-effect instrumentation on
POST /api/signup so the happy-path-with-side-effect pin can verify
the endpoint actually wrote a row (not just returned 200).

Add this wrapper to the route handler:

  // In app/api/signup/route.ts (or your route handler):
  <framework-specific snippet>

The wrapper:
  - Emits X-Pinned-Side-Effect headers ONLY on requests carrying
    X-Pinned-Test: 1 (no impact on production traffic).
  - Lets Pinned verify the side-effect actually happened on every
    test run. Without it, a stub returning {ok: true} would pass.

After you add it, run `npx pinnedai generate --pr-id <id>` to
create the pin.
════════════════════════════════════════════════════════
```

The prompt is **framework-aware** — Pinned detects Next.js (app/pages router) vs Express vs Fastify vs Hono and emits the matching snippet. Falls back to a generic Node response-headers example for unknown frameworks.

The prompt is **idempotent** — if the wrapper is already present, Pinned skips the prompt.

The prompt is **human-readable** — customers without AI agents can copy-paste the snippet manually.

This primitive is reusable: any future template that needs customer-side instrumentation uses the same prompt shape.

### Estimated effort: ~1 working day (8 hrs), folded into Template 3's estimate

---

## Ship order + total effort

| Order | Template / Component | Effort | Risk |
|---|---|---|---|
| 1 | `page-renders` | ~1.5 days | Low — no customer setup, simplest mechanism |
| 2 | `validation-rejects-bad` | ~2.5 days | Medium — schema detection is the new surface |
| 3 | AI-instruction primitive + `happy-path-with-side-effect` | ~3 days | Higher — depends on AI agent quality on customer side |

**Total v0.2 scope: ~7 working days.** Each template ships in its own dot-release (0.2.0, 0.2.1, 0.2.2) with its own CHANGELOG entry + README update + FP-check per [[readme-updates-with-every-release]] and [[fp-check-everything-with-real-tests]].

Future templates (form-validation-error-shows, redirect-after-action, session-set, CORS, email-sent, file-uploaded, etc.) ship in v0.3+ as feedback indicates which are most-requested.
