import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectPublicExposure } from "./scanDiff.js";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "pub-exposure-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function write(rel: string, content = "") {
  const abs = join(tmp, rel);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, content);
}

describe("detectPublicExposure — env files", () => {
  it("warns on .env in repo root with no .gitignore", () => {
    write(".env", "SECRET=x");
    const f = detectPublicExposure(tmp);
    expect(f.some((x) => x.kind === "env-committed" && x.path === ".env")).toBe(true);
  });

  it("does NOT warn when .env is in .gitignore", () => {
    write(".env", "SECRET=x");
    write(".gitignore", "node_modules\n.env\n");
    const f = detectPublicExposure(tmp);
    expect(f.some((x) => x.kind === "env-committed")).toBe(false);
  });

  it("ignores .env* glob pattern in .gitignore", () => {
    write(".env.local", "SECRET=x");
    write(".gitignore", ".env*\n");
    const f = detectPublicExposure(tmp);
    expect(f.some((x) => x.kind === "env-committed")).toBe(false);
  });
});

describe("detectPublicExposure — source maps", () => {
  it("warns on .map files in dist/", () => {
    write("dist/main.js", "");
    write("dist/main.js.map", "");
    const f = detectPublicExposure(tmp);
    expect(f.some((x) => x.kind === "source-map-committed" && x.path === "dist/main.js.map")).toBe(true);
  });

  it("warns on .map files in build/", () => {
    write("build/app.css.map", "");
    const f = detectPublicExposure(tmp);
    expect(f.some((x) => x.kind === "source-map-committed")).toBe(true);
  });

  it("ignores absent dist directories", () => {
    const f = detectPublicExposure(tmp);
    expect(f.some((x) => x.kind === "source-map-committed")).toBe(false);
  });
});

describe("detectPublicExposure — debug routes", () => {
  it("flags app/api/__debug/route.ts", () => {
    write("app/api/__debug/route.ts", "export const GET = () => Response.json({});");
    const f = detectPublicExposure(tmp);
    expect(f.some((x) => x.kind === "debug-route-present")).toBe(true);
  });

  it("flags pages/api/__test.ts", () => {
    write("pages/api/__test.ts", "");
    const f = detectPublicExposure(tmp);
    expect(f.some((x) => x.kind === "debug-route-present")).toBe(true);
  });

  it("flags debug.html in public/", () => {
    write("public/debug.html", "");
    const f = detectPublicExposure(tmp);
    expect(f.some((x) => x.kind === "debug-route-present")).toBe(true);
  });

  it("does NOT flag normal admin pages without console pattern", () => {
    write("app/admin/dashboard/page.tsx", "");
    const f = detectPublicExposure(tmp);
    expect(f.some((x) => x.kind === "debug-route-present")).toBe(false);
  });
});
