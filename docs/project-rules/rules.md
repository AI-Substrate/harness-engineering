# Harness Engineering Rules

**Version**: 1.0.0
**Last Updated**: 2026-06-08
**Constitution Reference**: [constitution.md](./constitution.md)

Normative MUST/SHOULD statements. These operationalize the Constitution; on conflict the Constitution wins.

---

## 1. Source Control & Branching

- **MUST** work on a feature branch; never commit directly to `main`.
- **MUST** keep `main` branch-protected so required CI passes before merge.
- **MUST** use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, …) so `release-please` can compute semver.
- **MUST** run `git status --short` before committing and confirm `scratch/` (and other gitignored private material) is not staged.
- **MUST NOT** commit secrets, private identifiers, customer details, person names, internal codewords, or unreleased platform details to tracked files (Constitution P12).

## 2. Coding Standards

- **MUST** write the CLI in TypeScript + ESM; build with `tsc` to `dist/`.
- **MUST** format and lint with Biome; `just fix` and `just format` are the canonical commands.
- **MUST** keep command handlers (entrypoint, acts) thin — no business logic (Constitution P2; architecture §2).
- **MUST NOT** import `node:fs`, `node:child_process`, git, network, or the clock directly inside a service; reach them through a **port** + injected adapter.
- **MUST NOT** call `process.exit` or write to stdout/stderr outside the output kernel's renderer/exit functions.
- **SHOULD** keep one concern per file and mirror the layer layout (`output/`, `adapters/`, `acts/`, `services/`).

## 3. Output, Errors & Exit Codes

- **MUST** return the canonical `Envelope` from status/reporting commands, in both human and JSON form (architecture §3).
- **MUST** include a `next_action` whenever `status !== 'ok'`.
- **MUST** map exit codes exactly: `ok → 0`, `degraded → 0` (unless a command documents otherwise), `unconfigured → 2`, `error → 1`, and document them in `--help`.
- **MUST** surface failures as actionable messages (what failed, why, what to try next) — never a raw stack trace.
- **MUST** return `status: unconfigured` + `next_action` (exit `2`) for any command slot with no mapped behaviour; never fake success (Constitution P5).
- **MUST** report evidence paths for commands that produce proof, or explicitly state none was produced (Constitution P9).

## 4. Extension-Readiness Rules

- **MUST** keep the command-slot registry open-capable: slots keyed by `name: string`; the built-in slots are a seed set.
- **MUST NOT** introduce a closed `SlotName` union as the registry's only key, or otherwise assume the slot set is fixed.
- **MUST** place any dependency the harness needs at runtime inside a user's repo (future loader, `jiti`) in `dependencies`, never `devDependencies`.

## 5. Tooling & Automation

- **MUST** provide `just` recipes: `fix` (biome check --write), `format` (biome format --write), `test` (vitest run --coverage), and `fft` (= fix → format → test).
- **MUST** run `just fft` (or the equivalent commands) before committing CLI changes.
- **MUST** run CI (GitHub Actions) on pull requests and `main`: install → biome check → build → typecheck → test+coverage → `npm audit`.
- **MUST** report coverage from the test path (local) and surface it in CI.
- **SHOULD** keep CI fast and the dependency set lean.

## 6. Testing & Verification

### 6.1 Philosophy
- Tests are **executable documentation** (TAD). Favour comprehension value over raw coverage numbers; a test must "pay rent."
- Apply **TDD smartly**: test-first for logic with real branching (output kernel, exit mapping, doctor checks, slot/config handling); it MAY be skipped for trivial wrappers and config.
- **MUST** test services and acts through **injected fakes** — zero real fs/process/git/clock in unit tests.

### 6.2 Fakes over mocks (Constitution P3)
- **MUST** use full fake adapters (one per port) that record call history.
- **MUST NOT** use `vi.mock()`, `vi.spyOn()`, or monkey-patching of internal modules.
- **SHOULD** prefer real fixtures over fakes where a real value is simplest (e.g. a literal config object).

### 6.3 Test quality standards
Every promoted test **MUST** carry a Test Doc block with five fields: **Why** (business/bug/regression reason), **Contract** (the invariant asserted), **Usage Notes** (how to call it, gotchas), **Quality Contribution** (what failures it catches), and **SHOULD** include a **Worked Example** (inputs → outputs). Name tests behaviourally (Given-When-Then or equivalent).

Example:
```typescript
test('given_unconfigured_slot_when_run_then_status_unconfigured_exit_2', () => {
  /*
  Test Doc:
  - Why: Constitution P5 — unbuilt slots must never fake success.
  - Contract: runSlot('smoke') returns {status:'unconfigured', next_action} and exitCodeFor === 2.
  - Usage Notes: Inject a FakeClock for a deterministic timestamp; slot name is a plain string.
  - Quality Contribution: Catches regressions that turn a stub into a false 'ok'/exit 0.
  - Worked Example: runSlot('smoke') → {status:'unconfigured', next_action:'No command mapped…'}; exit 2
  */
});
```

### 6.4 Reliability
- **MUST NOT** make network calls or use sleeps/real timers in tests (inject `FakeClock`; use fixtures).
- **MUST** be deterministic — no flaky tests in the main suite.
- **SHOULD** keep tests fast for a tight feedback loop.

### 6.5 Organization & scratch → promote
- `harness/cli/test/unit/` and `…/integration/` — durable tests with Test Doc blocks; `…/fixtures/` — shared data.
- Probe tests MAY live in `tests/scratch/` (excluded from CI) for fast exploration. **Promote** to `unit/`/`integration/` only if they add durable value — heuristic: **C**ritical path, **O**paque behavior, **R**egression-prone, or **E**dge case. Delete non-valuable scratch tests; keep learnings in the PR.

### 6.6 Mock usage policy
- Project policy for this slice: **Avoid mocks** — real data/fixtures + injected fakes only (set in the spec). When a fake is used, it implements the real port interface.

## 7. Complexity-First Estimation (no time, ever)

- **MUST NOT** output or imply time, duration, or ETA in any form (hours, days, "quick", "fast", "soon", deadlines).
- **MUST** quantify effort with the **Complexity Score (CS 1–5)**. Compute six factors (each 0–2), sum to P, map to CS:
  - **S** Surface Area · **I** Integration Breadth · **D** Data & State · **N** Novelty & Ambiguity · **F** Non-Functional · **T** Testing & Rollout.
  - P 0–2 → CS-1 (trivial) · 3–4 → CS-2 (small) · 5–7 → CS-3 (medium) · 8–9 → CS-4 (large) · 10–12 → CS-5 (epic).
- **MUST** include assumptions, dependencies, risks, and phases alongside any CS score.
- **MUST**, for CS ≥ 4, include a staged rollout / flags / rollback consideration in the phases.
- **SHOULD** prefer "scope / risk / breadth / unknowns" language over any time word. If time words appear in a draft, replace them with complexity reasoning.

## 8. Documentation

- **MUST** keep a `harness/cli/README.md` covering purpose, the `npx`-from-repo-URL install, the command surface, output modes, and exit-code semantics.
- **MUST** expose agent-friendly `--help` for every command.
- **MUST** treat plan workshops (`docs/plans/<n>-<slug>/workshops/*`) as authoritative design decisions; do not contradict them downstream.
- **SHOULD** keep tracked docs sanitized; keep traceability to private sources only in gitignored `scratch/`.

## 9. Change Governance & Deviations

- **MUST** route doctrine changes through a plan/PR with a version bump, updating `constitution.md`, `rules.md`, `idioms.md`, and `architecture.md` together.
- **MUST**, when a plan knowingly violates a Constitution principle, record a **Deviation Ledger** entry:

| Principle Violated | Why Needed | Simpler Alternative Rejected | Risk Mitigation |
|--------------------|------------|------------------------------|-----------------|

- **MUST** pass the Constitution gate in `/plan-3` (no unresolved violations without a ledger entry).

<!-- USER CONTENT START -->
<!-- Add project-specific rules here; preserved across regenerations. -->
<!-- USER CONTENT END -->
