import { describe, it, expect } from "vitest";
import { generateTest } from "./index.js";

describe("dump normalize regex from emitted test", () => {
  it("dumps the normalize line", () => {
    const claim = {
      template: "returns-status" as const,
      route: "/api/test",
      method: "POST" as const,
      status: 400,
      raw: "x",
      staticVerify: { filePath: "src/foo.ts", signature: "const r = schema.safeParse(body);" },
    };
    const gen = generateTest(claim, { prId: "test" });
    const normalizeLine = gen.content.split("\n").find((l) => l.includes("normalizeForSig =")) ?? "";
    console.log("\nEMITTED NORMALIZE LINE:");
    console.log(normalizeLine);

    // Eval the emitted normalize and test it (strip TS type ann)
    const fnSrc = normalizeLine
      .trim()
      .replace(/^const normalizeForSig = /, "")
      .replace(/;$/, "")
      .replace(/: string/g, ""); // strip the (s: string) TS annotation
    // eslint-disable-next-line no-eval, @typescript-eslint/no-explicit-any
    const fn = eval(fnSrc) as (s: string) => string;
    const single = "const r = schema.safeParse(body);";
    const multi = `const r = schema.safeParse(\n  body,\n);`;
    console.log("normalized single:", fn(single));
    console.log("normalized multi: ", fn(multi));
    console.log("includes:", fn(multi).includes(fn(single)));
    expect(fn(multi).includes(fn(single))).toBe(true);
  });
});
