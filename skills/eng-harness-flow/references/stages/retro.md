# retro

> Sub-skill — a harness-blind verb module. Knows only its own domain work
> (the `harness observe` / `harness record` CLI, the observe buffer, committed
> retro records, its schema). No sibling names, no flow position, no
> lifecycle-hook self-reference, no routing. Composition is the router's job.

**Verb**: retro
**Purpose**: the whole **friction lifecycle** — *notice → hold safely → present at the seam → route to encoding.* Three surfaces: in-flight capture (silent `harness observe`), `--drain` (session-end soft prompt → committed record), `--harvest` (long-horizon curation of committed records).
**Consumes**: the gitignored observe buffer (`.harness/temp/`); committed retro records (`.harness/records/retro/**`) + legacy paths (`docs/harness/agents/**/*.retro.md`, `docs/retros/*.md`); the bundled [`../retro.schema.json`](../retro.schema.json) for validation.
**Flags**: (no flag) in-flight capture guidance · `--drain` (session end) · `--harvest` (long-horizon) · `--harvest --json` · harvest filters `--plan <slug>` / `--agent <slug>` / `--since <date>` / `--kind <kind>` · `--harvest --prune --older-than <Nd> [--apply]` (reversible stale-retro pruning, dry-run by default).
**Produces**: committed retro records via `harness record retro` (drain); a curated view (harvest — no on-disk writes); staged encode diffs in `scratch/`.
**Side effects**: drain materializes records + clears the buffer; harvest mutates `system.compound.status` in-place on lifecycle ops; `--prune --apply` deletes stale records after one confirmation.

This verb is the whole **friction lifecycle**: *notice → hold safely → present at the seam → route to encoding.* Three surfaces:

| Surface | When | What |
|---|---|---|
| **In-flight capture** | during work, silent | one `harness observe` call per noticing — the CLI does the rest |
| **`--drain`** | session end / logical pause | read pending via `harness observe --list --json`, present a plain-language save prompt (keep all · pick · skip — or take them further: tasks · plan · diffs), materialize kept entries via `harness record retro`, then `harness observe --clear` |
| **`--harvest`** | long-horizon (final debrief, merge end, ad-hoc) | scan committed retros, cluster, prioritize, lifecycle ops |

> **Encode, don't document.** A wiki paragraph that says "remember to do X" is worth nothing; an automated step that does X for you is worth everything. Friction observed during work becomes *executable knowledge* — a justfile recipe, a skill edit, a staged diff — not a prose note that rots. Executable knowledge > prose.

> **Track compounding value.** Every difficulty catalogued is a gift to your future self. The meta-question is never whether one task succeeded; it is whether the development infrastructure gets cheaper, safer, and clearer every iteration.

---

## Procedure

```
$ARGUMENTS
# Surfaces:
# (no flag)   In-flight capture guidance lives in § The two questions / § Capture is one command —
#             there is nothing to "run"; you call `harness observe` directly as you work.
# --drain     Session-end: read pending observations (all buckets), present the soft prompt,
#             materialize saved entries into a committed record via `harness record retro`
# --harvest   Long-horizon: scan + cluster + prioritize committed retro records; print the curated view
# --harvest --json   Machine-readable render (for `just compound-value`, CI hooks)
# Plus --harvest runtime filters: --plan <slug> / --agent <slug> / --since <date> / --kind <kind>
# Plus --harvest --prune --older-than <Nd> [--apply]   Reversible stale-retro pruning (dry-run by default)
```

Always on, no opt-out file — if a user doesn't want capture or a drain, they say so in chat and the calling agent stops.

### The two questions (ask them as you work — this is the strong signal)

Locked wording — ask both, verbatim. They are the headline capture trigger, not item 7 of a checklist:

> **"If you had a magic wand, what one command, flag, output field, fixture, diagnostic, template, sensor, check, or workflow change would make the next run easier, safer, or higher quality?"**

> **"What did you have to infer that the harness should have proved?"**

The second question is the harness thesis pointed at yourself: every place you *inferred* instead of *proved* is a missing sensor — and you (the agent) are paying tokens for that inference every single session until someone encodes it away. A magic-wand wish is a feature request from a real user of the infrastructure. Treat it that way.

**Worked examples** — what an answer looks like as a capture:

1. **The boot dance re-derived.** You spent ten minutes re-discovering how to start the app and prove it's healthy, because nothing wrote it down as a command:

   ```bash
   harness observe "re-derived the boot+healthcheck dance from scratch; no single boot command exists" \
     --kind difficulty --target project-sensor --severity degrading \
     --suggested-encoding "a 'just boot' recipe + harness doctor health layer"
   ```

2. **The architecture rule eyeballed.** You checked dependency direction by reading imports, because no deterministic check exists:

   ```bash
   harness observe "had to eyeball that services don't import adapters directly — no dependency-direction check fails the build" \
     --kind difficulty --target architecture-fitness --severity degrading \
     --workaround "read the imports manually" --suggested-encoding "architecture test or lint rule"
   ```

3. **The endpoint inferred, no smoke path.** You shipped a change to an endpoint whose behavior you could only infer, because there's no smoke route or evidence capture:

   ```bash
   harness observe "inferred the /export endpoint's behavior from code; no smoke path or response fixture proves it" \
     --kind difficulty --target project-sensor --severity degrading \
     --suggested-encoding "smoke command hitting /export with a recorded expected shape"
   ```

Prefer "no smoke/evidence path proved X" over "I was confused" — the former is encodable into deterministic back-pressure. Don't invent new kinds (`signal-gap`, `sensor-gap`): use `kind: difficulty` or `improvement-suggestion` with targets like `project-sensor`, `runtime-inspectability`, `architecture-fitness`, `security`, `schema`, `tooling`, or `harness-itself` — the last for friction with the **harness product** (a `harness …` CLI verb, a SKILL.md instruction, the loop machinery) rather than your own repo. In a consumer repo that class can't be fixed locally; the drain routes it to an **upstream issue** (see § Harness-itself entries).

### Capture is one command

```bash
harness observe "<what you noticed, ≥10 chars>" --kind <kind> \
  [--target <t>] [--severity <s>] [--workaround <w>] [--suggested-encoding <hint>] [--agent <slug>]
```

- **Kinds**: `difficulty | magic-wand | gift | insight | coordination | improvement-suggestion | confusion | win`. **Severities**: `blocking | degrading | annoying` (recommended for difficulties).
- **The CLI owns the mechanics** — buffer path, per-kind sequential IDs (`DL-001`, `MW-001`, …), ISO timestamps, schema validation at write, the full `system.compound` lifecycle block, and the gitignore guarantee (`.harness/temp/` is created self-gitignored on first capture; `harness doctor` checks the protection). You supply no path, no ID, no timestamp.
- **Identity is optional** (provenance, not ceremony): `--agent <slug>` → `HARNESS_AGENT` env → a shared `agent` bucket. Capture never fails on identity. Distinct agents that opt in get distinct buckets, so simultaneous agents never trample each other.
- **Crash-resilient by construction**: the entry is on disk the moment you notice it. After `/compact` or a lost context window, nothing is re-derived — capture again with the same one command; drain finds everything.
- A bad kind/severity/too-short description is rejected with the allowed values named (`unconfigured`, exit 2) and the buffer untouched. The CLI appends, never rewrites: malformed text already in a buffer is skipped (and counted) by every read, never destroyed by a write.

#### When to fire (trigger heuristics)

- A tool call took >30 seconds and you were waiting on it
- A search returned zero results where you expected matches
- You retried the same operation more than once, or backtracked from a wrong assumption
- A test/build failure required guesswork to interpret
- You had to infer runtime behavior with no smoke path, screenshot, log, trace, or health evidence
- You eyeballed an architecture, dependency, security, schema, or data constraint a deterministic check could have proved
- A boot/health-check run reported a missing signal-readiness dimension that affected the work
- You caught yourself muttering "if only there were a…" (the magic-wand reflex)

#### Calibration (soft targets, anti-over-introspection)

- Self-prompt rate: **≤ 1 per 5 minutes** of clock time
- Entries per session: **≤ 5** on average

**Task-boundary heuristic**: at a natural pause (work-unit complete, file written, test passed), check whether you've captured anything yet (`harness observe --list --json` shows the pending set):
- Buffer **empty** → fire the question pair once, pointed at provability. If nothing concrete comes to mind, don't force it.
- Buffer **non-empty** → do NOT additionally prompt; the existing entries are sufficient signal. Ask once per pause, only when otherwise silent.

#### What in-flight capture does NOT do

- **No user-facing output** — not even "logged". The drain at session end is the only user surface.
- **No fix application, no sensor implementation** — entries describe friction; encoding happens at the drain/harvest.
- **No mid-session prompting of the user.**

**Accepted race**: capture during an in-progress drain can land an entry after the drain's read and before its clear — that entry is lost with the clear. Accepted under the per-agent single-session model (the buffer is not file-locked); drains run at session pauses precisely so the window is empty.

---

## Mode: `--drain` (session end)

The consumer-side surface. The ONE place this verb talks to the user.

### When to fire

- **Auto-fired** by host flows at natural logical pauses (session end, work-unit/phase end, plan/journey end).
- **Manually** by the user at any time.
- **Cross-session leftover check**: at the start of any auto-firing run, run `harness observe --list --json` — the sweep covers **all buckets by default**, so entries stranded by a prior session (or another agent's bucket) surface immediately. Non-empty → drain first, then proceed.

### Step 1 — Read the pending set

```bash
harness observe --list --json
# data: { observations: [{bucket, id, kind, description, target?, severity?,
#         workaround?, suggested_encoding?, first_seen_at}], buckets_scanned, malformed_skipped }
```

All buckets by default (`--agent <slug>` narrows). Empty `observations` → **silent, no prompt, exit.** If `malformed_skipped > 0`, say so in the prompt header — deviant text is preserved on disk, and `--clear` removes only valid entries, leaving the deviant blocks in place for manual review.

### Step 2 — Present the save prompt

One prompt at end of session, in **plain language**. **Never asks twice.** Lead with what you noticed, say plainly what saving does, recommend the safe default, and keep the power-user routes one word away. **Never print the raw `[s/t/p/e/d/a]` letter codes** — they are an internal detail, and surfacing them (or guessing what they mean) is exactly the opaque UX this prompt exists to avoid. Format:

Split the closeout into **two decisions, one at a time** — *save the notes* first, and only after that's resolved, *turn them into fixes*. Don't dump storage paths, record jargon, or every action mode into the first prompt.

**Decision 1 — save the notes:**

```
💡 Before we wrap up — here are 3 things I noticed this session that slowed
   us down or weren't proven:

  1. grep on src/ took 47s               → a `just rg` recipe would fix it
  2. searching the tree by hand, again   → a `just rg <pattern>` recipe would help
  3. couldn't tell if the page rendered  → nothing proves it; a smoke check would

Anything we should make easier or more provable next time? For example: a clearer
command, a faster check, a better error, a fixture, a smoke test, or a way to prove
something we had to check by hand — or anything you had to guess because the repo
didn't prove it. (Thought of something? Tell me — it joins the list.)

Save these notes so they're not lost?
  • Enter / "yes"   save all                            (recommended)
  • "pick"          choose which ones to save
  • "skip"          save nothing

  ▮
```

**Decision 2 — turn saved notes into fixes** (offer *after* save/pick/skip resolves, only if anything was saved):

```
Want to turn any saved notes into fixes?
  • "tasks"   copy-pasteable fix-tasks
  • "plan"    a plan spec, for the bigger ones
  • "diffs"   draft patches for you to review
  • "command" a harness command/check — for a repeated proof-gap or recurring manual check
  • leave them for now
```

This offer is **always made, never silently skipped** — the user may decline every route, but dropping the closeout offer is the failure the loop exists to prevent. Lead each entry with the plain description + a one-line "→ what would fix it" hint — the `kind/target` taxonomy stays in the data, never on screen. The plain routes map one-to-one to the actions in Step 3: **yes / Enter** = save all · **pick** = save selected · **skip** = save nothing · **tasks** / **plan** / **diffs** / **command** = the four "take it further" routes.

Offer **"command"** (the harness command/check route, internally the "extension" scaffold) only when at least one pending entry is a **repeated proof-gap** — a friction where you *inferred* what a command could have *proved* (targets `project-sensor` / `runtime-inspectability` / `architecture-fitness` / `security` / `schema`, or any `magic-wand` that names a check / diagnostic / command). That class wants a **first-class, discoverable verb**, not a justfile line that rots unseen (§ the "command" route). When nothing pending fits, omit the route.

### Step 3 — Route by action

#### "yes" / Enter — save all (default)

Wrap the pending entries in one universal retro envelope per bucket (the bucket is the envelope's `agent:`; usually there's exactly one). Never hand-compute the committed path — scaffold it:

```bash
harness record retro --slug "<plan-id-or-session-label>" --json
# → { "status":"ok", "data": { "path": ".harness/records/retro/<YYYY-MM-DD>/<NNN>-<slug>.md", ... } }
```

Write the envelope into the returned **`data.path`** (the CLI owns placement + the never-clobber ordinal):

```yaml
---
schema_version: "1.0"
retro_id: "<ISO>-<agent>-<short-hash>"
agent: <bucket>
plan_id: <plan-id-or-null>
started_at: "<first entry's first_seen_at>"
ended_at: "<now ISO UTC>"
summary: "retro --drain session-end save (N entries)"
entries:
  # ... the drained entries verbatim (id/kind/description/…/system.compound)
system:
  compound:
    bubble_action: "all-save"
---
```

If `harness record` reports `unconfigured` (no `.harness/` here), treat it as UNAVAILABLE and stay silent — the transient entries are preserved for a later drain. Otherwise, once the record is written:

```bash
harness observe --clear
```

#### "pick" — save selected

Prompt "Which entries to save? (e.g. `1,3`, or `all`)". Save the selected ones into the record (same envelope); the rest are dropped with the clear.

#### "tasks" — emit copy-pasteable fix descriptors

For each encodable entry, print a copy-pasteable **fix-task descriptor** (the entry's `description` + `target` + `suggested_encoding`) for the user to route into whatever planning/fix flow they run. Entries are ALSO saved to the record (the suggestion is captured even if the user routes none of them). Clear.

#### "plan" — emit copy-pasteable specs

For each entry suggesting larger work, print a **one-line plan spec** (from `description` + `suggested_encoding`) for the user's planning flow. Entries also saved. Clear.

#### "diffs" — stage patches (nothing auto-applies)

For each entry whose encoding is a small mechanical edit:

1. Generate the diff (best-effort guess at the change)
2. Append the **Validation footer** (mandatory — below)
3. Write to `scratch/encode-<entry-id>-<target-slug>.diff`
4. Print: "Staged scratch/encode-DL-001-tooling.diff — review and `git apply` to land"

Entries are also saved to the record with `system.compound.status: suggested` and `resolved_by: scratch/encode-<id>-<target>.diff`. Clear.

##### Validation footer template (mandatory on every encoded diff)

```markdown
## Validation

Run:
  <command 1>
  <command 2 — optional>

Expected:
  - <observable outcome 1>

Compound lifecycle:
  <entry-id> transitions system.compound.status: suggested → encoded when this diff lands.
  resolved_by: <commit-sha-after-land>
```

`Run:` = best-effort command(s) exercising the change (from `suggested_encoding` when it names one; `(manual review only)` if genuinely unknown). `Expected:` = observable outcomes. The footer makes "encoded" mean *the loop changed AND we can prove it*.

#### "command" — scaffold a harness command/check (internally the "extension" scaffold)

For each **repeated-proof-gap** entry — one you *inferred* what a command could have *proved* (targets `project-sensor` / `runtime-inspectability` / `architecture-fitness` / `security` / `schema`, or a `magic-wand` naming a check / diagnostic / command) — the durable encoding is a **first-class, discoverable verb**, not a one-off recipe. A justfile line is local and undiscoverable; a `harness <verb>` is loadable, self-documenting via `--help`, and found by every future agent — so a recurring inference is paid *once* instead of re-paid in tokens every session.

This route does NOT author the verb itself (that is the router's encode step) — it does for the command/check route exactly what "diffs" does for patches: **emit the ready-to-run scaffold command** for the user to land, and record the intent. Per repeated-proof-gap entry:

1. Derive a verb name (lowercase, hyphenated) + the wrapped command from `description` + `suggested_encoding` when it names a real repo command; else leave the wrap blank for custom logic.
2. Print a copy-pasteable scaffold line (and a one-line sketch of what its `run(ctx)` should prove):

   ```bash
   harness new <verb> --wrap "<command>"   # e.g. harness new ci-smoke --wrap "just ci-smoke"
   harness new <verb>                       # custom-logic stub (fill run(ctx) to prove <X>)
   ```

3. Save the entry to the record with `system.compound.status: suggested` and `resolved_by: harness new <verb>`. Clear.

Entries are saved whether or not the user runs the scaffold (the suggestion is captured regardless). The guided fill-the-handler-and-validate step is the router's to route onward — this route only surfaces that the friction is a **repeated proof-gap** and hands over the exact command.

#### "skip" — save nothing

`harness observe --clear` without saving anything. Print one line: "✓ skipped — 3 notes dropped, nothing saved". Unrecoverable — use sparingly.

#### Harness-itself entries → offer an upstream issue

Some friction is with the **harness product itself** — a confusing or broken `harness …` CLI verb, a wrong/missing SKILL.md instruction, a gap in the harness loop machinery — **not** with the consumer's own repo. You can't encode that fix locally: the CLI and skills are *vendored* from `AI-Substrate/harness-engineering`. The encoding move for this class is **filing it upstream** so the fix lands for every consumer, not just this checkout.

**Detect**: any drained entry with `target: harness-itself`, or whose description/workaround clearly points at a `harness …` command, a vendored SKILL.md instruction, or the loop machinery itself.

**In the harness's own repo** — origin remote contains `harness-engineering`, or `harness/cli/src/` exists locally → **no issue**; the fix is a local source edit, so route it through "diffs" / "tasks" like any other entry.

**Otherwise (a consumer repo)** → after the chosen save action completes, ask **once** (never twice):

```
🔧 N entr{y/ies} point at the harness product itself, not your repo:
   - "<entry.description>"
Open a GitHub issue on AI-Substrate/harness-engineering so the fix lands for everyone? [y/N]: ▮
```

On **`y`**, print a ready-to-run `gh` command per selected entry (pre-filled from the entry fields) and let the user run it:

```bash
gh issue create --repo AI-Substrate/harness-engineering \
  --title "<short imperative title from entry.description>" \
  --body "Reported via the harness retro drain (consumer repo).

**Friction:** <entry.description>
**Kind / target:** <entry.kind> / <entry.target>
**Workaround:** <entry.workaround or 'none'>
**Suggested fix:** <entry.suggested_encoding or 'none'>
**Harness version:** <output of \`harness --version\`, or 'unknown'>"
```

No `gh` installed, or not authenticated → give the **web fallback**: open <https://github.com/AI-Substrate/harness-engineering/issues/new> and paste the same title + body. (Optionally list open issues first with `gh issue list --repo AI-Substrate/harness-engineering` to avoid a duplicate.)

The entry is **still saved to the record** regardless of the answer — the offer never blocks the save. Once the issue exists, its URL is a good `resolved_by:` value at the next `--harvest`. On **`N`**, do nothing extra; the entry waits in the record for a later harvest.

### Step 4 — Plan-ID detection

`frontmatter.plan_id` resolves: (1) cwd matches `docs/plans/<NNN-slug>/` → that slug; (2) else git branch matches `<NNN>-<slug>` → the branch name; (3) else `null`.

### Encoding-hint generation (one line per entry)

1. `entry.suggested_encoding` set → use it verbatim
2. Else derive from kind + target — **escalate sensor-shaped friction to a first-class verb, not a one-off recipe** (check this rung FIRST):
   - `*/project-sensor` · `*/runtime-inspectability` · `*/architecture-fitness` · `*/security` · `*/schema`, or any difficulty whose fix is a **repeatable check / diagnostic / proof** (you *inferred* what a command could have *proved*) → **"scaffold a new `harness <verb>` extension (`harness new <verb>`) — a runnable, discoverable sensor every future agent finds via `--help`"**. This is the encoding move proper: a recurring inference becomes a deterministic verb, not a justfile line that rots undiscovered.
   - `difficulty/tooling` (a one-off shell convenience, *not* a proof) → "wrap in a justfile recipe"
   - `difficulty/skill` → "edit the SKILL.md"
   - `*/harness-itself` → "file an upstream issue on AI-Substrate/harness-engineering (or edit the source if this IS the harness repo)"
   - `magic-wand/*` → "encode as the suggestion above — a `harness <verb>` if it names a check / command / diagnostic, else a recipe or doc"
   - `gift/*` → "no encoding needed" · `insight/*` → "document in AGENTS.md or a docs/how article"
3. Else → "(no encoding hint — review manually)"

### `--drain` edge cases

- **Nothing pending**: silent, no prompt.
- **User interrupts mid-prompt**: nothing was cleared; the next drain sees the same entries.
- **Malformed buffer text**: surfaced as `malformed_skipped` in the list envelope; `--clear` keeps the deviant text in place — point the user at the named buffer file for manual review.
- **No `.harness/` in this repo**: `harness observe --list` itself reports `unconfigured` — stay silent.

### What `--drain` does NOT do

No mid-session prompting · no auto-applying encoded diffs · no editing committed `.retro.md` files after writing them (lifecycle mutations are `--harvest`'s job) · no cross-session aggregation (that's `--harvest`).

### Capture seams — bypass backstop + the `win` beat

Two highly-suggestive, **non-blocking** nudges at the drain seam. Both degrade silently when the harness (or the record type) isn't set up — never gate, never block, never error.

- **Bypass backstop** — if the drain prompt is dismissed, or you clearly hit harness friction this session but captured nothing, suggest recording the non-use *once* (the bypass is itself a signal — "zero bypasses = not measured, not perfect"):

  ```bash
  harness record harness-bypass --slug <slug>
  # cause: missing-command | command-failed | too-slow | unclear-output | no-coverage | policy | agent-could-not
  ```

  Never force it — a declined prompt just means the next drain sees the same state.

- **The `win` beat** — also ask the positive question: *"what worked well — was the harness effective here?"* A yes is a first-class signal, captured like any other observation:

  ```bash
  harness observe "<what worked well>" --kind win
  ```

---

## Mode: `--harvest` (long-horizon)

The reader/curator side. Auto-fires at long-horizon reflection moments; runnable ad-hoc any time.

### When to fire

- **AUTO**: at a host flow's final-phase debrief (the dominant flow), merge end, or review end.
- **SUGGESTED**: at a session/flow start when there are unharvested entries (≥5, or ≥10) — print the invocation as a one-liner, don't auto-fire.
- **Manually**: `--harvest [--plan <slug>] [--agent <slug>] [--since <date>] [--kind <kind>]`.

### Buffer-non-empty advisory

At start, run `harness observe --list --json`. Pending entries anywhere → print one line before scanning:

> ℹ️ Buffer has N unbubbled entries. Consider running `--drain` first so they land in the harvest view.

Then proceed anyway (harvest reads committed records; transient scratch is unrelated).

### Step 1 — Scan + validate

- **Canonical**: `.harness/records/retro/**/*.md` — the records `--drain` materializes (dated subdirs).
- **Legacy (back-compat)**: `docs/harness/agents/**/*.retro.md`, then `docs/retros/*.md` (minih's old per-agent format; skip `*.legacy.md`; map blocks via workshop 005 § D9 `minihToUniversal`).

Per file: parse the YAML frontmatter; validate against the bundled [`../retro.schema.json`](../retro.schema.json) (mirror of the frozen `docs/harness/schemas/retro.schema.json`; neither present → `⚠ retro schema not found — skipping validation`, never block). Invalid → warn with the path, skip the whole retro (no half-parse).

### Step 2 — Dedup, version skew

Same `retro_id` in multiple sources → the highest-precedence copy wins: `.harness/records/retro/` → `docs/harness/agents/**` → `docs/retros/*`. Unknown **major** `schema_version` → `⚠ Skipped 1 retro with unsupported schema_version: <path>`; minor skew is silent.

### Step 3 — Curate

- **Cluster** open entries by `(kind, target)`; count, age-order (oldest `first_seen_at` first), track source agents.
- **Stale flags** (observational, never enforced): `open` > **4 weeks** → stale; `suggested` > **2 weeks** without `resolved_by` → stale.
- **Prioritize top-10**: recurrence (count) → severity (`blocking` > `degrading` > `annoying` > none) → back-pressure leverage (clusters indicating missing proof/sensors/evidence/architecture/security/schema checks stay legible as proof-improvement candidates — display guidance only, no gate, no score, no index) → age.
- **Token-cost framing (the leak detector)**: a recurring cluster is **the same inference being re-paid in tokens every session until someone encodes it** into the environment. Label recurrence with that cost. Display wording only — schema, statuses, and clustering logic are unchanged.
- Recognize proof/back-pressure candidates by targets (`project-sensor`, `runtime-inspectability`, `architecture-fitness`, `security`, `schema`, `infra`, `tooling`), by mentions of smoke/screenshot/log/trace/health/dependency-rule/CodeQL/schema checks, and by workarounds like "read code manually" / "eyeballed". Keep original fields intact; never rewrite kinds. **The remedy for a recurring proof/sensor cluster is a first-class `harness <verb>` extension (`harness new <verb>`)** — a discoverable, runnable sensor — not a one-off recipe; surface that as the encoding for these clusters (the "command" route below).

### Step 4 — Print the view (NO on-disk writes)

```
🌾 Harness retro harvest — 2026-06-10T03:30:00Z

📚 Scanned 27 retros across 3 agents · Date range: 2026-04-10 → 2026-06-10
   Total entries: 47 (28 open, 17 encoded, 2 wontfix)

📊 Open clusters (top 10 by recurrence > severity > back-pressure leverage > age):
   1. [tooling] grep/search slowness — 4 entries across 5 sessions
      ↻ re-paid every session since 2026-05-14 — encode it and stop paying
   2. [proof/project-sensor] missing smoke or visual evidence — 3 entries
   ...

⏰ Stale (>4 weeks open): 3 entries
✅ Recently encoded (last 7 days): 6 entries — see scratch/encode-*.diff

To mark a cluster, say its number plus how it landed:
"done" (encoded) · "won't-fix" · "stale".
```

Nothing is written to disk by the harvest itself (workshop 006 § D4 KISS: no `_LEDGER.md`, no rollups — drift, git noise, and ceremony cost more than a <1s recompute). For raw browsing: `ls .harness/records/retro/` — the record dir IS the browse surface.

#### `--json` (machine-readable, same computed view)

Stable contract (`schema_version` semver, bump on breaking change):

```json
{
  "schema_version": "1.0.0",
  "generated_at": "<ISO>",
  "retros": 27,
  "entries": { "total": 47, "open": 28, "suggested": 2, "encoded": 17,
               "wontfix": 0, "dismissed": 0, "escalated": 0, "stale": 0 },
  "top_clusters": [ { "kind": "difficulty", "target": "tooling", "count": 4,
                      "oldest": "<ISO>", "representative": "<description>" } ],
  "harness": { "maturity": "L2", "last_validation": null, "boot_ms": null, "verdict": null }
}
```

- `entries.*` counts by `system.compound.status` (missing status counts as `open`).
- `top_clusters` capped at 10, same priority order as the default view.
- `harness.maturity` from the governance doc snapshot (`.harness/engineering-harness.md`); `last_validation`/`boot_ms`/`verdict` have no live source under the read-only boot model — `null` whatever the `harness-change` record ledger doesn't supply; no governance doc → all four `null`.
- Empty tree → `{"retros": 0, "entries": {"total": 0, …}, "top_clusters": []}` — still valid JSON.

Consumed by `scripts/compound-value.sh` and `just compound-value`; pipe `--harvest --json | jq …` elsewhere.

### Step 5 — Action menu

The same save routes as the drain (keep all / pick / skip / tasks / plan / diffs / **command** — though saving is usually a no-op here, since these entries are already committed), plus three **lifecycle ops** to mark how a cluster landed. Offer **"command"** for any repeated-proof-gap cluster (§ the drain's "command" route): it emits the `harness new <verb>` scaffold command so a recurring inference becomes a discoverable verb instead of being re-paid in tokens every session. The ops mutate `system.compound.status` IN-PLACE in the source record (file's `schema_version`/`retro_id` untouched; last-write-wins on the rare concurrent harvest):

- **"done"** (it's been encoded) → `status: encoded`; prompt for `resolved_by:` (commit hash / PR URL / diff path)
- **"won't-fix"** → `status: wontfix`
- **"stale"** → `status: stale`

A cluster whose `target` is `harness-itself` (or that clearly points at a `harness …` command / vendored skill) in a **consumer repo** can't be resolved by a local edit — recurrence here is token cost paid every session. Offer the same **upstream issue** as the drain's § Harness-itself entries (`gh issue create --repo AI-Substrate/harness-engineering …`, or the web fallback), framing the cluster `count` as the cost. Once filed, use the issue URL as `resolved_by:` and mark it **done**. In the harness's own repo, route it to a local source fix instead.

### Pruning (`--prune`)

`--harvest --prune --older-than 90d` → **dry-run by default**: list what would be deleted, then print "This is a dry run. Add `--apply` to actually delete (recommend a clean git working tree)." With `--apply` → single confirmation, then delete. Never auto-prunes.

### `--harvest` edge cases

- **Empty tree**: `🌾 No retros found. Capture friction via harness observe during sessions.` and exit.
- **`docs/retros/` absent**: skip the back-compat path, no error.
- **retro_id collision, both canonical**: keep the first, warn.

### What `--harvest` does NOT do

No on-disk index files · no auto-applied diffs · no transient-buffer reads beyond the advisory (drain owns the buffer) · no mid-session firing · no schema expansion · **no proof gates** — it surfaces missing sensors as high-leverage candidates but never blocks a plan, applies a threshold, or declares compliance.

---

## References

- `harness/cli` — the `observe` act (capture/list/clear), `record` act (committed placement), doctor temp-hygiene check; `harness instructions` carries the zero-context briefing
- Workshop 001 — self-improvement vibe (anti-vibe 7 over-introspection; terse one-line hints)
- Workshop 005 — universal retro contract (entry schema; D5 kinds; D6 identity; D9 minih round-trip)
- Workshop 006 — compound folder layout (D4 KISS no-indexes; D6 pruning; D7 minih back-compat)
- [docs/harness-presentations/](https://github.com/AI-Substrate/harness-engineering/tree/main/docs/harness-presentations) + [harness-foundations/simple-mode.md](https://github.com/AI-Substrate/harness-engineering/blob/main/harness-foundations/simple-mode.md) — Rule 2 (encode the fix, not the memory) and Rule 5 (the question pair this verb headlines)

## Exit

Print the output-contract summary (✅: what was produced, where, key fields). Then STOP — do not name a next step or route onward. Routing is the router's job.
