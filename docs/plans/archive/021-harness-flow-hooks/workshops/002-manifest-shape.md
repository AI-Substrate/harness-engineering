# Workshop: `--hooks` Manifest Shape

**Type**: API Contract
**Plan**: 021-harness-flow-hooks
**Spec**: [harness-flow-hooks-plan.md](../harness-flow-hooks-plan.md) (§ Business Specification · § Manifest contract)
**Created**: 2026-06-17
**Status**: Approved

**Value Thesis**: The manifest is the **new contract hosts consume** — the thing a host reads once to wire itself in. Pinning its exact shape now (fields, types, the discovery-vs-routing `--json` boundary, forward-compat handle) means shape churn later is cheap to detect and avoid, under the frozen-contract discipline the `--json` envelope already lives by. Get it right once; every host couples to it for years.
**Target Proof Level**: Contract Ready
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Agent Readiness**: an agent host (e.g. `the-flow`) reads `--hooks --json` and wires every seam with zero prose-parsing.
- **Safety to Change**: `manifest_version` + additive-only discipline make future growth detectable and non-breaking.
- **Knowability**: the manifest makes the whole lifecycle surface explicit in one machine-readable place — including which `--event` seam each hook subsumes (the migration map).
- **Cross-Domain Coordination**: it is the wire protocol between the router and any host flow; its fields are the handshake.

**Related Documents**:
- [001-execution-substrate.md](./001-execution-substrate.md) — WS-1: skill-first, so the manifest is *skill-emitted* (mirrors the CLI `data` convention, isn't literally `formatOk`)
- `harness/cli/src/output/envelope.ts` — the CLI `Envelope` house style (payload in `data`, additive `update_available` precedent)
- plan § Manifest contract (v1 default this workshop confirms/refines)

**Domain Context**:
- **Primary Domain**: `eng-harness-flow` (emits the manifest)
- **Related Domains**: `the-flow` (external consumer); `harness-cli` (house-style reference only — WS-1 keeps this skill-side)

---

## Purpose

Pin the exact shape of the `--hooks` discovery manifest: per-hook fields and types, the discovery-vs-routing `--json` boundary, the forward-compat handle, and confirmation of the fixed five-hook spine. Phase 2 builds straight from this.

## Fresh Entrant Outcome

A fresh human or agent should be able to use this workshop to reach **Contract Ready** with no additional context. They should be able to:

- Emit a byte-valid `--hooks --json` response from the schema below.
- Explain why a routing call (`--hook X --json`) must **not** embed the manifest.
- Add a future field without breaking an existing host (the additive rule + `manifest_version`).

## Key Questions Addressed

- Exact per-hook fields (`hook / intent / run_at / kind / invoke / aliases / produces / needs / preconditions`)?
- Match the `doctor` envelope house style, or a lighter shape?
- Confirm the fixed five-hook spine vs derived availability?
- Does `coding` appear as `kind: silent` (advertised but not a fire-point)?

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Contract Ready | Phase 2 must emit this without inventing fields |
| Primary Value Axis | Agent Readiness | A host wires itself from this JSON alone |
| Supporting Value Axes | Safety to Change · Knowability · Cross-Domain Coordination | Versioned, additive, self-documenting, the handshake |
| Downstream Loop Improved | Implementation (Phase 2) + every future host integration | One read replaces prose-parsing; future growth is non-breaking |

## Decision Space

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **Shape A — lighter discovery response** | `--hooks --json` → top-level `{ manifest_version, hooks[] }`; routing call keeps the existing routing envelope + additive `hook`. | Discovery is its own small thing; no routing fields it doesn't have (`requested_stage`/`decision` are meaningless for discovery); easiest to emit by reasoning (skill-first). | A slight departure from "always wrap payload in `data`". | **Selected** |
| **Shape B — full envelope wrapper** | `--hooks --json` → full CLI-style `{ command, status, timestamp, data:{ manifest_version, hooks[] } }`. | Literally matches the CLI `Envelope`. | Carries `status`/`timestamp` a discovery call doesn't need; skill-emitting a faithful CLI envelope by reasoning is more error-prone; over-shaped. | Rejected |
| **Shape C — match doctor exactly** | Make `--hooks` mirror `doctor`'s report struct conventions field-for-field. | Maximal house-style symmetry. | `doctor` is CLI code with `status` per-layer semantics that don't apply; forces ceremony onto a constant table. | Rejected |

**Refines the plan's § Manifest contract** (which pinned `data.hooks`): a *dedicated discovery call* returns **top-level `hooks`** + `manifest_version` — it does not need the `data` wrapper, because there's no routing envelope around it. The `data` convention still governs the **routing** call (`--hook X --json` → envelope with the additive `hook` field). This is **one of two deltas** from the plan's pinned contract — the other is the new `aliases` field (see § Field reference) — fold **both** on the next re-plan.

## Preferred Direction — the v1 manifest contract

### `--hooks --json` (discovery)

```jsonc
{
  "manifest_version": 1,                 // forward-compat handle; bump only on a breaking shape change
  "hooks": [                             // ALWAYS length 5, in lifecycle order (fixed spine — CD-03/KF-05)
    {
      "hook": "pre-flight",
      "intent": "can we fly? — system ready before work",
      "run_at": "session start + each phase start",
      "kind": "fire",                    // "fire" | "silent"
      "invoke": "/eng-harness-flow --hook pre-flight [--phase <id>] [--plan-dir <p>]",
      "aliases": ["session-start", "pre-implement"],   // the --event seam strings this hook subsumes
      "produces": "boot verdict (healthy|SLOW|UNHEALTHY|UNAVAILABLE)",
      "needs": ["--plan-dir?"],
      "preconditions": ["S2-governance", "S4-boot"]    // per-repo variability rides HERE, not in the hook list
    },
    {
      "hook": "pre-coding",
      "intent": "what's provable before we build?",
      "run_at": "after the plan, before implementation",
      "kind": "fire",
      "invoke": "/eng-harness-flow --hook pre-coding --spec <path>",
      "aliases": ["post-spec"],
      "produces": "backpressure-coverage.md",
      "needs": ["--spec"],
      "preconditions": []
    },
    {
      "hook": "coding",
      "intent": "capture friction as you work",
      "run_at": "any time mid-build",
      "kind": "silent",                  // advertised, NOT a fire-point
      "invoke": "harness observe \"<what>\" --kind <kind>",  // a CLI verb — names the invocation, never a child skill
      "aliases": ["task-pause"],         // the --event seam that subsumes this moment (WS-2 adds; see plan KF-02)
      "produces": "one observation buffer entry",
      "needs": ["description", "--kind"],
      "preconditions": []
    },
    {
      "hook": "post-coding",
      "intent": "reflect at a phase boundary — drain",
      "run_at": "each phase end",
      "kind": "fire",
      "invoke": "/eng-harness-flow --hook post-coding --plan-dir <p>",
      "aliases": ["phase-end"],
      "produces": ".retro.md (buffer drained)",
      "needs": ["--plan-dir"],
      "preconditions": []
    },
    {
      "hook": "post-flight",
      "intent": "terminal close-out — harvest + present improvements + encode",
      "run_at": "once, at plan/journey completion",
      "kind": "fire",
      "invoke": "/eng-harness-flow --hook post-flight --plan-dir <p>",
      "aliases": ["plan-complete"],
      "produces": "curated cross-plan view + chosen encodings (human picks)",
      "needs": ["--plan-dir"],
      "preconditions": []
    }
  ]
}
```

### `--hook <name> --json` (routing) — stays the existing envelope + one additive field

The routing call returns the router's existing `--json` routing envelope (`requested_stage`, `actual_stage`, `decision`, `command`, `why`, `rail{…}`, …) with **one additive field**: `"hook": "<resolved-hook-name>"`. It does **NOT** embed the manifest. This is the discovery-vs-routing boundary, resolved:

| Call | Returns | Carries the manifest? |
|------|---------|----------------------|
| `--hooks --json` | `{ manifest_version, hooks[5] }` | **yes** (it *is* the manifest) |
| `--hook X --json` | routing envelope `+ "hook": "X"` | **no** (additive field only) |

### Field reference

**Top-level**: `manifest_version` (int, ✅) — the forward-compat handle; bump **only** on a breaking shape change. `hooks` (array, ✅) — always length 5, in lifecycle order. Per-hook entry fields:

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `hook` | string | ✅ | one of the 5 stage-neutral names |
| `intent` | string | ✅ | one-line "why run here" |
| `run_at` | string | ✅ | lifecycle position (the trigger), distinct from `intent` (the purpose) |
| `kind` | `"fire"` \| `"silent"` | ✅ | `coding` is the only `silent` |
| `invoke` | string | ✅ | exact call form; **one-door** — names the invocation, never a child skill |
| `aliases` | string[] | ✅ | the `--event` seam strings this hook subsumes (the migration map) |
| `produces` | string \| null | ✅ | artifact/verdict, or `null` |
| `needs` | string[] | ✅ | inputs the call wants (`?` = optional) |
| `preconditions` | string[] | ✅ | adoption rungs that gate it (e.g. `S2-governance`); `[]` when none — the **only** place per-repo variability lives |

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| CLI `Envelope` carries payload in `data`; additive-only | `harness/cli/src/output/envelope.ts:30–45` + `UpdateAvailable` comment L15–28 | Shape A mirrors the *convention*; `manifest_version` is the additive forward-compat handle | Validated |
| WS-1 → skill-first | workshops/001-execution-substrate.md | manifest is skill-emitted; lighter Shape A is easier to emit reliably by reasoning | Validated |
| Six `--event` seams incl. `task-pause` | plan KF-02 (SKILL.md L129–130) | `aliases` field must list all seams; `coding.aliases = ["task-pause"]` | Validated |
| Fixed five-hook spine | plan CD-03/KF-05 | `hooks` is always length 5; variability rides in `preconditions` | Validated |

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| Implementation (Phase 2) | "which fields? is it wrapped in `data`?" | Exact schema + the discovery-vs-routing boundary, copy-pasteable |
| Host integration | parse prose to learn seams + which `--event` maps where | one `--hooks --json` read; `aliases` gives the migration map for free |
| Future growth | risk a breaking reshape | additive-only + `manifest_version`; hosts detect change deterministically |

## Validation / Acceptance

Contract Ready — confirmed by:

- Every per-hook field has a name, type, and required/optional marker. ✅
- The discovery (`--hooks`) vs routing (`--hook X`) `--json` boundary is unambiguous (table above). ✅
- `coding` is `kind: silent`; the spine is fixed at 5; variability rides only in `preconditions`. ✅
- A forward-compat handle (`manifest_version`) exists and additive growth is specified. ✅

## Open Questions

### Q1: Plan delta — `data.hooks` → top-level `hooks`?

**RESOLVED (workshop authoritative).** The dedicated discovery call uses top-level `hooks` + `manifest_version` (Shape A). AC-02 currently says `data.hooks`; fold this refinement (plus the new `aliases` field) into the plan on the next re-plan.

### Q2: Should `preconditions` carry structured codes or prose?

**RESOLVED.** Short stable codes (`S2-governance`, `S4-boot`) — machine-matchable to the adoption gate, not free prose. Only `pre-flight` carries any in v1.

### Q3: Is `aliases` net-new scope?

**RESOLVED — no.** It exposes existing `--event` seam strings the router already accepts; it's a *read* of current behavior, and it's the cheapest possible migration aid for hosts moving off `--event`.

---

> Routing is the flow's job — run the parent flow bare to continue.
