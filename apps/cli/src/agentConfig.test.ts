import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { wireAgents, KNOWN_AGENT_TARGETS } from "./agentConfig.js";

describe("agentConfig.wireAgents", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "agent-config-"));
  });

  it("CRITICAL: default does NOT touch any agent file (no installAgentRules flag)", () => {
    // Set up an existing CLAUDE.md — the dangerous case where we used to silently append.
    writeFileSync(join(tmp, "CLAUDE.md"), "# my own claude.md\n");
    const originalBody = readFileSync(join(tmp, "CLAUDE.md"), "utf8");
    const results = wireAgents({ repoRoot: tmp }); // no installAgentRules!
    expect(results.every((r) => r.action === "skipped")).toBe(true);
    // CLAUDE.md must be UNCHANGED
    expect(readFileSync(join(tmp, "CLAUDE.md"), "utf8")).toBe(originalBody);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("does nothing when no agent files exist and createIfAbsent is false even with installAgentRules=true", () => {
    const results = wireAgents({ repoRoot: tmp, installAgentRules: true, createIfAbsent: false });
    expect(results.every((r) => r.action === "skipped")).toBe(true);
    expect(existsSync(join(tmp, "CLAUDE.md"))).toBe(false);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("bootstraps CLAUDE.md when no configs exist and BOTH installAgentRules + createIfAbsent are true", () => {
    const results = wireAgents({ repoRoot: tmp, installAgentRules: true, createIfAbsent: true });
    const claudeResult = results.find((r) => r.target.path === "CLAUDE.md");
    expect(claudeResult?.action).toBe("added");
    expect(existsSync(join(tmp, "CLAUDE.md"))).toBe(true);
    const body = readFileSync(join(tmp, "CLAUDE.md"), "utf8");
    expect(body).toContain("<!-- pinned:agent-rules:begin -->");
    expect(body).toContain(".pinned/ai-lessons.md");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("appends to existing CLAUDE.md preserving prior content when explicitly opted in", () => {
    const existing = "# CLAUDE.md\n\nMy project rules.\n";
    writeFileSync(join(tmp, "CLAUDE.md"), existing);
    const results = wireAgents({ repoRoot: tmp, installAgentRules: true });
    const r = results.find((x) => x.target.path === "CLAUDE.md");
    expect(r?.action).toBe("appended");
    const body = readFileSync(join(tmp, "CLAUDE.md"), "utf8");
    expect(body).toContain("My project rules.");
    expect(body).toContain("<!-- pinned:agent-rules:begin -->");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("is idempotent — re-running produces 'unchanged'", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# CLAUDE.md\n");
    wireAgents({ repoRoot: tmp, installAgentRules: true });
    const results2 = wireAgents({ repoRoot: tmp, installAgentRules: true });
    const r = results2.find((x) => x.target.path === "CLAUDE.md");
    expect(r?.action).toBe("unchanged");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("wires multiple existing configs in one pass when opted in", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "");
    writeFileSync(join(tmp, ".cursorrules"), "");
    mkdirSync(join(tmp, ".github"), { recursive: true });
    writeFileSync(join(tmp, ".github/copilot-instructions.md"), "");
    const results = wireAgents({ repoRoot: tmp, installAgentRules: true });
    const acted = results.filter((r) => r.action !== "skipped");
    expect(acted.length).toBeGreaterThanOrEqual(3);
    expect(readFileSync(join(tmp, "CLAUDE.md"), "utf8")).toContain(".pinned/ai-lessons.md");
    expect(readFileSync(join(tmp, ".cursorrules"), "utf8")).toContain(".pinned/ai-lessons.md");
    expect(readFileSync(join(tmp, ".github/copilot-instructions.md"), "utf8")).toContain(".pinned/ai-lessons.md");
    rmSync(tmp, { recursive: true, force: true });
  });

  it("onlyPath still requires installAgentRules opt-in", () => {
    const r = wireAgents({ repoRoot: tmp, onlyPath: "CLAUDE.md" }); // no installAgentRules
    expect(r[0].action).toBe("skipped");
    expect(existsSync(join(tmp, "CLAUDE.md"))).toBe(false);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("onlyPath + installAgentRules targets a single file regardless of existence", () => {
    const r = wireAgents({ repoRoot: tmp, installAgentRules: true, onlyPath: "CLAUDE.md" });
    expect(r).toHaveLength(1);
    expect(r[0].action).toBe("added");
    expect(existsSync(join(tmp, "CLAUDE.md"))).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("known targets list includes Claude / Cursor / Copilot / Aider", () => {
    const names = KNOWN_AGENT_TARGETS.map((t) => t.name);
    expect(names.some((n) => n.includes("Claude"))).toBe(true);
    expect(names.some((n) => n.includes("Cursor"))).toBe(true);
    expect(names.some((n) => n.includes("Copilot"))).toBe(true);
    expect(names.some((n) => n.includes("Aider"))).toBe(true);
  });
});
