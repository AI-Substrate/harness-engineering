# Harness self-update — `harness update` + daily check + envelope banner

**Mode**: Simple
**Spec**: docs/plans/019-harness-update/harness-update-spec.md
**Created**: 2026-06-15 · **Revised**: 2026-06-15 (validation fixes + plan-018 channel alignment)

## Research Context

ℹ️ No `research-dossier.md` for this plan, but the design is grounded in this session's
investigation under [`scratch/install-flow/`](../../../scratch/install-flow/) and, critically, in
**plan 018 (gh-packages-release-please)** which sets the distribution model this feature builds on.

**The distribution channel (from plan 018 — authoritative):**

- The CLI is published by **CI (release-please) to GitHub Packages** as
  **`@ai-substrate/engineering-harness`** (registry `https://npm.pkg.github.com`) — a **prebuilt,
  versioned, pinnable** tarball with `dist` baked in and `commander`/`jiti` as registry deps.
- The old **`npm i -g github:…` / `npx github:…` path is RETIRED as broken** (gitignored `dist` →
  fragile rebuild; git-install doesn't deliver runtime deps; `jiti` can't be bundled). 018 is
  **registry-only** — no `npx github:` fallback.
- **GitHub Packages requires a token even for public install** (no anonymous): consumers need an
  `.npmrc` (`@ai-substrate:registry=https://npm.pkg.github.com` + a `read:packages` token).
- release-please cuts clean **semver** releases on merge to `main`, with `latest` (and `canary`)
  dist-tags.

⇒ This feature's install/update channel is **the CI-built GitHub Packages release**, *not* the
git-URL path. `harness update` ≈ `npm i -g @ai-substrate/engineering-harness@latest`.

**CLI source anchors already located (verified against source during validation):**

- **Single envelope chokepoint**: every envelope-bearing command exits through
  `exitWithEnvelope(env, io)` (`harness/cli/src/output/exit.ts`) → `OutputPort.emit` →
  `renderJson` (whole-envelope `JSON.stringify`, one line) / `renderHuman` (`next_action` to stderr,
  summary to stdout) (`harness/cli/src/output/output-port.ts`).
- **Envelope shape**: `{ command, status, timestamp, data?, error?, evidence?, next_action? }`
  (`harness/cli/src/output/envelope.ts`). An added optional field surfaces in JSON automatically.
- **Installed version**: `readVersion()` reads the shipped `package.json` (`harness/cli/src/version.ts`)
  — a sanctioned `node:fs` bootstrap exception.
- **The envelope is explicitly an MCP-stable seam** (`harness/cli/src/services/docs/contract.ts`) —
  any added field must be backward-compatible (optional, additive).
- **Pass-through pattern to mirror**: `harness skills install` prints the exact line then runs it via
  the `exec` port (`acts/skills.ts`) — the model for `harness update`.
- **Ports available for fakes**: `fs / exec / git / clock / process` (no HTTP port today).

## Summary

Make the globally-installed `harness` CLI keep itself current and make staleness impossible to miss.
Four capabilities: (1) a first-class **`harness update`** command family (+ a **`self-install`**
convenience) that performs the global install/upgrade **from the GitHub Packages release**; (2) a
**once-a-day update check** that detects a newer published release and tells the user the exact
command to run; (3) an **"update available" banner** injected into **every** CLI command's output —
structured in JSON, a one-liner in human mode — so whichever consumer is driving (agent or human)
sees it; (4) on update, a **skills check + reconcile** — `harness update` also checks the installed
harness *skills* and brings them current the proper `npx skills` way (the existing
**`harness skills update`** path: refresh to latest = install new + update changed, then **prune**
renamed/removed legacy slugs).

The CLI binary and the skills are **two separate distribution mechanisms** — the binary ships via the
GitHub Packages registry (plan 018), the skills via `npx skills` into the agent-CLI config. `harness
update` is the **one command that reconciles both**. The CLI is a **global tool** (like `git`), not a
per-repo dependency.

## Goals

- A user/agent can upgrade to the latest published harness with **one obvious command**
  (`harness update`), with no build-on-the-machine step (the release is prebuilt).
- The CLI **detects** a newer published version at most **once per 24h**, cheaply, without slowing
  commands.
- Once an update is known-available, **every** command's output carries a notice naming the new and
  installed versions and the exact update command — visible to both agents (JSON field) and humans
  (one human-readable line).
- Running `harness update` also **keeps the skills current** — it reports any new/updated/renamed/
  removed skills and reconciles them the proper `npx skills` way (refresh + prune), so the binary and
  the skills don't drift apart.
- Staleness detection and the banner **never break or slow** normal use; offline/no-token/failure is
  silent.

## Non-Goals

- **Not** auto-updating without the user's action (we *suggest*, never silently upgrade).
- **Not** re-introducing a per-repo CLI dependency — the update cache lives **outside** the repo.
- **Not** changing the distribution model itself — that is plan 018's job; this feature **consumes**
  the GitHub Packages release 018 produces.
- **Not** solving the GitHub Packages **token/`.npmrc` requirement** (no anonymous install) — that is
  accepted from 018; this feature degrades gracefully when the token is absent.
- **Not** the full install-model wording reconciliation across docs/skills
  (`cli-install-wording.md`) — related follow-up. *(Open Question: fold in or separate.)*
- **Not** a version-pinning policy engine — `--pin <v>` is a manual one-time escape hatch only.

## Target Domains

> This repo has **no `docs/domains/` registry**, so the "domains" below are the CLI's conceptual
> modules, identified in-spec.

| Domain | Status | Relationship | Role in This Feature |
|--------|--------|-------------|---------------------|
| `cli-update` | **NEW** | **create** | the `update` act + update-check/self-install service |
| `cli-output` | existing | **modify** | envelope + renderers gain an additive `update_available` field/line |
| `cli-version` | existing | **consume** | reuse `readVersion()` for the installed version (no change) |
| `cli-skills` | existing | **consume** | orchestrate the existing `harness skills update` (refresh + prune) from `harness update`; no change to the skills service itself |

### New Domain Sketches

#### cli-update [NEW]
- **Purpose**: own the CLI's ability to check for, report, and apply updates to itself from the
  GitHub Packages release, plus the convenience global install.
- **Boundary Owns**: the `update` verb (`update` / `--check` / `--pin`), the `self-install`
  convenience, the latest-version lookup (registry dist-tag), the 24h-throttled check, and the
  global update-check cache.
- **Boundary Excludes**: the installed-version read (belongs to `cli-version`); how the notice is
  *rendered* (belongs to `cli-output`); shelling-out mechanics (uses the injected `exec` port); the
  publish/release pipeline (plan 018).

## Testing Strategy

- **Approach**: **Hybrid** — Full-TDD for the deterministic core (semver compare, 24h throttle
  decision, cache read/write, banner enrichment + human/JSON rendering); Lightweight for the thin
  `update`/`self-install` exec pass-throughs (assert the command line built + envelope shape).
- **Rationale**: matches the repo's port+fake discipline; the envelope is an MCP-stable seam, so its
  change deserves snapshot/round-trip coverage.
- **Focus Areas**: throttle boundary (just-under vs just-over 24h via `FakeClock`);
  offline/no-token/failure degradation; banner present/absent in both render modes;
  cache-outside-repo path.
- **Excluded**: real network/registry calls; real global `npm -g` installs (asserted via `FakeExec`).
- **Mock Usage**: **Avoid mocks — fakes only.** The registry/latest-version lookup goes behind an
  **injected port** with a fake substitute; no interaction-mocks.

## Documentation Strategy

- **Location**: **Hybrid** — update `harness/cli/README.md` with the install/update/run model (the
  registry install + `.npmrc`/token requirement from 018, and the new command), plus a short
  `docs/how/` guide ("keeping the harness up to date").
- **Rationale**: install/update is front-door, zero-context material; both quick-start and depth help.
- **Coordinate with 018**, which also rewrites the install docs — keep them consistent (don't
  contradict 018's `.npmrc`/token instructions).

## Complexity

- **Score**: CS-4 (large)
- **Breakdown**: S=2, I=2, D=1, N=1, F=2, T=1  → 9
- **Confidence**: 0.80 — design well-explored and the latest-version source is resolved by 018's
  registry model; the added skills-reconcile orchestration reuses the existing `harness skills update`
  path, so surface is up but novelty stays low.
- **Assumptions**: plan 018 has shipped (the GitHub Packages release + dist-tags + `.npmrc`/token
  model exist); the published release is prebuilt (no build-on-install); the envelope field is
  additive/backward-compatible.
- **Dependencies**: **plan 018 (gh-packages-release-please)** — defines the package
  `@ai-substrate/engineering-harness`, the registry, the `latest`/`canary` dist-tags, and the
  `.npmrc`/token requirement; `ExecPort`, `FsPort`, `ClockPort` (existing); a **new injected
  env/home port** (cache path) and a **new injected version-lookup port** (registry latest); the
  existing **`harness skills update`** path (`services/skills`, `LEGACY_SKILL_SLUGS`) for the skills
  reconcile (reused, not rebuilt).
- **Risks**: see Risks & Assumptions.
- **Phases**: **1** (Simple mode, user-directed). Four ordered task groups within the single phase:
  **(a)** `update`/`--check`/`--pin` + `self-install`; **(b)** the 24h-throttled check + global
  cache + registry latest-version lookup; **(c)** the envelope `update_available` enrichment +
  human/JSON rendering; **(d)** the skills check + reconcile orchestration over `harness skills update`.

## Behavioural decisions (resolved)

Validation flagged several Open Questions as blocking *testable* ACs; plan 018 resolved the
distribution channel. Resolved here so the single implementation phase is unambiguous.

- **Distribution channel** — install/update use the **GitHub Packages release** (plan 018):
  `npm i -g @ai-substrate/engineering-harness@latest` (pin: `@X.Y.Z`). **Not** the retired
  `github:` path. Run via the injected `exec` port.
- **Latest-version source** *(was the big open question — now resolved by 018)* — the **registry
  dist-tag**: the published `latest` version of `@ai-substrate/engineering-harness` (e.g.
  `npm view @ai-substrate/engineering-harness version` against the GH Packages registry), behind an
  injected version-lookup port so the exact mechanism stays swappable and fakeable. No build needed
  (prebuilt release).
- **Check trigger** — attempted **opportunistically on every envelope-bearing command**, gated by the
  24h throttle, run **non-blocking + failure-silent**. (Not "doctor-only" — that would undercut
  "staleness impossible to miss".)
- **24h throttle** — measured from the **last successful** lookup timestamp in the cache: a lookup is
  attempted when `now − last_success ≥ 24h`. A failed/offline/no-token lookup does **not** advance the
  timestamp (next command retries). Clock moving backwards → treated as "still fresh".
- **Cache** — one JSON file in a **user-global** location resolved via an **injected env/home port**
  (`$HOME`/`USERPROFILE`; e.g. `~/.harness/update-check.json`), never the consumer repo's `.harness/`.
  Missing/corrupt cache → treated as "no info": perform a lookup, never crash. Holds
  `{ last_success_iso, latest }`.
- **Known-update visibility** — the banner is driven by the **last known** cached latest vs the
  installed version. A *failed refresh never hides* a previously-known update — staleness stays
  visible. "Silent" applies to lookup **failures**, not to suppressing a known update.
- **Banner per mode** — JSON: an additive **top-level** field `update_available`, present **only
  when** an update is available (absent otherwise → snapshot-safe), shape `{ installed, latest,
  command }`. Human: **one stderr line** `update available to <latest> from <installed> — run:
  harness update`, never on stdout. The field never appears in human mode; the line never in JSON.
- **`--check`** — forces a **fresh** lookup (ignores throttle), updates the cache, exit 0 regardless;
  also runs the **skills check** in report-only mode (no install/prune).
- **Skills reconcile on update** — after the binary self-update, `harness update` runs a **skills
  check** and brings skills current via the existing **`harness skills update`** path (refresh via
  `npx skills add` = install new + update changed; then prune renamed/removed via `npx skills remove`
  the encoded `LEGACY_SKILL_SLUGS`). It honours that path's existing degraded handling (refresh fails
  → skills untouched, no prune; prune fails → degraded, latest still installed). **Target resolution**:
  the skills step needs the agent-CLI target(s) — `harness update` accepts `--target <cli>`
  (repeatable) `[--global]` and passes them through; **with no target it does report-only** and
  prints the exact `harness skills update --target <cli>` command to run (offer-don't-force — skills
  live in the user's global CLI config, outside the repo). `--check` is always report-only.

## Acceptance Criteria

1. **`harness update`** prints the exact command (`npm i -g @ai-substrate/engineering-harness@latest`),
   runs it via the injected `exec` port, returns `status:"ok"` with `data:{ installed_before,
   installed_after, command }` (semver strings); an already-latest run returns `installed_before ==
   installed_after` (no-op, not an error).
2. **`harness update --check`** performs a fresh registry lookup (ignores throttle), updates the
   cache, returns `status:"ok"`, `data:{ installed, latest, update_available: boolean }`, exit 0 —
   **no install**.
3. **`harness update --pin vX.Y.Z`** installs that exact published version globally
   (`npm i -g @ai-substrate/engineering-harness@X.Y.Z`); one-time (no persisted pin — a later bare
   `harness update` returns to latest); a version not in the registry → `status:"error"` + a clear
   `next_action`.
4. **`harness self-install`** installs/pins the CLI globally from the registry (convenience over
   `npm i -g @ai-substrate/engineering-harness`); if the registry `.npmrc`/`read:packages` token is
   missing, it returns `status:"error"` with a `next_action` describing the one-time `.npmrc`+token
   setup (per plan 018). Afterwards `harness --version` resolves on PATH.
5. **Throttle** — registry lookup at most once per 24h, measured from the cache's
   last-successful-lookup timestamp; a command inside the window reads the cache and makes **zero**
   network calls (provable via `FakeClock` + the lookup port asserting zero calls). After the window
   it attempts a lookup; on failure the timestamp does not advance.
6. **Cache location** — written to a user-global path via the injected env/home port (never the
   consumer repo's `.harness/`). First run (no cache) = miss → lookup → write; corrupt/unreadable
   cache → "no info", no crash.
7. **Banner (JSON)** — when an update is known-available, every envelope-bearing command in JSON mode
   carries an additive top-level `update_available:{ installed, latest, command }`; absent when no
   update is available (existing consumers/snapshots unaffected).
8. **Banner (human)** — the same condition emits exactly one stderr line `update available to
   <latest> from <installed> — run: harness update`; never on stdout, never corrupting the summary;
   field and line never cross modes.
9. **Visibility on failure** — a known-available update (from the last successful check) keeps showing
   even if a later lookup fails, the token is absent, or the machine is offline; only a genuinely
   *unknown* state shows nothing. No added hot-path latency (a single local cache read; the lookup is
   throttled + off the hot path).
10. **Update/auth failures** — a failed `harness update`/`self-install` returns `status:"error"` with
    an actionable `next_action` for the common causes: **registry auth missing/expired** (401/403 → 
    explain the `@ai-substrate` `.npmrc` + `read:packages` token); **global-npm permission denied**
    (→ suggest a Node version manager / elevated install); **npm absent**.
11. **Additive seam** — the new envelope field is optional/additive; existing envelope consumers, the
    `--json` contract, exit-code mapping, and snapshot/round-trip tests still pass (human-mode tests
    updated for the new conditional line).
12. **Ports & tests** — all new logic behind injected ports (`fs`/`exec`/`clock`/env-home/
    version-lookup); **no `node:*` imports in services** (Constitution P2); covered by fakes, no mocks.
13. **Skills check** — `harness update` reports the skills situation: that skills can be refreshed to
    latest, and which renamed/removed legacy slugs (`LEGACY_SKILL_SLUGS`) would be pruned. `--check`
    (and a no-target `update`) make this report-only — no `npx skills` mutation.
14. **Skills reconcile** — given `--target <cli> [--global]`, `harness update` runs the existing
    `harness skills update` path (refresh via `npx skills add`, then prune via `npx skills remove`),
    announces the exact commands before running (pass-through transparency), and folds the result into
    its envelope (`skills: { refreshed, pruned, ... }`); refresh-fails → skills untouched,
    prune-fails → degraded (latest still installed). With no target it prints the exact
    `harness skills update --target <cli>` command instead of mutating anything.

## Risks & Assumptions

- **Sequencing on plan 018** — there is nothing to update *from* until 018 has published at least one
  GitHub Packages release. This plan should land **after** (or alongside) 018. If 018's package
  name/registry/dist-tags change, this feature's channel updates in lock-step.
- **Registry auth required (no anonymous)** — the lookup and the install both need the `@ai-substrate`
  `.npmrc` + a `read:packages` token (018's accepted limitation). Absent/expired token → the check
  degrades silently (AC9) and `update`/`self-install` return an actionable `next_action` (AC10). The
  first-time-auth friction is real — see Open Questions.
- **Global `npm -g` permissions** — system Node may need sudo; nvm/Volta don't. `next_action` guides.
- **Envelope is an MCP-stable seam** — the new field must be optional/additive; verify snapshot/round-
  trip tests tolerate it (validation confirmed the additive field is snapshot-safe).
- **Hot-path performance** — the once/24h check must never block a command (single local cache read;
  lookup off the hot path).
- **Cache robustness** — corrupt/missing cache, clock skew → treat as "no info", never crash.
- **Skills target resolution** — the skills reconcile needs the agent-CLI target(s); `harness skills
  update` requires `--target`. `harness update` can't reliably auto-detect which CLI(s) the user
  installed skills into, so with no `--target` it stays report-only and suggests the command
  (offer-don't-force; skills mutate the user's global config, outside the repo).
- **Coarse "updated" detection** — `npx skills add` refreshes everything to latest; there's no
  per-skill diff, so the check reports "refresh available" + the prune candidates rather than a
  precise per-skill changelog. Honest limitation, not a gap.

## Open Questions

- **First-time auth UX** — how much of the `.npmrc` + `read:packages` token setup should
  `self-install`/`update` *automate or guide* vs simply document (coordinating with 018's
  consumer-`.npmrc` instructions)? This is the main residual design question.
- **Fold in the install-model wording reconciliation** (`cli-install-wording.md` A/B sites) here, or
  keep it a separate plan? (Scope decision.)
- **Banner phrasing** — `update available to <latest> from <installed>` is verbatim from the ask; a
  candidate for light UX polish (non-blocking).
- **Skills target on `harness update`** — require an explicit `--target`, try to detect installed
  targets, or always report-and-suggest when absent? (Leaning report-and-suggest — see Risks.)

## Workshop Opportunities

| Topic | Type | Why Workshop | Key Questions |
|-------|------|--------------|---------------|
| First-time registry-auth UX (`.npmrc`/token) | Integration Pattern | the one residual unknown; ties to 018's consumer-auth model | guide vs automate the `.npmrc`/token; what `next_action` text; how `--check` behaves with no token |

*(Earlier workshop candidates — latest-version source, the daily-check trigger, cache path, banner
shape — are resolved inline in § Behavioural decisions, largely by plan 018's registry model.)*

## Clarifications

### Session 2026-06-15 — spec creation

- **Workflow Mode** → **Simple** *(user-directed: "it will be simple mode please")*. Single-phase
  plan with inline tasks. (CS scored CS-4; Simple chosen by explicit direction.)
- **Testing Strategy** → **Hybrid** (default applied): TDD for the deterministic core via the repo's
  port-fakes; lightweight for the thin `update`/`self-install` exec pass-throughs.
- **Mock Usage** → **Avoid mocks — fakes only** (default applied): registry/latest-version lookup
  behind an injected port with a fake; consistent with Constitution P2.
- **Documentation Strategy** → **Hybrid** (default applied): `harness/cli/README.md` + a `docs/how/`
  guide; coordinated with 018's install-doc rewrite.

> Defaults were applied without an interactive prompt (per user preference for plain-text flow).

### Session 2026-06-15 — validation (`/validate-v2`)

- 4 parallel read-only validators ran (clarity, completeness, thesis-alignment, source-truth/forward-
  compat). Source-truth **confirmed all 8 technical anchors** against the code; the additive envelope
  field is snapshot-safe. CRITICAL/HIGH fixes applied: resolved the check trigger, throttle/cache
  semantics, per-mode banner placement + shapes, known-update-visibility-on-failure, and error/
  `next_action` ACs (see § Behavioural decisions + tightened ACs).

### Session 2026-06-15 — plan-018 channel alignment

- **User check**: "the installer, it will work from the package we build with CI?" → **Yes, and it
  must.** Plan 018 retires the `npm i -g github:…` path (broken) and makes the **CI-built GitHub
  Packages release** (`@ai-substrate/engineering-harness`, registry-only, token-gated, versioned via
  release-please) the sole channel. Spec retargeted: install/update use the registry; latest-version
  source resolved to the registry dist-tag; build-toolchain-at-install risk removed (prebuilt);
  registry-auth/token dependency + sequencing-on-018 added.

### Session 2026-06-15 — skills reconcile on update

- **User add**: `harness update` should also do a **skills check** and bring skills current the proper
  `npx skills` way — install new, update changed, remove old/renamed. Added as capability (4): it
  orchestrates the **existing** `harness skills update` (refresh via `npx skills add` + prune
  `LEGACY_SKILL_SLUGS` via `npx skills remove`), reusing its degraded handling. Target(s) come from
  `--target <cli> [--global]`; with no target it stays report-only and prints the command
  (offer-don't-force, since skills live in the user's global CLI config outside the repo). The binary
  (registry) and skills (`npx skills`) are two channels; `harness update` reconciles both. (ACs 13–14.)
