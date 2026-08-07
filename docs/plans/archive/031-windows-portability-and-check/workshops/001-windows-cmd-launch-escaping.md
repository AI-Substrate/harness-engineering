# Workshop: Windows `.cmd` launch & argument escaping (F19)

**Type**: Integration Pattern
**Plan**: 031-windows-portability-and-check
**Spec**: [`../windows-portability-and-check-plan.md`](../windows-portability-and-check-plan.md) (§ Business Specification)
**Created**: 2026-06-19
**Status**: Approved

**Value Thesis**: Settles — with authoritative evidence — how the new detached-launch adapter (T002) and the existing core exec adapter (T010) must spawn `.cmd` shims on patched Node, so the implementer builds the **one route that actually works** instead of the route DR-1/F19 proposed (which throws `EINVAL` at runtime on Windows).
**Target Proof Level**: Contract Ready
**Current Proof Level**: Contract Ready

**Selected Value Axes**:
- **Safety to Change**: pins the injection-safe spawn contract and the *reason* `windowsVerbatimArguments` is retained, so a future "cleanup" can't silently reopen BatBadBut.
- **Implementation Readiness**: gives T002 an exact, copy-ready spawn spec + fake/contract-test assertions; downgrades T010 from a risky rewrite to a documenting regression test.
- **Proof Quality**: replaces a Perplexity claim with the Node docs + the CVE-2024-27980 behaviour, with file:line evidence both ways.
- **Operational Reliability**: names the one cosmetic Windows caveat (console flash) and rules it acceptable for a background dogfood worker.

**Related Documents**:
- [`../research-dossier.md`](../research-dossier.md) — § Deep Research (DR-1), finding **F19**. **This workshop supersedes DR-1 on the spawn-mechanics point** (see Decision Space).
- Node.js docs — *child_process → "Spawning `.bat` and `.cmd` files on Windows"*.
- CVE-2024-27980 (BatBadBut) / Node security release June-2024.

---

## Purpose

Resolve F19: the plan currently tells the new background adapter to "set **no** `windowsVerbatimArguments` and rely on patched-Node escaping" (AC-07, T002) and offers an optional "simplify `windows-command.ts` to drop verbatim" (T010). Both rest on **DR-1's premise that `spawn(absoluteCmdPath, args, { shell:false })` is safe on patched Node.** That premise is **false** — patched Node *forbids* it. This workshop establishes the correct contract before any code is written.

## Fresh Entrant Outcome

A fresh human or agent can use this workshop to reach **Contract Ready** for the Windows launch path with no extra context. They can:

- State why a bare `.cmd` can never be `spawn`-ed directly with `shell:false` (and what happens if you try).
- Write the T002 detached-spawn call correctly on the first attempt (reusing `resolveSpawn`).
- Explain to a reviewer why `windowsVerbatimArguments:true` is *correct here*, not a vulnerability.
- Know exactly which plan lines (AC-07, T002, T010, Risk 03, Open-Q F19) this decision rewrites.

## Key Questions Addressed

1. On patched Node, can we `spawn('foo.cmd', args, { shell:false })` and rely on built-in escaping? *(DR-1 said yes.)*
2. For the **detached** launch (T002), bypass `.cmd` to `node`+JS entry, or wrap with `cmd.exe`?
3. Should the existing `windows-command.ts` (T010) drop `windowsVerbatimArguments`?

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Contract Ready | T002 needs an exact spawn spec + test assertions; a Decision-only note would leave the EINVAL trap in place. |
| Primary Value Axis | Safety to Change | The retained-verbatim rationale is the load-bearing safety fact; lose it and a refactor reopens injection. |
| Supporting Value Axes | Implementation Readiness · Proof Quality · Operational Reliability | Copy-ready code; evidence over assertion; the one accepted caveat named. |
| Downstream Loop Improved | Implementation (T002/T010) + Review | Implementer builds the working route once; reviewer checks against a stated contract, not folklore. |

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| Node docs: `.bat`/`.cmd` "cannot be launched using `execFile()`"; invoke via `spawn('cmd.exe', ['/c', 'my.bat'])` | child_process → *Spawning .bat and .cmd files on Windows* | Decision: cmd.exe wrapper is **the** documented route | Validated |
| Patched Node (≥20.12.2 / 22.x) throws `EINVAL` for `spawn('.cmd', args, {shell:false})` | CVE-2024-27980 / Node sec-release; PR nodejs/node#52271 | Refutes DR-1's "spawn `.cmd` directly is safe" | Validated |
| `engines.node` `">=22"` | `package.json:32` | Baseline is post-patch → EINVAL applies to every supported runtime | Validated |
| Host runtime is `v24.7.0` | `node --version` (this session) | Confirms the EINVAL regime in-repo | Validated |
| `resolveSpawn` already routes `.cmd`/`.bat` via `cmd.exe /d /s /c "<line>"` + verbatim | `harness/cli/src/adapters/exec/windows-command.ts:132-183` | Existing exec path is **already** the documented-correct pattern | Validated |
| Consumer honours the flag: `windowsVerbatimArguments: spec.windowsVerbatimArguments ?? false` | `harness/cli/src/adapters/exec/node-exec.ts:22-27` | T002 should mirror this consumer, not invent a verbatim-free one | Validated |
| `"`-bearing args are **rejected** (cannot be escaped for cmd + CommandLineToArgvW at once) | `windows-command.ts:142-161` | The hand-rolled-escaping residual is bounded, not wide-open | Validated |
| Pure win32-branch tests pin cmd-wrap + verbatim + Program-Files + reject-`"` + inert-metachars | `harness/cli/test/adapters/exec/windows-command.test.ts:29-91` | T010 has a regression net; new path can extend it | Validated |
| minih is resolved on `PATH` (global), not a `node_modules` dep | dogfood verbs precheck `command -v minih`; no `node_modules/minih` present | Kills the clean `require.resolve` JS-entry bypass → reuse `resolveSpawn` | Validated |

---

## Background — why a `.cmd` is special (60-second orientation)

npm installs most Node CLIs (`npm`, `npx`, `tsc`, `biome`, `depcruise`, `minih`, the harness bin) as **`.cmd` shims** on Windows. `CreateProcess` (what `spawn(..., {shell:false})` uses) can append `.exe` and run a real binary, **but it cannot execute a `.cmd`/`.bat`** — those need `cmd.exe`. Three eras:

| Node | `spawn('x.cmd', args, {shell:false})` | `spawn('x.cmd', args, {shell:true})` | `spawn('cmd.exe', ['/c','x.cmd', …])` |
|------|---------------------------------------|--------------------------------------|----------------------------------------|
| ≤ 20.12.1 | ran it — **but did not escape args** (BatBadBut / CVE-2024-27980) | ran, unescaped | ran (you own escaping) |
| **≥ 20.12.2 / 22.x / 24.x (our baseline)** | **throws `EINVAL`** | runs, Node auto-escapes; but DEP0190 deprecates the args-array form | runs (you own escaping) — **the documented route** |

So on our `>=22` baseline there is exactly **one** injection-safe, non-deprecated way to launch a `.cmd`: spawn `cmd.exe` explicitly with a `/c` line you escaped yourself. That is precisely what `resolveSpawn` already does.

## Decision Space

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| **A** | Drop the wrapper; `spawn(absCmd, args, {shell:false})`, trust patched-Node escaping (DR-1 / F19 premise) | Tiny code; no own-escaping | **Throws `EINVAL` on every supported Node** — never reaches escaping; breaks at runtime on Windows | ❌ **Rejected — invalid** |
| **B** | Bypass `.cmd`: resolve the tool's JS entry, `spawn(process.execPath, [jsEntry, …])` | No cmd.exe, no console flash, no escaping at all | minih is **global on PATH**, not a module → JS-entry extraction means parsing a global `.cmd` shim (fragile); only clean when the tool is `require.resolve`-able | ⏸ **Deferred** (opportunistic optimisation only) |
| **C** | Reuse `resolveSpawn` → `cmd.exe /d /s /c "<verbatim line>"`; add `{detached, stdio:fds, windowsHide, unref}` for T002 | The **documented** pattern; already built & unit-tested; one resolver for both adapters; EINVAL-proof; injection-safe (own escaping + `"`-reject) | One cosmetic Windows **console flash** for the detached `.cmd` (DR-1); you own the escaping (bounded by the `"`-reject) | ✅ **Selected** |

**Why C over B (the load-bearing call):** B is theoretically nicer but its premise — a resolvable JS entry — does not hold for a **global** minih. Extracting a JS entry from a global npm `.cmd` shim is brittle and tool-specific; reusing the already-tested `resolveSpawn` is KISS, removes duplication, and is provably safe. B stays a *future* optimisation, gated only on minih becoming module-resolvable.

**Why `windowsVerbatimArguments:true` is correct here, not a vulnerability:** when you spawn `cmd.exe` with a pre-built `/c "<line>"`, Node's normal arg-quoting would **re-quote** your line and corrupt the `/s` quote-stripping contract. `verbatim` tells Node to pass the line through untouched. Node's BatBadBut auto-escaping only applies when **Node itself** routes a detected `.cmd` to cmd — it is *not active* on an explicit `cmd.exe` spawn, so there is nothing for verbatim to "disable." The safety obligation it creates (you escape every arg) is met by `quoteCmdArg` + the literal-`"` rejection, both unit-tested. DR-1's framing ("verbatim disables Node's protection") is **wrong for the explicit-cmd.exe pattern**.

---

## The Contract (Contract Ready)

### C1 — Existing exec path (T010): **keep as-is; do not "simplify"**

`resolveSpawn` + `NodeExec` are already the documented-correct pattern. T010's original goal — *drop `windowsVerbatimArguments`* — is **withdrawn** (it would require Option A, which EINVALs). T010 becomes a **documenting regression test**, not a rewrite:

```ts
// harness/cli/test/adapters/exec/windows-command.test.ts  (add)
it('retains windowsVerbatimArguments for the cmd.exe route — dropping it would corrupt /s quoting and bare .cmd spawn EINVALs on Node >=20.12.2', () => {
  const r = resolveSpawn('C:/npm/minih.cmd', ['run', 'a b'], 'C:/repo', 'win32', {});
  expect(r.command).toBe('cmd.exe');                 // never a bare .cmd (would EINVAL)
  expect(r.windowsVerbatimArguments).toBe(true);     // required: Node must not re-quote our line
});
```

> Net: `windows-command.ts` is **out of scope for change**; the only edit is a test + a one-line code comment pointing at this workshop. Risk 03 / Open-Q F19 are resolved.

### C2 — New detached launch (T002): reuse `resolveSpawn`, add detachment

```ts
// harness/cli/src/adapters/exec/background.ts  (new) — sketch
import { spawn } from 'node:child_process';
import { openSync } from 'node:fs';
import { resolveSpawn } from './windows-command.js';

export interface SpawnDetachedInput {
  command: string; args: string[]; cwd: string;
  env?: NodeJS.ProcessEnv; logPath: string;
}

export class NodeBackground implements BackgroundProcessPort {
  spawnDetached(i: SpawnDetachedInput): { pid: number } {
    const spec = resolveSpawn(i.command, i.args, i.cwd);     // ← same resolver as NodeExec
    const logFd = openSync(i.logPath, 'a');                  // real fd, NOT a pipe (no EPIPE post-exit)
    const child = spawn(spec.command, spec.args, {
      cwd: i.cwd,
      env: i.env,
      detached: true,                                        // own process group/session
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
      windowsVerbatimArguments: spec.windowsVerbatimArguments ?? false, // ← honour the resolver
    });
    const pid = child.pid;
    child.unref();                                           // parent can exit
    if (pid == null) throw new Error('detached spawn returned no pid');
    return { pid };
  }
}
```

**Invariants the implementer must hold (assert these):**

| # | Invariant | Why |
|---|-----------|-----|
| I1 | Spawn spec comes from `resolveSpawn(command, args, cwd)` — **never** a hand-built `.cmd` spawn | EINVAL-proof + injection-safe by reuse |
| I2 | `windowsVerbatimArguments` is passed through from the spec (`?? false`) — **not hard-coded to `false`** | Hard-`false` corrupts the cmd `/s` line (the plan's old AC-07 bug) |
| I3 | `stdio` is `['ignore', logFd, logFd]` with `logFd = openSync(path,'a')` (real fds) | Pipes EPIPE once the parent exits (DR-1) |
| I4 | `detached:true` + `child.unref()` + `windowsHide:true` | Survives parent/terminal close; hides the worker window where possible |
| I5 | Returns `child.pid`; throws if null | Caller records the pid (replaces the POSIX `nohup … & echo $!`) |

### C3 — The fake (T008) and the contract test

The InMemory `BackgroundProcessPort` fake **does not resolve or spawn** — it records the *logical* intent and returns a synthetic pid, so the verb is deterministic on ubuntu:

```ts
// fake
spawnDetached(i) { this.calls.push({ command: i.command, args: i.args, cwd: i.cwd, env: i.env, logPath: i.logPath });
                   return { pid: 424242 }; }
```

Two test layers:

| Layer | Asserts | Runs on |
|-------|---------|---------|
| **Verb test** (uses the fake) | the verb called `spawnDetached` with the right logical `{command:'minih', args:['run', …], cwd, logPath}` and recorded the returned pid | ubuntu (deterministic) |
| **Adapter contract test** (`platform:'win32'` injection into `resolveSpawn`) | the real adapter's resolved spec = `cmd.exe` + verbatim for a `.cmd` target, and `{detached,stdio,unref,windowsHide}` are set | ubuntu (pure resolution; no real Windows) |

---

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| Implementation (T002) | "set no `windowsVerbatimArguments`" → builds a `.cmd` spawn that **EINVALs on Windows**; debugs the regression | Reuse `resolveSpawn`, pass the flag through; works first try |
| Implementation (T010) | "simplify `windows-command.ts`" → attempts Option A, can't, churns | T010 = one test + one comment; no source change |
| Review | Reviewer flags `windowsVerbatimArguments:true` as a smell | Reviewer checks it against C-decision + I2; closed |
| Testing | Unclear what a non-Windows host can prove | C3 names the two provable layers |

## Validation / Acceptance

This workshop reaches Contract Ready when:

- The decision table names Option A as **invalid (EINVAL)** with a Node-docs/CVE citation — ✅.
- T002 has a copy-ready spawn spec with the 5 invariants — ✅.
- The verbatim-is-correct argument is stated with the explicit-cmd.exe distinction — ✅.
- Every plan line this rewrites is enumerated (below) — ✅.

## Plan Impact (folds into the next `plan` re-run)

| Plan element | Was | Now |
|--------------|-----|-----|
| **AC-07** (`…-plan.md:71,186`) | "adapter sets **no** `windowsVerbatimArguments`; relies on patched-Node escaping / bypass" | "detached adapter **reuses `resolveSpawn`** and passes `windowsVerbatimArguments` through (true on the cmd.exe route); **no path spawns a bare `.cmd` with `shell:false`** (EINVAL on Node ≥20.12.2)" |
| **T002** (`:166`) | "**no `windowsVerbatimArguments`**; prefer `node`+resolved-JS over `.cmd`" | "reuse `resolveSpawn`; pass the flag through (I2); `node`+JS bypass is a deferred optimisation (Option B), not the contract" |
| **T010** (`:174`) | optional "simplify `windows-command.ts` to drop `windowsVerbatimArguments`" | "**withdrawn** — add a regression test + comment documenting *why verbatim is retained*; no source change" |
| **Risk 03 / Residual BatBadBut** (`:151,81,197`) | open residual, gated on F19 | **resolved** — verbatim is correct for the explicit-cmd.exe route; residual is only hand-rolled-escaping completeness, bounded by the tested `"`-reject + inert-metachar quoting |
| **Open-Q F19** (`:85,90`) | workshop candidate | **closed by this workshop** |
| **engines pin** (T003/AC-07) | pin patched ≥20.12.2 / 22.x + runtime guard | **unchanged & reinforced** — the EINVAL regime *is* the reason to pin; the guard gives a clear error on an unpatched runtime |

## Open Questions

### Q1: Spawn `.cmd` directly on patched Node with built-in escaping (DR-1/F19)?
**RESOLVED — No.** Patched Node (our `>=22` baseline; host is 24.7.0) throws `EINVAL`. The Node docs mandate `spawn('cmd.exe', ['/c', …])`. `resolveSpawn` already does this.

### Q2: Detached launch — `node`+JS-entry bypass, or `cmd.exe` wrapper?
**RESOLVED — `cmd.exe` wrapper via `resolveSpawn` (Option C).** The JS-entry bypass (Option B) needs a module-resolvable target; minih is global on PATH, so B is deferred. Accept the cosmetic console flash for the background worker.

### Q3: Drop `windowsVerbatimArguments` from `windows-command.ts` (T010)?
**RESOLVED — No.** It is required for the explicit-cmd.exe `/s` line and is not a BatBadBut exposure in this pattern. T010 becomes documentation + a regression test.

### Q4: Worth chasing Option B later to kill the console flash?
**OPEN (low priority).** Only if minih becomes a resolvable dependency, or if the flash proves disruptive in real Windows dogfood runs. Tracked as a follow-up, not a blocker.
