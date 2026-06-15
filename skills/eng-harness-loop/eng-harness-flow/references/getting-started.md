# The Harness Loop — Getting Started

A visual guide to the **engineering-harness skills** and the loop they operate. The entry point is almost always **`/eng-harness-flow`** — the stateless front-door router that works out where your repo sits and hands back the one right next command. Everything else chains from there.

> Repo reference: the adoption-side skills live at `skills/eng-harness-setup/` and the loop skills at `skills/eng-harness-loop/` in [`AI-Substrate/harness-engineering`](https://github.com/AI-Substrate/harness-engineering). Full skill matrix: `skills/README.md`. Zero-context consumer-agent onboarding: `AGENTS_README.md`. CLI details: `harness/cli/README.md` (or in-CLI via `harness docs`).

---

## The Big Picture

Two zones, one bridge:

- **🧰 Adoption gate** (once per repo) — the repo *adopts* the harness: install the CLI, scout the repo, governance, an injection point into the flow you already run, and a **working boot command — built LAST**, deliberately, so the moment it works you run it and flow straight into real work.
- **⚙️ Engineering loop** (every session, forever) — the cycle that *runs* the substrate: `Boot → Backpressure Check → Do Work and Observe → Retro and Magic Wand → Improve`, then back to Boot. It never "completes" — it compounds.

The router (`/eng-harness-flow`) sits *beside* both zones, not inside either: on every call it re-reads the repo's deterministic signals and routes you to the first missing adoption rung, or — once the gate holds — to the right loop stage for where your work is.

```mermaid
flowchart TB
    classDef setup fill:#fff3e0,stroke:#f57c00,color:#000
    classDef loop fill:#e8f5e9,stroke:#388e3c,color:#000
    classDef router fill:#f3e5f5,stroke:#7b1fa2,color:#000
    classDef verb fill:#e3f2fd,stroke:#1976d2,color:#000

    R["/eng-harness-flow<br/>stateless router · the front door"]:::router

    subgraph setupzone["🧰 ADOPTION GATE · once per repo · boot LAST"]
        S0["S0 · install<br/>eng-harness-0-adopt"]:::setup
        S1["S1 · scout (skippable)<br/>eng-harness-0-harnessability-assessment"]:::setup
        S2["S2 · governance<br/>harness init stamps it (seeded empty)"]:::setup
        S3["S3 · inject (advisory)<br/>map the extant flow → seams; record in governance"]:::setup
        S4["S4 · build + run boot LAST<br/>eng-harness-0-add-extension"]:::setup
    end

    subgraph loopzone["⚙️ ENGINEERING LOOP · every session · ↺"]
        B["Boot<br/>eng-harness-1-boot --validate"]:::loop
        BP["Backpressure Check<br/>eng-harness-2-backpressure"]:::loop
        O["Do Work + Observe<br/>harness observe (CLI verb)"]:::verb
        RD["Retro drain<br/>eng-harness-4-retro --drain"]:::loop
        RH["Retro harvest<br/>eng-harness-4-retro --harvest"]:::loop
        I["Improve<br/>encode the fix into the harness"]:::loop
    end

    R -.->|first missing rung| setupzone
    R -.->|by seam / --event| loopzone
    S0 --> S1 --> S2 --> S3 --> S4
    S4 ==>|"🎉 boot works — cross the bridge"| B
    B --> BP --> O --> RD --> RH --> I
    I -.->|next session ↺| B
```

**Legend**: 🟠 orange = adoption gate · 🟢 green = loop skills · 🔵 blue = a CLI verb, not a skill · 🟣 purple = the router. Solid = the establishing order, dashed = routing / the cycle re-entering.

---

## How the two zones fit

The adoption gate produces the **substrate** (CLI → report → governance → injection point → a proven boot). The engineering loop produces **compounding value** — it proves the system runs before you touch it, catches friction while you work, and turns that friction into encoded improvements, so the next session is smoother than this one.

Three rungs are **required** before the router will route into the loop — without them the loop skills honestly report `UNAVAILABLE` / no-op:

| Rung | What must hold | Required? |
|---|---|---|
| **S0 · Install** | harness CLI present, `harness doctor` healthy | **required** |
| **S1 · Scout** | a harnessability report exists | skippable |
| **S2 · Governance** | `.harness/engineering-harness.md` (the BIO contract) | **required** — *stamped by `harness init` (seeded empty); body fills at the Improve beat* |
| **S3 · Inject** | the governance doc's `## Injection map` — which seams your extant dev/SDD flow fires, from where (so the harness gets *used*, not just installed) | advisory |
| **S4 · Boot** | a working boot verb, authored **and run once** | **required** |

```
Boot ──────────────────────────────────────────────────────────────► Retro
  │                         Do Work                                     │
  │  ┌────────────────────────────────────────────────────────────┐    │
  └─►│   your normal dev flow (specs, plans, tasks, commits…)      │◄───┘
     │   (harness observe fires one-liner captures throughout)  │
     └────────────────────────────────────────────────────────────┘
```

---

## Where the loop plugs in — and who pulls the trigger

| Loop stage | Skill / verb | Who calls it | When |
|---|---|---|---|
| **Front door** | `/eng-harness-flow` | **You**, or a parent flow, anytime | Whenever you're unsure where you are. Stateless — safe to call repeatedly; it re-derives position from repo signals every call and routes exactly one next step. |
| **Boot** | `eng-harness-1-boot --validate` | **You** (or the router) at session start | Re-runs the boot that adoption built — proves the system is healthy *before* any code is written. Reports `UNAVAILABLE` (not an error) when no governance doc exists → routes back to adoption. |
| **Backpressure Check** | `eng-harness-2-backpressure` | **You**, recommended, post-spec | After scoped work is defined, before you architect/build it. Surveys whether the work is *provable by deterministic sensors* (build/type/test/lint/smoke/boot/architecture/schema) vs inference; writes `backpressure-coverage.md`; may recommend an optional "Phase 0: Establish Backpressure". Advisory — the sensors prove, never the LLM. Never blocks. |
| **Observe** | `harness observe "<what>" --kind <kind>` | **You/your agent, the moment friction happens** | A CLI verb, not a skill — one silent call per noticing (confusing failure, retry, backtrack, slow command, "if only there were…"). Lands in the gitignored buffer `.harness/temp/`. Capture judgment lives in `eng-harness-4-retro` § in-flight capture. |
| **Retro (drain)** | `eng-harness-4-retro --drain` | **You** at phase/session end, buffer non-empty | The one normal user-facing retro prompt: triage `[s/t/p/e/d/a]`, materialize kept entries into a committed record via `harness record retro`, then clear the buffer. |
| **Retro (harvest)** | `eng-harness-4-retro --harvest` | **You**, at plan completion / periodically | Read-only curation across `.harness/records/retro/**` — what recurs, what's stale, what to encode next. Recurrence is framed as token cost. Drain first if the buffer is non-empty. |
| **Improve** | retro `[e]ncode` / `eng-harness-0-add-extension` | **You**, when a retro names a fix | The beat where the loop compounds: ship the fix as a command, sensor, fixture, or doc — then `.harness/history.md` gains a row. Most loop runs encode nothing, and that's fine. |

**Opt-out is conversational.** There is no `.disabled` sentinel for the loop — if you don't want it, say so and the agent stops calling the loop skills. Nothing gates, scores, or blocks.

```mermaid
flowchart LR
    classDef manual fill:#e3f2fd,stroke:#1976d2,color:#000
    classDef auto fill:#e8f5e9,stroke:#388e3c,color:#000

    B["eng-harness-1-boot<br/>━━━━━━<br/>session start<br/>prove it runs"]:::manual
    BP["eng-harness-2-backpressure<br/>━━━━━━<br/>post-spec · recommended<br/>what's provable?"]:::manual
    O["harness observe<br/>━━━━━━<br/>during work · silent<br/>one call per friction"]:::auto
    D["eng-harness-4-retro --drain<br/>━━━━━━<br/>phase/session end"]:::manual
    H["eng-harness-4-retro --harvest<br/>━━━━━━<br/>plan complete"]:::manual

    B --> BP --> O --> D --> H
    D -.->|next phase| O
    H -.->|next session ↺| B
```

---

## Two on-ramps: fresh repo vs existing harness

The router tells these apart from signals alone (a `.harness/` directory, project-local skills, a governance doc) — you never have to know which path you're on.

```mermaid
flowchart LR
    classDef s fill:#fff3e0,stroke:#f57c00,color:#000
    classDef f fill:#e8f5e9,stroke:#388e3c,color:#000

    subgraph fresh["NO HARNESS YET · adopt one"]
        direction TB
        N1["eng-harness-0-adopt<br/>install CLI"] --> N2["assessment<br/>(offered)"] --> N3["boot verb<br/>built + run LAST"]
    end

    subgraph existing["HARNESS EXISTS · straight to the loop"]
        direction TB
        E1["eng-harness-1-boot<br/>--validate"] --> E2["work + observe"] --> E3["retro --drain"]
        E3 -->|next session| E1
    end

    fresh ==>|"once, ever"| existing

    class fresh s
    class existing f
```

**Fresh repo** — the router stays on the 🧰 adoption track and routes the first missing required rung. **Existing harness** — S0 + S2 + S4 hold, so every call dispatches into the ⚙️ loop by seam: session start → boot, post-spec → backpressure, mid-work → observe guidance, phase end → drain, plan complete → harvest.

---

## Example Walkthrough

> **Scenario**: you point an agent at a repo that has never seen a harness. (This is the journey the `validate-harness-flow` extension replays end-to-end as a self-test — it's proven, not aspirational.)

```
0.  /eng-harness-flow
    → Router reads signals: no CLI, no .harness/ → routes S0.
      "🧰 Looks like this repo hasn't adopted a harness yet — rung 0 of 5:
       install first; boot comes last."

1.  eng-harness-0-adopt        (S0 · install)
    → npm install -g @ai-substrate/engineering-harness   ← global, public npm, no auth
    → harness instructions   ← the agent briefing (AGENTS START HERE)
    → harness doctor --json  ← envelope healthy, exit 0

2.  eng-harness-0-harnessability-assessment   (S1 · scout, offered)
    → Writes .harness/reports/harnessability/latest.{md,json}
      — Operate-Today + Adaptability grades, proof ceilings, back-pressure surfaces.
      An honest "this repo isn't workable" here is a valid outcome.

3.  Governance (S2) — harness init
    → stamps .harness/engineering-harness.md (BIO skeleton, maturity L0, every
      other field a TODO). Idempotent never-clobber. The doc now exists but is empty;
      boot stays UNAVAILABLE until S4 builds the boot command. Nothing errors.

4.  eng-harness-0-add-extension               (S4 · boot, built LAST)
    → harness new boot --wrap "npm test"
    → Verify independently — never trust your own scaffold:
      harness doctor --json · harness instructions boot · harness boot --json
    → 🎉 boot's working — that's the harness alive. Cross the bridge.

5.  Work normally, loop around you:
    → eng-harness-1-boot --validate at each session start (re-RUN, never re-build)
    → eng-harness-2-backpressure once scoped work is specced, before building
    → harness observe "doctor's E143 message pointed at the
      wrong dir" --kind difficulty --severity degrading     ← the moment it happens

6.  eng-harness-4-retro --drain               (session end)
    → [s/t/p/e/d/a] triage → harness record retro → committed record in
      .harness/records/retro/ → buffer cleared.

7.  eng-harness-4-retro --harvest             (later, across sessions)
    → "this friction recurred 3× — encode it" → eng-harness-0-add-extension
    → the Improve beat ships a fix; .harness/history.md gains a row. ↺
```

You can drive every step by hand, but you never have to *route* by hand — `/eng-harness-flow` at any point answers "where am I and what's next?" from the repo itself.

---

## Quick Reference

| Command | What it does | Produces |
|---|---|---|
| `/eng-harness-flow` | **Front door** — stateless router; re-derives position from signals A–J and routes one next step | nothing of its own (a routing decision; `--json` envelope for machine callers) |
| `eng-harness-0-adopt` | The adoption flow: install CLI → scout → inject → stand up `boot` | installed CLI; orchestrates the rungs |
| `eng-harness-0-harnessability-assessment` | Size up the repo — evidence vs inference vs unknowns | `.harness/reports/harnessability/latest.{md,json}` |
| `eng-harness-0-add-extension` | Guided authoring of a new `harness <verb>` (incl. `boot` at S4) | `.harness/extensions/<name>/` (entry + `instructions.md`) |
| `eng-harness-1-boot` | Re-run the boot adoption built; readiness verdict + maturity read | terminal report (healthy / SLOW / UNHEALTHY / UNAVAILABLE) |
| `eng-harness-2-backpressure` | Deterministic-sensor coverage survey for scoped work | `docs/plans/<ordinal>-<slug>/backpressure-coverage.md` |
| `harness observe "<what>" --kind <kind>` | Capture one friction entry (CLI verb, not a skill) | one buffer entry in gitignored `.harness/temp/` |
| `eng-harness-4-retro --drain` | Soft-prompt triage of the buffer (`[s/t/p/e/d/a]`) | committed record via `harness record retro` |
| `eng-harness-4-retro --harvest` | Curated cross-plan friction view (read-only) | terminal print (`--json` for tooling) |
| `harness doctor --json` | What's configured + which extensions loaded/failed | JSON envelope, every complaint has a `next_action` |
| `harness instructions [verb]` | The agent briefing — AGENTS START HERE | terminal print |

> **Never run bare `npx harness`** — that fetches an unrelated npm package. The CLI is an **ambient global tool**, so after install just call `harness …` directly (it's on PATH). A no-global-write alternative is `npx @ai-substrate/engineering-harness …` (the scoped package, run from the npm cache).

---

## Directory Structure

```
<your-repo>/
├── .harness/
│   ├── engineering-harness.md      ← governance doc (BIO contract) — canonical, only location
│   │                                  (stamped by `harness init`, seeded empty; see references/governance-doc.md)
│   ├── history.md                  ← sparse changelog: one row per ENCODED improvement, never per session
│   ├── extensions/
│   │   └── boot/
│   │       ├── extension.ts        ← the verb (default-exports a HarnessVerb)
│   │       └── instructions.md     ← agent briefing (`harness instructions boot`)
│   ├── reports/
│   │   └── harnessability/
│   │       └── latest.{md,json}    ← the scout's graded report
│   ├── records/
│   │   └── retro/                  ← COMMITTED team memory (drain materializes here)
│   └── temp/                       ← GITIGNORED session scratch (the observe buffer)
└── AGENTS.md                       ← routes future agents to the harness at session start
```

The `harness` CLI itself is **not** in this tree — it's an **ambient tool** (installed globally, like `git`/`node`), never committed. Adoption leaves only `.harness/` substrate and the `AGENTS.md` cue in the repo.

Two storage classes, one rule: `.harness/records/` is **committed team memory**; `.harness/temp/` is **gitignored session scratch** (the CLI self-heals that protection; `doctor` checks it).

---

## Key Concepts

### The router is stateless — and that's the feature

`/eng-harness-flow` writes no state file and owns no artifacts. It re-derives position on every call from deterministic substrate (`harness doctor`, the governance doc, the harnessability report, plan artifacts, the observe buffer) — so it survives `/compact`, serves any caller (a human, a parent flow like the SDD pipeline's `/the-flow`, a CI agent), and never drifts from reality. The only durable "done" signal is a **child skill's artifact**, never the router's memory. If the router ever seems to need memory, that state belongs in substrate a child skill owns.

### The seam contract (for parent flows)

A parent running its own flow pins position with `--event` instead of letting the router guess:

```
--event session-start                      → eng-harness-1-boot --validate
--event post-spec      --spec <path>       → eng-harness-2-backpressure
--event phase-end      --plan-dir <path>   → eng-harness-4-retro --drain    (buffer non-empty)
--event plan-complete                      → eng-harness-4-retro --harvest  (buffer empty)
```

One command per call; the parent calls again for the next seam. Hints are validated, never blindly obeyed — `at=boot` on a repo with no governance politely redirects to adoption and says why.

### Maturity (L0–L4)

The ladder runs from L0 (no harness — tribal knowledge) to L4 (self-improving — the harness regularly produces improvements during normal work). Boot *reads* the current level from the governance doc; the trajectory lives in `.harness/history.md`. Report the level that's actually working, never the aspirational one. Full ladder + assessment guide: [`maturity-assessment.md`](./maturity-assessment.md).

### The harness loop in one sentence

> Boot proves the system runs, Backpressure asks what's provable before you build, Observe catches friction while you work, Retro turns that friction into encoded improvements — so the harness *is* the product, and every difficulty catalogued is a gift to your future self.
