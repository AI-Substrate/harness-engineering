# Phase 4 round-four review — APPROVE

**Reviewer**: `pij-varied-pennyroyal` (terra)  
**Commit reviewed**: `67595344`  
**Scope**: null-device spelling for the two remote-telemetry
`GIT_CONFIG_GLOBAL` sites (#108)

## Review result

No blocking findings.

The implementation, commit body, and test names hold the required confidence
boundary. They establish only the locally testable mapping and wiring:
`nullDeviceForPlatform('win32')` emits `NUL`. Git's acceptance of that spelling
remains explicitly attributed to the downstream report, expected and
unverified; the diff does not claim Windows isolation has been restored.

## Review evidence

- A `harness/cli/src` enumeration found `GIT_CONFIG_GLOBAL` only in the two
  reviewed sites in `exec-remote-telemetry-git.ts`. The source-text guard is
  intentionally adapter-local, and its commit-body claim is equally local; it
  does not overclaim protection for a future different adapter.
- Mutation evidence was rerun against the new five-case suite:
  - both source sites reverted to `devNull`: **3 failed / 2 passed**;
  - only `safeGitEnvironment` reverted: **2 failed / 3 passed**, including its
    separately named site assertion;
  - only `safeCredentialConfigEnvironment` reverted: **2 failed / 3 passed**,
    including its separately named site assertion.
  The source was restored exactly after the mutation cycle.
- The new helper and two environment builders are exported only from the
  internal adapter module, not the package entry point. With the injected
  platform seam, this is the smallest production-visible surface that lets the
  two actual environment builders be tested without host-platform stubbing.
- The corrected integration assertion would fail on Windows if it still
  expected `devNull`; its expected value now follows the host mapping. The
  dedicated simulated-platform suite independently proves that mapping and
  both builder call sites, so the integration assertion is not the only
  evidence nor a tautological replacement.
- All three deliberate `'/dev/null'` test literals retain their stated
  behavior and are comment-only changes. Their real-Git, unguarded Windows
  execution is the available evidence for treating a missing config file
  differently from the reported device-path case.
- Targeted adapter suites passed **96/96**. `arch-check --json` remains at the
  known **2** warn-severity violations; this commit adds none.

## Confidence boundary

No native Windows or Git config-path outcome was observed in this review. The
approved claim remains: the adapter now emits the spelling Git is reported to
accept on win32.
