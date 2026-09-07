# plan

> Sub-skill — owns product intent, not flow position or team orchestration.

**Verb**: plan
**Purpose**: Specify WHAT must change, WHY it matters, and how success is observable. The separate implementation guide owns HOW: architecture, interfaces, unit ownership, dependency waves, composition and execution settings. Do not fold those back into the product plan.
**Consumes**: intent; existing plan on re-entry; `assets/research-dossier.md` and authoritative `assets/workshops/*.md` when present; applicable project rules and accepted ADRs.
**Flags**: `"<intent>"` · `--simple` · `--skip-clarify`
**Produces**: `plan.dd.json` and generated `plan.dd.md`; stable acceptance-criterion IDs and scope decisions. No implementation release.
**Side effects**: auto-runs `/validate-v2 --artifact "${PLAN_PATH}"`; no flow writes.

## Procedure

1. Resolve the existing plan first. For a new allocation, the parent owns `harness builder new`; do not allocate a second ordinal or workspace. A direct invocation may use `harness plan new <slug> --title "<title>" --phase "<outcome checkpoint>"` to create only the document scaffold. Reuse its returned path. `--simple` selects one outcome checkpoint, not permission to omit an implementation guide or evidence.
2. Read the original ask, relevant research, workshop decisions, constraints and existing product behavior. Existing repo evidence answers questions before the human is asked. Domain mode stays opt-in under `references/00-routing.md` § Domain mode & context loading.
3. Clarify only decisions with materially different outcomes: scope, supported behavior, compatibility, failure semantics and proof constraints. Batch independent questions; no more than eight across the initial and sketch-dependent rounds. Preserve explicit testing/mock/documentation preferences, but do not ask ritual questions already answered by the repo. `--skip-clarify` records the unresolved decision and explicit override; it never fabricates an answer.
4. Author product sections through the local DD writer. Keep `meta`, `goals`, `non_goals`, `acceptance_criteria`, risks, assumptions, clarifications, research findings and outcome-level `phases` where appropriate. Schema-supported phase rows remain the work-accounting index; they are not a parallel implementation guide. Put files, contracts, delegation, settings and wiring in `assets/impl-guide.dd.json`, not a second HOW half in this document.
5. Each AC is an observable user/system promise with boundaries and failure cases, not an instruction to add a file. Keep IDs stable on re-entry. Read `assets/backpressure.dd.json` when available and link each AC to the actual selected instrument; no invented commands or receipts. The canonical recipe is `../backpressure-recipe.md`.
6. Check product coherence, constitution/ADR constraints, measurable outcomes, non-goals and unresolved decisions. Write `meta.status: ready` when product intent is ready; this does NOT mean architecture reviewed, baseline sealed, dispatch ready or work proven. Leave unresolved intent `draft`, with its reason. G1 clarification, G2 constitution and G4 ADR constraints inform this pass; implementation-specific G3/G5/G6/G7 checks belong to the implementation guide.
7. Run structural plan validation (not `--complete`: future work is deliberately unchecked), then `/validate-v2`. Report material findings and the actual verdict. Never pre-check future tasks or ACs to satisfy an early gate.

## DD-native root allow-list

For a newly authored plan, the plan-folder root allow-list is `plan.dd.json`, generated `plan.dd.md`, `original-ask.md`, and the parent-owned `the-flow.json` / generated `the-flow.md`. No `<slug>-plan.md` is emitted. Do not create a parallel Markdown plan or specification to satisfy a legacy consumer; report the incompatible consumer instead. Preserve existing historical files on re-entry rather than deleting or converting them.

Use `harness plan new <slug> --title "<title>" --phase "<outcome checkpoint>"` only when no allocation/scaffold exists; repeat `--phase` for each known checkpoint. The scaffold creates the canonical product source and bare-ordinal phase task sources with their source links. Reuse the returned plan path, then author its sections with the local DD commands below; its `.dd.md` face is generated, never independently authored. This stage does not create or mutate the parent-owned flow files.

Everything else goes under `assets/`: implementation architecture in `assets/impl-guide.dd.json`, proof selection in `assets/backpressure.dd.json`, task sources in `assets/tasks/phase-N/tasks.dd.json`, and research, workshops, evidence and reports in their corresponding asset paths. Keep this layout while separating WHAT/WHY from the guide's HOW; a new guide is not permission to introduce another root-level plan. The shared layout reference is `references/00-routing.md` § Plan-folder layout, but this authoring stage must apply the boundary when it writes.

## Local DD authoring

```bash
PLAN_PATH="<returned plan path>"
node_modules/.bin/ddocs get "${PLAN_PATH}#meta"
node_modules/.bin/ddocs set "${PLAN_PATH}#summary" "<observable change and why>"
node_modules/.bin/ddocs add "${PLAN_PATH}#goals" '"<outcome>"'
node_modules/.bin/ddocs add "${PLAN_PATH}#acceptance_criteria" '{"claim":"<observable criterion>","state":"unchecked"}' --mint ac
node_modules/.bin/ddocs set "${PLAN_PATH}#acceptance_criteria/ac-XXXX/pressure" "assets/backpressure.dd.json#rows/bp-XXXX"
harness plan validate "${PLAN_PATH}"
```

Use IDs returned by the writer, never literal example IDs. `node_modules/.bin/ddocs` is the installed CLI; do not substitute a registry fetch or the operating system's disk-copy command. Missing local tooling is a named prerequisite, not a prompt-only fallback. Schema-invalid writes refuse without changing the document; `.dd.md` is always generated.

## Phase design principles

Choose the fewest outcome checkpoints that earn an independent review. A domain is not a quota for a phase; several files are not evidence of parallel independence. Name a feasibility spike when an assumption needs execution, not a design essay. Recommend a missing proof affordance before feature work when it materially changes confidence; a human may decline with that gap recorded. Complexity is CS 1–5, never a time estimate.

## Re-entry

Read existing intent, clarifications and criterion IDs before changing anything. Record the new decision once and update only affected product claims. Material intent changes invalidate downstream guide/baseline/review bindings: report that dependency, never silently re-seal it. Factual progress and generated-view refreshes are not permission to alter frozen intent.

Historical completed Markdown plans and earlier unified/split plans remain readable under their original contract. Do not regenerate, migrate, reopen or add a guide to completed history simply because this skill now separates the documents. An active historical plan explicitly adopted into the new team lifecycle needs a reviewed guide before new dispatch; adoption never claims ownership of someone else's workspace.

## Exit

Report the canonical path, product status, AC/outcome checkpoint counts, unresolved decisions and actual validation result. Do not select the next stage or mutate flow state. Routing is the flow's job — run the parent flow bare to continue.
