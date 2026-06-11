---
name: eng-harness-4-retro
description: |
  The friction lifecycle of the harness loop: notice → hold safely → present at the seam → route to encoding. One skill, three surfaces. IN-FLIGHT CAPTURE is one CLI call — `npx harness observe "<what>" --kind <kind>` — into the gitignored session buffer; the CLI owns paths, IDs, timestamps, and validation, you bring only the noticing. `--drain` (session-end soft prompt) lists pending entries, presents the `[s/t/p/e/d/a]` menu with an encoding hint per entry, materializes saved entries via `harness record retro`, then clears the buffer. `--harvest` (long-horizon curation) scans `.harness/records/retro/**` plus legacy paths, dedups, clusters by kind+target, ages stale entries, and prints a prioritized view (`--json`) where recurrence is framed as token cost. Encode, don't document. Empty buffer = silent. No on-disk index files.
---

# eng-harness-4-retro

One skill, the whole **friction lifecycle**: *notice → hold safely → present at the seam → route to encoding.* Three surfaces:

| Surface | When | What |
|---|---|---|
| **In-flight capture** | during work, silent | one `npx harness observe` call per noticing — the CLI does the rest |
| **`--drain`** | session end / logical pause | read pending via `harness observe --list --json`, soft prompt `[s/t/p/e/d/a]`, materialize via `harness record retro`, then `harness observe --clear` |
| **`--harvest`** | long-horizon (final debrief, merge end, ad-hoc) | scan committed retros, cluster, prioritize, lifecycle ops |

> **Encode, don't document.** A wiki paragraph that says "remember to do X" is worth nothing; an automated step that does X for you is worth everything. Friction observed during work becomes *executable knowledge* — a justfile recipe, a skill edit, a staged diff — not a prose note that rots. Executable knowledge > prose.

> **Track compounding value.** Every difficulty catalogued is a gift to your future self. The meta-question is never whether one task succeeded; it is whether the development infrastructure gets cheaper, safer, and clearer every iteration.

## Input

```
$ARGUMENTS
# Surfaces:
# (no flag)   In-flight capture guidance lives in § The two questions / § Capture is one command —
#             there is nothing to "run"; you call `npx harness observe` directly as you work.
# --drain     Session-end: read pending observations (all buckets), present the soft prompt,
#             materialize saved entries into a committed record via `harness record retro`
# --harvest   Long-horizon: scan + cluster + prioritize committed retro records; print the curated view
# --harvest --json   Machine-readable render (for `just compound-value`, CI hooks)
# Plus --harvest runtime filters: --plan <slug> / --agent <slug> / --since <date> / --kind <kind>
# Plus --harvest --prune --older-than <Nd> [--apply]   Reversible stale-retro pruning (dry-run by default)
```

Always on, no opt-out file — if a user doesn't want capture or a drain, they say so in chat and the calling agent stops.

---

## The two questions (ask them as you work — this is the strong signal)

Locked wording — ask both, verbatim. They are the headline capture trigger, not item 7 of a checklist:

> **"If you had a magic wand, what one command, flag, output field, fixture, diagnostic, template, sensor, check, or workflow change would make the next run easier, safer, or higher quality?"**

> **"What did you have to infer that the harness should have proved?"**

The second question is the harness thesis pointed at yourself: every place you *inferred* instead of *proved* is a missing sensor — and you (the agent) are paying tokens for that inference every single session until someone encodes it away. A magic-wand wish is a feature request from a real user of the infrastructure. Treat it that way.

**Worked examples** — what an answer looks like as a capture:

1. **The boot dance re-derived.** You spent ten minutes re-discovering how to start the app and prove it's healthy, because nothing wrote it down as a command:

   ```bash
   npx harness observe "re-derived the boot+healthcheck dance from scratch; no single boot command exists" \
     --kind difficulty --target project-sensor --severity degrading \
     --suggested-encoding "a 'just boot' recipe + harness doctor health layer"
   ```

2. **The architecture rule eyeballed.** You checked dependency direction by reading imports, because no deterministic check exists:

   ```bash
   npx harness observe "had to eyeball that services don't import adapters directly — no dependency-direction check fails the build" \
     --kind difficulty --target architecture-fitness --severity degrading \
     --workaround "read the imports manually" --suggested-encoding "architecture test or lint rule"
   ```

3. **The endpoint inferred, no smoke path.** You shipped a change to an endpoint whose behavior you could only infer, because there's no smoke route or evidence capture:

   ```bash
   npx harness observe "inferred the /export endpoint's behavior from code; no smoke path or response fixture proves it" \
     --kind difficulty --target project-sensor --severity degrading \
     --suggested-encoding "smoke command hitting /export with a recorded expected shape"
   ```

Prefer "no smoke/evidence path proved X" over "I was confused" — the former is encodable into deterministic back-pressure. Don't invent new kinds (`signal-gap`, `sensor-gap`): use `kind: difficulty` or `improvement-suggestion` with targets like `project-sensor`, `runtime-inspectability`, `architecture-fitness`, `security`, `schema`, `tooling`.

## Capture is one command

```bash
npx harness observe "<what you noticed, ≥10 chars>" --kind <kind> \
  [--target <t>] [--severity <s>] [--workaround <w>] [--suggested-encoding <hint>] [--agent <slug>]
```

- **Kinds**: `difficulty | magic-wand | gift | insight | coordination | improvement-suggestion | confusion`. **Severities**: `blocking | degrading | annoying` (recommended for difficulties).
- **The CLI owns the mechanics** — buffer path, per-kind sequential IDs (`DL-001`, `MW-001`, …), ISO timestamps, schema validation at write, the full `system.compound` lifecycle block, and the gitignore guarantee (`.harness/temp/` is created self-gitignored on first capture; `harness doctor` checks the protection). You supply no path, no ID, no timestamp.
- **Identity is optional** (provenance, not ceremony): `--agent <slug>` → `HARNESS_AGENT` env → a shared `agent` bucket. Capture never fails on identity. Distinct agents that opt in get distinct buckets, so simultaneous agents never trample each other.
- **Crash-resilient by construction**: the entry is on disk the moment you notice it. After `/compact` or a lost context window, nothing is re-derived — capture again with the same one command; drain finds everything.
- A bad kind/severity/too-short description is rejected with the allowed values named (`unconfigured`, exit 2) and the buffer untouched. The CLI appends, never rewrites: malformed text already in a buffer is skipped (and counted) by every read, never destroyed by a write.

### When to fire (trigger heuristics)

- A tool call took >30 seconds and you were waiting on it
- A search returned zero results where you expected matches
- You retried the same operation more than once, or backtracked from a wrong assumption
- A test/build failure required guesswork to interpret
- You had to infer runtime behavior with no smoke path, screenshot, log, trace, or health evidence
- You eyeballed an architecture, dependency, security, schema, or data constraint a deterministic check could have proved
- Boot reported a missing signal-readiness dimension that affected the work
- You caught yourself muttering "if only there were a…" (the magic-wand reflex)

### Calibration (soft targets, anti-over-introspection)

- Self-prompt rate: **≤ 1 per 5 minutes** of clock time
- Entries per session: **≤ 5** on average

**Task-boundary heuristic**: at a natural pause (phase complete, file written, test passed), check whether you've captured anything yet (`harness observe --list --json` shows the pending set):
- Buffer **empty** → fire the question pair once, pointed at provability. If nothing concrete comes to mind, don't force it.
- Buffer **non-empty** → do NOT additionally prompt; the existing entries are sufficient signal. Ask once per pause, only when otherwise silent.

### What in-flight capture does NOT do

- **No user-facing output** — not even "logged". The drain at session end is the only user surface.
- **No fix application, no sensor implementation** — entries describe friction; encoding happens at the drain/harvest.
- **No mid-session prompting of the user.**

**Accepted race**: capture during an in-progress drain can land an entry after the drain's read and before its clear — that entry is lost with the clear. Accepted under the per-agent single-session model (the buffer is not file-locked); drains run at session pauses precisely so the window is empty.

---

## Mode: `--drain` (session end)

The consumer-side surface. The ONE place this skill talks to the user.

### When to fire

- **Auto-fired** by pipeline skills at natural logical pauses (plan-1a end, plan-3 end, plan-6 end-of-phase, plan-6-companion end-of-phase, plan-7 end, plan-8 end)
- **Manually** by the user at any time
- **Cross-session leftover check**: at the start of any auto-firing skill, run `harness observe --list --json` — the sweep covers **all buckets by default**, so entries stranded by a prior session (or another agent's bucket) surface immediately. Non-empty → drain first, then proceed.

### Step 1 — Read the pending set

```bash
harness observe --list --json
# data: { observations: [{bucket, id, kind, description, target?, severity?,
#         workaround?, suggested_encoding?, first_seen_at}], buckets_scanned, malformed_skipped }
```

All buckets by default (`--agent <slug>` narrows). Empty `observations` → **silent, no prompt, exit.** If `malformed_skipped > 0`, say so in the prompt header — deviant text is preserved on disk, and `--clear` removes only valid entries, leaving the deviant blocks in place for manual review.

### Step 2 — Present the soft prompt

Single prompt at end of session. **Never asks twice.** Format:

```
💡 harness retro — 3 entries from this session:

  1. [difficulty/tooling] agent: grep on src/ took 47s
     → encode as: justfile recipe wrapping ripgrep

  2. [magic-wand/project] agent: a `just rg <pattern>` recipe would shave 40s per search
     → encode as: justfile recipe

  3. [difficulty/project-sensor] claude-code: inferred the render result; no smoke path
     → encode as: smoke command or visual evidence capture

Before you choose — the two questions, one last pass:
"If you had a magic wand, what one command, flag, output field, fixture, diagnostic, template, sensor, check, or workflow change would make the next run easier, safer, or higher quality?"
"What did you have to infer that the harness should have proved?"
(Anything new → capture it now with `npx harness observe …`; it joins this drain.)

[s]ave selected · [t]ask: /plan-5 --fix emits · [p]lan: /plan-1b emits
[e]ncode: stage diffs · [d]ismiss all · [a]ll-save (default — press Enter)

[s/t/p/e/d/a]: ▮
```

One line per entry, `[kind/target] bucket:` prefixed, with a one-line encoding hint. The **drain beat of the question pair uses the same locked wording** as the in-flight section — the seam is the last cheap moment to catch what the session never wrote down.

### Step 3 — Route by action

#### `[a]ll-save` (default)

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
summary: "eng-harness-4-retro --drain session-end save (N entries)"
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

#### `[s]ave` (selective)

Prompt "Which entries to save? [1,2,3 or a]". Save the selected ones into the record (same envelope); the rest are dropped with the clear.

#### `[t]ask` — emit copy-pasteable fix dossiers

For each encodable entry print `/plan-5 --fix --description "<entry.description>" --target <entry.target>`. Entries are ALSO saved to the record (the suggestion is captured even if the user runs none of them). Clear.

#### `[p]lan` — emit copy-pasteable specs

For each entry suggesting larger work print `/plan-1b "<one-line spec from description + suggested_encoding>"`. Entries also saved. Clear.

#### `[e]ncode` — stage diffs (nothing auto-applies)

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

#### `[d]ismiss all`

`harness observe --clear` without saving anything. Print one line: "✓ buffer dismissed (3 entries dropped)". Unrecoverable — use sparingly.

### Step 4 — Plan-ID detection

`frontmatter.plan_id` resolves: (1) cwd matches `docs/plans/<NNN-slug>/` → that slug; (2) else git branch matches `<NNN>-<slug>` → the branch name; (3) else `null`.

### Encoding-hint generation (one line per entry)

1. `entry.suggested_encoding` set → use it verbatim
2. Else derive from kind + target: `difficulty/tooling` → "wrap in a justfile recipe" · `difficulty/skill` → "edit the SKILL.md" · `magic-wand/*` → "encode as the suggestion above" · `gift/*` → "no encoding needed" · `insight/*` → "document in AGENTS.md or a docs/how article"
3. Else → "(no encoding hint — review manually)"

### `--drain` edge cases

- **Nothing pending**: silent, no prompt.
- **User interrupts mid-prompt**: nothing was cleared; the next drain sees the same entries.
- **Malformed buffer text**: surfaced as `malformed_skipped` in the list envelope; `--clear` keeps the deviant text in place — point the user at the named buffer file for manual review.
- **No `.harness/` in this repo**: `harness observe --list` itself reports `unconfigured` — stay silent.

### What `--drain` does NOT do

No mid-session prompting · no auto-applying encoded diffs · no editing committed `.retro.md` files after writing them (lifecycle mutations are `--harvest`'s job) · no cross-session aggregation (that's `--harvest`).

---

## Mode: `--harvest` (long-horizon)

The reader/curator side. Auto-fires at long-horizon reflection moments; runnable ad-hoc any time.

### When to fire

- **AUTO**: `plan-6-companion` FINAL-phase debrief (the dominant flow), `plan-8-merge` end, `plan-7-code-review` end (rare solo flow)
- **SUGGESTED**: at `plan-1a` start (≥5 unharvested entries) or `plan-3` start (≥10) — print the invocation as a one-liner, don't auto-fire
- **Manually**: `--harvest [--plan <slug>] [--agent <slug>] [--since <date>] [--kind <kind>]`

### Buffer-non-empty advisory

At start, run `harness observe --list --json`. Pending entries anywhere → print one line before scanning:

> ℹ️ Buffer has N unbubbled entries. Consider running `--drain` first so they land in the harvest view.

Then proceed anyway (harvest reads committed records; transient scratch is unrelated).

### Step 1 — Scan + validate

- **Canonical**: `.harness/records/retro/**/*.md` — the records `--drain` materializes (dated subdirs).
- **Legacy (back-compat)**: `docs/harness/agents/**/*.retro.md`, then `docs/retros/*.md` (minih's old per-agent format; skip `*.legacy.md`; map blocks via workshop 005 § D9 `minihToUniversal`).

Per file: parse the YAML frontmatter; validate against the bundled `references/retro.schema.json` (mirror of the frozen `docs/harness/schemas/retro.schema.json`; neither present → `⚠ retro schema not found — skipping validation`, never block). Invalid → warn with the path, skip the whole retro (no half-parse).

### Step 2 — Dedup, version skew

Same `retro_id` in multiple sources → the highest-precedence copy wins: `.harness/records/retro/` → `docs/harness/agents/**` → `docs/retros/*`. Unknown **major** `schema_version` → `⚠ Skipped 1 retro with unsupported schema_version: <path>`; minor skew is silent.

### Step 3 — Curate

- **Cluster** open entries by `(kind, target)`; count, age-order (oldest `first_seen_at` first), track source agents.
- **Stale flags** (observational, never enforced): `open` > **4 weeks** → stale; `suggested` > **2 weeks** without `resolved_by` → stale.
- **Prioritize top-10**: recurrence (count) → severity (`blocking` > `degrading` > `annoying` > none) → back-pressure leverage (clusters indicating missing proof/sensors/evidence/architecture/security/schema checks stay legible as proof-improvement candidates — display guidance only, no gate, no score, no index) → age.
- **Token-cost framing (the leak detector)**: a recurring cluster is **the same inference being re-paid in tokens every session until someone encodes it** into the environment. Label recurrence with that cost. Display wording only — schema, statuses, and clustering logic are unchanged.
- Recognize proof/back-pressure candidates by targets (`project-sensor`, `runtime-inspectability`, `architecture-fitness`, `security`, `schema`, `infra`, `tooling`), by mentions of smoke/screenshot/log/trace/health/dependency-rule/CodeQL/schema checks, and by workarounds like "read code manually" / "eyeballed". Keep original fields intact; never rewrite kinds.

### Step 4 — Print the view (NO on-disk writes)

```
🌾 Harness retro harvest — 2026-06-10T03:30:00Z

📚 Scanned 27 retros across 3 agents · Date range: 2026-04-10 → 2026-06-10
   Total entries: 47 (28 open, 17 encoded, 2 wontfix)

📊 Open clusters (top 10 by recurrence > severity > back-pressure leverage > age):
   1. [tooling] grep/search slowness — 4 entries across 5 sessions
      ↻ re-paid every session since 2026-05-14 — encode it and stop paying  [r/w/s]
   2. [proof/project-sensor] missing smoke or visual evidence — 3 entries  [r/w/s]
   ...

⏰ Stale (>4 weeks open): 3 entries  [r/w/s]
✅ Recently encoded (last 7 days): 6 entries — see scratch/encode-*.diff
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
- `harness.maturity` from the governance doc snapshot (`.harness/engineering-harness.md`); `last_validation`/`boot_ms`/`verdict` have no live source under the read-only boot model — `null` whatever `.harness/history.md` doesn't supply; no governance doc → all four `null`.
- Empty tree → `{"retros": 0, "entries": {"total": 0, …}, "top_clusters": []}` — still valid JSON.

Consumed by `scripts/compound-value.sh` and `just compound-value`; pipe `--harvest --json | jq …` elsewhere.

### Step 5 — Action menu

The drain's `[s/t/p/e/d/a]` actions (operating on cluster selections; save/all-save are usually no-ops here since entries are already committed), plus three **lifecycle ops** that mutate `system.compound.status` IN-PLACE in the source record (file's `schema_version`/`retro_id` untouched; last-write-wins on the rare concurrent harvest):

- **`[r]esolved`** → `status: encoded`; prompt for `resolved_by:` (commit hash / PR URL / diff path)
- **`[w]ontfix`** → `status: wontfix`
- **`[s]tale`** → `status: stale`

### Pruning (`--prune`)

`--harvest --prune --older-than 90d` → **dry-run by default**: list what would be deleted, then print "This is a dry run. Add `--apply` to actually delete (recommend a clean git working tree)." With `--apply` → single confirmation, then delete. Never auto-prunes.

### `--harvest` edge cases

- **Empty tree**: `🌾 No retros found. Capture friction via npx harness observe during sessions.` and exit.
- **`docs/retros/` absent**: skip the back-compat path, no error.
- **retro_id collision, both canonical**: keep the first, warn.

### What `--harvest` does NOT do

No on-disk index files · no auto-applied diffs · no transient-buffer reads beyond the advisory (drain owns the buffer) · no mid-session firing · no schema expansion · **no proof gates** — it surfaces missing sensors as high-leverage candidates but never blocks a plan, applies a threshold, or declares compliance.

---

## References

- `harness/cli` — the `observe` act (capture/list/clear), `record` act (committed placement), doctor temp-hygiene check; `npx harness instructions` carries the zero-context briefing
- Workshop 001 — self-improvement vibe (anti-vibe 7 over-introspection; terse one-line hints)
- Workshop 005 — universal retro contract (entry schema; D5 kinds; D6 identity; D9 minih round-trip)
- Workshop 006 — compound folder layout (D4 KISS no-indexes; D6 pruning; D7 minih back-compat)
- [docs/harness-presentations/](https://github.com/AI-Substrate/harness-engineering/tree/main/docs/harness-presentations) + [harness-foundations/simple-mode.md](https://github.com/AI-Substrate/harness-engineering/blob/main/harness-foundations/simple-mode.md) — Rule 2 (encode the fix, not the memory) and Rule 5 (the question pair this skill headlines)
