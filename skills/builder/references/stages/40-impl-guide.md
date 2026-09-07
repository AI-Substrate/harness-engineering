# guide

> Sub-skill — owns the implementation guide and decomposition evidence, not flow position.

**Verb**: guide
**Purpose**: Turn approved product intent into an architecture-enabled delivery contract. Decide whether independent coders help before allocating them.
**Consumes**: `plan.dd.json`, research/workshop/ADR constraints, actual source interfaces and `assets/backpressure.dd.json`.
**Flags**: `--plan "<path>"`
**Produces**: `assets/impl-guide.dd.json` and its generated sibling; independently reviewed decomposition. A guide is not a code baseline or implementation release.

## Procedure

1. Discover `harness builder guide --help`, `harness builder contracts --help`, `harness builder settings --help` and local `node_modules/.bin/ddocs --help`. Missing capability is an explicit prerequisite; never hand-author another lifecycle or substitute a model/root fallback.
2. `harness builder guide "${PLAN}" --init` creates a missing guide without overwriting one. Read the guide with `harness builder guide "${PLAN}"`; author its existing schema through local DD writers.
3. Map each product AC to a capability, its real entrypoint/call path, one accountable owner and one or more executable checks. Include composition behavior: unit tests alone do not prove a wired product. Link `capabilities[].criterion`, `units[].acceptance` and `proof` to actual DD addresses.
4. Define architecture first: injected ports, immutable/shared DTOs, errors, ownership of side effects and the explicit composition root. Reuse repository adapters/fakes. Freeze exported signatures and a contract fixture before workers need them; prohibit same-wave imports of sibling implementation. One independently testable behavior per unit, not one file per worker.
5. Choose `fan_out.decision: coders` only when contracts make units genuinely runnable independently; state the rationale. Otherwise choose `solo-pm` with `isolation.mode: solo`. Solo is a deliberate architectural result, never a fallback for unavailable requested cross-model review. A tightly coupled transaction may rightly stay together.
6. Fill EVERY guide section: `meta`, `architecture`, `fan_out`, `capabilities`, `units`, `baseline`, `isolation`, `roles`, `checks`, `composition`, `review`, and relevant `risks`. Units declare `paths`, explicit `reads` owners, `interface`, `depends_on`, `wave`, `acceptance`, `proof` and role `pm|coder`. The baseline unit precedes independent coders; the PM composition unit consumes their deliveries after them. Every dependency must precede its consumer; no cycles or overlapping writers hidden in notes.
7. Set baseline files to the minimal load-bearing contracts/fakes/schemas. `baseline.receipt` is relative to the guide directory (normally `team/baseline.dd.json`). Checks carry argv (`command`, `args`, `cwd`, `timeout_ms`), not shell snippets. Include an actual assembled behavior check, not just compilation or separate unit checks.
8. Resolve roles with `harness builder settings "${PLAN}"`. Precedence is repo < guide < explicit fields; retain `source` per field. Coder and reviewer model/harness are explicit; omitted effort remains absent. Discovery of a supported model is not provider attestation. Distinguish allocation owner (`harness|external|pij`) from checkout kind (`worktree|clone`); record the authority outside removable roots.
9. Run `harness builder guide "${PLAN}" --check`. Its structural check proves ownership, dependencies and links, NOT architectural judgement. Obtain independent decomposition review against the exact plan/guide digests; record through `harness builder review "${PLAN}" --receipt "<review DD path>"`. A reviewer reports findings, subject/basis and observed configuration. Requested but unavailable review stays unfulfilled, never relabelled as a solo success.
10. Resolve review findings in the guide. This stage exits after guide/decomposition approval; the future committed contract baseline belongs to implementation. Do not require that future SHA to exit this stage, and do not pre-check future work.

## Source recipe and examples

Use `../backpressure-recipe.md` for selected RUN/EXTEND/BUILD/ABSENT proofs, every AC/assertion `pressure`, and observed `proven_by` links. Certainty stays `Partial|Confident|Proven`; selection alone never earns Proven.

`../../examples/verify.mjs` exercises good independent units, a justified solo case, bad coupling, injected fakes and explicit composition. `../../examples/lifecycle.mjs` constructs coherent example records using measured example bytes; these are teaching fixtures, not evidence that a real peer ran. The full operational grammar and permission boundaries live in `../team-lifecycle.md`.

## Exit

Report guide path, chosen fan-out with rationale, contracts, ownership/waves, capability coverage, exact independent review evidence and remaining gaps. Do not move the flow cursor or release workers. Routing is the flow's job — run the parent flow bare to continue.
