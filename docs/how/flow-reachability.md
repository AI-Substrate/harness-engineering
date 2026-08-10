# Flow reachability

Two questions about one plan folder, answered deterministically:

1. **Does the plan document validate?**
2. **Does a flight plan exist and read back?**

A stream that merges green having answered neither is the failure this exists to
catch. In one measured wave (AI-Substrate/pij#227) nine of nine streams merged
green, nine of nine had **no flight plan**, and two of nine had **no plan
document at all**. Nothing lied — nothing asked.

This guide covers what plan 081 shipped **on branch `s081/flow-reachability` —
none of it is on `main` until the plan lands**: the bundled `flight-plan` flow
type (so a flight plan can be created bare, with no flags to remember), and
`checkReachability` (so the two clauses can be read by a tool instead of a
person). It is the companion to [the `harness flow` verb family](harness-flow.md),
which covers flow mechanics generally.

> **Status:** the check ships as a **module**, not yet a verb — see
> [CLI registration is pending](#cli-registration-is-pending).

---

## The bundled `flight-plan` flow type

A flight plan is a first-class, built-in flow type **on branch
`s081/flow-reachability`; on `main` this exact line returns `E304` until plan 081
lands** (verified differentially: branch build `ok`, main build `E304`). The
create line is bare — no `--schema`, no `--template`:

```bash
harness flow create flight-plan --slug <s> --path <dir>/the-flow.json --plan-dir <dir>
```

```json
{"command":"flow","status":"ok","data":{"kind":"flight-plan","now":"research","next":null,"node_count":11,"event_count":1}, "...": "..."}
```

That writes `the-flow.json` and its generated `the-flow.md` sibling, seeded with
an **11-node** spine — `research`, `plan`, `phase-1`, `review-1`, `post-flight`,
`ship`, plus the harness loop's `backpressure`, `boot-1`, `observe-1`, `retro-1`
and `retro-harvest`.

### Source of truth

The bundle is a **generated copy**, never the source:

- The **skill owns** the type. `flight-plan.schema.json` and
  `flight-plan.template.json` live in
  [`skills/builder/references/`](../../skills/builder/references/) and are edited
  there.
- **`gen-flows` bundles** it. [`scripts/gen-flows.mjs`](../../scripts/gen-flows.mjs)
  reads the harness-owned schemas plus an explicit allowlist of *skill*-owned
  types — today exactly `flight-plan` — and emits the committed
  `harness/cli/src/services/flow/schemas-content.ts`. `tsc` compiles it like any
  other source file, so the built-ins ship with **zero runtime `fs`**.
- **`check:flows` guards** the copy. `npm run check:flows` regenerates the bundle
  and fails on any diff, so a schema edited in the skill and not re-bundled is a
  red check, not a silent drift.

Schema resolution precedence:
`--schema` › `.harness/schemas/flows/<type>.schema.json` › **the bundle** › `E304`.

Bundling a skill-owned type supersedes plan 024's stance that skill-owned flow
types stay `--schema`-only: a dispatching agent gets the create line right the
first time, with nothing to look up.

---

## The reachability check

### The two clauses

| # | Clause | How it is answered | Why that way |
| --- | --- | --- | --- |
| 1 | The plan document validates | Spawns **this binary** as a child: `plan validate <planDir> --json`, and reads the envelope | CLI-is-the-API. The plan family's semantics are consumed at the published surface, never by importing `services/dd/**` — so this check cannot pin an internal shape another stream owns |
| 2 | The flight plan reads back | `readFlowDoc` — the same reader the rest of the flow family uses | The four failure classes stay distinct instead of collapsing into one "bad flow" |

**Neither clause short-circuits the other.** Both are always read, in artifact
order. A check that stops at the first bad clause — and then reports only the
survivors — is exactly what cannot see a stream that is missing *both* artifacts.

### The verdict

| verdict | when | envelope status | exit |
| --- | --- | --- | --- |
| `error` | the plan document is missing or does not validate | `error` | 1 |
| `degraded` | the plan validates, the flight plan is unusable | `degraded` | 0 |
| `ok` | both good | `ok` | 0 |

A missing flight plan is a **warning, never a default-on gate** — it degrades,
it does not fail. That polarity is deliberate and matches plan 072: advisory by
default, teeth opt-in.

Exit codes are the kernel's status-only mapping (`src/output/exit.ts`), inherited
by whichever act registers the verb; the module itself returns a verdict, not an
exit code.

### The four flow reasons

Clause 2 reports *which* kind of unusable, because each has a different fix:

| reason | code | meaning | `present` |
| --- | --- | --- | --- |
| `absent` | `E301` | nothing at the path — the stream never created a flight plan | `false` |
| `legacy` | `E308` | flow-shaped but pre-CLI (no `provenance`) | `true` |
| `malformed` | `E300` | the file is there and is not valid JSON | `true` |
| `future-version` | `E306` | valid, written by a CLI major this one does not understand | `true` |
| `unreadable` | *(any other)* | an unmapped read failure — reported honestly, never folded into the four above | probed |

Only `absent` proves nothing is there. `legacy`, `malformed` and `future-version`
are each a file that exists and cannot be used. `unreadable` is the unmapped-code
case, so its `present` is **probed** rather than implied — it may be either.

### `examined` and `excluded`

`examined` is **every artifact looked at**, present or not — the denominator.
`excluded` is the subset that could not be used. Together they make "what is
missing" countable across a fleet of streams, which a pass/fail bit cannot do.

```text
examined: [ <planDir>/plan.dd.json, <planDir>/the-flow.json ]
excluded: [ <planDir>/the-flow.json ]                          → 1 of 2 unusable
```

### Absent vs. invalid: the `E400` nuance

`plan validate` returns **`E400` for both** "there is no plan document" and
"this is not a dd document". The envelope alone therefore cannot tell those
apart. So `plan.present` comes from an **`fs.exists` probe**, not from the
envelope — `present: false, validates: false` reads *absent*, while
`present: true, validates: false` reads *invalid*.

### A failed child is never a pass

The exit code is evidence about the **child**; the envelope is evidence about the
**plan**. When they disagree, no reading was produced:

- A child killed on timeout (exit `124`) is checked **before** its stdout is
  parsed — partial output is never a verdict.
- Stdout that is not a JSON object with a string `status` is not an envelope;
  a bare `{}` from a child that died early takes the "no envelope" path.
- A non-zero exit its own envelope does not account for (exit `127` with `{}`,
  exit `3` with an `ok` envelope) is an `error` whose detail names the exit code.
- An exec port that **rejects** (the child could not be started at all) is
  caught and mapped to the same `error` shape, naming the rejection — it never
  escapes as a throw.

Every one of these is `validates: false` with a detail that says what happened —
never an unexamined pass.

---

## Module API

[`harness/cli/src/services/flow/reachability.ts`](../../harness/cli/src/services/flow/reachability.ts).
Pure over injected ports: no `node:*`, no `process`, no clock of its own — the
caller resolves the repo root, the Node executable and this CLI's bin path.

```ts
import { checkReachability } from './services/flow/reachability.js';

const result = await checkReachability(
  {
    planDir: 'docs/plans/081-flow-reachability', // absolute, or relative to cwd
    flowPath: undefined,                          // defaults to <planDir>/the-flow.json
    cwd: repoRoot,
    nodePath: process.execPath,
    binPath: '/path/to/harness/cli/bin/harness.js',
    timeoutMs: 60_000,                            // default
  },
  { fs, clock, git, env, exec },                  // ReachabilityDeps
);
```

The result:

| field | type | meaning |
| --- | --- | --- |
| `verdict` | `'ok' \| 'degraded' \| 'error'` | the composed reading |
| `plan` | `{ present, validates, detail, path, code? }` | clause 1, `detail` verbatim from the CLI's envelope where there is one |
| `flow` | `{ present, readable, reason?, detail?, path, code? }` | clause 2 |
| `examined` | `string[]` | every artifact looked at |
| `excluded` | `string[]` | the subset that could not be used |
| `next_action` | `string` | one runnable next step, keyed on which clause failed |

`next_action` for a missing flight plan is the **runnable** create line with
repo-relative paths — `flow create --plan-dir` refuses absolute values, so a
copy-paste works:

```text
harness flow create flight-plan --slug plan-without-flow --path docs/plans/plan-without-flow/the-flow.json --plan-dir docs/plans/plan-without-flow
```

`checkReachability` **never throws**: a child that fails to spawn, rejects at the
exec port, hangs, or prints garbage becomes an `error` verdict whose
`plan.detail` names the cause.

---

## Worked examples

One row per shape in the
[reachability fixture corpus](../../harness/cli/test/services/flow/fixtures/reachability/README.md)
(that README carries the provenance of each shape). These verdicts are asserted
against the real built binary in `test/services/flow/reachability-real-cli.test.ts`:

| fixture | plan clause | flow clause | verdict |
| --- | --- | --- | --- |
| `098-shaped` | absent (`E400`) | `absent` (`E301`) | `error` — 2 of 2 excluded |
| `099-shaped` | absent (`E400`) | `absent` (`E301`) | `error` — 2 of 2 excluded |
| `plan-without-flow` | validates | `absent` (`E301`) | `degraded` — `next_action` is the create line |
| `both-good` | validates | readable | `ok` — nothing excluded |
| `legacy-flow` | absent (`E400`) | `legacy` (`E308`) | `error` — the plan clause decides, the flow reason still reads `legacy` |
| `malformed-flow` | absent (`E400`) | `malformed` (`E300`) | `error` — flow reason `malformed` |
| `future-version-flow` | absent (`E400`) | `future-version` (`E306`) | `error` — flow reason `future-version` |

The last three are the point of not short-circuiting: the verdict is already
decided by clause 1, and the flow reason is *still* reported, distinctly.

---

## CLI registration is pending

`checkReachability` ships behind the act seam with no verb wired to it yet. The
lift is separable and small — roughly ten lines: one act module plus one
registration line. It is queued rather than blocked; the file it lands in is
under an access window brokered by prime.

Until then, the check is consumed as a module import. The verb name (`flow check`
is the working name) is ratifiable with its first consumer, and the semantics —
not the spelling — are the load-bearing surface.

---

## See also

- [The `harness flow` verb family](harness-flow.md) — flow mechanics: create,
  mutate, navigate, render.
- [Deterministic documents](dd/README.md) — what `plan.dd.json` is and why
  `plan validate` can answer clause 1 at all.
- [`scripts/gen-flows.mjs`](../../scripts/gen-flows.mjs) — the bundler, and the
  allowlist that makes `flight-plan` built-in.
