# `harness arch-check` — agent briefing

This verb is **deterministic architectural back pressure**: architecture
conformance moved out of the inferred world (reviewer eyeballs, "follow our
architecture" prompts) into the deterministic one — yes or no, no guessing.
It proves the CLI's hexagonal (ports & adapters) contract by running
dependency-cruiser over `harness/cli/src` against the committed rules at the
repo root (`.dependency-cruiser.cjs`) and reporting an honest envelope. You
never need to *infer* whether the layering holds: run this verb after any
change that adds or moves an import. CI runs it through this same verb (one
config, one code path) whenever CI is dispatched — see AGENTS.md, CI is
manual on branches.

The rules are encoded team memory: each one carries its rationale as a
`comment`, and that comment travels into the violation — the fix is explained
at the point of failure, no doc lookup, no re-inference.

## What it proves — and the proof boundary

**Proves**: the import graph honours the 7 committed rules — no cycles,
services never import acts, services depend on adapter *ports* only (and
type-only), adapters and the output layer stay leaves, no fake adapters in
production source.

**Does not prove**: anything outside `harness/cli/src` (extensions, skills,
scripts are not architecture-checked); runtime behaviour (a service can still
*misuse* a port it legally imports); rules that haven't been written — a
missing rule stays silently green. The rule set's authority is **empirical**
(PoC-proven on this tree), not derived from a doc cross-walk. The complement
is `harness/cli/test/architecture/` — point checks on specific idioms (single
`process.exit` site, no `node:fs` in services) that an import graph can't see.

If you find yourself *inferring* an architectural invariant this sensor
doesn't prove, that's harness feedback — note it (`harness observe`) so the
missing rule can be encoded.

## Outcome states

| Condition | `status` | exit | what to do |
|---|---|---|---|
| 0 violations **over ≥1 module cruised** | `ok` | 0 | nothing — the architecture holds |
| **0 modules cruised** | `error` | 1 | the gate scanned NOTHING and enforced nothing — this is an abstention, not a pass. See below |
| ≥1 **error**-severity violation | `error` | 1 | `next_action` names the first violated rule and quotes its comment — fix the import, never the rule (see discipline below) |
| only **warn/info**-severity violations | `degraded` | 0 | review `data.violations[]`; promote a rule to `error` once it should block |
| dependency-cruiser not installed | `unconfigured` | 2 | `npm install -D dependency-cruiser`; run from the repo root |
| `.dependency-cruiser.cjs` missing | `unconfigured` | 2 | restore the committed config (`git checkout -- .dependency-cruiser.cjs`) |
| depcruise crash / unparseable output | `error` | 1 | inspect `error.details` (stderr + parse detail); reproduce with the raw command below |

Error codes: `E_ARCH_VIOLATION` (error-severity violations; `error.message`
counts ALL violations), `E_ARCH_NO_MODULES` (empty cruise — see below),
`E_DEPCRUISE_OUTPUT` (crash/unparseable),
`E_ARCH_CHECK_UNEXPECTED` (backstop — should never fire).

### `E_ARCH_NO_MODULES` — the empty cruise

depcruise reports an empty scan as `totalCruised: 0` with an empty
`violations[]`, a **valid schema and exit 0**. Read naively that is
indistinguishable from a clean tree, and until 2026-08-11 this verb reported it
as `ok` — the count was parsed, validated and published as `data.modules`, and
never examined. A gate that scanned nothing has abstained, not passed, so it now
fails **`error`/exit 1** regardless of the (necessarily empty) violation list.

This is `error` rather than `degraded` on purpose: the warn-launch posture above
governs the severity of a **violation that was found**, not whether the scan
happened at all. Warn-launch is a statement about what blocks; an empty cruise
is the absence of any statement.

Known routes into it:

- **A TypeScript major that drops the JS compiler API.** dependency-cruiser
  parses through `src/extract/tsc/parse.mjs` and declares no `typescript`
  dependency of its own, so it resolves the host project's. Measured: depcruise
  18.1.0 cruises 336 modules under TypeScript 6.0.3 and **0** under 7.0.2 on the
  same tree, because TS7's native port exposes only `version` from
  `require('typescript')`. Check with
  `node -e "console.log(typeof require('typescript').createProgram)"` —
  `undefined` means depcruise is blind. Note `tsc` itself keeps working (it is a
  native binary), so **the build and the test suite stay green and cannot see
  this**.
- **Bare `npx depcruise`** in directory mode (Gotcha #1) — always the local bin.
- **A target path matching no source.**

**Launch posture (2026-06-10)**: every committed rule ships at `warn`, so a
violation lands as `degraded`/exit 0 plus a CI `::warning::` annotation —
visible, never blocking — until severities are deliberately promoted to
`error` (a one-line flip per rule). The blocking path is unit-proven by the
extension's fixture tests, not waiting to be designed.

## What to do on a violation

1. Read `data.violations[]` — each entry carries `from`, `to`, the violated
   `rule`, and that rule's plain-English `comment`: the fix is explained at
   the point of failure. Violations are sorted `from`→`to`→`rule`, so report
   diffs are stable.
2. Fix the **import**, not the rule. Usually: depend on the `-port.ts`
   interface instead of the concrete adapter, or invert the dependency.
3. **Rule-change discipline**: never weaken, except, or demote a rule in the
   same PR that trips it. If a rule is genuinely wrong, ship the rule change
   *alone*, with rationale, and get it reviewed as an architecture decision.

## Gotchas

- **Never run bare `npx depcruise`** — in directory mode it silently scans
  **0 modules** and exits green: a fake sensor. Always the local bin:
  `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type json harness/cli/src`
- depcruise 17.4.3 exits 0 from `--output-type json` even with error-severity
  violations — the verb parses stdout and never trusts the exit code; neither
  should you.
- Run from the **repo root** — discovery and the preflight both resolve
  against the invocation cwd.

## Evidence

No durable evidence files are written (P9): counts and violations live in the
envelope's `data` (`modules`, `dependencies`, `violations[]`) — capture the
JSON output if you need a record (e.g. `harness arch-check --json > out.json`).
