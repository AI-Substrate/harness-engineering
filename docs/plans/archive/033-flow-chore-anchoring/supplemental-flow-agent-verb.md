# Supplemental Task — `harness flow agent` verb (populate `agents[]`)

> **Supplemental to plan 033.** Origin: 033's retro **MW-001** + render-richness finding
> (`.harness/records/retro/2026-06-23/001-033-flow-chore-anchoring.md`). Riding along on the
> current branch — **not a new plan, not new invention**. We are patching one gap: the write
> path for an `agents[]` array that the schema and renderer already support.

## The gap (one paragraph)

`agents[]` is **already allowed** by the flow contract (`flow.schema.json` — `root.optional`
line 41 *and* `node.optional` line 15) and **already rendered** (`renderAgents`,
`flow-renderer.ts:520` — companions → a `🤖` subgraph wrapping covered phases; workers → a
`🛠` side node with `-. builds .->` edges). What is missing is the **write path**: there is no
`harness flow agent` verb and no `addAgent`/`setAgent` mutation, so every CLI-driven flow
renders `agents: []`. the-flow's hard invariant #7 names this exact gap: *"Agent bookkeeping
into the flight plan awaits the v2 `harness flow agent` verb — until it lands, `agents[]` stays
unpopulated."* This task lands that verb.

## What already exists — do NOT re-build

| Already done | Where |
|---|---|
| `agents[]` allowed at root **and** per-node (tolerant validator, no `additionalProperties:false`) | `flow.schema.json:15,41`; `schemas-content.ts:21,41`; `flow-schema.ts:216` |
| `FlowAgent` shape `{ slug?, kind?, render?, covers?, result? }` | `flow-renderer.ts:512` |
| Render: companion (`kind:companion`/`render:wrap`) → subgraph; worker (`kind:worker`/`render:side`) → side node | `flow-renderer.ts:520–548`, called at `:296` |
| Mutation conventions to mirror (`addNode` reject-dup, `setNode` merge, `buildBuiltinEvent`, `runMutation`) | `flow-mutations.ts:399` (`addNode`), `:445` (`setNode`); `flow-events.ts:143,248` |
| Nested-subcommand act pattern (`flow nav` → `show`/`set`/`meta`) | `acts/flow.ts:245–362` |

## Scope (KISS)

**In:** the `agents[]` write path in *this* repo — mutation + act + event + light validation +
tests + docs. **Out (noted follow-ups, separate work):** relaxing the-flow invariant #7 so its
`implement` verb *calls* `flow agent add` after a companion run (cross-repo `tools`); and the
auto-capture richness items in MW-001 (genesis from `nav.intent`, auto-note on `status→done`).
Don't do those here.

## Tasks

| Task | Description | Done-When |
|---|---|---|
| A01 | Add `addAgent(doc, spec, deps): MutationResult` to `flow-mutations.ts`, mirroring `addNode`: init `doc.agents = []` when absent, **reject duplicate `slug`** (point at `agent set`), push the entry, fire a builtin `agent-added` event. Spec shape `{ slug, kind, render?, covers?, result?, run_id?, note? }`. | `addAgent` appends to `agents[]`, dup slug → `INVALID_ARGS`, fires `agent-added`. |
| A02 | Add `setAgent(doc, slug, fields, deps): MutationResult`, mirroring `setNode`: merge fields into the matching agent (never reassign `slug`), fire `agent-updated`; missing slug → `INVALID_ARGS`. This is the companion **result-recording** path. | `setAgent` merges fields, fires `agent-updated`, unknown slug errors. |
| A03 | Register event kinds `agent-added` / `agent-updated` in `BUILTIN_PREFIX` (`flow-events.ts:143`) with a prefix (e.g. `AGT`). | Both kinds resolve a stable id prefix; no `derivePrefix` fallback. |
| A04 | Add a `flow agent` parent act in `acts/flow.ts` (mirror `nav`) with children `add` / `set` / `list`. Flags: `--slug` (req), `--kind <companion\|worker>`, `--render <wrap\|side>`, `--covers <ids>` (comma list), `--result`, `--run-id`, `--note`, plus `--path`/`--slug`. `add`/`set` use `runMutation`; `list` prints `agents[]` (table + `--json`). | `harness flow agent add/set/list` work end-to-end; `--json` envelopes match sibling verbs. |
| A05 | Light validation only (keep validator tolerant): `kind ∈ {companion,worker}`, `render ∈ {wrap,side}` (default by kind: companion→wrap, worker→side), and each `--covers` id resolves to a known node. Invalid → `INVALID_ARGS` with a fix hint. | Bad kind/render/covers rejected; valid passes; pass-through fields (`run_id`,`note`) round-trip. |
| A06 | Tests (`test/services/flow/flow-agent.test.ts`, `loopDoc()` helper): `add` populates `agents[]`; `render` emits a companion subgraph **and** a worker side node; dup-slug rejected; `set` merges `result`; unknown `--covers` rejected; idempotent re-render byte-stable. | `cd harness/cli && npx vitest run` green; cases cover add/set/list/render/validation. |
| A07 | Doc the verb in `docs/how/harness-flow.md` (the `agent` family + a populated-render example); run `npm run build` (gen:docs+gen:flows+tsc), `npm run check:docs`, `just fft`. | Doc updated; build + docs-sync + lint/test all green. |

## Acceptance

A CLI-driven flow can record a companion/worker run and `harness flow render` shows the
agent overlay (subgraph / side node) — closing the "deterministic renders look lean vs.
hand-authored" finding from 033 without any hand-edited JSON (the-flow invariant #6 intact).

## Trace

- Origin: 033 retro **MW-001** (`flow agent` verb) + render-richness observation (`agents[]=0` because no write verb).
- Unblocks: the-flow invariant #7 (`agents[]` "awaits the v2 `harness flow agent` verb").
- Convention anchors: `addNode`/`setNode` (mutations), `flow nav` (nested act), `buildBuiltinEvent` (events), tolerant `validateFlowDoc`.
