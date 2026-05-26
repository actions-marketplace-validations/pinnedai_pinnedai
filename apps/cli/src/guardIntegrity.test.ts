// Unit tests for Guard Integrity detectors. Synthetic ChangedFile
// inputs — no git, no fs. Each test exercises ONE bypass pattern
// and asserts the detector fires (or doesn't, for negative cases).

import { describe, it, expect } from "vitest";
import { detectGuardIntegrityViolations, formatViolation } from "./guardIntegrity.js";
import type { ChangedFile } from "./scanDiff.js";

function file(path: string, status: ChangedFile["status"], addedLines?: string): ChangedFile {
  return { path, status, addedLines };
}

describe("guardIntegrity — pin deletion", () => {
  it("flags a deleted file in tests/pinned/", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [file("tests/pinned/auth-required-admin.test.ts", "deleted")],
    });
    expect(v).toHaveLength(1);
    expect(v[0].type).toBe("pin-deleted");
    expect(v[0].severity).toBe("block");
  });

  it("ignores deleted files outside tests/pinned/", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [file("src/lib/auth.ts", "deleted")],
    });
    expect(v).toHaveLength(0);
  });

  it("ignores deletion of non-test files inside tests/pinned/", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [
        file("tests/pinned/AGENT.md", "deleted"),
        file("tests/pinned/PINS.md", "deleted"),
      ],
    });
    expect(v).toHaveLength(0);
  });
});

describe("guardIntegrity — skip patterns", () => {
  it("flags it.skip() added to a pinned test", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [
        file("tests/pinned/foo.test.ts", "modified", `it.skip("auth required", () => {})`),
      ],
    });
    expect(v.some((x) => x.type === "skip-added")).toBe(true);
  });

  it("flags describe.only added", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [
        file("tests/pinned/foo.test.ts", "modified", `describe.only("foo", () => {})`),
      ],
    });
    expect(v.some((x) => x.type === "skip-added")).toBe(true);
  });

  it("flags xit added", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [
        file("tests/pinned/foo.test.ts", "modified", `xit("auth", () => {})`),
      ],
    });
    expect(v.some((x) => x.type === "skip-added")).toBe(true);
  });

  it("flags it.todo as bypass", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [
        file("tests/pinned/foo.test.ts", "modified", `it.todo("auth check")`),
      ],
    });
    expect(v.some((x) => x.type === "skip-added")).toBe(true);
  });

  it("does NOT flag identifiers like skipHandler", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [
        file("tests/pinned/foo.test.ts", "modified", `const skipHandler = () => {}`),
      ],
    });
    expect(v.some((x) => x.type === "skip-added")).toBe(false);
  });

  it("does NOT flag skip patterns in non-pinned tests", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [
        file("src/components/foo.test.ts", "modified", `it.skip("x", () => {})`),
      ],
    });
    expect(v.some((x) => x.type === "skip-added")).toBe(false);
  });
});

describe("guardIntegrity — assertion weakening", () => {
  it("flags .toBeTruthy added to a pinned test", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [
        file("tests/pinned/foo.test.ts", "modified", `expect(res.status).toBeTruthy()`),
      ],
    });
    expect(v.some((x) => x.type === "assertion-weakened")).toBe(true);
  });

  it("flags .toBeDefined added", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [
        file("tests/pinned/foo.test.ts", "modified", `expect(res.body).toBeDefined()`),
      ],
    });
    expect(v.some((x) => x.type === "assertion-weakened")).toBe(true);
  });

  it("flags expect(true).toBe(true) tautology", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [
        file("tests/pinned/foo.test.ts", "modified", `expect(true).toBe(true)`),
      ],
    });
    expect(v.some((x) => x.type === "assertion-weakened")).toBe(true);
  });

  it("flags expect(1).toBe(1) literal tautology", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [
        file("tests/pinned/foo.test.ts", "modified", `expect(1).toBe(1)`),
      ],
    });
    expect(v.some((x) => x.type === "assertion-weakened")).toBe(true);
  });
});

describe("guardIntegrity — swallow patterns", () => {
  it("flags || true added to a pinned test", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [
        file("tests/pinned/foo.test.ts", "modified", `const ok = res.ok || true`),
      ],
    });
    expect(v.some((x) => x.type === "swallow-added")).toBe(true);
  });

  it("flags catch(() => true)", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [
        file("tests/pinned/foo.test.ts", "modified", `const r = await fetch(url).catch(() => true)`),
      ],
    });
    expect(v.some((x) => x.type === "swallow-added")).toBe(true);
  });

  it("flags ?? true", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [
        file("tests/pinned/foo.test.ts", "modified", `const x = result ?? true`),
      ],
    });
    expect(v.some((x) => x.type === "swallow-added")).toBe(true);
  });
});

describe("guardIntegrity — workflow modification", () => {
  it("blocks deletion of .github/workflows/pinned.yml", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [file(".github/workflows/pinned.yml", "deleted")],
    });
    expect(v.some((x) => x.type === "workflow-modified" && x.severity === "block")).toBe(true);
  });

  it("warns on modification of pinned.yml", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [file(".github/workflows/pinned.yml", "modified", "  if: false")],
    });
    expect(v.some((x) => x.type === "workflow-modified" && x.severity === "warn")).toBe(true);
  });
});

describe("guardIntegrity — registry tampering", () => {
  it("blocks deletion of .registry.json", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [file("tests/pinned/.registry.json", "deleted")],
    });
    expect(v.some((x) => x.type === "registry-entry-removed" && x.severity === "block")).toBe(true);
  });

  it("warns on manual modification of .registry.json", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [file("tests/pinned/.registry.json", "modified", `{"version":1}`)],
    });
    expect(v.some((x) => x.type === "registry-entry-removed" && x.severity === "warn")).toBe(true);
  });
});

describe("guardIntegrity — commented assertions", () => {
  it("flags a commented-out expect()", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [
        file("tests/pinned/foo.test.ts", "modified", `// expect(res.status).toBe(401)`),
      ],
    });
    expect(v.some((x) => x.type === "assertion-commented")).toBe(true);
  });
});

describe("guardIntegrity — AI Lessons tampering", () => {
  it("blocks deletion of .pinned/ai-lessons.md", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [file(".pinned/ai-lessons.md", "deleted")],
    });
    expect(v.some((x) => x.type === "ai-lessons-tampered" && x.severity === "block")).toBe(true);
  });

  it("blocks deletion of .pinned/lessons.json", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [file(".pinned/lessons.json", "deleted")],
    });
    expect(v.some((x) => x.type === "ai-lessons-tampered" && x.severity === "block")).toBe(true);
  });

  it("warns on direct edit of .pinned/ai-lessons.md that removes guard markers", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [file(".pinned/ai-lessons.md", "modified", "## Just renamed section\n")],
    });
    // Added content has no pinned:guard= marker → still a warn (modification, not deletion)
    expect(v.some((x) => x.type === "ai-lessons-tampered")).toBe(true);
  });

  it("does not flag changes to unrelated .pinned files", () => {
    const v = detectGuardIntegrityViolations({
      changedFiles: [file(".pinned/notes.md", "modified", "anything")],
    });
    expect(v.some((x) => x.type === "ai-lessons-tampered")).toBe(false);
  });
});

describe("guardIntegrity — formatViolation output", () => {
  it("includes severity, type, file, and evidence", () => {
    const formatted = formatViolation({
      type: "skip-added",
      severity: "block",
      file: "tests/pinned/foo.test.ts",
      evidence: "skip added",
      after: `it.skip("foo", () => {})`,
    });
    expect(formatted).toContain("⛔ BLOCK");
    expect(formatted).toContain("skip-added");
    expect(formatted).toContain("tests/pinned/foo.test.ts");
    expect(formatted).toContain("skip added");
    expect(formatted).toContain("Pattern detected");
  });
});
