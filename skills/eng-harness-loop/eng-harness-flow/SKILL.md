---
name: eng-harness-flow
description: |
  Stateless harness-loop router — the single front door to the eng-harness skill family, and the harness-loop analogue of `the-flow` (which guides the SDD pipeline). On every call it re-derives where the work sits on the loop from deterministic repo signals plus an optional caller hint, then routes to the SINGLE correct harness skill — never call the children directly. It enforces an adoption gate (install → scout → governance → inject → boot LAST) before the engineering zone (boot → backpressure → observe → retro → improve), honours `at=` / `--event` / `--plan-dir` / `--spec` / `--phase` / `--prompt-optional` / `--json`, and resolves hint-vs-signal conflicts via a route/redirect/noop/ambiguous matrix. Stateless — safe to call anytime, from any caller. Never gates, scores, or blocks; never invents a health verdict (that is `harness doctor`'s job).
---
# eng-harness-flow

The **front door** to the harness loop (the loop drawn in [`references/getting-started.md`](./references/getting-started.md), bundled with this skill — read that first if the skill family is new to you). `the-flow` does this for the **SDD pipeline** (a linear journey: spec → plan → tasks → code → review → merge). `eng-harness-flow` does it for the **harness loop** (a *cycle* re-entered wherever the work is: Boot → Backpressure → Observe → Retro → Improve → Boot). On each call it figures out *where on the loop you are* and hands back the **one right harness command** — whether you are on an empty repo (adopt a harness), a full repo with no harness (adopt one), or mid-plan in a healthy harness (boot / backpressure / retro).

The router is also a **guide on a journey**: most callers meet the loop cold, so as it routes it *teaches* — every turn says not just what's next but **why it matters**. The loop's purpose, in one line: make the repo's **deterministic layer** (build, test, proof, sensors, evidence) a **first-class, discoverable, improvable thing** instead of diffuse scripts and tribal knowledge — with the harness CLI as its focal point. Every routed stage is one move in that game, and the narration names which (§ Per-turn UX, the why table).

> **Stateless by design.** Unlike `the-flow`, this skill **stores nothing** — no state file, no `.json`/`.md` journey, no artifacts of its own. The harness loop has no single journey to checkpoint; *its* position is already observable in deterministic substrate (`harness doctor`, the governance doc, a harnessability report, plan-dir artifacts, the retro buffer). The router **re-derives** position every call from those signals, which is more robust than a parallel state file that can drift — and "prefer deterministic observation over remembered state" is itself a harness principle. The moment the router would need to *remember* something across calls, that something belongs in substrate a child skill owns — not here.

---

## The stateless contract (read this first)

`eng-harness-flow` is a **pure dispatcher**: `(repo signals, conversation, optional hint) → next harness action`. It:

- ❌ **Writes no artifacts of its own** — no state file, no flight-plan `.json`/`.md`, no journey log. Child skills own *their* artifacts (the harnessability report, `backpressure-coverage.md`, the retro buffers, `.retro.md`).
- ❌ **Never gates, scores, or blocks** — every route is a *suggestion*; `at=` is a hint, never a command; the adoption gate *informs* but never forces. There is **no `.disabled` sentinel** for the loop — declining the harness is **conversational** (the user says so and the agent stops calling the loop skills), not a file.
- ❌ **Never runs `minih`** (companions are owned by the plan-6 companion skill) and **never runs `/compact`** (a user-typed CLI built-in — it can only *recommend* it).
- ❌ **Never invents a verdict** — "is the harness healthy?" is answered by `harness doctor` (the JSON envelope), not by the router's opinion.
- ✅ **Reads** repo signals + conversation, **routes** to exactly one harness skill (with a one-line *why*, the artifact it produces, and a `next_suggested`), optionally **runs it on an explicit go-ahead** (one step, never irreversible), and is **safe to call any number of times**.
- ✅ **Re-derives every call.** Re-entry after `/compact` needs nothing reloaded — just re-detect. The rail itself is recomputed from substrate each call (never persisted).

> **The unifying rule:** state that must persist lives in deterministic substrate a child skill owns (reports, buffers, `.retro.md`, the governance doc) — **never in this router**. If a need for router-owned memory ever appears, that is a signal the missing state belongs in substrate, not in `eng-harness-flow`.

---

## The two zones — 🧰 adoption gate, then ⚙️ engineering loop

Two grouped concepts, kept separate:

- **🧰 Harness adoption** — the one-time *journey* (`eng-harness-0-adopt`) by which a repo takes the harness into how it works: install, scout, a **working boot command + governance**, and the injection point. Adoption wraps what the repo already has and weaves the loop into its extant flow. **Boot is built LAST** in adoption, deliberately, so the moment it's built you *run* it and flow straight into the dev loop ("build boot, run boot, then try the shiny new harness").
- **⚙️ Engineering flows** — the repeated ready-for-coding loop that *runs* it. Its first step **re-runs** the boot that adoption built; it never *creates* boot.

The router doesn't sit *inside* either zone — it sits *beside* them and points the caller at the right step. A single "harness functional?" gate is **not** enough to enter the engineering loop: the 🧰 adoption journey must have *established* the substrate, in order, ending with boot. The router walks the rungs and routes the **first missing one** to the adoption step that owns it — for the governance rung that means routing to `harness init` (the CLI writer that stamps the doc), noting that `init` seeds it *empty*, so a bare doc isn't a finished harness (see *seeded, not populated* below).

**The no-harness moment is an invitation, not a deficiency.** When nothing holds at all (S0 misses on a repo with source), narrate it as adoption, never as missing setup steps: *"Looks like this repo hasn't adopted an engineering harness yet. Adoption wraps what you already have — build, test, run, as-is — weaves the loop into your existing flow, and leaves a working `boot`. Want to walk through it?"* — then route to `eng-harness-0-adopt`.

### The 🧰 adoption gate (in order; boot LAST)

| Rung | What adoption must have established | Read via signals | Required? | If missing → route to |
|---|---|---|---|---|
| **S0 · Install** | CLI present + `harness doctor` healthy | A · B | **required** | `eng-harness-0-adopt` (install) |
| **S1 · Scout** | a harnessability report exists | F | *skippable* | `eng-harness-0-harnessability-assessment` |
| **S2 · Governance** | governance doc (BIO contract) + `docs/harness/` ledger | D · E | **required** | `harness init` (stamps the doc; seeded empty — see below) |
| **S3 · Inject** | a recorded injection map — where the user's extant dev/SDD flow calls `eng-harness-flow` | D — governance doc `## Injection map` | *advisory* | `eng-harness-0-adopt` (Step 3 — inject) |
| **S4 · Build + run boot (LAST)** | a **working boot command** (authored, recorded into governance, **and run once**) | C | **required** | `eng-harness-0-add-extension` (author boot, validate it boots) |
| **E1 · Re-run boot** | — (an **action**, not a presence-check) | — | — | **re-run** the boot adoption built — `eng-harness-1-boot --validate` (per coding session) |

- **Required rungs** (S0 install, S2 governance, S4 built boot) hard-gate the engineering zone: without governance + a working boot the loop skills report `UNAVAILABLE`/no-op, so the router **stays on the 🧰 adoption track**. The router routes the **first** missing required rung with a one-line *why*.
- **Skippable / advisory rungs** (S1 scout, S3 inject) are **offered, never blocking**. Because the router is stateless, a skip is *re-offered next call* unless the child artifact exists or the parent passes `--prompt-optional=false`.
- **Inject (S3) comes before boot (S4)** so that the instant boot works, the user already knows where `eng-harness-flow` plugs into their flow and can dive straight into real work.

> **Seeded, not populated (honesty about the skeleton).** The governance doc *writer* — `harness init` — **ships** (FX001): `harness init` stamps `.harness/engineering-harness.md` at inception, but seeds it **empty** (maturity L0, every other BIO field a `TODO`). So for S2 the router routes to `harness init` to *create* the doc; because `init` seeds it empty, the doc's *presence* satisfies S2 (the router reads presence, not contents — signal D), but the engineering loop still won't run until S4 builds the boot command — a bare seeded doc is the start of adoption, not its end. For S3 (inject) the `## Injection map` is one of those `TODO` sections `init` stamps empty and S3 fills. If the installed CLI is old enough to predate `init` (or `init` was never run and the doc is absent), the router reports `UNAVAILABLE` and stays on the adoption track (nothing errors). See `references/governance-doc.md` for what the doc contains and when it's written.

### The ⚙️ engineering dispatch (only once S0 + S2 + S4 hold)

Once the required adoption rungs hold, the router crosses into the loop and dispatches by *where in the work* the caller is:

| Where in the work (signals H · I / `--event`) | Route to | Produces |
|---|---|---|
| session start / unknown | `eng-harness-1-boot --validate` (re-run the boot adoption built) | a boot verdict (healthy / SLOW / UNHEALTHY / UNAVAILABLE) |
| spec done, pre-architect | `eng-harness-2-backpressure` | `backpressure-coverage.md` |
| mid-build (doing work) | capture is one CLI call — `harness observe "<what>" --kind <kind>` *(silent; judgment guidance lives in `eng-harness-4-retro` § in-flight capture)* | one buffer entry per call |
| phase / session end · **buffer non-empty** | `eng-harness-4-retro --drain` | buffer drained → `.retro.md` (`next_suggested: --harvest`) |
| phase / session / plan end · **buffer empty** | `eng-harness-4-retro --harvest` | curated cross-plan view |
| improvement chosen | route the improvement → retro `[e]ncode` / `eng-harness-0-add-extension` / emit a fix-plan command / (harness-product friction in a consumer repo) an upstream issue on `AI-Substrate/harness-engineering` | the encoded harness change (or the filed upstream issue) |

- **Drain before harvest.** At phase/session/plan end, if the observe buffer is non-empty the router routes `--drain` *first* (harvest only reads `.retro.md`, so harvesting a non-drained buffer would miss the latest session). One command per call; the parent calls again for harvest.
- **Improve is where the loop compounds.** The loop only *compounds* when a retro leads to an encoded improvement; most loop runs encode nothing and that is fine.
- **Ambiguous, never guessed.** With >1 candidate plan and no `--plan-dir`, the router returns `ambiguous` and **asks** — it does not guess the loop position from conversation alone.

> **This repo is the worked example.** `harness-engineering` has the CLI **and** two extension packages (`.harness/extensions/validate-harness-flow/` and `.harness/extensions/validate-harnessability/` — each a folder with `extension.ts` + `instructions.md`) **and**, since plan 014, its own governance doc at `.harness/engineering-harness.md` (boot = the CLI's vitest suite via `just test`). S0–S2 hold here; use it as the reference shape when routing other repos.

---

## Detection signals A–J

The router decides purely from signals it can **read** (no state of its own). This is the catalog; the decision order below applies them (hint first, then the adoption gate, then the engineering dispatch). There is **no `.disabled` opt-out** — opting out is conversational.

| # | Signal | How it's read | Tells us |
|---|---|---|---|
| A | **Harness CLI present** | `harness --version` resolves on PATH (the CLI is an ambient global tool, not a repo dependency); or a `.harness/` dir exists (the repo is already adopted) | Is there a harness at all? |
| B | **CLI healthy** | `harness doctor` **JSON envelope** read by `exit_code`/`status` field (not prose — the CLI loading and returning an envelope is the signal; a consumer repo can still show *degraded* on individual layers, but `cli-build` is `ok`/n/a there since FX001) | Does the CLI itself load/run? |
| C | **Working boot command** | a `boot` verb/recipe exists (`.harness/extensions/boot/`, a `justfile`/`package.json` boot, or governance declares it) **and** boots cleanly | Did adoption establish a boot we can run? |
| D | **Governance doc** | `.harness/engineering-harness.md` (the canonical and only location) | Is the Boot/Interact/Observe contract present? (Boot needs this or it reports `UNAVAILABLE`.) Its `## Injection map` section is S3's durable signal: which seams the host flow fires, from where |
| E | **Loop substrate** | `.harness/temp/` (gitignored observe scratch) + `.harness/records/retro/` (committed retro records, created via `harness record retro`) — legacy `docs/harness/agents/` retros are still read by harvest for back-compat | Can Observe/Retro actually record anything? |
| F | **Harnessability report** | any report under `.harness/reports/harnessability/` (path inconsistency noted — see "limits"; the router detects *any* report present) | Has the repo been sized up? |
| G | **Repo shape** | source tree empty vs. has source (e.g. `src/`, `package.json`, a language toolchain) | Fresh on-ramp vs. adopt-existing |
| H | **In-a-plan position** | `docs/plans/*/` artifacts: `*-spec.md` (post-spec), `*-plan.md` (post-architect), `tasks/phase-*/` + `execution.log.md` (mid-build), `reviews/` (reviewed) | Which loop stage the work is at *(best-effort — see "limits")* |
| I | **Conversation history** | the live session (what the parent just did/said) | Disambiguates G/H when files are inconclusive |
| J | **Parent hint (params)** | `at=<stage>` / `--event` / `--plan-dir` / `--spec` / `--phase` (see § Parameter contract) | Lets the parent pin position and skip detection |

### Decision order

1. **Parent hint first (J).** An explicit `at=`/`--event` is honoured **only if its precondition holds** (validated by the adoption gate + the conflict matrix). Otherwise the router **redirects** to the adoption step that owns the missing rung and says why — it never blindly runs the named stage when signals contradict it. (For the governance rung, "owns" means routes to `harness init` — the CLI writer the router calls but does not itself implement; see *seeded, not populated*.)
2. **Then the 🧰 adoption gate** (S0 → S1 → S2 → S3 → **S4 boot last**). Route the first missing **required** rung (S0, S2, S4); *offer* the skippable rungs (S1, S3) without blocking.
3. **Then the ⚙️ engineering dispatch** (the table above), keyed on `--event` / signals H · I, with drain-before-harvest and ambiguous-not-guessed.

### Where statelessness has limits (and who absorbs them)

1. **Skipped optionals re-offer.** With no memory, a declined scout/backpressure offer comes back next call. **Absorbed by**: the parent (skip-suppression via `--prompt-optional=false`) and by treating the **child artifact** as the only durable "done" signal.
2. **In-plan position is inferred, not known.** Plan-dir artifacts are ambiguous in real repos (multiple plans, stale phases, post-`/compact` context loss). **Absorbed by**: the parent pinning `--plan-dir`/`--spec`/`--phase`/`--event`; when unpinned and ambiguous the router returns `ambiguous` and **asks**.
3. **Provisioning gaps look like engineering entry.** A repo can pass S0 (CLI installed) yet lack S2 (governance) or S4 (a working, run-once boot), so a naive "functional?" check would route into the engineering zone whose skills then report `UNAVAILABLE`/no-op. **Absorbed by**: the adoption gate — the router refuses to enter the ⚙️ engineering dispatch until S0 + S2 + S4 hold.

---

## Parameter contract

The skill works with **no** arguments (full auto-detect), but a parent driving its own flow can **pin** position so detection is never ambiguous.

```
/eng-harness-flow [--hook <name>] [at=<stage>] [--event <seam>] [--plan-dir <path>] [--spec <path>]
                  [--phase <id>] [--prompt-optional <bool>] [--repo <path>] [--json] [--hooks] [--help]

at=auto            (default) detect from signals A–J
at=adopt           force the on-ramp (install / finish adoption / stamp governance via harness init)
                   (`at=setup` is an accepted back-compat alias)
at=boot            force eng-harness-1-boot --validate
at=backpressure    force eng-harness-2-backpressure (post-spec seam)
at=observe         guidance only; with --entry-* it silently runs `harness observe`
at=retro-drain     force eng-harness-4-retro --drain (phase/session end)
at=retro-harvest   force eng-harness-4-retro --harvest (plan complete)
at=improve         route a chosen improvement (retro [e]ncode / add-extension / fix-plan)

--hook <name>      pre-flight | pre-coding | coding | post-coding | post-flight
                   the PRIMARY invocation — names one of the five neutral lifecycle
                   hooks directly (§ Lifecycle hooks)
--event <seam>     session-start | post-spec | pre-implement | task-pause |
                   phase-end | plan-complete
                   a permanent, transparent ALIAS for --hook (maps per § Lifecycle
                   hooks); kept zero-break for every existing call site — never deprecated
--plan-dir <path>  pin the plan the loop stage refers to (disambiguates >1 plan)
--spec <path>      pin the spec for backpressure scoping
--phase <id>       pin the phase for boot/retro
--prompt-optional  <bool>  parent owns skip-suppression for optional offers (default true)
--repo <path>      operate on a repo other than cwd (multi-repo callers; reserved for v2)
--json             return the routing decision as a machine-readable envelope
```

- **`--hook`/`at=`/`--event` is a hint, not a command.** The router *validates the precondition* (the adoption gate + the conflict matrix below). `at=boot` on a repo with no governance doc politely **redirects** to provisioning and says why; it never blindly runs the named stage when signals contradict it.
- **Observe needs a payload to do anything.** In-flight capture is a *silent CLI producer that logs one entry per call* — `harness observe "<what>" --kind <kind>` (the merged `eng-harness-4-retro` skill carries the capture judgment). So `at=observe` with no payload is **guidance only** ("observe fires silently — here's how friction gets logged"); to actually record, the parent passes the entry fields and the router runs the capture command silently.
- **Optional offers don't self-suppress.** Because the router is stateless, a skipped optional (scout, an offered backpressure) is *re-offered next call* unless the parent sets `--prompt-optional=false` or the child artifact now exists. The router treats only **child artifacts** as durable completion — never its own memory.
- **`--repo` is reserved for v2.** Multi-repo execution is documented but not implemented in v1; the router operates on `cwd`.

### Lifecycle hooks

The router exposes its loop to host flows as a **closed set of five neutral lifecycle hooks** — the stable, stage-neutral vocabulary a host names when it calls the router (`--hook <name>`). The set is **fixed at five** (never grown per-repo) and **stateless** (derived every call, never stored). Each hook names a *moment in the host's lifecycle*, never a child-skill slug.

| Hook | When in the host's lifecycle | Behaviour | What the call drives |
|---|---|---|---|
| `pre-flight` | before work starts — session open, or about to implement | fire | boot validation (`harness-boot`) |
| `pre-coding` | spec settled, before building | fire | backpressure survey |
| `coding` | mid-build, in flight | **silent** — one capture per call | in-flight capture (`harness observe`) |
| `post-coding` | a phase / work-unit just ended | fire | per-phase retro drain |
| `post-flight` | the whole plan / journey is complete | fire | terminal close-out — harvest + present improvements + encode |

**`--event` seam → `--hook` mapping** (the six host seams alias onto the five hooks — `session-start` and `pre-implement` both open onto `pre-flight`):

| `--event` seam | `--hook` |
|---|---|
| `session-start` | `pre-flight` |
| `pre-implement` | `pre-flight` |
| `post-spec` | `pre-coding` |
| `task-pause` | `coding` |
| `phase-end` | `post-coding` |
| `plan-complete` | `post-flight` |

Two mappings are load-bearing and easy to get wrong:

- **`pre-implement` opens onto `pre-flight`, not `pre-coding`.** It fires the `harness-boot` node — prove the system runs before a line of code — the same boot `session-start` re-runs. (Naming it `pre-coding` would route it to the backpressure survey, which is wrong.)
- **`phase-end` → `post-coding` and `plan-complete` → `post-flight` are distinct.** Per-phase drain (`post-coding`) and the terminal harvest-and-improve (`post-flight`) are different lifecycle positions; collapsing both onto one hook would bury the **Improve** beat.

### Slug resolution (avoid version drift)

Like `the-flow`'s alias table, the router maps friendly stage names → the **exact installed slug at call time** and **never appends a guessed version suffix**. The current map:

| Friendly name | Installed slug |
|---|---|
| `adopt` (alias: `setup`) | `eng-harness-0-adopt` |
| `assess` | `eng-harness-0-harnessability-assessment` |
| `add-extension` | `eng-harness-0-add-extension` |
| `boot` | `eng-harness-1-boot` |
| `backpressure` | `eng-harness-2-backpressure` |
| `observe` | `eng-harness-4-retro` *(in-flight capture section — the capture itself is `harness observe`, a CLI verb, not a skill)* |
| `retro` | `eng-harness-4-retro` |

If a slug fails to resolve at runtime, **do not guess a suffix** — fall back to printing the bare stage name and point at `skills/eng-harness-*`.

### Precondition / conflict matrix

When a hint conflicts with the detected signals, the router resolves **deterministically** (never guesses, never blindly runs):

| Hint / event | Conflict | `decision` | Router does |
|---|---|---|---|
| `at=boot` | no governance (S2) or boot not built yet (S4) | `redirect` | route to the missing step — stamp governance via `harness init` (S2), then build+run boot last (S4); `missing_rung: S2`/`S4` |
| `at=backpressure` | no spec, or >1 spec and no `--spec` | `redirect` / `ambiguous` | ask for `--spec`, or route to `/plan-1b` first |
| `at=retro-drain` | buffer empty | `noop` | "nothing to drain"; suggest `--harvest` if `.retro.md` exist |
| `at=retro-harvest` | buffer non-empty | `redirect` | drain first; `next_suggested: --drain` then `--harvest` |
| `at=adopt` (or alias `at=setup`) | adoption already complete | `noop` | "harness already adopted"; suggest `at=boot` |
| `at=auto` | >1 candidate plan, no `--plan-dir` | `ambiguous` | list plans, ask / require `--plan-dir` |

### The `--json` routing envelope

`--json` returns the routing decision as a machine-readable envelope so a parent agent can act without parsing prose (the harness "return prompting" ethos). It carries at least these fields:

```jsonc
{
  "requested_stage": "boot",
  "actual_stage": "adopt",
  "hook": "<the lifecycle hook this call resolves to: pre-flight|pre-coding|coding|post-coding|post-flight — the --hook value, or the hook the --event seam aliases to>",
  "decision": "route | redirect | noop | ambiguous",
  "command": "<exact next harness command>",
  "why": "<one line>",
  "produces": "<artifact the routed skill will create, or null>",
  "preconditions_met": false,
  "missing_rung": "S4-build-and-run-boot",
  "next_suggested": "<the command after this one, e.g. --harvest after --drain>",
  "bypass_recommended": false,
  "bypass_cause": "<a harness-bypass `cause` enum value when bypass_recommended is true, else null>",
  "rail":  { "zone": "adopt", "adopt_pips": "◆◆◐◇◇", "loop_pips": "◇◇◇◇◇", "cursor": "governance" },
  "now":   "<current stage, one line>",
  "next":  "<what follows, one line>",
  "flags": [ "<must-see item lifted verbatim from the artifact>" ],
  "insight": "<one interesting real detail>"
}
```

The `hook` field is **additive** — no existing field is reshaped or renamed. A routing call (`--hook X --json`, or its `--event` alias) returns the envelope above **plus** `hook` (the resolved lifecycle hook for the call); the routing envelope never embeds a hooks manifest.

The `rail`/`now`/`next`/`flags`/`insight` fields carry the UX signals (see § Per-turn UX) so a machine caller can render the same pleasant rail + flag beat a human gets. This matters precisely *because* the router is stateless: the rail, now/next, and flags are all **recomputed from substrate every call** — a pure function of "what the repo looks like right now," which is why the UX survives `/compact`, serves any caller, and never drifts from reality.

`bypass_recommended` / `bypass_cause` are **advisory flags only**. When the router detects that the caller hit (or is about to hit) harness friction worth recording, it *flags* it — setting `bypass_recommended: true` and a `bypass_cause` drawn from the `harness-bypass` `cause` enum — so the parent can offer `harness record harness-bypass`. Consistent with the stateless contract, the router **never writes a record and never blocks** on this; it only reads/derives the flag (default `false` / `null`).

### The `--hooks` discovery manifest

`--hooks [--json]` is the **discovery** surface — the routing envelope's counterpart. A routing call (`--hook X`) answers *"what do I do now?"*; `--hooks` answers *"what hooks exist, and how does a host wire them?"* — a host (e.g. `the-flow`) reads it once to learn the contract, then routes against it.

`--hooks --json` returns a **top-level** object (Shape A — never wrapped in `data`), so a host detects future shape changes via `manifest_version`:

```jsonc
{
  "manifest_version": 1,
  "hooks": [
    {
      "hook": "pre-flight",                  // the lifecycle hook (one of the fixed five)
      "intent": "prove the system runs before work starts",
      "run_at": "session open / before implementing",
      "kind": "fire",                        // "fire" | "silent"
      "invoke": "/eng-harness-flow --hook pre-flight --json",
      "aliases": ["session-start", "pre-implement"],  // the --event seams this hook subsumes
      "produces": "boot verdict",            // artifact/effect, or null
      "needs": [],                           // upstream inputs this hook expects
      "preconditions": ["S2-governance", "S4-boot"]   // adoption rungs that must hold; [] otherwise
    }
    // … four more entries — same nine fields, values per the table below
  ]
}
```

All five entries carry the **same nine fields** (`hook`, `intent`, `run_at`, `kind`, `invoke`, `aliases`, `produces`, `needs`, `preconditions`); only the values differ:

| `hook` | `kind` | `run_at` | `aliases` | `produces` | `preconditions` |
|---|---|---|---|---|---|
| `pre-flight` | fire | before work starts | `session-start`, `pre-implement` | boot verdict | `["S2-governance","S4-boot"]` |
| `pre-coding` | fire | spec settled, pre-build | `post-spec` | `backpressure-coverage.md` | `[]` |
| `coding` | **silent** | mid-build, in flight | `task-pause` | one observe entry | `[]` |
| `post-coding` | fire | a phase just ended | `phase-end` | drained retro | `[]` |
| `post-flight` | fire | the whole plan is complete | `plan-complete` | harvest + encoded improvements | `[]` |

- The spine is **fixed at five** — `--hooks` never grows or shrinks per-repo (closed spine); the *only* per-repo variability rides in each entry's `preconditions`.
- `--hooks` is a **pure discovery** call: derived every call (never stored), it runs no detection, reads no plan signals, and writes nothing.
- **Routing and discovery stay separate**: a routing call (`--hook X --json`) returns the envelope **plus** `hook` and **never** embeds this manifest; a discovery call (`--hooks --json`) returns **only** the top-level `{ manifest_version, hooks }` and never a routing envelope.

---

## Per-turn UX (human mode)

`the-flow` is a *pleasant* experience because every turn shows a **progress rail**, says **where we are** and **what's next**, and **flags anything important the user might have missed** — in a warm, confirming-not-nagging voice. `eng-harness-flow` adopts the same UX. The one adaptation: because the router is **stateless**, the rail is **recomputed from substrate every call** (not read from a saved journey) — but the *feel* is identical.

### 1. The host rail — always first, every turn

Every human-mode turn opens with a one-line rail, then a blank line, then the narration. The rail speaks `the-flow`'s exact glyph language — **one visual vocabulary across both guides**: `◆` done · `◐` current · `◇` not yet, joined by `─` into a track. The loop's terminal is `↺`: engineering never "completes", it cycles — loop pips are **per-pass** and reset when the loop re-enters Boot. Use text-presentation `⚙` (never the `⚙️` emoji — double-width glyphs wreck the rail's spacing).

**Engineering zone** (adoption holds — the adoption segment disappears entirely; never render a completed adoption bar):

```
[eng-harness-flow] ⚙ ◆─◐─◇─◇─◇ ↺  boot · [backpressure] · observe · retro · improve

 now  · post-spec — running the backpressure survey (boot ✓ this pass)
 next · ▸ /plan-3   architect — consumes backpressure-coverage.md
```

The five loop pips are Boot · Backpressure · Observe · Retro · Improve, in that order, and the legend rides **on the rail line itself**: two spaces after the pips, the stage names in pip order joined by ` · `, the **current** one wrapped in `[…]`. Brackets follow the `◐`; on a settled rail bracket the next stage up. Same rule as `the-flow`’s rail.

**Mid-adoption** (the only time the 🧰 gate appears — two segments joined by `→`, loop still empty):

```
[eng-harness-flow] 🧰 ◆─◆─◐─◇─◇ → ⚙ ◇─◇─◇─◇─◇ ↺  install · scout · [governance] · inject · boot

 now  · adoption gate — governance missing (S2); install ✓, scout ✓
 next · ▸ <the governance step>   (routes you there)
```

Adoption pips = S0 install · S1 scout · S2 governance · S3 inject · S4 boot. The moment S0+S2+S4 hold, drop the 🧰 segment for good. The legend names the **active segment’s** steps — adoption rungs while the gate is open, loop stages once in the engineering zone.

- **Stateless rail**: the fill is *derived from signals each call* (which adoption rungs hold; where in the work) — never persisted. Frame it once, early, as *an at-a-glance map, not a saved journey*.
- **Render the whole rail block as a fenced code block — always.** The rail line(s), any anchored companion line, and the `now`/`next` groups are ONE ``` fence (no language tag). Outside a fence markdown collapses leading spaces — and **never** fake alignment with `&nbsp;` or any HTML entity (terminals print them literally). Real spaces inside the fence are the only alignment tool.
- **Status line** under the rail: ` now  · <current>` / ` next · <what follows>`, aligned. When `next` has ≥2 options, stack them with `▸` (recommended first), exactly like `the-flow`.

### 1a. The unified rail — when `the-flow` is also live

Before rendering a solo rail, probe for an active SDD flow: any `docs/plans/*/.the-flow-state.json` with `"status": "active"`. If one exists, the two guides merge into **one unified block** — `the-flow`'s rail on top (fill from that state file's `milestones_done`/`milestones_total`), the harness loop **anchored beneath the active milestone**, then **each flow speaks with its own voice** — its own `now`/`next`, harness lines prefixed `⚙`:

```
[the-flow]  ◆─◆─◐─◇─◇─◇─◇  research · spec · [plan] · tasks · build · review · merge
                └─ ⚙ ◆─◐─◇─◇─◇ ↺  boot · [backpressure] · observe · retro · improve  (post-spec)

 the-flow
  now  · spec READY + validated (Simple) — AC-11 branch-canary folded in
  next · ▸ /plan-3   architect — consumes backpressure-coverage.md

 ⚙ engineering harness
  now  · post-spec seam — running the backpressure survey
  next · writes backpressure-coverage.md → hands control back to /plan-3
```

- **Anchor placement**: the `└─` sits in the `◐` milestone's column — with the standard prefix `[the-flow]  ` (12 chars) and 2 chars per node, that's column 12 + 2 × (index of `◐`). No `◐` (settled between stages) → anchor under the last `◆`. Column uncertain (e.g. bracket-grouped phase nodes) → a fixed 4-space indent is fine; the anchor is a garnish — never let alignment delay the turn.
- **The anchored line’s shape is fixed**: `└─ ⚙ <all five pips> ↺  <legend with [current]>  (<seam>)`. **Never compress the pips** (no `⚙ ◆ ↺` shorthand) and never swap the legend for prose — narrative belongs in the ` ⚙ engineering harness` `now`/`next` group below. The trailing note is just the seam in parentheses — `(post-spec)`, `(pre-implement)`, `(phase-end)`; the legend’s brackets already name the stage.
- **Two flows, two voices — never merged, each under its own header**: every `now`/`next` group opens with a one-line header naming the flow — ` the-flow` for the SDD voice, ` ⚙ engineering harness` for the loop voice — with the `now`/`next` lines indented one space beneath it (the header owns identity, so the lines themselves carry no prefix). The flow's lines speak SDD position (where the plan is, what command comes next); the harness's speak loop position (what the router is running, what it produces, where control hands back). Each gives the user real context on its own lines.
- **Never invent the `the-flow` line**: read position from its state file + the newest artifact. State unreadable or stale → fall back to the solo rail.
- Mid-adoption with an active `the-flow`: same shape, the anchored line carries the 🧰 segment instead — `└─ 🧰 ◆─◆─◐─◇─◇ → ⚙ ◇─◇─◇─◇─◇ ↺  install · scout · [governance] · inject · boot  (adopting)`.

### 2. The per-turn narration contract — Orient → Flag → Insight → Suggest → Invite

Every turn follows the same five beats (one decision per turn, a recommended default + an "if unsure" path):

| Beat | What it does | Example (engineering, post-spec) |
|---|---|---|
| **Orient** | one line: which zone + stage, from the rail | "Adoption's done — you're in the engineering loop, just past the spec." |
| **Flag** ⚠️ | surface must-see items the user might've missed (see beat 3) — *confirming, never nagging*; **silent when clean** | "⚠️ Boot flagged `no smoke path declared` — worth knowing before we lean on it." |
| **Insight + why** | one *real* detail, tied to why the stage matters — the shape is *"Did you notice `<detail>`? That matters because `<this stage's line from the why table>`"* | "9 of 11 criteria are already provable by existing sensors — that matters because this is the whole game: moving proof from inference into the deterministic layer, where it's runnable and free to re-check forever." |
| **Suggest** | print the **one** next command in a copyable block | `eng-harness-2-backpressure` |
| **Invite** | offer to run it; recommend the default, never force | "Want me to run it? (`yes` / run it yourself — either way I'll pick up from here.)" |

This is the same **print-then-offer** posture as `the-flow`: always show the command first (copyable anywhere), then offer to run it; **one step per turn**; **never anything irreversible without explicit go-ahead**.

### 2a. The why table — what each stage is *for*

The teach-half of the Insight beat is drawn from this fixed table (never invented), fused with one **real** detail from the routed artifact. One line max, pitched at someone meeting the loop for the first time. **Skip the teach-half when the user clearly knows the loop** — a returning operator, or a stage already taught this session — confirming, never lecturing. The detail half is still subject to the no-fabrication rule: read the artifact, quote what's there.

| Stage | Why it matters (the thesis link) |
|---|---|
| S0 · Install | the deterministic layer gets a **front door** — one discoverable place (`--help`, `doctor`) instead of diffuse scripts and tribal knowledge |
| S1 · Scout | measures the **proof ceiling** — how much of this repo can be *proven* today vs eyeballed |
| S2 · Governance | the contract that makes the layer **tangible** — what boots it, what proves it, where evidence lands |
| S3 · Inject | wires the harness into the flow you already run, so usage is **structural, not remembered** — it survives every cold agent start |
| S4 · Build boot | the first proof — the environment runs **before** any work starts |
| Boot (loop) | orientation by **evidence, not memory** — prove the system runs before you touch it |
| Backpressure | moves proof from **inference to determinism** before you build — what can the repo *prove* about this work, and what would still be eyeballed? |
| Observe | friction is **usability research** on the engineering environment — one line now, a candidate fix later |
| Retro | "what did you have to infer that the harness should have proved?" — every answer names a **missing command** |
| Improve | the compounding move — **improve = encode the fix**: inferred knowledge becomes a runnable part of the deterministic layer, and the next session starts smarter |

### 3. The Flag beat — "just making sure you saw this"

Distinct from the single Insight (curiosity), the Flag beat surfaces the **decision-relevant must-sees** the user can't afford to miss (safety). Rules, lifted in spirit from `the-flow`:

- **Lift, never derive** — quote the routed artifact's own alarm fields (a degraded `doctor` reason, a Critical/High harnessability gap, an `UNAVAILABLE`/failed/SLOW boot, ABSENT/BUILDABLE sensors, a recommended Phase 0, pending retro entries). Never invented.
- **Cap it** — a few max; this is a highlight, not a dump.
- **Silent when clean** — nothing flagged → one line ("nothing flagged — clean") or skip the beat entirely. No manufactured alarms.
- **Never a gate** — "just making sure you saw" — the user acts on it or waves past. It never blocks the next step.

| Stage | Scan for / flag (quote any hits) |
|---|---|
| Install / `doctor` | degraded or failed `doctor` reasons (read the JSON envelope, not prose) |
| Scout (harnessability) | Critical/High gaps — low proof ceiling, missing back-pressure surfaces, external-dependency exposure |
| Governance | doc absent, or stamped-but-empty (no boot command yet) — boot reports `UNAVAILABLE` until `harness init` runs and S4 builds boot |
| Inject | no injection point recorded yet (so the parent flow won't know where to call back) |
| Build + run boot | `UNAVAILABLE`, a **failed/SLOW** boot, or a signal-readiness dimension reported "not declared" |
| Backpressure | **ABSENT / BUILDABLE** sensors (the eyeball-gaps); a recommended **Phase 0** |
| Retro drain | the `[s/t/p/e/d/a]` prompt the user just saw; N entries pending |
| Retro harvest | clustered/stale friction across the plan; unencoded magic-wands |
| Ambiguous | the candidate plans found (so the user can pick) |

### 4. Tone — make it pleasant

- **Warm and confirming**, never bureaucratic. "Nice — boot's green, you're ready to code" beats "S4 precondition satisfied."
- **One decision per turn.** Never dump the whole tree; surface the single next move + a couple of alternates.
- **Celebrate the bridge.** When adoption finishes and boot first runs, say so — "🎉 boot's working — that's the harness alive; let's try it on real work." (the "shiny new harness" moment).
- **Never nag.** A skipped optional is offered at most once per call and waved past freely; flags are "just making sure you saw," never blockers.

---

## Called repeatedly along an externally-managed flow

The router is designed to be **invoked again and again** by a parent running its *own* flow (`the-flow`, a human, a CI agent). The seams where the parent calls the router are exactly the **injection points** adoption step S3 mapped and recorded in the governance doc's `## Injection map` — `the-flow` is one host implementation of this contract, not the contract itself; any SDD or dev flow plugs in the same way. Each call is a fresh, stateless detection; the router holds no memory between calls. A parent passes a light hint at each seam and the router returns the right harness action:

```
P → H: session start    (--event session-start)            → eng-harness-1-boot --validate
P → H: pre-implement     (--event pre-implement --phase <p>) → eng-harness-1-boot --validate   (--hook pre-flight)
P → H: post-spec         (--event post-spec --spec <path>)   → eng-harness-2-backpressure
P → H: task-pause        (--event task-pause)                → harness observe                 (--hook coding, silent)
P → H: end-of-phase      (--event phase-end --plan-dir <p>)  → eng-harness-4-retro --drain   (buffer non-empty)
P → H: plan-complete     (--event plan-complete)             → eng-harness-4-retro --harvest (buffer now empty)
```

Each seam aliases onto a lifecycle hook — `session-start`/`pre-implement` → `pre-flight`, `post-spec` → `pre-coding`, `task-pause` → `coding`, `phase-end` → `post-coding`, `plan-complete` → `post-flight` (§ Lifecycle hooks).

This is the inversion of `the-flow`'s hard-coded harness cues: instead of a parent hard-coding *which* harness skill to mention at each seam, it can simply call `/eng-harness-flow --hook <name>` (or the `--event <seam>` alias) and let this skill own the harness-routing logic in **one** place. (Refactoring `the-flow` to do so is a follow-up, not a dependency.)

---

## Relationship to existing skills (anti-reinvention)

- **`eng-harness-0-adopt`** already *is* a flow (install → assess → inject → basic boot). This router does **not** duplicate it — when any adoption rung is incomplete it **delegates** to adopt. The adopt skill *drives* the establishment of the harness (it installs, scouts, weaves the injection map, helps author boot); the governance doc itself is stamped by the `harness init` CLI writer (seeded empty), which adopt calls. The router owns "which adoption rung is still missing, or are we past adoption and into engineering?"
- **`the-flow`** owns the **SDD** journey (stateful) and already narrates harness cues. Clean separation: `the-flow` = pipeline guide; `eng-harness-flow` = loop router (stateless).
- **The loop skills** (`eng-harness-1-boot`, `-2-backpressure`, `-4-retro` — the last carrying the whole friction lifecycle, with in-flight capture as the `harness observe` CLI verb) stay exactly as they are — the router only chooses *which* to surface and *when*.

## References

- [`references/getting-started.md`](./references/getting-started.md) — the visual guide to the whole skill family: the two-zone big picture, who pulls each trigger, a worked walkthrough, quick reference, and the `.harness/` directory map. The on-ramp for anyone new to the loop.
- [`references/governance-doc.md`](./references/governance-doc.md) — what the governance doc (`​.harness/engineering-harness.md`) contains, the `harness-change` record ledger semantics, and the write conditions.
- [`references/maturity-assessment.md`](./references/maturity-assessment.md) — the canonical L0–L4 maturity ladder and how to assess which rung a harness sits on.
