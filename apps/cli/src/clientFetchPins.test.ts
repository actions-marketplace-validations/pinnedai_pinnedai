// Unit tests for detectClientFetchPins (static-state client fetch detector).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectClientFetchPins } from "./scanDiff.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "client-fetch-pin-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function write(rel: string, content: string) {
  const abs = join(tmp, rel);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, content);
}

describe("detectClientFetchPins — auth headers", () => {
  it("captures authHeaders() in a client-named file", () => {
    write("src/api/getReport.ts", `
      export async function getReport() {
        const res = await fetch("/api/report", { headers: await authHeaders() });
        return res.json();
      }
    `);
    const pins = detectClientFetchPins(tmp);
    expect(pins.some((p) => p.source === "auth-headers" && p.filePath === "src/api/getReport.ts")).toBe(true);
    const pin = pins.find((p) => p.source === "auth-headers")!;
    expect(pin.signature).toContain("authHeaders");
    expect(pin.route).toBe("client:src/api/getReport");
  });

  it("captures Authorization Bearer literal in a client file", () => {
    write("apps/app/src/client.ts", `
      const res = await fetch(url, {
        headers: { Authorization: \`Bearer \${token}\` },
      });
    `);
    const pins = detectClientFetchPins(tmp);
    expect(pins.some((p) => p.source === "auth-headers")).toBe(true);
  });

  it("captures credentials: include in a *Client.ts file", () => {
    write("src/lib/apiClient.ts", `
      export const client = (path: string) => fetch(path, { credentials: "include" });
    `);
    const pins = detectClientFetchPins(tmp);
    expect(pins.some((p) => p.source === "auth-headers")).toBe(true);
  });
});

describe("detectClientFetchPins — error handling", () => {
  it("captures if (!res.ok) error gate", () => {
    write("src/api/getThing.ts", `
      export async function getThing() {
        const res = await fetch("/api/thing");
        if (!res.ok) throw new Error("failed");
        return res.json();
      }
    `);
    const pins = detectClientFetchPins(tmp);
    const pin = pins.find((p) => p.source === "error-handling");
    expect(pin?.source).toBe("error-handling");
    expect(pin?.signature).toContain("!res.ok");
    expect(pin?.filePath).toBe("src/api/getThing.ts");
  });

  it("captures try/catch around fetch", () => {
    write("src/api/wrap.ts", `
      export async function wrap() {
        try {
          const res = await fetch("/x");
          return res.json();
        } catch (e) {
          console.error(e);
          throw e;
        }
      }
    `);
    const pins = detectClientFetchPins(tmp);
    expect(pins.some((p) => p.source === "error-handling")).toBe(true);
  });
});

describe("detectClientFetchPins — filtering", () => {
  it("does NOT pin files without a fetch call", () => {
    write("src/api/util.ts", `
      export const authHeaders = () => ({ Authorization: "Bearer x" });
    `);
    const pins = detectClientFetchPins(tmp);
    expect(pins).toHaveLength(0);
  });

  it("does NOT pin route handler files (covered by server detector)", () => {
    write("app/api/admin/route.ts", `
      import { authHeaders } from "@/lib";
      export async function POST() {
        const res = await fetch("/internal", { headers: authHeaders() });
        return Response.json({});
      }
    `);
    const pins = detectClientFetchPins(tmp);
    expect(pins).toHaveLength(0);
  });

  it("does NOT pin tests", () => {
    write("src/api/getThing.test.ts", `
      it("works", async () => {
        const res = await fetch("/x", { headers: authHeaders() });
        if (!res.ok) throw new Error();
      });
    `);
    const pins = detectClientFetchPins(tmp);
    expect(pins).toHaveLength(0);
  });

  it("dedupes — one pin per (file, source) pair", () => {
    write("src/api/multi.ts", `
      async function a() {
        const res = await fetch("/x", { headers: authHeaders() });
        if (!res.ok) throw new Error();
        return res.json();
      }
      async function b() {
        const res = await fetch("/y", { headers: authHeaders() });
        if (!res.ok) throw new Error();
        return res.json();
      }
    `);
    const pins = detectClientFetchPins(tmp);
    // Should produce 2 pins (one for auth-headers, one for error-handling) — not 4
    expect(pins).toHaveLength(2);
  });
});
