# Execution Log — 026 the-flow cursor/meta migration (Phase 1, Simple)

**Branch**: `026-flow-nav-rail-zone` (cut from `main`; per-task commits, no push)
**Companion**: `code-review-companion` run `2026-06-18T08-39-20-769Z-0c4e` (Power-On Mode; reviews each commit live)
**Approach**: Full TDD; real fixtures; golden render fixtures regenerated via `scripts/flow-fixtures.mjs`, CI drift-guarded by `check:flows`.

> Facts + evidence only. Detail lives in the task table (plan) + diffs + test output.

## Commit plan (4 coherent, each green)
- **C1** nav core + `create --agent` (T001–T006, T011, T012) — the cursor→nav move in one pass (every reader migrated; clean break, no `cursor` verb/alias).
- **C2** per-node `zone` + default-by-type (T007, T008).
- **C3** `harness flow rail` + zoned/titled render shared by `render` (T009, T010) — regen fixtures.
- **C4** docs + dogfood flow 026 + final drift-guard (T013, T014).

---

## C1 — nav core + create --agent (T001–T006, T011, T012)

### Design (locked before code)
- `Nav { now: string; next: string | null; intent?: string; bag?: Record<string, unknown> }` on `FlowDoc.nav?` — replaces top-level `cursor`/`recommended_next` (removed).
- Mutations (`flow-mutations.ts`): `setNow` (E305; fires `cursor-moved {from,to}` — reuses the existing event kind), `setNext` (E305 when an id is given; `null` clears; advisory, **no** event — matches old `recommendNext`), `setIntent` (no event), `setMeta` (shallow-merge into `bag`), `getMeta` (read), `predecessorsOf`/`successorsOf` (shared neighbour util — extracts insert-node's reverse-edge scan, Finding 04), `navShow` (assembles `{nav, predecessors, successors}` with trimmed neighbours `{id,type,status,label,next}`).
- Act: `nav show|set|meta` group; **`cursor` verb removed** (clean break, Q2 — no alias). `create` gains `--agent`/`--plan-id`/`--title`.
- Readers migrated (grep-clean of live `doc.cursor`/`doc.recommended_next` field reads): `acts/flow.ts summary()` (→ `now`/`next`), `flow-renderer.ts` meta block (Cursor→Now), `flow-service.ts createFlow` (seeds `nav` from initial node; bare → no nav) + `listFlows`/`FlowSummary` (→ `now`). `isLegacyFlow`'s `'cursor' in doc` probe is KEPT (it detects pre-CLI legacy docs by the OLD field — a legacy-shape probe, not a live reader).
- Schema: `root.required` drops `cursor`; `root.optional` drops `recommended_next`/`now`/`next` (vestigial top-level placeholders, superseded by `nav`) and adds `nav`; `validateFlowDoc` validates `nav.now`/`nav.next` refs (replacing the dead cursor-ref check).

### Result — ✅ GREEN (T001–T006, T011, T012)
- TDD: nav-mutation tests authored → ran RED (10 fail: `navShow is not a function` etc.) → impl → GREEN.
- **Full suite 776 passed (74 files)**; `flow-fixtures --check` clean (no drift). `tsc` exit 0.
- Contract snapshot (`flow-envelope-snapshot`) regenerated: `data` shape `cursor`/`recommended_next` → `now`/`next` — the exact contract the-flow's skill migration will consume.
- Discovery: template descriptors keep a `cursor` **seed key** (the template DSL's initial-position indicator) — distinct from the migrated `doc` field, mapped into `nav.now` at create. Grep-clean of `doc.cursor`/`doc.recommended_next` field reads holds; `recommended_next` survives only in 2 comments. (Flagged to companion.)
- Decision: `--title` stores `doc.title`; rail title precedence (built C3) = `provenance.agent ?? doc.title ?? doc.slug` — AC-4's agent→slug still holds (title is an optional middle rung).

## C2 — per-node zone + default-by-type (T007, T008) — ✅ GREEN
- `zone?` on `FlowNode` + `NodeSpec` + `materialize`; `--zone` on `add-node`/`insert-node`; schema `node.optional` += `zone` (regenerated `schemas-content.ts`).
- `effectiveZone(node)` (flow-renderer, exported): explicit valid zone → type default (research/plan/workshop/tasks/adr = preflight; phase = flight; review/merge/retro = postflight) → **flight** (total map; unknown type never errors — AC-3).
- No render change yet (rail consumes `effectiveZone` in C3) → no fixture drift. Full suite **782 green**; tsc clean.
