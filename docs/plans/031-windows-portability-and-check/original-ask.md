# Original ask — windows-portability-and-check
**Captured**: 2026-06-19T02:31:37Z  ·  **By**: /the-flow

> get a flow set up for this then run the explore phase

**Context for "this"** *(not the user's words — captured so the ask is self-contained):*
"This" is the Windows-compatibility work surfaced by an upstream handover from a
downstream fork (`scratch/paste/20260619T021244.md`, analyzed earlier this session). Two
deliverables, treated as one Windows-hardening track:

1. **Re-add the Windows-portability layer** to the `validate-harness-flow` dogfood
   verb (`.harness/extensions/validate-harness-flow/`) that the fork dropped during
   its `026` port — the verb is currently POSIX-only (`bash`/`nohup`/`mkdir -p`/`cp`/
   `sleep`/`printf`/`realpath`/`/tmp`, `git clone` without `core.longpaths`) and is
   completely non-functional on Windows, including the CWE-59 confine guard which
   silently degrades to "skip every copy". Preserve the new security/feature work
   (CWE-59 guard, `--global`, injection-safe argv) **and** make it cross-platform.
   The near-identical sibling verb `validate-harnessability` shares the same breakage.

2. **Add a deterministic `windows-check` extension** — a repo-local dogfood verb that
   statically scans the source for known Windows-compat hazards (non-portable
   shell-outs, hardcoded `/tmp`, `git clone` without `core.longpaths`, path-splitting
   on a bare separator, extensionless node-CLI spawns, POSIX env assumptions), maps
   findings to an honest envelope (warn-launch), and wires into `just fft` + CI on
   ubuntu — proving Windows compatibility "by construction" with **no Windows CI**,
   consistent with the already-shipped plan 017 posture.

Prior art: plan `017-windows-cross-platform-fixes` (CLI path-separator/package-smoke
fixes, VALIDATED — distinct, closed scope). Related downstream PRs the handover
flags: #24 (cmd-quoting, already converged upstream in
`harness/cli/src/adapters/exec/windows-command.ts`) and #26 (`harness.python`
per-repo override, genuinely net-new, not upstream).
