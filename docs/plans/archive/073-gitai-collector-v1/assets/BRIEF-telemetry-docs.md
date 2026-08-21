# Brief — fix the telemetry documentation for plan 073

**For**: a `/pij` peer (copilot, `gpt-5.6-sol`, effort high)
**Worktree**: `/Users/jordanknight/substrate/harness-engineering-worktrees/s073-gitai-collector-v1`
**Branch**: `s073/gitai-collector-v1` — already open as **PR #104**, currently green.
**Why now**: Jordan — *"before we pull though we need to fix the documentation."*

Four parallel read-only audits produced everything below. **Every file:line here was
verified against code, not against the docs' own claims.** Trust them, but re-read
before editing — do not take a verdict on faith if your own read disagrees; say so.

---

## 1. What changed underneath these docs

Plan 073 makes git-ai the collector and turns harness's **own capture OFF BY DEFAULT**:

- `services/telemetry/capture-gate.ts:40` — `export const CAPTURE_DEFAULT_ENABLED = false;`
- `capture-gate.ts:34` — **new** opt-in `HARNESS_TELEMETRY_CAPTURE=1`
- `capture-gate.ts:27,52` — `HARNESS_NO_TELEMETRY` still exists and still wins
- Three write enforcement points: `capture-service.ts:638`, `sync-service.ts:562`,
  `housekeeping.ts:104`
- **The READ path is ungated**, proven by `test/services/telemetry/read-path-ungated-073.test.ts`

**The single most important distinction in this whole job.** Three categories, and
conflating them is the way to do real damage:

| | category | treatment |
|---|---|---|
| (i) | **capture** behaviour — dark by default now | reframe under an explicit "off by default" banner. **Do not delete** — `capture-gate.ts:15-18` and `gitai-collector.md:14` both commit v2 to *migrating* this code, and these docs are its only spec |
| (ii) | **read/pull/report** — still works on published refs | **STILL-TRUE.** Leave alone |
| (iii) | **wire contract / schema / field reference** — governs already-published data | **STILL-TRUE.** This is the only written explanation of how to read the existing corpus |

Deleting (ii) or (iii) would destroy the ability to read a year of published telemetry.
**Nothing in scope rates DELETE.** 073 turned off the *producer*; these docs are almost
entirely about the *consumer*.

---

## 2. ⚠️ THE HARD GATE — read before touching any filename

`check:docs` is a **HARD gate** (error ⇒ exit 1 ⇒ CI fails):
`.harness/extensions/checks/extension.ts:15`, `package.json:41` →
`node scripts/gen-docs.mjs --check`.

`scripts/gen-docs.mjs:38-41` **throws** on a missing source:

```js
const srcAbs = join(repoRoot, entry.sourcePath);
if (!existsSync(srcAbs)) {
  throw new Error(`gen-docs: sourcePath for "${entry.id}" not found: ${entry.sourcePath}`);
}
```

**Three of the seven are registered sourcePaths** in
`harness/cli/src/services/docs/docs-manifest.json`:

- `:58` `docs/how/telemetry.md` (id `telemetry`)
- `:65` `docs/how/telemetry-pull.md` (id `telemetry-pull`)
- `:72` `docs/how/telemetry-otlp.md` (id `telemetry-otlp`)

So: **rename or delete any of those three without updating the manifest and CI fails
outright.** And editing *any* registered doc without running `npm run gen:docs` and
committing the regenerated `harness/cli/src/services/docs/docs-content.ts` fails the same
gate on drift. **Regenerate and commit it in the same commit.**

By contrast, broken markdown **links** are only warn-launch (`degraded`, exit 0) —
`.harness/extensions/markdown-lint/lib/decision.ts:88-97`. Fix them anyway; just know
which one breaks the build.

---

## 3. The shape to build — one front door, a kept reference set

**Assumption, stated explicitly because Jordan asked for "a single telemetry document"
and the evidence argues against a literal single file.** If he overrules this, the
fallback is the same content with the reference docs as appendices — ask, don't guess.

**Rewrite `docs/how/telemetry.md` as the front door.** It absorbs the dead capture
narrative and the salvageable half of `measuring-ai-contribution.md`, and links out to a
reference set that stays separate. It keeps its filename (it is a registered sourcePath —
see §2) and keeps the anchor `#the-event-stream-v20`, which
`harness-value-measures.md:306` links to directly.

### Per-doc disposition

| doc | action |
|---|---|
| `telemetry.md` | **REWRITE as the front door.** ~26 of 50 KB survives |
| `measuring-ai-contribution.md` | **MERGE-PARTIAL into it, then delete the file** (not manifest-registered, so deletion is safe). ~4-4.5 KB of its 10 KB survives |
| `telemetry-pull.md` | **KEEP.** Nothing in it is made false by 073. Two line edits only |
| `telemetry-otlp.md` | **KEEP.** The eng-thrive read contract + manifest-registered |
| `telemetry-reports.md` | **KEEP**, with edits — it is the read-path manual |
| `cohort-telemetry-insights.md` | **KEEP** + frozen-corpus banner |
| `telemetry-fixtures.md` | **KEEP, nearly untouched** — see §5 |

---

## 4. The false statements to fix — verified, quote-level

### `telemetry.md` — the capture half (10 of 26 headings)

**The worst section is `## Disabling telemetry` (`:341`)**, which is an *opt-out*
instruction for a system that is now *opt-in*:

- `:344` — *"Both are environment variables (telemetry is on by default when unset):"*
  Doubly wrong: it tells a privacy-conscious reader to stop something that is not
  happening, and tells an analyst that data exists which does not.
- `:348` — the `HARNESS_NO_TELEMETRY=1` row presenting two switches when there are now
  three; **`HARNESS_TELEMETRY_CAPTURE` is never mentioned**, and it is the only one that
  does anything on a shipped install.
- `:352` — `export HARNESS_NO_TELEMETRY=1  # this shell captures and pushes nothing`

Other NOW-FALSE, each needing reframing not deletion: `:3-4`, `:7` (intro claims capture
on every command); `:34-35`, `:74` ("capture preamble before **every** command");
`:299-300`, `:315` (liveness — *"Green means nothing is owed anywhere"*); `:473-474`
(a three-step runbook whose step 1 is now a silent no-op); `:584`, `:591-594` (sync);
`:607`, `:614`, `:617-619` (auto-sync on `checks` — directly contradicted by
`gitai-collector.md:37`: *"`harness checks` — captures nothing, publishes nothing"*);
`:647` (git hooks — still installed, now measuring the latency of a no-op).

**Protect these — they are (ii)/(iii) and irreplaceable:** `:85-127` segment field
contract · `:128-253` event-stream schema · `:491-501` billing units · `:666-713` ref
layout + glob fetch + prune-by-start-date · `:725-743` attribution · `:781-796` token
evidence read contract · `:798-826` read-path honesty.

### One-line factual fixes elsewhere

| file:line | wrong | right |
|---|---|---|
| `telemetry-reports.md:53` | `--source` default documented as `temp` | code default is **`auto`** (`acts/telemetry.ts:1234`). **Highest-priority single-line fix** — post-073, `temp` is the one source that is permanently empty, so the doc tells you to use the only option guaranteed to return nothing |
| `telemetry-pull.md:275` | "Segment 2.5 … OTLP schema v0.2/scope 2.5" | **2.7 / v0.4.0** (`otlp/types.ts:24-29`) |
| `telemetry-otlp.md:10-12` | same stale identity, in the opening blockquote | same fix — and it contradicts its **own table** 68 lines later at `:79` |
| `telemetry-fixtures.md:185,195-197` | tells you to run `npm run gen:telemetry-fixtures` | that command **exits 1 by design** (`scripts/telemetry-fixtures.mjs:50-55` — goldens are frozen). **Also fix the identical false instruction in the gate's own failure message at `.harness/extensions/checks/extension.ts:173`** — a developer hitting the gate is currently told to run a command engineered to fail |

### Reframes, not deletions

- `telemetry-otlp.md:207-226` "Graduation" — a tripwire on a ref count now frozen at 123
  can never trip. Compress to historical record; **keep** the transport-agnostic-spool
  rationale at `:210-211` (it is why v2 can migrate rather than rebuild).
- `telemetry-otlp.md:105-158` Transport — retense to descriptive. It is the **only**
  description of the on-ref tree shape. `:152-155` first-run migration is genuinely dead.
- `telemetry-reports.md:153-181` central storage layout — no producer on v1. Compress,
  mark as the shape the frozen archive occupies and that v2 re-enters.
- `telemetry-reports.md` has **two sections titled "Reading token coverage"**
  (`:124-136` H3 and `:217-232` H2). Merge into one.
- `telemetry-reports.md:45-46` claims three verbs; **five ship** — `sweep` and `insights`
  are documented only in the cohort doc. Cross-link or add them.
- `cohort-telemetry-insights.md` — add a banner under the H1: the corpus is frozen, every
  session it can analyse was captured before v1, re-runs are reproducible, new months are
  empty. **Do not delete it**: `insights.ts:4-8` proves it is a pure function of saved
  report JSONs (no ports, no git), it is the only doc for two shipped verbs, and two live
  references point at it.

### What to carry over from `measuring-ai-contribution.md`

Its *method* lost its input (`:31-81` — `file` events, `product_commit` anchor, the join).
Demote that to a clearly-labelled **"how to read the archived refs"** appendix. What must
survive:

1. **It predicted git-ai.** `:184-196` proposes a **per-line fingerprint** as the one
   change that would make attribution exact — and declines to build it. git-ai delivers
   that outcome with **line ranges**, which is strictly better: the doc's own objection was
   that hashed short lines (`}`, `return;`) are reversible by dictionary attack, and ranges
   carry no content at all. **Say this plainly** — it is the file's best claim to survival.
2. **The bias inverts — state the trade honestly.** git-ai removes the gross-churn
   inflation *structurally* (dead code gets no range), so `:99-100`'s "clamp per file,
   never present a per-file percentage as precise" is no longer required practice. **But**
   the note carries no churn signal at all and `ai_additions == ai_accepted`, so
   acceptance always reads 100%. The correct framing is **not** "the bias is gone" — it is
   **"written-versus-kept is no longer measurable."** We traded a biased number for an
   absent one.
3. **The FX009 lesson, which now applies to git-ai itself.** `:163-172` — *"a session that
   wrote 410 lines published a **confident** 0.0% agent share — not a gap, a wrong
   number."* Keep it and point it at the new collector (see §6).
4. `:174-176` — *"The two errors do not cancel in any principled way, so do not treat
   their coexistence as accuracy."* Keep verbatim in spirit.
5. `:135-136` is now **false** at the repo level (*"no amount of post-processing recovers
   which lines an agent wrote"*) — git-ai records line ranges. Fix it.
6. Its worked example (`:102-123`) survives as **dated historical evidence** — label it as
   the harness-join era.

---

## 5. `telemetry-fixtures.md` — nearly untouched, and here is why

Verified by wiring, not by its own claims: it is the runbook for a **hard** CI gate
(`.harness/extensions/checks/extension.ts:171`) that runs **regardless of the capture
default** — `scripts/telemetry-fixtures.mjs:58-61` drives suites that import adapters and
`segment.ts` **directly**, with no `capture-service` and no `capture-gate` anywhere. The
capture tool itself is ungated (`.harness/extensions/telemetry-fixtures/extension.ts:6-21`).
It is **also cited as a compliance control** by `docs/project-rules/rules.md:117` and by
`.harness/extensions/telemetry-fixtures/instructions.md:60`.

**Fix only the two `gen:telemetry-fixtures` lines (plus the gate's failNote).** Leave the
rest alone. Optionally note it is a live gate over a now-dormant production consumer.

---

## 6. Add the dogfood truth — this is new and not yet in any doc

`assets/research/dogfood-live-install.md` (committed, `5debdd73`) has the full record.
The consolidated doc must state, honestly:

- **`install-hooks --help` performs a full install**, and every near-miss spelling of
  `--dry-run` does too — the safety flag **fails open** (`parse_install_options` ends in
  `_ => {}`).
- **Hook installation cannot be scoped to chosen agents**; it also installs a VS Code
  extension and rewrites editor `settings.json`.
- **Already-running agents stay uninstrumented until restarted**, and *their prior work is
  attributed to the human.*
- **git-ai does not attribute Cursor IDE work on this machine.** Proven with a minimal
  repro plus a working control in the same repo: Cursor dispatches hooks (Execution Log,
  21-304 ms), the payload is complete (`tool_name: "Write"`, absolute `file_path`, full
  content, model, session id), git-ai parses it (rejects only `Read`), the daemon ingests
  it with **zero errors** — and `refs/notes/ai` gets **nothing**. Cause: the note writer is
  reachable **only** from a trace2-observed commit (`daemon/analyzers/history.rs:30` →
  `daemon.rs:6181,6293` → `authorship/post_commit.rs:91`), there is **no reconciliation
  sweep for un-noted commits**, and Cursor's sandboxed shell means the commit's trace2
  event never arrives. Known upstream: **#909** (sandbox) and **#1968** (Cursor), both
  OPEN. **Do not file anything upstream — Jordan's explicit instruction.**
- **Worse than silence**: unattributed lines then receive **`h_` known-human attestations**
  from the recovery ladder. Observed doing exactly that to Claude-written lines in commit
  `1bb008c`. Agent work returns as *positively attested human work*.
- **No health signal detects any of this.** Binary, hooks, daemon, trace2, checkpoints all
  report healthy. This is `ac-0012`'s deferred gap, now with a live reproduction.

---

## 7. Links you will break — the complete list

**In markdown-lint scope** (warn-launch, but fix them): `docs/guide/14-metrics-and-measures.md:185,198`
· `docs/how/detailed-system-overview.md:348` · `docs/how/flow-conformance-eval.md:455,494`
· `docs/how/gitai-collector.md:349,351,353` · `docs/how/harness-value-measures.md:293,306,418`
· `docs/project-rules/rules.md:117`.

**`harness-value-measures.md:306` is anchor-bearing** — `./telemetry.md#the-event-stream-v20`.
**That anchor must survive** in the rewritten doc, or update the link.

**Out of scope but real**: `.harness/extensions/telemetry-fixtures/instructions.md:60` ·
`.claude/skills/telemetry-insights-narrate/SKILL.md:98`.

**Also**: `docs/guide/14-metrics-and-measures.md:179` independently repeats the same false
opt-out table as `telemetry.md:349` — fix it too.

**Leave alone**: 132 bare-path mentions across 55 files in `docs/plans/**` (historical
record, excluded from the linker at `.harness/extensions/markdown-lint/lib/scope.ts:34`).
Do **not** rewrite history.

**Add**: all three of `telemetry-reports.md:233-242`, `telemetry-otlp.md:227-236`,
`cohort-telemetry-insights.md:98-106` have "See also" blocks that point only at each
other. **None links to `gitai-collector.md`.** A reader entering at any of them today
gets a fully present-tense pipeline with no hint its input stopped. Fix all three.

---

## 8. Two code defects found during the audit — fix these too

1. **`.harness/extensions/checks/extension.ts:173`** — the telemetry-fixtures gate's
   `failNote` tells you to run `npm run gen:telemetry-fixtures`, which exits 1 by design.
2. **`doctor`'s `capture-liveness` layer is ungated** (`doctor-service.ts:25,755`). Green
   means *"nothing is owed anywhere"*, and on a shipped harness nothing can ever be owed
   because nothing captures — so it reports **green forever, having proven nothing.**
   That is a confident wrong answer, the exact class this plan exists to kill.
   **Raise this before changing it** — it may want an AC and belongs in the review. Do not
   silently redefine a doctor verdict.

---

## Constraints — non-negotiable

- **Never link the global `harness`** — invoke `node <worktree>/harness/cli/bin/harness.js`.
- **Bash cwd resets to the MAIN checkout between commands** — `cd` in every command.
- `timeout 30 git commit --no-verify` — the hook hangs. Prefix `HARNESS_NO_TELEMETRY=1`.
- **Never `git add -A`** — explicit pathspecs only; other sessions hold uncommitted work.
- **Run `npm run gen:docs` and commit `docs-content.ts`** whenever you touch a registered
  doc (§2). Verify with `node harness/cli/bin/harness.js checks`.
- Forbidden: `the-flow.json`/`.md`, `.the-flow-state.json`, `government/`,
  `refs/harness-telemetry/*`, `plan.dd.json`.
- **Do not file anything upstream to git-ai.**
- No new dependencies.

## Done when

`just checks` is at the exact baseline — arch-check 2, markdown-lint **≤196**,
windows-check 6, nothing else — `check:docs` passes, no statement in any telemetry doc
claims capture happens by default, every "See also" reaches `gitai-collector.md`, and you
report per-doc what you changed with the file:line of each false statement you fixed.

If you disagree with any verdict in this brief after reading the code, **say so rather
than silently following it** — these came from audits, and an audit can be wrong.
