# Phase 1 review — git-ai collector v1

**Verdict: REJECT**

## Findings

### P0 — The collector is not reachable from the shipped CLI

`harness/cli/src/acts/doctor.ts:37-53` constructs `DoctorDeps` without
`collectorHost` or `hash`. Consequently,
`harness/cli/src/services/doctor/doctor-service.ts:1022-1024` omits the only
collector doctor row in every real invocation. There is also no real
`DownloadPort`/`ExecutableBitPort` adapter, no doctor option that calls
`installCollector`, and no command that calls `recheckCollector` or
`regenerateGitAiPin`.

**Failure scenario:** a developer runs `harness doctor` on a clean machine. It
has no collector row, never downloads the pinned binary, never evaluates the
trace2 guard, and cannot report an unhooked new agent. All collector tests pass
because they invoke isolated service functions with fake dependencies, but no
production path can exercise the feature.

**Fix:** complete the composition and command surface before merge: construct
the real host/hash/http/executable dependencies, wire the health row into
`registerDoctorAct`, and expose the lifecycle actions through an explicitly
reviewed doctor/collector command contract. Add an act-level test that proves
the default doctor row is present and lifecycle execution uses injected,
offline fakes.

### P1 — The alleged post-install trace2 verification never affects the result

`harness/cli/src/services/doctor/collector/install.ts:227-238` reads and
records the post-install trace2 state, but `:240-251` unconditionally records
`hooks.status: 'installed'` after any zero exit. It does not require the
expected git-ai trace2 configuration to be present, nor turn an unreadable,
empty, or unexpected post-read into a warning/failure.

**Failure scenario:** `git-ai install-hooks` returns zero but does not install
hooks or leaves trace2 empty/unexpected. Doctor records the hooks as installed,
and later health can report `healthy`, despite the exact verification promised
by the dogfood finding never succeeding.

**Fix:** validate the post-read against the expected installed trace2 shape and
record a non-healthy hook state plus a warning when it is absent, unreadable, or
unexpected. Add a test with a zero-exit installer followed by an empty/unknown
post-read; it must not produce `installed`.

### P2 — Three additional real-git commit fixtures remain exposed to git-ai

The fix in
`harness/cli/test/adapters/git/exec-remote-telemetry-git.int.test.ts` correctly
sets `GIT_TRACE2_EVENT=0`, but it is not the only fixture that performs a real
commit under the ambient global configuration:

- `harness/cli/test/adapters/git/fake-git.test.ts:107-119`
- `harness/cli/test/adapters/git/cat-file-batch.int.test.ts:26-28,61-66`
- `harness/cli/test/services/telemetry/git-read.test.ts:388` (its
  disposable-repo helper invokes `git commit -qm init`)

**Failure scenario:** after git-ai hook installation, these fixtures inherit
the global trace2 target. Its daemon can write `refs/notes/ai` into their
throwaway repositories, making caller/ref-purity assertions timing-dependent
or leaving external attribution behind during tests.

**Fix:** use one shared hermetic real-git environment for all disposable
fixtures: disable `GIT_TRACE2_EVENT`, `GIT_TRACE2`, and `GIT_TRACE2_PERF`, and
isolate global Git config where the test does not specifically exercise it.

## Jordan's standing checks

1. **Every new test must run in CI:** The new collector tests use fake
   filesystem, HTTP, executable, clock, and exec ports; they require neither a
   installed `git-ai`, daemon, writable real `~/.gitconfig`, agent, nor trace2
   socket. `just checks` completed with `tests:ok`; the observed degraded
   baseline is unchanged: arch-check 2, markdown-lint 196, windows-check 6.
   The P2 fixture isolation issue above is a local installed-git-ai landmine,
   not a CI dependency in the new collector unit tests.
2. **No new dependencies:** Confirmed. The three reviewed commits do not
   modify `package.json`, lockfiles, or add a downloaded fixture.
3. **No network at test time:** Confirmed for the new collector tests.
   `FakeDownload` supplies all release responses; the only real hash used is
   Node's existing crypto-backed `NodeHash`. No test fetches the pinned release.

## Declared deviations

1. **No dry-run probe:** Verified. The only install invocation is exactly
   `['install-hooks']` at `install.ts:187-190`; no alternate dry-run spelling is
   passed. However, the re-read is recorded rather than verified, which is P1.
2. **Omitted composition row:** Not honest enough to accept. Omitting a row
   until a composition root supplies dependencies makes the shipped doctor
   indistinguishable from one that has no collector feature, which is the P0
   release blocker.
3. **`manifest` naming:** Verified. `types.ts` records the existing
   `pin-knob-src-usage` identifier constraint and confines `manifest` to this
   collector domain.
4. **Skills:** Do **not** automatically invoke `install-hooks` with either
   skills mode pending a human ruling or an upstream non-destructive contract.
   Without `--skills`, every invocation runs `uninstall_skills` and can remove
   same-named user content; with it, the documented installation collision can
   remove a real directory. Silent deletion is unacceptable in either direction.
   If automatic installation remains required, require upstream collision-safe
   behavior first; otherwise disclose the exact command for the user to run.
5. **Unedited plan contract:** Verified. The three reviewed code commits do
   not edit `plan.dd.json`; the deferred collection-proof gap remains recorded
   as `ac-0012`.

The known real-git trace2 block-branch gap is acknowledged in the packet and is
not reported as a new finding.

## Round 2

**Verdict: REJECT**

### P0 — The trace2 re-install exception can destroy a user-authored config

`harness/cli/src/services/doctor/collector/trace2.ts:60-74` allows a present
trace2 section when the entries merely have git-ai's two *key names* and
`priorInstallVerified` is true. `install.ts:184` derives that predicate only
from `state.hooks.status === 'installed'`. The state is a workspace-local,
gitignored JSON file (`state.ts:93-95`) that `readCollectorState()` accepts
after checking only its schema plus the presence of `cli` and `hooks`
(`state.ts:132-141`); it is neither bound to the current home/global Git
configuration nor cryptographically/verifiably tied to the installation it
describes.

**Failure scenario:** Harness successfully installs once. Later the operator
sets their own `trace2.eventTarget` to any value (or independently manages
exactly `eventTarget` and `eventNesting`) and a new coding harness triggers
`harness doctor --recheck-collector`. The key-only test accepts the
user-authored value because the old state still says `installed`, then
`git-ai install-hooks` deletes the whole global `trace2` section. Copying or
editing the unvalidated state file produces the same result without even a
prior installation in that workspace.

This contradicts the claimed invariant that the exception only overwrites
config Harness put there, and erodes Jordan's ruling that doctor never destroys
a trace2 config. The case distinction cannot establish ownership of a mutable
global Git value from its key name plus an old local record.

**Fix:** revert this exception and restore observed-empty as the sole automatic
path. Re-scope `ac-0010` so a post-install recheck with existing trace2 emits
manual instructions rather than invoking `install-hooks`. Reintroduce an
automatic re-install only if git-ai supplies a non-destructive, provenance-safe
operation; a state-file heuristic is not sufficient.

### P1 — Post-install verification accepts a prefix rather than the exact key

`harness/cli/src/services/doctor/collector/trace2.ts:118-120` uses
`startsWith('trace2.eventtarget')`. It consequently declares
`trace2.eventtarget_custom` or `trace2.eventtargetanything` as proof that
git-ai wrote the exact `trace2.eventtarget` key. This is not the same
delimiter-aware comparison used for the re-install allowlist at `:72-74`.

**Failure scenario:** a concurrent/global-config writer leaves a
`trace2.eventtarget_custom` entry after a zero-exit hook invocation. The
collector records `installed` although its stated proof was not present,
creating the stale record which also feeds the P0 exception.

**Fix:** parse the `key=value` output and compare the lowercased key exactly
with `trace2.eventtarget` (or require a whitespace/`=` delimiter). Add a
near-prefix regression test. The re-install allowlist itself correctly handles
Git's lowercased names through its case-insensitive, delimiter-aware regex; a
future third git-ai trace2 key fails closed, which is safe.

### Closed findings and new guard review

- **P0 from Round 1:** closed. `registerDoctorAct` composes the real
  collector host/hash and explicit lifecycle flags; the registered-command
  tests prove plain doctor remains side-effect-free and lifecycle tests use
  offline fakes.
- **P1 from Round 1:** closed. A zero-exit invocation with absent/unreadable
  post-install trace2 now records `unverified`, not `installed`.
- **P2 from Round 1:** closed. The shared hermetic environment is used by the
  named real-Git fixtures, and `vitest.config.ts` exports the three trace2
  disables to spawned test subprocess environments. The deliberate global
  config test fixture retains trace2 isolation.
- **Skills guard:** accepted. `NodePathKind` uses `lstatSync`, preserving both
  regular and broken symlinks as `symlink`; `UNKNOWN` blocks; and
  `CLAUDE_CONFIG_DIR` flows through the composition root into all nine guarded
  paths. The install path refuses to invoke `install-hooks` when any guarded
  path is not absent/symlink.

## Jordan's standing checks — Round 2

1. **Every new test must run in CI:** The lifecycle tests use injected fakes;
   no installed git-ai, daemon, agent, writable real global config, or trace2
   socket is needed. The adapter integration test binds a loopback-only HTTP
   server; that is not an external network request and is a normal CI
   capability.
2. **No new dependencies:** Confirmed. No dependency manifest or lockfile
   changes were introduced.
3. **No network at test time:** Confirmed for external resources. Fake
   downloads cover collector service tests; the adapter test only exercises
   `127.0.0.1` and does not contact the network.

`just checks` completed with the stated baseline only: arch-check 2,
markdown-lint 196, and windows-check 6 warn-launch findings; all other gates
passed.
