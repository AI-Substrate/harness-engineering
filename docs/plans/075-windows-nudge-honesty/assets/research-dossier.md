# Windows gap in plan 074's nudge/commit — the finding and the fix

**Found**: 2026-08-07, after PR #104 went green. **Not a regression** (none of these verbs existed
before), so it does not block the merge — but the plan claims a guard that is not there.

---

## The finding

**1. The nudge can never work on Windows.** `nudge.ts:724` hard-requires an `af_unix` ingress:

```ts
if (deps.ingress.target.kind !== 'af_unix') {
  // skip: "the configured trace2 target is a plain file (<path>), not an af_unix
  //        socket — there is no ingress to replay into, and this verb cannot invent one."
}
```

`kind: 'af_unix'` is produced **only** by a literal `af_unix:` prefix (`ingress.ts`
`resolveTrace2Target`). Git's `af_unix:` trace2 form is **Unix-only** — git on Windows does not
support it — so on Windows that branch is unreachable by construction.

**2. Worse, a Windows ingress is likely MISCLASSIFIED as a buffer.** The absolute-path test is:

```ts
const ABSOLUTE_TARGET = /^([A-Za-z]:)?[\\/]/;   // ingress.ts:39
```

That matches `C:\…` **and** `\\.\pipe\…`. So if git-ai's Windows build listens on a **named pipe**,
`resolveTrace2Target` returns `{ kind: 'file', path: '\\\\.\\pipe\\…' }` — a live **ingress**
classified as a **drainable file buffer**. Consequences:

- `harness commit` takes the **file branch**: no trace2 override, degraded envelope telling the
  user their events are "buffered" to a path that is actually a live pipe.
- It writes its `.shas` **sidecar beside that path** (`\\.\pipe\git-ai.shas`), which may fail.
- The envelope points at `telemetry-nudge`, which then refuses with **"is a plain file"** — wrong
  and confusing.

**3. The plan promises a guard that does not exist.** `plan.dd.json#non_goals` says Windows is
*"must-not-break (platform-guarded no-op)"*. `grep -rn "win32\|platform"` across `ingress.ts`,
`nudge.ts`, `commit-service.ts` returns **nothing**. The current behaviour is accidental, not
designed — which is exactly the "claiming more than you can prove" failure the plan exists to kill,
this time in the plan's own non-goals.

**4. What is genuinely unknown**: what git-ai's Windows build actually uses as a transport. Three
candidates — named pipe (misclassified as above), a plain file plus a poller (our `file`
classification would be accidentally right), or something else. **Nobody has checked.** The
orientation pass in `10-cursor-testing-playbook.md` § 5 is designed to answer exactly this.

---

## The fix

**Principle: an honest refusal beats a misleading instruction.** Do not try to make the nudge work
on Windows — that needs the transport question answered first. Make it *tell the truth* instead.

### Step 1 — a new target kind, so a pipe is never called a file

In `ingress.ts`, before the `ABSOLUTE_TARGET` test, classify Windows pipe syntax as its own kind:

```ts
// A Windows named pipe is an INGRESS, not a drainable buffer. It matches the
// absolute-path test by accident (\\.\pipe\… begins with a separator), and calling
// a live ingress a "buffer" is the one thing this feature must never do.
if (/^\\\\[.?]\\pipe\\/i.test(value)) return { kind: 'named_pipe', path: value };
```

Extend `Trace2Target` with `{ kind: 'named_pipe'; path: string }`. **The `RETAINED_FIELD_RENDERING`
pattern applies here too** — if any switch over `Trace2Target['kind']` is not exhaustive, make it
so the compiler refuses the omission (that is the F011 lesson: a guarantee about future code needs
the type system, not a test).

### Step 2 — both verbs report unsupported, honestly

- **`nudge`**: `kind === 'named_pipe'` → skip with reason `ingress-unsupported-platform` and a
  detail that says plainly: *the collector is reachable over a named pipe, replay is not
  implemented for this transport, nothing was moved or sent.* Never claim there is nothing to do.
- **`harness commit`**: `kind === 'named_pipe'` → do **not** take the file branch. Commit with no
  override (git talks to the pipe as it normally would), then either verify the note as in the
  reachable branch, or — if verification is unproven on this platform — return a degraded envelope
  stating that attribution was **not verified on this platform**, and do **not** write a sidecar
  beside the pipe path.

### Step 3 — a real platform guard, so the non-goal becomes true

Add an explicit `process.platform === 'win32'` early return in the drain path with an honest
message, so the plan's claimed "platform-guarded no-op" is a fact rather than an accident. Keep it
in `src` (typecheck `include` is `["src"]`).

### Step 4 — tests (all CI-safe, no real pipe needed)

1. `resolveTrace2Target('\\\\.\\pipe\\git-ai')` → `named_pipe`, **not** `file`. This is the
   regression guard for the whole finding.
2. Table over Windows forms: `C:\path\buffer.jsonl` → `file`; `\\.\pipe\x` → `named_pipe`;
   `\\?\pipe\x` → `named_pipe`; relative → `unconfigured`.
3. `nudge` with a `named_pipe` target → skipped, reason names the platform, **zero** renames and
   **zero** deletes (reuse the F005 containment-guard assertions).
4. `harness commit` with a `named_pipe` target → no sidecar written, no `GIT_TRACE2_EVENT`
   override, envelope does not claim the events were buffered.
5. Negative control: on a POSIX `af_unix` target everything behaves exactly as today (the existing
   suites must pass untouched).

### Step 5 — correct the record

- `plan.dd.json#non_goals`: either implement the guard (steps 1–3 do) or reword the non-goal. Do
  not leave a claim the code does not support.
- PR #104 known gaps: add this as a named gap if it ships unfixed.

---

## Sequencing

Steps 1–4 are small, self-contained, and need no knowledge of git-ai's Windows transport — they
only stop us **lying** about it. Actually *supporting* Windows replay is a separate, larger piece
that must wait on the orientation pass (`10-cursor-testing-playbook.md` § 5) establishing what the
transport is.

Do not attempt Windows replay support and this fix in one change. The first is "stop the misleading
message" (cheap, certain); the second is "make the feature work on a platform we have not yet
measured" (unbounded, speculative).

## Related open items

- `FakeFs` readdir fidelity gap — deferred, wants its own plan (from the 074 execution log).
- Doctor surfaces no positive `ingress` signal when the probe succeeds (candidate improvement,
  recorded in `assets/validations/README.md`).
- U-1/U-2 — git-ai's transcript-sweep recovery, recorded but deliberately unrelied-on.
