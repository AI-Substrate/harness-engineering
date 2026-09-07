# Research dossier — Builder team lifecycle

**Generated**: 2026-09-04T23:43:17Z
**Effort**: Standard — PM reconnaissance plus one bounded source scout
**Query**: Promote the accepted 12-step, architecture-enabled team delivery lifecycle into Builder and first-class harness commands without duplicating existing state or runtime authorities.

## The ask

Builder currently plans a system but has no first-class implementation guide for independently executable team work. This change must separate product/system requirements from the delivery design, supply deterministic lifecycle operations, and preserve Builder and engineering-harness close-out duties. This plan itself will exercise the proposed method manually, with isolated OMP coders and an independent cross-model reviewer.

## Answer

The shipping harness already supplies the plan semantics, flow persistence/departure gates, typed I/O seams, deterministic documents and command-envelope conventions needed for the new family. Builder and eng-harness-flow now live under this repository's tracked skills directory. The Flowspace team prototype is valuable prior art for decomposition and packets, but its ordinal allocator and teardown cannot be copied as the authority: they predate durable reservations and have documented preservation failures. The design must choose one allocation owner per run, bind every verdict to concrete inputs, and make both unit independence and AC-to-observable-capability coverage checkable.

## Evidence

| ID | Finding | Source | Planning implication |
|---|---|---|---|
| F01 | There is no builder command family; plan has new/validate/ready/render/pr-body/fence and flow has create/nav/orient/status/apply/comment/relocate/render. | Local CLI help receipts; `harness/cli/src/app.ts`; `harness/cli/src/acts/plan/index.ts` | Add a first-class family while delegating to existing plan/flow machinery. |
| F02 | The canonical state is a CLI-written flow; mutations have departure/DD gates and source writes are atomic. | `harness/cli/src/services/flow/flow-service.ts`, `flow-mutations.ts`, `flow-dd-gate.ts`; `skills/builder/references/flight-plan-ops.md` | Do not create a second independently advanced flow; structural readiness and evidence checks must precede transition. |
| F03 | Empty plans are not ready: existing plan readiness distinguishes ready, not-ready and cant-tell. | `harness/cli/src/services/plan-semantics/ready.ts` | Preserve non-vacuity and represent absent evidence honestly. |
| F04 | Services depend on injected ports; filesystem, execution and Git seams and fakes already exist. | `docs/project-rules/constitution.md:65-86`; `harness/cli/src/adapters/{fs,exec,git,process}` | Separate pure contract/readiness logic from real Git/process orchestration and reuse the existing I/O seams. |
| F05 | The local source skill writes a unified dd-native plan and currently forbids separate WHAT/HOW passes. | `skills/builder/references/stages/20-plan.md:7-20,51-84`; `skills/builder/SKILL.md` | A clean source-skill cutover must cover registry, routing, stage contracts, templates, examples and downstream readers; never patch a deployed copy. |
| F06 | The Flowspace team skill assigns the plan and binding guide to prime, delivery/composition to PM, one unit per coder, and post-composition cross-model review. | Flowspace `.agents/skills/pij-team/{SKILL.md,TENETS.md,templates/}` | Retain explicit roles, frozen contracts, packet acknowledgement, waves and the solo option. |
| F07 | The Flowspace workspace prototype scans ordinals without a durable reservation; its teardown rescues observation buffers but not every live dossier. | Flowspace `.harness/extensions/team/extension.ts`; `scratch/meadowlark-operations-interview.md:140-168` | Creation must reserve before mutation and preserve tombstones; teardown must preserve required artifacts before removing their tree. |
| F08 | Pij has a TS stream allocator with reservation/WIP-preservation/tombstone tests; its current Rust path and client routing are not the same complete contract. | Pij `.pi/extensions/pij/core/{stream.ts,stream.test.ts,generation-routing.ts}` and Rust orchestration services | Do not import private TS internals or silently cross generations; explicitly choose the supported dependency and report unsupported runtime capability. |
| F09 | Repo-local Builder and harness skills are tracked here; the allocation prime reports an in-flight backpressure-dd change. | Prime allocation packet, this worktree `skills/`, `.dd/schemas/builder/backpressure/schema.json` | Keep a single-repo source boundary, avoid global skill installation, and consume structured backpressure evidence rather than creating another Markdown-only truth. |
| F10 | Actual OMP model catalog includes the requested models; the legacy pij pi catalog omitted Astra. | `omp models find astra --json`; `omp models find claude-opus-5 --json` | Persist runtime/provider/model/effort per role and verify effective runtime, not just requested argv. |

## Historical evidence

| ID | Prior finding | Applicability | Implication |
|---|---|---|---|
| H01 | Plan 008 had a store query and populated data but no unit owned the promised agent-facing surface. | Direct | Every AC needs an observable path owner, not merely a list of implemented interfaces. |
| H02 | Relative file tools wrote into a different tree than the shell compiled. | Direct | Spawn in the assigned worktree and bind evidence to that worktree and commit. |
| H03 | Review of a moving shared tree produced misleading findings; independent unit greens missed composition defects. | Direct | Review a committed composed SHA and run the integrated artifact. |
| H04 | Early direct-main work evolved into per-coder worktrees and serialized convergence. | Partial | Adopt the improved isolation, not the early shared-tree recipe or its claims. |

## Risks and unknowns

- Allocation ownership is a material design decision: this repository has no pij project row and prime forbids silently creating one; resolve the dependency/ownership boundary before freezing workspace interfaces.
- Evidence files and status flags cannot mechanically prove architectural quality; the CLI must distinguish validated structure, observed process results and reviewed judgement.
- Close-out must not move an archive inside a doomed worktree and then destroy the only copy; preservation and archive reference relocation need real failure-path proof.
- Doctor is degraded for environment reasons (PATH biome, one missing extension briefing, stopped watcher, collector policy); the source build and fast test suite are independently measurable and no global repair is authorized.
- In-flight changes to Builder/backpressure must be coordinated at integration; they are not a reason to edit shared main or install new global skills during a wave.

## Planning handoff

- Preserve: existing envelope/exits, dd schemas/writer, flow mutation/departure guards, testable ports, source-only skill installation policy and explicit shipping authorization.
- Change: add the delivery guide/packets/settings and architecture-enabled lifecycle operations; update every Builder consumer of the former unified WHAT/HOW contract.
- Proof: pure boundary tests with injected fakes, disposable real-Git workspace lifecycle smoke, refusal/preservation fault paths, committed-SHA review and an end-to-end CLI run.
- PM owns design and integration; freeze cross-unit types and export contracts before spawning coders.
