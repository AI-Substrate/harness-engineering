# If we replaced harness telemetry with git-ai — what we gain, what we lose

**Date**: 2026-08-06. **Basis**: `01`–`04` in this folder.
**Caveat**: the attribution-algorithm deep-dive agent was cancelled before
reporting. The algorithm section below is from my own reading of
`specs/git_ai_standard_v3.0.0.md` and `docs/daemon-trace2-ingestion-spec.md`, not a
dedicated review. Labelled **[direct read]** where that matters.

---

## The one-line answer

They are **not the same category of system**. git-ai is a line-attribution product
with a telemetry backend attached. Harness is a process-telemetry system with an
attribution join attached. A straight replacement would trade a large gain in
attribution fidelity for the loss of everything harness measures about *how the
work happened*.

---

## What we would GAIN

### 1. Line-level attribution, stored and durable

The biggest single gain. git-ai records **which lines** each agent session wrote,
as ranges in a git note, and `git ai blame` reads them back as a `git blame`
drop-in. Harness has no per-line record at all — only an aggregate share derived at
read time.

### 2. A measured human signal, and an "untracked" bucket — ⚠️ HEAVILY QUALIFIED

**Corrected 2026-08-06 after `06` landed. The original version of this item was wrong
and credited git-ai with a property it does not have in practice.**

The *design* is three-way: AI / known-human (observed by an IDE extension) /
untracked, and that is genuinely better than harness's residual.

**But the implementation destroys it.** The terminal stage of the post-commit
recovery ladder mints `h_<hash(committer)>` known-human attestations for **all
remaining unknown lines whenever a commit carries no AI attestation**
(`attribution_recovery.rs:661-674`) — and also whenever a mixed commit already
contains one `h_` entry.

Their own spec defines `h_` as lines *"explicitly observed being typed by a human in
an IDE with the git-ai extension installed… distinct from 'untracked'"*. So in any
repo without that extension — ours — **every human commit gets fabricated
known-human attestation, and `unknown_additions` reads 0.** The honest third class is
erased exactly where it would have been most informative, and the note carries no
provenance grade to tell real from manufactured.

**Practical consequence if we adopt**: use git-ai's AI numerator, ignore its human
denominator. Derive untracked ourselves as `git_diff_added − Σ(s_ ranges)`.

Coverage is still *measurable in principle* (`attributed_lines` vs
`diff_added_lines`) — but only if `h_` is discarded first.

### 3. Survival through git rewrites

Notes are migrated across rebase, cherry-pick, squash, stash, reset, amend and
merge, with `original_commit_shas` recorded on the rewrite event. **Harness's join
anchors on `parent(X)`; a rebase changes the parent and the join simply stops
finding the segment.** This is a real, currently-unsolved harness gap.

### 4. Survivorship by construction — ⚠️ PARTLY CORRECTED

**Corrected 2026-08-06. The original claimed "generated-vs-accepted, per line" as a
readable output. Half of that is wrong.**

**What is real, and is a genuine architectural win**: attestation covers only lines
that (a) still carry the AI's author id after every later checkpoint's diff and
(b) fall inside a hunk of the actual commit diff. Code the agent wrote and then
deleted simply *has no line range*. So the gross-churn problem is answered **by
construction rather than estimated** — strictly better than our per-file
`min(agent, git)` clamp, which our own method doc admits does not cancel the bias in
any principled way.

**What is not real**: you cannot *read* the churn ratio out of git-ai.

- The modern note carries **no stats at all** — `SessionRecord` has three fields and
  the spec says it **MUST NOT** contain them. Stats live only in the deprecated
  pre-v1.4.0 `prompts` map.
- At commit level `ai_additions` is assigned **equal to** `ai_accepted`
  (`stats.rs:438-439`, with the comment *"acceptance is always 100%"*). A reader
  cannot distinguish "AI wrote it and it stuck" from "AI wrote 10× and 1× stuck".

Churn survives only in git-ai's local metrics SQLite (`CheckpointValues.lines_added`,
per file per checkpoint). So computing the ratio means **joining that DB against the
note** — architecturally the same join we already do. git-ai's real edge is not that
it avoids the join; it is that the *denominator side* (which specific lines survived)
is proven per-line instead of inferred from `numstat` totals.

`overriden_lines` and `LineAttribution.overrode` are real, but likewise absent from
the modern note.

### 5. Bash-written files

Pre/post `lstat` snapshot diff attributes files created or modified by shell
commands. **Harness captures none of this** — it is the first documented blind spot
in `measuring-ai-contribution.md`. git-ai's version is limited (no deletions, repo
root only, 1.5 s walk budget, 50k file cap) but it is more than zero.

### 6. Agent breadth

12 transcript readers, 16 hook presets, 15 installers, 6 cloud platforms
fingerprinted by commit author, and **`agent-v1` — a documented public schema any
third party can integrate against without git-ai shipping code**. Harness has 5
adapters over ~4 products.

### 7. USD cost

`estimated_cost_usd` per session, model and day, with week-over-week spend delta.
Harness has no cost model at all — only `nano_aiu` for Copilot's billing unit. We
capture the token inputs, so this is a small gap to close ourselves.

### 8. Autocomplete attribution

`AiTab` is a distinct checkpoint kind for inline/tab completions. Harness has no
notion of it.

### 9. Maturity signals we do not have

~4,586 test functions, 15-job CI matrix across three OSes, upstream git's own test
suite run against the binary, performance regression gates with enforced margins,
SLSA provenance, notarisation, and `git ai debug` as a genuine end-to-end
self-check.

**Added 2026-08-06 — the attribution fuzzer is the single best evidence artefact in
the comparison.** It maintains an **independent** expected-attribution model that
never reads notes or blame, gives every line a unique Unicode identity from U+4E00,
and asserts **all three classes** after every commit *and* every rewrite. Every find
must become a minimized deterministic regression. We have nothing of this shape, and
it is worth stealing regardless of the adoption decision.

---

## What we would LOSE

### 1. The counts-only guarantee — the biggest loss

Our schema's title is *"counts-only"* and its description says **"NO content fields
ever"**. `user_prompts` is `array<integer>`. A `file` delta is computed "never from
the file text".

git-ai inverts that: raw transcript JSONL verbatim (365 days), full commit bodies,
full bash command text (30 days), and **verbatim full file contents on disk**
including never-committed states. The redactor is entropy-only, caps at depth 32
with a test asserting the leak-through, and **deliberately skips `path`,
`file_path`, `cwd`, `name`** — so `/Users/<realname>/…` travels verbatim by design.

This is not a tunable. It is the architecture.

### 2. The entire process-telemetry layer

Nothing in git-ai corresponds to:

- the **agent-time / human-time / idle-time** split from inter-event gap
  classification (`rollup.ts`)
- **58 allowlisted process counters** — gates pass/fail/na, findings by severity,
  chores done/skipped/todo, dispositions, workshops, phases, CS
- the **18-kind event stream** — flow, flow_log, checks, mark, artifact, skill,
  compaction, api_error
- **artifact semantics** — the closed 11-enum of review/plan/workshop/dossier/…
- tool **bursts** with per-signature shell counts and the closed control-command
  allowlist (`git push`, `git commit`)

git-ai knows *which lines an agent wrote*. It does not know whether a gate passed, a
review found anything, a chore was skipped, or a plan phase completed. **That is
most of what harness telemetry is for.**

### 3. `t_precision` and the honesty discipline

`exact | anchored | interpolated | interval` on every event, plus capability fields
that are **null when unimplemented, never estimated**, plus the `degraded[]` /
`event_skipped:` envelope machinery that FX009 produced. git-ai has no equivalent —
its failures are silent by design (see §4).

### 4. Loud failure

git-ai degrades quietly in three places, all deliberate:

- `checkpoint` **exits 0** on daemon-connect failure — uniquely among its
  subcommands. Agent hooks discard stderr, so **the agent sees success and the
  attribution is silently lost**.
- the commit-path warning is **TTY-only**, so in CI and agent contexts it is
  completely silent.
- the daemon **does not survive reboot** and **refuses to start in agent sandboxes**
  (`CURSOR_SANDBOX`, `CODEX_SANDBOX`, `SANDBOX_RUNTIME`).

Defensible for a product that must never block a commit. **Poor for a measurement
system you intend to make decisions from** — exactly the property FX009 taught us to
care about, where a confident 0.0% was worse than a gap.

### 5. Out-of-tree publication

`refs/harness-telemetry/<date>/<session>` never appears in a working tree, diff,
branch or PR, and has **one writer per ref**. `refs/notes/ai` is a single shared ref
with real merge semantics — hence its fetch-merge-push-retry loop — and it is
**readable by anyone with repo access**, carrying `human_author` as name + email.
Per-person AI ratios become computable by any contractor, auditor or fork holder.

### 6. Fleet / pij identity

`captured_env` carries the eight-key pij snapshot (session, parent, harness, role,
spawn id/model/effort). git-ai's subagent lineage is **Claude and Codex only**, by
two incompatible mechanisms, and **Codex loses it on the hook path**. Everything
else hardcodes `external_parent_session_id: None`.

### 6b. Freedom from a systematic AI-favouring bias — added 2026-08-06

`06` found the bias running in **four independent places**, all fail-open toward AI:

1. **Move detection is disabled entirely for AI checkpoints**
   (`attribution_tracker.rs:580-584`). An agent that relocates a human's 300-line
   function claims all 300 lines. This is the largest systematic over-report vector
   under normal use, and it is deliberate.
2. **Adjacent-edge recovery is asymmetric** — `is_ai_attestation` excludes `h_`, so
   AI attribution spreads to neighbouring unknown lines and human attribution never
   does.
3. **Content gap fill** — an unknown line whose *text* matches any AI-attributed line
   **anywhere in the file** is given to that AI author. Unbounded; a repeated `}`
   triggers it.
4. **Rename carry-forward** force-attests AI lines outside committed hunks "so blame
   doesn't fall back to the git committer", while explicitly excluding `h_`.

Harness's bias runs the other way — every documented blind spot removes lines from
the numerator, pushing measured agent share **down**. Neither is neutral; ours at
least errs toward under-claiming the agent.

### 7. Control of our own collision surface

git-ai's install `git config --global --remove-section trace2` — **the entire
section, no backup, no prompt** — then writes its own `eventTarget`. It re-runs on
every auto-update. If we ever use trace2, the two cannot coexist.

---

## The decisive asymmetries

| | Direction | Note |
|---|---|---|
| Line-level attribution + rewrite survival | **git-ai, decisively** | We have no answer here |
| Bash-written files | **git-ai** | Our #1 documented blind spot |
| ~~Measured human + untracked bucket~~ | **neither** | *Corrected*: theirs is fabricated by recovery, ours is a residual. Both are unmeasured — theirs just looks measured |
| Survivorship (which lines lasted) | **git-ai** | Real and structural — but not readable from the note |
| Freedom from AI-favouring bias | **harness** | See below |
| Content minimisation | **harness, decisively** | Theirs is architectural, not tunable |
| Process/flow telemetry | **harness, decisively** | They have none |
| Failure honesty | **harness** | Theirs is silent by design |
| Agent breadth | **git-ai** | 12 vs 5 |
| Cost | **git-ai** | small gap for us to close |
| Publication model | **harness** | one writer per ref, out of tree |

---

## Recommendation

**Do not replace. The overlap is roughly one field.**

The honest framing is that git-ai answers *"who wrote which line, and did it
survive?"* and harness answers *"what happened during the work, and was it any
good?"*. Only the AI-share number sits in both.

Three options, in the order I would consider them:

1. **Adopt the standard, not the product.** `authorship/3.0.0` is a published spec
   and notes are plain git objects. We could emit conformant notes from harness
   capture without running their daemon, taking the line-level record and the
   rewrite-migration idea while keeping counts-only publication. This is the
   highest-value, lowest-risk path — and worth costing before anything else.

2. **Steal three specific ideas.**
   - `ai_additions` vs `ai_accepted` per line, to replace our per-file
     `min(agent, git)` clamp
   - a real **untracked** bucket, so human stops being a residual
   - `patch_id`-style content identity, to make the join survive rebase

3. **Run both, scoped.** git-ai on a single opt-in repo for line-level attribution;
   harness everywhere for process telemetry. Costs: a resident daemon, the global
   trace2 seizure, and `human_author` exposure in-repo.

**Blocking questions if option 3 is ever considered**: do we use git trace2
anywhere today, and can we tolerate a measurement system that fails silently by
design?
