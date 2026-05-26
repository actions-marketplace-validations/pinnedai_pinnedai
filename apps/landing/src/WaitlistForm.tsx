// Waitlist email collection form for Founder Pro interest signal.
// Per [[tier-model-final-2026-05-23]]: the waitlist is an interest
// gauge, not a feature sale.
//
// Wiring:
//   Set VITE_PINNED_WAITLIST_ENDPOINT at build time to point at your
//   collector (Tally / Formspree / a Cloudflare Worker endpoint).
//   The endpoint receives:
//     POST application/json
//     { email: string, mostWantedFeature?: string, source: "landing-waitlist" }
//
// Without the env var, the form shows the email + selected feature
// in the success state and writes them to console so the operator can
// see what would have been submitted. This keeps the form shippable
// before the backend is wired.

import { useState } from "react";

const FEATURE_OPTIONS = [
  { value: "", label: "Which Pro feature matters most? (optional)" },
  { value: "pr-comments", label: "PR comments with repair prompts" },
  { value: "cross-repo-lessons", label: "Cross-repo AI lessons" },
  { value: "hosted-ai", label: "Hosted AI (no API key needed)" },
  { value: "cloud-history", label: "Cloud proof / history dashboard" },
  { value: "agent-analytics", label: "AI / provider mistake analytics" },
  { value: "managed-ci", label: "Managed CI enforcement policies" },
  { value: "custom-templates", label: "Custom guard templates" },
  { value: "team-policies", label: "Team policies + audit log" },
];

const ENDPOINT = (import.meta as unknown as { env?: { VITE_PINNED_WAITLIST_ENDPOINT?: string } }).env?.VITE_PINNED_WAITLIST_ENDPOINT;

export function WaitlistForm() {
  const [email, setEmail] = useState("");
  const [feature, setFeature] = useState("");
  const [state, setState] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !email.includes("@")) {
      setErrorMsg("Enter a valid email address.");
      setState("error");
      return;
    }
    setState("submitting");
    setErrorMsg("");

    const payload = {
      email: email.trim(),
      mostWantedFeature: feature || undefined,
      source: "landing-waitlist",
      submittedAt: new Date().toISOString(),
    };

    if (!ENDPOINT) {
      // Backend not configured. DO NOT show fake success — that's the
      // "every signup is silently dropped" launch bug. Be honest.
      // eslint-disable-next-line no-console
      console.warn(
        "[pinnedai waitlist] VITE_PINNED_WAITLIST_ENDPOINT not configured at build time; refusing to fake-accept.",
        payload
      );
      setErrorMsg(
        "Waitlist isn't accepting signups yet — we're still wiring the email backend. " +
          "For now: star github.com/pinnedai/pinnedai to follow along, or email michaelzon7@gmail.com to be added manually."
      );
      setState("error");
      return;
    }

    try {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        throw new Error(`Server returned ${res.status}`);
      }
      setState("success");
    } catch (err) {
      setErrorMsg((err as Error).message || "Submission failed. Try again in a moment.");
      setState("error");
    }
  }

  if (state === "success") {
    return (
      <div className="waitlist-success" role="status">
        <strong>✓ You're on the Founder Pro waitlist.</strong>
        <p>
          We'll email <code>{email}</code> when paid opens with locked founder pricing.
          {feature ? (
            <>
              {" "}Noted you'd most want <em>{FEATURE_OPTIONS.find((f) => f.value === feature)?.label.toLowerCase()}</em> — that helps us prioritize.
            </>
          ) : null}
        </p>
      </div>
    );
  }

  return (
    <form className="waitlist-form" onSubmit={handleSubmit}>
      <input
        type="email"
        required
        placeholder="you@yourcompany.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={state === "submitting"}
        aria-label="Email address"
      />
      <select
        value={feature}
        onChange={(e) => setFeature(e.target.value)}
        disabled={state === "submitting"}
        aria-label="Most wanted Pro feature"
      >
        {FEATURE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <button type="submit" disabled={state === "submitting"}>
        {state === "submitting" ? "Submitting…" : "Join the waitlist →"}
      </button>
      {state === "error" ? (
        <p className="waitlist-error" role="alert">{errorMsg}</p>
      ) : null}
      <p className="waitlist-hint">No payment, no card. Interest signal only — we'll email when paid opens.</p>
    </form>
  );
}
