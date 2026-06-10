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
│   ├── index.ts            # Entrypoint: thin bin — calls main() with a catastrophic catch
│   ├── app.ts              # Composition root: async main, discover+load extensions, buildProgram
│   ├── acts/               # One file per command (help, doctor, verb — the per-extension act)
│   ├── services/           # Business logic (doctor/, extensions/, config/, help/)
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
export function registerDoctorAct(program: Command, io: CliIo, registry: VerbRegistry): void {
  program.command('doctor').description('Report harness readiness + installed extensions')
    .action(() => {
      const deps = { fs: new NodeFs(), proc: new NodeProcess(), git: new ExecGit(),
                     env: new NodeEnv(), clock: new SystemClock() };
      const env = runDoctor(deps, registry);                       // service call (registry injected)
      exitWithEnvelope(env, createOutputPort(io.mode, io.writers)); // single exit site
    });
}

// services/doctor/doctor-service.ts — logic, ports only, no node:* imports
export function runDoctor(deps: DoctorDeps, registry: VerbRegistry): Envelope { /* … */ }
```

**Why this shape**: the service is unit-testable with fakes (zero real I/O), and the entrypoint/act stay free of business logic.

## 3. Port + impl + fake (one fake per adapter)

```ts
// adapters/fs/fs-port.ts
export interface FsPort {
  exists(path: string): boolean;
  readText(path: string): string | null;
  readdir(path: string): string[];   // directory listing (powers extension discovery)
}

// adapters/fs/node-fs.ts  (production)
export class NodeFs implements FsPort { /* wraps node:fs */ }

// adapters/fs/fake-fs.ts  (tests — records call history)
export class FakeFs implements FsPort {
  readonly reads: string[] = [];
  constructor(private files: Record<string, string> = {}, private dirs: Record<string, string[]> = {}) {}
  exists(p: string) { this.reads.push(p); return p in this.files; }
  readText(p: string) { this.reads.push(p); return this.files[p] ?? null; }
  readdir(p: string) { this.reads.push(p); return this.dirs[p] ?? []; }
}
```

## 4. Unit test with injected fakes (no real I/O)

```ts
it('reports degraded when the cli build is missing', () => {
  const fs = new FakeFs({});                                     // no dist/ present
  const deps = { fs, proc: new FakeProcess({ node: '/usr/bin/node' }),
                 git: new FakeGit(), env: new FakeEnv(),
                 clock: new FakeClock('2026-06-08T07:20:00.000Z') };
  const env = runDoctor(deps, { verbs: [], records: [] });       // empty verb registry
  expect(env.status).toBe('degraded');
  expect(env.timestamp).toBe('2026-06-08T07:20:00.000Z');       // deterministic via FakeClock
  expect(env.next_action).toBeDefined();                         // required on non-ok
  expect(fs.reads).toContain('harness/cli/dist/index.js');       // assert on call history
});
```

## 5. Envelope constructors & exit mapping

```ts
formatOk('doctor', { layers }, clock, { next_action: 'Run `harness help`.' });
formatUnconfigured('deploy', 'No behaviour mapped for this verb yet.', clock);   // → exit 2
formatError('build', 'E1', 'build failed (exit 1).', clock,
            { next_action: 'Fix the build error above.' });                       // → exit 1

// status → exit: ok 0 | degraded 0 | unconfigured 2 | error 1
```

Inside a verb handler you don't call these directly — the injected `ctx` exposes
`ctx.ok / degraded / unconfigured / error` returning a `VerbResult`; the kernel
finalizes it into the Envelope (adds `command` + `timestamp`, maps status → exit).

## 6. Honest unconfigured (never fake success)

A verb that has no behaviour yet returns `unconfigured` + a `next_action` rather
than faking a `0`:

```
$ harness deploy
{"command":"deploy","status":"unconfigured","timestamp":"…",
 "next_action":"No behaviour mapped for this verb yet. Edit .harness/extensions/deploy.ts."}
# exit 2
```

## 7. Open-capable verb registry (don't foreclose extensions)

```ts
// DO — open `name: string` key; the verb surface comes entirely from discovered extensions
export interface HarnessVerb { name: string; summary: string; run(ctx: VerbContext): VerbResult | Promise<VerbResult>; /* … */ }
const registry = await buildVerbRegistry(discoverExtensions(fs, proc), loader);   // dynamic, runtime

// DON'T — closed set forecloses the extension future
// type VerbName = 'build' | 'lint' | 'test' | …;  ❌ used as the registry's only key
```

## 8. Runtime vs dev dependency

```jsonc
// package.json
"dependencies":    { "commander": "…", "jiti": "…" },   // needed at runtime in a user's repo (jiti loads .ts extensions)
"devDependencies": { "typescript": "…", "vitest": "…", "@biomejs/biome": "…" }  // build/test only
// npx / distributed installs run --omit=dev, so runtime needs MUST be in "dependencies".
```

## 9. Complexity Score (no time) — calibration

| Change | S | I | D | N | F | T | P | CS |
|--------|---|---|---|---|---|---|---|----|
| Rename a constant in one file | 0 | 0 | 0 | 0 | 0 | 0 | 0 | **CS-1** trivial |
| Add a new verb to an installed extension | 1 | 0 | 0 | 0 | 0 | 1 | 2 | **CS-1** trivial |
| Add a new real command (act+service+tests) using existing adapters | 1 | 1 | 1 | 1 | 0 | 1 | 5 | **CS-3** medium |
| Stand up the CLI core + engineering substrate (this slice) | 2 | 1 | 1 | 1 | 1 | 2 | 8 | **CS-4** large |
| Introduce the runtime extension system with discovery + loader | 2 | 2 | 2 | 2 | 1 | 2 | 11 | **CS-5** epic |

Always pair a CS with assumptions, dependencies, risks, and phases. Never use time words.

## 10. doctor as executable orientation

`doctor` does double duty: it validates readiness **and** teaches the operator how the repo wants to be worked with. Report layered checks, each with a `next_action`; human progress on stderr, JSON envelope on stdout; safe to run at session start.

## 11. Logical paths are POSIX on every OS

Every path the CLI **surfaces or compares** — envelope `data.path`, record messages, extension `entryPath`/`folder`, doctor hints, dedupe keys — is a *logical* path: forward slashes only, `.harness/...` shapes literal, identical on Windows and POSIX hosts. *Physical* I/O (NodeFs syscalls) keeps native separators. Convert ONCE at the boundary, then stay in POSIX space (see the `services/shared/posix-path.ts` docstring — the enforcement point).

```ts
// DO — convert at the boundary, build logical paths with the shared helper
import { posixJoin, toPosix } from '../shared/posix-path.js';
const base = posixJoin(toPosix(proc.cwd()), '.harness', 'extensions');   // 'C:/repo/.harness/extensions' on Windows

// DON'T — native node:path on surfaced/compared paths (backslashes leak into envelopes on Windows)
// const base = join(proc.cwd(), '.harness', 'extensions');  ❌
// DON'T — posix.resolve on logical paths ('C:/repo' reads as RELATIVE → host cwd prepended)
// const key = posix.resolve(p);  ❌ use dedupeKey(p) (posix.normalize-based)
```

Corollary (stdout is data, P4): anything that runs inside an npm lifecycle (`prepack` etc.) logs to **stderr** — a stdout line corrupts `npm pack` captures, *including* the `--json` form. Two paired sensors keep the convention honest on ubuntu (`test/services/windows-shape.test.ts`): the `FakeProcess.cwd()='C:\\repo'` fixture set catches **cwd-boundary** regressions, and the AC-2 source guard bans `node:path` imports outright in the five converted services (deeper regressions that helper defense-in-depth would otherwise mask).

<!-- USER CONTENT START -->
<!-- Add project-specific idioms and examples here; preserved across regenerations. -->
<!-- USER CONTENT END -->
