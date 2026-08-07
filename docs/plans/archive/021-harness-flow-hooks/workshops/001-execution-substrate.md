# Workshop: Execution Substrate — Skill-interpreted vs CLI-backed Hooks

**Type**: Integration Pattern (substrate decision + consumer contract)
**Plan**: 021-harness-flow-hooks
**Spec**: [harness-flow-hooks-plan.md](../harness-flow-hooks-plan.md) (§ Business Specification)
**Created**: 2026-06-17
**Status**: Approved

**Value Thesis**: Settles the one open fork (WS-1) that governs the plan's phase shape — whether `--hook`/`--hooks`/`--help`/`--emit-injection` execute as agent-interpreted skill instructions or as deterministic `harness` CLI verbs. Resolving it lifts the plan's *conditional* readiness to unconditional and tells the implementer, with evidence, that **no CLI phase inserts now** — and names the exact, objective trigger under which one would.
**Target Proof Level**: Contract Ready
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Implementation Readiness**: the implementer can build Phases 1–4 knowing the substrate is skill-only and *which* flag maps to *which* substrate, with no further judgment call.
- **Safety to Change**: names a clean, narrow escalation seam so a future CLI move is additive, not a rewrite — and proves routing *cannot* move to the CLI without porting the router.
- **Cost / Attention Reduction**: kills a speculative CLI phase (CS-3 stays CS-3) by showing the only live consumers are agents, for whom skill-emission is already an MCP-stable contract.
- **Knowability**: makes explicit a hidden fact — the router's `--json` envelope is *already* skill-emitted today, and `harness observe` is *already* CLI; the architecture is already hybrid along a principled line.

**Related Documents**:
- [research-dossier.md](../research-dossier.md) — CD-01 (the fork), prior-art A/B, PL-01/09 (statelessness)
- [harness-flow-hooks-plan.md](../harness-flow-hooks-plan.md) — KF-04 (substrate undecided), Domain Manifest (conditional CLI rows)

**Domain Context**:
- **Primary Domain**: `eng-harness-flow` (the router skill)
- **Related Domains**: `harness-cli` (consume-only unless escalated); `the-flow` (external consumer, not modified)

---

## Purpose

Decide the **execution substrate** for the hooks surface and record it as an authoritative decision the plan reads. Concretely: does each new flag run as markdown the agent interprets, or as a compiled `harness` CLI verb? The answer reshapes the phase plan (a CLI phase inserts or it does not) and pins the conditional rows in the Domain Manifest.

## Fresh Entrant Outcome

A fresh human or agent should be able to use this workshop to reach **Contract Ready** with no additional context. They should be able to:

- State which substrate each of the four flags uses, and *why* (the substrate-split table).
- Explain why `--hook` routing **cannot** be CLI-backed without porting the entire router.
- Apply the objective escalation trigger to decide, later, whether a CLI verb is now warranted.
- Build Phases 1–4 as a skill-only change with confidence that no CLI work is owed.

## Key Questions Addressed

- Skill-interpreted instructions, a real `harness flow --hooks` CLI verb, or hybrid?
- Does "as if it was a program" (the user's `--help` ask) require CLI determinism?
- Does statelessness / leanness favor skill-only — and where does determinism genuinely matter?
- If we stay skill-first, what is the precise, testable condition that would later justify a CLI verb?

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Contract Ready | Phases 1–4 must be buildable from this decision with no re-litigation |
| Primary Value Axis | Implementation Readiness | The decision directly sets the phase count and the Domain Manifest's conditional rows |
| Supporting Value Axes | Safety to Change · Cost/Attention Reduction · Knowability | A clean escalation seam, no speculative CLI phase, and a surfaced hidden architecture fact |
| Downstream Loop Improved | Implementation (Phase 1 start) | The implementer stops asking "is there a CLI phase?" — the answer is recorded with evidence |

## Decision Space

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A — Skill-first (skill-only)** | Agent interprets SKILL.md to print `--hooks`, `--help`, route `--hook`, render `--emit-injection`. No CLI code. | Leanest (no `harness/cli` blast radius, no new tests/build); preserves statelessness-by-reasoning; **matches today** — routing `--json` is *already* skill-emitted; manifest is a fixed 5-entry constant the agent reproduces reliably; CS stays 3. | `--help`/manifest not byte-deterministic; not directly machine-callable without an agent in the loop (hypothetical MCP/CI consumer). | **Selected (v1)** |
| **B — CLI-backed** | Add a `harness flow`/`harness hooks` core act emitting the manifest + help via the real `Envelope`/help machinery. | Byte-stable, directly machine-callable, vitest-testable, "literally a program." | **Routing can't move to the CLI** (signals A–J + conflict matrix + adoption gate are agent reasoning) → this only ever owns the *static* pieces; speculative — **no live non-agent consumer exists today**; +1 act+service+tests+docs-manifest entry; CS-3 → CS-4; touches `harness/cli`. | Rejected (v1) — reserved as escalation |
| **C — Hybrid (split by nature)** | Skill owns `--hook` routing + `--help` + `--emit-injection`; CLI owns a deterministic `--hooks` *manifest* verb. | Honest decomposition (route-by-reasoning stays skill; the one pure-data artifact is CLI). | Builds the CLI verb **before any consumer needs it** (YAGNI); same `harness/cli` cost as B for the manifest piece. | Rejected now → **is the escalation target** |

## Preferred Direction — Skill-first, with a named CLI escalation seam

**Decision: Option A (skill-first) for v1.** The hooks surface is realized entirely in `eng-harness-flow/SKILL.md` + references — no `harness/cli` change. This **confirms the plan's default**, so the four-phase skill-first shape holds and **no CLI phase inserts**. The conditional Domain Manifest rows (`harness/cli/src/**`, `docs/how/harness-flow-hooks.md`) stay **deferred**.

### Rationale (evidence-led)

1. **Routing is irreducibly skill.** `--hook <name>` resolves by reasoning over detection signals A–J and the conflict matrix — that is the router's whole job. There is **no `harness flow` act** in `harness/cli/src/app.ts` today; the `--json` routing envelope (`requested_stage`, `actual_stage`, `decision`, …) is *already* agent-emitted. So a "CLI-backed `--hook`" would require porting the entire router into the CLI — out of scope, against the lean budget (SKILL.md is 347 lines), and contrary to statelessness-by-reasoning (PL-01). The only CLI-ownable pieces are the *static* manifest and help — never the routing.

2. **The manifest is a fixed constant, exactly where determinism matters least.** The five-hook spine is closed (CD-03 / KF-05). A constant 5-row table is the *one* case where "derive by reasoning" is trivially reliable — the determinism argument for code is weakest precisely where the data never varies.

3. **The architecture is already hybrid along a principled line — follow it, don't redraw it.** `harness observe` (`acts/observe.ts`) is *already* a CLI verb: the **`coding` hook's** silent capture writes a real buffer with side effects. The existing seam is *side-effecting fire-points → CLI; routing/reasoning → skill*. The hooks vocabulary should ride that existing line, not invent a new skill-vs-CLI split.

4. **"As if it was a program" is a UX steer, not a determinism requirement.** The user asked `--help` to *feel* like a CLI — synopsis, flags, print-and-stop. A markdown skill renders that faithfully. The phrase does not demand compiled output; if it ever does (a true non-agent caller), that is the escalation trigger below.

5. **No live non-agent consumer exists.** The manifest's consumers today are *agents* (`the-flow` reads it agent-to-agent; `--emit-injection` output is generated once at wire-up, not polled). For an agent, skill-emission is already an MCP-stable contract. Building a CLI verb now is speculative (YAGNI) and spends CS + `harness/cli` blast radius on determinism nobody needs yet.

### Substrate split (the contract — which flag runs where)

| Surface | Substrate (v1) | Why | Escalation |
|---------|----------------|-----|-----------|
| `--hook <name>` (routing) | **Skill** (always) | Reasoning over signals A–J + conflict matrix; cannot be CLI without porting the router | Never moves alone |
| `--help` | **Skill** | Presentation/print-and-stop; lean; replaces longhand prose | Moves only if the whole router becomes a CLI verb |
| `--emit-injection <idiom>` | **Skill** | Renders the fixed manifest into a host idiom; generated once at wire-up | Moves only with the manifest |
| `--hooks` (manifest) | **Skill (v1)** | Fixed 5-entry constant; agents consume it agent-to-agent | **CLI-ownable** — the natural seam *if* the trigger fires |

### Escalation trigger (objective — not vibes)

> Escalate `--hooks` to a CLI act (Option C) **when, and only when, a named non-agent consumer must read the manifest deterministically without an agent in the loop** — e.g. a CI job or MCP tool that calls `harness flow --hooks --json` directly and asserts on byte-stable fields. Until such a consumer is named, stay skill-first.

When it fires, the move is **additive and clean**: add a `registerFlowAct` (or `registerHooksAct`) following the `observe`/`doctor` template — `formatOk('flow', { manifest_version: 1, hooks: [...] }, clock, …)` — register it in `buildProgram`, add a `docs-manifest.json` entry, and have the skill *call* it instead of reasoning the manifest. Routing/help/emit-injection stay in the skill. This is the deferred Domain Manifest rows coming to life — no rework of Phases 1–4.

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| No `harness flow` act exists; core acts enumerated | `harness/cli/src/app.ts:193–205` (`buildProgram`) | Routing is already skill-emitted, not CLI | Validated |
| `harness observe` is a real CLI verb with side effects | `harness/cli/src/acts/observe.ts:47–168` | `coding` hook already CLI-backed → architecture already hybrid | Validated |
| Adding a core act is a register-act pattern + `Envelope` house style | `app.ts:156–212`; `output/envelope.ts` (`formatOk`/`Envelope`) | Escalation is cheap + additive when triggered | Validated |
| `--json` routing envelope is the skill's contract (`requested_stage`/`decision`/…) | research-dossier.md §"The `--json` envelope"; SKILL.md | Skill-emission is already an MCP-stable contract for agents | Validated |
| Fixed 5-hook spine; manifest derived not stored | plan KF-05, CD-03; manifest contract block | Determinism matters least where data is constant | Validated |
| SKILL.md 347-line lean budget | plan KF-06 / CD-06 | Porting routing into CLI / duplicating prose is disallowed | Validated |
| Statelessness load-bearing; re-derive every call | research-dossier PL-01/PL-09 | Skill-first preserves the router's core invariant | Validated |

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| Implementation | "Is there a CLI phase? Which flag is code vs markdown?" — open | Skill-only; substrate-split table answers per-flag; CS-3 holds |
| Review | Reviewer must reason about whether routing belongs in the CLI | Recorded: routing is irreducibly skill (with the `app.ts` evidence) |
| Future change | A CLI move looks like a rewrite | Named additive seam + objective trigger; `observe`/`doctor` template cited |
| Planning | Plan Status stuck at "READY (conditional on WS-1)" | WS-1 resolved → unconditional READY; conditional Manifest rows formally deferred |

## Validation / Acceptance

This workshop reaches Contract Ready — confirmed by:

- The substrate of every flag (`--hook`, `--hooks`, `--help`, `--emit-injection`) is stated with a one-line why. ✅
- The claim "routing cannot be CLI-backed without porting the router" is backed by `app.ts` (no `flow` act; routing envelope skill-emitted). ✅
- The escalation trigger is objective (a *named non-agent consumer* asserting on byte-stable `--hooks --json`), not a feeling. ✅
- The decision maps to a concrete plan effect: no CLI phase; conditional Domain Manifest rows deferred; Status → unconditional READY. ✅

## Open Questions

### Q1: Does WS-2 (manifest shape) change this decision?

**RESOLVED — No.** WS-2 refines the *fields* of the manifest; this workshop decides the *substrate* that emits them. The v1 manifest contract pinned in the plan (5 entries + `manifest_version: 1`) is emitted by the skill regardless of WS-2's field choices. If WS-2 grows the per-entry shape substantially *and* the escalation trigger fires, both fold into the same CLI act.

### Q2: Does keeping `--emit-injection` skill-side risk neutrality (WS-3)?

**OPEN (owned by WS-3).** Out of scope here — substrate ≠ scope. Skill-side rendering does not by itself erode the idiom-not-product rule; WS-3 decides v1-vs-v2 and the neutrality guard.

---

> Routing is the flow's job — run the parent flow bare to continue.
