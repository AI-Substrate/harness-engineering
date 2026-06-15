# Workshop: `harness init` — seed the governance-doc skeleton

**Type**: CLI Flow
**Plan**: 008-harness-setup-flow
**Spec**: [`../harness-setup-flow-spec.md`](../harness-setup-flow-spec.md) (this command is that spec's named Non-Goal / forward dependency — designed here)
**Created**: 2026-06-14T21:26:15Z
**Status**: Draft

**Value Thesis**: Pin a *deliberately small* `harness init` so `/plan-3` can build it as a drop-in sibling of `harness new` / `harness record`: one command that stamps the `.harness/engineering-harness.md` **skeleton** (fixed headings + L0 seed + empty injection map) and returns its path — never populating repo-specific fields, never faking harness state. Shipping it closes the "owed, not provisioned" hole: boot moves `UNAVAILABLE → L0`, and adopt finally has a doc to weave the injection map into.

**Target Proof Level**: Contract Ready
**Current Proof Level**: Preferred Direction → Contract Ready

**Selected Value Axes**:
- **Agent Readiness**: stable `--json` envelope + honest exit code; the returned `data.path` is the hop-to-next.
- **Implementation Readiness**: concrete act/service/template/error-code wiring for the architect.
- **Honesty (never fake success)**: a seeded doc reports L0 and empty fields — it states what *is*, not what's aspirational.
- **Operator Usability**: one command, no flags required, idempotent.

**Related Documents**:
- The doc this seeds: [`../../../../skills/eng-harness-loop/eng-harness-flow/references/governance-doc.md`](../../../../skills/eng-harness-loop/eng-harness-flow/references/governance-doc.md) (the canonical contents + write-conditions; G5 row "Inception" is *this command*)
- Closest precedent: `harness record` — [`../../012-harness-record-command/workshops/002-cli-shape.md`](../../012-harness-record-command/workshops/002-cli-shape.md)
- Sibling acts: `harness/cli/src/acts/new.ts`, `harness/cli/src/acts/record.ts` + `services/record/`
- Envelope/exit contract: `harness/cli/src/output/{envelope,error-codes,exit}.ts`
- Reserved-name set: `harness/cli/src/services/extensions/registry.ts:46-55`

---

## Purpose

Specify the smallest `harness init` that fills the **Inception** write-condition for the governance doc (`governance-doc.md` G5): create `.harness/engineering-harness.md` with the BIO headings, signal-inventory skeleton, evidence-path placeholders, a seed L0 maturity snapshot, an empty `## Injection map`, and the `AGENTS START HERE` breadcrumb — then return the path. Repo-specific content (boot command, real signals, maturity) is **out of scope by design** — the skills (`eng-harness-0-adopt`, `eng-harness-0-harnessability-assessment`) and the Improve beat fill those.

## Fresh Entrant Outcome

A fresh agent/human reaches **Contract Ready**: they can implement `acts/init.ts` + `services/init/` knowing the exact skeleton bytes, the path, the never-clobber rule, every envelope field, and the exit/error codes. They can run `harness init`, parse `data.path`, and know the doc is a skeleton awaiting the adopt flow.

## Key Questions Addressed

- What exactly does `init` write, byte-for-byte (the skeleton template)?
- What is explicitly **left empty** for the skills to fill, and why?
- What happens when the doc already exists (idempotency)?
- How does this stay a sibling of `new`/`record`, not a new pattern?
- What status/exit/error codes does each path return?

---

## Value Frame

| Field | Selection | Why It Matters |
|---|---|---|
| Target Proof Level | Contract Ready | Architect builds the act/service/template from this. |
| Primary Value Axis | Honesty (never fake success) | A seeded doc must report L0 + empty fields, not a fabricated boot command or maturity. |
| Supporting Value Axes | Agent Readiness, Implementation Readiness, Operator Usability | Stable envelope, buildable wiring, one idempotent command. |
| Downstream Loop Improved | Adoption + Boot | Boot reads a real L0 snapshot instead of `UNAVAILABLE`; adopt Step 3 has a doc to weave the injection map into. |

---

## The shape in one line

```
harness init  →  writes .harness/engineering-harness.md (skeleton) if absent  →  returns its path
```

No required flags. It is the governance-doc analogue of `harness new boot --wrap` (stamps an extension stub the agent fills) and `harness record retro` (stamps a templated record the agent writes into): **deterministic scaffold from the CLI, repo-specific content from the skills.**

---

## 1. What it writes — the skeleton template (the whole artifact)

A single fixed string lives in `services/init/` (mirroring `services/record/core-types/retro.ts`). It carries every heading `governance-doc.md:24-35` enumerates, with HTML-comment guidance and `TODO` markers where the repo-specific content goes:

```markdown
# Engineering harness

> **AGENTS START HERE → `npx --no-install harness instructions`** — the CLI's
> baked agent briefing (envelope contract, role split, discovery loop). Then
> `npx --no-install harness instructions <verb>` per verb.

## Boot command
<!-- TODO (eng-harness-0-adopt / `harness new boot --wrap "<cmd>"`):
     the exact command that boots the system to a healthy, observable state (<60s target). -->

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
**L0 — seeded at inception by `harness init`; nothing proven yet.**
<!-- The single, current L0–L4 level the harness is ACTUALLY at. Updated ONLY at
     the Improve beat (never by boot, which is read-only). See maturity-assessment.md. -->
```

> **Section names + order mirror the canonical governance doc verbatim** (this repo's own `.harness/engineering-harness.md`): `## Boot command` / `## Health check` / `## Interact method` / `## Observe method` / `## Deterministic signal inventory` / `## Evidence paths` / `## Injection map` / `## Back-pressure gaps` / `## Current maturity snapshot`. Maturity is its **own trailing section** (not an inline line), so boot/adopt/router read the seeded doc as a real governance doc — just at L0 with empty bodies.

**Decision Space**
- **Static skeleton (preferred)** — one constant string, zero interpolation. Truly a "copy in a template." Simplest, deterministic, trivially snapshot-tested.
- *Rejected for v1*: interpolating the repo name from `package.json`, stamping a created-date. Adds a port dependency (fs read / Clock) and a failure mode for ~no value. Revisit if a real need appears.

> **The load-bearing constraint**: `init` writes **only** the skeleton. It must never guess a boot command, invent signals, or seed a maturity above L0 — a populated-but-false doc would make boot misreport and violates "the harness never fakes success." Emptiness here is correctness.

---

## 2. Path, collision, and idempotency (the locked rules)

```
.harness/engineering-harness.md          ← the one fixed path (singleton; no date, no slug)
```

- `.harness/` is `mkdirp`'d if missing — bootstrapping `.harness/` is precisely `init`'s job. (Contrast `record`, which returns `unconfigured` when `.harness/` is absent.)
- **Scope = one file.** `init` does **not** seed `.harness/history.md` (sparse, written at the Improve beat) and does **not** create `.harness/extensions/` (lazy via `harness new`). Keep it minimal.
- **Never clobber.** If `.harness/engineering-harness.md` already exists, `init` does **not** overwrite. It reports an idempotent success (see envelope below) — re-running `init` is always safe.

---

## 3. Output envelope + exit codes

### Created (the doc was absent)

```jsonc
{
  "command": "init",
  "status": "ok",
  "timestamp": "2026-06-14T21:26:15Z",
  "data": { "path": ".harness/engineering-harness.md", "created": true, "maturity_seed": "L0" },
  "evidence": [ { "label": "governance doc", "path": ".harness/engineering-harness.md" } ],
  "next_action": "Run eng-harness-0-adopt (or fill the TODO sections by hand) to populate boot, signals, and the injection map."
}
```
Exit `0`.

### Already present (idempotent no-op)

```jsonc
{
  "command": "init",
  "status": "ok",
  "timestamp": "...",
  "data": { "path": ".harness/engineering-harness.md", "created": false },
  "evidence": [ { "label": "governance doc", "path": ".harness/engineering-harness.md" } ],
  "next_action": "Already present — left untouched. Edit it directly, or run eng-harness-0-adopt to fill the injection map."
}
```
Exit `0`. (`created:false` is the signal a caller/skill keys on; no clobber, no error.) **`maturity_seed` appears only on `created:true`** — it names what this run seeded; an idempotent re-run that wrote nothing omits it.

### Write failure (fs error)

`status: "error"`, exit `1`, a new error code **`E190` (`INIT_WRITE_FAILED`)** with the underlying reason in `error.message` and a `next_action`. No stack traces (envelope contract). *(Originally drafted as `E150`, but that's already `SCAFFOLD_INVALID_NAME` — `E190` is the free decade, matching the per-command convention.)*

> **No `--force` in v1.** Overwriting a populated governance doc is destructive (it holds the real maturity + injection map by then). Leave it out; add later behind an explicit flag if a genuine reset need appears. Logged as an Open Question.

---

## 4. Architecture wiring (sibling of `new`/`record`)

- **Reserved core name**: add `'init'` to `RESERVED_NAMES` (`registry.ts:46-55`) — joins `help/doctor/new/docs/skills/record/instructions/observe`. Cannot be shadowed by an extension; runs in `--no-extensions` safe mode.
- **Act**: `acts/init.ts` → `registerInitAct(program, io, deps)`, wired in `app.ts`'s `main` alongside the other `register*Act` calls.
- **Service**: `services/init/` — a **pure, I/O-free template builder** (`buildGovernanceSkeleton(): string`, unit-tested by snapshot) + the skeleton constant. The act does the fs side-effects via the injected `fs` port (`exists` → `mkdirp` → `writeFile`), never the service.
- **Ports**: `fs` only. No Clock needed (static skeleton, fixed path). No `exec`.

### Packaging — there is no file to install (resolved)

The skeleton is a **TypeScript string constant** (`services/init/governance-template.ts` → `export const GOVERNANCE_SKELETON = \`…\``), not a `.md` asset read at runtime. The published package ships **only compiled `dist/`** — `package.json` `files: ["harness/cli/bin", "harness/cli/dist", "LICENSE"]`; `src/` is *not* in the tarball. So:

- `tsc` compiles the constant to `harness/cli/dist/services/init/governance-template.js`, which falls inside the `dist` glob and ships **automatically**. The act `import`s it and `fs.writeText`s the body — identical to how `record` ships `RETRO_TEMPLATE` (`services/record/core-types/retro.ts` → `record-service.ts:174 fs.writeText(fileAbs, entry.template)`) and how `harness new` ships its stubs (`services/scaffold/templates.ts`).
- **Zero changes** to `package.json` `files`, the `build`/`prepare` step, or `gen:docs`. No runtime path resolution (`import.meta.url`), no fs read that can fail.

Rejected alternatives (only worth it if the template must be a human-reviewable `.md`, which it need not be):
- *Raw `.md` shipped + read at runtime* — requires adding its dir to `files` **and** resolving its path relative to `dist` at runtime (fragile across layout, read can fail).
- *Build-time embed (the docs pattern)* — `gen-docs.mjs` reads curated `.md` + `docs-manifest.json` and emits the generated `docs-content.ts`; the generated `.ts` is what ships, gated by `check:docs` drift. Strictly more machinery than a static skeleton warrants.

The inline constant is the precedent the repo already uses for **every** template it stamps — keep `init` on it.

---

## 5. What this deliberately does NOT do (don't boil the ocean)

- ❌ Populate boot command / health check / signals / evidence paths / maturity — **skills + Improve beat** own that (`governance-doc.md` G5 rows 2–3).
- ❌ Fill the injection map — `eng-harness-0-adopt` Step 3 writes it into the *existing* doc.
- ❌ Seed `.harness/history.md` or scaffold `.harness/extensions/`.
- ❌ Run any assessment, infer maturity, or shell out.
- ❌ `--force` / overwrite.

`init` creates the *container*; the loop fills it. That split is the same one `new` and `record` already prove.

---

## Decision Space (summary)

| # | Decision | Preferred | Alternatives (rejected for v1) |
|---|---|---|---|
| D1 | Template form | Static constant string, zero interpolation | Interpolate repo name / created-date |
| D2 | Scope | One file: the governance-doc skeleton | Also seed history.md / extensions/ |
| D3 | `.harness/` missing | `mkdirp` it (init bootstraps it) | `unconfigured` like `record` |
| D4 | Doc already exists | Never clobber → idempotent `ok` (`created:false`) | `--force` overwrite; `degraded` |
| D5 | Maturity seed | `L0` (honest — nothing proven) | Infer / omit |
| D6 | Ports | `fs` only | Clock for a created-date |

---

## Evidence Ledger

| Claim | Source |
|---|---|
| `init` is the named Non-Goal / forward dependency of this plan | `../harness-setup-flow-spec.md` Non-Goals + Goals ("Generate no artifacts of its own — `harness init` and the CLI own all generated files") |
| The doc's contents + the "Inception → `harness init` writer" write-condition | `skills/.../eng-harness-flow/references/governance-doc.md:24-35, 63` |
| Boot degrades to `UNAVAILABLE` purely because the writer is deferred | `skills/.../eng-harness-1-boot/SKILL.md` (description + body) |
| Reserved core-name set to extend | `harness/cli/src/services/extensions/registry.ts:46-55` |
| Sibling pattern (act + pure service + template constant + never-clobber + path-in-envelope) | `harness/cli/src/acts/record.ts`, `services/record/core-types/retro.ts`; `../../012-harness-record-command/workshops/002-cli-shape.md` |
| CLI registers no `init` today (the gap) | `harness/cli/src/app.ts` registers `help`/`doctor`/`new`/`docs`/`skills`/`record`/`instructions`/`observe` + extension verbs — no `init` |
| Only compiled `dist/` ships (template must be a `.ts` constant, not a raw asset) | root `package.json` `files: ["harness/cli/bin", "harness/cli/dist", "LICENSE"]` |
| Template-as-`.ts`-constant pattern already used twice | `services/record/core-types/retro.ts` (`RETRO_TEMPLATE`, written at `record-service.ts:174`); `services/scaffold/templates.ts` (`harness new` stubs) |
| Heavier build-embed alternative (for reviewable `.md`) | `scripts/gen-docs.mjs` → generated `services/docs/docs-content.ts`, gated by `check:docs` |

---

## Open Questions

### Q1: New error code for write failure — ✅ RESOLVED → `E190`
A dedicated `ErrorCodes.INIT_WRITE_FAILED = 'E190'`, parallel to `record`'s codes. (The first draft said `E150`, but `E150` is already `SCAFFOLD_INVALID_NAME`; `E190` is the next free decade.)

### Q2: Should `created:false` ever be `degraded` instead of `ok`?
Preferred: `ok` — the existing doc is the desired end state; an idempotent re-run is a success, not a degradation. (Flagged in case a caller wants a louder signal.)

### Q3: Does shipping `init` trigger a doc de-reference sweep now, or later?
Once `init` exists, the "owed, not provisioned" language across the skills (`eng-harness-flow`, `eng-harness-0-adopt`, `eng-harness-1-boot`, `skills/README.md`, `AGENTS_README.md`) can be simplified, and the AGENTS_README troubleshooting row ("`harness init` → unknown command … skip it") removed. **Out of scope for this workshop** — a follow-up edit pass. Noted so it isn't forgotten.

---

## Validation / Acceptance

- [ ] `harness init` in a repo with no `.harness/` creates `.harness/engineering-harness.md` whose section set + order match the canonical governance doc verbatim (`## Boot command` … `## Current maturity snapshot`, per this repo's `.harness/engineering-harness.md` / `governance-doc.md:24-35`), with `## Current maturity snapshot` seeded `L0` and an empty `## Injection map` table → exit `0`, `data.created:true`.
- [ ] Re-running `harness init` leaves the file byte-identical, returns `data.created:false`, exit `0` (idempotent; never clobbers).
- [ ] `harness init --json` emits a valid envelope with `data.path` + `evidence[0].path` = `.harness/engineering-harness.md`.
- [ ] An extension declaring a verb named `init` is refused (reserved-name conflict, like `record`).
- [ ] Pure `buildGovernanceSkeleton()` matches a committed snapshot (no I/O in the service).
- [ ] fs write failure surfaces `status:error`, exit `1`, `error.code` set, `next_action` present, no stack trace.
