# Workshop: W1+W3 — Render Adapters & Execution-Log Entries (confirmations)

**Type**: API Contract (two small confirmations)
**Plan**: 065-deterministic-documents
**Spec**: pre-plan confirmations — directions ruled in `../workshop-notes.md` (W1/W3 dispositions, D3, D15); consumes `001`/`002`
**Created**: 2026-08-03T16:55+10:00
**Status**: Approved (rulings by Jordan, this session)

**Value Thesis**: Two one-exchange locks that close the workshop backlog: the custom-type render contract (so builds are never silently degraded) and the log-entry shape (kept deliberately minimal).
**Target Proof Level**: Contract Ready · **Current Proof Level**: Contract Ready
**Selected Value Axes**: Implementation Readiness · Proof Quality (honest fallback + loud build) · Cost/Attention Reduction (no machinery beyond need)

---

## W1 — Render adapter contract (LOCKED)

1. **Signature**: pure, synchronous, default-exported — `(value, ctx) => string` (markdown fragment). `ctx` carries column declaration + doc path for relative links. No I/O, no async.
2. **Home**: `.dd/schemas/<package>/<schema>/adapters/<type-name>.ts` — ships with the schema (D14); **presence is registration** (convention discovery, no manifest).
3. **Loading**: `jiti`, exactly as `.harness/extensions/*.ts` load today. No new infrastructure.
4. **Fallback**: unknown/missing/throwing adapter → raw value + type tag (`` `<value>` ⟨type:foo⟩ ``), never crash, never blank.
5. **Loud at build (Jordan's addition)**: `dd build`/render **calls out every adapter issue** in the envelope output alongside the fallback rendering — a degraded render is never silent; doctor repeats it repo-wide as WARN.
6. **D15 tie-in**: the `dd docs` how-to-add-a-schema doc carries a complete worked adapter sample.

## W3 — Execution-log entry shape (LOCKED)

```jsonc
{ "id": "lg-3301", "at": "<ISO>", "text": "<free text>", "links": ["<W9 address>", "…"] }
```

- Minted `lg-` id, timestamp, free-text body, zero-or-more addresses (files, backpressure rows, AC/task items). No typed `kind` now — deferrable additively.
- **Append-only is CONVENTION ONLY (Jordan: "i don't care if they edit")** — no hash chain, no git-diff check, no validate enforcement. **Revises D3's** "enforced by validation" clause. Rejected: hash-chain (a), git-based doctor check (b) — machinery without a customer.

## Decision Space

| Option | Decision | Why |
|---|---|---|
| Adapter registration manifest | Rejected | presence-in-folder is the registration |
| Async/effectful adapters | Rejected | pure value→md keeps render deterministic |
| Silent fallback on adapter failure | Rejected | build calls out every issue (loud, enveloped) |
| Hash-chain / git append-only enforcement | Rejected | convention only — edits are permitted, not policed |
| Typed log-entry kinds now | Deferred | additive later; minimal shape ships |

## Validation / Acceptance

- Both contracts trace to verbatim Jordan locks this session. ✓
- Workshop backlog now closed: W1 ✓ W2 ✓ W3 ✓ W7 deferred W8 closed W9 ✓ W10 ✓. Next: the plan pass.
