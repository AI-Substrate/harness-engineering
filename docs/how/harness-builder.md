# Builder: product intent to verified delivery

Builder separates the product plan from the implementation guide, then operates the existing canonical flow. It does not add another independently advanced team lifecycle.

- **Product plan** — `plan.dd.json`: WHAT/WHY, scope, observable acceptance criteria and outcome checkpoints.
- **Implementation guide** — `assets/impl-guide.dd.json`: architecture, injected contracts, ownership, dependencies/waves, role settings, composition and proof.
- **Backpressure** — `assets/backpressure.dd.json`: selected RUN/EXTEND/BUILD/ABSENT approach per AC/failure mode, schema `builder/backpressure`.
- **Evidence** — task assertions, execution-log entries, baseline/packet/dispatch/composition/review/preservation records. Their existence is not automatically proof that the corresponding work ran.

The skill journey is `/builder 1b plan` → `/builder 4 guide` → tasks/implementation → review → post-flight → optional ship. The persisted spine remains one DAG: `research → plan → impl-guide → (phase-N → review-N)* → post-flight → ship`. Harness boot, survey, observe, drain and harvest remain mandatory-to-surface, human-declinable chores.

## Start or adopt

In this source repo use `node harness/cli/bin/harness.js`; the examples below use `harness` for an installed consumer CLI. Probe help before mutation. Missing runtime/model capabilities return named prerequisites, never silent substitutions.

```bash
harness builder --help
harness builder new example --workspace ../example-plan --actor <pm-id> --kind clone
# Existing external or pij allocation instead; do not claim it as harness-owned:
harness builder adopt <plan> --actor <pm-id> --owner external
```

New reserves the ordinal before allocation and returns `allocation`, `plan`, `flow`; use those returned paths rather than reconstructing them. Adopt records existing ownership without reallocating it. `kind: clone|worktree` says how Git is isolated; `owner: harness|external|pij` says who may retire it. Allocation authority must live outside the removable workspace.

Both initialized managed workspaces and adopted external/pij plan workspaces carry a stable `<git-dir>/builder/allocation-ref` locator to their original allocation record. Repeating `builder adopt` repairs a missing locator from an older adoption without changing that allocation's identity or ownership. This enables child provisioning; it does not grant the harness permission to retire an externally owned workspace.

## Review the guide before code fan-out

```bash
harness builder guide <plan> --init
harness builder guide <plan>
harness builder guide <plan> --check
harness builder settings <plan>
harness builder settings <plan> --role reviewer --harness omp --model github-copilot/claude-opus-5
```

`--init` never overwrites an existing guide. Author through local `node_modules/.bin/ddocs`; source templates are under `skills/builder/templates/`. `--check` checks structure, dependency order and AC/proof links, not architectural judgement. Ownership-only findings are visible warnings, not guide invalidity or readiness blockers: overlapping writes, read-map gaps, unmapped baseline files and owner declarations guide the work rather than veto it. Real malformed data, ambiguous identities and invalid executable checks remain errors. Independent decomposition review is separate. Guide exit does not require the future committed code baseline.

Settings resolve repo < guide < explicit fields, with per-field `source`. `--harness`, `--model` or `--effort` on settings requires `--role`. Omitted effort stays absent. `roles.template.json` contains reusable role profiles, **not** a replacement global settings file; install them in guide roles or pass explicit settings flags. Requested/observed configuration is not provider-served identity attestation.

### Workspace bootstrap templates

`BuilderDeps.templatesDir` names the source `skills/builder/templates` directory. Workspace bootstrap copies these exact files only when the target is absent:

| Source basename | Target relative to plan directory | Content |
|---|---|---|
| `backpressure.template.json` | `assets/backpressure.dd.json` | `builder/backpressure` draft: meta with Partial certainty, empty rows/sensors |
| `coder-packet.template.md` | `assets/team/coder-packet.template.md` | editable map-first coder briefing, not an issued packet |
| `reviewer-packet.template.md` | `assets/team/reviewer-packet.template.md` | editable independent-review briefing, not an executed review receipt |
| `roles.template.json` | `assets/team/model-settings.template.json` | coder/reviewer harness/model profiles, effort omitted; not live/global settings |

Bootstrap updates the product plan's `meta.backpressure` through the validated writer, never overwrites existing content, and does not initialize the implementation guide. `guide --init` exclusively owns `impl-guide.template.json` → `assets/impl-guide.dd.json`. Issued immutable packets and actual receipts still belong to the dispatch/review writers; briefing templates never become canonical evidence by copying them.

### Good fan-out

The runnable converter freezes an immutable `Document` contract. Parser consumes an injected reader and can run without a renderer. Renderer consumes a document and injected writer and can run without a parser. Both depend on the contract baseline, not sibling implementation. The PM owns the composition root and real filesystem adapter wiring after both deliveries.

| Wave | Owner | Capability / proof |
|---|---|---|
| 0 | PM contracts | immutable DTO, validation, shared fixture contract |
| 1 | parser coder | input/CRLF normalization and reader failures |
| 1 | renderer coder | escaping, byte counts, writer failures |
| 2 | PM composition | real CLI input file → escaped output file, error propagation |

`impl-guide.template.json` maps these capabilities to ACs, exact write/read paths and check IDs. Rename and review the teaching example for the actual product; do not dispatch it unchanged against unrelated work.

### Good solo decision and bad split

An account reservation is one atomic invariant: validating and debiting the balance belong together. Splitting those functions between coders buys coupling, not independence; `solo.mjs` demonstrates failed reservations preserving the balance.

`bad.mjs` deliberately shares mutable implicit state: its renderer fails without the parser running first and another caller overwrites the renderer's input. Separate files or prompts cannot make that architecture independent. The verifier observes both failures; it does not report the bad implementation as correct.

```bash
node skills/builder/examples/verify.mjs
node skills/builder/examples/verify.mjs --case composition
```

The verifier executes injected services and the real filesystem CLI, plus solo/bad and preservation/refusal scenarios. Its report explicitly distinguishes teaching-fixture checks from real peer/review acceptance. `lifecycle.mjs` constructs reusable packet/direct-delivery/self-check/review/allocation shapes with measured example-byte digests. The transport and runtime records are explicitly synthetic, unavailable observations stay absent, and no peer or reviewer is launched or attested.

## Seal, dispatch, start work

The PM implements and commits the shared contract unit, exercises its checks, then records/seals the independent decomposition basis:

```bash
harness builder review <plan> --receipt <decomposition-review.dd.json>
harness builder contracts <plan> --seal --review <decomposition-review.dd.json>
harness builder ready <plan> --unit <unit-id>
harness builder dispatch <plan> --unit <unit-id> --workspace <new-path> --parent <pm-id>
```

`ready` must actually report `ready`; `not-ready` or `cant-tell` does not authorize dispatch. Commit the contract source first (that commit is the seal's `source_sha`); seal and review receipts may be committed before or after dispatch. Dispatch accepts a plan-repository HEAD at or descended from the sealed source, with every frozen artifact digest-checked, and records its observed HEAD. A rewritten baseline needs restored history or a reviewed new seal, not relabelled evidence. The coder clone starts at the sealed source. Dispatch defaults `--kind guide`, or accepts `worktree|clone`, with optional role overrides. `solo` guides are not dispatched as coders.

The seal's file digests bind regular blobs in the original `source_sha` commit, including binary inputs—not the PM working tree forever. The PM may change or remove those files during integration; `compose --verify` runs the current checks and captures the current committed artifact. Changes after that composition proof still invalidate it. Altered seal digests, missing original blobs and material plan/guide changes remain failures.

Factual plan progress, including `implementation_summary`, does not become new product intent. Late binding uses the clone's matching sealed plan inputs and does not overwrite them with newer PM progress views or rewind the PM's records.

### Bind an already-running worker

```bash
harness builder dispatch <plan> --unit <unit-id> --workspace <existing-path> --parent <pm-id> --adopt-peer <peer-id>
```

Use the live native peer's actual ID, parent and adopted checkout. `--kind guide|worktree|clone` and role overrides still apply; requested settings do not attest provider identity. Builder binds the unit to the existing external/pij adoption or matching unit allocation without taking ownership. It preserves the original allocation authority and locator, sealed-source ancestry, progressed HEAD and staged/unstaged/untracked WIP. It seeds only missing metadata and observes the actual runtime: no spawn, checkout, reset, replay or new work grant. Do not redo completed work or replace original evidence to make the binding fit. Missing/altered evidence, incompatible native identity or rewritten ancestry remain real failures; map deviations remain advisory.

The current native OMP path requires a full clone; linked-worktree runtime support is still a named capability gap, not an automatic fallback. A matching allocation binding may be reused, but a durable dispatch is not resent: inspect and reuse its original peer/packet/evidence instead of issuing a duplicate dispatch or respawning.

### Read the work packet

The work message begins with a useful map:

1. **You own** the unit's source/test paths.
2. **You may read** the named contract/dependency paths and their owners.
3. **Your job** is its responsibility and frozen interface.
4. **Done means** observable ACs, actual proof commands and the committed delivery.

Then provide the exact packet pointer and SHA-256. The packet binds plan/guide/baseline/allocation bytes, `source_sha`, ownership, interfaces, proof and role. For a new dispatch, receiving it starts that unit; there is no separate acknowledgement or release. An existing-peer binding records work already authorized, not a new assignment. `DispatchReceipt.delivery` records only the observed transport message ID, outcome and time. A queued message is not proof of receipt, and neither queued nor delivered transport is an import gate.

The map guides both coder and PM work; it is not a source-path permission fence. Out-of-map edits need no approval or justification. Prefer the shared interfaces that make independent work possible, coordinate changes that break consumers, and surface the comparison warnings rather than inventing a second approval process.

Map warnings remain visible when an actual structural, proof or runtime failure prevents sealing or dispatch: the error envelope carries them at `error.details.warnings`, with prior failure detail retained as `error.details.cause`. A dependency's path hints never create proof prerequisites; readiness uses its declared checks and actual committed dependency evidence.

Current packets use the separately staged `builder/work-packet` schema. Provisioning installs that missing package before native launch; it does not overwrite an existing consumer `builder/packet` schema or its customizations. Historical packets and acknowledgements continue to use their original schema and remain readable. No legacy canary field is invented to make a new packet fit an old schema.

From the worker's actual checkout, one optional orientation check is:

```bash
harness builder self-check <packet> --sha256 <digest>
```

This read-only report returns `packet`, `expected`, `observed` and `warnings`: expected/observed packet SHA-256, repository root and HEAD/source SHA, with a cause and corrective `next_action` for every mismatch or unavailable observation. It warns rather than refusing and writes no state. Historical packets without `source_sha` use their in-root digest-bound baseline when readable; absent evidence stays absent. It does not attest a native runtime, require a pristine checkout or impose a clock window. Do not build a receipt exchange around it.

Keep historical acknowledgement and release records readable and unchanged; do not replay completed work or reclassify old evidence as a current prerequisite. Requested settings are not provider attestation, and unavailable optional runtime observations belong in `observed.gaps`, not invented fields.

## Check on-track without a ceremony

```bash
harness builder on-track <plan> [--unit <id>] [--from <ref>] [--to <ref>] [--untracked]
```

This read-only inspection uses the same ownership comparison as automatic delivery/import/verification. It needs no readiness, seal, review or receipt prerequisite; it runs even on main and writes no files, receipts or lifecycle state. It exits 0 with a report, not a permission decision.

| Selection | Compared work |
|---|---|
| `--unit <id>` | That named unit's map; `mode: unit`, delivery-stage warnings, every committed touched path including reverted writes |
| No `--unit` | All PM maps; `mode: pm`, verify-stage warnings, endpoint delta |
| Default end | HEAD plus tracked staged/unstaged work; new/untracked files are excluded |
| `--untracked` | Explicitly adds untracked paths to the current-work comparison |
| `--to <ref>` | Committed-only comparison; excludes staged/unstaged/untracked work even with `--untracked` |
| `--from <ref>` | Explicit starting commit (`basis: explicit`) |

Without `--from`, PM uses imported `integration_sha` (`basis: import`) when available, otherwise sealed `source_sha` (`baseline`), otherwise HEAD (`head`). Named-unit inspection uses the sealed source or HEAD. Malformed existing basis evidence yields an issue rather than a silent fallback. The report exposes measured full `from`/`to` SHAs, `includes_worktree`, `includes_untracked`, `warnings` and actionable `issues`. When inspection cannot compare, it returns `compared: false` and the cause/fix in `issues`, still exit 0. Display the selected basis, warnings and issues; a zero exit or empty warnings without `compared: true` does not prove a comparison happened.

## Import is not composition proof

```bash
harness builder compose <plan> --import <deliveries.json>
# PM wires the real composition root, regenerates owned outputs, and commits.
harness builder compose <plan> --verify <exact-composed-sha>
harness builder review <plan> --receipt <composition-review.dd.json>
harness builder advance <plan> --now <canonical-node>
```

`deliveries.json` is an array of `UnitDelivery`: `unit_id`, `peer_id`, `workspace`, `commit_sha`, `packet_sha256`, `baseline_sha`. `baseline_sha` is the full Git source SHA, while FileDigest `sha256` binds bytes. Import verifies current packet/dispatch/external-allocation digests, tree/branch/commit, distinct peer attribution and sealed ancestry before integrating in guide order. Coder path-map deviations warn rather than refuse. Import does not consult self-check/on-track reports, acknowledgements, release or transport outcome, nonce challenges or timing. Only verify sets the composed `artifact_sha` with actual check receipts. Independent review binds that SHA, plan/guide digests, requested/observed reviewer, report digest and findings. Artifact drift needs fresh proof/review.

Integrity refusals still name cause and fix: wrong tree/branch/commit → return to the allocated checkout and deliver its actual committed SHA; forged/mismatched evidence → recover original bound bytes and measured digests; duplicate peer attribution → use the actual distinct dispatched workers; rewritten baseline → restore sealed history or review/seal new contracts and issue new packets. An orientation warning does not waive these import checks.

### Record deliveries already integrated by the PM

```bash
harness builder compose <plan> --import <deliveries.json> --already-integrated
harness builder compose <plan> --verify <exact-composed-sha>
harness builder review <plan> --receipt <composition-review.dd.json>
```

Use `--already-integrated` only with `--import`, never with `--verify`. Every supplied unit must already be present at the current committed PM HEAD. Normal import replays commits; this mode compares immutable Git trees and writes the composition receipt without fetching, cherry-picking or changing HEAD, index or working source. Original worker `UnitDelivery.commit_sha` values remain unchanged even when the PM integrated equivalent trees through different commits.

For each unit, compare the frozen write-map projection across the baseline, worker delivery and PM trees, including deleted paths. Equality includes path, mode, object type, Git object ID and absence, so binary bytes and executable bits matter. If the map selects no concrete paths, use the delivery-touched paths; an entirely empty scope is missing proof, not success. All unit projections must match before any receipt is written. Working-file text and the flag itself cannot establish equality; dirty source, missing evidence or digest/tree mismatches remain failures.

The receipt may carry `integration_method: already-integrated` and per-unit `integration_proofs` (`unit_id`, original `delivery_sha`, `scope: unit-map|delivery-changes`, `compared_paths`, `tree_sha256`). These are additive optional fields: historical receipts remain readable and existing consumer schemas need not be overwritten. A proof records scoped tree equality, not whole-patch identity or product behavior. Map deviations still warn. `compose --verify` and independent review of the exact composed artifact remain required; the record is not proof that the product works.

Coder and PM maps are guidance, not permission. `composition.value.warnings` retains guide, delivery and import observations, then refreshes verify-stage warnings on each verification. Each row names `file`, scalar `owning_unit` (unit ID or `unmapped`) and `stage` (`guide|delivery|import|verify`); multiple owners produce separate rows and coder delivery rows include the actor `unit_id`. Guide-only declarations may use `<guide:field>` with an actionable `code`, `message` and `next_action` instead of inventing a file. Read these warnings alongside the exact artifact and checks during independent review. Ownership warnings do not block readiness, sealing, dispatch, composition or advance; real Git/replay, filesystem confinement, structural and product-check failures still fail with their warnings visible.

Composition source checks exclude plan-record folders and the reserved `.harness/records/**` namespace. Uncommitted retros and later record-only commits do not invalidate unchanged composed code or require another review. New composition snapshots omit harness records; historical receipts remain unchanged when re-observed. Records still belong in preservation. This does **not** exempt executable `.harness/extensions/**`, newly added source outside the old snapshot, or changes to any file bound by the current composition proof. The earlier seal is verified separately against its original Git commit.

No silent review fallback: unavailable requested cross-model review is unfulfilled. A justified solo implementation does not change this promise.

## Record the actual proof

Use the shared [backpressure recipe](../../skills/builder/references/backpressure-recipe.md). Both skills use the installed `node_modules/.bin/ddocs` binary, not a registry fetch or operating-system utility.

1. Discover actual tooling across package roots.
2. Select RUN (`mode: EXISTS`), EXTEND, BUILD or ABSENT, preserving proposed versus runnable commands and probe evidence.
3. Link every AC and task assertion by `pressure` to its survey row.
4. Execute the selected proof; preserve command/cwd/status/output/subject evidence.
5. Append an execution entry with registered prefix `lg`, then link AC `proven_by` back to it and close only observed assertions.

Certainty is `Partial|Confident|Proven`. Schema validation proves document shape; it never proves the feature. From `assets/tasks/phase-N/`, pressure points at `../../backpressure.dd.json`, while AC links use `../../../plan.dd.json`.

```bash
node skills/builder/examples/proof-recipe.mjs scratch/builder-proof-example
```

This refuses an existing destination, copies the actual local schemas into a private corpus, executes the local DD writer and real composition example, verifies AC/assertion links and generated siblings, and records all outputs in `receipts.json`. It also proves an invalid certainty write refuses without changing the survey. It must actually run before claiming the recipe proven.

## Close, preserve, then retire

Whole-plan completion gates **post-flight EXIT**, after closeout evidence. Phase gates stay on their own tasks. Do not pre-check future closeout to leave review.

```bash
harness builder close <plan> --survivor <outside-all-retiring-roots> --allocations <allocations.json> --evidence <evidence.json>
harness builder tidy <allocation.dd.json> --preservation <preservation.dd.json>
```

`allocations.json` contains `Stored<AllocationRecord>` wrappers (`ref: {path, sha256}`, `value`). Evidence rows are `{path, category}`, with `artifact|wip|report|observation|telemetry`. Close preserves required bytes and Git refs, archives, and repairs bindings; never repeat the archive move by hand. Tidy separately re-verifies ownership, runtime release and surviving evidence before removal. Idle is not closed; external/pij ownership, live/unknown runtime, dirty source, changed preserved bytes or a survivor under a retiring root refuse removal.

Each preservation generation writes its authoritative record under `receipt/preservation.dd.json`, with a separately staged schema namespace beside that control record. Copied workspace schemas remain evidence in sibling data directories, so several repositories cannot make the receipt's schema ambiguous. Use the returned receipt path rather than constructing it. A failed close may already have archived the plan; retry through `builder close` on that archived path into a fresh generation, preserving the failed generation and never moving the plan back by hand.

Preservation receipts have a **64 MiB UTF-8 byte limit** because their inline inventory covers whole workspaces. Other Builder records and ordinary document reads keep their **4 MiB** limit. Preservation reads, identical retries and compare-and-swap writes use the same larger bound; the writer rejects an oversized document before publishing source or its rendered view. Existing preservation receipts between 4 and 64 MiB can be consumed unchanged—no repeat close, inventory truncation or WIP deletion is needed. Size limits do not waive schema, digest, filesystem confinement or preservation-freshness checks.

Completed historical DD/Markdown plans retain their read path without conversion, new guide gates or node resurrection. Factual progress and archive relocation preserve material intent/guide/code bindings without circular rebaseline demands.

## Result and permission boundaries

The [exact command table](../../skills/builder/references/team-lifecycle.md#public-grammar) covers all flags/result fields. Outcomes use the existing envelope: ok exit 0; degraded exit 0 with `next_action`; unconfigured exit 2; error exit 1. A zero exit is not necessarily ready. Missing support is explicit, not fake success.

PM owns canonical state and integration; coders use the packet's source/test and read maps as guidance, not mandatory fences. Reviewers supply independent evidence, not implementation changes. Advisory maps do not authorize global/deployed settings, unrelated workspaces or changes on main. Push, PR creation, merge and destructive operations require their own user authorization; retirement is not implied by closeout or shipping.
