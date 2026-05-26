// Template: react-route-registered
//
// Asserts a SPA route entry (react-router / tanstack-router) keeps
// being declared in the router config file. Catches accidentally-
// dropped <Route> registrations. LOW FP: looks for the literal path
// string in a <Route path="..."> or createRoute({ path: "..." })
// shape — bare path strings elsewhere in the file would also satisfy,
// but the same file containing the path string is enough signal.

import type { ReactRouteRegisteredClaim } from "../claimParser.js";
import { claimSlug } from "../claimParser.js";

export type GenerateOpts = { prId: string };
export type GeneratedTest = { filename: string; content: string; claimId: string };

export function generateReactRouteRegisteredTest(
  claim: ReactRouteRegisteredClaim,
  opts: GenerateOpts
): GeneratedTest {
  const slug = claimSlug(claim);
  const claimId = `${opts.prId}-${slug}`;
  const filename = `${claimId}.test.ts`;
  const content = `// ◆ Pinned by pinnedai — https://pinnedai.dev
// Template: react-route-registered
// Protects: route ${JSON.stringify(claim.routePath)} in ${JSON.stringify(claim.routerFilePath)}
// Retire:   pinned retire ${claimId} --reason="..."

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROUTER_FILE = ${JSON.stringify(claim.routerFilePath)};
const ROUTE_PATH = ${JSON.stringify(claim.routePath)};
const ORIGINAL_PR = ${JSON.stringify(opts.prId)};
const ORIGINAL_CLAIM = ${JSON.stringify(claim.raw)};

describe("pinned: react-route-registered " + ROUTE_PATH + " in " + ROUTER_FILE, () => {
  it("router config still declares " + ROUTE_PATH, () => {
    const full = resolve(process.cwd(), ROUTER_FILE);
    if (!existsSync(full)) {
      throw new Error(
        "═══ PINNED FAILURE ═══\\n" +
        "react-route-registered: " + ROUTER_FILE + " is missing.\\n" +
        "Claim: " + ORIGINAL_CLAIM + "\\n" +
        "PR: " + ORIGINAL_PR + "\\n"
      );
    }
    const content = readFileSync(full, "utf8");
    // Match common shapes: path="/foo", path: "/foo", path: '/foo'
    const escaped = ROUTE_PATH.replace(/[-/\\\\^$*+?.()|[\\]{}]/g, "\\\\$&");
    const re = new RegExp(
      "path\\\\s*[:=]\\\\s*[\\"'\\\`]" + escaped + "[\\"'\\\`]"
    );
    if (!re.test(content)) {
      throw new Error(
        "═══ PINNED FAILURE ═══\\n" +
        "react-route-registered: " + ROUTER_FILE + " no longer registers " + ROUTE_PATH + ".\\n" +
        "Claim: " + ORIGINAL_CLAIM + "\\n" +
        "PR: " + ORIGINAL_PR + "\\n" +
        "Restore the route, or retire:\\n" +
        "  pinned retire " + ${JSON.stringify(claimId)} + " --reason=\\"...\\"\\n"
      );
    }
    expect(re.test(content)).toBe(true);
  });
});
`;
  return { filename, content, claimId };
}
