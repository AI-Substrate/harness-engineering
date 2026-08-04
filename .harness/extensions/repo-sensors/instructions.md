# Repository sensors

This v2 extension declares the fast, deterministic measurements this repository
uses while developing the harness itself. It adds no verbs and contains no gate
business logic: command-backed readings wrap an existing local npm script, local
harness verb, or local Git scan and then persist only an authored conclusion.

## Runtime contract

Sensors are short-feedback instruments, not batch jobs: target seconds, tolerate
up to about 2–3 minutes, never longer. The engine's default 30-second hard kill
is the paved path; raising `timeoutMs` above 180,000 ms is a design smell and the
work belongs in CI or a verb. **If your sensor needs 20 minutes, it isn't a
sensor.**

The final post-fix `harness sensors check` on 2026-07-15 produced these
measured wallclocks. Both suite-backed readings are independent bounded
invocations; all other readings retain the 30-second default budget.

| Sensor | Local source of truth | Measured | Timeout |
|--------|-----------------------|---------:|--------:|
| `tests` | `npm test` | 7,551 ms | 60,000 ms |
| `skills-check` | `node harness/cli/bin/harness.js skills-check --json` | 219 ms | 30,000 ms |
| `typecheck` | local TypeScript bin via `node node_modules/typescript/bin/tsc --noEmit -p harness/cli/tsconfig.json` | 844 ms | 30,000 ms |
| `lint` | `npm run lint` | 412 ms | 30,000 ms |
| `arch-check` | `node harness/cli/bin/harness.js arch-check --json` | 1,206 ms | 30,000 ms |
| `docs-drift` | `npm run check:docs` | 199 ms | 30,000 ms |
| `flows-drift` | `npm run check:flows` | 1,297 ms | 30,000 ms |
| `doctrine-parity` | `npm run check:doctrine-parity` | 271 ms | 30,000 ms |
| `windows-check` | `node harness/cli/bin/harness.js windows-check --json` | 226 ms | 30,000 ms |
| `coverage-branch` | independent `npm test`, then parse its branch summary | 7,954 ms | 60,000 ms |
| `todo-debt` | local `git grep` count over tracked debt annotations | 194 ms | 30,000 ms |
| `lock-hygiene` | local `git grep` over `package-lock.json` | 19 ms | 30,000 ms |
| `telemetry-ref-size` | local `git for-each-ref` + `git ls-tree` over `refs/harness-telemetry/**` | 931 ms | 30,000 ms |

No wrapper invokes `npx`, installs a package, resolves registry metadata, or
opens the network. The coverage sensor never depends on the `tests` sensor or a
prior artifact: it executes its own bounded test command. A successful test run
without a branch summary becomes `skip`, never a fabricated score.

## Reading posture

- `tests`, `skills-check`, `typecheck`, `lint`, drift guards, and
  `windows-check` map their existing local verdict to a short reading.
- `arch-check` preserves the existing warn-launch posture: a degraded envelope
  is a `warn` reading rather than a fabricated pass.
- `coverage-branch` is higher-is-better with threshold 80%. Below-target
  coverage is visible as `warn` while the independent command still succeeded.
- `todo-debt` is lower-is-better with threshold 20. The initial score is
  intentionally honest and may warn while debt is paid down.
- `lock-hygiene` is lower-is-better with threshold zero and fails if a private
  feed, CDN, proxy, or signed URL appears in the tracked lock.
- `telemetry-ref-size` is lower-is-better with threshold zero and counts
  `refs/harness-telemetry/**` trees carrying more than 16 files (a ROLLED ref
  carries exactly 3). It **warns and never fails**: a 17,566-file legacy June ref
  sat here undetected because nothing watched ref size, and that ref is a known,
  accepted offender that is expected to trip this forever. The sensor's job is
  making it visible, not red — `harness sensors check` maps `warn` to exit 0, so
  it can never break the gate. Refs are read READ-ONLY; nothing is ever written
  to `refs/harness-telemetry/*`. A ref git cannot read is reported as unreadable
  in the report, never counted as compliant.

Raw child stdout and stderr are used only to derive decisions. They are never
copied to `details` or `report`; persisted text is bounded, author-written, and
safe for JSON/history playback. Status readers remain state-only and never run
these commands implicitly.
