# Workshop: How the flow-conformance evaluation system works (end-to-end)

**Type**: Integration Pattern / Operational Reference
**Plan**: 041-flow-conformance-eval
**Spec**: `../flow-conformance-eval-plan.md` (§ Business Specification)
**Created**: 2026-07-01T21:20:00Z
**Status**: Draft

**Value Thesis**: 001 settled *what a scenario and an assertion are on disk*; this workshop settles *how the whole system runs at runtime* — who does what, how a blind subject's behaviour becomes a deterministic verdict, and how to drive a run — so a fresh human or agent can execute an eval (or read a report) without reconstructing the moving parts from the code.
**Target Proof Level**: Implementation Ready
**Current Proof Level**: Contract Ready → Implementation Ready (grounded in runs 001–003)

**Selected Value Axes**:
- **Onboarding / Accessibility**: a cold agent can run an eval from this doc — the moving parts are named and sequenced.
- **Operator Usability**: the orchestrator-driving loop (the human-in-the-loop role) is written as a procedure, not folklore.
- **Knowability**: the otherwise-hidden join (subject behaviour → telemetry → verdict) is made explicit.
- **Learning Compounding**: the dogfood findings (F1–F17) are captured so each run's lessons survive.
- **Proof Quality**: every verdict lane states *how* it is proven; `unknown` is a first-class, non-penalising outcome.

**Related Documents**:
- `001-scenario-and-assertion-schema.md` — the on-disk scenario bundle + assertion-config schema + resolver taxonomy (the static contract this workshop runs).
- `../eval-orchestrator-process-notes.md` — the orchestrator playbook (skill seed) this workshop's § Driving a run summarises.
- `../experience-logs/00{1,2,3}-*.md` — the per-run journals where F1–F17 were found.

---

## Purpose

Explain the flow-conformance eval as a *running system*: the three actors, the runtime sequence from cold spawn to scored report, the telemetry→verdict join, the verdict rules, the orchestrator-driving procedure, and what the dogfood has caught. Keep it concrete enough to run from.

## Fresh Entrant Outcome

A fresh human or agent can use this workshop to reach **Implementation Ready**: stand up a run (spawn → canary → blind packet → drive cadence → score), read a `report.md` correctly (including why a row is `unknown`), and know which findings (F1–F17) already changed the harness.

## Key Questions Addressed

- What is "flow-conformance" actually measuring, and why a *blind* subject?
- Who are the actors and what may each one touch?
- How does a subject's run become a deterministic green/red verdict?
- How is telemetry joined to one subject, and what does the scorer see?
- What are the verdict rules (and why is `unknown` not a failure)?
- How do I drive a run as the orchestrator?
- What has the eval already caught about the-flow / the harness / itself?

---

## Value Frame

| Field | Selection | Why It Matters |
|---|---|---|
| Target Proof Level | Implementation Ready | A cold agent must be able to *run* a scenario and *read* a report, not just admire the design. |
| Primary Value Axis | Knowability | The subject→telemetry→verdict join is the system's load-bearing magic and is otherwise only in code. |
| Supporting Value Axes | Onboarding, Operator Usability, Learning Compounding | The run is a human-driven loop; the findings are the real deliverable. |
| Downstream Loop Improved | Running evals + reading reports + maintaining the scorer | Each becomes a read, not a reverse-engineering exercise. |

## The concept (what it measures, and why blind)

The eval answers one question: **does an agent, told only a plain task, actually carry it through `the-flow` (and the harness loop) the way the doctrine intends — provably, from telemetry and the filesystem, not from self-report?**

- **Fixed task, varied subject.** The task is pinned (md→PDF harness extension). The *subject* (harness × model × effort) is the variable. One knob changes per run → comparable results.
- **Blind by design.** The subject is given the task and a reporting contract — and *nothing* about method, stages, skills, tooling, or what's being counted. How it approaches the work is the thing under measurement, so the packet must not shape it (the reviewer-gate checklist in `prompts/subject.md` enforces this).
- **Deterministic where possible, judged only where it must be.** Most assertions resolve to pass/fail/unknown from machine evidence; a small `judged` layer (e.g. backpressure quality) is the only place a human/agent opinion enters.

```
        plain task (blind)                 deterministic evidence
   ┌──────────────────────────┐        ┌───────────────────────────┐
   │  "add an md→PDF harness   │        │ telemetry (what ran)      │
   │   extension, validated"   │  ───▶  │ + filesystem (what exists)│  ───▶  green/red report
   └──────────────────────────┘        └───────────────────────────┘        + one judged layer
            the subject's              joined by PIJ_SESSION_ID
          *behaviour* is the                (the scorer reads,
           thing measured                  never drives, the run)
```

## The three actors (keep them straight)

| Actor | Is | May touch | May NOT |
|---|---|---|---|
| **flow-eval** (scorer) | the `harness flow-eval score` verb — a read-only extension | reads telemetry + the subject's worktree; writes `report.{json,md}` | **never** drives pij; never mutates the subject or its work |
| **orchestrator** | the eval/“human-in-the-loop” agent (this session) | drives the subject over pij; injects load-bearing cadence; runs the scorer | doesn't write the subject's code or the subject's the-flow state |
| **subject** | a blind pij peer (the harness×model under test) | creates its own worktree, builds, drives its own `the-flow` | sees nothing about method/measurement; reports only per its packet |

> The separation is the integrity guarantee: the thing that *scores* never *drives*, and the thing that *drives* never *writes the work*.

## Runtime: cold spawn → scored report

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant D as pij daemon
    participant S as Subject (blind)
    participant T as Telemetry (refs + buffer)
    participant E as flow-eval scorer
    O->>O: pre-flight hygiene (clean stale worktrees/plans — F12)
    O->>D: pij spawn --harness --model [--effort]
    D->>S: boot + bind (PIJ_SESSION_ID set in env)
    O->>S: CANARY (exact model id?) — verify, no 400
    O->>S: BLIND packet (reviewer-gate stripped)
    O->>S: process steer (cadence only; orchestrator voice — F16)
    loop the-flow cadence
        S->>S: explore / plan(Simple) / validate / compact / implement / review / fix / validate
        S->>T: each harness command emits a counts-only segment (tagged PIJ_SESSION_ID)
        S->>O: stage check-in → O verifies artifact, sends "proceed"
    end
    S->>O: DONE (worktree + verb + validator cmd)
    O->>E: flow-eval score --session <pij> --worktree <wt>
    E->>T: fetch + join evidence by PIJ_SESSION_ID
    E->>E: resolve every assertion (telemetry / fs / judged)
    E-->>O: report.{json,md} (✓/✗/? + judged + verdict)
    O->>O: fill judged (A11) · teardown (close + clean — F12)
```

## The join: how behaviour becomes evidence

The whole system hinges on one correlation key — **`PIJ_SESSION_ID`**, set in the subject's environment at spawn and captured into every telemetry segment's `captured_env`.

- Each harness command the subject runs emits a **counts-only segment** (skills, tools, harness verbs, flow seams, checks, compactions, files, an event stream with `t` timestamps) tagged with that id.
- `harness telemetry get <pij-id> --json` (or the scorer's `getSessionEvidence`) **joins all segments for that id** into one `SessionEvidence`:

| `SessionEvidence` field | Carries | Feeds assertion lane(s) |
|---|---|---|
| `skills`, `skill_order` | skill name→count, first-seen order | `skill-called`, `skill-sequence` |
| `flow_seams` | ordered `"<flow>:<stage>"` | `flow-seam-fired` |
| `harness_verbs` | verb→count | `harness-verb-ran`, `retro-drained` |
| `checks` | per-checks-run verdict | `checks-ran` |
| `tools` | tool→count | `tool-used` |
| `compactions` | count | `compaction-occurred` |
| `files` | written/edited | (cross-checks fs lane) |
| `gaps` | fields absent/uncapturable | turns a lane `unknown`, not `fail` |

**The capture surface differs by harness — and that is a finding, not a footnote** (F8): Claude Code emits `kind:"skill"`/`kind:"flow"` name events, so `skills`/`skill_order`/`flow_seams` populate natively. Copilot CLI emits **no** skill-name events — skills run as anonymous `tools.skill` — so the scorer sets a `skill_name_capture` gap and falls back to a **verb-signature** (the-flow ⟺ `flow*`; eng-harness-flow ⟺ `observe`/`retro`/`boot`/`backpressure`) rather than false-failing.

## Verdict rules (the three-valued logic)

Each assertion resolves to **pass / fail / unknown**. Composite (fs+telemetry) assertions AND their halves with **fail-dominates, then unknown-over-pass**.

| Rule | Effect |
|---|---|
| `unknown` is excluded from the score | a capability gap (telemetry unavailable, name uncaptured) **never penalises the subject** — it's an honesty marker, not a failure |
| a `required` assertion that fails | **caps the whole verdict to FAIL**, regardless of the rest |
| `judged` assertions | resolve to `null` until a human/agent fills `verdict`/`rationale`/`by` against the evidence + worktree |
| verdict bands | `PASS` / `PASS_WITH_NOTES` / `FAIL`, with a score = passes ÷ (passes+fails), `unknown` set aside |

> Read a report **lane-aware**: a `?` row is "we couldn't prove it from this harness's telemetry," not "the subject failed." Confirm `data.telemetry.available` before trusting the telemetry lane at all.

## Driving a run (the orchestrator loop, condensed)

Full playbook: `../eval-orchestrator-process-notes.md`. The load-bearing moves:

1. **Pre-flight hygiene** — remove stale eval worktrees/plans *before* spawn, or a fresh subject *resumes* prior finished work and the run is invalid (F12).
2. **Resolve the model from the authoritative source** — a post-cutoff model id is real, not a typo; verify against the `claude-api` skill, not training memory and not `pij models` (its registry warns "unknown model" on models that run — F15).
3. **Canary** — a ready-ping is not proof; confirm the exact model id + no 400.
4. **Blind packet** — deliver only the above-the-rule content (`sed` the reviewer gate out); leak no method/stage/measurement.
5. **Cadence steer, orchestrator voice** — speak as the **human-driven orchestrator**, never claim to *be* a human; separate **method (subject's)** from **process/cadence (orchestrator's)**, or a security-aware model flags the contradiction with the packet's "no prescribed method" line (F16).
6. **Hold the load-bearing choreography** — plan **Simple** (A2) and **compact before implement** (A5) are scenario-pinned; the blind subject won't do them unprompted, so the orchestrator injects them at the right boundary via the check-in gates.
7. **Verify before advancing** — at each check-in, open the artifact (dossier/plan/`the-flow.json`) before sending "proceed"; never rubber-stamp.
8. **Score, fill judged, teardown** — resolve per-run placeholder assertions (A7 verb-help, A8 validator) with the subject's *reported* commands; run the scorer; fill A11; close + clean.

## Dogfood findings — what the eval has already caught

The run *is* the deliverable: each finding fixed the-flow, the harness, or the eval itself. Condensed ledger (detail in the experience logs):

| ID | Layer | Finding → fix |
|---|---|---|
| F6 | eng-harness-flow | `description` >1024 char cap → host-skipped the skill → the whole harness loop went invisible. Trimmed under cap; re-run proved boot+observe+retro re-engage. |
| F8 | scorer / telemetry | copilot emits no skill-name events → false-fails. Added `skill_name_capture` gap + verb-signature fallback. |
| F11 | scorer | `retro-drained` keyed on a phantom `harness_verbs.retro` verb that never fires → re-keyed on the real `record`/`observe` drain signature. |
| F12 | eval harness | teardown left stale worktrees+plans → next subject *resumed* finished work (invalid run). Pre-spawn clean step required. |
| F13 | telemetry | work-duration not exposed by `telemetry get` (counts-only); the `event_stream[].t` data exists. Add a `duration`/span to `SessionEvidence`. |
| F15 | pij | model registry stale → warns "unknown model" on real post-cutoff ids (`claude-sonnet-5`) that actually run. Refresh the registry. |
| F16 | eval design + model signal | the "we're the humans" steer + the packet's "no prescribed method" contradiction tripped Sonnet 5 @ xhigh's prompt-injection defence (it refused, correctly). Reframe: human-*driven* orchestrator; split method-vs-process. Capability signal: copilot/sonnet-4.6 swallowed it; only Sonnet 5 caught it. |
| F17 | eval design | orchestrator and subject share this repo's `~/.claude` project memory → an orchestrator memory write leaked into the blind subject (which flagged it as a suspicious instruction and over-disclosed). Keep eval-meta out of shared memory / isolate the subject's cwd. |

## Validation / Acceptance

This workshop reaches Implementation Ready when:

- A fresh agent can run a scenario end-to-end using only this doc + `001` + the process notes — spawn through scored report.
- A reader can correctly explain why a given `report.md` row is `?` (which lane, which `gap`) rather than `✗`.
- The three-actor boundary (scorer never drives; orchestrator never writes the work) and the load-bearing choreography (Simple, compact-before-implement) are reproducible without reading the code.

## Evidence Ledger

| Evidence | Location | Supports | Status |
|---|---|---|---|
| Assertion type registry | `.harness/extensions/flow-eval/resolvers.ts` (`RESOLVERS`) | the lane table + verdict rules | Validated (runs 001–003) |
| `SessionEvidence` shape + the join | `harness/cli/src/services/telemetry/session-evidence.ts` | the telemetry-join section | Validated |
| Three-valued AND + gap handling | `resolvers.ts` (`andVerdict`, gap fallbacks) | verdict rules | Validated (F8/F11 tests) |
| Orchestrator playbook | `../eval-orchestrator-process-notes.md` | § Driving a run | Draft (live-captured) |
| Findings F1–F17 | `../experience-logs/00{1,2,3}-*.md` | the dogfood ledger | Validated per-run |

---

Routing is the flow's job — run the parent flow bare to continue.
