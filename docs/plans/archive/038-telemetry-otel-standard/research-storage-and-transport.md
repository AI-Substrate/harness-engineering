# Research note: local-OTEL storage + git-refs transport review

**Generated**: 2026-06-27  ·  **By**: /the-flow explore (perplexity deep research)
**Feeds**: the OTLP pre-plan workshops (emit-shape + storage-transport)
**Companions**: [`research-dossier.md`](./research-dossier.md) (the primary dossier)

This note answers two questions the user raised before planning: (1) **design
considerations for storing OTEL telemetry locally as files**, and (2) **is our
`refs/harness-telemetry/*` git-ref transport correct, or does it need a review?**
Both are decision inputs for the workshops — not yet decisions.

---

## Part A — Local OTLP-as-files: design considerations

**Verdict.** OTLP/JSON in JSON-Lines (`.jsonl`) is the *idiomatic* choice for
low-volume per-session telemetry — the OTLP File Exporter spec defines exactly
this format for "no live collector" cases. **But it is a staging/transfer format,
not durable archival storage**: the spec and the collector `fileexporter` both
**explicitly disclaim JSON field-name stability across versions**. Anything bound
directly to today's field names breaks on an OTLP/collector upgrade.

| # | Recommendation | Why / our fit |
|---|---|---|
| A1 | **One file per signal** (`logs.jsonl`, `metrics.jsonl`) — spec mandates exactly one of LogsData/MetricsData/TracesData per file; **no mixing**. | Decides our on-disk layout; rules out a single combined file. |
| A2 | **Model the session as the Resource** — one `ResourceLogs`/`ResourceMetrics`, shared attrs (`service.name`, session id, harness, branch, command) **once**, never flattened onto every record. | Matches our segment identity/window block; big size win. |
| A3 | **Pin `schema_url`** on Resource/Scope (+ stash the OTLP version as a resource attr). | THE mitigation for the field-name-instability caveat — insulates stored files from transport churn via the Telemetry Schemas spec. |
| A4 | **Cumulative temporality for the per-session rollup** — a single datapoint, `startTimeUnixNano`=session start, `timeUnixNano`=session end. Each CLI run is a **fresh metric lifetime**; partition by `session_id`, never stitch across sessions. | **Refines** the dossier's earlier DELTA lean — cumulative-per-session is simpler/safer offline. A decision to lock. |
| A5 | **Atomic writes** (`*.tmp` → fsync → rename; ingest ignores `.tmp`). | We already do temp+rename at capture-service.ts:415–419 ✓ — carry it to the OTLP write. |
| A6 | **Sort records by `timeUnixNano`** within a file; **preserve original event time** (never rebase to ingest time); **dedupe on `session_id`** (offline files double-ingest easily). | Avoids out-of-order drops in strict backends; protects session correlation. |
| A7 | **Ingest path = `otlpjsonfilereceiver`** (collector-contrib), which reads exactly the fileexporter's Protobuf-JSON output. | Names the upstream replay path the format must satisfy. |
| A8 | Optional post-write **compression** (`.zst`/`.gz`) — all consumers must agree. | Archival footprint; defer unless volume warrants. |

**Pitfalls (must-avoid):**
- **Silent drops.** The collector's `otlpjson`/`UnmarshalLogs|Metrics` returns an
  **empty object (no error)** for valid-JSON-but-invalid-OTLP — *lethal* for
  low-volume where every session matters. **Guard:** monitor lines-read vs
  objects-emitted; use the collector-as-checker in tests (below).
- Treating the transport JSON shape as a permanent schema (→ A3).
- Wrong/mixed temporality or missing `startTimeUnixNano` → negative deltas / false
  resets (→ A4).
- `timeUnixNano=0` or rebasing to ingestion time → destroys session correlation.

**Hand-roll vs SDK (refines the dossier).** Hand-rolling **without a runtime SDK
is reasonable** for our counts-only, no-trace/span-id model — avoids deps, binary
size, startup cost. Caveat from the research: prefer **protobuf-generated types
from `opentelemetry-proto` + a protobuf-JSON serializer** over ad-hoc objects;
ad-hoc gotchas are `trace_id`/`span_id` = **case-insensitive hex, not base64**,
timestamps = **integer nanos not ISO-8601**, attrs = typed **`AnyValue`**. Since
we emit *no* trace/span ids and only typed counts, ad-hoc risk is low — but
**validate three ways**: (a) golden tests vs `opentelemetry-proto/examples`;
(b) round-trip through a protobuf-JSON serializer; (c) **collector-as-checker** —
feed output through `otlpjsonfilereceiver` + a debug exporter; *empty output =
silently rejected*. This is the same "verify with a real thing, ship a thin thing"
pattern as the copilot-vscode sqlite round-trip test.

> "files must contain exactly one type of data—traces, metrics, or logs."
> "there is no guarantee that exact JSON field names will remain stable in future versions."
> "Unmarshal… do not return an error for JSON that is syntactically valid but not a valid OTLP payload; instead, they return an empty object, leading to silent discarding."

---

## Part B — git-refs transport: the review the user asked for

**Verdict: technically correct, architecturally fragile.** The design uses only
supported Git features (custom refs, commits, blobs) and never touches code
history — but **one ref per session is precisely the "too many refs" anti-pattern**
Git maintainers warn against. **Biggest risk: ref-count explosion** (ref
advertisement, `packed-refs` scanning, GC all degrade). Recommendation:
**KEEP-AND-HARDEN at low volume / short retention in a *dedicated* repo, with a
planned MIGRATE path** — the blessed in-Git target is **git notes**.

| Concern | Finding | Action it implies |
|---|---|---|
| **Prior art** | **git notes** (`refs/notes/*`) is the blessed mechanism — designed to scale **>100k annotations** under a *small* number of refs. Our per-session ref is the **inverse**. Gerrit `refs/meta/config` = few refs whose *history* grows. | Migration target if we stay in-Git. |
| **Scale thresholds** | **Thousands** of refs already hurt (the reason `pack-refs` exists); **tens of thousands** → plan migration; **~100k+** → advertisement/reachability take **seconds** (urgent). Repo size: GitHub optimal <1 GB; Azure ~250 GB can **block writes** during optimization. | Compute sessions/day × retention → ref count; set a tripwire. |
| **Concurrency** | Per-(date,session) sharding is safe **only if `<session>` is globally unique high-entropy** (UUID+machine+time). The **date hierarchy alone does not prevent collisions**; a collision → non-fast-forward rejection → **lost telemetry**. Pushes are pure ref *creations*, so they don't conflict with existing state. | Verify our session-id entropy; add idempotent retry (check-exists before push). |
| **GC / retention** | Custom refs are **not special-cased** — kept alive forever; store grows **monotonically**. `git gc` packs but never prunes while refs exist. | Need explicit retention: enumerate by date → `update-ref -d` → `gc --prune`, **coordinated with the scraper's ingestion state**. |
| **Fetch (scraper)** | Whole-namespace refspec works (`+refs/harness-telemetry/*:…`); **incremental fetch is a good fit** (append-only). Run the scraper as a **long-lived service with a persistent clone**, NOT a disposable CI job. Developers must **exclude** the namespace from their fetch (protocol-v2 `ls-refs` scoping / server-side hidden refs). | Scraper deployment shape + dev-clone hygiene. |

**Alternatives (roughly in order):** **git notes** (best in-Git; scales, minimal
ref growth; needs session→commit mapping) → **dedicated separate repo** (shrinks
blast radius, same ref-scaling flaw) → **object storage (S3/Blob)** by date prefix
(scales to billions, native lifecycle retention — best for high volume) → **OTLP
collector + backend** (ideal production observability) → Dolt (overkill).

**Decision criteria:** sessions/day × retention (→ ref count), hosting size
limits, maintenance tolerance, architectural alignment. *Treat the current design
as transitional.*

> "large numbers of refs are a scalability anti-pattern… maintainers recommend… notes for large annotation sets."
> "Beyond roughly one hundred thousand telemetry refs… advertisement and packed-refs scanning will take seconds."
> "telemetry objects will remain in the object database indefinitely unless their corresponding refs are deleted. `git gc` will compress and pack them, but never prune them."

---

## Part C — deeper transport research (git-notes mechanics + edge prior art)

A second perplexity pass went decision-grade on the two migration candidates. It
**corrects Part B's "git-notes is the blessed fix"**: notes are a *lateral-to-worse*
move for our workload, and *no real tool uses git as a telemetry transport*.

### C1 — git-notes does NOT fix our problem (it shifts it)

- **Concurrency — the crux.** A notes ref (`refs/notes/telemetry`) is an *ordinary
  ref*: many machines extend the *same* history, so concurrent pushes collide on
  **non-fast-forward** and force fetch-merge-push retries. `notes.mergeStrategy` /
  `union` / `cat_sort_uniq` **only run inside `git notes merge`** — they do **not**
  fire on push/fetch, so they don't eliminate the NFF rejection. A single notes ref
  is a **central write bottleneck** — the opposite of today's **embarrassingly-parallel
  one-ref-per-session** model, where each ref is *created once, never updated, and the
  server never even checks fast-forward* (zero contention if the session id is unique).
- **Object bloat returns.** Notes attach to an existing object SHA; synthetic
  telemetry has none → you mint an **orphan commit per session** and note it. That's
  `O(N)` commits + `O(N)` blobs — the same growth we were avoiding, just moved from
  ref-name to commit-hash.
- **Retention regresses.** `git notes prune` only drops notes whose *target* is gone —
  **no time-based expiry**; "delete >90d" means scripting a notes-tree rewrite. Today's
  per-ref model deletes a ref/subtree and gc reclaims.
- **Scale is a wash.** Fanout-tree lookup is ~O(1) at 1M notes, but pack/gc cost
  tracks object count — **comparable to per-ref, not better**.

> "Git notes do not actually fix the concurrency problem. They shift it… you have one
> or a few notes refs that many writers must update, and they will collide frequently
> under load." · "they do not eliminate the basic non-fast-forward behaviour that
> causes pushes to be rejected under concurrent writes." · "This pattern trades ref
> bloat for object bloat."

**Verdict:** git-notes is **not** the migration target for many uncoordinated writers.
At most a thin low-volume "summary pointer" layer — never the main store.

### C2 — what real tools actually do (nobody uses git)

Every production dev tool ships usage telemetry **over HTTPS to a backend**, locally
buffered/batched, opt-out: **VS Code** (usage+crash to MS, local `telemetry.log`,
"show telemetry" command), **GitHub Copilot** (encrypted HTTPS, restricted access),
**Cursor** (network, ZDR agreements), **.NET CLI** (`DOTNET_CLI_TELEMETRY_OPTOUT`),
**Homebrew** (anon HTTPS→InfluxDB, `HOMEBREW_NO_ANALYTICS`), **Flutter/TelemetryDeck**;
**Rust** is the clean opt-in counterpoint (local record, voluntary submit).

> "None of these tools use git as a transport for telemetry… git's semantics around
> commits, branches, and refs are poorly aligned with the needs of telemetry pipelines,
> which require high write concurrency, efficient append-to-log behavior, and
> straightforward retention policies."

**The sustainable end-state** = **store-and-forward**: CLI writes OTLP JSON to a
local **spool dir** at session end (zero network on the command path, no races —
CLI only writes, uploader reads/deletes) → async uploader retries with backoff,
**never deletes until upload confirms** → ships to a **single OTEL Collector OTLP
endpoint** (`otlpjsonfilereceiver`). **At-least-once + backend dedup** on an embedded
session-id/content-hash (don't trust local "already-sent" state). Graduates to a
gateway, then object-storage/serverless ingest, as volume grows.

### C3 — the honest re-frame of the keep-vs-migrate decision

| Option | Concurrency | Ref/obj scale | Retention | Standing infra | Verdict for us |
|---|---|---|---|---|---|
| **Keep-and-harden git-refs** | **Excellent** (parallel, unique-ref creation) | poor at high ref count | **Simple** (delete ref) | **none** | **Viable now** at low volume |
| Migrate to git-notes | poor (single-ref contention) | obj-bloat ~same | complex (rewrite) | none | **Rejected** — lateral-to-worse |
| Leave git → spool+uploader+Collector | excellent | excellent | native TTL | **yes** (an endpoint) | **The end-state** when volume grows |
| Leave git → object storage | excellent | excellent | native lifecycle | a bucket | end-state alt (intermittent/zero-infra) |

**Net:** per-ref's concurrency is actually its *strength* (Part B over-stated the
anti-pattern); its real weaknesses are ref-set scale + monotonic growth, both
**bounded at our current volume**. So the live decision is **keep-and-harden now with
a defined graduation tripwire to store-and-forward**, *not* a git-notes detour.

## Workshop hand-off — the decisions this surfaces

**WS-A · OTLP emit & shape**
- Additive OTLP *view* vs OTEL-native segment *store* (the central fork).
- Logs+metrics both, or logs-only (derive metrics downstream).
- Hand-roll + 3-way conformance validation vs runtime OTEL libs.
- Temporality = cumulative-per-session (A4); `schema_url` pinning (A3); one-file-per-signal (A1); silent-drop guard (collector-as-checker).

**WS-B · Telemetry storage & transport (NEW — elevated by Parts B+C)**
- The real fork (per C3): **keep-and-harden git-refs *now*** vs **leave git for store-and-forward (spool→uploader→Collector / object-storage)**. **git-notes is rejected** (C1 — lateral-to-worse).
- What the buffer/refs publish post-038: OTLP `.jsonl` vs segment JSON (WS-A Q-A1).
- If keep: session-id entropy + idempotent retry; explicit retention/GC; scraper-as-service; dev-clone fetch exclusion; dedicated repo.
- **Graduation tripwire**: the sessions/day × retention ref-count threshold (Part B: thousands hurt, ~100k urgent) that flips keep → store-and-forward.
- Design the OTLP emit (WS-A) to be **transport-agnostic** so a later keep→leave migration is a transport swap, not a reshape.
