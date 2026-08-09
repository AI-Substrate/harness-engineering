# git-ai — attribution algorithm and correctness machinery

**Source**: the `git-ai` checkout @ `7df7e2069`. Citations `file:line`.

---

## Thesis

git-ai does **not** derive AI share by joining telemetry to `numstat`. It builds a
**persisted line-level ledger** in `.git/ai/working_logs/` from per-tool-call content
snapshots, then at commit time **projects** that ledger onto the committed tree and
writes surviving line ranges into `refs/notes/ai`.

The AI share is therefore a **survivorship measurement by construction**, not a
proposals-minus-residual estimate. That is the genuine architectural advantage.

The genuine weaknesses: (a) the note format **discards gross churn entirely** for
modern sessions, (b) a post-commit recovery ladder that **manufactures** attribution
— including fabricated *known-human* attestation with no evidence — which converts
the honest "untracked" class into false positives, and (c) a hard dependency on a
live daemon whose absence fails silently.

---

## 1. End to end

| Stage | What happens | Fails how |
|---|---|---|
| 1 · Hook | Agent's own `PreToolUse`/`PostToolUse` fires `git-ai checkpoint <agent>`. No periodic sweep, no git hook | agent not hooked → no checkpoint ever; bash-tool edits fall to an **mtime watermark** path |
| 2 · CLI | Reads file content **at hook time**, posts a `CheckpointRequest` over a unix socket | **every error path `exit(0)`** (`git_ai_handlers.rs:584-587`). No spool, no retry, no local fallback. Daemon reconstruction from disk is explicitly forbidden (`daemon/checkpoint.rs:562-567`) |
| 3 · Daemon | Diffs prev-blob vs current, re-attributes at line **and character** level (imara-diff/Myers) | ignored/binary/over-budget files dropped silently and folded into whoever checkpoints next |
| 4 · Persist | `checkpoints.jsonl` + `blobs/<sha256>` + `INITIAL` | JSONL **rewritten whole** on every append; >1 GiB → **deleted and recreated empty** |
| 5 · Commit detect | trace2 → normalizer → family actor → `RefCursor::enrich_command` | no exact ref transition → opaque result, **no note at all** |
| 6 · Projection | Reconciles working log against `git diff <commit>^ <commit> -U0`. **The index is never read** — staged-vs-unstaged is *inferred* | positional translation drift (§7.4) |
| 7 · Recovery | Five-stage ladder over uncovered lines (§7.1) | manufactures attribution |
| 8 · Write | `write_note` — **unconditional**, no empty-note guard | "has a note" ≠ "has attribution" |

Checkpoint admission gates side effects (`daemon.rs:4611-4618`), so a checkpoint that
arrived before a commit is guaranteed on disk before post-commit reads it. The reverse
ordering is **not** gated — a late checkpoint can only be picked up by recovery.

---

## 2. AI additions vs accepted vs overridden

| Quantity | Definition | Where |
|---|---|---|
| `total_additions` (gross churn) | Σ of every checkpoint's `line_stats.additions` — every line ever written, including thrown away | `virtual_attribution.rs:476-479` |
| `accepted_lines` | lines still carrying that author's ID in the final set | `virtual_attribution.rs:2985-2999` |
| `overriden_lines` | lines whose `overrode` names that session | `virtual_attribution.rs:3001-3015` |

### The structural answer to gross churn

**git-ai solves "agent writes 500, 50 survive" by never counting the 450.**
Attestation covers only lines that (a) still carry the AI's author ID after every
later checkpoint's diff and (b) fall inside a hunk of the actual commit diff. Dead
code has no line range. This is a *measurement*, not an estimate.

### But the note throws the number away

```rust
pub struct SessionRecord {
    pub agent_id: AgentId,
    pub human_author: Option<String>,
    pub custom_attributes: Option<HashMap<String, String>>,
}
```
`authorship_log.rs:217-222` — and the spec mandates it: *"Session records MUST NOT
contain … stats fields."* `SessionRecord::to_prompt_record()` fills all four with zero.

Stats exist **only in the legacy pre-v1.4.0 `prompts` map**. For any repo on
git-ai ≥ 1.4.0, **the note contains no gross-churn signal and no acceptance ratio.**

### And commit-level acceptance is 100% by construction

```rust
// AI additions = ai_accepted (no mixed component)
commit_stats.ai_additions = commit_stats.ai_accepted;
```
`stats.rs:438-439`, with the comment at `:196`: *"(ai_additions == ai_accepted after
mixed removal, so acceptance is always 100%)"*.

The `committed` telemetry event carries both from that same source. **A reader cannot
distinguish "AI wrote it and it stuck" from "AI wrote 10× and 1× stuck."**

Churn survives only in the local metrics SQLite (`CheckpointValues.lines_added` per
file per checkpoint). So computing the churn ratio requires **joining the telemetry DB
against the note** — architecturally the same join harness does. git-ai's real edge is
not avoiding the join; it is that the *denominator side* (which lines survived) is
proven per-line rather than inferred from `numstat` totals.

---

## 3. Line shifting

**Between checkpoints**: diff base is the previous checkpoint's blob. The
`PreToolUse` → `CheckpointKind::Human` snapshot is what freezes an intervening human
edit. **If that pre-hook doesn't fire, the human's lines appear inside the AI
checkpoint's diff and are attributed to the AI** — there is no timestamp arbitration
inside a checkpoint. For a never-checkpointed file, everything not covered by INITIAL
is explicitly given to the AI (`daemon/checkpoint.rs:793-806`).

**Formatters between last checkpoint and commit**: reconciled by a 3-way merge
anchored on lines `Equal` on both sides, then shifted through
`apply_hunk_shifts_to_line_attributions` — which builds **preserved segments outside
every hunk** and emits only the intersection. **Anything inside a changed hunk is
dropped, not remapped.** So a formatter run converts reformatted AI lines to
**untracked** (fail-closed) — and then recovery may re-assign them.

**Whitespace**: CRLF↔LF treated as no change. Indentation and trailing whitespace are
**not** normalised — a reindent re-attributes.

**Move detection** — `detect_moves` matches contiguous deleted runs to inserted runs
by exact `trim()` equality, threshold 3 lines. Two hard limits:

```rust
let move_mappings = if is_ai_checkpoint {
    // AI formatting/refactor checkpoints should attribute rewritten regions to AI
    // instead of preserving original ownership through move detection.
    Vec::new()
```
`attribution_tracker.rs:580-584`. **Move detection is disabled entirely for AI
checkpoints** — an AI that relocates a human's 300-line function claims all 300 lines.
Also skipped on files ≥64 KiB with heavy churn, or >256 ops.

**Overlap resolution** is simply latest-timestamp-wins — and timestamps are stamped
**in the daemon at processing time**, not at hook-read time, so ordering reflects IPC
arrival, not edit reality.

---

## 4. The exactness / fail-closed model

The rule (`docs/daemon-trace2-ingestion-spec.md:22-36`): transitions are exact iff
either a **pre-command reflog cursor** (byte offset + full-record anchor) or
**immutable argv OIDs**. Otherwise fail closed — no guessed authorship, no note
migration; the command may only serve as a future baseline.

**The banned list, verbatim** (`:37-40`):

> Banned as ownership proof (each was tried and failed; see Postmortem):
> reflog timestamps (seconds-resolution, not causally tied to a trace2 root),
> commit/reflog message matching (messages collide), latest-HEAD guessing, and
> daemon-ingress "start" offsets captured after the fact.

The postmortem (`:186-204`) additionally retires mtime-guarded worktree snapshots,
live-worktree stash restore, and trace2 barriers — *"These were implemented, found
unsound, and removed. Do not reintroduce."*

Rewrite invariants (`docs/rewrite-ops-spec.md:31-54`): **I1 Evidence** (*"No inference
from similarity, timestamps, or 'probably the same line'"*), **I2 Conservation**,
**I3 Immutability**, **I4 Fail-closed** (*"attribution gaps are acceptable;
misattribution is not"*).

**Two places the banned evidence has crept back:**

1. `command_start_offset_is_authoritative` returns `true` unconditionally for
   `common:` refs when no existing offset is held (`ref_cursor.rs:2072-2077`) —
   weaker than the doc's own acceptance test.
2. `clamp_seed_to_own_entry` / `cold_seed_match_spec` reintroduce **reflog
   message-prefix matching** in the cold path. Defensible (clamping can only lose
   attribution, never steal) but it is banned item 6 running on a conservatism
   argument rather than a proof.

---

## 5. Rewrite handling

One entry point, `handle_rewrite_event`, taking exact SHAs. Core shift: batch-read
notes → **one** `git diff-tree --stdin -p -U0 -M -r` for all pairs → preserved
segments → shift, carry renames, **drop anything overlapping a hunk** → merge → stamp
`base_commit_sha` → batch-write. O(1) git spawns per batch.

| Operation | Grade |
|---|---|
| Rebase / amend / restack / `branch -f` | **Genuinely handled** — `git range-diff` derives old→new mappings; covers reorder, edit, drop, split, squash |
| Cherry-pick | Handled — `git patch-id --stable` pairing, positional gap-fill for the remainder (sound only because both sequences are exact) |
| Squash merge | Handled; `merge --squash <branch>` delayed-and-cold needs a cursor |
| Reset soft/mixed | Handled — reconstructs from **trees**, never the live worktree |
| Stash / revert | Handled |
| `commit-tree` + `update-ref` (Graphite) | Handled via the update-ref transition |
| Conflict resolution | Deliberately fail-closed; the legacy positional remap was **removed** as an I1 violation |

**Caveats**: line-based only — *"Content rewritten inside a hunk loses old attribution
even if a human would call it 'the same line, reworded'."* And **`lite_mode` disables
note migration for rewrites entirely** (default false, but remotely settable).

**Correctness pressure** — the fuzzer (`docs/attribution-fuzzer-spec.md`) maintains an
**independent** expected-attribution model that never reads notes or blame, gives every
line a unique Unicode identity, and asserts **all three classes** after every commit and
every rewrite. Every find must become a minimized deterministic regression. This is the
single best evidence artefact in the comparison.

---

## 6. The three-way model, and where it is surfaced

| Class | Key | Meaning |
|---|---|---|
| AI | `s_<14hex>::t_<14hex>` or legacy 16-hex | agent session + per-checkpoint trace |
| Known human | `h_<14hex>` | *"explicitly observed being typed by a human in an IDE with the git-ai extension installed"* |
| **Untracked** | *no entry* | *"git-ai has no data on their provenance"* |

**`git ai stats` is the only good surface** — `unknown_additions` rendered as a
distinct `·` bar segment. **`git ai blame` does not distinguish untracked from
known-human by default**; `--mark-unknown` fires only in the no-note-at-all branch;
`blame --json` emits **AI lines only** so it cannot produce a coverage denominator;
`--porcelain`/`--incremental` ignore note attribution entirely.

Three things degrade coverage reporting:

1. Untracked below **1%** is suppressed and its bar width handed to **AI**.
2. `write_stats_to_markdown` — the PR-comment surface — folds untracked into human:
   `let pure_human = stats.human_additions + stats.unknown_additions;` (`stats.rs:326`).
   That is exactly the residual model the design otherwise avoids.
3. The recovery ladder deletes the untracked class outright in the common case.

---

## 7. Critique

### 7.1 Recovery manufactures attribution — the biggest hole

`recover_attribution` runs a five-stage ladder over every uncovered added line, and it
is passed `None` for pathspecs — so it sees lines in files that **never produced a
checkpoint at all**.

| Stage | Evidence | Assessment |
|---|---|---|
| `recover_bash_mtime` | file mtime inside a recorded Bash-call window | Lowest tier is **`TimeOnly`** — a Bash call from a *different repository* can claim lines on a timestamp coincidence. Banned item 5 re-implemented on file mtimes |
| `recover_adjacent_edges` | AI attestation on neighbours, ±3 lines | Pure heuristic, and **asymmetric** — `is_ai_attestation` excludes `h_`, so AI spreads and human never does. Systematic AI over-report |
| `recover_session_event_mtime` | mtime within 3 s, **same repo URL only** | The most disciplined stage |
| `recover_commit_metadata` | `Co-authored-by:` trailers or agent-looking author | Weak. Cascade ends in a **random session id with `model: "unknown"`** claiming every unknown line in every file. No time bound; accepts `UnknownRepoUrl` |
| `recover_remaining_as_known_human` | **none** | See below |

**The terminal stage is the worst.** It mints `h_<hash(committer)>` for *all*
remaining unknown lines:

```rust
fn should_recover_remaining_as_known_human(authorship_log: &AuthorshipLog) -> bool {
    for entry in ... {
        if entry.hash.starts_with("h_") { return true; }
        has_ai_attribution |= is_ai_attestation(&entry.hash);
    }
    !has_ai_attribution
}
```
`attribution_recovery.rs:661-674`

So **every commit with no AI attestation gets blanket `h_` known-human attestation**,
and any mixed commit already containing one `h_` entry gets the rest as human too.

This **directly contradicts their published standard**, which defines `h_` as lines
"explicitly observed being typed by a human in an IDE with the git-ai extension
installed… distinct from 'untracked'". In a repo with no IDE extension, every human
commit carries fabricated `h_` attestations indistinguishable from real ones,
`unknown_additions` reads 0, and the honest third class is destroyed exactly where it
would have been most informative. The provenance grade exists only in the telemetry
event, never in the note.

**Also**: background-agent hole filling gives *every* unattributed committed line to an
agent detected purely from env vars or a `/opt/.devin` directory probe, `model: "unknown"`.

### 7.2 Fail-open heuristics inside the core projection

- **Neighbour gap fill** — a gap line bracketed by the same non-`h_` author both sides
  is given to that author.
- **Content gap fill** — if the gap line's *text* matches any AI-attributed line
  **anywhere in the file**, it goes to that AI author. Comment concedes it:
  `// likely part of the same AI edit`. Unbounded — a repeated `}` will do it.
- **Rename carry-forward is asymmetric** — AI lines outside committed hunks are
  force-attested "so blame doesn't fall back to the git committer", while `h_` lines
  are explicitly excluded.

Neither gap-fill exists in the index-only path, so **the same commit can attribute
differently depending on which code path runs**.

### 7.3–7.6 Other

- **Move detection disabled for AI checkpoints** — the largest *systematic*
  over-report vector under normal use.
- **Partial staging is positional, not diff-based** — `git add -p` splitting hunks
  causes silent drift; a wrong line number is still a valid attestation.
- **No daemon → `exit(0)`, no note at all.** Discoverable only via
  `range_authorship`'s "commits without Authorship Logs".
- **Missed hook → the next AI checkpoint's diff base is stale**, so both the human's
  and the agent's intervening changes land on the agent.
- **Non-daemon CLI post-commit** passes `None` for captured timestamps, so recovery
  `stat()`s the **live worktree** with no preflight barrier — reintroducing exactly
  the staleness class I3 exists to kill.
- **Two independent accepted-line implementations** (range-intersection vs
  blame-based) with no cross-check.
- **Blame and diff disagree** on note-less commits — blame fabricates authorship from
  an agent-email heuristic; diff reports `[no-data]`.

---

## The sharpest question to put to them

> If `h_` is minted with no evidence whenever a commit has no AI attestation
> (`attribution_recovery.rs:661-674`), what is the actual measurable meaning of your
> "known human" class and your "untracked" coverage number?
