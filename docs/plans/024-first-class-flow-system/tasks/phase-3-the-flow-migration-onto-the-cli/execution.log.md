# Execution Log — Phase 3: the-flow migration onto the CLI

> Plan: [`first-class-flow-system-plan.md`](../../first-class-flow-system-plan.md) · Tasks: [`tasks.md`](./tasks.md)
> Started: 2026-06-18 · Mode: **Full**, CS-4 · **plain implement** (no companion — this phase's substance is cross-repo in `~/github/tools/skills/SDD/the-flow/`, which a companion booted in harness-engineering can't see; reviewability is via the pasted command transcripts below + a stage-7 review).
> **Cross-repo**: T001 is in-repo (harness-engineering); T002–T007 edit the **the-flow SOURCE** (`~/github/tools/skills/SDD/the-flow/`). Per the no-vendor rule the-flow is never copied here. CLI used for smokes: global `harness` **v0.4.0** (the consumer surface the-flow actually calls); built HEAD for byte-exact `render`.

---

## T001 — Re-run AC-08 contract snapshots + mirror verify ✅

**Snapshot half (the real CI gate)** — built the CLI from HEAD, re-ran both frozen contract suites:

```
$ npm run build      # gen:docs (7) + gen:flows (2 schemas + 1 template) + tsc → clean
$ cd harness/cli && npx vitest run test/contract/hooks-snapshot.test.ts test/contract/flow-envelope-snapshot.test.ts
 Test Files  2 passed (2)
      Tests  5 passed (5)
```

Pass unchanged → confirms the consumer-side phase touches no CLI contract. [AC-08 checkpoint 2; Finding 01; plan 3.1]

**Mirror half (discipline check, not CI)** — compared the-flow `references/harness-seams.md` (`harness_seam_contract: v1`) against the live installed router `~/.agents/skills/eng-harness-flow/SKILL.md`:

| Mirrored fact | the-flow mirror (v1) | Live router | Match |
|---|---|---|---|
| Hooks | pre-flight · pre-coding · post-coding · post-flight (+`coding` unwired) | pre-flight · pre-coding · `coding` · post-coding · post-flight (5) | ✅ |
| `--event` aliases | session-start→pre-flight · pre-implement→pre-flight · post-spec→pre-coding · phase-end→post-coding · plan-complete→post-flight · task-pause→coding | same 6→5 map | ✅ |
| decision enum | route · redirect · noop · ambiguous (+ additive `hook`) | route · redirect · noop · ambiguous | ✅ |
| Boot verdicts | healthy · SLOW · UNHEALTHY · UNAVAILABLE | HEALTHY · SLOW · UNHEALTHY · UNAVAILABLE | ✅ (cosmetic case only) |
| `--hooks` manifest | `{ manifest_version, hooks[5] }` | `{ manifest_version, hooks[5] }` | ✅ |

**Verdict**: mirror matches the live contract. The only delta is cosmetic (`healthy` vs `HEALTHY` in docs) — the-flow narrates verdicts **verbatim from the router envelope** at runtime, so there is no behavioral impact and **no `harness_seam_contract` bump** is required.

---

## T002 — Consumer-contract smoke (RED) ✅

the-flow is a prose skill with **no vitest** → the "test" is a reproducible `harness flow` smoke sequence recorded here (argv + ok/err Envelope + exit code). **RED first** (before T003): `create flight-plan --schema <the-flow's CURRENT draft>` must fail, because the draft is a JSON-Schema document, not a CLI overlay descriptor.

```
$ harness --version
0.4.0
$ harness flow create flight-plan --slug smoke-p3 \
    --schema ~/github/tools/skills/SDD/the-flow/references/flight-plan.schema.json \
    --path ./.flow-smoke-p3.json --bare --json
{"command":"flow","status":"error","timestamp":"2026-06-18T04:09:49.655Z","error":{"code":"E300","message":"schema for \"flight-plan\" is not a valid flow overlay (needs string \"kind\" + \"statuses\"[] + \"nodeTypes\"[])."},"next_action":"Author the overlay with kind + statuses[] + nodeTypes[] (see harness-loop.schema.json)."}
exit=1     # no file written (clean RED — nothing partially created)
```

RED confirmed — the draft cannot drive `create`. The capability-floor abort path + the GREEN round-trip are recorded under T003 (which authors the descriptor that turns this GREEN). [AC-09; CD-05; plan 3.2]

---

## T003 — Descriptor-format flight-plan schema + create-seed ✅

Re-authored `references/flight-plan.schema.json` from the reference-only JSON-Schema draft into the CLI **descriptor** format (exemplar: `harness-loop.schema.json`) — `{ kind, extends, schema_version, description, statuses[], nodeTypes[] }`. The shared-core (`flow-core`, bundled) supplies the node/root field shapes; the overlay declares only the flight-plan `statuses` (done/in_progress/blocked/known/assumed) + `nodeTypes` (research, deep-research, spec, workshop, adr, backpressure, plan, phase, fix-loop, review, merge, harness-boot, harness-retro).

**GREEN — create resolves + validates** (turns the T002 smoke GREEN):

```
# 1) --bare → ok (descriptor resolves; minimal flow validates)
$ harness flow create flight-plan --slug smoke-p3 --schema <abs>/flight-plan.schema.json --path ./.flow-smoke-p3.json --bare --json
{"status":"ok","data":{"kind":"flight-plan","cursor":"","node_count":0,"event_count":1}}   exit=0

# 2) worked-example template deep-copies + validates (preserved as a valid seed — 17 nodes)
$ harness flow create flight-plan --slug smoke-tpl --schema <abs> --template <abs>/flight-plan.template.json --path ./.flow-smoke-tpl.json --json
{"status":"ok","data":{"kind":"flight-plan","cursor":"p3","node_count":17,"event_count":1}}   exit=0
```

**Wrong-flow node REJECTED at create** (harness-loop template's `boot/observe/retro/improve` into the flight-plan schema):

```
$ harness flow create flight-plan --slug reject-test --schema <abs> --template <harness-loop.template.json> --path ./.flow-smoke-reject.json --json
{"status":"error","error":{"code":"E300","message":"… node boot: type \"boot\" is not valid for flow kind \"flight-plan\" (allowed: research, …, harness-retro); node observe: …; node retro: …; node improve: …"}}   exit=1   # no file written
```

**Consumer-contract round-trip (the T002 smoke, now GREEN)** — on the 17-node template flow, threading `data.path`:

| Step | Call | Result |
|---|---|---|
| cursor | `cursor --to p4` | ok (cursor→p4, event 2) |
| status | `status --node p3 --to done` | ok (status-changed; ran_at stamped; event 3) |
| insert · phase-reveal | `insert-node --after p3 --id p3b --type phase` | ok (N takes p3's out-edges → 18 nodes, +2 events) |
| insert · excursion | `insert-node --branch-of p4 --rejoin p4 --id ws3 --type workshop` | ok (branch_of set; p4.next unchanged → 19 nodes) |
| set-node | `set-node --node p4 --user-input "…"` | ok (verbatim capture; node-updated) |
| comment | `comment --node p4 --text "…" --source agent --kind note` | ok (timestamped comment) |
| render | `harness flow render --path …` | ok (deterministic `.md`) |

**Schema read-guard at an out-of-repo absolute path**: the schema lives outside harness-engineering (`~/github/tools/.../flight-plan.schema.json`, ~3 KB) and `--schema` read it fine — canonicalized, JSON-only, <256 KB, isWithin-exempt. The **deployed** path (`~/.agents/skills/the-flow/...`) is re-verified in T007. **No schema copy** landed in harness-engineering (only the the-flow source was written). [AC-11; Findings 05/07; grill 6/7; plan 3.5]

### ⚠️ Finding (decision input for T004) — the overlay is enforced at CREATE, not at mutate-time

The mutation verbs (`cursor/status/add-node/set-node/insert-node/comment`) carry **no `--schema` flag** and do **not** re-enforce the overlay vocabulary for a `--schema`-only flow like flight-plan (not bundled, not in `.harness/schemas/flows/`, so the act can't resolve the overlay at mutate-time). Proof: `add-node --type not-a-flight-plan-type` returned **ok** (not E300). `flow-mutations.ts` is explicit — mutations enforce only **mechanical integrity** (node existence → E305; edge DAG → E309); the overlay status/type vocabulary is checked by the act's post-mutation `validateFlowDoc` **only when a schema resolves** (create with `--schema`, or bundled types).

**Consequence for the migration**: the-flow must (a) pass `--schema <flight-plan.schema.json>` at **create** (overlay enforced + seed validated — done), and (b) construct mutation calls with correct types/statuses itself (the engine owns the flight-plan vocabulary; there is no mutate-time guardrail). The Phase-2 renderer's unknown-type fallback ("never crash") is the safety net. This refines the dossier's gotcha ③ (create-time, not mutate-time, for `--schema`-only flows). Not a CLI defect and out of Phase 3 scope to change (consumer-side phase); recorded for T004 + as candidate future CLI hardening (a `--schema` on mutations, or persisting the resolved overlay path in the doc).

---

## T004 — Replace the hand-crank with `harness flow` calls ✅

Edited the **the-flow SOURCE** (`~/github/tools/skills/SDD/the-flow/`). The 4-step "you are the generator" hand-crank in `references/00-routing.md` § Flight plan is replaced by a **CLI-driven cadence**: `status`/`set-node`/`comment`/`cursor` for per-turn mutation, **`insert-node --after`** for phase-reveal, **`insert-node --branch-of [--rejoin]`** for workshop/fix-loop/backpressure excursions, `add-node` for plain new nodes — threading each ok Envelope's `data.path`. Integrity is the CLI's (E305 existence, E309 DAG; overlay validated at create via `--schema`).

Also converted to CLI calls (no hand-edited JSON anywhere):
- **Fresh-start init** (§ Fresh start step 6): `create flight-plan --schema <skill base>/references/flight-plan.schema.json --bare` → seed spine via `add-node` → `render`.
- **Resume** (§ Resume): "drive `the-flow.json`/`.md` via `harness flow` calls" (was "hand-crank …").
- **coach.md** L19 ("hand-crank the flight plan" → "update the flight plan via `harness flow` calls") + the adoption **back-fill** (`create` + `add-node`/`status`/`set-node` + `render`, never hand-write the JSON).

**Verification — repo-wide residue sweep** across `00-routing.md` + `coach.md`:

```
$ grep -nE "hand-crank|you are the generator|Mutate the JSON|Regenerate `the-flow.md`" 00-routing.md coach.md
# only matches are the NEW correct prose ("you NEVER hand-edit", the reframed invariant, the legacy note) — zero hand-crank INSTRUCTIONS remain
```

The "regenerates both halves" lines in coach.md (L222/231/316) are the **plan verb** (spec+plan), not the-flow.json — correctly left. [AC-09/AC-13; CD-02; ws-003; plan 3.3 core; AC-15 mode→excursion mapping proven in T003]

---

## T005 — Delete the redundant render-rule + cadence prose ✅

In `references/00-routing.md` § Flight plan:
- **Deleted** the 8 mermaid render rules (flowchart/classDefs, spine vs excursions, harness-node styling, status→class, 🗣 bubble, 💬 badge/body-log, decision rhombus, agents subgraph/side-node, legend) — the CLI's `flow-renderer.ts` (Phase 2) owns them all. Replaced with a one-line **`harness flow render --path … --output …`** pointer + a GitHub link to [`docs/how/harness-flow.md`](https://github.com/AI-Substrate/harness-engineering/blob/main/docs/how/harness-flow.md).
- **Reframed** the status block: kept the **status vocabulary + transitions** (mutation knowledge passed to `status --to`), dropped the render-colour mapping (the renderer's).
- **Reframed** the invariant: `the-flow.md` is "always regenerated from `the-flow.json` by `harness flow render`"; and never hand-edit the JSON either.
- Added the **short legacy note** (E308 clean break) inline; the fuller SKILL.md note is T006.
- Updated the stale Schema link description ("full node + agents[] contract" → "the CLI descriptor … supplied via `--schema`; shared-core bundled in the CLI").
- **`getting-started.md` swept** — clean: its only mermaid/classDef blocks are its own pipeline-stage diagrams (manual/auto/optional/harness colours), not flight-plan render rules. Nothing to delete.

**The routing Graph (§ Graph, ~L101–116) and everything outside § Flight plan are untouched** (all edits were within § Flight plan + the Fresh-start/Resume init lines). [AC-13; CD-02; plan 3.3 deletions; Phase-2 renderer owns the rules]

**Note (deferred polish, not blocking)**: `flight-plan.template.md` (the rendered worked example) is left as static documentation — not CLI-regenerated (a template `{cursor,nodes}` isn't a full `FlowDoc` that `render --path` accepts; regenerating would require `create`-then-render and change its nature). The shape it conveys is still accurate; faithful CLI-render parity for the worked example is a candidate future polish.

---

## T006 — Capability precheck + legacy/skew notes ✅

Edited the the-flow SOURCE `SKILL.md` + `references/00-routing.md`:
- **New `## Prerequisite — a capable harness flow CLI` section** in SKILL.md with all five T006 items:
  1. **Capability/version-floor precheck** — probe `harness flow --help` / `harness --version` before the first flight-plan mutation; absent/too-old → error-and-stop *"run `harness update`"* (no hand-crank fallback).
  2. **No adoption required** — flight plans live in `docs/plans/<slug>/`; no `.harness/`/governance; the schema ships with the skill, supplied via `--schema`.
  3. **E308 clean break** — pre-024 flows (no `provenance`) error on read; re-create, don't migrate.
  4. **Reverse skew** — old hand-crank + new CLI → the write reads back as `E308` = clean stop, not silent divergence.
  5. **Deploy order = CLI first, then skill**; rollback = revert skill + `harness update --pin <prev>`.
- **Invariant #6** reframed: `the-flow.md` regenerated by `harness flow render`; `the-flow.json` mutated only via `harness flow`; CLI required (§ Prerequisite).
- **Guided load-path step 3** + a **00-routing § Flight plan** precheck pointer wire the precheck into the engine entry. [AC-09/AC-13; grill 5/3; Risk #3; plan 3.4; Findings 02/07]

---

## T007 — Deploy + verify + rollback ✅

User chose **deploy now** (accepting the active-flow caveat below). Deployed the the-flow SOURCE → the live target via rsync (source-of-truth → install; not a hand-edit of the target):

```
$ rsync -a --delete ~/github/tools/skills/SDD/the-flow/ ~/.agents/skills/the-flow/    # exit 0
# dry-run first: 4 content updates (SKILL.md, 00-routing.md, coach.md, flight-plan.schema.json), rest mtime-only, ZERO deletions
```

(`~/.claude/skills/the-flow` → symlinks to `~/.agents/skills/the-flow`, so both resolve to the migrated skill.)

**Fresh-load verification** (deployed files carry the migration):
```
deployed SKILL.md § Prerequisite present ......... 1
deployed schema is the descriptor (nodeTypes) .... 1
deployed 00-routing CLI-driven cadence ........... 2
deployed 00-routing OLD "Render rules" header .... 0   (deleted)
deployed coach.md "hand-crank the flight plan" ... 0   (gone)
```

**Real mutate→render round-trip against the DEPLOYED schema** (`~/.agents/skills/the-flow/references/flight-plan.schema.json`):
```
create flight-plan --schema <deployed> --bare ...... ok (kind=flight-plan, 0 nodes, event 1)
add-node research/plan/merge (connected spine) ..... ok ×3
insert-node p1 --after plan (phase-reveal; DAG ok) . ok (4 nodes, 6 events)
status research --to done .......................... ok
render ............................................. ok (deterministic .md)
```

**Rollback (documented, additive/reversible)**: restore the pre-migration skill — `git -C ~/github/tools checkout -- skills/SDD/the-flow` then re-rsync to the target — and `harness update --pin <prev>` for the CLI (a global npm package). [plan 3.6; Risk #3]

> **⚠️ Active-session caveat (accepted at the deploy gate)**: plan 024's own `the-flow.json` is a **legacy hand-crank** file (no `provenance`), so the newly-deployed CLI-driven engine reads it as **E308** — a guided `/the-flow` check-in on plan 024 will now stop with "re-create with `harness flow create`". The implement verb never writes the flight plan, so all Phase-3 work is intact; only future *guided* flight-plan updates on 024 are affected. Authoritative Phase-3 progress is **this `tasks.md` + `execution.log.md`**. The user chose **not** to re-create 024's flow (deploy-now, not deploy+recreate); re-creation via `harness flow create flight-plan --schema ~/.agents/skills/the-flow/references/flight-plan.schema.json` remains available if the flight-plan *view* is wanted.

---

## Phase 3 COMPLETE — 7/7 ✅

| AC | Requirement | Evidence |
|----|-------------|----------|
| AC-08 | Contract snapshots pass post-migration; seam mirror re-verified | T001 — 5 tests green; mirror matches live router (no bump) |
| AC-09 | the-flow mutates + renders via `harness flow` only; capability abort | T004 cadence + T002/T003 round-trip; T006 precheck |
| AC-11 | the-flow ships + supplies its flight-plan schema via `--schema`; no 2nd copy | T003 — descriptor authored; `create --schema` ok; nothing bundled in CLI |
| AC-13 | render-rule + cadence prose deleted; render delegated; Graph untouched | T005 — 8 rules removed; Graph intact |
| AC-15 | insert-node modes map 1:1 to phase-reveal + excursions | T003/T004 — `--after` (reveal), `--branch-of --rejoin` (excursion) proven |

**What landed**: the-flow is now a **consumer** of the `harness flow` CLI — descriptor schema shipped + supplied via `--schema`; hand-crank cadence → CLI call sequences; render delegated to `harness flow render`; capability precheck + clean-break (E308) + reverse-skew + deploy-order documented; deployed live + verified. Clean break honored; the routing **Graph stays prose** (decision = data, no routing in the CLI).

**Cross-repo footprint**: substantive edits in the the-flow SOURCE (`~/github/tools/skills/SDD/the-flow/` — 4 files) + deployed to `~/.agents/skills/the-flow/`. In harness-engineering: only T001's snapshot re-run (no CLI edit) + this plan-dir's `tasks.md`/`execution.log.md`.

**Review surface**: plain implement (no companion — cross-repo). Reviewability = the pasted transcripts above + the in-repo snapshot baseline. Recommended next: a **stage-7 review** (reads the cross-repo edits directly).

