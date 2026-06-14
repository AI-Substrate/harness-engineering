# The engineering-harness governance doc — contents & write conditions

This is the **one canonical description** of the engineering-harness governance doc: where it lives, what it contains, the companion `history.md` changelog, and *when* each is written. Skills that touch the doc (`eng-harness-1-boot`, `eng-harness-0-adopt`, `eng-harness-2-backpressure`, `eng-harness-4-retro`, `eng-harness-0-harnessability-assessment`) **link here** rather than restating these rules, so there is a single source of truth.

> **Separation of concerns (the load-bearing idea):**
> - **governance doc = contract** — what the harness *is*, plus the *current* maturity snapshot.
> - **`history.md` = changelog** — what *improved*, sparse (one row per encoded improvement).
> - **boot = runtime read** — it *reports*, it never *writes*.

---

## Where it lives (G1 · path + read order)

The canonical governance doc is **`.harness/engineering-harness.md`** — kept alongside the other harness artifacts in `.harness/` (which already holds `extensions/`, is tracked, and is not gitignored).

Every reader reads **exactly one** location: `.harness/engineering-harness.md`. The legacy `docs/project-rules/*` fallback chain is retired (plan 014) — a repo whose doc lives anywhere else should `git mv` it to the canonical path.

---

## What the governance doc contains (the BIO contract)

The doc is a thin **Boot / Interact / Observe contract** plus a signal inventory and the current maturity snapshot. It records:

| Section | What it holds |
|---|---|
| **AGENTS START HERE breadcrumb** | the doc's opening line points agents at the CLI's self-briefing channel: `AGENTS START HERE → npx harness instructions` (then `harness instructions <verb>` per verb). The briefing system is the *live* role contract; the governance doc carries the pointer so a zero-context reader finds it in one hop (plan 014 AC-12). |
| **Boot command** | the exact command that boots the system to a healthy, observable state (`<60s` target); the engineering-harness substrate the agent-facing loop runs on. |
| **Health check** | the command/endpoint that proves the system is up (read by boot's Stage 1). |
| **Interact method** | how an agent sends input to the running system (boot's Stage 2). |
| **Observe method** | how an agent captures evidence — logs, screenshots, traces, snapshots (boot's Stage 3). |
| **Deterministic signal inventory** | the sensors that let a human/agent prove behaviour without inference: runtime inspectability, smoke paths, architecture/static checks, security/dependency/schema checks. |
| **Evidence paths** | where artifacts land (log/trace/screenshot/output locations) so they're discoverable. |
| **Injection map** | where the repo's *extant* dev/SDD flow calls `/eng-harness-flow` — one row per seam event (`session-start`, `post-spec`, `pre-implement`, `task-pause`, `phase-end`, `plan-complete`): where it fires from and what fires it. The host flow is swappable (`the-flow`, another SDD pipeline, plain PR work); the seam vocabulary is the constant. This section is the durable signal behind the router's S3 rung — without it a cold agent has no structural reason to call the harness. |
| **Back-pressure gaps** | behaviours that still rely on inference or human eyeballing — named honestly as improvement candidates, never as scores. |
| **Current maturity snapshot** | the **single, current** L0–L4 level the harness is *actually* at (see [`maturity-assessment.md`](./maturity-assessment.md)). The doc holds only the *current* snapshot — the trajectory lives in `history.md`. |

The doc is a **contract, not a log**: it says what the harness *is right now*, not what happened each session.

---

## G3 · `.harness/history.md` is a changelog, not a log

`.harness/history.md` is a **sparse harness changelog**: **one row per improvement *encoded into the harness*** — the *Improve* beat of the loop. It is explicitly **not** a per-session or per-boot log.

- A row is written **only** when a retro / magic-wand actually *ships a harness change*: a new command, a new sensor, a faster boot, a maturity-level move.
- **Most loop runs add zero rows.** Booting, observing, even draining a retro buffer do **not** touch `history.md` unless an improvement is encoded.
- It is the **trajectory**; the governance doc holds only the *current* snapshot. A maturity level that climbs (or a boot time that shrinks) across rows is the compounding value made visible.

Consumers (e.g. `eng-harness-4-retro --harvest`) read the **current** maturity snapshot from `.harness/engineering-harness.md` and treat `.harness/history.md` as the sparse changelog **if present**; any field with no live source (last validation, boot ms, verdict) is reported `null` rather than fabricated.

---

## G4 · Boot is read-only

`eng-harness-1-boot` only **reads** maturity from the governance doc — it does **not** write governance or history. There is no per-validate `## History` append and no per-session write anywhere. Boot *reports* the level that is actually working; it never edits the contract.

---

## G5 · Write conditions — who writes the doc, and when

| Event | What changes | Who |
|---|---|---|
| **Inception** (once) | the doc is *created* with the BIO headings, the signal inventory skeleton, evidence paths, and the seed maturity snapshot | **the deferred `harness init` writer** (a CLI command). It is **deferred to a later plan**; until it ships, this rung is **owed, not provisioned** — setup attempts `npx harness init` with a graceful fallback, and boot/router degrade to `UNAVAILABLE` rather than erroring. (Setup *drives* setup; it does not itself generate the governance doc.) |
| **Improve beat** (on a capability change) | the **body** (boot cmd / signals / evidence paths / back-pressure gaps) **and** the **current maturity snapshot** are edited to match new reality; a row is appended to `.harness/history.md` | the Improve beat — when the harness gains or changes a capability |
| **Inject decision** (adoption S3, or when the host flow changes) | the `## Injection map` section is added/updated in an *existing* doc — never created standalone; when governance is owed, the map is owed with it | `eng-harness-0-adopt` Step 3, with the user's go-ahead |
| **Every other loop run** | **nothing** — boot reads, observe writes its buffer, retro writes `.retro.md`; the governance doc is untouched | — |

The doc is therefore written at **inception once**, and its body + snapshot change **only at the Improve beat**. It is never rewritten just to record that a session happened.

> **Deferred-writer honesty.** Because the `harness init` writer is deferred, no skill should claim setup *unconditionally* "provisions" governance. The honest statement is: governance is **owed** until `harness init` ships; setup routes to it / attempts it; readers degrade to `UNAVAILABLE` when the doc is absent. See the workshop's "Deferred — next plan" block for the worked `harness init` design.
