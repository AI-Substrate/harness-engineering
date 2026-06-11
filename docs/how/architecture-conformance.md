# Architecture conformance — deterministic back pressure with `arch-check`

> *"A prompt that says 'follow our architecture' is a start. A deterministic
> architecture check that fails when the rule is violated is much better."*
> — [The engineering harness, the simple version](../../harness-foundations/simple-mode.md), Rule 3

This is that rule made concrete. Architecture conformance is the textbook
case of back pressure stuck in the **inferred world**: a reviewer eyeballs
the diff, a code-review prompt says "check the layering", and both are
non-deterministic — they catch the violation sometimes. This repo moves it
to the **deterministic world**: the hexagonal (ports & adapters) contract is
encoded as 7 dependency-cruiser rules at
[`.dependency-cruiser.cjs`](../../.dependency-cruiser.cjs), and the
[`harness arch-check`](../../.harness/extensions/arch-check/extension.ts)
exemplar extension turns them into a command the agent runs — yes or no, no
guessing — on every run and every PR.

The rule file is **encoded team memory** ("encode the fix, not the memory" —
[intro to harness](../harness-presentations/intro-to-harness.md)): instead of a
markdown paragraph explaining the layering that every fresh session must
re-infer, the invariant is executable, and its explanation travels with the
violation. The agent can say the architecture holds; the harness decides
whether that claim is supported by evidence.

This guide explains the rules, the pattern, and how to copy it into your own
repo.

## 1. The rules and why each exists

| Rule | What it forbids | Why |
|---|---|---|
| `no-circular` | any dependency cycle | cycles make layers unsplittable and dependency injection impossible |
| `services-never-import-acts` | services → command handlers | services are adapter-agnostic business logic; handlers orchestrate *them* |
| `services-only-adapter-ports` | services → concrete adapters/fakes | the kernel injects implementations; services see only `-port.ts` interfaces |
| `services-ports-type-only` | runtime imports of ports from services | port imports must be `import type` — erased at runtime, injected by the kernel |
| `adapters-stay-leaf` | adapters → services/acts/output | adapters wrap the outside world; they must not know the business layer |
| `output-stays-leaf` | output/envelope → services/acts | rendering is a leaf; reaching back up would invert the flow |
| `no-fakes-in-prod` | production source → `fake-*.ts` | fakes are test doubles; shipping one is a latent correctness bug |

Every rule carries its rationale as a `comment` **in the config itself** —
that comment travels into the violation envelope, so the fix is explained at
the point of failure.

## 2. Copy the pattern into your repo

The exemplar shape, adaptable in an afternoon:

1. `npm install -D dependency-cruiser` (a devDependency — it is shelled, never
   imported).
2. Write `.dependency-cruiser.cjs` at your repo root encoding *your* layering
   contract (start from this repo's file; swap the `from`/`to` path regexes
   for your source layout). One file, the single source of truth for the
   verb, raw runs, and CI.
3. Copy `.harness/extensions/arch-check/` (extension shell + pure
   `mapping.ts` + tests + `instructions.md`); change the `TARGET` path
   constant. The mapping is target-agnostic.
4. Add the CI step (final step of your test job): run **the verb**, annotate
   on `degraded`, propagate the exit code.
5. Prove it: run clean, then seed one deliberate violation and watch the
   right rule fire. A sensor you've never seen fail is not yet a sensor.

## 3. Writing agent-actionable rule comments

The `comment` is the agent-facing error message — tribal knowledge encoded as
data. Tokens are expensive: a violation that explains itself at the point of
failure costs nothing to act on; one that sends the agent off to re-discover
the layering doc costs a re-inference every session. Write the comment as the
*instruction that fixes the violation*, not a restatement of the rule name:

- ❌ `"services must not import adapters"` (restates the rule)
- ✅ `"Services may depend on adapter PORT interfaces only, never concrete
  node-*/exec-*/system-* implementations or fakes."` (names the legal
  alternative — the reader now knows to import the `-port.ts` type instead)

Heuristic: include (a) the invariant, (b) the legal alternative, and (c) the
naming convention that locates it.

## 4. Gotchas (all three found the hard way)

1. **Bare `npx depcruise` silently scans 0 modules** in directory mode and
   exits green — a fake sensor. Always invoke the local bin:
   `./node_modules/.bin/depcruise --config .dependency-cruiser.cjs --output-type json harness/cli/src`
2. **No `tsConfig` option** in the config for this layout — dependency-cruiser
   v17 fails with TS18003.
3. **The JSON reporter exits 0 even with error-severity violations**
   (measured on 17.4.3) — detection must parse `summary.violations`, never
   trust the exit code. The extension does this; so must any script you write.

## 5. Severity ramp — and this repo's warn-launch

Severities are the ramp from *visible* to *blocking*:

- **`warn`** — violation surfaces as a `degraded` envelope (exit 0) + a CI
  `::warning::` annotation. Visible on every PR, blocks nothing.
- **`error`** — violation becomes an `error` envelope (exit 1) and a red
  build.

**This repo launched with all 7 rules at `warn`** (decision 2026-06-10): the
tree measured clean at adoption, and the team chose to watch the sensor run
before letting it block. Promotion to `error` is a one-line flip per rule.
The ramp doctrine: *a rule lives at `warn` only while a named cleanup is in
flight or the team is deliberately observing; otherwise promote it or delete
it.* A permanent warning is noise, and noise trains everyone to ignore the
sensor.

## 6. The proof boundary (what this does NOT prove)

- Only `harness/cli/src` is checked — extensions, skills, and scripts are
  outside the graph.
- The import graph can't see *misuse*: a service can legally import a port
  and still use it wrongly.
- **A rule that was never written stays silently green.** The rule set's
  authority is empirical (PoC-proven against this tree), not derived from a
  documentation cross-walk — when the architecture docs gain a new invariant,
  someone must encode it.
- Complement, not replacement: `harness/cli/test/architecture/` keeps the
  point checks an import graph can't express (single `process.exit` site; no
  `node:fs` inside services). Both sensors stay.

When you hit the boundary — an invariant you had to *infer* because no sensor
proved it — that's the harness loop's feedback question ("what did you have
to infer that the harness should have proved?"): capture it, and encode the
missing rule.

## 7. Rule-change discipline

**Never weaken, except, or demote a rule in the same PR that trips it.** A PR
that both violates a rule and edits the rule has marked its own homework.
Rule changes ship *alone*, with rationale, reviewed as architecture decisions.
The inverse direction is always safe: promoting severity or adding a rule may
ride along with any PR that keeps the tree clean.

---

Operational reference: `harness instructions arch-check` (the agent briefing —
outcome states, error codes, what to do on a violation).
