# Backpressure Coverage — A first-class `harness hooks` verb

**Plan**: [plan.dd.md](../plan.dd.md)
**Basis (plan SHA-256)**: `f6a1a96e290720c5b42eac6ec854aeaa7061f9c8ed5f62283c53f018edc5dce9`
**Generated**: 2026-08-09
**Certainty**: Partial

> Advisory only. Never blocks, never gates, no scores.
> Selection, not enforcement: nothing here executes at phase end — the proof lines below are
> what the plan's owner folds into each criterion's "done when".

## Existing Sensors (inventory)

Discovered by globbing the filesystem, not by reading docs.

| Sensor | Paved command | Dimension | Found in |
|---|---|---|---|
| full vitest suite | `just test-all` | behaviour | `harness/cli/` |
| **fast** vitest suite | `just test` | behaviour (**narrower — excludes 10 SLOW_TESTS files**) | `harness/cli/` |
| composite gate | `just checks` | all three | root |
| typecheck | `tsc -p harness/cli/tsconfig.json` (via `just checks`) | maintainability | root |
| biome lint/format | `just fix` / `just format` | maintainability | root |
| architecture rules | `.dependency-cruiser.cjs` (via `just checks` → `arch-check`) | architecture-fitness | root |
| cross-platform static check | `just windows-check` | behaviour (portability) | root |
| markdown lint + link check | `just lint-md` | maintainability | root |
| dd document validation | `harness dd validate <path>` | data/contract integrity | root |
| runtime diagnostic | `harness doctor --json` | behaviour | root |
| engineering loop | `just fft` | all three | root |

**Trap recorded**: `just test` is the **fast** scope and prints so in its own note. Only
`just test-all` matches what CI gates on. "Gate green" has silently meant two different
quantities since #155 landed — every proof line below names the full-scope command explicitly.

## Coverage Matrix

| Criterion / failure mode | Phase | Selected proof | Status | Tier | Probe trail (required if ABSENT) |
|---|---|---|---|---|---|
| The tickler writes a correct note for a commit the daemon never observed (ac-1) | 1 | **BUILD→RUN**: build a live-daemon integration test that commits with `GIT_TRACE2_EVENT` discarded, emits, then asserts the note exists → `just test-all` | BUILDABLE | computational | — |
| A sandboxed agent commit yields correct per-author line ranges (ac-2) | 1 | **BUILD→RUN**: the same fixture at line-range granularity, asserting note IDENTITY per file → `just test-all` | BUILDABLE | computational | — |
| **No event emitted unless HEAD advanced by exactly one commit** (ac-3) | 1 | **BUILD→RUN**: a table-driven provocation suite — checkout, reset, rebase, amend, double-commit, no-op → `just test-all` | BUILDABLE | computational | — |
| `hooks install` is idempotent — second run byte-identical (ac-4) | 2 | **BUILD→RUN**: per-agent fixture round-trip, install twice, assert bytes → `just test-all` | BUILDABLE | computational | — |
| Install preserves foreign entries incl. git-ai's own (ac-5) | 2 | **BUILD→RUN**: fixture pre-seeded with git-ai + an unrelated tool's hooks; assert both survive byte-identical → `just test-all` | BUILDABLE | computational | — |
| Comment and key-order preservation | 2 | **BUILD→RUN**: JSONC fixture with comments and non-alphabetical keys → `just test-all` | BUILDABLE | computational | — |
| `hooks status` reports evidence, not claims (ac-6) | 2 | **BUILD→RUN**: fixture asserting status derives from a changed file → `just test-all` | BUILDABLE | computational | — |
| Every hook path exits 0 (ac-7) | 1 | **BUILD→RUN**: fault-inject each port (dead socket, unreadable config, malformed payload); assert exit 0 and empty stdout → `just test-all` | BUILDABLE | computational | — |
| Doctor failure is warn-only, other rows intact (ac-8) | 3 | **EXTEND→RUN**: add a case to the existing `doctor-service.test.ts` safeLayer battery → `just test-all` | EXTEND | computational | — |
| Opt-out env var skips installation (ac-9) | 3 | **EXTEND→RUN**: add a case beside the existing `HARNESS_NO_COLLECTOR` tests → `just test-all` | EXTEND | computational | — |
| `hooks uninstall` restores original bytes (ac-10) | 2 | **BUILD→RUN**: install→uninstall→assert original bytes, per agent → `just test-all` | BUILDABLE | computational | — |
| Services do not import `node:net` directly (new socket port) | 1 | **RUN**: `just checks` (the `no-direct-node-io` guard already sweeps 188 service files) | EXISTS | computational | — |
| Architecture boundaries hold for the new verb | 1-3 | **RUN**: `just checks` → `arch-check` (`.dependency-cruiser.cjs`) | EXISTS | computational | — |
| Cross-platform path handling (no hard-coded `/tmp`, separators) | 1-2 | **RUN**: `just windows-check` | EXISTS | computational | — |
| The hook runtime works on **Linux** | 1 | **BUILD→RUN**: run the Phase-1 integration fixture inside the OrbStack VM → `just test-all` in the VM | BUILDABLE | computational | — |
| **The hook runner is unsandboxed on Windows** | — | — | **ABSENT** | human-judgement | Probed: no Windows host in this fleet; `harness/cli/test/**` has no Windows runner; `.github/workflows/windows.yml` runs the **suite**, never an agent harness. The only instrument is the remote Windows operator on #108. |
| Cursor honours the shapes we write (per-agent hook schemas) | 2 | — | **ABSENT** | inferential | Probed `~/github/git-ai` for upstream contract docs: only Windsurf carries a doc link in-code. Every other agent's accepted hook shape is unverifiable from any source we hold. |

## Proof Plan (selected)

### Phase 1: The hook runtime
| Proves | Mode | Proof line |
|---|---|---|
| ac-1, ac-2 | BUILD→RUN | build the live-daemon note fixture; then `just test-all` |
| ac-3 (the dangerous one) | BUILD→RUN | build the HEAD-transition provocation suite; then `just test-all` |
| ac-7 | BUILD→RUN | build the port fault-injection battery; then `just test-all` |
| socket port boundary | RUN | `just checks` |
| Linux parity | BUILD→RUN | run the fixture in the OrbStack VM |

### Phase 2: The installer
| Proves | Mode | Proof line |
|---|---|---|
| ac-4, ac-5, ac-10, comments/order | BUILD→RUN | build the per-agent fixture corpus; then `just test-all` |
| ac-6 | BUILD→RUN | evidence-based status fixture; then `just test-all` |

### Phase 3: Doctor + live install
| Proves | Mode | Proof line |
|---|---|---|
| ac-8, ac-9 | EXTEND→RUN | extend `doctor-service.test.ts`; then `just test-all` |
| the live install actually works | — | `CURSOR-PROMPT-8.md` — a **human-run** validation, deliberately not a sensor |

## Certainty: Partial

Counts (behaviour/architecture rows): **3 RUN · 2 EXTEND · 10 BUILD · 2 ABSENT**
Recommended next move (per-task lookup, advisory): **any BUILD gaps on risk-linked criteria →
propose Phase 0 before feature code.**

Rationale: only 3 behaviour/architecture criteria have an existing sensor; ten need a fixture
corpus that does not exist yet, and two of those (ac-3, ac-5) are tied to named plan Risks —
*"a wrong emit produces a confident false note"* and *"writing into a shared config destroys
another tool's entries."*

## Recommended Phase 0: Establish Backpressure (build or extend)

Ordered by the gap rule: risk-linked first, then architecture > behaviour, extend before build.

| Sensor to build/extend | Proves | Suggested form | Paved command it strengthens/exposes |
|---|---|---|---|
| **HEAD-transition provocation suite** | ac-3 — no false emit (**risk-linked**) | table-driven fixture over checkout/reset/rebase/amend/double/no-op | `just test-all` (stronger) |
| **Agent-config fixture corpus** | ac-4, ac-5, ac-10 + comment/order preservation (**risk-linked**) | one realistic before/after fixture pair per agent, seeded with git-ai's own hooks | `just test-all` (stronger) |
| **Live-daemon note fixture** | ac-1, ac-2 | integration test: commit with trace2 discarded → emit → assert note identity | `just test-all` (stronger) |
| **Port fault-injection battery** | ac-7 — exit 0 on every path | inject dead socket / unreadable config / malformed payload | `just test-all` (stronger) |
| extend `doctor-service.test.ts` | ac-8, ac-9 | a case in the existing safeLayer battery | `just test-all` (same command) |

**Affordance recommendation (your call, not a plan edit):** the Phase-1 fixture needs a
*deterministic* way to reproduce total loss without Cursor. `GIT_TRACE2_EVENT=<discarded path>`
already does this — measured today. Paving it as a test helper turns tonight's manual
reproduction into a permanent sensor.

## Closing Verdict

Here's how we'll know this work is actually done, in plain terms.

**What the commands will prove.** Three things already have checks that will catch us: the new
socket code staying behind a port instead of reaching for the network directly, the
architecture boundaries holding, and the cross-platform path rules. Those run today with
`just checks` and `just windows-check` — no judgement calls involved.

**What has no check yet, and this is most of it.** Ten of the promises in this plan have
nothing that can prove them. Two of those matter more than the rest, because they're the ones
the plan itself flags as risks: **not firing when we shouldn't** (if we tell the collector a
commit happened when one didn't, it can attribute someone else's work — a confident wrong
answer, which is worse than no answer), and **not destroying a customer's config** when we
write our hook into a file that already has other tools' hooks in it.

**One thing I already did, automatically:** wrote the how-to-prove-it commands into this
coverage file, beside the plan, so whoever picks this up later sees them even after this
conversation is gone.

**One thing I'd like your OK on:** building the checks *before* the feature code — a fixture
corpus for the config writing, and a provocation suite for the commit detection. That's the
"needs a new check" rung, and it's genuinely Phase 0 work rather than Phase 1 polish. When
these pass, those promises are kept by commands rather than by anyone's opinion. And if the
checks ever pass while a human says it's still broken, **we fix the check first, then the
code** — so that mistake can never slip through again.

**Two things no command can settle.** Whether Cursor's hook runner is unsandboxed on Windows —
we have no Windows instrument in this fleet, only the remote operator on #108. And whether each
agent actually honours the hook shape we write; only Windsurf documents its contract, so the
rest is unverifiable from anything we hold.

**In summary:** the existing checks will prove the code's shape is right, but almost nothing
about its behaviour until we build the fixtures — and the two riskiest promises, false emits
and config destruction, are exactly the ones with no sensor today. Human judgement still owns
the Windows question and whether each agent accepts our hook format. **The recommended next
move is to build the two risk-linked sensors first**, and the approval I'm asking for is to
treat that as Phase 0 work inside Phase 1 rather than something we add afterwards.
