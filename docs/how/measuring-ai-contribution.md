# Measuring AI contribution from telemetry

How to answer *"what share of the lines we commit did an agent write?"* from the data
this repo already captures — what the numbers legitimately support, the one systematic
bias they carry, and the claims they cannot support at all.

> **This is a method doc, not a tool.** Everything below is computable today from
> existing `file` telemetry events plus `git`. Nothing here is implemented as a command;
> this describes the join and its error term so that a future reader/report can be built
> without re-deriving the reasoning — or, more importantly, without quietly publishing a
> number the data does not support.

## The two records, and why you need both

Neither source answers the question alone:

| Source | Contains | Missing |
|---|---|---|
| **Telemetry** `file` events | agent writes/edits, attributed | anything a human typed — humans emit no telemetry, ever |
| **Git** | every committed line, human *and* agent | any notion of *who* or *what* authored a line |

Telemetry is **attributed but partial**. Git is **complete but anonymous**. So git supplies
the denominator — it is the only record containing human work at all — and telemetry tags
the agent portion of it. The human share is never measured directly; it is the residual,
`total − agent`.

A common misreading is that git "shows what the human did". It does not. When an agent
writes a file and you commit it, those lines are in git exactly like any others; git simply
has no idea an agent produced them.

## What a `file` event carries

Each agent Write/Edit emits one event (plan 056):

```text
path, change (written|edited), lines_added, lines_removed,
bytes_added, bytes_removed, t (capture time)
```

Note what is **absent**: no line numbers, no line content, no hashes. You know *how many*
lines, never *which* ones. That single fact sets the ceiling on everything below.

Deltas come from the tool payload (`Edit` old→new, `Write` content), never from reading the
file, and the line diff is an order-insensitive multiset difference — so an edit whose
context lines are unchanged contributes nothing, and a pure reordering contributes zero.

## The anchor: `product_commit`

The join problem looks circular at first — at the moment an agent writes a file, the commit
that will contain it does not exist yet, so nothing can be stamped with its SHA.

It is resolved by anchoring **backwards** instead of forwards. Every telemetry segment
records `product_commit`: the product `HEAD` observed when that segment was collected — the
commit the work was built **on top of** (plan 060). A session that spans several bases is
representable, because the rollup manifest aggregates them as a set (`product_commits`).

This is what makes the join robust, and it is worth being explicit about why:

- **No commit-time hook is required.** The anchor is written into the record at collection.
- **Telemetry may be flushed at any time** — before, after, or entirely independently of the
  repo commit. Flushing does not change the stamp, so telemetry reaching
  `refs/harness-telemetry/*` ahead of the corresponding product commit is harmless.
- **The join is computed later, by a reader**, offline, from telemetry plus `git log` alone.
  No live coordination between the two is needed at any point.

## The join

For a commit `X` with parent `P`:

```text
agent_lines(X, file) = Σ lines_added over `file` events in segments
                       where product_commit == P, for that path
total_lines(X, file) = git diff --numstat P..X, for that path

share(X) = Σ agent_lines / Σ total_lines
```

Match on **parent SHA**, not on timestamps. Timestamp windowing looks equivalent but is not:
it breaks under amend, rebase, cherry-pick, and branch switching, and this repo routinely
runs several worktrees with independent `HEAD`s. The parent-SHA match is stable under all of
those because the anchor was recorded as a fact, not inferred from a clock.

## The systematic bias — read this before quoting a number

Telemetry counts **gross churn**; git counts **net committed diff**. They are different
measures, and the difference is not a rounding error:

- An agent that writes a block and later rewrites it is counted **twice** in telemetry, once
  in git.
- Work that is written and then reverted or amended away before the commit is counted in
  telemetry and never appears in git at all.

The bias is therefore **always directional — it inflates the agent's share, never the
human's** — and per-file it can exceed 100%. Measured over one real change in this repo,
three of nine files came out above 100%, the worst at 129%. Clamping each file at
`min(agent, git)` bounds it; over that same sample, clamping moved the aggregate from 74%
to 73%, so the aggregate is considerably more trustworthy than any single file.

**Practical guidance**: quote the aggregate, clamp per file, and never present a per-file
percentage as precise.

### Worked example

From a single real session in this repo (agent lines from telemetry, totals from
`git diff --numstat`):

| File | agent | git | ratio |
|---|---:|---:|---:|
| `file-capture-check/extension.ts` | 579 | 597 | 97% |
| `golden/expected-authorship.json` | 56 | 53 | 106% |
| `file-capture-check/instructions.md` | 18 | 14 | 129% |
| `changes/…/design.md` | 5 | 185 | 3% |
| `changes/…/tasks.md` | 38 | 107 | 36% |
| **Total** | **737** | **995** | **74%** |

The two low rows are the interesting ones: both files were authored by a *different* agent
and only lightly touched by the one being measured. That is the mixed-authorship case
resolving sensibly — a file with two contributors splits by volume without needing any
line-level identity.

The `tasks.md` row also shows the gross-churn effect in miniature: most of those 38 lines
were checkbox ticks (`- [ ]` → `- [x]`), which register as one line added and one removed
each. That is *modification* being counted as *authorship*.

## What you can and cannot claim

**Supported:**

- Which files an agent touched, per session, timestamped.
- How much edit activity an agent put into each file.
- An aggregate agent share of committed lines, anchored per commit, clamped per file, and
  stated as approximate.

**Not supported:**

- Which specific lines an agent wrote. The data contains no line identity, so no amount of
  post-processing recovers it.
- An exact per-file percentage. The gross-churn bias forbids it.
- Line-level claims about `copilot-vscode`. Plan 066 gave it **path-level** file evidence
  (its store's `session_files` table → the `files.written/edited` lists, write-tools only),
  so *which* files an agent authored is known — but the store keeps no patch payloads, so
  per-file **deltas are unknowable** and it emits no `file` events. Line-based share for
  this surface must be reported as *unavailable*, never as zero contribution. (`cursor`
  has the full capability since plan 066: its `ApplyPatch` patches yield per-file deltas,
  at `interval` time precision when the session has no bubble timeline.)

> **Path-only authorship rows (plan 068).** The report's authorship table can
> now carry rows whose delta fields are `null` with a `delta_unavailable`
> marker — a surface that knows *which* file an agent wrote but not *how many
> lines* (see the per-surface ceilings above). For this method: such files are
> attributable by PATH but contribute nothing to line sums; never read a null
> delta as zero lines.

## Known blind spots

Capture is deliberately limited to agent Write/Edit tool calls. It does not see:

- files written via Bash redirects (`>`, `>>`, `tee`) or by MCP writers;
- surfaces that expose no per-file path (above);
- any commit made with no intervening capture flush — there is no segment to match, so those
  commits have no agent attribution rather than a zero one.

Each blind spot removes lines from the numerator only, which pushes the measured agent share
**down**, partially offsetting the gross-churn inflation. The two errors do not cancel in any
principled way, so do not treat their coexistence as accuracy.

**Adding a new agent tool that writes files requires updating this list**, or the share will
drift downward silently.

## If you need exact per-line attribution

The one change that would make the split exact is a **per-line fingerprint**: a short hash
per line written, carried on the `file` event. At commit time, hash the added lines in the
diff and intersect the sets.

That fixes both problems at once — a mixed file splits precisely, and gross churn collapses
because a set intersection counts a rewritten line once. It also keeps the privacy contract
intact, since hashes are stored rather than content. The open question is whether hashed
source lines are acceptable in published telemetry: short, common lines (`}`, `return;`) are
effectively reversible by dictionary attack.

That work is **not** proposed here. This doc describes what the existing data supports.

## Related

- [Telemetry](./telemetry.md) — capture, the field reference, and the wire contract.
- [Harness value measures](./harness-value-measures.md) — bypass and change rates, and the
  anti-Goodhart guardrails that apply equally to the share described here.
