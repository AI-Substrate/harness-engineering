# Builder team operations

The skill decides and explains; `harness builder` checks and records. The existing canonical flow owns lifecycle position. Baseline, work-packet dispatch and composition are implementation substeps, not another stage graph. Team DD records are facts, never a second independently advanced state machine.

## Capability and envelope contract

Probe `harness builder --help`, the needed subcommand help, `harness flow --help` and `node_modules/.bin/ddocs --help` before mutation. In the harness source repo use `node harness/cli/bin/harness.js`; in a consumer use its installed harness. Missing support returns a named prerequisite (unsupported runtime: E473), never an invented flag/model/root or silently downgraded review.

Read the existing JSON envelope, not terminal logs. Outcomes: `ok` exit 0; `degraded` exit 0 with required `next_action`; `unconfigured` exit 2 with `next_action`; `error` exit 1 with `next_action`. `ready` reports `ready|not-ready|cant-tell`; the latter two do not authorize dispatch. An advisory zero exit alone is not a readiness decision.

## Public grammar

These forms follow `harness/cli/src/services/builder/commands.ts`; angle-bracket values are user/record inputs, not shell syntax to paste literally.

| Operation | Invocation | Returned data / boundary |
|---|---|---|
| New | `harness builder new <slug> --workspace <path> --actor <id> [--kind worktree|clone] [--base <ref>] [--title <text>] [--phase <titles...>]` | `allocation, plan, flow`; reserves before allocating; new explicit directory |
| Adopt | `harness builder adopt <plan> --actor <id> [--owner external|pij]` | `allocation, plan, flow`; records existing workspace, never claims harness ownership |
| Guide | `harness builder guide <plan> [--init|--check]` | `guide, checks`; init only if absent; ownership warnings do not invalidate the guide; structural checks are not architectural judgement |
| Readiness | `harness builder ready <plan> [--unit <id>]` | `status, issues, context, guide, baseline, warnings`; re-observes current basis; map warnings do not block readiness |
| Contracts | `harness builder contracts <plan> [--seal --review <path>]` | `baseline`; seal and review must occur together; checked committed inputs |
| Settings | `harness builder settings <plan> [--role coder|reviewer] [--harness <name>] [--model <selector>] [--effort <level>]` | `roles`; any explicit setting requires role, per-field provenance |
| Dispatch | `harness builder dispatch <plan> --unit <id> --workspace <path> --parent <id> [--kind guide|worktree|clone] [--harness <name>] [--model <selector>] [--effort <level>]` | `dispatch, packet`; delivers the work packet directly; transport observation is not permission |
| Self-check | `harness builder self-check <packet> --sha256 <digest>` | `packet, expected, observed, warnings`; optional read-only orientation; mismatches warn and do not change state |
| On-track | `harness builder on-track <plan> [--unit <id>] [--from <ref>] [--to <ref>] [--untracked]` | `compared, mode, basis, from, to, includes_worktree, includes_untracked, warnings, issues`; read-only advisory comparison, exit 0, no readiness or receipt prerequisite |
| Advance | `harness builder advance <plan> --now <node>` | `flow, now, warnings`; checks canonical departure gates, never another lifecycle |
| Compose | `harness builder compose <plan> --import <path>` OR `harness builder compose <plan> --verify <sha>` | `composition`; exactly one mode; import is not proof |
| Review | `harness builder review <plan> --receipt <path>` | `review`; independent decomposition/composition evidence bound to subject and documents |
| Close | `harness builder close <plan> --survivor <path> --allocations <path> --evidence <path>` | `archive, preservation`; surviving evidence outside all retiring roots |
| Tidy | `harness builder tidy <allocation> --preservation <path>` | `allocation, removed`; refuses without ownership, runtime release and reverified preservation |

No implicit confirmations authorize outward push/PR/merge; those remain separate user decisions. Declared guide commands are argv arrays, never arbitrary shell interpolation.

## From reviewed guide to baseline

The guide stage can finish before contract code exists. The PM then implements/commits the shared contract unit and its behavioral checks, obtains a decomposition receipt against its exact subject/basis, and seals:

```bash
harness builder guide "${PLAN}" --check
harness builder review "${PLAN}" --receipt "${TEAM}/review-decomposition.dd.json"
harness builder contracts "${PLAN}" --seal --review "${TEAM}/review-decomposition.dd.json"
harness builder settings "${PLAN}"
harness builder ready "${PLAN}" --unit "${UNIT}"
```

**Order of commits around the seal.** Commit the SOURCE (contract unit, checks, fixtures) first — that commit is the seal's `source_sha`. The seal receipt and the review receipt are then written to disk; commit them whenever you like. Dispatch accepts a plan-repository HEAD that *is* the sealed source **or a descendant of it** — every frozen artifact is digest-checked against the seal, so receipt and evidence commits on top of the sealed source never block a dispatch, and the dispatch record names the plan-root HEAD it observed. A HEAD outside that ancestry is a rewritten or displaced baseline: restore the intended checkout, or review and seal a new source rather than relabelling old evidence. The coder clone starts at the sealed source; new packets carry that `source_sha` explicitly.

Roles resolve repo < guide < explicit fields. Requested model/harness/effort and observed runtime are distinct. Omitted effort stays absent; PID/argv/environment/native-session evidence is recorded only where observed. Provider-served identity remains unverified unless independently attested.

## Map-first dispatch and advisory self-check

Begin every worker briefing with the actual unit map, not bookkeeping:

1. **You own** the complete assigned source/test paths.
2. **You may read** the named contract and dependency paths, with their owners.
3. **Your job** is the unit's responsibility and frozen interface.
4. **Done means** its observable acceptance criteria, proof commands and delivery interface.

Then provide the canonical packet path and SHA-256 from the dispatch result. Current packets use `builder/work-packet` and bind source SHA, maps, interfaces, dependencies, proof, parent, allocation, plan/guide/baseline digests and requested role. Write/read maps guide both coders and PM; they are not mandatory source fences. An out-of-map edit needs no approval or justification. Canonical flow/plan/guide/receipt mutation still belongs to the PM, not a worker's source commit. Global/deployed settings, unrelated workspaces, main, outward push/PR/merge and destructive operations require their own user authorization. Workspace kind is not allocation authority; the authority record must survive removing the workspace.

Packet and dispatch IDs use `<unit_id>-<full-current-source-sha>` from the current guide-bound seal. The packet's nonce is only a correlation value. Dispatch sends the work packet itself and records the observed message ID, outcome and time in `DispatchReceipt.delivery`. Queued transport is not proof that a peer received anything; neither queued nor delivered transport is an import permission gate. Receiving the packet means do the assigned work, with no separate acknowledgement or release.

The worker may run one orientation check from its actual checkout:

```bash
harness builder self-check <packet> --sha256 <digest>
```

The report compares expected and observed packet SHA-256, repository root and HEAD/source SHA. Every mismatch or unavailable observation is a warning with cause and corrective `next_action`, not a refusal or state mutation. A historical packet without `source_sha` uses its in-root digest-bound baseline when readable; missing evidence stays missing. The check neither attests a native runtime nor establishes cleanliness, permission or a clock window. Do not add a receipt exchange around it.

Retain historical packets, acknowledgements and release records unchanged as evidence. Do not replay completed work, rewrite their transport facts or reclassify them as requirements for the current flow. Requested runtime settings remain distinct from observed facts; unsupported optional observations remain absent with named gaps. Independent review still considers historical implementation identities when checking reviewer independence.

## On-track at any time

Use the same ownership comparison as automatic delivery/import/verification without dispatch readiness, a seal, review or a receipt exchange:

```bash
harness builder on-track <plan> [--unit <id>] [--from <ref>] [--to <ref>] [--untracked]
```

With `--unit`, compare that unit's map (`mode: unit`, delivery-stage warnings); otherwise compare all PM maps (`mode: pm`, verify-stage warnings). This is inspection, including on main: it writes no files, receipts or lifecycle state and exits 0. Read `compared`, `issues` and `warnings`, not just the exit code. An unavailable or invalid comparison returns `compared: false` with actionable `issues`, not a command failure or silent success.

- **Basis:** explicit `--from` gives `basis: explicit`; otherwise PM uses an imported `integration_sha` (`import`), then the sealed `source_sha` (`baseline`), then `HEAD` (`head`) when no earlier basis exists. A named unit uses the sealed source or HEAD. Malformed existing basis evidence is an issue, never a silent fallback. `from` and `to` report measured full commit SHAs.
- **Current work:** by default compare through HEAD plus tracked staged/unstaged changes (`includes_worktree: true`). New/untracked files are absent unless `--untracked` is selected. `includes_untracked` makes that selection visible.
- **Committed-only:** explicit `--to` compares committed history only; it excludes staged, unstaged and untracked files, even when `--untracked` was supplied.
- **History:** unit comparison includes every committed touched path in the selected range, including reverted writes; PM comparison uses the endpoint delta. Neither result claims the product works.

Map warnings name `file`, scalar `owning_unit` (a unit ID or `unmapped`) and `stage`; overlapping owners have separate rows. Unit delivery rows also name the actor `unit_id`. Guide-only declaration warnings may use `<guide:field>` when no concrete file exists and explain `code`, `message` and `next_action`. Show warnings and issues with the chosen basis; do not turn them into a second policy engine, permission check or mandatory justification.

## Composition and review

Workers deliver committed `UnitDelivery` records (`unit_id, peer_id, workspace, commit_sha, packet_sha256, baseline_sha`). `baseline_sha` is a full Git source SHA; a FileDigest `sha256` binds bytes. Import consumes an array of these records, verifies the exact current packet/dispatch/external-allocation bindings and source integrity, and integrates in guide order. Maps inform comparison, not permission. Import does not require a self-check/on-track report, acknowledgement, release, transport outcome, nonce challenge or timestamp window. The PM then wires the composition root, regenerates generated assets, commits, and runs `compose --verify <exact composed SHA>`. Only verification sets `artifact_sha` with actual check receipts. A changed artifact requires fresh verification/review.

Integrity failures remain actionable refusals before mutation:

| Cause | Corrective action |
|---|---|
| Wrong checkout root, allocated branch or delivered commit | Return to the allocated tree/branch and deliver its actual committed SHA. |
| Forged, altered or mismatched packet/dispatch/allocation evidence | Recover the exact immutable records and measured digests; never edit evidence to match a claim. |
| One peer identity reused for independent unit deliveries | Use the actual distinct dispatched peers; correct attribution instead of inventing identities. |
| Rewritten baseline or a commit outside sealed-source ancestry | Restore the intended source history or obtain reviewed, newly sealed contracts and new packets. |

Neither coder delivery nor PM composition has an ownership veto: use the guide map to orient, then implement the correct result without out-of-map approval or justification. Ownership-only guide findings are visible warnings, including overlapping writes, read-map coverage, unmapped baseline files and capability/composition-owner declarations; they do not block readiness, sealing, dispatch or advance. `composition.value.warnings` carries guide, delivery and import observations; repeated verification refreshes only verify-stage rows. Every row retains `file` and `owning_unit` visibility for independent review. Real malformed data, ambiguous identities, filesystem confinement, Git/replay failures and failed executable product checks remain failures; warnings do not waive them.

Independent composition review consumes product intent, guide, exact composed artifact, checks and the composition warning list. `ReviewReceipt` records `scope`, `subject_sha`, plan/guide file digests, reviewer identity, requested/observed role, verdict, report digest and findings/dispositions. Same-model self-review is not requested cross-model review. Missing reviewer capability is blocked/not-executed, never silent solo fallback. A solo implementation still owes whatever review was requested.

## Close, preserve, retire

Write final factual progress and closeout evidence first; whole-plan completion is checked at **post-flight exit**, not an earlier review. Close collects required artifacts, WIP, reports, observations, telemetry and relevant Git refs outside **every** retiring root, archives the canonical plan and returns `PreservationReceipt`. Arrays passed to `--allocations` contain `Stored<AllocationRecord>` (`value` plus `ref: {path, sha256}`); `--evidence` contains `{path, category}` with category `artifact|wip|report|observation|telemetry`.

Tidy re-verifies surviving bytes/refs, source drift, allocation ownership and explicit runtime release. Idle is not closed. External/pij ownership, dirty or changed source, live/unknown runtime, survivor nested in retiring root, missing telemetry, or changed preserved bytes must refuse destructive cleanup. Close is reversible local archival; tidy is separate, permission-sensitive retirement. A Git ref alone does not preserve untracked WIP or observations.

Historical completed plans stay readable under their original bindings. Factual DD progress and archive relocation must preserve material plan/guide/code bindings without circular rebaseline requirements; never solve drift by pre-checking future work. Structural `guide --check` and independent architectural judgement remain separate evidence.
