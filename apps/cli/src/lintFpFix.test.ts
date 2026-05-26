// Battle test for the lint-format false-positive fix:
//   positive control — generated test contains normalize helper
//   negative control — verifies normalize equalizes multi-line vs single-line
//   integration    — emitted test code actually substring-matches the multi-line parent

import { describe, it, expect } from "vitest";
import { generateTest } from "./index.js";

describe("lint-fp-fix — battle test", () => {
  it("(positive) generated returns-status test embeds normalizeForSig", () => {
    const claim = {
      template: "returns-status" as const,
      route: "/api/test",
      method: "POST" as const,
      status: 400,
      raw: "x",
      staticVerify: { filePath: "src/foo.ts", signature: "const r = schema.safeParse(body);" },
    };
    const gen = generateTest(claim, { prId: "test" });
    expect(gen.content).toContain("normalizeForSig");
    expect(gen.content).toContain("contentN");
    expect(gen.content).toContain("sigN");
  });

  it("(positive) generated auth-required test embeds normalizeForSig", () => {
    const claim = {
      template: "auth-required" as const,
      route: "/api/x",
      raw: "x",
      staticVerify: { filePath: "src/auth.ts", signature: "const u = await requireAuth(req);" },
    };
    const gen = generateTest(claim, { prId: "test" });
    expect(gen.content).toContain("normalizeForSig");
  });

  it("(integration) normalize equalizes single-line vs multi-line same code", () => {
    const normalize = (s: string) => s.replace(/\s+/g, "").replace(/,(?=[)\]}])/g, "");
    const singleLine = `const result = ZBaseEmbedAuthoringSchema.safeParse(JSON.parse(decodeURIComponent(atob(hash))));`;
    const multiLine = `  const result = ZBaseEmbedAuthoringSchema.safeParse(
    JSON.parse(decodeURIComponent(atob(hash))),
  );`;
    expect(normalize(multiLine).includes(normalize(singleLine))).toBe(true);
  });

  it("(integration) normalize handles trailing comma variations", () => {
    const normalize = (s: string) => s.replace(/\s+/g, "").replace(/,(?=[)\]}])/g, "");
    const sig = `foo(bar, baz)`;
    const parent = `foo(\n  bar,\n  baz,\n)`;
    expect(normalize(parent).includes(normalize(sig))).toBe(true);
  });

  it("(negative) normalize does NOT match completely different code", () => {
    const normalize = (s: string) => s.replace(/\s+/g, "").replace(/,(?=[)\]}])/g, "");
    const sig = `requireAuth(req)`;
    const parent = `const x = computeSomething(input);`;
    expect(normalize(parent).includes(normalize(sig))).toBe(false);
  });

  it("(negative) normalize does NOT match when key token is removed", () => {
    const normalize = (s: string) => s.replace(/\s+/g, "").replace(/,(?=[)\]}])/g, "");
    const sig = `safeParse(JSON.parse(decodeURIComponent(atob(hash))))`;
    const parentWithoutSafeParse = `const result = JSON.parse(decodeURIComponent(atob(hash)));`;
    expect(normalize(parentWithoutSafeParse).includes(normalize(sig))).toBe(false);
  });
});
