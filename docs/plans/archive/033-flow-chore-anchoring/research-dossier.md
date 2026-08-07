# Research Dossier — flow-chore-anchoring

**Captured**: 2026-06-23 · **By**: /the-flow (1a explore) · **Mode**: Full

## Summary

When the `eng-harness-flow` ⚙️ loop runs alongside an active `the-flow.json`, it injects
its four fire-hooks (`pre-flight`, `pre-coding`, `post-coding`, `post-flight`) as **chore
nodes**. In the observed run (`~/substrate/minih/.../029-copilot-home-isolation/the-flow.json`)
those four chores were written as **orphan nodes** — no `branch_of`, empty `next`, and no
incoming edge — so they float disconnected from the `research → plan → ship` spine. The
render shows them as detached dashed boxes; `harness flow chores` reports `anchor: null` for
all four. There is therefore **no deterministic position** that tells an agent *when* to run
each hook, and **no read** the engine consults each turn that would surface a due hook — so
under context loss they get missed. They are decorative, not checks.

The engine already has every primitive needed to fix this (`branch_of` anchoring, dotted-edge
render, `listChores` anchor derivation). The defect is in the **skill's injection recipe**,
plus a missing **"due here" read** that would make an anchored chore an unmissable check.

## Findings

### Finding DEF-01: The injected chores are orphan nodes (anchor: null) — Critical
**Evidence**: `~/substrate/minih/docs/plans/029-copilot-home-isolation/the-flow.json` — the four
`ehf-*` nodes each carry `next:[]`, **no** `branch_of`, and nothing in the spine points to them.
`harness flow chores --path <that file>` → all four rows `"anchor":null`.
**Why it matters**: `listChores` derives `anchor` = `branch_of` → else first predecessor → else
`null` (`harness/cli/src/services/flow/flow-mutations.ts:210-213`). An orphan has neither, so
anchor is `null` and the renderer has no edge to draw → the boxes float.

### Finding DEF-02: The rail is misleading; the graph is the truth — High
**Evidence**: `harness flow rail` emits `◆─□─■─◆─[ □ ]─□─◇` — chores *look* interleaved with the
spine. But rail ordering is by **zone band + document order**, not edges
(`harness/cli/src/services/flow/flow-renderer.ts:58-70`, `ZONE_BY_TYPE` / banding). The mermaid
diagram (rendered) reveals the chores have no edges. So the one-line rail gives false confidence
while the actual flow has no structural link.

### Finding RC-01: Root cause is the skill recipe, not the engine — Critical
**Evidence**: `skills/eng-harness-flow/references/flight-plan-ops.md:131-133` — the AC-07
"Not found → add one" branch leads with `harness flow add-node --id ehf-<hook> …` and relegates
`insert-node --after <anchor>` to a parenthetical. `add-node` **appends with no edges** (it only
wires `--next` if passed, and never adds an incoming edge — `flow-mutations.ts` `addNode`). The
recipe also never pins *which* spine node each hook anchors to. An agent taking the documented
primary path necessarily produces orphans.

### Finding ENG-01: The engine already supports anchored chores — High
**Evidence**: `harness flow insert-node --branch-of <node>` sets `N.branch_of = X, N.next = [X]`
(`flow-mutations.ts:508`, `flow.ts:543-605`); the renderer draws `branch_of` as dotted
side-branches and excludes them from the rail (`flow-renderer.ts` excursion handling; the-flow
`flight-plan-ops.md:45-55`). So anchoring a chore via `--branch-of <spine-node>` makes it
connected, off-rail, and gives `listChores` a real `anchor`. **No schema change needed** — `chore`
is an orthogonal `{kind, importance}` marker already validated (`flow-schema.ts:292-312`).

### Finding ENG-02: `chores`/`nav show` cannot answer "what's due at the current node?" — High
**Evidence**: `harness flow chores` lists *all* chores with no position filter
(`flow.ts:404-423`, `listChores` `flow-mutations.ts:205-226`); `nav show` returns nav + neighbours
but **not** the chores anchored at `nav.now` (`flow.ts:248-262`, `navShow`). So even with anchored
chores, nothing the engine reads each turn says "before you leave this node, run hook Y." This is
the missing piece that turns an anchored chore into an unmissable **check**.

### Finding SEAM-01: the-flow already models these as anchored excursions — Medium
**Evidence**: `the-flow` (`references/harness-seams.md`; `00-routing.md:137-146`) emits harness
seam nodes (`harness-boot` pre-phase-1, `backpressure` pre-coding, `harness-retro`
post-coding/post-flight) as **`branch_of` excursions** off spine nodes. `eng-harness-flow`'s R-1
reconciliation (`flight-plan-ops.md:122-136`) is the single owner of the chore flag: if a seam
node already carries the hook command, **flag it in place** (`set-node --chore-kind`); else add
one. The "flag in place" path already yields an anchored chore — only the "add" path orphans. The
hook→spine-anchor map already exists implicitly in the seam map.

### Finding SEAM-02: Lifecycle → spine-anchor mapping is well-defined — Medium
**Evidence**: from the seam map + the harness-loop template
(`harness/cli/src/services/flow/schemas/harness-loop.template.json`):
`pre-flight`→ flow entry / before first phase; `pre-coding`→ after `plan` (before implement);
`post-coding`→ after the implement phase(s); `post-flight`→ after `ship`. These are exactly the
anchors the "add" path should use via `--branch-of`.

## Decision-relevant options

| Option | What | Determinism | Cost |
|---|---|---|---|
| A. Anchor as excursions | "add" path uses `insert-node --branch-of <anchor>` w/ explicit hook→anchor map | Connected + anchored; off-rail | Skill recipe only |
| B. Splice on-spine | `insert-node --after <anchor>` — chore becomes a spine node | Strongest (agent walks through it) | Clutters rail; breaks "chores off-spine" model |
| C. First-class "due" read | + `chores --at <node>` filter and surface due chores in `nav show` | Engine answers "what's due here" every turn | CLI change |

**Recommendation (carried into the plan): A + C.** Anchor on the "add" path (fixes the float +
populates `anchor`, reusing existing `branch_of` render), **and** add a position-aware "due" read
so an anchored chore becomes a deterministic check the guided engine surfaces at `nav.now`.
Reject B (violates the off-spine chore model; clutters the rail).

## Risks / constraints

- **Shared-context wording** (memory `skill-shared-context-no-never-language`): edits to
  `eng-harness-flow` modules must stay flow-agnostic — no context-wide prohibitions; state what the
  verb does and anchor it, don't forbid.
- **Idempotency must hold**: AC-07 dedup is keyed on the `--hook <X>` token
  (`flight-plan-ops.md:115-120`); the anchored "add" path must remain re-run-safe (byte-identical).
- **Standalone loop unaffected**: `.harness/loop.flow.json` already wires its nodes in sequence
  (`harness-loop.template.json`) — this work touches only the loop-as-chores-into-the-flow path.
- **`set-node` cannot re-parent** (`flight-plan-ops.md:72`): the "flag existing seam node" path
  stays `set-node`; only the "add" path gains `--branch-of` via `insert-node`.

## External research gaps
None — this is fully answerable from the repo (CLI source + both skills).
