# Workshop: `validate-harnessability` self-test verb (dogfood exemplar)

**Type**: Integration Pattern (verb ↔ minih ↔ skill) with CLI Flow elements
**Plan**: 009-harnessability-survey
**Spec**: [../harnessability-survey-spec.md](../harnessability-survey-spec.md)
**Created**: 2026-06-09
**Status**: Draft

**Value Thesis**: Turns "prove the harnessability-assessment skill works on real repos" from a hand-driven, ad-hoc chore into **one deterministic harness verb** the repo owns — the canonical *exemplar* extension (the repo that builds the harness finally eats its own dog food) and a reusable self-test sensor plan 009 can re-run any time.
**Target Proof Level**: Contract Ready
**Current Proof Level**: Decision Space → Preferred Direction

**Selected Value Axes**:
- **Agent Readiness**: the verb's whole job is to return *prompting* — run IDs + the exact `minih` commands + what to validate — so the calling agent can drive the rest with zero rediscovery.
- **Implementation Readiness**: pins the verb contract, the background-firing mechanism, and the run-ID capture so the `add-extension` skill can build it without guessing.
- **Learning Compounding**: each run produces real magic-wand/difficulty evidence that sharpens v0.2 — the dogfood *is* the feedback loop.
- **Cost / Attention Reduction**: one command replaces "manually clone 3 repos, fire 3 minih runs, remember how to poll each."

**Related Documents**:
- [`research-dossier.md`](../research-dossier.md) (CF-01 path contract, candidate repos)
- Existing exemplar agent: `agents/install-and-validate-test-extension/` (same single-shot + dual-retro shape)
- Verb contract: `harness/cli/docs/authoring-verbs.md`

---

## Purpose

Design a **simple** harness verb — `harness validate-harnessability` — that sets up a throwaway test env (3 cloned repos in `/tmp`), fires a `validate-harnessability-assessment-skill` **minih agent per repo in parallel in the background**, then **returns immediately** with the agent run IDs and machine-readable prompting telling the calling agent how to poll the runs and what to validate when each completes. The verb is the *orchestrator front door*; the minih agent is the *per-repo worker*.

## Fresh Entrant Outcome

A fresh agent should be able to run `harness validate-harnessability`, read the returned Envelope, and **without any other context**:

- know that N background agents are now running, and their **run IDs / run dirs / log paths**;
- know the **exact `minih` commands** to check progress (`status`, `tail`, `last-run`, read `output/report.json`);
- know **what to validate** in each agent's output once it completes (verdict, schema-valid report, spot-checked claims);
- know that the agents **keep running after the verb returns** (fire-and-forget, not blocked).

## Key Questions Addressed

1. What does the verb do, what does it return, and how is the returned **prompting** shaped?
2. How does a verb (whose only exec helper is the *blocking* `ctx.exec`) launch **non-blocking background** minih runs that survive the verb exiting?
3. How does the verb learn each background run's **run ID** to hand back to the caller?
4. What does the `validate-harnessability-assessment-skill` minih agent do?
5. Verb ↔ agent naming, parallelism, cleanup, and error modes.

---

## Overview — the loop in one picture

```
$ harness validate-harnessability
        │
        ▼
┌──────────────────────────────────────────────────────────────────┐
│ 1. SETUP  (blocking, fast)                                         │
│    mkdir -p /tmp/harnessability-selftest-<ts>/                     │
│    for each of 3 repos:  git clone --depth=1 <url> <tmp>/<name>    │
└──────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2. FIRE  (non-blocking — background, parallel)                     │
│    for each clone:                                                 │
│      bash -c 'nohup minih run validate-harnessability-assessment- │
│        skill -p targetRepo=<clone> --skill-source path:skills      │
│        --skill harnessability-assessment > <clone>/run.log 2>&1 &' │
│    → 3 detached minih processes, each running the skill            │
└──────────────────────────────────────────────────────────────────┘
        │
        ▼
┌──────────────────────────────────────────────────────────────────┐
│ 3. RETURN  (immediately — agents keep running)                    │
│    Envelope status: ok                                             │
│    data.runs[]: { repo, runId, runDir, logPath, pid }             │
│    next_action: "3 agents running. Poll with `minih status …`;    │
│      when complete read output/report.json and validate …"        │
└──────────────────────────────────────────────────────────────────┘
        │
        ▼  (calling agent takes over from the prompting)
   minih status / tail …  →  read report.json  →  agent reviews each  →  feeds v0.2
```

The verb never waits for the assessments. **Setup blocks** (clone is fast with `--depth=1`); **fire is fire-and-forget**; **return is instant**.

---

## The verb contract

### Name & shape
- **Verb**: `harness validate-harnessability` — orchestrator.
- **Worker agent (minih)**: `validate-harnessability-assessment-skill` — one run per repo.
- *Custom composite handler* (not `--wrap`): it runs several `ctx.exec` calls and folds the results into one Envelope.

### Options (commander-style)
| Flag | Default | Meaning |
|------|---------|---------|
| `--repo <url>` (repeatable) | the 3 baked-in candidates | Override the target repo list. |
| `--keep` | `false` | Leave the temp clones + run dirs for inspection. |
| `--model <m>` | agent default | Pass-through to `minih run -m`. |

### Steps (`run(ctx)`)
1. **Resolve targets** — `options.repo[]` or the default 3.
2. **Make the test env** — `ctx.exec('mkdir', ['-p', tmpRoot])` where `tmpRoot = /tmp/harnessability-selftest-<iso>`.
3. **Clone each** (blocking, sequential — fast): `ctx.exec('git', ['clone', '--depth=1', url, dest])`. On a clone failure → collect as a per-repo error, continue (don't abort the others).
4. **Fire + capture, one repo at a time** (the runs themselves still go parallel — see mechanism below): for each clone, snapshot the newest run dir → fire the background agent (non-blocking) → immediately resolve *this* run's dir via `minih last-run` (newer-than-snapshot) → record `(repo, runId, runDir, logPath, pid)`. Append to `data.runs[]`.
5. **Return immediately** — `ctx.ok({...})` if all fired (or `ctx.degraded(...)` if some clones/fires/captures failed), with the **prompting** in `next_action`. The detached agents keep running.

### Envelope it returns (the heart)
```json
{
  "command": "validate-harnessability",
  "status": "ok",
  "timestamp": "2026-06-09T00:40:00.000Z",
  "data": {
    "tmpRoot": "/tmp/harnessability-selftest-2026-06-09T00-40-00Z",
    "agentSlug": "validate-harnessability-assessment-skill",
    "runs": [
      { "repo": "osk-data",       "runId": "2026-06-09T00-40-01-123Z-a1b2", "runDir": "agents/validate-harnessability-assessment-skill/runs/2026-06-09T00-40-01-123Z-a1b2", "logPath": "/tmp/.../osk-data/run.log",       "pid": 54321 },
      { "repo": "flowspace",      "runId": "2026-06-09T00-40-01-456Z-c3d4", "runDir": "…/2026-06-09T00-40-01-456Z-c3d4", "logPath": "/tmp/.../flowspace/run.log",      "pid": 54322 },
      { "repo": "hidream-mac-ui", "runId": "2026-06-09T00-40-01-789Z-e5f6", "runDir": "…/2026-06-09T00-40-01-789Z-e5f6", "logPath": "/tmp/.../hidream-mac-ui/run.log", "pid": 54323 }
    ],
    "keepTemp": false
  },
  "next_action": "3 background agents are validating the harnessability-assessment skill (they keep running now that this verb returned). To check progress:\n  • All:    minih status validate-harnessability-assessment-skill\n  • One:    minih tail validate-harnessability-assessment-skill --run <runId>\n  • Newest: minih last-run validate-harnessability-assessment-skill\nWhen a run shows completed, read its report:\n  cat <runDir>/output/report.json\nValidate each report: (1) verdict === PASS; (2) the assessment wrote .harness/reports/harnessability/latest.json AND a <ordinal>-<slug>/ run dir in the clone; (3) report.json validates against skills/harnessability-assessment/templates/assessment-report.schema.json; (4) spot-check 2–3 claims against the real tree (e.g. a 'justfile front door' claim ⇒ a justfile exists). Then review the retrospective's magicWand/difficulties and fold them into plan 009 (v0.2). Clean up: rm -rf <tmpRoot> (skipped if --keep)."
}
```
> **Why this shape**: the `data.runs[]` is the durable handle (run IDs survive the verb exit); the `next_action` is a *runnable script in prose* — the calling agent never has to recall minih syntax or the validation checklist.

---

## Mechanism: backgrounding within the `ctx.exec` contract

`ctx.exec` **awaits** (`Promise<ExecResult>`) and the guardrail says *don't import `node:*` directly*. So we background **inside a shell command** that returns immediately:

```ts
// fire-and-forget: the bash process forks the bg job and returns at once
const r = await ctx.exec('bash', ['-c',
  `nohup minih run ${slug} ` +
  `-p targetRepo=${dest} ` +
  `--skill-source path:skills --skill harnessability-assessment ` +
  `> ${dest}/run.log 2>&1 & echo $!`          // echo the bg PID
]);
const pid = r.stdout.trim();                    // captured immediately
```
- `nohup … &` detaches the minih process; redirecting stdio to `run.log` means it **survives** the harness CLI exiting (the "agents stay running" requirement). ✅
- `echo $!` returns the **background PID** to us via `r.stdout` — `ctx.exec` returns the instant bash forks, so this is non-blocking. ✅
- Run all 3 this way → 3 parallel detached agents. ✅

> **Why not parallelise the `ctx.exec` calls with `Promise.all`?** Each `bash -c` returns in milliseconds anyway (it only forks), so a simple sequential loop is fine and keeps the evidence ordered. The *agents* run in parallel because each is its own detached process — minih's own isolation does the heavy lifting.

---

## Mechanism: capturing each run's run ID

`minih run` creates its run dir synchronously at start (`agents/<slug>/runs/<ISO>-<rand>/`), **but the run record `run.json` does NOT persist the input params** — it stores `slug`/`runId`/`runDir`/`pid`/`status`/`model` only (verified against a real run dir). So you **cannot** map a run back to its repo by reading `run.json`. Capture the mapping at **launch time** by serialising the fire→resolve loop:

For each repo, one at a time:
1. Snapshot the current newest run dir for the slug.
2. Fire the background run (`bash -c 'nohup minih run … > <dest>/run.log 2>&1 & echo $!'`) and capture the PID from stdout.
3. **Immediately** resolve *this* run's dir: poll `minih last-run <slug>` (or scan `agents/<slug>/runs/`) until a dir **newer than the snapshot** appears (cap ~3s). Because the next repo hasn't been fired yet, that new dir is unambiguously **this** repo's run.
4. Record `(repo, runId, runDir, logPath, pid)` *now* — explicit launch-time bookkeeping, not inferred later.

The runs still execute in **parallel** (each is a detached process); only the short fire→resolve step is serialised, and it's fast.

| Option | How | Decision |
|--------|-----|----------|
| **A — launch-serialized capture** | Fire one run, immediately resolve its dir via `minih last-run` / runs-dir-diff (newer-than-snapshot), record `(repo,runId,runDir,pid)` before firing the next. | **Selected** — deterministic repo↔run mapping; no reliance on `run.json` params or stdout format. |
| B — read `run.json` params | Fire all 3, then map `runId ⇄ targetRepo` by reading each `run.json`. | **Rejected** — `run.json` does **not** persist input params (verified). |
| C — parse `minih run` stdout | Capture the run dir minih prints at startup. | Rejected — backgrounded stdout is redirected to the log; format-dependent. |

If a capture times out, record that repo with `runId: null` + its `logPath`/`pid` and **degrade** (don't fail) with a `next_action` pointing at `minih history <slug>` and the per-repo `run.log`. (Belt-and-braces: each run already redirects stdout to its own `<dest>/run.log`, so the log is a per-repo cross-check.)

---

## The minih worker agent: `validate-harnessability-assessment-skill`

Same folder shape as `agents/install-and-validate-test-extension/` (`agent.json`, `prompt.md` w/ frontmatter, `input-schema.json`, `output-schema.json`, `instructions.md`).

- **Param**: `targetRepo` (abs path to the clone). (Optional: `mode=static`.)
- **Permissions**: read-only preset + `shell`/`write` allow; `allowedRoots` extend to `/tmp`,`/private/tmp`,`/var/folders` (+ the clone path). **Network off** — static assessment needs no installs.
- **Steps**: `cd $MINIH_PROJECT_ROOT` → **invoke the `harnessability-assessment` skill** against `targetRepo` → **independently validate** the outputs (don't trust the skill's self-report): report files exist at `.harness/reports/harnessability/` incl. `latest.json`; `report.json` validates against the skill's schema; the two-axis tuple + grade are present; spot-check 2–3 evidence claims against the real tree → **verdict PASS/FAIL** → **dual-layer magic-wand retro** (target = `harnessability-assessment` skill vs `minih`) → write JSON to `$MINIH_OUTPUT_PATH`.
- **Output schema**: `targetRepo`, `assessmentResult` (paths, grades), `validation` (per-check pass/fail), `verdict`, `summary`, `retrospective` (workedWell/confusing/magicWand/magicWandTarget/difficulties).

---

## Error codes

| Code | Status | Cause | next_action |
|------|--------|-------|-------------|
| `E_CLONE` | degraded | one repo failed to clone | report which; continue others; "check the URL / network / visibility" |
| `E_MINIH_MISSING` | error (exit 1) | `minih` not on PATH | "install minih (npm i -g minih) or check PATH" |
| `E_FIRE` | degraded | a background fire returned non-zero | report which repo; others still launched |
| `E_RUNID_TIMEOUT` | degraded | <3 new run dirs appeared in the settle window | return captured runs; point at `minih history <slug>` |
| (all clones fail) | error (exit 1) | nothing to validate | "no repos cloned; check `--repo` URLs" |

> Invariant: never crash. Per the contract, any non-`ok` result carries a required `next_action`.

---

## Decision Space (resolved)

| Decision | Options | Decision |
|----------|---------|----------|
| Isolation | git worktree on local repo · **clone from github** · copy tree | **Clone `--depth=1` from github** (user's call; fully isolated; no writes to any source). |
| Blocking | verb waits for assessments · **fire-and-forget** | **Fire-and-forget** — verb returns instantly, agents keep running (explicit requirement). |
| Parallelism | sequential agents · **parallel bg** | **Parallel** via 3 detached processes; verb's own loop is sequential-but-instant. |
| Who reviews | verb reviews · **agent reviews via prompting** | Verb only **prompts**; the calling agent (and our review subagents) do the reviewing. Keeps the verb simple + deterministic. |
| Naming | one name · **verb=orchestrator, agent=worker** | `validate-harnessability` (verb) fires `validate-harnessability-assessment-skill` (agent). |

## Open Questions

### Q1: What are the 3 clone URLs / org?
**RESOLVED (2026-06-09)** — small, public, cross-language defaults: `https://github.com/chalk/chalk.git` (JS), `https://github.com/BurntSushi/byteorder.git` (Rust), `https://github.com/spf13/pflag.git` (Go). All clone in <2s with `--depth=1`; overridable via repeatable `--repo <url>`. A sparse/manual-IDE repo is a good override for edge-case testing (the defaults are all well-instrumented, so they prove the happy path).

### Q2: Settle strategy for run-ID capture
**RESOLVED (low-risk)** — serialised launch-time capture: after firing each run, poll `minih last-run <slug>` until a dir newer than the pre-fire snapshot appears (e.g. ~6×500ms), then fire the next. Degrade gracefully (record `runId: null` + the per-repo `run.log`) if a single capture times out.

### Q3: Does the verb live in this repo's `.harness/extensions/` only, or also ship as a public example?
**OPEN** — primary intent is the **local dogfood exemplar** (`.harness/extensions/validate-harnessability.ts`). Optionally copy into `harness/cli/examples/extensions/` later as a published exemplar. *Recommend: local-only for now.*

---

## Validation / Acceptance (when this verb is "done")

- `harness new validate-harnessability` (via the `add-extension` skill) creates a loadable extension; `harness doctor` shows it `loaded`; `harness help` lists it.
- `harness validate-harnessability` clones the targets, fires 3 background agents, and **returns in seconds** with `data.runs[]` (3 run IDs) + a `next_action` containing the poll + validate prompting.
- After return, `minih status validate-harnessability-assessment-skill` shows 3 active/affected runs (they survived the verb exit).
- Each completed run's `output/report.json` satisfies the agent's `output-schema.json` and carries a verdict + retrospective.
- `--keep` leaves the temp env; default cleans it up (or the prompting tells the agent to).
- No crash on a bad URL / missing minih — degraded Envelope with a `next_action`.

## Quick Reference

```bash
# run the self-test (fires 3 bg agents, returns run IDs + prompting)
harness validate-harnessability                 # default 3 repos
harness validate-harnessability --repo <urlA> --repo <urlB> --keep
harness validate-harnessability --json          # machine-readable Envelope

# then (from the returned next_action):
minih status   validate-harnessability-assessment-skill          # all runs
minih tail     validate-harnessability-assessment-skill --run <runId>
minih last-run validate-harnessability-assessment-skill
cat <runDir>/output/report.json                                  # validate when complete
```
