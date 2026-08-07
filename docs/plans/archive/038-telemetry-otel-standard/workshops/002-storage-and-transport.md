# Workshop: Telemetry storage & transport

**Type**: Storage Design / Integration Pattern
**Plan**: 038-telemetry-otel-standard
**Spec**: _(pre-plan — sources: [`../research-storage-and-transport.md`](../research-storage-and-transport.md) Parts A/B/C + [`001-otlp-emit-and-shape.md`](./001-otlp-emit-and-shape.md))_
**Created**: 2026-06-27
**Status**: Approved

**Value Thesis**: Locks *where the OTLP telemetry lives and how it ships* so the plan can keep the cheap, zero-infra git-refs transport now — with eyes open about its scaling ceiling and a pre-decided graduation path — instead of over-building a collector pipeline prematurely or discovering the ref-advertisement wall in production.
**Target Proof Level**: Preferred Direction (with Contract-Ready hardening list)
**Current Proof Level**: Preferred Direction

**Selected Value Axes**:
- **Operational Reliability**: names the real large-team failure mode (ref advertisement, not write contention) and how it's contained.
- **Migration Safety**: a pre-decided keep→leave tripwire + transport-agnostic emit means graduation is a swap, not a rewrite.
- **Cost / Attention Reduction**: keep-and-harden is near-zero standing infra for the current dogfood scale.
- **Knowability**: makes the git-refs scaling behaviour explicit so nobody rediscovers it the hard way.

**Related Documents**:
- [`001-otlp-emit-and-shape.md`](./001-otlp-emit-and-shape.md) (WS-A) — the payload this transports
- [`../research-storage-and-transport.md`](../research-storage-and-transport.md) — Parts A/B/C evidence

**Domain Context**:
- **Primary Domain**: telemetry (sync / publish)
- **Related Domains**: eng-thrive scraper (consumer); the OTLP emit (WS-A)

---

## Purpose

Decide where 038's OTLP telemetry is stored + how it reaches upstream, and whether the existing `refs/harness-telemetry/*` git-ref transport survives or is replaced. Drives the plan's storage/sync phase + the "touched — storage" test row from WS-A.

## Fresh Entrant Outcome

A fresh agent reaches **Preferred Direction** with no extra context — able to:
- State why keep-and-harden git-refs is correct *now* and what would flip it.
- Implement the hardening list (dedicated repo, scoped advertisement, retention, dedupe).
- Know the graduation target (store-and-forward) and the tripwire that triggers it.

## Key Questions Addressed

1. Does the git-ref transport survive 038, or do we migrate now? → **Keep-and-harden now.**
2. Does it work for large teams; must a writer pull all telemetry first? → **No fetch to write (single-writer-per-ref); large-team cost is ref *advertisement*, mitigatable.**
3. Is git-notes the migration target? → **No — rejected (reintroduces contention + bloat).**
4. What does the buffer/refs publish post-038? → **OTLP `.jsonl` (transport-agnostic).**
5. What is the graduation path + trigger? → **Store-and-forward; a ref-count tripwire.**

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Preferred Direction (+ Contract-Ready hardening list) | Enough to plan the storage phase; the end-state is deferred, not designed now. |
| Primary Value Axis | Operational Reliability | The decision hinges on a correctly-identified failure mode. |
| Supporting Axes | Migration Safety, Cost/Attention Reduction, Knowability | Cheap now; clean graduation; no rediscovery. |
| Downstream Loop Improved | Planning + Operations | Plan gets a bounded storage phase; ops gets a tripwire, not a surprise. |

## Decision Space

| # | Decision | Options | **Selected** | Rationale |
|---|----------|---------|--------------|-----------|
| S1 | Transport for 038 | keep-and-harden git-refs · migrate to git-notes · leave for store-and-forward | **Keep-and-harden git-refs** | Concurrency is *already excellent* (single-writer-per-session ref — `sync-service.ts:24-28`); retention is simple (delete ref); **zero standing infra**. Right for the current dogfood scale. |
| S2 | git-notes? | adopt · reject | **Reject** | A single notes ref reintroduces non-fast-forward write contention (`union`/`cat_sort_uniq` only run in `git notes merge`, never on push) **and** needs an orphan commit per session → object bloat. Lateral-to-worse for many uncoordinated writers (research C1). |
| S3 | Published payload | segment JSON · **OTLP `.jsonl`** | **OTLP `.jsonl`** | Resolves WS-A Q-A1: the local buffer + the refs publish OTLP `.jsonl` (one file per signal). |
| S4 | Emit↔transport coupling | coupled · **transport-agnostic** | **Transport-agnostic** | The OTLP emit (WS-A) writes files to a spool; the transport ships them. A future keep→leave switch is then a transport swap, not a payload reshape. |
| S5 | End-state + trigger | — | **Store-and-forward, tripwire-gated** | When ref count crosses the tripwire (below), graduate to spool→uploader→OTEL Collector / object-storage (research C2). |

---

## Why keep-and-harden is correct *now* (the write path)

The current design is **single-writer-per-(date,session)-ref** — so a write never touches anyone else's data:

```
parent = git.refTip(ref)                 // your session's own tip only
commit = git.commitTree(tree, parent)    // your own chain
git.updateRef(ref, commit, parent); git.push(`${ref}:${ref}`)   // one refspec
```
*(`sync-service.ts:290-306` — "no fetch, no merge, no retry across writers", L24-28)*

- **You never pull other telemetry to write yours.** A push is one refspec to your own ref.
- **Write contention is zero** even at 1,000 concurrent writers — distinct refs never collide.
- The scraper does the single globbed `refs/harness-telemetry/*` fetch; writers never do.

## The real large-team ceiling (and how it's contained)

The failure mode is **ref advertisement**, not write contention: a classic push has the server advertise *every* ref (names+SHAs) — at 100k+ refs that's seconds per op. You still don't download telemetry **content**, only the name list.

| Lever | Hazard it removes | Hardening requirement |
|---|---|---|
| **Dedicated telemetry repo** (not the code remote) | Every dev's normal `git fetch`/`push` paying the telemetry advertisement | **H1** — publish to a separate repo/remote |
| **Protocol-v2 `ls-refs` ref-prefix + server-side hidden refs** (`receive.hideRefs`) | Unscoped advertisement of the whole namespace | **H2** — scope/hide the namespace |
| **Retention** (date-sharded ref deletion + `gc`) | Monotonic growth → ever-larger advertisement + repo bloat | **H3** — prune by date, coordinated with scraper ingestion state |

### Hardening list (Contract-Ready)

| ID | Requirement | Note |
|----|-------------|------|
| **H1** | Dedicated telemetry repo/remote | The single biggest large-team lever; isolates blast radius |
| **H2** | Protocol-v2 ref-prefix fetch + hidden refs | Advertisement stays scoped |
| **H3** | Date-sharded retention + `gc`, coordinated with scraper | No forever-growth; don't drop un-ingested data |
| **H4** | Globally-unique high-entropy `session_id` | Date sharding alone doesn't prevent collisions; a collision → NFF → lost telemetry |
| **H5** | Idempotent retry (check-exists before re-push) | Offline-safe; the existing rollback (`sync-service.ts:304-306`) already protects the buffer |
| **H6** | Scraper as a long-lived service w/ persistent clone | NOT a disposable CI job (avoids re-paying first-fetch) |
| **H7** | Dev clones **exclude** `refs/harness-telemetry/*` | Keep the namespace out of normal dev fetch (pairs with H1/H2) |
| **H8** | Backend dedupe on `session_id`/content-hash | At-least-once delivery; don't trust local "already-sent" state |

## Graduation — keep → leave (store-and-forward)

The end-state when the tripwire trips (research C2):

```
CLI (session end) ──► spool dir (OTLP .jsonl, local, zero network on command path)
                          │  async uploader: backoff retry, delete-after-confirm
                          ▼
                  OTEL Collector OTLP endpoint (otlpjsonfilereceiver)   ──► backend
                  (or: object storage bucket + serverless ingest)
```

Because of **S4 (transport-agnostic emit)**, the CLI already writes OTLP files to a spool — graduation swaps *only* the shipper (git push → HTTPS uploader), not the payload.

### Tripwire (when keep stops being correct)

| Signal | Threshold (research B) | Action |
|--------|------------------------|--------|
| Total telemetry ref count | **thousands** → packing matters; **tens of thousands** → plan migration; **~100k** → urgent | Begin / execute graduation |
| Ref-advertisement latency | push/fetch slows to **seconds** | Graduate |
| Repo size | provider soft limits (GitHub <1GB optimal; Azure ~250GB blocks writes) | Graduate |

---

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| single-writer-per-ref proof | `sync-service.ts:24-28, 290-306` | keep-and-harden concurrency | Ready |
| git-notes contention/bloat | research C1 | S2 reject | Ready |
| prior-art = HTTPS store-and-forward | research C2 | graduation target | Ready |
| ref-count thresholds | research B | tripwire | Ready |
| hardening list H1–H8 | this doc | keep-and-harden contract | Ready |

## Open Questions

- **Q-B1 (→ plan)**: is H1 (dedicated telemetry repo) in scope for 038, or a hardening follow-up? Recommend: at minimum document + H2/H4/H5 now; H1 may be staged.
- **Q-B2 (→ plan)**: does 038 build any of the store-and-forward shipper, or only keep emit transport-agnostic (S4) and defer the shipper to the graduation plan? Recommend: defer the shipper; land S4 only.

## Validation / Acceptance

Preferred Direction is reached because:
- The transport decision (keep-and-harden) is justified against the *correct* failure mode with code evidence.
- git-notes is explicitly rejected with rationale.
- The hardening list is concrete and the graduation path + trigger are pre-decided.
- The emit stays transport-agnostic so the decision is reversible.
