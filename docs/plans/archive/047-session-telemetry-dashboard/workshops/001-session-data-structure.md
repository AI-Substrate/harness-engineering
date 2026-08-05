# Workshop: Session Data Structure — the combined-OTel session file

**Type**: Storage Design / Data Model
**Plan**: 047-session-telemetry-dashboard
**Spec**: [session-telemetry-dashboard-plan.md](../session-telemetry-dashboard-plan.md) *(to be authored)*
**Grounds in**: a read-only inventory of `harness/cli/src/services/telemetry/` + `docs/plans/038-telemetry-otel-standard/` + `scratch/old/session-view/`
**Created**: 2026-07-01
**Status**: Approved

**Value Thesis**: Lock the **on-disk shape of a saved session** — the many telemetry segment files combined into **one file, still OTel format** — with a thin, validatable, forward-compatible envelope, so the HTML view and the dashboard are thin views over *one* stable data contract we never have to rebuild. Decided before any code so the export/render/dashboard layers all read the same shape.
**Target Proof Level**: **Contract Ready** (schema + combine algorithm + the two sources + identity keying — buildable as core CLI with no further design)
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Knowability** — a session becomes one portable, inspectable artifact instead of a scattered spool.
- **Implementation Readiness** — TS + JSON Schema + the real segment/OTLP facts + the combine algorithm.
- **Migration Safety** — additive `schema_version` + OTLP's own attribute extensibility → new fields never break historical exports.
- **Cross-Domain Coordination** — one shape the export, the HTML render, the dashboard, and (later) repo/org roll-ups all consume.

**Related Documents**:
- [038 — telemetry-otel-standard](../../038-telemetry-otel-standard/) — the per-segment OTLP mapping this combines.
- 046 [flow-eval-loop](../../046-flow-eval-loop/flow-eval-loop-plan.md) — its `RunRecord.session_export` *references* one of these files (the consumer, not the owner).

---

## Purpose

Decide the data structure for a **saved session**: the many per-segment telemetry files combined into **one file, still in OTel format**, extractable from the live temp buffer **or** the committed git ref (read-only), with a schema we can validate and extend additively. Plus the rule that **saving co-produces an HTML view beside the data file**.

## Boundary — what this is NOT (read this first)

> **This is the raw telemetry-insights store, NOT the eval-loop RunRecord.** A "session export" is combined OTel telemetry for one coding-agent session — the *source data* for insights/HTML/dashboard. The **scored eval record** (046's `RunRecord` / ledger) is a different, higher-level artifact that merely **references** a session export by path (`RunRecord.session_export`). Telemetry insights ≠ eval scoring. Keep the two structures separate; one points at the other.

## Fresh Entrant Outcome

A fresh human or agent reaches **Contract Ready**: they can build `harness telemetry session save` (core CLI) from the envelope schema + the combine algorithm + the two-source extraction below, with no further design.

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Contract Ready | Core-CLI build proceeds from this |
| Primary Value Axis | Knowability | One portable session artifact |
| Supporting Axes | Implementation Readiness, Migration Safety | Buildable + future-proof |
| Downstream Loop Improved | the HTML render, the dashboard, repo/org roll-ups, 046's eval records | one shape, many consumers |

## The on-disk reality (grounding — what we're combining)

A session today is a **spool of many files** at `.harness/temp/telemetry/<harness_session_id>/`:

```
.harness/temp/telemetry/<harness_session_id>/   # dir name = harness_session_id (sanitized, dot-free)
  1.json   2.json   …          # harness-CUSTOM `Segment` (schema_version 1.0 / 1.1 / 2.0 / 2.2)
  1.logs.jsonl   2.logs.jsonl  # OTLP LogsData  — one per segment (plan 038)
  1.metrics.jsonl …            # OTLP MetricsData — one per segment
  <id>.cursor / .branch / .flushed / .flowcursor   # metadata (dot-containing → not segments)
```

- **The OTLP already exists per-segment**: `<seq>.logs.jsonl` = one OTLP `LogsData` (`resourceLogs[].scopeLogs[].logRecords[]`, one `logRecord` per `event_stream` event), `<seq>.metrics.jsonl` = one `MetricsData`. Envelope is OTLP 1.x; the reconstruction-critical payload rides in `harness.*` attributes under pinned `schema_url = https://github.com/AI-Substrate/harness-engineering/schemas/telemetry/v0.1.0`. **Losslessly invertible** (`otlpLogsToEvents`).
- **`<seq>.json` is custom, not OTLP** (the `Segment` type — `event_stream` of `kind`-tagged events, or a v1 flat view). It's the reconstruction oracle when an OTLP companion is missing.
- **Schema-version drift is real on disk**: mostly `2.0`, plus `1.1` / `1.0` / `2.2`. v1 has **no `event_stream`** (flat `skills`/`tools`/…); the combiner must tolerate both.
- **No "combine many → one session" exporter exists.** Each segment is its own one-line OTLP doc. `scratch/old/session-view/gen.py` already does a *custom* version (globs `*.json` → one `session.json` + HTML) — proof of feasibility, not the shape to inherit.

## Decision Space (resolved)

| Decision | Options | Resolution |
|---|---|---|
| **Single file, "still OTel"** | (a) pure OTLP, two files (logs + metrics); (b) **thin envelope wrapping combined OTLP, one file** | **(b) SELECTED.** OTLP has no single all-signals message, and the user wants ONE file → a minimal envelope holds identity + both merged OTLP signals. The *payload stays OTLP* ("still OTel"); the envelope is the only non-OTLP part. |
| **What "combined" means** | concat raw files / merge OTLP `resourceLogs` | **Merge OTLP** — resource attrs are identical per session, so collapse to **one `ResourceLogs`** + concat `logRecords` in `t` order; same for metrics. |
| **Missing OTLP companions** | skip / regenerate | **Regenerate FORWARD** from `<seq>.json`: `segmentToOtlpLogs(seg)` (`otlp/logs.ts:292`) for logs, `rollupToOtlpMetrics(seg)` (`otlp/metrics.ts:52`) for metrics — both are segment→OTLP *forward* fns, so an older/partial segment still combines. **Note**: only logs are losslessly invertible (`otlpLogsToEvents`, `logs.ts:311`); `rollupToOtlpMetrics` has **no inverse** (metrics are derived/lossy — logs are the substrate), which is fine because we go forward, never invert metrics. |
| **Identity key** | pij id / harness_session_id | **`harness_session_id`** (always present = dir name = git-ref `<session>`); `captured_env.PIJ_SESSION_ID` is a **secondary** cross-agent correlation (present on a minority of segments). |
| **Validation** | none / JSON Schema | **JSON Schema** for the envelope + the existing OTLP/segment schemas for the payload. |
| **Forward-compat** | versioned-breaking / additive | **Additive only** — `schema_version` + ignore-unknown reader + OTLP attribute extensibility; never break a historical export. |

## The data structure (Contract Ready)

A saved session is **one JSON file** = a thin harness envelope around the **combined OTel payload**.

### TypeScript

```typescript
/** Schema id pinned in the file so old exports stay readable as the envelope grows. */
type SessionExportSchema = 'harness.session-export/v1';

interface SessionExport {
  schema_version: SessionExportSchema;        // additive-only evolution
  /** WHO this session is — lifted from the segments' top-level + captured_env. */
  identity: {
    harness_session_id: string;               // primary key (= dir name = git-ref <session>)
    harness: string;                          // coding agent: 'claude-code' | 'copilot-cli' | 'cursor' | …
    harness_version?: string;
    pij_session_id?: string;                  // captured_env.PIJ_SESSION_ID — secondary correlation
    pij_parent_id?: string;
    branch?: string;
    models?: string[];                        // distinct gen_ai.request.model seen
    repo?: string;                            // best-effort (worktree root); implicit today
  };
  /** WHERE it came from + WHEN we pulled it (provenance, not telemetry). */
  source: { kind: 'temp' | 'git-ref'; ref?: string; extracted_at: string };
  /** HOW MANY + span — cheap top-level facts (full detail stays in the OTLP). */
  summary: { segments_combined: number; started?: string; ended?: string; segment_schema_versions: string[] };
  /** THE TELEMETRY — still OTel, just combined. */
  signals: {
    logs: OtlpLogsData;                       // one merged ResourceLogs (collapsed), logRecords in t order
    metrics: OtlpMetricsData;                 // one merged ResourceMetrics
  };
}
```

### JSON Schema (envelope core — additive)

```typescript
export const SESSION_EXPORT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['schema_version', 'identity', 'source', 'summary', 'signals'],
  additionalProperties: true,                 // ← additive: unknown future keys tolerated, never rejected
  properties: {
    schema_version: { const: 'harness.session-export/v1' },
    identity: {
      type: 'object', required: ['harness_session_id', 'harness'],
      properties: { harness_session_id: { type: 'string' }, harness: { type: 'string' } },
      additionalProperties: true,
    },
    source: {
      type: 'object', required: ['kind', 'extracted_at'],
      properties: { kind: { enum: ['temp', 'git-ref'] }, ref: { type: 'string' }, extracted_at: { type: 'string', format: 'date-time' } },
    },
    // signals.logs / signals.metrics validate against the existing OTLP schemas (segment.schema.json siblings)
  },
} as const;
```

> **Why a wrapper and not pure OTLP**: the data scientist gets one file that drops into any OTLP tool (the `signals.*` are standard OTLP), plus a stable harness envelope for identity/provenance/versioning that OTLP's resource attributes alone don't make ergonomic. `additionalProperties: true` + `schema_version` is the additive-forward-compat contract: a v1 reader ignores a field a v2 writer adds; historical v1 files never break.

## Extraction — the two sources (both READ-ONLY)

```
harness telemetry session save <session-id> --out <path> [--source temp|git-ref|auto] [--no-html]
  # <session-id>: --session <pij-id>  OR  --agent-session <harness_session_id>
```

| Source | Where | How (read-only) |
|--------|-------|-----------------|
| **temp** (live) | `.harness/temp/telemetry/<harness_session_id>/` | enumerate `<seq>.json` (filter `/^\d+\.json$/`) + companions; resolve a pij id via the `captured_env.PIJ_SESSION_ID` join (the `session-evidence.ts` precedent) or directly by dir name |
| **git-ref** (committed) | `refs/harness-telemetry/<YYYY>/<MM>/<DD>/<harness_session_id>` | `git cat-file`/`git show` the shard tree (flat OTLP files); a glob `git fetch refs/harness-telemetry/*` finds shards. **Never writes** — satisfies the "never modify git" constraint |

**Combine algorithm** (both sources): for each segment, prefer its OTLP companions; if missing, **regenerate forward** via `segmentToOtlpLogs(seg)` + `rollupToOtlpMetrics(seg)` from `<seq>.json` (never *invert* metrics — they have no inverse; logs only are invertible). Tolerate the **three real on-disk shapes** per seq (`sync-service.ts:258-267`): the `.logs.jsonl`+`.metrics.jsonl` pair, a logs-only/partial spool, and the legacy `<seq>.json`-only fallback. Tolerate v1 flat + v2 event-stream. Merge all `resourceLogs` → one `ResourceLogs` (resource attrs identical per session), concat `logRecords` ordered by `harness.event.t`; merge metrics likewise. Lift `identity`/`summary` from segment top-level + `captured_env`.

## The co-produced HTML view (default-on, opt-out)

Saving to a target path **also writes an HTML render beside the data file** unless `--no-html`:

```
harness telemetry session save <id> --out runs/abc/session.json
  → runs/abc/session.json        # the combined-OTel data structure (above)
  → runs/abc/session.html        # the view, beside it (style: scratch/old/session-view/session-overview.html)
```

- The **HTML is a generated view over the data file, never the store** — regenerable from `session.json` alone. Prior art `gen.py` is the reference for the overview's content (timeline, per-phase/skill flux, token/time totals); we re-implement it as core CLI reading `SessionExport`, not the custom `session.json`.
- `--no-html` opts out (data-only). Default-on because the single-file + its view is the ergonomic unit a human opens.

## Boundary, placement & constraints

- **Core harness CLI** — `harness telemetry session save` lives in `harness/cli/src/services/telemetry/` + command registration (sibling to `telemetry get` / `telemetry sync`), **not** a `.harness/` extension.
- **Insights store ≠ eval record** — see the Boundary section; 046's `RunRecord.session_export` references this file.
- **Branch / git** — all work on `feat/041-flow-conformance-eval` (current PR); **never modify git**; the git-ref source is **read-only** (`cat-file`/`fetch`), never a write/branch/ref mutation.

## Forward-compatibility rules (the additive contract)

1. **`schema_version` is pinned in every file**; readers branch on it and **ignore unknown keys** (`additionalProperties: true`).
2. **Envelope grows additively** — new top-level/identity/summary fields are optional; a v1 file stays valid forever.
3. **OTLP payload extends via attributes** — new `harness.*` attributes don't break old readers (OTLP kvlist semantics); the payload's own contract is the pinned `schema_url`.
4. **Segment-version tolerance** — the combiner reads v1.0/1.1/2.0/2.2 segments; `summary.segment_schema_versions` records what went in.

## Open Questions

### Q1: Explicit `repo` identity. **OPEN (roll-up dependency).** Today a segment has no repo field (implicit by worktree); repo/org roll-ups (out of scope) will need it. Lean: record best-effort `identity.repo` now (worktree remote/root) so the field exists for later, even if imperfect.
### Q2: Logs+metrics in one envelope vs. also embedding traces. **Resolved for now**: logs + metrics only (that's what's emitted). The envelope's `signals` is open to a future `traces` key (additive).
### Q3: Dedup across sources. **Note**: a session may exist in BOTH temp and git-ref (overlapping seqs). `--source auto` prefers git-ref (committed/stable) then fills gaps from temp; dedup by `<seq>`.

## Validation / Acceptance

Contract Ready when:
- The `SessionExport` envelope is specified (TS + JSON Schema) with the combined OTLP as payload — ✅.
- The combine algorithm + both read-only sources (temp, git-ref) + v1/v2 tolerance are unambiguous — ✅.
- The co-produced-HTML rule (default-on, `--no-html`, view-not-store) is stated — ✅.
- The boundary (insights store ≠ eval record) + core-CLI placement + git constraint are explicit — ✅.

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| On-disk spool layout + OTLP companions | §The on-disk reality | what we combine | Ready (inventory-grounded) |
| `SessionExport` TS + JSON Schema | §The data structure | the file shape | Ready (Contract) |
| Two-source read-only extraction + combine algo | §Extraction | the `save` command | Ready (Contract) |
| Co-produced HTML rule | §The co-produced HTML view | save behavior | Ready |
| Additive forward-compat rules | §Forward-compatibility | migration safety | Ready |
