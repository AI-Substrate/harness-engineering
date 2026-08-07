# Brief — sandbox detection that warns, **and** a relay that makes capture work under the sandbox

**Ask (Jordan, 2026-08-07)**: *"harness should have first class support for sandbox detection (at
least this kind). doctor should warn (and give list of what might be an issue)."* — and, ruling the
same day: *"this is an **and** though. We are still going to get this working in cursor sandbox
with harness help."*

**Two committed deliverables, in this order:**

| | slice | what it does |
|---|---|---|
| **Phase 1** | detect & warn | harness tells the truth when the collector cannot see (§ 2–5) |
| **Phase 2** | the relay | harness makes capture **work** under a sandbox, no upstream change (§ 6) |

Phase 1 ships first because it stands alone and because Phase 2 needs its probe to know when to
engage. Neither is optional.

**Evidence base**: [`assets/research/07-sandbox-attribution-gap.md`](./research/07-sandbox-attribution-gap.md)
— root cause proven, with a deterministic local reproduction that needs no Cursor.

---

## 1. Why this is the right thing to build

`collector/health.ts` already says, in its own docstring, exactly what is missing:

> *"It does NOT claim collection is occurring, and that omission is the honest part (ac-0012). …
> v1 records that gap instead of shipping a check that would be wrong exactly when it mattered."*

That was the correct call at the time, because there was no signal that could tell a broken
collector from a clean tree. **There is one now**, and it is not a heuristic: the sandbox denies
the socket `connect()`, so harness can simply *try the connection* and get a definitive answer.

This closes `ac-0012` with a probe rather than an inference. Scope is deliberately **detect and
warn** — harness cannot fix capture, but it can convert a silent wrong answer into a visible,
enumerated gap.

## 2. What is actually being detected

Not "am I in a sandbox" in the abstract — that is unbounded and unknowable. The check asks the one
question that matters:

> **Can this process reach the collector's ingress?**

Ground truth, agent-agnostic, and true of every sandbox that blocks unix sockets — Cursor's today,
Codex's and any other Seatbelt/namespace sandbox by the same mechanism.

### The probe (decisive)

1. Read `trace2.eventTarget` from git config (global, then local — local wins).
2. If it parses as `af_unix:stream:<path>`:
   - socket file **absent** → `ingress-absent` (the daemon is not running; a different problem)
   - `connect()` **succeeds** → `ingress-reachable`
   - `connect()` fails **`EPERM`/`EACCES`/`ENOTCAPABLE`** while the socket file exists →
     **`ingress-blocked`** — the sandbox signature
   - `connect()` fails `ECONNREFUSED` → `ingress-dead` (stale socket, daemon gone)
3. If it parses as a **file or directory path** → `ingress-file` (no daemon will ever see these
   events unless something drains them — this is Route B's configuration, and doctor should say so
   rather than call it broken).
4. If unset → `ingress-unconfigured`.

### Corroborating markers (message quality only — never the verdict)

Used to name the culprit in the warning text, never to decide it:

| marker | means |
|---|---|
| `CURSOR_SANDBOX=seatbelt` | Cursor's sandbox, per its published behaviour |
| `sandbox-exec` in process ancestry | macOS Seatbelt, any host |
| other agent-specific sandbox env vars | best-effort, additive |

**Rule: markers may only ever *explain* a blocked probe, never assert one.** A marker with a
reachable socket is not a problem, and must not warn. This is the discipline that keeps the check
from becoming the next `capture-liveness` — green-forever's mirror image is warn-forever, and both
are noise.

## 3. What doctor reports

A new collector verdict, additive to `CollectorVerdict` in `collector/health.ts`:

- **`ingress-blocked`** — the sandbox case. Warning, never a block (`ac-000c` holds).

Warning text must carry three things:

1. **What is broken, concretely** — *"the collector's ingress socket is unreachable from this
   process (EPERM); commits made from here will carry no attribution."*
2. **Who is likely responsible** — from the markers, when present.
3. **What to do** — the Cursor allowlist for the immediate unblock; the relay if/when it ships.

### The list of what is at risk (the second half of the ask)

The warning is not useful without naming the damage. Doctor enumerates, on the current branch:

> commits whose SHA has **no entry in `refs/notes/ai`**, bounded to a recent window
> (default: since the branch point, capped at N commits).

Those are the at-risk commits. Two honesty requirements, both learned the hard way this session:

- **Never assert those commits are AI-authored** — they may be genuinely human. The claim is
  *"unattributed, and this machine cannot currently attribute"*, which is exactly true.
- **Say so when the list is empty but the probe is blocked** — an empty list under a blocked probe
  means *nothing has been committed from here yet*, not that everything is fine. Empty is not clean.
  This is the same failure shape as the ungated `capture-liveness` check.

### Related defect to fix in the same pass

`doctor-service.ts:25,755` — `capture-liveness` is **ungated**. Green means *"nothing is owed
anywhere"*, and nothing can be owed when nothing captures, so post-073 it reports green forever
having proven nothing. It should either be gated on capture being enabled or report
`could-not-determine`. Flagged independently by the docs peer and the doc audit; the peer correctly
declined to change a doctor verdict inside a docs task. **Wants its own AC and a review — not a
silent redefinition.**

## 4. Shape of the work

New module `services/doctor/collector/sandbox.ts`, sitting beside `trace2.ts`, following the
established pattern: a pure function of injected capability.

One new port — deliberately tiny:

```ts
/** Can this process reach a unix-domain socket? Ground truth for ingress reachability. */
export interface SocketProbePort {
  probe(path: string): Promise<'connected' | 'denied' | 'refused' | 'absent'>;
}
```

Real adapter uses **`node:net`** (builtin). Connect, classify the error code, destroy immediately —
it never sends a byte.

### Constraints (standing, from the phase-1 review instruction)

- **No new or external dependencies.** `node:net` is builtin; nothing else is needed.
- **Every test must be achievable in CI.** The real socket probe is **never** exercised in CI — all
  tests drive a fake `SocketProbePort` through the four outcomes. No test may require a running
  git-ai daemon, a real socket, or a sandbox.
- Doctor **warns, never blocks**.
- A bounded, non-hanging probe: connect timeout in the low hundreds of ms. A doctor run must never
  hang on this (the existing `DOWNLOAD_TIMEOUT_MS` / `INSTALL_HOOKS_TIMEOUT_MS` discipline).

## 5. Draft acceptance criteria

1. `SocketProbePort` defined; real adapter on `node:net`; bounded timeout; no new dependency.
2. Probe classifies all six ingress states from § 2 (`reachable`, `blocked`, `dead`, `absent`,
   `file`, `unconfigured`), driven by a fake in tests.
3. `ingress-blocked` added to `CollectorVerdict`; rendered as a **warning**, never a block.
4. Sandbox markers appear in the warning text only, and **cannot** produce a verdict on their own —
   asserted by a test where markers are present and the socket is reachable, expecting no warning.
5. The at-risk list enumerates unattributed commits on the current branch within a bounded window,
   and never claims they are AI-authored.
6. An empty at-risk list under a blocked probe reports explicitly as *unproven*, not as clean.
7. `capture-liveness` no longer reports green when capture is disabled (separate AC, own review).
8. Docs: `docs/how/gitai-collector.md` gains a sandbox section pointing at the research doc and
   naming the Cursor allowlist remedy.

## 6. Phase 2 — the relay: make capture actually work under the sandbox

**Committed, not deferred.** Detection tells the truth; the relay fixes the thing. Mechanism proven
end to end (`research/07` § 4): trace2's *transport* is swappable even though its mechanism is not.
A sandboxed shell can write a trace2 **file**; something unsandboxed replays it into the daemon
socket; the daemon cannot tell the difference. Proven on commit `2144a4d3` — full line-level
attribution, correct session, correct model, `nc -U` sufficient, **no new dependency**.

### Shape

1. **Configure** — point the repo's `trace2.eventTarget` at a file under `.harness/`. Set from
   outside the sandbox, which the sandbox itself enforces by protecting `.git/config` from writes.
   An agent therefore *cannot disable its own observation* — a genuine feature.
2. **Drain** — harness replays the accumulated events into the collector's socket and truncates.
   Runs where harness already runs: `doctor`, `checks`, and any commit-adjacent seam. This is the
   direct answer to *"could we fake that with the harness when you run doctor or checks?"* — yes.
3. **Report** — the drain's outcome feeds the Phase 1 verdict, so a repo running the relay reads
   healthy for the right reason rather than warning forever.

### The five open questions — Phase 2's AC list

1. **Idempotency** — does replaying the same file twice double-write or corrupt the note?
2. **Staleness** — the daemon must resolve `head_change(cmd, state.refs)`. How long after HEAD has
   moved on does a replay stop resolving? This sets the drain cadence.
3. **Concurrency** — multiple repos and sessions draining into one socket; ordering, interleaving,
   and whether a partial drain can be safely resumed.
4. **Hard dependency** — a file target makes the relay mandatory for *every* commit in that repo,
   sandboxed or not. Uniform, but it must fail loudly, never silently.
5. **Framing** — whether `nc -U` stream semantics hold for large event files, and whether the
   drain should use `node:net` directly instead (it should, for the same reason as the probe).

### Why the relay is the better half of the pair

Agent-agnostic (fixes every sandboxed agent at once, not just Cursor), nothing for a user to
silently revert, and it gives harness the role it should have had all along: **own the commit
event**, as a drain rather than a repair after the fact.

## 7. Non-goals

- Detecting sandboxes that do not block the ingress. If the collector can be reached, there is
  nothing to warn about, whatever the process is running under.
- The Cursor `terminalAllowlist` remedy — a documented user setting, referenced in the warning text,
  not something harness configures.
- Any upstream git-ai change or issue filing (standing instruction).

## 8. Open ruling — where this lands

Phase 1 of plan 073 is accepted and PR #104 is green, so this is new scope. Two options:

- **New phases on 073** — keeps the collector story in one plan; reopens a green PR.
- **A new plan at the next ordinal, two phases** — clean seam, and this is genuinely a different
  deliverable: 073's contract is *make git-ai the collector*, this one's is *make the collector see
  under a sandbox, and say so when it can't*.

**Recommendation: a new plan with the two phases above.** It has its own research base, its own
port, and its own review surface — and landing it separately keeps #104 mergeable now.
