# impl-guide — plan 091 proving packet (settings machinery + convo sync)

Mode: BUILD · Isolation: this worktree (s091/ways-of-working), coder branches off it
Tenets: pij-team TENETS.md apply; this guide instantiates them for harness-engineering.

## Units (seams frozen BEFORE any fan-out)

U1 `services/settings/` — settings.ts (PURE: resolve(repoText, localText, env) →
   ResolvedSettings with per-key origin; governance-key-in-local = refusal) +
   load-settings.ts (Pick<FsPort,'exists'|'readText'> + EnvPort → calls pure).
   Namespaces frozen NOW: `governance.*` (tracked-only) · `machine.*` (local may
   override) · consent keys (`flowspace.ingest.enabled`) are governance-class:
   tracked file or default only. Kill switch HARNESS_NO_TELEMETRY absolute.
U2 `services/convo/` — sync-service.ts behind a Flowspace port
   {detect(): bool; ping(): bool; ingest(args): void-fire-and-forget} + fake.
   Consumes a RESOLVED {enabled, origin} — never the settings reader (IngressReading
   precedent, commit.ts).
U3 wiring — acts/convo.ts (`harness convo sync`) + commit-seam call + boot drain.
   Act composes adapters exactly as acts/commit.ts does. transcript_path from the
   hook payload is NEVER journalled or echoed in errors (hook-payload.ts:60 contract).

## Waves
W1: U1 alone (everything hangs off it; its tests are pure-string).
W2: U2 + U3 (U2's port is frozen at W1 close; U3 consumes both).
A W2 need to change U1's surface = STOP-AND-ASK; U1's owner edits, W2 rebases.

## Collision surface
U1 and U2 share zero files. U3 touches acts/ + app.ts registration + commit.ts
(one call site) — U3 is the integrator; U1/U2 ship recipes (doc-comment wiring),
never edits to shared files.

## Done-bar (mechanical, per unit)
`cd harness/cli && vitest run` green IN THE WORKTREE · `just fix` clean · receipts:
exact commands + tails · mutation check stated (the fix's test fails without the
fix) · for U1: the refusal cases (governance key in local; malformed file; unknown
major) each have a test that REFUSES — a gate is not verified until it has refused.
