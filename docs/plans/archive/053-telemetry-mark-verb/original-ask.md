# Original ask — telemetry-mark-verb
**Captured**: 2026-07-05  ·  **By**: /the-flow

> yeah we're thinking we don't vendor the flow, we move it here and own it from
> here. i like your idea on the guards in the verb. you think we do skill update
> / cli in the flow (remember needs windows and linux/mac) and also the verb?
>
> i think we could have the flow emit at lots of things, and also eng-harness
> flow could emit? or not worry - i mean we could emit all flow stages.
>
> /the-flow set up a new flow, just keep it simple mode, no need to to overbake
> whats in it. do explore, plan, validation please then report ready.. or do we
> workshop first?

## Design already settled (this conversation — treat as workshop output)

A **`harness telemetry mark`** verb: a peer's counts-only **self-attestation**
emitted onto its OWN telemetry lane, so a fleet's per-peer semantic report
attributes review/validate/stage work to the peer that did it (not the
orchestrator). Closes the reviewer lane-attribution hole: a read-only reviewer
runs no harness command and may write no file, so its verdict never reaches its
lane today.

Locked decisions:

1. **Shape-guarded generic, NOT freeform-content and NOT a closed enum.**
   `--kind <slug>` and `--verdict <slug>` are shape-guarded identifiers
   (`^[a-z][a-z0-9-]{0,31}$`); finding counts are integer buckets. **No
   free-text field exists.** This is the same *value-shape guard* posture the
   telemetry `captured_env` layer already uses — generic (the harness carries no
   flow vocabulary) yet leak-proof (nothing accepts arbitrary prose into a
   committed, synced `refs/harness-telemetry/*` ref).
2. **The guard lives in the harness verb, not in any skill.** Telemetry captures
   the *actual emitted segment*; the raw verb is the byte path to the ref, so the
   safety boundary must be there. A skill-side formatter one layer up is advice,
   not enforcement.
3. **One cross-platform surface: the verb.** The skill-side "formatter" is
   **prose, not a second binary** — the-flow / flow-pair skill supplies the
   vocabulary + mapping (which `kind`, which `verdict`) and the agent constructs
   the `harness telemetry mark …` call. No bash/ps1 helper to port across
   Windows + Linux/Mac; the one executable surface (the Node `harness` CLI) is
   already cross-platform. If determinism beyond agent-judgment is ever needed,
   push it INTO the verb, never into a skill-side script.
4. **Marks are zero-cost annotations, distinct from work-segments.** They must be
   identifiable (`command: mark`) and excluded from cost aggregation so a
   blanket-marked spine never double-counts tokens.
5. **Sequencing (no boil-ocean):** ship the verb + ONE emit (the reviewer
   verdict) → prove the fleet report consumes it (reviewer work on the reviewer's
   lane, distinct from the coder's) → THEN wire the seam machinery to drop a
   `--kind <stage>` mark at each hook, expanding the semantic spine
   *mechanically* (positional, compaction-robust) rather than as a freehand chore
   that rots.

Related standing decision under review (NOT part of this plan's scope): moving
the-flow in-repo and owning it here reverses the `no-vendor-the-flow` decision +
the `the-flow-source-and-deploy-topology` deploy chain — decide deliberately, its
own moment.

**Scope of THIS flow**: explore → plan → validation → report ready. Simple mode.
No implement/ship in this pass.
