# Harness telemetry — the OTLP/OTEL stored shape

How the counts-only telemetry `segment` (see [Harness telemetry](./telemetry.md))
is **stored and published as OTEL/OTLP** — one file per signal, directly
ingestible by any OTEL collector with zero translation — while still storing
locally and reconstructing the full session timeline.

> **Supplant, not bolt-on.** The internal typed event/rollup model is unchanged;
> only the *stored output shape* is OTLP. Nothing has shipped externally, so there
> is no back-compat layer — the serializer, the schema + freeze test, and the
> downstream scraper move in lockstep (plan 038).

---

## The model in one minute

The capture preamble still writes a counts-only `segment` to the gitignored
buffer. Beside each buffer entry it now also writes the segment **re-serialized as
OTLP/JSON**, one file per signal:

```
.harness/temp/telemetry/<session>/
  <seq>.json            the internal segment buffer (watermark key + reconstruction oracle)
  <seq>.logs.jsonl      OTLP Logs    — the event_stream (one logRecord per event)
  <seq>.metrics.jsonl   OTLP Metrics — the derived rollup (one datapoint per measure)
```

The two `.jsonl` files are the **OTLP spool** — the transport-agnostic artifact a
shipper reads. The serializer has no transport knowledge; it writes through the fs
port with atomic temp+rename. `harness telemetry sync` then publishes the spool
over the keep-and-harden git refs (below). The whole `.harness/temp/` tree
self-ignores, so the OTLP bytes are never committed to a work tree — same privacy
posture as the buffer.

### Two signals, mapped 1:1

| Internal substrate | OTLP signal | File |
|---|---|---|
| `event_stream` (14 event kinds) | **Logs** — one `LogRecord` per event | `<seq>.logs.jsonl` |
| derived `rollup` (6 measure groups) | **Metrics** — cumulative-per-session datapoints | `<seq>.metrics.jsonl` |
| identity / window / branch | **Resource + Scope attributes** | both files |

`rollup === null` (an empty stream) ⇒ the metrics file carries **no datapoints**
(never zero-filled). Metric temporality is **cumulative, per session** — each CLI
run is a fresh metric lifetime; never stitch across sessions.

---

## Schema policy — the two-layer field-naming rule

The reconstruction-critical data must survive OTEL semantic-convention churn, so
naming is split into two deliberate layers:

1. **Conform the envelope.** The OTLP/JSON structure (`resourceLogs` → `scopeLogs`
   → `logRecords`; `resourceMetrics` → `scopeMetrics` → `metrics` → `dataPoints`)
   is exactly the spec — a collector ingests it untranslated.
2. **Adopt only *stable* OTEL GenAI names** for interop: `gen_ai.request.model`,
   `gen_ai.usage.input_tokens` / `output_tokens`, `gen_ai.client.token.usage`,
   `gen_ai.token.type`. Nothing experimental (`gen_ai.agent.*`, cache-token
   granularity) is adopted.
3. **Own everything reconstruction-critical under `harness.*`** + a pinned
   `schema_url`, so a semconv rename can never reach the data the timeline is
   rebuilt from.

- **`schema_url`** (pinned on both Resource and Scope):
  `https://github.com/AI-Substrate/harness-engineering/schemas/telemetry/v0.1.0`
- **Scope**: `name = harness.telemetry`, `version = 2.0` (kept in lockstep with the
  segment schema version).
- The complete attribute vocabulary is frozen in
  `harness/cli/src/services/telemetry/otlp/harness-otlp.schema.json` and pinned
  key-set-equal to the single mapping module (`otlp/semconv.ts`) by a freeze test —
  a semconv rename without a contract bump trips CI. To swap a semconv name when it
  stabilises, edit `semconv.ts` and the frozen contract, nothing else.

### The reconstruction invariant

OTLP's `LogRecord` (1.3.2) has no `event_name`, and `timeUnixNano` loses the source
ISO string's format/precision. So each event also carries its exact kind under
`harness.event.kind` and its verbatim timestamp under `harness.event.t`. The
guarantee: **the OTLP Logs round-trip to the exact `event_stream`**, and the
rollup is recomputed for free (`rollup = computeRollup(event_stream)`) — proven by
a round-trip deep-equal over the real sampled-session corpus (`expected-otlp-*`
goldens, drift-checked by `npm run check:telemetry-fixtures`).

---

## Transport — keep-and-harden git refs

`harness telemetry sync` publishes the OTLP spool to **per-(capture-date, session)
shard refs**, exactly as before — only the tree contents changed from the segment
JSON to the OTLP pair:

```
refs/harness-telemetry/<YYYY>/<MM>/<DD>/<session>
  └─ commit tree (flat):
       <seq>.logs.jsonl
       <seq>.metrics.jsonl
```

- **Single-writer-per-(date,session)-ref.** A ref is written by exactly one
  session, so every push is a clean create-or-fast-forward — **no fetch to write**,
  no cross-writer contention. This is what makes a whole team safe (the canonical
  `refs/changes/*` / `refs/pull/*` pattern).
- **Offline-safe.** A failed shard push rolls that shard's local ref back and
  leaves the buffer + watermark intact, so the next sync retries it. A buffered
  segment is never lost.
- **Idempotent re-push.** If a shard ref already holds the exact tree (a re-sync
  after a lost watermark), the push is a no-op — no duplicate commit, no
  non-fast-forward. The existence check is a **local** ref-tree peel, never a remote
  fetch.
- **Session-id entropy.** The session id is the ref segment; a lossy sanitize gets a
  stable hash suffix so distinct ids can never collide on a ref (a collision would
  be a non-fast-forward = lost telemetry).
- **Partial / legacy fallback.** If a `<seq>` has no OTLP pair (a pre-spool buffer
  entry, or a crash *between* the two atomic spool writes), that shard publishes the
  full segment `<seq>.json` instead — the reconstruction oracle, so nothing is ever
  dropped. A complete OTLP pair is published only when **both** files are present.

---

## The scraper read contract (eng-thrive)

The downstream eng-thrive scraper (out of this repo) reads telemetry like this:

1. **One globbed fetch**: `git fetch <remote> 'refs/harness-telemetry/*:refs/harness-telemetry/*'`
   collects every shard; the `<YYYY>/<MM>/<DD>` prefix is the prune/retention key.
2. **Per shard ref**, read the flat commit tree: each entry is `<seq>.logs.jsonl`
   or `<seq>.metrics.jsonl` (or a legacy `<seq>.json` under the partial fallback).
3. **Parse each `.jsonl`** as OTLP/JSON. Reconstruct the session timeline from the
   Logs: event kind from `harness.event.kind`, exact timestamp from
   `harness.event.t`, the rest from the per-kind `harness.*` attributes; recompute
   the rollup from the reconstructed stream (or read the Metrics directly for the
   gap/usage math). Identity/branch come from the Resource attributes.
4. **Dedupe** on `harness.session_id` + content (at-least-once delivery; don't trust
   any local "already-sent" marker).

The attribute vocabulary the scraper binds to is the frozen
`harness-otlp.schema.json` — that file is the authoritative read contract.

---

## Graduation — keep → store-and-forward

git refs are the **right transport now** (low volume, single-writer, zero infra),
not the end state. The emit is transport-agnostic (the spool is just files), so
graduation is a transport swap, not a reshape.

- **Tripwire**: when `refs/harness-telemetry/*` ref count crosses an operational
  threshold (the "too many refs" anti-pattern — fetch latency, pack bloat),
  graduate to **store-and-forward**: a local spool → async uploader → OTEL
  Collector endpoint (or object storage). The spool files are already in the exact
  shape an `otlpjsonfilereceiver` consumes.
- **Staged, not built here (plan 038 non-goals)**:
  - **H1 — dedicated telemetry repo**: documented + staged; the cheap hardening
    (scoped ref advertisement, session-id entropy, idempotent retry) landed now, the
    dedicated-repo move is a follow-up.
  - **The shipper itself** (async uploader → collector) is the graduation plan, not
    this one. This plan landed the transport-agnostic spool emit only.

---

## See also

- [Harness telemetry](./telemetry.md) — the capture preamble, the buffer, sync, the
  kill switch, and the counts-only privacy model.
- [Harness value measures](./harness-value-measures.md) — what the downstream
  program engineers from the committed telemetry.
- `harness/cli/src/services/telemetry/otlp/` — the serializer (`logs.ts`,
  `metrics.ts`, `resource.ts`), the semconv mapping (`semconv.ts`), and the frozen
  attribute contract (`harness-otlp.schema.json`).
