# Harness value measures

How the records this repo now writes — **`harness-bypass`**, **`harness-change`**,
and the `win` observation kind — turn into the two leading measures of harness
value (**bypass rate** and **change / encoded-mitigation rate**), why the
**PR** is the denominator, how those numbers *correlate with* DORA instead of
becoming a fifth DORA metric, and the anti-Goodhart guardrails that keep them
honest.

> **This is a design doc, not a scanner.** It **describes** the measures and
> proves the record frontmatter is a sufficient join contract for a future
> cross-repo rate/correlation tool. It builds **nothing** — no scanner, no SQL,
> no dashboard, no correlation engine. Those are explicitly out of scope (see
> [§ What this does not build](#what-this-does-not-build)). The inputs a future
> tool would read are exactly the committed records under `.harness/records/`
> and the frozen frontmatter contract below.

Grounding: the measurement framing here is a public-safe synthesis of the
harness-measurement source notes (`harness-foundations/source-notes/notes3.md`)
— the ranked harness-measurement family (bypass rate is measure 9,
encoded-mitigation rate is measure 11), the "measure the event where the truth
is cheapest to prove" routing rule, the canonical-joins discipline, the DORA
mapping, and the anti-productivity-theatre guardrails.

---

## The model in one minute

The harness's deterministic layer is now **self-documenting**: every time the
paved path is *avoided*, an agent can write a `harness-bypass` record; every time
the harness is *improved*, a `harness-change` record; and a positive `win`
observation captures what worked. Each record is stamped at write time with a
CLI-owned provenance header (8 frozen frontmatter keys) so the records **join**
to a repo, branch, time, and plan without any extra bookkeeping.

Two leading measures fall straight out of that stream:

| Measure | Question it answers | Source notes ref |
|---|---|---|
| **Harness bypass rate** | Where do people/agents avoid the supported commands, and why? | measure 9 |
| **Change / encoded-mitigation rate** | Do recurring frictions actually become validated harness improvements? | measure 11 |

Both are **leading evidence about the project-side loop** — they say whether the
loop is getting easier to enter, safer to change, and better at encoding
learning. They **complement, never replace**, the downstream DORA delivery
scoreboard.

---

## (a) The two rates and the denominator

### Bypass rate

```
bypass rate = harness-bypass records  /  <denominator>
```

A `harness-bypass` record is written when an agent or human reaches for the
shortcut instead of the supported command — and, crucially, it records *why*
(`cause`) and *how much it hurt* (`severity`). The rate is only meaningful with
a stable denominator (below) and read **as a trend**, not an absolute: a bypass
rate trending **down** over successive PRs is the signal that the paved path is
becoming the path of least resistance.

The `cause` enum is the diagnostic payload — it turns a raw count into a friction
taxonomy. `too-slow` and `unclear-output` point at UX debt in existing commands;
`missing-command` and `no-coverage` point at gaps the harness should grow into;
`policy` and `agent-could-not` are a different class again. You measure the rate
to know *how big* the problem is, and you read the `cause` distribution to know
*what to encode next*.

### Change / encoded-mitigation rate

```
change rate = harness-change records  /  <denominator>

encoded-mitigation ratio = harness-change records that resolve a recorded friction
                           ----------------------------------------------------------
                                    frictions surfaced (bypasses + retro difficulties)
```

A `harness-change` record is written when the harness itself is improved — a new
command, a sensor, a fixture, a template, a doc, a skill edit, or routing
guidance (`change_type`). Its optional `resolves` field is the closing half of
the loop: it points back at the friction (a `harness-bypass` record, a retro
difficulty) that prompted the change. The **encoded-mitigation ratio** is the
measure that the loop is *compounding* — that recurring friction is becoming a
runnable part of the deterministic layer rather than being re-suffered each
session.

### The denominator: PRs primary, plans/sessions secondary

The source notes' routing rule is **"measure the event where the truth is
cheapest to prove."** For these rates that event is the **pull request**:

- A PR is a **stable, externally-verifiable, joinable unit** — it already has an
  ID, a branch, commits, a CI run, and (usually) a linked work item. The records'
  `branch` + `repo` + `created_at` keys join to it for free.
- Rates are therefore reported **per PR** (e.g. "bypasses per PR, 30-day
  trailing"), with **plans** and **sessions** as secondary denominators for
  finer-grained or longer-horizon views.
- A per-PR denominator is also what makes the under-reporting defense work
  (see [§ d](#d-anti-goodhart-team-level-and-the-under-reporting-defense)): the
  PR flow is observable independently of whether anyone wrote a record, so a
  suspiciously low numerator can be read against a denominator that can't be
  gamed by simply not capturing.

---

## (b) Two hand-traced examples — the frozen frontmatter is the join contract

Every record carries the **8-key frozen frontmatter contract**: **7 keys spliced
by the CLI at write time**, then the **template-owned** `schema_version`, then
the type's body keys. The spliced keys, in order, are:

```
record_kind · harness_version · branch · repo · created_at · agent · plan_id
```

(`schema_version` is owned by the template, never spliced — it is the 8th key.)
The splice is idempotent and stamped from deterministic substrate (`git`, the
CLI version, the clock), so the join columns are present and trustworthy without
the author lifting a finger.

### Example 1 — a `harness-bypass` record

`.harness/records/harness-bypass/2026-06-16/001-prove-too-slow.md`

```markdown
---
record_kind: harness-bypass
harness_version: 0.3.0
branch: 020-harness-bypass-change-records
repo: https://github.com/AI-Substrate/harness-engineering
created_at: 2026-06-16T08:42:11Z
agent: the-flow-implementer
plan_id: 020-harness-bypass-change-records
schema_version: "1.0"
cause: too-slow
attempted: true
command: harness prove --scenario record-roundtrip
severity: degrading
---

`harness prove` for the record round-trip took ~50s, so I ran the vitest file
directly to keep the inner loop tight. The proof still happened — just not
through the supported command.
```

- **7 spliced keys** (`record_kind` … `plan_id`) + **`schema_version`** = the
  provenance header.
- **Body keys** for this type: `cause` ∈
  `missing-command | command-failed | too-slow | unclear-output | no-coverage | policy | agent-could-not`,
  `attempted` (bool), `command` (string), `severity` ∈
  `blocking | degrading | annoying`.

### Example 2 — the `harness-change` that resolves it

`.harness/records/harness-change/2026-06-18/001-prove-fast-path.md`

```markdown
---
record_kind: harness-change
harness_version: 0.3.1
branch: 021-prove-fast-path
repo: https://github.com/AI-Substrate/harness-engineering
created_at: 2026-06-18T14:03:55Z
agent: the-flow-implementer
plan_id: 021-prove-fast-path
schema_version: "1.0"
change_type: new-command
target: harness prove --scenario record-roundtrip
resolves: harness-bypass 2026-06-16/001-prove-too-slow (cause was too-slow)
---

Added a cached fast path to `harness prove` for the record round-trip scenario,
cutting it from ~50s to ~4s. The shortcut that prompted the bypass above is now
slower than the paved path.
```

- **Body keys** for this type: `change_type` ∈
  `new-command | sensor | fixture | template | doc | skill-edit | routing`,
  `target` (string), `resolves` (free-form ref, ≤200 chars).
- The `resolves` field closes the loop: bypass → change. A scanner that reads
  both records can count this as one **encoded mitigation**.

### Why these 8 keys are a sufficient join contract

A future cross-repo scanner needs to do four things, and the frozen header gives
it all four with **no extra schema**:

| The scanner needs to… | …joins on |
|---|---|
| Attribute a record to a unit of work | `repo` + `branch` (+ the PR/commit they resolve to) |
| Place it on a timeline / trend | `created_at` |
| Scope it to a plan or initiative | `plan_id` |
| Separate the two record families and version the parse | `record_kind` + `schema_version` |
| Read the harness version it was produced under | `harness_version` |
| Aggregate **at team level only** | `agent` (optional value, stamped `null` when unset — see § d) |

This mirrors the source notes' **canonical-joins** discipline: a measurement
system fails when IDs don't join, so every dashboard should report **linkage
coverage**, and a dashboard with weak joins is a hypothesis, not a fact. Because
the CLI stamps these keys deterministically, linkage coverage for harness records
starts at 100% by construction.

---

## (c) DORA — a leading/lagging correlation, not a fifth metric

DORA (lead time, deployment frequency, change-fail rate, time-to-restore)
remains the **downstream delivery scoreboard**. It shows whether delivery became
faster and safer — but it does **not** by itself prove clean-start usability,
product-path proof, or harness compounding. That is the gap the harness measures
fill, *upstream*.

So the relationship is **correlation across a leading/lagging boundary**, never
addition:

- **Leading** (this repo's records): bypass rate trending down, encoded-mitigation
  ratio trending up, `win` observations accumulating.
- **Lagging** (DORA): the four delivery metrics, measured later, by the existing
  delivery systems.

> Do **not** invent a "fifth DORA metric." Harness measures are a *leading layer
> inside* the existing operating model (DORA / SPACE-DevEx / Accelerate), not a
> new entry on the DORA scorecard. The testable hypothesis the join enables is:
> *as bypass rate falls and encoded-mitigation rises, the DORA metrics should
> improve in a later window.* The frozen frontmatter is what lets you line the
> two series up on `repo` + `branch` + `created_at` and check that hypothesis —
> it does not assert the causation for you.

---

## (d) Anti-Goodhart, team-level, and the under-reporting defense

These measures are designed to be **safe to publish**, which means designing
against the ways they could be abused or misread.

### Team-level only — never individual attribution

The source notes are blunt: harness measurement requires **team-level governance
that prevents individual surveillance and productivity leaderboards.** Apply it
literally here:

- The `agent` key carries an **optional provenance value** — stamped `null` when
  unset, so the key itself is always present (one of the fixed 8) and never a
  source of join-coverage gaps. It is aggregated **only** at the team or repo
  level, never a per-person scoreboard, and capture never fails when it's absent.
- These rates join the explicit do-**not**-use-for-individuals list from the
  source notes — alongside prompt count, token count, commit count, PR count,
  and lines of code. They are aggregate diagnostic context, **not** performance
  management.

### Goodhart's law — when a measure becomes a target

If "drive the bypass rate to zero" becomes a target, the cheapest way to hit it
is to **stop writing bypass records** — the number looks perfect while the real
friction is untouched. Guardrails:

- Read bypass rate **with its `cause` distribution**, not as a lone number — a
  falling rate with an unchanged `cause` mix is suspicious.
- Pair every numerator with the **PR denominator** (which the team cannot game by
  simply not capturing) and report **linkage coverage** alongside it.
- Treat the encoded-mitigation *ratio* as the real health signal: it rewards
  *fixing* friction, not *hiding* it.

### The under-reporting defense (R6) — zero is not perfection

Capture is **voluntary and highly-suggestive, never blocking** (that is the
design of the in-repo seams). So low or zero counts are an **absence of
evidence, not evidence of absence**:

> **Zero bypasses on a busy repo means the capture seam isn't being used — not
> that nobody bypassed.**

The defense is built into the measure: lean on the **PR denominator** (observable
whether or not anyone wrote a record) and on **linkage coverage** as a first-class
reported number. A bypass rate is only as trustworthy as the capture discipline
behind it, so the dashboard's job is to surface *that* — never to present a
suspiciously clean count as a clean bill of health.

---

## (e) The telemetry `segment` — a counts-only sensor contract

Alongside the `harness-bypass` / `harness-change` records above, the frozen
harness telemetry corpus contains per-session **`segment`** records captured by
the former ambient sensor. Harness capture is now off by default, but the
segment remains a contract the eng-thrive measures can consume from published
refs. The archived mechanics and live read path are in the
[telemetry guide](./telemetry.md).

**What the measures may read.** The enumerated field set is the segment's plan
(`docs/plans/034-harness-telemetry-collection/…` `### Segment Schema`) and the
machine schema (`harness/cli/src/services/telemetry/segment.schema.json`). At
team/repo grain the available fields are: token buckets + per-model turn/output
counts; skill and tool histograms; subagent identity/lifecycle; repo-relative
file paths; **plan links** (the join to the records above); compaction /
api-error / local-command event counts; branch, model, effort, timecode, and the
capture window. As of schema **v2.0** they also include the timestamped
**`event_stream[]`** and its derived **`rollup`** (activity / flow-stage time /
outcomes — see [the example](#e-the-telemetry-segment--a-counts-only-sensor-contract)
below and the [telemetry guide](./telemetry.md#the-event-stream-v20)). **No content
fields ever** — no prompt/message text, no file contents, no free-form tool-arg
strings; an event is `t + kind + name + numbers`.

**A hand-traced segment (counts only).**

```jsonc
{
  "schema_version": "2.0",
  "command": "flow",
  "harness": "claude-code",
  "harness_session_id": "<opaque id>",
  "timecode": "2026-06-23T11:00:00Z",
  "window": { "since": "last-command", "from": 8, "to": 14 },
  "branch": "034-harness-telemetry-collection",
  "branch_changed": false,
  "tokens": { "input": 1200, "output": 340, "cache_create": 0, "cache_read": 800,
              "total": 1540, "subagent_tokens": 0, "grand_total": 2340 },
  "models": { "claude-opus-4-8": { "turns": 6, "output_tokens": 340 } },
  "effort": "high",
  "skills": { "the-flow": 1 },
  "tools": { "Edit": 3, "Bash": 2 },
  "subagents": [],
  "files": { "written": ["harness/cli/src/services/telemetry/sync-service.ts"], "edited": [] },
  "plans_touched": ["034-harness-telemetry-collection"],
  "events": { "compactions": [], "api_errors": 0, "local_commands": 0 },
  "thinking": { "blocks": 4 },
  // v2.0 — the timestamped substrate + its derived measures view
  "event_stream": [
    { "t": "2026-06-23T11:00:00Z", "kind": "flow", "flow": "the-flow", "stage": "implement", "status": "in_progress" },
    { "t": "2026-06-23T11:00:00Z", "kind": "prompt", "words": 22 },
    { "t": "2026-06-23T11:03:10Z", "kind": "turn", "dur_s": 190, "out": 340, "model": "claude-opus-4-8" },
    { "t": "2026-06-23T11:03:40Z", "kind": "tools", "name": "Edit", "count": 3, "span_s": 25 },
    { "t": "2026-06-23T11:05:00Z", "kind": "checks", "status": "ok", "gates": { "tests": "ok", "arch-check": "ok" } }
  ],
  "rollup": {
    "activity": { "wall_s": 300, "agent_working_s": 190, "human_s": 110, "idle_s": 0, "working_ratio": 0.63 },
    "flow_stage_time_s": { "implement": 300 },
    "skills": { "the-flow": { "runs": 1, "abandoned": 0, "superseded": 0 } },
    "tokens": { "in": 1200, "out": 340, "cache_read": 800, "cache_create": 0 },
    "tools": { "Edit": 3, "Bash": 2 },
    "outcomes": { "checks": "ok", "exits": { "checks": 0 } }
  }
}
```

Every top-level key is always present (a stable shape for the scraper); only
*values* reflect availability — nullable scalars (`tokens`, `effort`, `thinking`,
`branch`, per-subagent values) go `null` when unavailable, while collection fields
(`models`/`skills`/`tools`/`subagents`/`files`/`plans_touched`/`events`/`event_stream`)
default to empty (and `rollup` is `null` when the stream is). The v1 count fields
are retained as a compatibility view **equal to** the rollup's derived counts. The
full field set + types are the segment's plan and `segment.schema.json`.

**New measurement surfaces (v2.0).** Because the rollup is derived from a
timestamped stream, the measures can read *shape*, not just totals — still at
team/repo grain, still never per-person:

- **Working ratio** (`rollup.activity.working_ratio`) — agent-working time over
  agent + human time (idle excluded). A team-level read on *"how much of a session
  is the agent generating vs. waiting on a human"* — a harness-leverage signal, not
  a productivity score. The honest gap split (idle ≠ thinking) is what makes it
  meaningful; the spike that motivated it moved a real session from 0.34 to 0.78.
- **Flow-stage time** (`rollup.flow_stage_time_s`) — where a session's wall time
  goes *by flight-plan stage* (research / plan / implement / review / ship). Joined
  to the `harness-change` records by `plan_id`, it answers *"which stage actually
  absorbs the time — and is that where the encoded friction lives?"*
- **Outcome density** (`rollup.outcomes`) — checks verdicts + exit codes per
  session, a leading signal for the change/bypass rates (§a) without reading a diff.

These are **diagnostic context at team grain**, on the same do-not-use-for-individuals
footing as token count — see [§ Team-level only](#team-level-only--never-individual-attribution).

Read at the **repo** level this segment says "in this window, on plan 034, ~2.3k
tokens of opus work touched the sync-service via 3 edits + 2 bash calls." Joined
to the `harness-change` records by `plan_id`, it is exactly the volume context the
encoded-mitigation *ratio* (§a) needs — *was the friction that got encoded the
friction where the work actually happened?* — without ever naming a person.

**Attributable commit, team-grain use — the same governance as the rates.** As of
the 2026-06-25 decision, a segment's durable commit on the
`refs/harness-telemetry/*` shard refs is authored by the **contributor's own
configured git identity** (a generic `harness-telemetry <noreply@…>` is used only
as a fallback when no identity is configured), so a push is **traceable to who
made it** — the same attribution any git commit carries. Attribution makes
telemetry *traceable*; it does **not** make it a per-person scoreboard. The counts
(token count among them) stay on the explicit do-**not**-use-for-individuals list:
they are aggregate diagnostic context at team/repo grain, **not** performance
management. Individual-grain reads exist only to *help* that engineer — diagnose
their own flow, support onboarding — never to rate or rank them. The optional
`agent` provenance field is the *same* nullable,
aggregate-only key described in
[§ Team-level only](#team-level-only--never-individual-attribution).

## What this does not build

Out of scope for this repo, by design (these are the consumers of the contract
above, not part of it):

- ❌ A **cross-repo rate scanner** — the tool that would read `.harness/records/`
  across repos and compute the rates. No scanner code, no SQL, no parser ships
  here.
- ❌ A **DORA correlation engine** or any statistical join implementation.
- ❌ A **dashboard** or scorecard UI.

What *does* ship is the thing those tools depend on: the two record types, the
`win` kind, and the deterministically-stamped 8-key frozen frontmatter — a join
contract that is sufficient, by construction, for any of the above to be built
later.

## See also

- [Harness telemetry](./telemetry.md) — the frozen counts-only `segment`
  contract, live read path, and explicit legacy-capture escape hatch.
- [The git-ai collector handover](./gitai-collector.md) — current attribution
  collection and the v1 proof ceiling.
- [Record and record types](./record-and-record-types.md) — the `harness record
  <type>` command, the two new core types' body-key contracts, and the
  provenance header section.
- `harness-foundations/source-notes/notes3.md` — the harness-measurement source
  synthesis this doc draws on.
