---
name: eng-harness-flow
description: |
  Stateless harness-loop router — the single front door to the eng-harness skill family, and the harness-loop analogue of `the-flow` (which guides the SDD pipeline). On every call it re-derives where the work sits on the loop from deterministic repo signals plus an optional caller hint, then routes to the SINGLE correct harness skill — never call the children directly. It enforces an adoption gate (install → scout → governance → inject → boot LAST) before the engineering zone (boot → backpressure → observe → retro → improve), honours `at=` / `--event` / `--plan-dir` / `--spec` / `--phase` / `--prompt-optional` / `--json`, and resolves hint-vs-signal conflicts via a route/redirect/noop/ambiguous matrix. Stateless — safe to call anytime, from any caller. Never gates, scores, or blocks; never invents a health verdict (that is `harness doctor`'s job).
---
# eng-harness-flow

The **single front door** to the harness loop — the harness-loop analogue of `the-flow` (which guides the SDD pipeline). `the-flow` walks a *linear* journey (spec → plan → tasks → code → review → merge); this router routes a *cycle* re-entered wherever the work is: **adopt → boot → backpressure → observe → retro → improve**, drawn in [`references/getting-started.md`](./references/getting-started.md). On every call it re-derives *where on the loop you are* from deterministic repo signals + an optional caller hint, and hands back the **one right harness action** — never call the children directly.

**Progressive disclosure is the contract: load exactly one verb module for the current step — never read all of them up front.**

## The stateless contract (read this first)

`eng-harness-flow` is a **pure dispatcher**: `(repo signals, conversation, optional hint) → next harness action`. It **writes no artifacts of its own** (child verbs own the harnessability report, `backpressure-coverage.md`, the retro buffers, `.retro.md`); **never gates, scores, or blocks** (every route is a suggestion; a hint is never a command; declining the harness is conversational, not a `.disabled` file); **never runs `minih`** (companions belong to the implement verb) **or `/compact`** (it can only recommend it); and **never invents a verdict** (`harness doctor` answers whether the harness is healthy, not the router's opinion). It only **reads** signals + conversation, **routes** to exactly one verb (with a one-line *why*, the artifact it produces, and a `next_suggested`), optionally **runs it on an explicit go-ahead** (one step, never irreversible), and **re-derives every call** — re-entry after `/compact` needs nothing reloaded.

> **The unifying rule:** state that must persist lives in deterministic substrate a child verb owns (reports, buffers, `.retro.md`, the governance doc) — **never in this router**. If a need for router-owned memory ever appears, that is a signal the missing state belongs in substrate, not here.

The full engine — detection signals A–J, the two-zone adoption gate (the Graph), the engineering dispatch, the precondition/conflict matrix, and the byte-stable public contract — lives in [`references/00-routing.md`](./references/00-routing.md). The human-mode voice (rail, narration, why-table, tone) lives in [`references/coach.md`](./references/coach.md).

## Registry

**This table is the master** verb↔module binding; the Graph (ordering + detection) is the master in [`references/00-routing.md`](./references/00-routing.md). Each lifecycle hook / adoption rung resolves to exactly one verb, and each verb to exactly one module — except `coding`/observe, which has **no module**: it is the silent `harness observe` CLI verb.

| Trigger (lifecycle hook / adoption rung) | Verb | Module / target | Produces |
|---|---|---|---|
| `pre-flight` | boot | `references/stages/boot.md` | boot verdict (HEALTHY / SLOW / UNHEALTHY / UNAVAILABLE) |
| `pre-coding` | backpressure | `references/stages/backpressure.md` | `backpressure-coverage.md` |
| `coding` | observe | — **CLI verb**: `harness observe "<what>" --kind <kind>` (silent; no module) | one observe-buffer entry |
| `post-coding` | retro (drain) | `references/stages/retro.md` | drained `.retro.md` |
| `post-flight` | retro (harvest) + improve | `references/stages/retro.md` | harvested view + encoded improvement |
| adoption gate · on-ramp / inject | adopt | `references/stages/adopt.md` | installed + injected harness (delegates: assess, add-extension) |
| adoption gate · build boot | add-extension | `references/stages/add-extension.md` | a loadable extension / basic boot |
| adoption gate · scout | assess | `eng-harness-0-harnessability-assessment` *(public peer skill — not a module)* | harnessability report |

Module missing at its path → say so and stop. Never improvise a verb from memory.

## Command grammar

Works with **no arguments** (full auto-detect); a parent driving its own flow can pin position. The flags' full semantics — plus the byte-stable public contract (`--hook` / `--event` / `--hooks` / `--json`) — are defined once in [`references/00-routing.md`](./references/00-routing.md); this is the surface summary:

- `--hook <name>` — the PRIMARY invocation; names one of the five neutral lifecycle hooks (`pre-flight | pre-coding | coding | post-coding | post-flight`).
- `--event <seam>` — a permanent, zero-break **alias** for `--hook` (the six host seams `session-start | post-spec | pre-implement | task-pause | phase-end | plan-complete` map onto the five hooks).
- `at=<stage>` — friendly stage hint (`auto` / `adopt` / `boot` / `backpressure` / `observe` / `retro-drain` / `retro-harvest` / `improve`).
- `--plan-dir` / `--spec` / `--phase` — pin the plan / spec / phase so detection is never ambiguous.
- `--prompt-optional <bool>` — parent owns skip-suppression for optional offers (default true).
- `--json` — the machine-readable routing envelope (+ the resolved `hook`).
- `--hooks [--json]` — the discovery manifest `{ manifest_version, hooks[5] }`.
- `--help` — the synopsis below (print-and-stop).

**A hint is never a command.** The router validates each hint's precondition (the adoption gate + the conflict matrix in `00-routing.md`) and **redirects** when a hint contradicts the signals — it never blindly runs the named stage. `--repo` is reserved for v2 (the router operates on `cwd`).

## Progressive disclosure

Load **exactly one** verb module (`references/stages/<verb>.md`) when a step is taken — never read all of them up front. A module may lazily pull `references/00-routing.md` § Shared conventions when it cites one (the sanctioned exception); reading modules for verbs you are not executing is not. The verb modules are **harness-blind**: they carry no sibling names, no flow position, no lifecycle-hook self-reference, and no routing — that knowledge lives only here and in `00-routing.md`. Human-mode coaching (the rail, the narration beats, the why-table) lives only in [`references/coach.md`](./references/coach.md), never duplicated into the dispatch or the modules.

## `--help` — synopsis (print-and-stop)

`--help` prints this static synopsis and **stops** — no signal detection, no state, no routing, nothing fires:

```text
eng-harness-flow — stateless router to the harness loop (one front door).

USAGE
  /eng-harness-flow [--hook <name> | --event <seam>] [--plan-dir <p>] [--spec <p>]
                    [--phase <id>] [--prompt-optional <bool>] [--json] [--hooks] [--help]

LIFECYCLE HOOKS  (--hook, the primary invocation)
  pre-flight    before work starts       -> boot validation
  pre-coding    spec settled, pre-build   -> backpressure survey
  coding        mid-build (silent)        -> one in-flight capture
  post-coding   a phase just ended        -> per-phase retro drain
  post-flight   the whole plan is done    -> terminal harvest + improve

DISCOVERY
  --hooks [--json]   the five-hook manifest: { manifest_version, hooks[5] }
  --json             machine-readable routing envelope (+ the resolved hook)

--event <seam> is a permanent alias for --hook — session-start, pre-implement,
post-spec, task-pause, phase-end, plan-complete (see "Lifecycle hooks").
```

## References

- [`references/00-routing.md`](./references/00-routing.md) — the routing engine: signals A–J, the adoption gate (the Graph), the engineering dispatch, the precondition/conflict matrix, verb/slug resolution, the `--json` envelope + `--hooks` manifest (the byte-stable contract), and § Shared conventions.
- [`references/coach.md`](./references/coach.md) — the human-mode voice: the rail, the Orient→Flag→Insight→Suggest→Invite contract, the why-table, the Flag beat, tone.
- [`references/getting-started.md`](./references/getting-started.md) — the visual guide to the whole skill family: the two-zone big picture, who pulls each trigger, a worked walkthrough, and the `.harness/` directory map. The on-ramp for anyone new to the loop.
- [`references/governance-doc.md`](./references/governance-doc.md) — what the governance doc (`.harness/engineering-harness.md`) contains, the `harness-change` record ledger semantics, and the write conditions.
- [`references/maturity-assessment.md`](./references/maturity-assessment.md) — the canonical L0–L4 maturity ladder and how to assess which rung a harness sits on.
