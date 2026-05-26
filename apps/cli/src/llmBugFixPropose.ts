// LLM-as-proposer for bug-fix diffs (BYOK mode).
//
// Sibling to llmDirect.ts but operates on commit-diff context rather
// than PR-body text. The job: take a commit (message + body + per-file
// added lines) and propose CANDIDATE pins for behavioral patterns the
// regex detectors might miss (custom-naming helpers, cross-language
// fixes, etc.).
//
// Strict-enum architecture per memory
// [[llm-proposer-deterministic-verifier-split]]:
//   1. LLM gets minimum-necessary context (commit msg + diff hunks +
//      file paths). NO whole codebase. NO secrets (caller redacts).
//   2. LLM outputs JSON matching a FIXED enum of templates we already
//      support. Anything else gets rejected by the schema validator.
//   3. The "signature" each candidate names MUST appear verbatim in
//      the added lines we sent. We verify this BEFORE turning it into
//      a Claim — the LLM cannot hallucinate signatures that aren't
//      in the code.
//   4. Same deterministic templates render the test code (LLM never
//      writes a test).
//   5. Same replay logic decides pass/fail (LLM never decides
//      verdicts).
//
// Gate: only fires when BYOK is active (PINNEDAI_BYOK + the
// matching PINNEDAI_*_KEY env vars set). Free-tier OIDC path will be
// added when the Worker endpoint is deployed; for now BYOK is the
// only way to opt in.

import { activeByokProvider, type ByokProvider } from "./llmDirect.js";

// Strict template enum the LLM is allowed to propose. Mirrors what
// the deterministic detectors produce + what the templates can
// actually generate tests for. Adding a new entry requires both a
// template implementation AND a static-mode verifier — never expand
// this just to "let the LLM try more things."
const ALLOWED_TEMPLATES = [
  "auth-required",
  "returns-status",
  "idempotent",
  "rate-limit",
  "permission-required",
  // Phase 1+2 (2026-05-25): expand the LLM proposer's enum so it can
  // discover custom-named patterns the regex set misses for the new
  // dyad-style template families.
  "url-literal-preserved",
  "module-export-stable",
  "react-route-registered",
  "webhook-handler-exists",
  "import-path-resolves",
  "changed-literal-preserved",
] as const;
type AllowedTemplate = (typeof ALLOWED_TEMPLATES)[number];

export type BugFixCandidate = {
  template: AllowedTemplate;
  // Repo-relative path of the file the fix touched.
  filePath: string;
  // The signature snippet the LLM observed in the added lines.
  // We verify this appears verbatim in the actual diff before
  // accepting the candidate.
  signature: string;
  // Optional logical route name — for client files the LLM is told
  // to use `client:<rel-path>` convention, matching our existing
  // synthetic route naming.
  route?: string;
  // Optional bad-case description used to populate the layman
  // catch surfacing's userImpact. Free-form text capped at 200
  // chars — anything longer gets truncated.
  badCase?: string;
  // For returns-status only — the HTTP method. Defaults to "POST"
  // when omitted.
  method?: "POST" | "PUT" | "PATCH";
  // For rate-limit only — requests per minute the route now caps at.
  // Pulled from the signature when the LLM identifies the limit value;
  // backtest dispatcher falls back to 60 when missing.
  rate?: number;
  // For idempotent only — the payload field the dedupe key is built
  // from (event_id, msg_id, idempotency-key, signature, etc.).
  idField?: string;
  // Phase 1+2 fields (new templates the LLM is now allowed to propose):
  urlLiteral?: string;          // url-literal-preserved
  exportName?: string;          // module-export-stable
  routePath?: string;           // react-route-registered
  routerFilePath?: string;      // react-route-registered (file separate from filePath when different)
  handlerSignature?: string;    // webhook-handler-exists
  provider?: string;            // webhook-handler-exists
  importPath?: string;          // import-path-resolves
  sourceFilePath?: string;      // import-path-resolves
  oldValue?: string;            // changed-literal-preserved
  newValue?: string;            // changed-literal-preserved
  literalShape?: "url" | "host-url" | "status-code" | "env-key" | "route-path"; // changed-literal-preserved
};

export type LlmBugFixResult =
  | { ok: true; candidates: BugFixCandidate[]; provider: ByokProvider; rawTokens?: number }
  | { ok: false; reason: "byok-not-activated" }
  | { ok: false; reason: "byok-key-missing"; provider: ByokProvider }
  | { ok: false; reason: "claude-code-not-installed" }
  | { ok: false; reason: "error"; error: string }
  | { ok: false; reason: "noop"; note: string }; // commit not worth proposing on

const SYSTEM_PROMPT = `You inspect a git commit (message + per-file added lines) and propose
PIN CANDIDATES for behavioral patterns the user's bug fix introduced.
Your output becomes regression guards future code changes must pass.

STRICT RULES (violating these breaks the product):

1. ONLY propose candidates for these exact templates:
   - "auth-required"   — fix added an auth check (header inspection,
                          requireAuth-style middleware, session check,
                          custom helper named anything ending in
                          Auth / Authed / AuthHeader / AuthToken /
                          Authorize / Authorized / AuthRequired etc.)
   - "returns-status"  — fix added input validation that returns 400
                          on bad/missing body (schema parse, manual
                          if-check returning reply.code(400), etc.)
   - "idempotent"      — fix made a webhook / mutation idempotent by
                          adding a uniqueness check on a key from the
                          payload (event_id, msg_id, idempotency-key
                          header, signature). The added code must
                          look up an existing record and short-circuit
                          (return 200 / cached response) when found.
                          NOT just adding a unique index — the request
                          path itself must check.
   - "rate-limit"      — fix added a rate limiter to a route (e.g.,
                          rateLimit({ max: N }), limiter.consume(),
                          ratelimit.limit(key), upstash ratelimit). The
                          added code must reject above a threshold,
                          not just count.
   - "permission-required" — fix added an ownership / role / tenant
                          check that returns 403 / NotAuthorized when
                          the actor doesn't have the right. Signature
                          looks like: requirePermission(...), if
                          (user.role !== 'admin'), assertOwns(...),
                          if (resource.userId !== ctx.user.id).
                          NOT just any conditional — must look like
                          an authorization decision.
   - "url-literal-preserved" — fix added a URL string literal that
                          must keep being present (e.g., a corrected
                          API endpoint, a webhook receiver path, an
                          OAuth callback). Provide urlLiteral with
                          the exact path (e.g., "/api/v2/foo"). Skip
                          localhost / 127.0.0.1 URLs.
   - "module-export-stable" — fix added or restored a named export
                          (e.g., "Fixed missing showWarning export").
                          Provide exportName (e.g., "showWarning").
                          Use filePath to point to the module file.
   - "react-route-registered" — fix added a SPA route registration
                          (<Route path="/foo">, createRoute({ path }),
                          etc.). Provide routePath (e.g., "/dashboard").
                          Use routerFilePath for the router config
                          file (typically App.tsx).
   - "webhook-handler-exists" — fix wired a webhook handler in a
                          provider-named file (stripe/retell/etc.).
                          Provide provider (lowercase, e.g., "retell")
                          and handlerSignature (the export line).
   - "import-path-resolves" — fix added an import that must keep
                          resolving (e.g., a restored package, a
                          renamed module). Provide importPath (the
                          specifier) and sourceFilePath (file that
                          imports). Do NOT propose for @/foo or ~/foo
                          tsconfig path aliases (the verifier can't
                          resolve those) or for URL imports.
   - "changed-literal-preserved" — fix REPLACED a literal value with
                          a corrected one in the same hunk (URL typo,
                          status code correction, env-key rename).
                          Provide oldValue, newValue, and literalShape
                          ("url"|"host-url"|"status-code"|"env-key"|
                          "route-path"). Use filePath for the file.

2. The "signature" you output MUST be a substring that appears
   VERBATIM in the added lines I send you. Do NOT paraphrase or
   reconstruct — copy the actual code text. If you can't find a
   short representative substring, skip the candidate entirely.

3. For each candidate, choose the SHORTEST signature that's still
   unique to the addition (typically a single line of code).

4. For client-side files (paths starting with apps/app/, apps/web/,
   src/api/, src/lib/, or matching *Client.ts / *Fetcher.ts), use
   "client:" prefix in the route field. Example: route: "client:apps/app/src/api/client"

5. For server middleware files (matching middleware.ts), use
   route: "* (middleware)".

6. For server route files in routes/, app/api/, pages/api/ — use the
   route the file maps to. Example: route: "/api/admin/export".

7. If a candidate's signature already obviously appears in code that
   exists BEFORE this fix (e.g., it's wrapping existing code, not
   adding the protection), do NOT propose it.

8. If the commit is purely a refactor / rename / formatting change
   / docs-only / dependency bump — return { "candidates": [] } and
   nothing else.

9. NEVER invent template categories. NEVER write test code. NEVER
   propose more than 5 candidates per commit.

OUTPUT: JSON object with this exact shape:
{
  "candidates": [
    {
      "template": "auth-required" | "returns-status" | "idempotent" | "rate-limit" | "permission-required" | "url-literal-preserved" | "module-export-stable" | "react-route-registered" | "webhook-handler-exists" | "import-path-resolves" | "changed-literal-preserved",
      "filePath": "<repo-relative path>",
      "signature": "<verbatim substring from the added lines>",
      "route": "<route name (only for templates that have a route)>",
      "badCase": "<1 sentence, ≤140 chars, plain English: 'Without this, ...'>",
      "method": "POST" | "PUT" | "PATCH",   // returns-status only
      "rate": 60,                            // rate-limit only — requests-per-minute the route caps at
      "idField": "event_id",                 // idempotent only — payload field the dedupe key uses
      "urlLiteral": "/api/v2/foo",           // url-literal-preserved only
      "exportName": "showWarning",           // module-export-stable only
      "routePath": "/dashboard",             // react-route-registered only
      "routerFilePath": "src/App.tsx",       // react-route-registered only (if different from filePath)
      "handlerSignature": "export async function POST(",  // webhook-handler-exists only
      "provider": "retell",                  // webhook-handler-exists only
      "importPath": "@supabase/supabase-js", // import-path-resolves only (avoid @/ ~/ aliases)
      "sourceFilePath": "src/App.tsx",       // import-path-resolves only (file that imports)
      "oldValue": "/api/v1/foo",             // changed-literal-preserved only
      "newValue": "/api/v2/foo",             // changed-literal-preserved only
      "literalShape": "url"                  // changed-literal-preserved only: url | host-url | status-code | env-key | route-path
    }
  ]
}

No prose. No markdown fences. JSON only.`;

export type BugFixLlmInput = {
  commitMessage: string;
  commitBody?: string;
  // Caller already restricted to relevant file types and applied the
  // standard redaction pass (strip .env, lockfiles, binaries, etc.).
  diffByFile: Map<string, string[]>; // file → added lines (as we already collect)
};

// Hard cap on payload size — protects against runaway prompts and
// keeps token cost predictable. Roughly aligns with the "3000 token
// input" budget we estimated for cost-per-call.
const MAX_FILES = 20;
const MAX_LINES_PER_FILE = 80;
const MAX_CHARS_PER_LINE = 240;

export async function proposeBugFixCandidates(
  input: BugFixLlmInput
): Promise<LlmBugFixResult> {
  const provider = activeByokProvider();
  if (!provider) return { ok: false, reason: "byok-not-activated" };
  if (provider === "anthropic" && !process.env.PINNEDAI_ANTHROPIC_KEY) {
    return { ok: false, reason: "byok-key-missing", provider };
  }
  if (provider === "openai" && !process.env.PINNEDAI_OPENAI_KEY) {
    return { ok: false, reason: "byok-key-missing", provider };
  }
  if (provider === "github-models" && !process.env.PINNEDAI_GITHUB_TOKEN && !process.env.GITHUB_TOKEN) {
    return { ok: false, reason: "byok-key-missing", provider };
  }

  const userPayload = buildUserPayload(input);
  if (userPayload.eligibleFileCount === 0) {
    return { ok: false, reason: "noop", note: "no eligible files in diff" };
  }

  try {
    if (provider === "anthropic") {
      return await callAnthropic(
        process.env.PINNEDAI_ANTHROPIC_KEY!,
        userPayload.text,
        input
      );
    }
    if (provider === "openai") {
      return await callOpenAI(
        process.env.PINNEDAI_OPENAI_KEY!,
        userPayload.text,
        input
      );
    }
    if (provider === "claude-code") {
      return await callClaudeCode(userPayload.text, input);
    }
    // provider === "github-models"
    return await callGitHubModels(
      (process.env.PINNEDAI_GITHUB_TOKEN || process.env.GITHUB_TOKEN)!,
      userPayload.text,
      input
    );
  } catch (e) {
    return { ok: false, reason: "error", error: String(e) };
  }
}

function buildUserPayload(input: BugFixLlmInput): { text: string; eligibleFileCount: number } {
  const lines: string[] = [];
  lines.push(`Commit message:`);
  lines.push(input.commitMessage.slice(0, 240));
  if (input.commitBody && input.commitBody.trim()) {
    lines.push("");
    lines.push(`Commit body:`);
    lines.push(input.commitBody.slice(0, 1200));
  }
  lines.push("");
  lines.push(`Added lines per file:`);
  let fileCount = 0;
  for (const [path, addedLines] of input.diffByFile.entries()) {
    if (fileCount >= MAX_FILES) break;
    // Filter to files that COULD reasonably host a behavioral pin.
    // Cheap reject for everything else — keeps token cost focused.
    if (!isLlmEligibleFile(path)) continue;
    if (addedLines.length === 0) continue;
    fileCount += 1;
    lines.push("");
    lines.push(`---- ${path} ----`);
    const capped = addedLines
      .slice(0, MAX_LINES_PER_FILE)
      .map((l) => l.slice(0, MAX_CHARS_PER_LINE));
    for (const l of capped) lines.push(l);
    if (addedLines.length > MAX_LINES_PER_FILE) {
      lines.push(`... (${addedLines.length - MAX_LINES_PER_FILE} more added lines truncated)`);
    }
  }
  return { text: lines.join("\n"), eligibleFileCount: fileCount };
}

function isLlmEligibleFile(path: string): boolean {
  // Reject paths that can't host a pinnable behavioral pattern.
  if (/^(?:node_modules|dist|build|coverage|\.next|\.turbo)\//.test(path)) return false;
  if (path.startsWith("tests/pinned/")) return false;
  if (path.startsWith(".pinnedai/")) return false;
  if (/\.(?:md|css|scss|less|svg|png|jpg|gif|webp|ico|woff2?|map)$/i.test(path)) return false;
  if (/\.lock(?:file|b)?$|^pnpm-lock\.yaml$|^yarn\.lock$|^package-lock\.json$/.test(path)) return false;
  if (/\.(?:test|spec)\.(?:ts|tsx|js|jsx)$/.test(path)) return false;
  // Accept everything else that's a TS/JS/Python/Go file (we propose
  // for TS/JS specifically but accept other extensions in case the
  // LLM finds something useful — the schema validator below filters
  // anything we can't actually generate a pin for).
  return /\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rb)$/.test(path);
}

async function callAnthropic(
  apiKey: string,
  userText: string,
  input: BugFixLlmInput
): Promise<LlmBugFixResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, reason: "error", error: `anthropic ${res.status}: ${detail.slice(0, 200)}` };
  }
  const data = (await res.json()) as {
    content?: Array<{ type: string; text: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = data.content?.find((c) => c.type === "text")?.text ?? "";
  const candidates = parseAndValidate(text, input);
  return {
    ok: true,
    candidates,
    provider: "anthropic",
    rawTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
  };
}

async function callOpenAI(
  apiKey: string,
  userText: string,
  input: BugFixLlmInput
): Promise<LlmBugFixResult> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.PINNEDAI_OPENAI_MODEL || "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userText },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { ok: false, reason: "error", error: `openai ${res.status}: ${detail.slice(0, 200)}` };
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  const candidates = parseAndValidate(text, input);
  return { ok: true, candidates, provider: "openai", rawTokens: data.usage?.total_tokens };
}

// Claude Code passthrough — spawns the locally-installed `claude` CLI
// with `-p` (one-shot prompt mode). User's existing Claude Pro/Max
// subscription pays for the call. ENOENT = CLI not installed → distinct
// reason so onboarding can tell the user "install claude OR pick another
// provider." See [[llm-access-claude-code-passthrough]].
async function callClaudeCode(
  userText: string,
  input: BugFixLlmInput
): Promise<LlmBugFixResult> {
  const { spawn } = await import("node:child_process");
  const claudeBin = process.env.PINNEDAI_CLAUDE_BIN || "claude";
  const combined = `${SYSTEM_PROMPT}\n\n${userText}`;
  const proc = spawn(claudeBin, ["-p", combined], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  proc.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
  proc.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  const exitCode: number = await new Promise((resolve) => {
    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") resolve(-127);
      else resolve(-1);
    });
    proc.on("exit", (code) => resolve(code ?? -1));
  });
  if (exitCode === -127) {
    return { ok: false, reason: "claude-code-not-installed" };
  }
  if (exitCode !== 0) {
    return {
      ok: false,
      reason: "error",
      error: `claude-code exit ${exitCode}: ${stderr.slice(0, 200)}`,
    };
  }
  const candidates = parseAndValidate(stdout, input);
  return { ok: true, candidates, provider: "claude-code" };
}

// GitHub Models — Microsoft's free LLM tier, OpenAI-compatible at
// models.github.ai. Auth via GitHub token (PINNEDAI_GITHUB_TOKEN or
// the standard GITHUB_TOKEN env var). Rate-limited but free; ideal
// for users who already have a GitHub account but no API key.
async function callGitHubModels(
  token: string,
  userText: string,
  input: BugFixLlmInput
): Promise<LlmBugFixResult> {
  const model = process.env.PINNEDAI_GITHUB_MODEL || "gpt-4o-mini";
  const res = await fetch("https://models.github.ai/inference/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userText },
      ],
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return {
      ok: false,
      reason: "error",
      error: `github-models ${res.status}: ${detail.slice(0, 200)}`,
    };
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { total_tokens?: number };
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  const candidates = parseAndValidate(text, input);
  return {
    ok: true,
    candidates,
    provider: "github-models",
    rawTokens: data.usage?.total_tokens,
  };
}

// Parse the LLM JSON, validate against the strict schema, AND verify
// each candidate's signature actually appears in the diff we sent.
// The signature-verification step is the load-bearing guardrail —
// without it, the LLM could hallucinate signatures that match
// nothing in the actual code.
function parseAndValidate(raw: string, input: BugFixLlmInput): BugFixCandidate[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== "object") return [];
  const arr = (parsed as { candidates?: unknown }).candidates;
  if (!Array.isArray(arr)) return [];

  const out: BugFixCandidate[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;

    const template = o.template;
    if (!isAllowedTemplate(template)) continue;

    const filePath = o.filePath;
    if (typeof filePath !== "string" || filePath.length === 0) continue;

    const signature = o.signature;
    if (typeof signature !== "string" || signature.length < 3 || signature.length > 400) continue;

    // CRITICAL GUARDRAIL: signature must actually appear in the diff
    // we sent. The LLM doesn't get to invent code that wasn't there.
    const addedLines = input.diffByFile.get(filePath);
    if (!addedLines || addedLines.length === 0) continue;
    const joined = addedLines.join("\n");
    if (!joined.includes(signature.trim())) continue;

    // Optional fields
    const route = typeof o.route === "string" ? o.route.slice(0, 200) : undefined;
    const badCase = typeof o.badCase === "string" ? o.badCase.slice(0, 200) : undefined;

    let method: "POST" | "PUT" | "PATCH" | undefined;
    if (template === "returns-status") {
      const m = o.method;
      if (m === "POST" || m === "PUT" || m === "PATCH") method = m;
      else method = "POST"; // safe default
    }

    let rate: number | undefined;
    if (template === "rate-limit") {
      const r = o.rate;
      if (typeof r === "number" && Number.isFinite(r) && r > 0 && r < 100000) rate = Math.floor(r);
    }

    let idField: string | undefined;
    if (template === "idempotent") {
      const f = o.idField;
      if (typeof f === "string" && f.length > 0 && f.length < 80) idField = f;
    }

    // Phase 1+2 field extraction. Each is template-gated so the LLM
    // can't pass URL fields on an auth pin etc.
    let urlLiteral: string | undefined;
    if (template === "url-literal-preserved") {
      const u = o.urlLiteral;
      if (typeof u === "string" && u.length > 0 && u.length < 200) urlLiteral = u;
      else continue; // template requires this field
    }
    let exportName: string | undefined;
    if (template === "module-export-stable") {
      const e = o.exportName;
      if (typeof e === "string" && /^[A-Za-z_][A-Za-z0-9_]{2,}$/.test(e)) exportName = e;
      else continue;
    }
    let routePath: string | undefined;
    let routerFilePath: string | undefined;
    if (template === "react-route-registered") {
      const rp = o.routePath;
      const rfp = o.routerFilePath;
      if (typeof rp === "string" && rp.startsWith("/") && rp.length < 80) routePath = rp;
      else continue;
      routerFilePath = typeof rfp === "string" && rfp.length > 0 ? rfp : filePath;
    }
    let handlerSignature: string | undefined;
    let provider: string | undefined;
    if (template === "webhook-handler-exists") {
      const h = o.handlerSignature;
      const p = o.provider;
      if (typeof h === "string" && h.length > 5 && h.length < 200) handlerSignature = h;
      else continue;
      provider = typeof p === "string" && /^[a-z][a-z0-9_-]{1,30}$/.test(p) ? p : "generic";
    }
    let importPath: string | undefined;
    let sourceFilePath: string | undefined;
    if (template === "import-path-resolves") {
      const ip = o.importPath;
      if (typeof ip === "string" && ip.length > 1 && ip.length < 200) {
        if (ip.startsWith("@/") || ip.startsWith("~/") || /^https?:\/\//.test(ip)) continue;
        importPath = ip;
      } else continue;
      sourceFilePath = typeof o.sourceFilePath === "string" ? o.sourceFilePath : filePath;
    }
    let oldValue: string | undefined;
    let newValue: string | undefined;
    let literalShape: "url" | "host-url" | "status-code" | "env-key" | "route-path" | undefined;
    if (template === "changed-literal-preserved") {
      const ov = o.oldValue;
      const nv = o.newValue;
      const sh = o.literalShape;
      if (typeof ov === "string" && ov.length > 1 && typeof nv === "string" && nv.length > 1 &&
          (sh === "url" || sh === "host-url" || sh === "status-code" || sh === "env-key" || sh === "route-path")) {
        oldValue = ov;
        newValue = nv;
        literalShape = sh;
      } else continue;
    }

    out.push({
      template,
      filePath,
      signature: signature.trim(),
      route,
      badCase,
      method,
      rate,
      idField,
      urlLiteral,
      exportName,
      routePath,
      routerFilePath,
      handlerSignature,
      provider,
      importPath,
      sourceFilePath,
      oldValue,
      newValue,
      literalShape,
    });

    // Hard cap at 5 candidates per commit, mirroring the prompt rule.
    if (out.length >= 5) break;
  }
  return out;
}

function isAllowedTemplate(v: unknown): v is AllowedTemplate {
  return typeof v === "string" && (ALLOWED_TEMPLATES as readonly string[]).includes(v);
}
