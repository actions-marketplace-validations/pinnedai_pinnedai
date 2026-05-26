import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detectWebhookSignaturePins, detectInternalLinkPins } from "./scanDiff.js";

let tmp: string;
beforeEach(() => { tmp = mkdtempSync(join(tmpdir(), "wh-route-")); });
afterEach(() => { rmSync(tmp, { recursive: true, force: true }); });

function write(rel: string, content = "") {
  const abs = join(tmp, rel);
  mkdirSync(join(abs, "..").replace(/\/$/, ""), { recursive: true });
  writeFileSync(abs, content);
}

describe("detectWebhookSignaturePins", () => {
  it("captures Stripe constructEvent in a webhook handler", () => {
    write("app/api/webhook/stripe/route.ts", `
      import Stripe from "stripe";
      export async function POST(req: Request) {
        const sig = req.headers.get("stripe-signature")!;
        const event = stripe.webhooks.constructEvent(body, sig, secret);
        return Response.json({ received: true });
      }
    `);
    const pins = detectWebhookSignaturePins(tmp);
    expect(pins.length).toBe(1);
    expect(pins[0].provider).toBe("stripe");
    expect(pins[0].signature).toContain("constructEvent");
  });

  it("captures GitHub x-hub-signature handler", () => {
    write("apps/api/src/routes/webhook.ts", `
      const sig = req.headers["x-hub-signature-256"];
      // verify signature
    `);
    const pins = detectWebhookSignaturePins(tmp);
    expect(pins.length).toBe(1);
    expect(pins[0].provider).toBe("github");
  });

  it("captures generic crypto.createHmac signature verification", () => {
    write("server/webhooks/sentry.ts", `
      const hmac = crypto.createHmac("sha256", secret).update(body).digest("hex");
    `);
    const pins = detectWebhookSignaturePins(tmp);
    expect(pins.length).toBe(1);
    expect(pins[0].provider).toBe("generic-hmac");
  });

  it("does NOT fire on files without 'webhook' in the path", () => {
    write("src/lib/cryptoHelpers.ts", `
      export const sign = () => crypto.createHmac("sha256", "k").update("x").digest();
    `);
    const pins = detectWebhookSignaturePins(tmp);
    expect(pins).toHaveLength(0);
  });

  it("does NOT fire on test files even if they're in webhook paths", () => {
    write("app/api/webhook/stripe.test.ts", `
      stripe.webhooks.constructEvent(b, s, k);
    `);
    const pins = detectWebhookSignaturePins(tmp);
    expect(pins).toHaveLength(0);
  });
});

describe("detectInternalLinkPins", () => {
  it("pins a Next.js <Link href> that resolves to app router page", () => {
    write("app/pricing/page.tsx", `export default function Pricing() { return <div>Pricing</div>; }`);
    write("components/Nav.tsx", `
      import Link from "next/link";
      export const Nav = () => <Link href="/pricing">Pricing</Link>;
    `);
    const pins = detectInternalLinkPins(tmp);
    expect(pins.some((p) => p.targetRoute === "/pricing")).toBe(true);
  });

  it("does NOT pin a link to a route that doesn't resolve", () => {
    write("components/Nav.tsx", `
      const url = "/missing-page";
      <Link href="/missing-page">Missing</Link>
    `);
    const pins = detectInternalLinkPins(tmp);
    expect(pins.some((p) => p.targetRoute === "/missing-page")).toBe(false);
  });

  it("pins navigate('/path') calls", () => {
    write("pages/dashboard.tsx", `<div>dashboard</div>`);
    write("components/Login.tsx", `
      const onSubmit = () => navigate("/dashboard");
    `);
    const pins = detectInternalLinkPins(tmp);
    expect(pins.some((p) => p.targetRoute === "/dashboard")).toBe(true);
  });

  it("skips /api/ routes (they're not pages)", () => {
    write("components/Form.tsx", `fetch("/api/users")`);
    const pins = detectInternalLinkPins(tmp);
    expect(pins.some((p) => p.targetRoute.startsWith("/api/"))).toBe(false);
  });

  it("skips external URLs", () => {
    write("components/Foo.tsx", `<a href="https://example.com">ex</a>`);
    const pins = detectInternalLinkPins(tmp);
    expect(pins).toHaveLength(0);
  });

  it("dedupes per (sourceFile, route)", () => {
    write("app/about/page.tsx", `<div>about</div>`);
    write("components/Nav.tsx", `
      <Link href="/about">About</Link>
      <Link href="/about">About again</Link>
    `);
    const pins = detectInternalLinkPins(tmp);
    expect(pins.filter((p) => p.targetRoute === "/about" && p.sourceFile === "components/Nav.tsx")).toHaveLength(1);
  });
});
