# Windows arm — plan 082 — start here

**Status 2026-08-10: closed out for shipping.** Everything below is measured; the open items are
listed at the bottom and are deliberately *not* blocking.

## Read in this order

1. **[`METHOD-how-this-was-run.md`](./METHOD-how-this-was-run.md)** — the environment, how
   commands were driven into a Parallels VM, the quoting/latency/ASCII traps, how the harness was
   built and deployed, how Cursor was driven, and **five probes that measured the wrong thing**.
   Read this before running anything on that box.
2. **[`vendor-support-status-non-wsl-experimental.md`](./vendor-support-status-non-wsl-experimental.md)** —
   **READ THIS BEFORE QUOTING ANY WINDOWS CLAIM.** git-ai labels non-WSL Windows **experimental
   and not production-ready**, and Cursor runs its Windows sandbox inside WSL2. Two vendors, same
   boundary: **"Windows" is not one platform for this feature.** Also records a Cursor hook-error
   log we never used, and a stale vendor doc.
3. **[`root-cause-extension-cannot-find-git-ai.md`](./root-cause-extension-cannot-find-git-ai.md)** —
   **THE ROOT CAUSE.** git-ai's extension spawns the bare string `git-ai`, which is on **no PATH**
   on that box, so `KnownHuman` is never recorded and the human sweep is then skipped at commit
   time. Includes a falsifiable one-line fix prediction.
4. **[`knownhuman-attestation-decides-attribution.md`](./knownhuman-attestation-decides-attribution.md)** —
   THE MECHANISM. A human line survives only if a `KnownHuman` attestation exists for it. Includes
   the macOS counterexample that falsified an earlier, simpler headline before it shipped.
5. **[`hook-parse-observable-brief.md`](./hook-parse-observable-brief.md)** — the defect found and
   fixed on the way: Cursor prepends a UTF-8 BOM on Windows, our parser did not strip it, and the
   hook died **silently** because the journal was built *after* the guards it returned at.
6. **[`same-file-mixed-commit.md`](./same-file-mixed-commit.md)** and
   **[`ordering-experiment.md`](./ordering-experiment.md)** — the two experiments that eliminated
   edit mechanism, ordering and adjacency.
7. **[`cursor-sandbox-not-on-native-windows.md`](./cursor-sandbox-not-on-native-windows.md)** —
   why the Cursor UI offers "Allowlist (with Sandbox)" on macOS and only "Allowlist" on Windows,
   vendor-sourced: **there is no native Windows sandbox; on Windows it runs inside WSL2.**
   Consequence: **the relay's rescue path has never been exercised on Windows**, because the
   condition it rescues from does not occur there.
8. **[`machine-and-method-facts.md`](./machine-and-method-facts.md)** — reusable facts, the
   `harness doctor` output, machine state, and **the way back** if a deploy goes sideways.
9. **[`deploy-runbook.md`](./deploy-runbook.md)** — build → pack → deploy → verify by behaviour.

## What was established

> **PLATFORM QUALIFIER — read `vendor-support-status-non-wsl-experimental.md` before quoting any
> of this.** The machine is **non-WSL Windows**, which **git-ai labels experimental and not
> production-ready**, and where **Cursor has no sandbox** (it runs the sandbox inside WSL2). Every
> finding below is measured and stands — but "broken on Windows" should be stated as **"broken on
> the platform neither vendor has declared production-ready."** WSL2 is untested here and is the
> obvious next measurement.

**Our chain works end-to-end on Windows** — first time. Hook fires → UTF-8 BOM stripped → payload
parsed → repo resolved → commit classified → written to a **live** daemon → note produced. It
also fails *honestly*: stop the daemon and the pipe vanishes, `connect` returns `ENOENT`, and the
relay journals `failed: absent` rather than a false `emitted`.

**But the relay's RESCUE path was never exercised there.** Cursor has **no native Windows
sandbox** — vendor-documented, WSL2-only — so git's own trace2 always reached the daemon and no
commit was ever at risk. Every Windows measurement here is the pass-through case. That is a scope
fact, not a defect, and it must travel with any Windows claim.

**Attribution is wrong when no `KnownHuman` attestation exists for the human's lines** — which on
Windows is always, because **`KnownHuman` has never once been recorded there** (0 of 28
checkpoints). **Root cause found:** git-ai's extension spawns the bare string `git-ai`, which is
on **no PATH** on that box, so the save-time attestation dies `ENOENT` every time; at commit time
the human-recovery sweep then skips itself whenever an AI claim landed and no `h_` exists. **The
binary, preset and daemon leg all work on Windows** — verified by positive control. Eliminated by
measurement: the Cursor sandbox, our relay emitting vs staying silent, edit ordering, adjacency,
the agent's edit mechanism, and same-file vs cross-file.

**Two code changes shipped from this work**, both in the harness:

- strip the UTF-8 BOM before parsing (matching git-ai's `strip_utf8_bom`), and **journal an
  `unparseable` outcome** so the hook can describe its own failure — commit `46b0dd00`
- remove the `index-was-not-clean` guard: it adjudicated whether a commit *deserved* attribution,
  which is not ours to decide. Measured effect on attribution: **none**, in either direction

## Guidance that came out of it

Now recorded in
[`docs/how/telemetry/gitai-05-attribution-algorithm.md`](../../../../how/telemetry/gitai-05-attribution-algorithm.md):

1. **Commit your own work yourself** from the Cursor UI. Agent-run commits claim human work.
2. **If the agent commits, use explicit pathspecs** — `harness commit "<msg>" -- <paths>`. It does
   not fix attribution but collapses the blast radius (9-of-10 minted claims → 0-of-1).
3. **Unclaimed is not human.** No note observed here has ever carried both an `s_` and an `h_`.

## Open, and deliberately not blocking

- **Why git-ai's `KnownHuman` path never fires on Windows** — **ANSWERED**, see
  [`root-cause-extension-cannot-find-git-ai.md`](./root-cause-extension-cannot-find-git-ai.md).
  The falsifiable fix (put `%USERPROFILE%\.git-ai\bin` on the user PATH and restart Cursor) is
  **not yet run**.
- Whether the daemon **acts on** our six synthetic events — they reach a live listener, but we
  have not shown one produced a note git's own trace2 could not have. **On native Windows this may
  be unanswerable**: with no sandbox, git's own stream always arrives.
- **A WSL2 run** — the measurement that separates "non-WSL Windows is an incomplete port" from
  "Windows is broken", which are different findings with different owners.
- **The relay's rescue path on Windows**, which needs Cursor running through WSL2 or an
  artificially blocked ingress.
- The third outcome shape (human line **unclaimed** rather than claimed) was seen once.
- `validate-attribution` cannot run in the guest (`E149`) and its parser drops `unparseable`.
