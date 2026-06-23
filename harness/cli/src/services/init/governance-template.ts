/**
 * The governance-doc skeleton `harness init` stamps. An inline TypeScript string
 * constant (mirroring `services/record/core-types/retro.ts` → `RETRO_TEMPLATE`
 * and `services/scaffold/templates.ts`): it compiles into `dist/` and ships via
 * the existing `files: ["harness/cli/bin","harness/cli/dist","LICENSE"]` glob —
 * no `package.json`/build/`gen:docs` change, no runtime file read.
 *
 * Scaffold-and-seed ONLY. The skeleton's section set + order mirror the canonical
 * governance doc (`skills/eng-harness-loop/eng-harness-flow/references/governance-doc.md`
 * and this repo's own `.harness/engineering-harness.md`) so its runtime readers —
 * boot (maturity), `eng-harness-0-adopt` (the `## Injection map`), and the
 * router's S3 rung — recognise it as a real governance doc. Every repo-specific
 * field is a `TODO`/empty placeholder and maturity is seeded `L0`: a
 * populated-but-false doc would make boot misreport and violates "the harness
 * never fakes success". Emptiness here is correctness — the skills and the
 * Improve beat fill the body.
 *
 * This module is intentionally I/O-free (zero imports): the act owns the fs
 * side-effects via the injected `fs` port, never the builder (Constitution P2).
 */
export const GOVERNANCE_SKELETON = `# Engineering harness

> **AGENTS START HERE → \`harness instructions\`** — the CLI's baked agent
> briefing (envelope contract, role split, discovery loop). Then
> \`harness instructions <verb>\` per verb.

## Boot command
<!-- TODO (eng-harness-0-adopt / \`harness new boot --wrap "<cmd>"\`):
     the exact command that boots the system to a healthy, observable state (<60s target).
     Composes \`harness checks\` (below) once services are ready. -->

## Checks command
<!-- TODO (eng-harness-0-adopt / \`harness new checks --wrap "<aggregate lint+test+typecheck recipe>"\`):
     the mandated quality gate (lint, unit tests, typecheck…). Agents run \`harness checks\` before
     work is "done"; teams gate commits/push on it; \`harness boot\` composes it. Extend as the team grows. -->

## Health check
<!-- TODO: the command/endpoint that proves the system is up (read by boot Stage 1). -->

## Interact method
<!-- TODO: how an agent sends input to the running system (boot Stage 2). -->

## Observe method
<!-- TODO: how an agent captures evidence — logs, screenshots, traces (boot Stage 3). -->

## Deterministic signal inventory
<!-- TODO: sensors that prove behaviour without inference — runtime inspectability,
     smoke paths, architecture/static checks, security/dependency/schema checks. -->

## Evidence paths
<!-- TODO: where artifacts land (log/trace/screenshot/output locations). -->

## Injection map
<!-- Where the repo's extant dev/SDD flow calls /eng-harness-flow. One row per seam.
     Filled by eng-harness-0-adopt Step 3 (with the user's go-ahead). -->

| Seam event | Fires from | What fires it |
|---|---|---|
| <!-- e.g. session-start --> | | |

## Back-pressure gaps
<!-- TODO: behaviours still relying on inference/human eyeballing — improvement
     candidates, named honestly. Never scores. -->

## Current maturity snapshot
**L0 — seeded at inception by \`harness init\`; nothing proven yet.**
<!-- The single, current L0–L4 level the harness is ACTUALLY at. Updated ONLY at
     the Improve beat (never by boot, which is read-only). See maturity-assessment.md. -->
`;

/**
 * The governance-doc skeleton `harness init` writes. Pure — no fs/clock/process
 * access — so it is unit-testable by snapshot and stays a deterministic "copy in
 * a template". Repo-specific content is the skills' / Improve beat's job.
 */
export function buildGovernanceSkeleton(): string {
  return GOVERNANCE_SKELETON;
}
