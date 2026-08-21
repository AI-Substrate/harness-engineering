# Phase 3 round-two review - CHANGES

**Reviewer**: `pij-rolling-mammal` (terra)  
**Commits reviewed**: `ab44268d`, `1faedfd7`, `aea4ae8d`  
**Scope**: tk-0201 through tk-0203

## P1 - The five "fully faked" timeout cases do run real child processes

The phase log and task note say the four `app.test.ts` cases and the
`update-banner.test.ts` negative control are fully faked, contain no
`child_process` work, and therefore have no mechanism for their consumer-side
18-26s elapsed time. That search boundary excludes the real `doctor` act that
every one of those cases invokes.

`runMain(..., 'doctor', ...)` is used by the three capture-throw controls and
the `doctor` member of the kill-switch table
(`harness/cli/test/app.test.ts:382-437`). The update-banner negative control
calls `run(['doctor'], ...)` three times
(`harness/cli/test/integration/update-banner.test.ts:110-116`). `doctor`
constructs its own real `NodeProcess` and `ExecGitAttribution`, rather than
using the fake ports supplied to the test
(`harness/cli/src/acts/doctor.ts:185-204`).

A read-only `node:child_process` preload around the target tests observed
`spawnSync('git', ...)` from `readIngress()` through
`ExecGitAttribution.globalTrace2Target()`, and `spawnSync('which', ...)` from
`checkToolchain()`. The latter maps to `where` on Windows
(`harness/cli/src/adapters/process/node-process.ts:5-11`). This is a concrete
unmeasured mechanism; it does not prove it causes the consumer's timings.

Do not publish "there is no work inside them to remove" or "no mechanism was
found." First record child-process activity for all five cases (and, if needed,
time the `doctor` subpaths on the consumer's machine), then report the result
as a measured negative or as an unresolved candidate. The current static
absence cannot close ac-000c.

## P2 - The remaining "~26s" is an estimate presented as a current result

The merged golden-corpus case has not run on Windows. Its `~26s` / `~1.15x`
figure derives the old 25.9s standalone corpus timing plus the macOS
one-versus-twenty-fence measurement; the consumer explicitly reported
25.7s-77.8s isolated-run variance. The execution log and task note should say
one spawn remains and its Windows elapsed time is unmeasured, not that it
currently runs at approximately 26s.

## P3 - tk-0201's checked state contradicts its unclosed criterion

`tk-0201` is marked `checked` while still satisfying unchecked `ac-000c`;
the task note itself says one Mermaid case remains at flake margin and the
other five were not measured. `node harness/cli/bin/harness.js plan validate
docs/plans/077-windows-suite-portability/plan.dd.json --complete` reports this
as a contradiction. Keep the partial result visible without marking the
eight-case outcome complete (for example, leave tk-0201 open or split the
completed batching work from the unresolved outcome).

## Confirmed

- The FakeFs control seeds Windows-shaped keys and checks copied content, while
  the resolver fixture now builds a native file URL. The two causes of the ten
  skills failures remain separated and correctly classified as test-only.
- The Mermaid batch preserves all three parse properties: golden fixtures,
  importance-border regression, and TD-columns shape. `fencesUnder()` rejects
  an empty slice, so batching cannot silently make an assertion vacuous.
- Targeted changed suites pass: **139/139** across `flow-renderer`,
  `fake-fs`, and `skills`.
- No native Windows result was inferred from local test success.
