/**
 * The baked CORE agent briefing surfaced by bare `harness instructions` (plan
 * 014 AC-1). A TS constant on purpose: it documents the CLI's own contract, so
 * it should version with the CLI binary (plan § Accepted assumptions) — unlike
 * per-extension briefings, which live beside their extension as
 * `.harness/extensions/<name>/instructions.md` and are read from disk at every
 * invocation.
 *
 * Audience: the CALLING agent (not minih workers, not humans skimming docs).
 */
export const CORE_INSTRUCTIONS = `# Harness CLI — agent briefing

AGENTS START HERE. You are an agent operating this repository through its
engineering harness. Division of labour: **the harness brings determinism,
you bring the inference.** Verbs compute repeatable facts (run suites, collect
evidence, scaffold files); these instructions — and each verb's own briefing —
tell you the role you play around those facts and the judgment expected back.

## The envelope contract

Every command emits ONE envelope. Pass \`--json\` to get it machine-readable:

  { "command", "status", "data", "error?", "next_action?", "timestamp" }

- \`status\` is one of: \`ok\` | \`degraded\` | \`unconfigured\` | \`error\`.
- Exit codes: 0 = ok/degraded · 2 = unconfigured · 1 = error.
- \`next_action\` is REQUIRED on any non-ok status — it is the prescribed fix.
  Follow it before improvising.
- The harness never fakes success: \`unconfigured\` means "nothing is mapped
  here yet", not "it worked".

## Self-briefing loop (one hop each)

1. \`harness help --json\` — the verb map; each verb carries
   \`has_instructions\` so you know which briefings exist.
2. \`harness doctor --json\` — what loaded, what failed, and why (per-extension
   provenance; convention complaints; every complaint has a next_action).
3. \`harness instructions <verb>\` — read a verb's briefing BEFORE using it.
   It states what the verb computes deterministically and what judgment it
   expects back from you.

## Friction capture (observe as you work)

Notice friction while you work? Capture it the moment it happens — one
command, no path/ID/timestamp bookkeeping, and it survives context
compaction (the buffer lives on disk):

  harness observe "<what happened, 10+ chars>" --kind difficulty --severity degrading

- Kinds: difficulty | magic-wand | gift | insight | coordination |
  improvement-suggestion | confusion. Severities: blocking | degrading |
  annoying. \`--target\`, \`--workaround\`, \`--suggested-encoding\` optional.
- Identity is optional: \`--agent <slug>\` → \`HARNESS_AGENT\` env → a shared
  \`agent\` bucket. Capture never fails on identity.
- Two storage classes: \`.harness/records/\` is COMMITTED team memory;
  \`.harness/temp/\` is TRANSIENT session scratch — gitignored, never
  committed (capture and \`harness record\` calls self-heal the protection;
  \`harness doctor\` checks it).
- Drain at session end: \`harness observe --list --json\` sweeps all buckets →
  save what matters via \`harness record retro\` (use the returned
  \`data.path\`) → \`harness observe --clear\`.

## Where briefings live

Each extension is a little package: \`.harness/extensions/<name>/\` with
\`extension.ts\` (the verb code) and \`instructions.md\` (the briefing you are
reading the equivalent of now). Briefings are loaded from disk at every
invocation — edits are live on the next call, no rebuild. Multi-verb
extensions share their folder's single briefing.
`;
