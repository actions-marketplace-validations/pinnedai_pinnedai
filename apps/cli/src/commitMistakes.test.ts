// Battle test for commitMistakes detectors — positive + negative +
// no-change per the user's testing discipline.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectCommitMistakes, auditCurrentState } from "./commitMistakes.js";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "commit-mistakes-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function write(rel: string, content = "") {
  const abs = join(tmp, rel);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, content);
}

function added(path: string, lines: string[]): Map<string, string[]> {
  return new Map([[path, lines]]);
}

describe("commitMistakes — secrets", () => {
  it("(positive) flags OpenAI sk- key in added line", () => {
    const v = detectCommitMistakes({
      repoRoot: tmp,
      changedFiles: [{ path: "src/lib/api.ts", status: "modified" }],
      addedLinesByFile: added("src/lib/api.ts", ["const k = 'sk-proj-aBcDeFgH12345678901234567890123456789012345678';"]),
    });
    expect(v.some((x) => x.type === "secret-committed" && x.severity === "block")).toBe(true);
  });

  it("(positive) flags AWS AKIA key", () => {
    const v = detectCommitMistakes({
      repoRoot: tmp,
      changedFiles: [{ path: "src/aws.ts", status: "modified" }],
      addedLinesByFile: added("src/aws.ts", ['const id = "AKIAIOSFODNN7EXAMPLE";']),
    });
    expect(v.some((x) => x.type === "secret-committed")).toBe(true);
  });

  it("(positive) flags GitHub PAT", () => {
    const v = detectCommitMistakes({
      repoRoot: tmp,
      changedFiles: [{ path: "src/gh.ts", status: "modified" }],
      addedLinesByFile: added("src/gh.ts", ['const token = "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789";']),
    });
    expect(v.some((x) => x.type === "secret-committed")).toBe(true);
  });

  it("(negative) does NOT flag secret-shaped string in README", () => {
    const v = detectCommitMistakes({
      repoRoot: tmp,
      changedFiles: [{ path: "README.md", status: "modified" }],
      addedLinesByFile: added("README.md", ["Example key format: sk-aBcDeFgH12345678901234567890"]),
    });
    expect(v.some((x) => x.type === "secret-committed")).toBe(false);
  });

  it("(negative) does NOT flag in test fixtures dir", () => {
    const v = detectCommitMistakes({
      repoRoot: tmp,
      changedFiles: [{ path: "tests/fixtures/keys.ts", status: "modified" }],
      addedLinesByFile: added("tests/fixtures/keys.ts", ['const k = "sk-aBcDeFgH12345678901234567890";']),
    });
    expect(v.some((x) => x.type === "secret-committed")).toBe(false);
  });

  it("(no-change) empty diff produces no violations", () => {
    const v = detectCommitMistakes({ repoRoot: tmp, changedFiles: [] });
    expect(v).toHaveLength(0);
  });
});

describe("commitMistakes — env file committed", () => {
  it("(positive) flags .env added without .gitignore coverage", () => {
    const v = detectCommitMistakes({
      repoRoot: tmp,
      changedFiles: [{ path: ".env", status: "added" }],
    });
    expect(v.some((x) => x.type === "env-file-committed" && x.severity === "block")).toBe(true);
  });

  it("(negative) does NOT flag when .env is in .gitignore (.env*)", () => {
    write(".gitignore", "node_modules\n.env*\n");
    const v = detectCommitMistakes({
      repoRoot: tmp,
      changedFiles: [{ path: ".env", status: "added" }],
    });
    expect(v.some((x) => x.type === "env-file-committed")).toBe(false);
  });

  it("(negative) does NOT flag .env modification (only addition)", () => {
    const v = detectCommitMistakes({
      repoRoot: tmp,
      changedFiles: [{ path: ".env", status: "modified" }],
    });
    expect(v.some((x) => x.type === "env-file-committed")).toBe(false);
  });
});

describe("commitMistakes — hardcoded localhost", () => {
  // Demoted to opt-in (--strict) after 2026-05-23 dogfood empirical
  // run showed 50 catches across 13 personal repos = 0 real.
  // Tests now pass `strict: true` to verify the detector still works
  // when opted in. Default-on path is verified by the (no-change)
  // tests below.
  it("(positive, --strict) flags http://localhost in production source", () => {
    const v = detectCommitMistakes({
      repoRoot: tmp,
      strict: true,
      changedFiles: [{ path: "src/api/client.ts", status: "modified" }],
      addedLinesByFile: added("src/api/client.ts", ['const url = "http://localhost:3000/api";']),
    });
    expect(v.some((x) => x.type === "hardcoded-localhost" && x.severity === "warn")).toBe(true);
  });

  it("(positive, --strict) flags 127.0.0.1", () => {
    const v = detectCommitMistakes({
      repoRoot: tmp,
      strict: true,
      changedFiles: [{ path: "src/server.ts", status: "modified" }],
      addedLinesByFile: added("src/server.ts", ["fetch('http://127.0.0.1:8080/health')"]),
    });
    expect(v.some((x) => x.type === "hardcoded-localhost")).toBe(true);
  });

  it("(negative, default-off) does NOT flag without --strict", () => {
    const v = detectCommitMistakes({
      repoRoot: tmp,
      changedFiles: [{ path: "src/api/client.ts", status: "modified" }],
      addedLinesByFile: added("src/api/client.ts", ['const url = "http://localhost:3000/api";']),
    });
    expect(v.some((x) => x.type === "hardcoded-localhost")).toBe(false);
  });

  it("(negative, --strict) does NOT flag in scripts/", () => {
    const v = detectCommitMistakes({
      repoRoot: tmp,
      strict: true,
      changedFiles: [{ path: "scripts/dev.ts", status: "modified" }],
      addedLinesByFile: added("scripts/dev.ts", ['const url = "http://localhost:3000";']),
    });
    expect(v.some((x) => x.type === "hardcoded-localhost")).toBe(false);
  });

  it("(negative, --strict) does NOT flag in test files", () => {
    const v = detectCommitMistakes({
      repoRoot: tmp,
      strict: true,
      changedFiles: [{ path: "src/api/client.test.ts", status: "modified" }],
      addedLinesByFile: added("src/api/client.test.ts", ['const url = "http://localhost:3000";']),
    });
    expect(v.some((x) => x.type === "hardcoded-localhost")).toBe(false);
  });
});

describe("commitMistakes — error handling net-removed", () => {
  it("(positive, --strict) flags net-removal of if(!res.ok) blocks", () => {
    const removed = new Map([[
      "src/api/getThing.ts",
      ["if (!res.ok) throw new Error('failed')", "if (!res.ok) return null", "if (!response.ok) handle()"],
    ]]);
    const v = detectCommitMistakes({
      repoRoot: tmp,
      strict: true,
      changedFiles: [{ path: "src/api/getThing.ts", status: "modified" }],
      addedLinesByFile: new Map(),
      removedLinesByFile: removed,
    });
    expect(v.some((x) => x.type === "error-handling-removed")).toBe(true);
  });

  it("(negative, default-off) does NOT flag without --strict", () => {
    const removed = new Map([[
      "src/api/getThing.ts",
      ["if (!res.ok) throw new Error('failed')", "if (!res.ok) return null", "if (!response.ok) handle()"],
    ]]);
    const v = detectCommitMistakes({
      repoRoot: tmp,
      changedFiles: [{ path: "src/api/getThing.ts", status: "modified" }],
      addedLinesByFile: new Map(),
      removedLinesByFile: removed,
    });
    expect(v.some((x) => x.type === "error-handling-removed")).toBe(false);
  });

  it("(negative, --strict) does NOT flag when error handling REPLACED net-equal", () => {
    const v = detectCommitMistakes({
      repoRoot: tmp,
      strict: true,
      changedFiles: [{ path: "src/api.ts", status: "modified" }],
      addedLinesByFile: added("src/api.ts", ["if (!res.ok) throw new Error('failed')", "if (!res.ok) return null"]),
      removedLinesByFile: added("src/api.ts", ["if (!res.ok) throw new Error('old')", "if (!res.ok) handle()"]),
    });
    expect(v.some((x) => x.type === "error-handling-removed")).toBe(false);
  });

  it("(negative, --strict) does NOT flag with only 1 removed (under threshold)", () => {
    const v = detectCommitMistakes({
      repoRoot: tmp,
      strict: true,
      changedFiles: [{ path: "src/api.ts", status: "modified" }],
      removedLinesByFile: added("src/api.ts", ["if (!res.ok) throw new Error('failed')"]),
    });
    expect(v.some((x) => x.type === "error-handling-removed")).toBe(false);
  });
});

describe("commitMistakes — auth header net-removed", () => {
  it("(positive) flags net-removal of authHeaders / Authorization", () => {
    const removed = new Map([[
      "src/api/client.ts",
      ["headers: await authHeaders()", "'Authorization': `Bearer ${token}`", "credentials: 'include'"],
    ]]);
    const v = detectCommitMistakes({
      repoRoot: tmp,
      changedFiles: [{ path: "src/api/client.ts", status: "modified" }],
      addedLinesByFile: new Map(),
      removedLinesByFile: removed,
    });
    expect(v.some((x) => x.type === "auth-header-removed" && x.severity === "block")).toBe(true);
  });

  it("(negative) does NOT flag when auth REPLACED net-equal", () => {
    const v = detectCommitMistakes({
      repoRoot: tmp,
      changedFiles: [{ path: "src/api.ts", status: "modified" }],
      addedLinesByFile: added("src/api.ts", ["headers: authHeaders()", "Authorization: token"]),
      removedLinesByFile: added("src/api.ts", ["headers: oldAuthHeaders()", "Authorization: oldToken"]),
    });
    expect(v.some((x) => x.type === "auth-header-removed")).toBe(false);
  });
});

describe("commitMistakes — state-based audit", () => {
  it("(positive) finds secret in current code", () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-"));
    write.bind(null);
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src/api.ts"), 'const k = "sk-proj-aBcDeFgH12345678901234567890123456789012345678";\n');
    const r = auditCurrentState({ repoRoot: tmp });
    expect(r.some((x: { type: string }) => x.type === "secret-in-code")).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("(positive) finds hardcoded localhost in current code", () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-"));
    mkdirSync(join(tmp, "src/api"), { recursive: true });
    writeFileSync(join(tmp, "src/api/client.ts"), 'const url = "http://localhost:3000/api";\n');
    const r = auditCurrentState({ repoRoot: tmp });
    expect(r.some((x: { type: string }) => x.type === "hardcoded-localhost-in-code")).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("(positive) finds .env without gitignore", () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-"));
    writeFileSync(join(tmp, ".env"), "SECRET=xyz\n");
    const r = auditCurrentState({ repoRoot: tmp });
    expect(r.some((x: { type: string }) => x.type === "env-file-in-tree")).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("(negative) does NOT flag clean repo", () => {
    const tmp = mkdtempSync(join(tmpdir(), "audit-"));
    mkdirSync(join(tmp, "src"), { recursive: true });
    writeFileSync(join(tmp, "src/api.ts"), 'export const ok = "yes";\n');
    const r = auditCurrentState({ repoRoot: tmp });
    expect(r).toHaveLength(0);
    rmSync(tmp, { recursive: true, force: true });
  });
});
