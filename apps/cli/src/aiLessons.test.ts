// Unit tests for the AI Lessons generator. Use tempdirs — no test
// pollution into the actual repo.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLesson, readLessons, type LessonInput } from "./aiLessons.js";

const baseLesson: LessonInput = {
  guardId: "client-getReport-authHeaders",
  title: "Auth headers in protected API calls",
  pastMistake: "`getReport()` failed because the Authorization header was missing.",
  rule: "Do not remove `authHeaders()` from protected API client calls unless the endpoint is explicitly public.",
  plainEnglish: "don't drop authHeaders() from API calls",
  kind: "real-catch",
};

describe("aiLessons.appendLesson", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ai-lessons-"));
  });

  it("creates the lessons file on first append", () => {
    const r = appendLesson(baseLesson, { repoRoot: tmp });
    expect(r.added).toBe(true);
    expect(r.updated).toBe(false);
    const body = readFileSync(join(tmp, ".pinned/ai-lessons.md"), "utf8");
    expect(body).toContain("# Pinned AI Lessons");
    expect(body).toContain("## Auth headers in protected API calls");
    expect(body).toContain("**Plain English:** don't drop authHeaders() from API calls");
    expect(body).toContain(`<!-- pinned:guard=${baseLesson.guardId} kind=real-catch -->`);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("dedupes by guardId — second call with same guard does not create duplicate section", () => {
    appendLesson(baseLesson, { repoRoot: tmp });
    const r2 = appendLesson(baseLesson, { repoRoot: tmp });
    expect(r2.added).toBe(false);
    // Second call has identical pastMistake — no evidence update either
    expect(r2.updated).toBe(false);
    const body = readFileSync(join(tmp, ".pinned/ai-lessons.md"), "utf8");
    const occurrences = (body.match(/## Auth headers in protected API calls/g) ?? []).length;
    expect(occurrences).toBe(1);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("appends new evidence to existing section when pastMistake differs", () => {
    appendLesson(baseLesson, { repoRoot: tmp });
    const r2 = appendLesson(
      { ...baseLesson, pastMistake: "`updateProfile()` also lost the Authorization header in PR #88." },
      { repoRoot: tmp }
    );
    expect(r2.added).toBe(false);
    expect(r2.updated).toBe(true);
    const body = readFileSync(join(tmp, ".pinned/ai-lessons.md"), "utf8");
    const occurrences = (body.match(/## Auth headers in protected API calls/g) ?? []).length;
    expect(occurrences).toBe(1); // still one section
    expect(body).toContain("updateProfile()");
    expect(body).toContain("getReport()");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("creates separate sections for different guardIds", () => {
    appendLesson(baseLesson, { repoRoot: tmp });
    appendLesson(
      {
        guardId: "contact-form-res-ok",
        title: "Error handling in form submissions",
        pastMistake: "Contact form treated failed responses as success.",
        rule: "Do not remove `if (!res.ok)` handling from form/API submissions.",
        plainEnglish: "keep if (!res.ok) on form submits",
        kind: "real-catch",
      },
      { repoRoot: tmp }
    );
    const body = readFileSync(join(tmp, ".pinned/ai-lessons.md"), "utf8");
    expect(body).toContain("## Auth headers in protected API calls");
    expect(body).toContain("## Error handling in form submissions");
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe("aiLessons.readLessons", () => {
  it("returns empty when file doesn't exist", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ai-lessons-"));
    const r = readLessons({ repoRoot: tmp });
    expect(r.count).toBe(0);
    expect(r.guardIds).toEqual([]);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("counts entries correctly after multiple appends", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ai-lessons-"));
    appendLesson(baseLesson, { repoRoot: tmp });
    appendLesson(
      { ...baseLesson, guardId: "g2", title: "G2" },
      { repoRoot: tmp }
    );
    appendLesson(
      { ...baseLesson, guardId: "g3", title: "G3" },
      { repoRoot: tmp }
    );
    const r = readLessons({ repoRoot: tmp });
    expect(r.count).toBe(3);
    expect(r.guardIds.sort()).toEqual(["client-getReport-authHeaders", "g2", "g3"].sort());
    rmSync(tmp, { recursive: true, force: true });
  });
});
