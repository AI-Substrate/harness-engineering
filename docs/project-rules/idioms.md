# Harness Engineering Idioms

**Version**: 1.0.0
**Last Updated**: 2026-06-08
**Constitution Reference**: [constitution.md](./constitution.md)

Recurring patterns and worked examples that make the Constitution and Rules concrete. Authoritative deep dives live in [`docs/plans/004-harness-core/workshops/`](../../docs/plans/004-harness-core/workshops/).

---

## 1. Directory Conventions

```
harness/cli/
├── src/
│   ├── index.ts            # Entrypoint: commander root, global flags, register acts
│   ├── acts/               # One file per command (help, doctor, unconfigured-slot)
│   ├── services/           # Business logic (doctor/, slots/, config/, help/)
│   ├── adapters/           # <name>/ { <name>-port.ts, node-<name>.ts, fake-<name>.ts }
│   └── output/             # envelope.ts, error-codes.ts, exit.ts, output-port.ts
├── test/
│   ├── unit/  integration/  fixtures/   # durable tests + shared data
│   └── (scratch/ — probes, gitignored, excluded from CI)
├── tsconfig.json
├── vitest.config.ts
└── README.md
package.json   biome.json   justfile        # at REPO ROOT
.github/workflows/{ci.yml,release.yml}
```

## 2. The act → service → adapter idiom

The **act** constructs concrete adapters and injects them; the **service** holds the logic and knows only ports.

```ts
// acts/doctor.ts — composition root for one command (thin)
export function registerDoctorAct(program: Command): void {
  program.command('doctor').description('Report harness readiness')
    .action(() => {
      const deps = { fs: new NodeFs(), proc: new NodeProcess(), clock: new SystemClock() };
      const env = runDoctor(deps, loadSlotRegistry(deps.fs));      // service call
      const io = makeOutputPort(program.opts(), process.env, process.stdout.isTTY);
      exitWithEnvelope(env, io);                                   // single exit site
    });
}

// services/doctor/doctor-service.ts — logic, ports only, no node:* imports
export function runDoctor(deps: DoctorDeps, slots: SlotRegistry): Envelope { /* … */ }
```

**Why this shape**: the service is unit-testable with fakes (zero real I/O), and the entrypoint/act stay free of business logic.

## 3. Port + impl + fake (one fake per adapter)

```ts
// adapters/fs/fs-port.ts
export interface FsPort { exists(path: string): boolean; readText(path: string): string | null; }

// adapters/fs/node-fs.ts  (production)
export class NodeFs implements FsPort { /* wraps node:fs */ }

// adapters/fs/fake-fs.ts  (tests — records call history)
export class FakeFs implements FsPort {
  readonly reads: string[] = [];
  constructor(private files: Record<string, string> = {}) {}
  exists(p: string) { this.reads.push(p); return p in this.files; }
  readText(p: string) { this.reads.push(p); return this.files[p] ?? null; }
}
```

## 4. Unit test with injected fakes (no real I/O)

```ts
it('reports degraded when the cli build is missing', () => {
  const fs = new FakeFs({});                                     // no dist/ present
  const deps = { fs, proc: new FakeProcess({ which: { node: '/usr/bin/node' } }),
                 clock: new FakeClock('2026-06-08T07:20:00.000Z') };
  const env = runDoctor(deps, loadSlotRegistry(fs));
  expect(env.status).toBe('degraded');
  expect(env.timestamp).toBe('2026-06-08T07:20:00.000Z');       // deterministic via FakeClock
  expect(env.next_action).toBeDefined();                         // required on non-ok
  expect(fs.reads).toContain('harness/cli/dist/index.js');       // assert on call history
});
```

## 5. Envelope constructors & exit mapping

```ts
formatOk('doctor', { layers }, clock, { status: 'degraded', next_action: 'Run `harness help`.' });
formatUnconfigured('smoke', 'No command mapped to slot "smoke" yet.', clock);   // → exit 2
formatError('run', ErrorCodes.INVALID_ARGS, 'Missing <slot>.', clock,
            { next_action: 'e.g. `harness run validate`.' });                   // → exit 1

// status → exit: ok 0 | degraded 0 | unconfigured 2 | error 1
```

## 6. Honest unconfigured slot (never fake success)

```
$ harness run smoke
{"command":"run","status":"unconfigured","timestamp":"…",
 "next_action":"No command is mapped to slot 'smoke' yet. Provided later by a harness extension. Run `harness doctor`."}
# exit 2
```

## 7. Open-capable slot registry (don't foreclose extensions)

```ts
// DO — open-capable
export interface CommandSlot { name: string; status: SlotStatus; next_action: string; /* future: handler? */ }
const BUILTIN_SLOTS: CommandSlot[] = [ { name: 'run', status: 'unconfigured', next_action: '…' }, /* … */ ];

// DON'T — closed set forecloses the extension future
// type SlotName = 'run' | 'validate' | 'build' | …;  ❌ used as the registry's only key
```

## 8. Runtime vs dev dependency

```jsonc
// package.json
"dependencies":    { /* "jiti", future extension-loader libs — needed at runtime in a user's repo */ },
"devDependencies": { "typescript": "…", "vitest": "…", "@biomejs/biome": "…" }  // build/test only
// npx / distributed installs run --omit=dev, so runtime needs MUST be in "dependencies".
```

## 9. Complexity Score (no time) — calibration

| Change | S | I | D | N | F | T | P | CS |
|--------|---|---|---|---|---|---|---|----|
| Rename a constant in one file | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **CS-1** trivial |
| Add a new unconfigured slot to the registry | 1 | 0 | 0 | 0 | 0 | 1 | 2 | **CS-1** trivial |
| Add a new real command (act+service+tests) using existing adapters | 1 | 1 | 1 | 1 | 0 | 1 | 5 | **CS-3** medium |
| Stand up the CLI core + engineering substrate (this slice) | 2 | 1 | 1 | 1 | 1 | 2 | 8 | **CS-4** large |
| Introduce the runtime extension system with discovery + loader | 2 | 2 | 2 | 2 | 1 | 2 | 11 | **CS-5** epic |

Always pair a CS with assumptions, dependencies, risks, and phases. Never use time words.

## 10. doctor as executable orientation

`doctor` does double duty: it validates readiness **and** teaches the operator how the repo wants to be worked with. Report layered checks, each with a `next_action`; human progress on stderr, JSON envelope on stdout; safe to run at session start.

<!-- USER CONTENT START -->
<!-- Add project-specific idioms and examples here; preserved across regenerations. -->
<!-- USER CONTENT END -->
