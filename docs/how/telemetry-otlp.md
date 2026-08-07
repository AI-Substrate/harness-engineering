# Harness telemetry — the OTLP/OTEL stored shape

How the archived counts-only telemetry `segment` (see
[Harness telemetry](./telemetry.md)) is stored and read as OTEL/OTLP — one file
per signal, directly ingestible by any OTEL collector with zero translation.
Harness capture is off by default, but this remains the authoritative contract
for published refs and the explicit legacy-capture escape hatch.

> **Versioned additive contract.** The internal typed event/rollup model is
> unchanged; only the stored output shape is OTLP. Already-published predecessor
> records remain readable and byte-identical. Current Segment 2.7 / OTLP v0.4.0
> adds reconciled-capture provenance; the schema and freeze tests pin every
> identity.

---

## The model in one minute

With `HARNESS_TELEMETRY_CAPTURE=1`, the legacy capture preamble writes a
counts-only `segment` to the gitignored buffer. Beside each buffer entry it also
writes the segment re-serialized as
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

- **Current `schema_url`** (pinned on both Resource and Scope):
  `https://github.com/AI-Substrate/harness-engineering/schemas/telemetry/v0.4.0`.
- **Current Scope**: `name = harness.telemetry`, `version = 2.7` (kept in
  lockstep with Segment 2.7).
- **The identity ladder** — every prior identity is FROZEN as a predecessor
  pair; a record is serialized under the identity of the segment version that
  produced it and never gains a later version's attributes:

  | Segment | scope `version` | `schema_url` suffix |
  |---|---|---|
  | 2.4 (legacy) | `2.4` | `.../v0.1.0` |
  | 2.5 | `2.5` | `.../v0.2.0` |
  | 2.6 | `2.6` | `.../v0.3.0` |
  | 2.7 (current) | `2.7` | `.../v0.4.0` |

  The machine constants live in `otlp/types.ts`; treat the code as
  authoritative if this table ever disagrees.
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
goldens, drift-checked by `npm run check:telemetry-fixtures`). Segment 2.5 also
carries optional `harness.product.commit` on the Resource, so even a Logs record
with no events round-trips its exact product HEAD. A product attribute on a
pre-2.5 record, an invalid OID, or a JSON/Logs disagreement fails strict published
retrieval.

---

## Archived transport — keep-and-harden git refs

The frozen corpus occupies one ref per session, keyed at the session's start
date. When legacy capture is explicitly enabled, `harness telemetry sync` uses
the same contract:
at the session's start date** — one commit, one tree carrying the whole session:

```
refs/harness-telemetry/<start-YYYY>/<MM>/<DD>/<session>
  └─ orphan commit, rewritten every sync; tree (flat):
       session.logs.jsonl      (every seq's OTLP Logs record, concatenated seq-ordered)
       session.metrics.jsonl   (every seq's OTLP Metrics record, seq-ordered)
       manifest.json           ({format, session, start_date, max_seq, product_commits?})
       <seq>.json              (loose fallback — only for a seq with no OTLP pair)
```

- **One-ref-per-session, single-writer.** A session's buffer lives in exactly one
  clone, so that clone owns the ref outright and force-pushes its own rewrite —
  **no fetch to write**, no cross-writer contention. This is what makes a whole team
  safe (the canonical `refs/changes/*` / `refs/pull/*` pattern). A multi-day session
  stays at **one** ref at its start date (pinned in a `<session>.startdate` sidecar).
- **Tip tree = the whole session.** The tree is rebuilt from the entire local buffer
  each sync, so a reader that peels only the tip always sees every segment — the
  earlier clobber-on-rewrite data-loss (a per-sync tree holding only that run's seqs)
  is fixed by construction.
- **Forced push.** Because each sync writes a fresh **orphan** commit (a full rewrite,
  never an ancestor of the prior), the push is forced (`+ref:ref`) — a plain push would
  non-fast-forward against any divergent-sha/equal-content remote.
- **Offline-safe.** A failed push rolls that session's local ref back and leaves the
  buffer + watermark intact, so the next sync retries it. A buffered segment is never
  lost.
- **Idempotent re-push.** If the ref already holds the exact (content-addressed) tree
  (a re-sync after a lost watermark), the **duplicate commit is skipped but the ref is
  still force-re-pushed** — a local ref-tree match alone does not prove the remote
  received it, so the buffer is never consumed without re-delivering. The existence
  check is a **local** ref-tree peel, never a remote fetch.
- **Product provenance.** New Segment 2.5 Logs resources carry optional
  `harness.product.commit`; rollup-v1 `manifest.product_commits` is the stable
  prior/new aggregate and must agree with per-segment Logs/loose records. Missing
  legacy provenance remains unavailable or partial—never inferred from telemetry
  ancestry, dates, Metrics values, or current remote HEAD.
- **Metrics metadata, measures frozen.** Segment 2.5 Metrics share the v0.2 resource,
  schema, scope, and optional product attribute. Metric names, units, datapoints,
  values, temporality, and interpretation remain unchanged. Stored v0.1 Metrics
  bytes are never rewritten.
- **Partial / legacy fallback.** If a `<seq>` has no OTLP pair (a pre-spool buffer
  entry, or a crash *between* the two atomic spool writes), the full segment
  `<seq>.json` is carried loose in the tree instead — the reconstruction oracle, so
  nothing is ever dropped.
- **Historical migration.** The legacy producer included a one-time,
  sentinel-gated migration from per-capture-date refs to the start-date layout.
  It is retained for explicitly opted-in migration work, not exercised by a
  default install.

---

## The scraper read contract (eng-thrive)

The downstream eng-thrive scraper (out of this repo) reads telemetry like this:

1. **One globbed fetch**: `git fetch <remote> 'refs/harness-telemetry/*:refs/harness-telemetry/*'`
   collects every session's ref; the `<start-YYYY>/<MM>/<DD>` prefix is the prune/retention key.
2. **Per session ref**, read the flat commit tree: `session.logs.jsonl` +
   `session.metrics.jsonl` (each a seq-ordered JSONL of OTLP records) + `manifest.json`
   (plus any loose `<seq>.json` fallback, and legacy per-seq `<seq>.logs.jsonl` on a
   ref not yet migrated).
3. **Parse each `.jsonl`** as OTLP/JSON. Reconstruct the session timeline from the
   Logs: event kind from `harness.event.kind`, exact timestamp from
   `harness.event.t`, the rest from the per-kind `harness.*` attributes; recompute
   the rollup from the reconstructed stream (or read the Metrics directly for the
   gap/usage math). Identity/branch come from the Resource attributes.
4. **Dedupe** on `harness.session_id` + content (at-least-once delivery; don't trust
   any local "already-sent" marker).

The attribute vocabulary the scraper binds to is the frozen
`harness-otlp.schema.json` — that file is the authoritative read contract.

### Reconciled segments (Segment 2.7, plan 070) — what a reader must know

Some evidence arrives **late**: a lane whose source (an agent transcript) was
written after the session's last harness command is recovered by a later
`telemetry sync` and emitted as a *reconciled* segment. On the wire:

- The segment's Resource carries **`harness.capture_mode: "reconciled"`** —
  the ONLY value this attribute is ever written with. **A live segment is
  proven live by the attribute's absence** (a claim that cannot be forged by
  omission). Strict readers fail closed on a `capture_mode` appearing in a
  pre-2.7 identity.
- **Provenance is per-Resource**: a combined session that contains recovered
  evidence carries MULTIPLE `resourceLogs` entries — recovered events stay
  under their own Resource (with the attribute) and live events under theirs
  (without it). Readers must attribute reconciled-ness per event via its
  enclosing Resource, never by timestamp ranges — live and recovered events
  can interleave and even share an instant.
- Recovered events carry **interval-grade `harness.event.t_precision`** and
  are excluded from agent-working-time/gap math; their window's end is
  anchored to the source file's mtime, and the segment's `timecode` is the
  recovery instant (which `capture_mode` announces), never the work's time.
- The session summary exposes `reconciled_segments` (a count). Rendered
  surfaces (report timeline, attribution table) mark recovered evidence
  visibly — downstream renderers should do the same.

---

## Historical graduation record

The old producer expected ref growth eventually to trigger a move from git refs
to store-and-forward: local spool → async uploader → OTEL Collector or object
storage. Plan 073 froze the corpus before that tripwire could fire. The useful
design result survives: the spool is transport-agnostic and already matches the
shape an `otlpjsonfilereceiver` consumes, so v2 can migrate rather than reshape.

---

## See also

- [Harness telemetry](./telemetry.md) — the frozen segment contract, live read
  path, explicit legacy-capture opt-in, and counts-only privacy model.
- [The git-ai collector handover](./gitai-collector.md) — why the v1 producer is
  dormant and what collects current attribution instead.
- [Harness value measures](./harness-value-measures.md) — what the downstream
  program engineers from the committed telemetry.
- `harness/cli/src/services/telemetry/otlp/` — the serializer (`logs.ts`,
  `metrics.ts`, `resource.ts`), the semconv mapping (`semconv.ts`), and the frozen
  attribute contract (`harness-otlp.schema.json`).
