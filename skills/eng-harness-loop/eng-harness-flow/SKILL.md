---
name: eng-harness-flow
description: |
  Stateless harness-loop router — the harness-loop analogue of `the-flow` (which guides the SDD pipeline). On every invocation it re-derives where the work sits on the loop from deterministic repo signals (A–J) + conversation + an optional parent hint, then routes to the SINGLE correct harness skill. Unlike `the-flow` it is STATELESS: it writes no state file, owns no artifacts, and re-detects position every call — so it is safe to call any number of times, from any caller (a human, `the-flow`, a CI agent), at any cadence. It enforces a 🧰 setup gate (install → scout → governance → inject → build+run boot LAST) before crossing into the ⚙️ engineering zone (boot → backpressure → observe → retro-drain → retro-harvest → improve), honours a light parameter contract (`at=` / `--event` / `--plan-dir` / `--spec` / `--phase` / `--prompt-optional` / `--json`), resolves hint-vs-signal conflicts via a `route`/`redirect`/`noop`/`ambiguous` matrix, and gives the same pleasant per-turn UX (two-zone rail · now/next · Flag beat · Orient→Flag→Insight→Suggest→Invite). It never gates/scores/blocks, never runs `minih` or `/compact`, and never invents a health verdict (that is `harness doctor`'s job). The governance WRITER (`harness init`) is deferred to a later plan; until it ships the router degrades gracefully to the 🧰 setup track / `UNAVAILABLE` when no governance doc exists.
---
# eng-harness-flow

The **front door** to the harness loop. `the-flow` does this for the **SDD pipeline** (a linear journey: spec → plan → tasks → code → review → merge). `eng-harness-flow` does it for the **harness loop** (a *cycle* re-entered wherever the work is: Boot → Backpressure → Observe → Retro → Improve → Boot). On each call it figures out *where on the loop you are* and hands back the **one right harness command** — whether you are on an empty repo (set it up), a full repo with no harness (set it up), or mid-plan in a healthy harness (boot / backpressure / retro).

> **Stateless by design.** Unlike `the-flow`, this skill **stores nothing** — no state file, no `.json`/`.md` journey, no artifacts of its own. The harness loop has no single journey to checkpoint; *its* position is already observable in deterministic substrate (`harness doctor`, the governance doc, a harnessability report, plan-dir artifacts, the retro buffer). The router **re-derives** position every call from those signals, which is more robust than a parallel state file that can drift — and "prefer deterministic observation over remembered state" is itself a harness principle. The moment the router would need to *remember* something across calls, that something belongs in substrate a child skill owns — not here.

---

## The stateless contract (read this first)

`eng-harness-flow` is a **pure dispatcher**: `(repo signals, conversation, optional hint) → next harness action`. It:

- ❌ **Writes no artifacts of its own** — no state file, no flight-plan `.json`/`.md`, no journey log. Child skills own *their* artifacts (the harnessability report, `backpressure-coverage.md`, the retro buffers, `.retro.md`).
- ❌ **Never gates, scores, or blocks** — every route is a *suggestion*; `at=` is a hint, never a command; the setup gate *informs* but never forces. There is **no `.disabled` sentinel** for the loop — declining the harness is **conversational** (the user says so and the agent stops calling the loop skills), not a file.
- ❌ **Never runs `minih`** (companions are owned by the plan-6 companion skill) and **never runs `/compact`** (a user-typed CLI built-in — it can only *recommend* it).
- ❌ **Never invents a verdict** — "is the harness healthy?" is answered by `harness doctor` (the JSON envelope), not by the router's opinion.
- ✅ **Reads** repo signals + conversation, **routes** to exactly one harness skill (with a one-line *why*, the artifact it produces, and a `next_suggested`), optionally **runs it on an explicit go-ahead** (one step, never irreversible), and is **safe to call any number of times**.
- ✅ **Re-derives every call.** Re-entry after `/compact` needs nothing reloaded — just re-detect. The rail itself is recomputed from substrate each call (never persisted).

> **The unifying rule:** state that must persist lives in deterministic substrate a child skill owns (reports, buffers, `.retro.md`, the governance doc) — **never in this router**. If a need for router-owned memory ever appears, that is a signal the missing state belongs in substrate, not in `eng-harness-flow`.

---

## The two zones — 🧰 setup gate, then ⚙️ engineering loop

Two grouped concepts, kept separate:

- **🧰 Harness setup & installation** — the one-time *process* (`eng-harness-0-setup`) that *establishes* the substrate: install, scout, a **working boot command + governance**, and the injection point. **Boot is built LAST** in setup, deliberately, so the moment it's built you *run* it and flow straight into the dev loop ("build boot, run boot, then try the shiny new harness").
- **⚙️ Engineering flows** — the repeated ready-for-coding loop that *runs* it. Its first step **re-runs** the boot that setup built; it never *creates* boot.

The router doesn't sit *inside* either zone — it sits *beside* them and points the caller at the right step. A single "harness functional?" gate is **not** enough to enter the engineering loop: the 🧰 setup process must have *established* the substrate, in order, ending with boot. The router walks the rungs and routes the **first missing one** to the setup step that owns it — though provisioning the governance/boot rungs is the deferred `harness init` writer's job (see *owed, not provisioned* below), so for those the router routes/attempts rather than claiming setup provisions them now.

### The 🧰 setup gate (in order; boot LAST)

| Rung | What setup must have established | Read via signals | Required? | If missing → route to |
|---|---|---|---|---|
| **S0 · Install** | CLI present + `harness doctor` healthy | A · B | **required** | `eng-harness-0-setup` (install) |
| **S1 · Scout** | a harnessability report exists | F | *skippable* | `eng-harness-0-harnessability-assessment` |
| **S2 · Governance** | governance doc (BIO contract) + `docs/harness/` ledger | D · E | **required** | provision governance — *owed, not provisioned* (see below) |
| **S3 · Inject** | a recorded injection point for `eng-harness-flow` in the user's existing flow | conversation / a noted decision | *advisory* | `eng-harness-0-setup` (inject step) |
| **S4 · Build + run boot (LAST)** | a **working boot command** (authored, recorded into governance, **and run once**) | C | **required** | `eng-harness-0-add-extension` (author boot, validate it boots) |
| **E1 · Re-run boot** | — (an **action**, not a presence-check) | — | — | **re-run** the boot setup built — `eng-harness-1-boot --validate` (per coding session) |

- **Required rungs** (S0 install, S2 governance, S4 built boot) hard-gate the engineering zone: without governance + a working boot the loop skills report `UNAVAILABLE`/no-op, so the router **stays on the 🧰 setup track**. The router routes the **first** missing required rung with a one-line *why*.
- **Skippable / advisory rungs** (S1 scout, S3 inject) are **offered, never blocking**. Because the router is stateless, a skip is *re-offered next call* unless the child artifact exists or the parent passes `--prompt-optional=false`.
- **Inject (S3) comes before boot (S4)** so that the instant boot works, the user already knows where `eng-harness-flow` plugs into their flow and can dive straight into real work.

> **Owed, not provisioned (honesty about the deferred writer).** The governance doc *writer* — provisioning `.harness/engineering-harness.md` + a working boot at inception via a deterministic `harness init` CLI command — is **deferred to a later plan**. So for S2 (governance) and S3 (inject) the router says the rung is **owed** and routes to `eng-harness-0-setup` / an attempted `npx harness init` — it must **not** claim setup unconditionally "provisions" governance. If the installed CLI doesn't yet support it, the router reports `UNAVAILABLE` and stays on the setup track (nothing errors). See `references/governance-doc.md` for what the doc contains and when it's written.

### The ⚙️ engineering dispatch (only once S0 + S2 + S4 hold)

Once the required setup rungs hold, the router crosses into the loop and dispatches by *where in the work* the caller is:

| Where in the work (signals H · I / `--event`) | Route to | Produces |
|---|---|---|
| session start / unknown | `eng-harness-1-boot --validate` (re-run the boot setup built) | a boot verdict (healthy / SLOW / UNHEALTHY / UNAVAILABLE) |
| spec done, pre-architect | `eng-harness-2-backpressure` | `backpressure-coverage.md` |
| mid-build (doing work) | `eng-harness-3-observe` *(silent — only with a payload; otherwise guidance only)* | one ledger entry per call |
| phase / session end · **buffer non-empty** | `eng-harness-4-retro --drain` | buffer drained → `.retro.md` (`next_suggested: --harvest`) |
| phase / session / plan end · **buffer empty** | `eng-harness-4-retro --harvest` | curated cross-plan view |
| improvement chosen | route the improvement → retro `[e]ncode` / `eng-harness-0-add-extension` / emit a fix-plan command | the encoded harness change |

- **Drain before harvest.** At phase/session/plan end, if the observe buffer is non-empty the router routes `--drain` *first* (harvest only reads `.retro.md`, so harvesting a non-drained buffer would miss the latest session). One command per call; the parent calls again for harvest.
- **Improve is where the loop compounds.** The loop only *compounds* when a retro leads to an encoded improvement; most loop runs encode nothing and that is fine.
- **Ambiguous, never guessed.** With >1 candidate plan and no `--plan-dir`, the router returns `ambiguous` and **asks** — it does not guess the loop position from conversation alone.

> **This repo is the worked example.** Right now `harness-engineering` has the CLI **and** one extension (`.harness/extensions/validate-harnessability.ts`) but **no governance doc and no working `boot` command** → S0 holds, **S2 fails** (S1 scout is partial — a harnessability *skill* exists but no committed report; S3 inject + S4 boot are still owed). The router routes to `eng-harness-0-setup` to **establish governance** (owed), then inject, then **build + run boot last**. The repo is still in 🧰; it has not reached the ⚙️ re-run-boot step.

---

## Detection signals A–J

The router decides purely from signals it can **read** (no state of its own). This is the catalog; the decision order below applies them (hint first, then the setup gate, then the engineering dispatch). There is **no `.disabled` opt-out** — opting out is conversational.

| # | Signal | How it's read | Tells us |
|---|---|---|---|
| A | **Harness CLI present** | `harness --version` resolves; or `.harness/` dir exists; or a `package.json`/`npx` target is present | Is there a harness at all? |
| B | **CLI healthy** | `harness doctor` **JSON envelope** read by `exit_code`/`status` field (not prose — the CLI loading and returning an envelope is the signal; a consumer repo can still show *degraded* on individual layers, but `cli-build` is `ok`/n/a there since FX001) | Does the CLI itself load/run? |
| C | **Working boot command** | a `boot` verb/recipe exists (`.harness/extensions/boot.*`, a `justfile`/`package.json` boot, or governance declares it) **and** boots cleanly | Did setup establish a boot we can run? |
| D | **Governance doc** | `.harness/engineering-harness.md` (canonical) → legacy `docs/project-rules/engineering-harness.md` → `agent-harness.md` → `harness.md` | Is the Boot/Interact/Observe contract present? (Boot needs this or it reports `UNAVAILABLE`) |
| E | **Loop substrate** | `.harness/temp/` (gitignored observe scratch) + `.harness/records/retro/` (committed retro records, created via `harness record retro`) — legacy `docs/harness/agents/` retros are still read by harvest for back-compat | Can Observe/Retro actually record anything? |
| F | **Harnessability report** | any report under `.harness/reports/harnessability/` (path inconsistency noted — see "limits"; the router detects *any* report present) | Has the repo been sized up? |
| G | **Repo shape** | source tree empty vs. has source (e.g. `src/`, `package.json`, a language toolchain) | Fresh on-ramp vs. adopt-existing |
| H | **In-a-plan position** | `docs/plans/*/` artifacts: `*-spec.md` (post-spec), `*-plan.md` (post-architect), `tasks/phase-*/` + `execution.log.md` (mid-build), `reviews/` (reviewed) | Which loop stage the work is at *(best-effort — see "limits")* |
| I | **Conversation history** | the live session (what the parent just did/said) | Disambiguates G/H when files are inconclusive |
| J | **Parent hint (params)** | `at=<stage>` / `--event` / `--plan-dir` / `--spec` / `--phase` (see § Parameter contract) | Lets the parent pin position and skip detection |

### Decision order

1. **Parent hint first (J).** An explicit `at=`/`--event` is honoured **only if its precondition holds** (validated by the setup gate + the conflict matrix). Otherwise the router **redirects** to the setup step that owns the missing rung and says why — it never blindly runs the named stage when signals contradict it. (For the governance/boot rungs, "owns" means routes-or-attempts the deferred `harness init` writer, not "provisions now" — see *owed, not provisioned*.)
2. **Then the 🧰 setup gate** (S0 → S1 → S2 → S3 → **S4 boot last**). Route the first missing **required** rung (S0, S2, S4); *offer* the skippable rungs (S1, S3) without blocking.
3. **Then the ⚙️ engineering dispatch** (the table above), keyed on `--event` / signals H · I, with drain-before-harvest and ambiguous-not-guessed.

### Where statelessness has limits (and who absorbs them)

1. **Skipped optionals re-offer.** With no memory, a declined scout/backpressure offer comes back next call. **Absorbed by**: the parent (skip-suppression via `--prompt-optional=false`) and by treating the **child artifact** as the only durable "done" signal.
2. **In-plan position is inferred, not known.** Plan-dir artifacts are ambiguous in real repos (multiple plans, stale phases, post-`/compact` context loss). **Absorbed by**: the parent pinning `--plan-dir`/`--spec`/`--phase`/`--event`; when unpinned and ambiguous the router returns `ambiguous` and **asks**.
3. **Provisioning gaps look like engineering entry.** A repo can pass S0 (CLI installed) yet lack S2 (governance) or S4 (a working, run-once boot), so a naive "functional?" check would route into the engineering zone whose skills then report `UNAVAILABLE`/no-op. **Absorbed by**: the setup gate — the router refuses to enter the ⚙️ engineering dispatch until S0 + S2 + S4 hold.

---

## Parameter contract

The skill works with **no** arguments (full auto-detect), but a parent driving its own flow can **pin** position so detection is never ambiguous.

```
/eng-harness-flow [at=<stage>] [--event <seam>] [--plan-dir <path>] [--spec <path>]
                  [--phase <id>] [--prompt-optional <bool>] [--repo <path>] [--json]

at=auto            (default) detect from signals A–J
at=setup           force the on-ramp (install / finish setup / provision governance — owed)
at=boot            force eng-harness-1-boot --validate
at=backpressure    force eng-harness-2-backpressure (post-spec seam)
at=observe         guidance only; with --entry-* it silently calls eng-harness-3-observe
at=retro-drain     force eng-harness-4-retro --drain (phase/session end)
at=retro-harvest   force eng-harness-4-retro --harvest (plan complete)
at=improve         route a chosen improvement (retro [e]ncode / add-extension / fix-plan)

--event <seam>     session-start | post-spec | pre-implement | task-pause |
                   phase-end | plan-complete   (a higher-level alias for at=)
--plan-dir <path>  pin the plan the loop stage refers to (disambiguates >1 plan)
--spec <path>      pin the spec for backpressure scoping
--phase <id>       pin the phase for boot/retro
--prompt-optional  <bool>  parent owns skip-suppression for optional offers (default true)
--repo <path>      operate on a repo other than cwd (multi-repo callers; reserved for v2)
--json             return the routing decision as a machine-readable envelope
```

- **`at=`/`--event` is a hint, not a command.** The router *validates the precondition* (the setup gate + the conflict matrix below). `at=boot` on a repo with no governance doc politely **redirects** to provisioning and says why; it never blindly runs the named stage when signals contradict it.
- **Observe needs a payload to do anything.** `eng-harness-3-observe` is a *silent producer that logs one entry per call*. So `at=observe` with no payload is **guidance only** ("observe fires silently — here's how friction gets logged"); to actually record, the parent passes the observe entry fields and the router calls observe silently.
- **Optional offers don't self-suppress.** Because the router is stateless, a skipped optional (scout, an offered backpressure) is *re-offered next call* unless the parent sets `--prompt-optional=false` or the child artifact now exists. The router treats only **child artifacts** as durable completion — never its own memory.
- **`--repo` is reserved for v2.** Multi-repo execution is documented but not implemented in v1; the router operates on `cwd`.

### Slug resolution (avoid version drift)

Like `the-flow`'s alias table, the router maps friendly stage names → the **exact installed slug at call time** and **never appends a guessed version suffix**. The current map:

| Friendly name | Installed slug |
|---|---|
| `setup` | `eng-harness-0-setup` |
| `assess` | `eng-harness-0-harnessability-assessment` |
| `add-extension` | `eng-harness-0-add-extension` |
| `boot` | `eng-harness-1-boot` |
| `backpressure` | `eng-harness-2-backpressure` |
| `observe` | `eng-harness-3-observe` |
| `retro` | `eng-harness-4-retro` |

If a slug fails to resolve at runtime, **do not guess a suffix** — fall back to printing the bare stage name and point at `skills/eng-harness-*`.

### Precondition / conflict matrix

When a hint conflicts with the detected signals, the router resolves **deterministically** (never guesses, never blindly runs):

| Hint / event | Conflict | `decision` | Router does |
|---|---|---|---|
| `at=boot` | no governance (S2) or boot not built yet (S4) | `redirect` | route to the missing step — provision governance (S2, owed), then build+run boot last (S4); `missing_rung: S2`/`S4` |
| `at=backpressure` | no spec, or >1 spec and no `--spec` | `redirect` / `ambiguous` | ask for `--spec`, or route to `/plan-1b` first |
| `at=retro-drain` | buffer empty | `noop` | "nothing to drain"; suggest `--harvest` if `.retro.md` exist |
| `at=retro-harvest` | buffer non-empty | `redirect` | drain first; `next_suggested: --drain` then `--harvest` |
| `at=setup` | setup already complete | `noop` | "already set up"; suggest `at=boot` |
| `at=auto` | >1 candidate plan, no `--plan-dir` | `ambiguous` | list plans, ask / require `--plan-dir` |

### The `--json` routing envelope

`--json` returns the routing decision as a machine-readable envelope so a parent agent can act without parsing prose (the harness "return prompting" ethos). It carries at least these fields:

```jsonc
{
  "requested_stage": "boot",
  "actual_stage": "setup",
  "decision": "route | redirect | noop | ambiguous",
  "command": "<exact next harness command>",
  "why": "<one line>",
  "produces": "<artifact the routed skill will create, or null>",
  "preconditions_met": false,
  "missing_rung": "S4-build-and-run-boot",
  "next_suggested": "<the command after this one, e.g. --harvest after --drain>",
  "rail":  { "zone": "setup", "setup_pips": "●●◐○○", "loop_pips": "○○○○○", "cursor": "governance" },
  "now":   "<current stage, one line>",
  "next":  "<what follows, one line>",
  "flags": [ "<must-see item lifted verbatim from the artifact>" ],
  "insight": "<one interesting real detail>"
}
```

The `rail`/`now`/`next`/`flags`/`insight` fields carry the UX signals (see § Per-turn UX) so a machine caller can render the same pleasant rail + flag beat a human gets. This matters precisely *because* the router is stateless: the rail, now/next, and flags are all **recomputed from substrate every call** — a pure function of "what the repo looks like right now," which is why the UX survives `/compact`, serves any caller, and never drifts from reality.

---

## Per-turn UX (human mode)

`the-flow` is a *pleasant* experience because every turn shows a **progress rail**, says **where we are** and **what's next**, and **flags anything important the user might have missed** — in a warm, confirming-not-nagging voice. `eng-harness-flow` adopts the same UX. The one adaptation: because the router is **stateless**, the rail is **recomputed from substrate every call** (not read from a saved journey) — but the *feel* is identical.

### 1. The host rail (two zones) — always first, every turn

Every human-mode turn opens with a one-line rail on its own line, then a blank line, then the narration. The rail shows **both zones** with the cursor in the active one. Setup is a finite gate (a fill bar); the engineering loop is a cycle (a position marker with `↺`).

```
[eng-harness-flow] 🧰 ●─●─◐─○─○  →  ⚙️ ○──↺
 now  · establishing governance  (setup 3 of 5)
 next · find your injection point, then build boot
```

Once setup is done, the cursor lives in the loop:

```
[eng-harness-flow] 🧰 ●●●●●  →  ⚙️ Boot ◐ · BP ○ · Obs ○ · Retro ○ · Improve ○ ↺
 now  · running boot — proving the env is healthy before coding
 next · backpressure, once the spec lands
```

- **Glyphs** (tunable, mirroring `the-flow`): `●`/`◆` done · `◐` current · `○`/`◇` not yet · `↺` the loop continues (engineering never "completes" — it cycles).
- **Setup pips** = the 5 setup steps (install · scout · governance · inject · boot). **Engineering pips** = the 5 loop stages (boot · backpressure · observe · retro · improve).
- **Stateless rail**: the fill is *derived from signals each call* (which setup rungs hold; where in the work) — never persisted. Frame it once, early, as *an at-a-glance map, not a saved journey*.
- **Status line** under the pips, in an accent colour: `now · <current>` and `next · <what follows>`. When `next` has ≥2 options, stack them (recommended first), exactly like `the-flow`.

### 2. The per-turn narration contract — Orient → Flag → Insight → Suggest → Invite

Every turn follows the same five beats (one decision per turn, a recommended default + an "if unsure" path):

| Beat | What it does | Example (engineering, post-spec) |
|---|---|---|
| **Orient** | one line: which zone + stage, from the rail | "Setup's done — you're in the engineering loop, just past the spec." |
| **Flag** ⚠️ | surface must-see items the user might've missed (see beat 3) — *confirming, never nagging*; **silent when clean** | "⚠️ Boot flagged `no smoke path declared` — worth knowing before we lean on it." |
| **Insight** | one *interesting*, real detail about the stage or what it produces | "Backpressure writes `backpressure-coverage.md` — it tells you what's *provable* vs eyeballed before you build." |
| **Suggest** | print the **one** next command in a copyable block | `eng-harness-2-backpressure` |
| **Invite** | offer to run it; recommend the default, never force | "Want me to run it? (`yes` / run it yourself — either way I'll pick up from here.)" |

This is the same **print-then-offer** posture as `the-flow`: always show the command first (copyable anywhere), then offer to run it; **one step per turn**; **never anything irreversible without explicit go-ahead**.

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
| Governance | still **owed** — boot will report `UNAVAILABLE` until it exists |
| Inject | no injection point recorded yet (so the parent flow won't know where to call back) |
| Build + run boot | `UNAVAILABLE`, a **failed/SLOW** boot, or a signal-readiness dimension reported "not declared" |
| Backpressure | **ABSENT / BUILDABLE** sensors (the eyeball-gaps); a recommended **Phase 0** |
| Retro drain | the `[s/t/p/e/d/a]` prompt the user just saw; N entries pending |
| Retro harvest | clustered/stale friction across the plan; unencoded magic-wands |
| Ambiguous | the candidate plans found (so the user can pick) |

### 4. Tone — make it pleasant

- **Warm and confirming**, never bureaucratic. "Nice — boot's green, you're ready to code" beats "S4 precondition satisfied."
- **One decision per turn.** Never dump the whole tree; surface the single next move + a couple of alternates.
- **Celebrate the bridge.** When setup finishes and boot first runs, say so — "🎉 boot's working — that's the harness alive; let's try it on real work." (the "shiny new harness" moment).
- **Never nag.** A skipped optional is offered at most once per call and waved past freely; flags are "just making sure you saw," never blockers.

---

## Called repeatedly along an externally-managed flow

The router is designed to be **invoked again and again** by a parent running its *own* flow (`the-flow`, a human, a CI agent). The seams where the parent calls the router are exactly the **injection points** setup step S3 helped identify. Each call is a fresh, stateless detection; the router holds no memory between calls. A parent passes a light hint at each seam and the router returns the right harness action:

```
P → H: session start    (--event session-start)            → eng-harness-1-boot --validate
P → H: post-spec         (--event post-spec --spec <path>)   → eng-harness-2-backpressure
P → H: end-of-phase      (--event phase-end --plan-dir <p>)  → eng-harness-4-retro --drain   (buffer non-empty)
P → H: plan-complete     (--event plan-complete)             → eng-harness-4-retro --harvest (buffer now empty)
```

This is the inversion of `the-flow`'s hard-coded harness cues: instead of a parent hard-coding *which* harness skill to mention at each seam, it can simply call `/eng-harness-flow at=<seam>` and let this skill own the harness-routing logic in **one** place. (Refactoring `the-flow` to do so is a follow-up, not a dependency.)

---

## Relationship to existing skills (anti-reinvention)

- **`eng-harness-0-setup`** already *is* a flow (install → assess → basic boot). This router does **not** duplicate it — when any setup rung is incomplete it **delegates** to setup. Setup *drives* the establishment of the harness (it installs, scouts, helps author boot); the governance doc itself is provisioned by the deferred `harness init` writer — until it ships, setup routes/attempts it and the governance rung stays **owed, not provisioned**. The router owns "which setup rung is owed, or are we past setup and into engineering?"
- **`the-flow`** owns the **SDD** journey (stateful) and already narrates harness cues. Clean separation: `the-flow` = pipeline guide; `eng-harness-flow` = loop router (stateless).
- **The four loop skills** (`eng-harness-1-boot`, `-2-backpressure`, `-3-observe`, `-4-retro`) stay exactly as they are — the router only chooses *which* to surface and *when*.

## References

- [`references/governance-doc.md`](./references/governance-doc.md) — what the governance doc (`​.harness/engineering-harness.md`) contains, the `.harness/history.md` changelog semantics, and the write conditions.
- [`references/maturity-assessment.md`](./references/maturity-assessment.md) — the canonical L0–L4 maturity ladder and how to assess which rung a harness sits on.
