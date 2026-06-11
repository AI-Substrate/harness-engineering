# Arch Conformance Exemplar Extension: Deterministic Architectural Back Pressure via dependency-cruiser

**Mode**: Simple
**Created**: 2026-06-10
**Original ask**: [original-ask.md](./original-ask.md)

📚 Specification incorporates findings from `original-ask.md` — the in-session tool investigation (2026-06-10) that evaluated dependency-cruiser, eslint-plugin-boundaries, ts-arch/ArchUnitTS, madge, CodeQL, and roll-your-own ts-morph, and proved a 7-rule dependency-cruiser PoC against the live codebase. No separate research dossier was needed; the investigation record carries the verdict and the evidence.

> **Verb name (locked in Round 2)**: **`arch-check`** — chosen over the `arch` working default for explicitness that it is a check; not in `RESERVED_NAMES` (an exact-name list). All commands and paths in this spec use it.

## Research Context

Key facts established before this spec (all live-verified during the investigation or during spec validation, not assumed):

1. **Tool verdict: dependency-cruiser** (v17.x, repo devDependency). It is the only candidate that combines: a real rule engine (forbidden rules with regex `path`/`pathNot`), **type-only import detection** (`dependencyTypesNot: ['type-only']` — load-bearing for the "services import ports as types only" rule), schema'd JSON output (`--output-type json` → `summary.violations[]` with `from`/`to`/`rule{severity,name}`, plus `summary.totalCruised` module count and `summary.totalDependenciesCruised`), exit 1 on error-severity violations, and zero ESLint dependency (this repo uses Biome).
2. **PoC proven on the real codebase**: 7 hexagonal rules ran clean over `harness/cli/src` — 66 modules, 112 dependencies, 0 violations, exit 0. A seeded violation (`help-service.ts` importing concrete `node-fs.js`) was caught by the correct rule (`services-only-adapter-ports`) with structured JSON and exit 1, then reverted. The full proven rule config is committed at [`poc-arch-rules.cjs`](./poc-arch-rules.cjs) in this plan folder — the durable source of truth the implementation copies from (a `/tmp` scratch copy also exists but is not load-bearing).
3. **The 7 rules** encode the repo's hexagonal contract: `no-circular` · `services-never-import-acts` · `services-only-adapter-ports` (no concrete `node-*`/`exec-*`/`system-*` imports) · `services-ports-type-only` · `adapters-stay-leaf` · `output-stays-leaf` · `no-fakes-in-prod` (no `fake-*` outside `*.test.ts`/`*.spec.ts`). Every rule carries an agent-readable `comment`.
4. **Gotcha #1 — bare npx scans 0 modules**: dependency-cruiser computes its scannable-extension list from its *own* install location; the npx cache lacks `typescript`, so directory-mode scans silently return 0 modules. The verb must always invoke `./node_modules/.bin/depcruise` (the devDependency install). This is the single most likely silent-failure mode and must be encoded, not remembered.
5. **Gotcha #2 — no `tsConfig` option**: pointing depcruise at `harness/cli/tsconfig.json` from repo root throws TS18003 (its `include` resolves relative to cwd). The codebase has no path aliases, so the option is omitted — the PoC ran without it and parsed all 66 modules.
6. **Alternatives ruled out with reasons**: eslint-plugin-boundaries (forces ESLint beside Biome), ts-arch/ArchUnitTS (vitest-fluent but violations are prose strings — weak for a JSON envelope), madge (cycles only, no rule engine), CodeQL (QL authoring weight; private-repo use needs GitHub Advanced Security), ts-morph roll-your-own (reimplements ESM `.js`→`.ts` resolution and type-only detection for no gain over 7 declarative rules).
7. **Extension contract precedent** (from the two shipped exemplars): a folder at `.harness/extensions/<name>/` with `extension.ts` (default-exports a `HarnessVerb`) + `instructions.md` (agent briefing); guardrails — no `node:*` imports, all I/O via `ctx.exec`, never throws, every non-ok result carries a `next_action`. Existing extensions have **no unit tests**; they are validated by `doctor` loading them plus end-to-end runs.
8. **Exec port verified buildable** *(validation finding, in our favor)*: `ExecPort`'s `ExecResult` carries `{code, stdout, stderr, ok}` and **resolves — never rejects — on non-zero child exit** (`exec-port.ts`, `node-exec.ts` resolve on `close`). Parsing depcruise's JSON from a run that exits 1 is therefore supported by the existing contract; no CLI core change is needed.
9. **`arch-check` is not reserved** *(validation-verified)*: `RESERVED_NAMES` (`harness/cli/src/extensions/registry.ts`) = {help, doctor, new, docs, skills, record, instructions, observe} — exact names only; no collision.
10. **Hexagonal back pressure is currently prose-only**: the architecture is documented (cli-readme § Architecture, workshop 001) but nothing *proves* conformance — an agent or human can violate the layering and only an attentive reviewer catches it. This plan converts that inference into a deterministic sensor, which is the harness thesis applied to the harness itself.

## Summary

Add a third exemplar extension — an **`arch-check` verb** — that gives this repo deterministic architectural back pressure: it runs dependency-cruiser (a repo devDependency) over `harness/cli/src` against a committed rule set encoding the hexagonal (ports & adapters) contract, and maps the result into the harness envelope per the § Envelope & Exit Contract below. **Launch posture (grill decision, 2026-06-10): every rule ships at `warn` severity** — a violation surfaces as a `degraded`/exit 0 envelope plus a CI `::warning::` annotation naming the rule (its agent-readable `comment` quoted in `next_action`), never a red build; promoting severities to `error` (the blocking contract, fully specified below and unit-proven) is a deliberate future flip once the team has watched the sensor run. The rule config lives at the repo root as the single source of truth (usable by the verb, raw `depcruise` invocations, and CI alike); CI gains a step that invokes **the verb** (never raw depcruise) so violations surface — and, once promoted, fail the build — through the same code path developers use. As the third exemplar it demonstrates the pattern consumer repos should copy: *encode your architecture as rules; let the harness prove conformance instead of asking a reviewer to eyeball it.*

## Goals

- **Deterministic architecture proof**: the 7 PoC-proven hexagonal rules committed and continuously measured — a layering violation becomes a structured `degraded` envelope + a PR warning annotation at launch, and a red build once severities are promoted; never just a hopeful review comment.
- **Agent-legible failures**: each rule carries a `comment` written for the next agent ("Services may depend on adapter PORT interfaces only…"); a violation's envelope quotes it, so the fix is explained at the point of failure with no doc lookup.
- **Exemplar quality**: the extension models the established contract (guardrails, `instructions.md` briefing, honest statuses) well enough that a consumer repo can copy the shape and swap in its own rules — this is the "deterministic back pressure as an extension" pattern made concrete.
- **Single source of truth, single code path**: one root config consumed identically by the harness verb, direct `depcruise` runs, and CI — and CI exercises the verb itself, so the envelope mapping is continuously proven too.
- **Honest degradation**: every failure shape (tool missing, config missing, tool crash, warn-only violations) maps to the correct envelope status and exit code per § Envelope & Exit Contract — never a crash, never a fake `ok`.

## Non-Goals

- **No ESLint adoption** (and no eslint-plugin-boundaries) — Biome stays the only linter.
- **No CodeQL** — ruled out in the investigation (authoring weight, licensing).
- **No coverage beyond `harness/cli/src`** — extensions, skills, scripts, and docs are not architecture-checked (extension code is jiti-loaded consumer-side code, not part of the hexagonal core).
- **No graph visualization** — depcruise can emit dot/mermaid; out of scope (a natural future verb option, noted in Open Questions).
- **No new CLI core code** — this is an extension package + config + CI + docs; `harness/cli/src` itself needs zero changes (verified: the exec port already supports the required behavior, and `arch` is not reserved).
- **No custom dependency-cruiser reporter package** — the verb parses the standard `--output-type json` output.
- **No rule-authoring DSL or generalized "arch rules" product feature** — consumer repos copy the exemplar and write their own `.dependency-cruiser.cjs`.

## Target Domains

> This repo has no `docs/domains/` registry; domains below are the repo's informal areas (same framing as plans 014/015).

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| repo root config (`package.json`, `.dependency-cruiser.cjs`) | existing (informal) | **modify** | Add `dependency-cruiser` devDependency (version pinned by the committed lockfile); create the root rule config from [`poc-arch-rules.cjs`](./poc-arch-rules.cjs) |
| harness extensions (`.harness/extensions/`) | existing (informal) | **modify** (new package within) | New extension package at `.harness/extensions/arch-check/` — `extension.ts` (shells `./node_modules/.bin/depcruise --output-type json` via `ctx.exec`, maps results per § Envelope & Exit Contract) + `instructions.md` briefing. **No core registration code** — doctor/instructions auto-discover extension packages; AC-8 is verified by running the CLI, not by touching `harness/cli/src` |
| CI (`.github/workflows/ci.yml`) | existing (informal) | **modify** | `build-test` job gains a step that invokes the **verb** (see AC-9); any non-zero exit fails the build |
| repo docs (`docs/how/`, bundled CLI docs, `README.md`) | existing (informal) | **modify** | `docs/how/` pattern guide (see AC-11 outline); regen `gen:docs` if any bundled doc changes; at most a one-line README pointer |

## Envelope & Exit Contract

The verb's complete outcome-state table — every state below must be demonstrable, and two implementers reading this section must produce the same behavior:

| Condition | `status` | exit | `next_action` |
|---|---|---|---|
| 0 violations | `ok` | 0 | — |
| ≥1 **error**-severity violation | `error` | 1 | "Fix `<first violated rule name>`: `<that rule's comment verbatim>` (rules: `.dependency-cruiser.cjs`)" |
| only **warn/info**-severity violations (config evolved; none are error) | `degraded` | 0 | review the listed violations; promote severity if they should block |
| `dependency-cruiser` absent from `node_modules` | `unconfigured` | 2 | the exact install command (`npm install -D dependency-cruiser`) |
| `.dependency-cruiser.cjs` missing | `unconfigured` | 2 | restore the committed config (its absence means setup is incomplete, not broken) |
| depcruise crashes / emits unparseable JSON | `error` | 1 | inspect `error.details` (carries stderr / parse failure detail) |

> Status semantics follow the CLI doctrine: `unconfigured` (exit 2) = "not set up yet", distinguishable by scripts from `error` (exit 1) = "broke". Both fail a CI step (non-zero), so the missing-tool case can never produce a silently green build.
>
> **Launch posture**: the committed config ships every rule at `warn`, so the live tree exercises only the `ok`/`degraded` rows day-to-day; the `error`-violation row stays unit-proven by the AC-10 fixtures and goes live when severities are promoted. The crash and `unconfigured` rows are live from day one.

**`data` shape (both renderings, all states where depcruise ran)** — field names pinned here; sources are depcruise's JSON:

```jsonc
{
  "command": "arch-check",
  "status": "ok",                 // per the table above
  "data": {
    "modules": 66,                // ← summary.totalCruised
    "dependencies": 112,          // ← summary.totalDependenciesCruised
    "violations": [               // ← summary.violations[], always present (empty when clean)
      {
        "from": "harness/cli/src/services/help/help-service.ts",
        "to": "harness/cli/src/adapters/fs/node-fs.ts",
        "rule": "services-only-adapter-ports",   // ← rule.name
        "severity": "error",                      // ← rule.severity
        "comment": "Services may depend on adapter PORT interfaces only, never concrete node-*/exec-*/system-* implementations or fakes."
      }
    ]
  },
  "error": { "code": "<stable code chosen at plan time, documented in instructions.md>", "message": "<n> architecture violation(s)" },  // error states only
  "next_action": "…"              // required on every non-ok state
}
```

The `comment` is joined into each violation by the extension (depcruise's violation entries carry `rule.name`; the comment is looked up from the config so the explanation travels with the failure). The mapping sorts `violations[]` deterministically — by `from`, then `to`, then `rule` — rather than trusting depcruise's emission order, so golden fixtures and before/after report diffs stay stable.

## Testing Strategy

- **Approach**: Hybrid, with the split pinned (not delegated): **(a) Mandatory TDD** — the violations→envelope mapping **must** be extracted as a pure function inside the extension package and covered by RED/GREEN unit tests over four fixtures: clean run, error-severity violation, warn-only violation, malformed JSON (this makes the Hybrid claim real for gate G6 — at least these tests are TDD, not optional). **(b) E2E** — the rule config and the wiring are verified exactly as the PoC did: a clean run over the real codebase (AC-3) and a seeded violation caught by the correct rule (AC-4), plus the degradation states (AC-5).
- **Rationale**: the extension is a thin wrapper around a proven tool — the highest-value verification is the seeded-violation E2E (proves the sensor fires) — but the mapping function is genuinely deterministic logic with enumerable edge states, so it gets real unit tests rather than a discretionary maybe.
- **Focus Areas**: seeded-violation detection by the right rule; envelope mapping fidelity per § Envelope & Exit Contract (statuses, exits, counts, violations shape, comment join); the `./node_modules/.bin` invocation path (gotcha #1); all four degradation states; doctor loads the extension with no convention complaints.
- **Excluded**: dependency-cruiser internals; rules for code outside `harness/cli/src`; CI matrix variations beyond one arch step.
- **Mock Usage**: targeted — the mapping unit tests run on JSON fixtures (no process spawned); if any test drives the verb end-to-end short of CI, the depcruise invocation is faked via the `ctx.exec` port. The real binary runs in the E2E checks and CI.
- **Test placement note for /plan-3**: existing extensions carry no unit tests and the vitest root is `harness/cli` — the plan must decide where the mapping tests live (a vitest include for the extension folder, or colocating the pure function where the suite reaches it) without violating "no new CLI core code".

## Documentation Strategy

- **Location**: Hybrid — (1) the extension's `instructions.md` (contract-mandated agent briefing: what `arch-check` proves, the outcome-state table, what to do on failure, the rule-change discipline — never weaken a rule in the PR that trips it — and gotcha #1); (2) a `docs/how/` guide per the AC-11 outline; (3) regen bundled CLI docs (`npm run gen:docs`) if any curated doc changes; (4) at most a one-line README pointer.
- **Rationale**: exemplars teach; the briefing serves the agent at the point of use, the how-guide serves the human adopting the pattern elsewhere.

## Complexity

- **Score**: CS-2 (small)
- **Breakdown**: S=1, I=1, D=0, N=0, F=1, T=1 (P=4)
- **Confidence**: 0.85
- **Assumptions**: the PoC rule set transfers as-is (it ran clean on the 2026-06-10 tree); dependency-cruiser ^17 behavior is held stable by the committed lockfile (the risk table covers drift). The exec-port and reserved-name assumptions from the draft are now **verified facts** (Research Context #8–#9), not assumptions.
- **Dependencies**: dependency-cruiser (new devDependency); the existing extension loader; CI workflow.
- **Risks**: see Risks & Assumptions.
- **Phases**: 1 (Simple Mode — single phase, inline tasks).

## Acceptance Criteria

1. **Dependency installed**: `dependency-cruiser` is a `devDependency` in root `package.json` (version pinned by the committed `package-lock.json`); after `npm ci`, `./node_modules/.bin/depcruise --version` succeeds.
2. **Rule config committed**: `.dependency-cruiser.cjs` exists at the repo root, derived from the committed [`poc-arch-rules.cjs`](./poc-arch-rules.cjs) with **all rule severities set to `warn`** (the one deliberate launch divergence from the error-severity PoC config — see Clarifications; any other divergence called out in the plan); every rule has a `comment` field; `doNotFollow: node_modules` set; **no** `tsConfig` option (gotcha #2).
3. **Clean run is honest ok**: with the current tree, `npx --no-install harness arch-check --json` returns the § Envelope & Exit Contract clean shape — `status: "ok"`, exit 0, `data.modules`/`data.dependencies` > 0, `data.violations: []`. *(Counts were 66/112 on the PoC tree; the AC passes with whatever the current tree truly measures — the check is empty violations + non-zero counts.)*
4. **Seeded violation caught by the right rule**: replicating the PoC seed — temporarily importing the concrete `../../adapters/fs/node-fs.js` from `harness/cli/src/services/help/help-service.ts` — makes the verb return `status: "degraded"`, exit 0 (launch posture: all rules at `warn`), with a `data.violations[]` entry whose `rule` is `services-only-adapter-ports` and whose `from`/`to` name the real files, and `next_action` quoting that rule's comment. Reverting the seed restores AC-3. *(The blocking `error`/exit 1 behavior for the same violation at `error` severity is proven by the AC-10 mapping fixtures.)*
5. **All outcome states demonstrable**: each row of § Envelope & Exit Contract is exercised at least once across the test suite + E2E checks — including `degraded`/exit 0 for a warn-only fixture, `unconfigured`/exit 2 for missing tool and missing config, and `error`/exit 1 for malformed JSON — with `next_action` present on every non-ok result.
6. **Guardrails honored**: the extension has no `node:*` imports, performs all I/O via `ctx.exec`, and never throws — every failure shape maps to an envelope per the contract table.
7. **Invocation path encoded**: the extension invokes `./node_modules/.bin/depcruise` (never bare `npx depcruise`); gotcha #1 appears as a comment in `extension.ts` **and** as a named warning in `instructions.md` (checkable: both files mention the bare-npx 0-modules failure).
8. **Doctor + briefing**: the package lives at `.harness/extensions/arch-check/` (`extension.ts` + `instructions.md`); `harness doctor --json` shows it `loaded` with zero convention complaints; `harness instructions arch-check` prints the briefing.
9. **CI enforces through the verb**: the `build-test` job gains a step that runs `npx --no-install harness arch-check --json` (after the install/build steps; **never raw depcruise**, so CI and developers share one config *and* one code path); the step fails on any non-zero exit (crash and `unconfigured` still redden the build), emits a GitHub Actions `::warning::` annotation with the violation count whenever the envelope is `degraded` (warn-level findings visible on every PR without blocking it), and is green on the current tree.
10. **Mapping unit-tested (the TDD half)**: the violations→envelope mapping exists as a pure function with RED/GREEN unit tests covering the four fixtures (clean / error-violation / warn-only / malformed JSON), asserting status, exit-code intent, counts, violations shape, deterministic violation ordering, and comment join per § Envelope & Exit Contract.
11. **Docs shipped**: the `docs/how/` guide exists and contains: (1) the 7 rules with per-rule rationale, (2) how a consumer repo adapts the pattern to its own architecture (at least one non-hexagonal example sketch), (3) how to write rule `comment`s agents can act on, (4) the two gotchas, (5) the rule-evolution workflow — introduce a new rule at `warn` severity (which surfaces as the `degraded`/exit 0 envelope state), clean the tree, then promote it to `error` — including this repo's launch posture (all 7 rules start at `warn`; promotion is a deliberate, standalone flip), (6) a proof-boundary statement: arch-check proves static import-graph conformance to the committed rules over `harness/cli/src`; it does not prove runtime behavior, semantic correctness of port usage, or anything about files it does not reach, and (7) the rule-change discipline: never weaken, except, or demote a rule in the same PR that trips it — rule changes ship alone, with rationale. If bundled CLI docs changed, `npm run check:docs` (drift guard) is green.
12. **No regressions**: the full vitest suite passes from both cwds (repo root and `harness/cli`), and `harness doctor` stays `ok`.

## Risks & Assumptions

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| dependency-cruiser version drift changes JSON shape or rule semantics | Low | Medium | Pin via lockfile (`^17` + committed `package-lock.json`); envelope mapping reads only the stable `summary` fields named in § Envelope & Exit Contract; the malformed-JSON state catches a hard break loudly |
| Rules ossify the architecture (legitimate refactors blocked by stale rules) | Medium | Low | Rules live in one root file with per-rule comments; the how-guide documents how to amend a rule alongside the refactor that needs it |
| `ctx.exec` output-size on large JSON output (unbounded string concat in `node-exec.ts`) | Low | Low | Output for this codebase is small (~66 modules); if it grows materially, depcruise supports writing to a file — noted in the briefing |
| Consumer repos copy the exemplar without the devDependency | Medium | Low | The `unconfigured`/exit 2 row: honest envelope with the install command as `next_action` |
| CI and developers diverge on what's checked | Low | Medium | Eliminated by design: CI invokes the verb itself (AC-9) — one config, one code path |

## Open Questions

- *(Resolved, Round 2)* Verb name → **`arch-check`**. Starter copy in `examples/extensions/` → **no** (the live extension + how-guide is the exemplar).
- *(Future, non-blocking)* A `--graph` option emitting depcruise's mermaid/dot output as an orientation artifact.
- *(Future, separate plan — user roadmap note 2026-06-10)* A harness core capability to **install extensions from other repos** (the `skills install` analogue for extensions). That becomes the distribution channel for exemplars like this one — which is why no copy-paste starter ships now.

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| — | — | None identified: the investigation already settled tool choice, rule set, JSON contract, and failure modes with live evidence; the envelope mapping is now pinned in § Envelope & Exit Contract; the remaining decisions are small and listed in Open Questions. | — |

## Clarifications

### Session 2026-06-10

- **Q: Workflow Mode?** → **A: Simple** (recommended; accepted "agreed"). Single-phase: one extension package + root config + CI step + docs, same shape as plans 014/015.
- **Q: Testing Strategy?** → **A: Hybrid** (recommended; accepted). Post-validation the split is pinned: mandatory TDD for the extracted violations→envelope mapping (four fixtures); E2E (clean run + seeded violation + degradation states) for the rule config and wiring.
- **Q: Mock Usage?** → **A: Targeted** (recommended; accepted). Mapping tests on JSON fixtures; `ctx.exec` faked where a test drives the verb; real depcruise only in E2E + CI.
- **Q: Documentation Strategy?** → **A: Hybrid** (recommended; accepted). Extension `instructions.md` + `docs/how/` guide (AC-11 outline) + `gen:docs` regen if bundled docs change + at most a one-line README pointer.
- **Validation-pinned decisions** (from the 2026-06-10 validate-v2 run; vetoable): missing tool / missing config → `unconfigured`/exit 2 (matches CLI doctrine "not set up yet ≠ broke"; still fails CI via non-zero exit); warn-only violations → `degraded`/exit 0; CI invokes the verb, never raw depcruise; mapping extraction + unit tests made mandatory (G6 honesty).
- **Q (Round 2): Verb name?** → **A: `arch-check`** (user choice over the `arch` working default — explicit that it's a check).
- **Q (Round 2): Copyable starter in `examples/extensions/`?** → **A: No.** The live dogfood extension + the how-guide is the exemplar. Rationale strengthened by the user's roadmap note: extension distribution across repos will come from a future harness core "install extensions from other repos" capability (separate plan), not copy-paste starters.
- **Post-validation refinements (2026-06-10, user-approved)** — from comparing notes with a private external deterministic-backpressure exemplar (`scratch/exampe-of-determistic-backpresure.md`; details stay in gitignored `scratch/` per the publication boundary, Constitution P12): (1) AC-11 outline gains the **severity-ramp** rule-evolution workflow (new rules start at `warn` → `degraded`, promote to `error` once clean) and a **proof-boundary** statement; (2) the envelope mapping must sort `violations[]` deterministically by `from`/`to`/`rule` (AC-10 asserts it). Roadmap ideas noted but **not** specced: `arch-check explain <rule>`, provenance fields (depcruise version + config checksum), baseline/compare modes, positive-signal (`required`-type) rules.
- **Grill-session decisions (2026-06-10, `/grill-me`)**:
  1. **Rule-set authority is empirical** — the 7 PoC rules ship as-is and get ratified or amended by watching them run ("let's see what comes out"); no doc-to-rule cross-walk task in /plan-3. Residual risk accepted with eyes open: missing rules stay silently green (only false reds self-report).
  2. **Launch posture: ALL rules at `warn`** — violations surface as `degraded`/exit 0 plus a CI `::warning::` annotation; nothing blocks until severities are deliberately promoted to `error` ("we will trust our future selves"; see the backlog before failing CI). Evidence note: the PoC already measured today's backlog at **zero** violations, so promotion is a free one-line flip whenever wanted. The recommendation to keep `no-circular` at `error` as a blocking canary was considered and **declined** in favor of uniform warn — revisit at promotion time. ACs 2, 4, and 9 updated to match.
  3. **Rule-change discipline** — never weaken, except, or demote a rule in the same PR that trips it; rule changes ship alone, with rationale. Encoded in `instructions.md` (Documentation Strategy) and the how-guide (AC-11 item 7) so reviewers and the code-review companion can enforce it by diff shape.

---

## Validation Record (2026-06-10)

### Validation Thesis

**Raison d'être**: Convert the completed in-session investigation (dependency-cruiser chosen; 7 hexagonal rules PoC-proven on `harness/cli/src`) into a buildable specification for a third exemplar harness extension, so the architect/implementer can build the arch verb without re-deriving any research, and so the repo's prose-only hexagonal architecture gains a deterministic sensor.

**Value claim**: Architectural conformance becomes provable by a deterministic sensor (red envelope + red CI on violation) instead of reviewer eyeballing; violations explain themselves via rule comments at the point of failure; consumer repos gain a copyable "deterministic back pressure as an extension" pattern.

**Artifact promise**: `/plan-2d` and `/plan-3` can consume this spec as-is — ACs testable as written, rule set + gotchas durably encoded, verb behavioral contract unambiguous.

**Intended beneficiaries**: implementing agent; future contributors/agents who violate layering; consumer repos copying the exemplar; CI reviewers.

**Proof target**: Contract

**Evidence standard**: investigation claims match live repo state (verified by agents against `registry.ts`, `exec-port.ts`/`node-exec.ts`, `ci.yml`, `package.json`, the exemplar extensions, `/tmp` PoC config); ACs objectively checkable; gotchas encoded as criteria.

**Thesis source**: `original-ask.md` (user's verbatim ask) — not inferred.

**Thesis verdict**: Advanced (post-fix; was "Partially advanced" pre-fix due to the volatile-evidence and unpinned-contract findings below)

**Main thesis risk** (pre-fix, now closed): the full rule configuration lived only in `/tmp` with a false "reproduced in original-ask.md" claim, forcing downstream re-derivation — fixed by committing [`poc-arch-rules.cjs`](./poc-arch-rules.cjs) and repointing the spec.

---

| Agent | Lenses Covered | Thesis Axes Covered | Issues | Verdict |
|-------|---------------|---------------------|--------|---------|
| Clarity | User Experience, Hidden Assumptions, Concept Documentation, Proof-Level Fit | Implementation Readiness, Contract Integrity | 3 CRITICAL + 2 HIGH + 4 MEDIUM + 3 LOW — fixed (1 MEDIUM rejected as false positive: `npx --no-install` CI concern contradicts repo convention) | ⚠️ → ✅ |
| Completeness + Source-Truth | Edge Cases, Deployment & Ops, Technical Constraints, System Behavior, Integration & Ripple | Evidence Sufficiency | 8/8 repo claims verified ✅ (incl. exec-port non-zero-exit behavior, RESERVED_NAMES); 2 CRITICAL + 2 HIGH + 4 MEDIUM + 1 LOW — fixed or absorbed into § Envelope & Exit Contract | ⚠️ → ✅ |
| Thesis Alignment | Thesis Alignment, Evidence Sufficiency, Proof-Level Fit | Thesis Alignment | 1 HIGH (evidence durability) + 2 MEDIUM + 1 LOW — fixed | ⚠️ → ✅ |
| Forward-Compatibility | Forward-Compatibility, Domain Boundaries, Integration & Ripple | Downstream Usefulness, Safety to Change | 5 material gaps across consumers — all closed (see matrix) | ⚠️ → ✅ |

### Forward-Compatibility Matrix

| Consumer | Requirement | Failure Mode | Verdict | Evidence |
|----------|-------------|--------------|---------|----------|
| /plan-2d backpressure survey | ACs mappable to deterministic sensors | encapsulation lockout | ✅ (post-fix) | verb name contained by placeholder note; violation shape pinned in § Envelope & Exit Contract |
| /plan-2d backpressure survey | violation schema knowable | shape mismatch | ✅ (post-fix) | `data.violations[{from,to,rule,severity,comment}]` pinned with depcruise source fields |
| /plan-3 gate G6 (Testing Alignment) | Hybrid split derivable per task | lifecycle ownership | ✅ (post-fix) | mapping extraction + 4-fixture RED/GREEN made **mandatory** (AC-10); E2E half enumerated (AC-3/4/5) |
| /plan-3 gate G7 (Domain Completeness) | every AC-touched file owned by a domain row | encapsulation lockout | ✅ (post-fix) | extensions row now states auto-discovery / no core registration; test-placement note added for the plan |
| extension package | full behavioral contract per outcome state | contract drift | ✅ (post-fix) | § Envelope & Exit Contract pins 6 states × status × exit × next_action |
| CI build-test | one config, one code path | contract drift | ✅ (post-fix) | AC-9 pins `npx --no-install harness arch-check --json`, never raw depcruise |

**Thesis alignment**: Value claim advanced at Contract proof level (post-fix); the main pre-fix risk — load-bearing rule evidence living only in volatile `/tmp` behind a false reproduction claim — is closed by the committed `poc-arch-rules.cjs`.

**Outcome alignment**: The spec correctly inherits the upstream promise ("use code to actually validate that our implementations are following that pattern") and pins the core outcome: "encode your architecture as rules; let the harness prove conformance instead of asking a reviewer to eyeball it." However, the spec's forward-compatibility posture has five material gaps (hard-coded verb name in ACs; unspecified violation envelope shape; soft Testing Strategy language; incomplete domain coverage for CLI integration; and CI invocation ambiguity) that will force /plan-2d, /plan-3, and the extension builder to make assumptions or re-research details that the spec should have settled. If these gaps are closed before /plan-2d, the trajectory is sound; if not, the downstream pipeline will experience contract drift and rework cycles. *(Synthesizer note: all five named gaps were closed in this same validation pass — see the matrix verdicts — so the "if closed" condition is satisfied.)*

**Standalone?**: No — named downstream consumers: /plan-2d, /plan-3, the extension package, CI.

Overall: **VALIDATED WITH FIXES**
