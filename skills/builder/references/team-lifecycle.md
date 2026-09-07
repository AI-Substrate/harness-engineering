# Builder team operations

The skill decides and explains; `harness builder` checks and records. The existing canonical flow owns lifecycle position. Baseline, dispatch, acknowledgement and composition are implementation substeps, not another stage graph. Team DD records are facts, never a second independently advanced state machine.

## Capability and envelope contract

Probe `harness builder --help`, the needed subcommand help, `harness flow --help` and `node_modules/.bin/ddocs --help` before mutation. In the harness source repo use `node harness/cli/bin/harness.js`; in a consumer use its installed harness. Missing support returns a named prerequisite (unsupported runtime: E473), never an invented flag/model/root or silently downgraded review.

Read the existing JSON envelope, not terminal logs. Outcomes: `ok` exit 0; `degraded` exit 0 with required `next_action`; `unconfigured` exit 2 with `next_action`; `error` exit 1 with `next_action`. `ready` reports `ready|not-ready|cant-tell`; the latter two do not authorize dispatch. An advisory zero exit alone is not a readiness decision.

## Public grammar

These forms follow `harness/cli/src/services/builder/commands.ts`; angle-bracket values are user/record inputs, not shell syntax to paste literally.

| Operation | Invocation | Returned data / boundary |
|---|---|---|
| New | `harness builder new <slug> --workspace <path> --actor <id> [--kind worktree|clone] [--base <ref>] [--title <text>] [--phase <titles...>]` | `allocation, plan, flow`; reserves before allocating; new explicit directory |
| Adopt | `harness builder adopt <plan> --actor <id> [--owner external|pij]` | `allocation, plan, flow`; records existing workspace, never claims harness ownership |
| Guide | `harness builder guide <plan> [--init|--check]` | `guide, checks`; init only if absent; structural check is not architectural judgement |
| Readiness | `harness builder ready <plan> [--unit <id>]` | `status, issues, context, guide, baseline`; re-observes current basis |
| Contracts | `harness builder contracts <plan> [--seal --review <path>]` | `baseline`; seal and review must occur together; checked committed inputs |
| Settings | `harness builder settings <plan> [--role coder|reviewer] [--harness <name>] [--model <selector>] [--effort <level>]` | `roles`; any explicit setting requires role, per-field provenance |
| Dispatch | `harness builder dispatch <plan> --unit <id> --workspace <path> --parent <id> [--kind guide|worktree|clone] [--harness <name>] [--model <selector>] [--effort <level>]` | `dispatch, packet`; acknowledgement-only setup, not work release |
| Acknowledge | `harness builder ack <plan> --receipt <path>` | `dispatch, packet`; exact pre-work or post-release AckReceipt identity, phase-derived nonce and current native bindings; confirmation never grants/sends a release |
| Advance | `harness builder advance <plan> --now <node>` | `flow, now`; checks canonical departure gates, never another lifecycle |
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

**Order of commits around the seal.** Commit the SOURCE (contract unit, checks, fixtures) first — that commit is the seal's `source_sha`. The seal receipt and the review receipt are then written to disk; commit them whenever you like. Dispatch accepts a plan-repository HEAD that *is* the sealed source **or a descendant of it** — every frozen artifact is digest-checked against the seal, so receipt and evidence commits on top of the sealed source never block a dispatch, and the dispatch record names the plan-root HEAD it observed. What is refused: a HEAD the sealed source is not an ancestor of (a rewritten baseline, a checkout moved off its history). The coder clone is different: it must start at exactly the sealed source, and its acknowledgements are checked against that.

Roles resolve repo < guide < explicit fields. Requested model/harness/effort and observed runtime are distinct. Omitted effort stays absent; PID/argv/environment/native-session evidence is recorded only where observed. Provider-served identity remains unverified unless independently attested.

## Dispatch and acknowledgement

Packets freeze scope, allowed writes/reads, interfaces, dependencies, proof, parent, allocation, plan/guide/baseline digests and requested role. Forbid canonical flow/plan/guide/receipt writes, other units, global/deployed settings, main, pushes and unapproved deletion. Workspace kind is not allocation authority. The authority record must survive removing the workspace.

Derive the attempt from the **current guide-bound sealed source**, not a caller's old delivery: `<unit_id>-<full-current-source-sha>`. Packet and dispatch IDs use their kind plus this attempt. The unchanged `harness builder ack <plan> --receipt <path>` accepts two exact `AckReceipt.id` values:

| Phase | Exact receipt ID | Expected `nonce` | Meaning |
|---|---|---|---|
| Pre-work | `ack-<unit_id>-<full-current-source-sha>` | `packet.nonce` | Pristine-source acknowledgement before work release |
| Post-release | `ack-<unit_id>-<full-current-source-sha>-release` | Already-recorded `release.message_id` | Fresh observation that the already-issued exact release was received |

Phase comes from exact ID equality, never a filename, loose prefix, release presence or an older source. The `-release` suffix follows the full SHA, so a unit whose ID starts with `release-` cannot collide. Retrying the pre-work receipt remains idempotent and **cannot** confirm queued delivery. A unit-only or stale record is never an authorization fallback. Original records stay immutable; operation locks stay unit-scoped across attempts.

Dispatch seeds a clone/worktree-only relative canary. The packet contains only its path, never the answer. Read packet and canary through native repository-relative file tools; shell `cd` or an absolute read cannot establish native-root binding. Both phases use the existing raw `AckReceipt` fields: `record_type`, `id`, `recorded_at`, `unit_id`, `peer_id`, `nonce`, `packet_sha256`, `baseline_sha`, `native_root`, `shell_cwd`, `canary_nonce`, `observed`. `baseline_sha` is the full Git source SHA, not the baseline file digest.

1. **Before release:** the peer observes the pristine source, native root and actual supported runtime, writes the pre-work receipt, and sends its path/SHA-256. The PM ingests it through `harness builder ack <plan> --receipt <pre-work-receipt>`. No work until the peer actually sees its exact-bound release; `queued` is not received.
2. **After observing that release:** the peer natively re-reads packet/canary, refreshes runtime observations, and writes a **new** post-release receipt at a new private path. Its nonce is the retained release's `message_id`, independently of `packet.nonce` even if their values happen to match. Use the received release identity bound to the PM's retained DispatchReceipt, never an invented or assumed message ID. Send the new path/SHA-256, then follow the already-granted scope; **do not wait for a second grant**. A peer that has already completed that scope can confirm its real retained release without replaying work again.
3. **Before import:** the PM ingests that exact fresh receipt through the same command: `harness builder ack <plan> --receipt <post-release-receipt>`. It records observed delivery only, never sends or grants another release. A queued dispatch remains refused by composition until confirmation is accepted; do not hand-edit its outcome or weaken import. Already-delivered transport remains valid; confirmation may still be retained without changing the original grant.

Post-release checks preserve unit/peer/packet/current-source/root/canary/runtime bindings and re-observe the allocated branch/source ancestry. They do **not** require a pristine checkout or HEAD equal to baseline: already-authorized work may have started. The pre-work pristine-source check stays intact. Record only observed optional harness/model/effort/session/PID/argv fields; unsupported facts belong in `observed.gaps`. Requested settings and launch configuration are not provider attestation.

Use the peer's actual new receipt creation time for `recorded_at`. The explicit peer-clock skew tolerance is **5000 ms**: the timestamp must parse and fall inclusively between `release.recorded_at - 5000 ms` and PM ingestion time `+ 5000 ms`. Outside that interval, report clock skew or an incorrect/tampered receipt; never backdate it or silently widen the tolerance. PM records peer observation and ingestion times in `observed.evidence`, preserves the original sent time/message ID and queued transport facts, and binds the canonical confirmation path/digest there.

Identical confirmation retries are safe, including a receipt persisted before a dispatch-CAS failure; changed immutable bytes refuse. Neither path resends a release. Independent review considers every recorded implementation identity, including historical attempts, without treating historical receipts as current authorization.

## Composition and review

Workers deliver committed `UnitDelivery` records (`unit_id, peer_id, workspace, commit_sha, packet_sha256, baseline_sha`). Import consumes a JSON array of those records, verifies current basis/ownership and confirmed release delivery, and integrates in guide order. Missing/queued confirmation is resolved by ingesting the peer's fresh `-release` AckReceipt through `harness builder ack`, not by retrying the pre-work receipt. The PM then wires the composition root, regenerates owned generated assets, commits, and runs `compose --verify <exact composed SHA>`. Only verification sets `artifact_sha` with actual check receipts. A changed artifact requires fresh verification/review.

PM composition has no ownership veto: use the guide map to orient, then write the correct integration without an amendment or justification. Both PM comparison points continue with `composition.value.warnings`: each row names `file`, `owning_unit` (unit ID or `unmapped`), and `stage` (`import` or `verify`); overlapping owners have separate rows. Import observations remain; repeated verification replaces only verify-stage observations. Review these rows alongside the composed bytes, including when a real check is red. Warnings are not permission, proof, or an extra approval requirement. The current composition increment does not claim that the separate coder-delivery/acknowledgement cutover has shipped.

Independent composition review consumes product intent, guide, exact composed artifact, checks and the composition warning list. `ReviewReceipt` records `scope`, `subject_sha`, plan/guide file digests, reviewer identity, requested/observed role, verdict, report digest and findings/dispositions. Same-model self-review is not requested cross-model review. Missing reviewer capability is blocked/not-executed, never silent solo fallback. A solo implementation still owes whatever review was requested.

## Close, preserve, retire

Write final factual progress and closeout evidence first; whole-plan completion is checked at **post-flight exit**, not an earlier review. Close collects required artifacts, WIP, reports, observations, telemetry and relevant Git refs outside **every** retiring root, archives the canonical plan and returns `PreservationReceipt`. Arrays passed to `--allocations` contain `Stored<AllocationRecord>` (`value` plus `ref: {path, sha256}`); `--evidence` contains `{path, category}` with category `artifact|wip|report|observation|telemetry`.

Tidy re-verifies surviving bytes/refs, source drift, allocation ownership and explicit runtime release. Idle is not closed. External/pij ownership, dirty or changed source, live/unknown runtime, survivor nested in retiring root, missing telemetry, or changed preserved bytes must refuse destructive cleanup. Close is reversible local archival; tidy is separate, permission-sensitive retirement. A Git ref alone does not preserve untracked WIP or observations.

Historical completed plans stay readable under their original bindings. Factual DD progress and archive relocation must preserve material plan/guide/code bindings without circular rebaseline requirements; never solve drift by pre-checking future work. Structural `guide --check` and independent architectural judgement remain separate evidence.
