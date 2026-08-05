# Workshop: Skills update inventory — adapting our flows to call `harness record`

**Type**: Integration Pattern / Migration
**Plan**: 012-harness-record-command
**Spec**: (pre-spec — grounded in [`../original-ask.md`](../original-ask.md))
**Created**: 2026-06-09T09:55:44Z
**Status**: Draft

**Value Thesis**: Inventories every place our skills *hand-write* harness records today and maps each to *calling* `harness record`, so the migration is a known, bounded edit-set — not a discovery exercise during implementation.
**Target Proof Level**: Implementation Ready (for the in-repo edits) / Decision Space (for the headline buffer question)
**Current Proof Level**: Decision Space → Preferred Direction

**Selected Value Axes**:
- **Migration Safety**: names the exact write-sites + back-compat read paths so nothing silently breaks.
- **Learning Compounding**: the move from prose-write to CLI-call is the doctrine fix ("strongest refusal surface") applied to our own loop.
- **Cross-Domain Coordination**: separates in-repo skills (we own + edit) from external pipeline skills (contract only).
- **Cost / Attention Reduction**: turns "carefully hand-edit YAML" into "call a command, fill a file."

**Related Documents**:
- Workshop 1 — record-type contract · Workshop 2 — CLI shape
- `skills/eng-harness-loop/eng-harness-3-observe/SKILL.md`
- `skills/eng-harness-loop/eng-harness-4-retro/SKILL.md` (+ `references/retro.schema.json`)
- `skills/eng-harness-loop/eng-harness-flow/{SKILL.md,references/*}`

---

## Purpose

Produce the **write-site inventory** and the **adaptation map**: where the current loop skills write to `docs/harness/...`, and how each changes to call `harness record` (and read from `.harness/records/`). Surface the one headline design decision (buffer vs direct-write) for the spec to resolve.

## Fresh Entrant Outcome

A fresh agent reaches **Implementation Ready** on the in-repo skill edits: they know which skills change, what each line becomes, and which paths migrate (with back-compat).

They should be able to:
- List every harness write-site and its new behaviour.
- Apply the path migration `docs/harness/...` → `.harness/records/...` with back-compat reads.
- Know which skills are out-of-scope (external pipeline) and only consume the contract.

## Key Questions Addressed

- Where do our flows write records today, and how does each adapt?
- Does `harness record` replace the observe→buffer→drain two-tier model, or just the file-creation step?
- What paths migrate, and how do we stay back-compatible with existing retros?
- Which skills do we edit here vs. leave to an external follow-up?

---

## Value Frame

| Field | Selection | Why It Matters |
|---|---|---|
| Target Proof Level | Implementation Ready (in-repo) | The edit-set must be buildable by `/plan-3`. |
| Primary Value Axis | Migration Safety | Inventory + back-compat = no silent breakage. |
| Supporting Value Axes | Learning Compounding, Cross-Domain Coordination, Attention Reduction | Doctrine fix; scope boundary; simpler skills. |
| Downstream Loop Improved | Every observe/retro session | Hand-written YAML → one CLI call + fill. |

---

## 1. Write-site inventory (current → adapted)

| # | Site (skill) | Today it writes/reads | Adaptation |
|---|---|---|---|
| W1 | `eng-harness-3-observe` | **appends** YAML entries to `docs/harness/_buffers/<agent>.session-buffer.md` | call `harness record retro` to obtain a session record path, then **fill/append entries** into that file (Option A) — or keep a buffer (Option B). *Headline decision §2.* |
| W2 | `eng-harness-4-retro --drain` | reads the buffer, **writes** `docs/harness/agents/<agent>/<date>/T….retro.md`, truncates buffer | the file already exists (created by `harness record`); `--drain` becomes **read + triage `[s/t/p/e/d/a]` + encode** over it — no envelope hand-authoring, no buffer roll-up |
| W3 | `eng-harness-4-retro --harvest` | scans `docs/harness/agents/**/*.retro.md` (+ legacy `docs/retros/*.md`); lifecycle status mutations in place | scan **`.harness/records/retro/*.md`** (new canonical) **+** keep old globs as **back-compat reads**; mutations unchanged |
| W4 | `eng-harness-4-retro` (bundled) | ships `references/retro.schema.json` (deployment mirror) | unchanged as the contract; the CLI's `RETRO_TEMPLATE` must **echo this schema** (single source of truth — Workshop 1 §2a) |
| W5 | `eng-harness-flow` SKILL + refs | narrates retro/governance paths; `--harvest --json` `harness` field reads `.harness/engineering-harness.md` | update narrated retro paths `docs/harness/agents/…` → `.harness/records/retro/…`; governance/history already in `.harness/` (consistent) |
| W6 | `README.md` / `skills/README.md` | describe the loop as buffer→drain→harvest | add `harness record` as the create step; note records live in `.harness/records/` |
| W7 | `eng-harness-1-boot` / `eng-harness-2-backpressure` | reference known-difficulties / `docs/harness/` surfaces | audit for `docs/harness/` path mentions; update any that point at retro/record locations (likely light) |

**External (contract-only — NOT edited in this repo):**

| # | Site | Note |
|---|---|---|
| X1 | `plan-6a-v2-update-progress` / `plan-6-v2-implement-phase-companion` (in `~/.agents/skills/`) | map minih farewell → universal retro, currently to `docs/harness/agents/…` / `docs/retros/…`. Adopting `harness record` is an **external follow-up**; this plan defines the contract they'd target. |
| X2 | `scripts/compound-value.sh` / `just compound-value` | referenced by `--harvest --json`; **do not exist** yet — out of scope (note only). |

---

## 2. Headline decision — buffer vs. direct-write  ✅ RESOLVED (2026-06-09)

The original framing was a false binary. **Resolution**: keep a buffer *and* use the record — they are two different things with two different lifecycles. The buffer is **crash-resilient working memory**; the record is the **durable, committed output**.

| Concern | Where | Git | Lifecycle | Owner |
|---|---|---|---|---|
| **Working scratch** (the buffer) | `.harness/temp/<agent>/…` | **gitignored** | ephemeral; survives `/compact`, not history | agent writes freely |
| **Durable record** (the output) | `.harness/records/<type>/<date>-<slug>.md` | **committed** | compounds forever | created by `harness record`, filled by agent |

**The resolved flow**:
1. **observe** jots entries into `.harness/temp/<agent>/…` as friction arises — cheap, gitignored, **survives compaction / context loss** (the buffer's true purpose).
2. at **drain**, those notes are triaged `[s/t/p/e/d/a]` and **materialized into a committed record** via `harness record retro` → `.harness/records/retro/…`.
3. **harvest** scans the committed records only — scratch is never harvested.

**Why this fits**: the buffer was never meant to be a record; it's the agent's persisted working memory so a compaction doesn't lose in-flight notes (same philosophy as `the-flow`'s on-disk state). Relocating it to `.harness/temp/` and **gitignoring it** makes the durable/transient split explicit, and generalizes it into a **general agent scratch area** — any in-flight artifact (not just retro notes) can live there.

**Falls out of the decision (all minor):**
- **Per-agent subdir** `.harness/temp/<agent>/` — same isolation the old per-agent buffer had; two agents don't trample.
- **Gitignore** `.harness/temp/` — a gitignored subpath inside the otherwise-committed `.harness/` (standard).
- **CLI touch (optional, lean=yes)**: `harness record` *ensures* `.harness/temp/` exists + is gitignored on first use; `doctor` reports the path. Otherwise temp is just a documented convention the agent writes to directly.
- **Scratch shape**: the retro scratch stays lightly structured (the entry YAML) so `--drain` can parse it into the record; freeform notes for anything else.

---

## 3. Path migration + back-compat

| Concern | From | To | Back-compat |
|---|---|---|---|
| Retro records | `docs/harness/agents/<agent>/<date>/*.retro.md` | `.harness/records/retro/<date>-<slug>.md` | `--harvest` reads **both** new + old globs during migration |
| Legacy minih retros | `docs/retros/*.md` | (unchanged — external) | `--harvest` keeps reading them |
| Observe buffer (scratch) | `docs/harness/_buffers/<agent>.session-buffer.md` | `.harness/temp/<agent>/…` (**gitignored**) | n/a — ephemeral, not migrated |
| Governance / history | `.harness/engineering-harness.md` / `.harness/history.md` | (already here) | — |

`.harness/` becomes the **single home** for harness state (governance doc, history, extensions, **records**) — the consistency the move was about. `.harness/` is committed, so records compound + are shared.

---

## 4. Edit-set summary (for `/plan-3` phasing)

| Skill / file | Change size | Depends on |
|---|---|---|
| `eng-harness-3-observe/SKILL.md` | **large** (W1; rewrite write-path per §2 decision) | CLI `record` exists; §2 resolved |
| `eng-harness-4-retro/SKILL.md` | **large** (W2 drain semantics + W3 harvest globs) | CLI `record`; §2 resolved |
| `eng-harness-4-retro/references/retro.schema.json` | small (W4; confirm it's the template's source of truth) | Workshop 1 Q1 |
| `eng-harness-flow/SKILL.md` + `references/*` | medium (W5 path narration) | paths finalized |
| `README.md` / `skills/README.md` | small (W6) | surface finalized |
| `eng-harness-1-boot` / `eng-harness-2-backpressure` | small/audit (W7) | grep for `docs/harness/` |

Natural phase order: **CLI first** (record command + retro core type) → **observe/retro skills** (the §2 decision) → **flow/docs path updates** → **harvest back-compat verify**.

## Evidence Ledger

| Evidence | Location | Supports | Status |
|---|---|---|---|
| Write-site inventory (W1–W7, X1–X2) | §1 | bounded edit-set | Ready |
| Buffer-vs-direct-write options | §2 | the headline decision | Decision Space |
| Path migration + back-compat table | §3 | no silent breakage | Ready |
| Edit-set + phase order | §4 | `/plan-3` phasing | Ready |

## Open Questions

### Q1: Option A or B (buffer vs direct-write)?  ⟵ headline
**RESOLVED (2026-06-09)** — neither/both: a gitignored **scratch buffer** at `.harness/temp/<agent>/` (crash-resilient working memory) feeds a committed **record** materialized at drain via `harness record`. See §2.

### Q2: Do we migrate existing `docs/harness/agents/**` retros, or just read them back-compat?
**OPEN — lean read-only back-compat.** No bulk move; `--harvest` reads old + new. A `--prune`/migrate utility is out of scope (deferred).

### Q3: Are the external pipeline skills (X1) in scope at all?
**RESOLVED**: No. This repo owns `skills/eng-harness-*` only. The plan defines the contract; adopting it in `~/.agents/skills/plan-6a*` is a separate external follow-up.

## Validation / Acceptance

Reaches Implementation Ready (in-repo) when:
- §2 is decided, so W1/W2 have a concrete target shape.
- Every in-repo skill that writes/reads a retro path is listed with its new behaviour (§1, §4).
- `--harvest` reads both new (`.harness/records/retro/`) and legacy globs (no existing retro becomes invisible).
- `RETRO_TEMPLATE` (CLI) and `retro.schema.json` (skill) are confirmed as one contract, not two drifting copies.
