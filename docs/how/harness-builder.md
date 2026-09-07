# Builder: product intent to verified delivery

Builder separates the product plan from the implementation guide, then operates the existing canonical flow. It does not add another independently advanced team lifecycle.

- **Product plan** — `plan.dd.json`: WHAT/WHY, scope, observable acceptance criteria and outcome checkpoints.
- **Implementation guide** — `assets/impl-guide.dd.json`: architecture, injected contracts, ownership, dependencies/waves, role settings, composition and proof.
- **Backpressure** — `assets/backpressure.dd.json`: selected RUN/EXTEND/BUILD/ABSENT approach per AC/failure mode, schema `builder/backpressure`.
- **Evidence** — task assertions, execution-log entries, baseline/packet/ack/composition/review/preservation records. Their existence is not automatically proof that the corresponding work ran.

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

## Review the guide before code fan-out

```bash
harness builder guide <plan> --init
harness builder guide <plan>
harness builder guide <plan> --check
harness builder settings <plan>
harness builder settings <plan> --role reviewer --harness omp --model github-copilot/claude-opus-5
```

`--init` never overwrites an existing guide. Author through local `node_modules/.bin/ddocs`; source templates are under `skills/builder/templates/`. `--check` verifies structure, ownership, dependency order and AC/proof links, not architectural judgement. Independent decomposition review is separate. Guide exit does not require the future committed code baseline.

Settings resolve repo < guide < explicit fields, with per-field `source`. `--harness`, `--model` or `--effort` on settings requires `--role`. Omitted effort stays absent. `roles.template.json` contains reusable role profiles, **not** a replacement global settings file; install them in guide roles or pass explicit settings flags. Requested/observed configuration is not provider-served identity attestation.

### Workspace bootstrap templates

`BuilderDeps.templatesDir` names the source `skills/builder/templates` directory. Workspace bootstrap copies these exact files only when the target is absent:

| Source basename | Target relative to plan directory | Content |
|---|---|---|
| `backpressure.template.json` | `assets/backpressure.dd.json` | `builder/backpressure` draft: meta with Partial certainty, empty rows/sensors |
| `coder-packet.template.md` | `assets/team/coder-packet.template.md` | editable coder briefing, not an issued packet or release |
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

The verifier executes injected services and the real filesystem CLI, plus solo/bad and preservation/refusal scenarios. Its report explicitly distinguishes teaching-fixture checks from real peer/review acceptance. `lifecycle.mjs` constructs reusable packet/ack/review/allocation shapes with measured example-byte digests; it does not launch or attest a reviewer.

## Seal, dispatch, acknowledge

The PM implements and commits the shared contract unit, exercises its checks, then records/seals the independent decomposition basis:

```bash
harness builder review <plan> --receipt <decomposition-review.dd.json>
harness builder contracts <plan> --seal --review <decomposition-review.dd.json>
harness builder ready <plan> --unit <unit-id>
harness builder dispatch <plan> --unit <unit-id> --workspace <new-path> --parent <pm-id>
harness builder ack <plan> --receipt <pre-work-ack.json>
```

`ready` must actually report `ready`; `not-ready` or `cant-tell` never releases work. Commit the contract source first (that commit is the seal's `source_sha`); the seal and review receipts may be committed before or after dispatch — dispatch accepts a plan-repository HEAD that is the sealed source or a descendant of it, with every frozen artifact digest-checked, and records the HEAD it observed. It refuses a HEAD the sealed source is not an ancestor of. The coder clone must start at exactly the sealed source. Dispatch defaults `--kind guide`, or explicitly accepts `worktree|clone`, with optional role overrides. `solo` guides are not dispatched as coders.

Packet binds plan/guide/baseline/allocation bytes, source SHA, ownership fence, interfaces, proof and role. It contains only a **relative canary path**, never the expected answer. Before work, the peer reads packet/canary through native relative file tools, verifies pristine source, root versus shell cwd and available actual runtime observations, and returns a raw `AckReceipt` path/SHA-256. The PM ingests it through the command above before release.

The same command distinguishes two **exact receipt IDs**, not filenames or prefixes:

| Receipt | ID | `nonce` |
|---|---|---|
| Pre-work | `ack-<unit_id>-<full-current-source-sha>` | `packet.nonce` |
| Post-release | `ack-<unit_id>-<full-current-source-sha>-release` | Retained `release.message_id` |

After actually seeing the exact release, the peer natively re-reads packet/canary, refreshes runtime observations and creates a **new** post-release receipt with actual `recorded_at`. It sends the new private path/SHA-256, then follows already-granted work without waiting for a second grant. It derives the nonce from the retained release independently of the packet nonce. Already-started descendant/dirty work is legitimate; do not repeat pristine-source checks after authorization or replay completed work just to confirm its retained release.

Before importing a queued delivery, the PM runs:

```bash
harness builder ack <plan> --receipt <post-release-ack.json>
```

Confirmation observes delivery and grants/sends nothing. Retrying the pre-work receipt cannot promote queued to delivered; changed immutable confirmation bytes, wrong phase/current-source/runtime bindings or missing accepted ack/release refuse. Identical confirmation retries do not resend, including after a partial receipt-write/dispatch-CAS failure. Direct delivered transport remains valid.

`AckReceipt.baseline_sha` and `UnitDelivery.baseline_sha` are full Git source SHAs; FileDigest `sha256` binds bytes. Omit unavailable optional runtime fields and name `observed.gaps`; requested settings are not provider attestation. Peer receipt time must parse and lie inclusively between the retained release sent time minus **5000 ms** and PM ingestion time plus **5000 ms**. An out-of-window/invalid time needs clock-skew or incorrect-receipt guidance, not backdating or widened tolerance. PM preserves the original sent/queued facts and records observation/ingestion times and canonical confirmation path/digest in `observed.evidence`. Neither phase rewrites historical receipts.

## Import is not composition proof

```bash
harness builder compose <plan> --import <deliveries.json>
# PM wires the real composition root, regenerates owned outputs, and commits.
harness builder compose <plan> --verify <exact-composed-sha>
harness builder review <plan> --receipt <composition-review.dd.json>
harness builder advance <plan> --now <canonical-node>
```

`deliveries.json` is an array of `UnitDelivery`: `unit_id`, `peer_id`, `workspace`, `commit_sha`, `packet_sha256`, `baseline_sha`. Import verifies basis/fences and integrates in guide order; only verify sets the composed `artifact_sha` with actual check receipts. Independent review binds that SHA, plan/guide digests, requested/observed reviewer, report digest and findings. Artifact drift needs fresh proof/review.

The PM's path map is guidance, not permission. PM changes outside that map do not stop import or verification and require no declaration or justification. `composition.value.warnings` records each `file`, its `owning_unit` (or `unmapped`), and the `stage` (`import` or `verify`); a file mapped to several units has one row per owner. Verification retains import observations and refreshes its own warning list; real check failures still fail and retain the warnings beside their output. Read the generated composition receipt when reviewing the actual artifact. This is the composition increment of plan 099; the separate coder-delivery and acknowledgement cutover is not implied.

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

Completed historical DD/Markdown plans retain their read path without conversion, new guide gates or node resurrection. Factual progress and archive relocation preserve material intent/guide/code bindings without circular rebaseline demands.

## Result and permission boundaries

The [exact command table](../../skills/builder/references/team-lifecycle.md#public-grammar) covers all flags/result fields. Outcomes use the existing envelope: ok exit 0; degraded exit 0 with `next_action`; unconfigured exit 2; error exit 1. A zero exit is not necessarily ready. Missing support is explicit, not fake success.

PM owns canonical state and integration. Coders write only packet-owned source/test paths. Reviewers supply evidence, not code changes. Global/deployed settings, unrelated workspaces and main stay outside their fence. Push, PR creation and merge require their own user authorization; retirement is not implied by closeout or shipping.
