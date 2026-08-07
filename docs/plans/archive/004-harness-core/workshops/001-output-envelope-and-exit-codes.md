# Workshop: Output envelope + exit-code contract

**Type**: API Contract
**Plan**: 004-harness-core
**Spec**: [../harness-core-spec.md](../harness-core-spec.md)
**Created**: 2026-06-08
**Status**: Approved

**Value Thesis**: This workshop pins the single contract that every command — and every future extension — binds to. Locking the envelope shape, the status set, the status→exit-code mapping, and the human-vs-JSON selection rule now removes the highest-churn ambiguity in the whole CLI before any code is written.
**Target Proof Level**: Implementation Ready
**Current Proof Level**: Implementation Ready

**Selected Value Axes**:
- **Implementation Readiness**: a developer/agent can build the output kernel directly from the types, mapping table, and worked examples here.
- **Agent Readiness**: the JSON envelope is the machine-readable API; its field-presence rules must be unambiguous for an agent consumer.
- **Safety to Change**: every later extension fills command slots through this contract; getting `unconfigured`/`degraded`/exit semantics right now prevents a breaking reshape later.
- **Review Compression**: reviewers can check command output against one table instead of re-deriving intent per command.

**Related Documents**:
- [002-cli-composition-pattern.md](./002-cli-composition-pattern.md) — where the envelope is produced (acts) and exited (entrypoint).
- [../research-dossier.md](../research-dossier.md) — CD-01 (envelope superset), CD-02 (exit policy).

**Domain Context**:
- **Primary Domain**: harness-cli (the output kernel lives in the CLI's service/output layer).
- **Related Domains**: repo engineering substrate (consumes nothing; the envelope is internal to the CLI).

---

## Purpose

Specify the canonical output contract for the harness CLI so that (a) every command emits a predictable structure, (b) agents can parse status/evidence/next-action without scraping text, and (c) unconfigured slots fail honestly with a distinct exit code. This is the contract the Phase-1 "output kernel" implements with unit tests.

## Fresh Entrant Outcome

A fresh human or agent should be able to use this workshop to reach **Implementation Ready** with no additional context. They should be able to:

- Write the `Envelope` TypeScript type and the `formatOk` / `formatUnconfigured` / `formatError` constructors.
- Implement `exitWithEnvelope()` with the correct status→exit-code mapping.
- Decide, per command, whether output is human or JSON, and render both.
- Know exactly which fields are present for each status.

## Key Questions Addressed

1. What is the exact envelope field set, and which fields are present for each status?
2. What are the status values, and how do they map to process exit codes?
3. How is human-vs-JSON output selected (flag vs TTY detection vs env)?
4. What do `evidence` and `next_action` look like, and when are they present?
5. Is exit `2` universal for all unconfigured slots, or per-command overridable?

---

## Value Frame

| Field | Selection | Why It Matters |
|-------|-----------|----------------|
| Target Proof Level | Implementation Ready | Phase 1 builds the kernel directly from this doc. |
| Primary Value Axis | Implementation Readiness | The types + mapping table are the build spec. |
| Supporting Value Axes | Agent Readiness, Safety to Change, Review Compression | The envelope is the agent API and the extension seam. |
| Downstream Loop Improved | Implementation + Agent execution | Removes per-command output guesswork and prevents a later contract reshape. |

## Background: the proven reference pattern (captured, not assumed)

The sibling repo `minih` ships a battle-tested envelope. We capture its shape here so this plan does **not** assume minih is on disk at build time. minih's actual contract (verbatim shape):

```ts
// minih: src/cli/output.ts (reference — the shape we extend)
export interface MinihEnvelope {
  command: string;
  status: 'ok' | 'error' | 'degraded';
  timestamp: string;
  data?: unknown;
  error?: { code: string; message: string; details?: unknown };
}

export function exitWithEnvelope(envelope: MinihEnvelope): never {
  printEnvelope(envelope);           // JSON.stringify -> stdout + "\n"
  process.exit(envelope.status === 'error' ? 1 : 0);  // ok/degraded -> 0
}
```

minih also selects output mode by **TTY detection**: when stdout is piped (`!process.stdout.isTTY`) it emits the JSON envelope; when interactive it renders a human table. (Source: `src/cli/commands/list.ts`.)

**What we keep**: `command`, `status`, `timestamp`, `data`, `error{code,message,details}`, the central error-code table, `exitWithEnvelope`, and TTY-based mode selection.

**What we extend** (spec CD-01 + CD-02):
1. Add `evidence` and `next_action` to the envelope.
2. Add a fourth status `unconfigured`.
3. Map `unconfigured` → exit code **2** (minih has no equivalent; it would have used `degraded`→0, which hides unbuilt slots — exactly what our spec forbids).

---

## Decision Space

| Option | Description | Pros | Cons | Decision |
|--------|-------------|------|------|----------|
| Envelope: copy minih as-is | `{command,status,data,error,timestamp}` only | Zero new surface | No `evidence`/`next_action`; can't represent unconfigured honestly | **Rejected** |
| Envelope: minih + `evidence` + `next_action` + `unconfigured` status | The superset below | Honest unconfigured slots; agent-actionable; evidence paths | Slightly larger contract | **Selected** |
| Mode select: `--json` flag only | Explicit flag | Predictable | Agents must always remember the flag; piping doesn't "just work" | Rejected |
| Mode select: TTY detection + `--json`/`--no-json` override | Auto JSON when piped; flag forces either way | Ergonomic for agents (pipe → JSON) and humans (TTY → text); explicit override exists | Must document the precedence | **Selected** |
| Exit: `unconfigured` → 0 (like degraded) | Treat unbuilt as success-ish | Matches minih | Violates spec AC ("never pretend success") | **Rejected** |
| Exit: `unconfigured` → 2, with documented per-command degraded→0 | Distinct code; opt-out per command | Honest by default; flexible | One extra rule to document | **Selected** |

---

## The Contract

### Envelope type

```ts
// harness/cli/src/output/envelope.ts
export type Status = 'ok' | 'error' | 'degraded' | 'unconfigured';

export interface Evidence {
  /** Human label, e.g. "doctor report" or "coverage summary". */
  label: string;
  /** Repo-relative path where durable proof was written, if any. */
  path?: string;
  /** Set true when the command explicitly produced NO durable evidence. */
  none?: boolean;
}

export interface Envelope {
  command: string;                 // e.g. "doctor", "run", "validate"
  status: Status;
  timestamp: string;               // ISO-8601, from a Clock adapter (testable)
  data?: unknown;                  // command-specific payload (present on ok/degraded)
  error?: {                        // present on error
    code: string;                  // from the central ErrorCodes table
    message: string;               // actionable, human-readable
    details?: unknown;
  };
  evidence?: Evidence[];           // present when a command produces/forgoes proof
  next_action?: string;            // present on unconfigured/degraded/error; the "what to do next"
}
```

### Field-presence rules (the part agents depend on)

| Field | `ok` | `degraded` | `unconfigured` | `error` |
|-------|------|-----------|----------------|---------|
| `command` | ✅ | ✅ | ✅ | ✅ |
| `status` | ✅ | ✅ | ✅ | ✅ |
| `timestamp` | ✅ | ✅ | ✅ | ✅ |
| `data` | ✅ | ✅ | optional | ✗ (use `error`) |
| `error` | ✗ | optional | ✗ | ✅ |
| `evidence` | optional | optional | ✗ (nothing produced) | optional |
| `next_action` | optional | ✅ | ✅ (required) | ✅ |

**Rule**: `next_action` is **required** whenever `status !== 'ok'`. An agent that hits a non-`ok` status must always be told what to try next.

### Status → exit code mapping (authoritative)

| Status | Exit code | Meaning |
|--------|-----------|---------|
| `ok` | `0` | Command succeeded. |
| `degraded` | `0` (default) | Succeeded with caveats; a command MAY document `degraded` and still exit `0`. A command MAY opt to treat its own degraded as non-zero, but must document it. |
| `unconfigured` | `2` | A required slot has no mapped behaviour yet. Honest "not built". |
| `error` | `1` | Command failed. |

```ts
// harness/cli/src/output/exit.ts
const EXIT_BY_STATUS: Record<Status, number> = {
  ok: 0,
  degraded: 0,
  unconfigured: 2,
  error: 1,
};

export function exitCodeFor(env: Envelope): number {
  return EXIT_BY_STATUS[env.status];
}

export function exitWithEnvelope(env: Envelope, io: OutputPort): never {
  io.emit(env);                    // renders human or JSON (see below)
  process.exit(exitCodeFor(env));  // single exit point
}
```

> **Why exit 2 for unconfigured**: it is distinguishable from a real failure (1) in CI and scripts. `doctor` can exit `0` (it succeeded at *reporting*), while `harness run` on an unmapped slot exits `2` — a script can tell "not built yet" from "broke".

### Constructors

```ts
// harness/cli/src/output/envelope.ts
export function formatOk<T>(command: string, data: T, clock: Clock,
  opts?: { status?: 'ok' | 'degraded'; evidence?: Evidence[]; next_action?: string }): Envelope {
  return { command, status: opts?.status ?? 'ok', timestamp: clock.nowIso(),
    data, ...(opts?.evidence && { evidence: opts.evidence }),
    ...(opts?.next_action && { next_action: opts.next_action }) };
}

export function formatUnconfigured(command: string, next_action: string, clock: Clock): Envelope {
  return { command, status: 'unconfigured', timestamp: clock.nowIso(), next_action };
}

export function formatError(command: string, code: string, message: string,
  clock: Clock, opts?: { details?: unknown; next_action?: string }): Envelope {
  return { command, status: 'error', timestamp: clock.nowIso(),
    error: { code, message, ...(opts?.details !== undefined && { details: opts.details }) },
    next_action: opts?.next_action ?? message };
}
```

> Note `clock: Clock` is injected (not `new Date()`) so `timestamp` is deterministic in unit tests. See workshop 002 for the Clock adapter.

### Human vs JSON selection (the `OutputPort`)

```ts
// harness/cli/src/output/output-port.ts
export interface OutputPort { emit(env: Envelope): void; }

// Selection precedence (highest wins):
//   1. explicit --json / --no-json flag
//   2. HARNESS_JSON=1 env (for CI where TTY detection is unreliable)
//   3. TTY detection: piped (!stdout.isTTY) => JSON, interactive => human
export function selectMode(flags: { json?: boolean }, env: NodeJS.ProcessEnv,
  isTty: boolean): 'json' | 'human' {
  if (flags.json === true) return 'json';
  if (flags.json === false) return 'human';
  if (env.HARNESS_JSON === '1') return 'json';
  return isTty ? 'human' : 'json';
}
```

- **JSON renderer** → `process.stdout.write(JSON.stringify(env) + '\n')`. One line, parseable.
- **Human renderer** → readable text to **stderr** for progress/diagnostics, with the final summary line on stdout. (doctor's layered output is human-on-stderr; see workshop 002.)

---

## Worked Examples

### `doctor` (human, TTY)

```
$ harness doctor
Harness doctor — checking layers…
  ✓ Layer 0  toolchain      node v24.7.0, just present
  ✓ Layer 1  cli build      harness/cli/dist present
  ⚠ Layer 2  command slots  2 configured (help, doctor), 8 unconfigured
                            → Run: harness help  to see the slot map
Status: degraded — core is healthy; 8 slots await extensions.
```
Exit code: `0` (doctor succeeded at reporting; degraded is informational).

### `doctor` (JSON, piped)

```
$ harness doctor --json
{"command":"doctor","status":"degraded","timestamp":"2026-06-08T07:20:00.000Z",
 "data":{"layers":[{"id":0,"name":"toolchain","ok":true},
                   {"id":2,"name":"command-slots","ok":false,
                    "configured":["help","doctor"],
                    "unconfigured":["run","validate","build","lint","test","smoke","health","observe"]}]},
 "evidence":[{"label":"doctor report","none":true}],
 "next_action":"Run `harness help` to see the slot map; configure slots via extensions (later)."}
```
Exit code: `0`.

### `run` on an unconfigured slot

```
$ harness run smoke
{"command":"run","status":"unconfigured","timestamp":"2026-06-08T07:21:00.000Z",
 "next_action":"No command is mapped to slot 'smoke' yet. This will be provided by a harness extension. Run `harness doctor` to see configured slots."}
```
Exit code: `2`.

### `run --dry-run` on an unconfigured slot (safe at session start)

```
$ harness run smoke --dry-run
{"command":"run","status":"unconfigured","timestamp":"2026-06-08T07:21:30.000Z",
 "data":{"dry_run":true,"slot":"smoke","mapped_command":null},
 "next_action":"Dry-run: slot 'smoke' has no mapped command. Nothing would execute."}
```
Exit code: `2`. (Dry-run never executes anything; safe to run at session start.)

### `error` (bad arguments)

```
$ harness run
{"command":"run","status":"error","timestamp":"2026-06-08T07:22:00.000Z",
 "error":{"code":"E108","message":"Missing required argument: <slot>. Usage: harness run <slot> [--dry-run]."},
 "next_action":"Provide a slot name, e.g. `harness run validate`. See `harness run --help`."}
```
Exit code: `1`.

---

## Error code table (starter)

Mirrors minih's central-table approach (grep `Exxx` to find call sites). Start minimal; grow as commands are added.

| Code | Name | Cause |
|------|------|-------|
| `E100` | `UNKNOWN` | Unclassified failure (last resort). |
| `E108` | `INVALID_ARGS` | Missing/invalid argument or flag. |
| `E110` | `SLOT_UNKNOWN` | Named slot is not a known command slot. |
| `E120` | `CONFIG_INVALID` | `.harness`/command-map config failed validation. |
| `E130` | `DOCTOR_CHECK_FAILED` | A doctor check raised an unexpected error (vs. reporting a failing layer). |

```ts
// harness/cli/src/output/error-codes.ts
export const ErrorCodes = {
  UNKNOWN: 'E100',
  INVALID_ARGS: 'E108',
  SLOT_UNKNOWN: 'E110',
  CONFIG_INVALID: 'E120',
  DOCTOR_CHECK_FAILED: 'E130',
} as const;
export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];
```

---

## Evidence Ledger

| Evidence | Location | Supports | Status |
|----------|----------|----------|--------|
| `Envelope` type + field-presence table | This doc | Implementation of the kernel | Ready |
| Status→exit-code table + `exitCodeFor` | This doc | Exit semantics AC | Ready |
| Mode-selection precedence + `selectMode` | This doc | Human/JSON AC | Ready |
| 5 worked command examples (human/JSON/unconfigured/dry-run/error) | This doc | Per-command output, agent parsing | Ready |
| Starter error-code table | This doc | Actionable errors AC | Ready |

## Attention Reduction

| Future Loop | Before Workshop | After Workshop |
|-------------|-----------------|----------------|
| Implementation | "What fields does each status carry? What exit code?" | Field-presence table + exit table are copy-ready. |
| Review | Re-derive each command's output intent | Check output against one contract. |
| Testing | Invent expected envelopes per command | Worked examples are the test fixtures. |
| Agent execution | Parse text / guess success | Stable JSON + required `next_action` on non-ok. |

## Validation / Acceptance

This workshop reaches Implementation Ready when:

- The `Envelope` type, constructors, `exitCodeFor`, and `selectMode` can be implemented verbatim from this doc.
- Unit tests can assert each worked example's envelope + exit code.
- `next_action` is present on every non-`ok` example.
- The unconfigured-slot example exits `2`, not `0`.

## Open Questions

### Q1: Is exit `2` universal for unconfigured?
**RESOLVED**: Yes — `unconfigured` always maps to `2`. A command may document a *degraded* (exit `0`) state, but "unconfigured" specifically means "no mapped behaviour" and is always `2`.

### Q2: Should `evidence` ever appear on a pure `ok` with no artifact?
**RESOLVED**: Optional. When a command produces no durable proof, prefer an explicit `{label, none: true}` over omitting `evidence`, so agents can distinguish "no evidence produced" from "command didn't consider evidence."

### Q3: `--json` global or per-command?
**RESOLVED**: Global flag (set on the root command, inherited), plus `HARNESS_JSON=1` and TTY fallback. Precedence as in `selectMode`.
