# Windows arm — plan 082 — start here

**Status 2026-08-10: closed out for shipping.** Everything below is measured; the open items are
listed at the bottom and are deliberately *not* blocking.

## Read in this order

1. **[`METHOD-how-this-was-run.md`](./METHOD-how-this-was-run.md)** — the environment, how
   commands were driven into a Parallels VM, the quoting/latency/ASCII traps, how the harness was
   built and deployed, how Cursor was driven, and **five probes that measured the wrong thing**.
   Read this before running anything on that box.
2. **[`knownhuman-attestation-decides-attribution.md`](./knownhuman-attestation-decides-attribution.md)** —
   THE FINDING. A human line survives only if a `KnownHuman` attestation exists for it. Includes
   the macOS counterexample that falsified an earlier, simpler headline before it shipped.
3. **[`hook-parse-observable-brief.md`](./hook-parse-observable-brief.md)** — the defect found and
   fixed on the way: Cursor prepends a UTF-8 BOM on Windows, our parser did not strip it, and the
   hook died **silently** because the journal was built *after* the guards it returned at.
4. **[`same-file-mixed-commit.md`](./same-file-mixed-commit.md)** and
   **[`ordering-experiment.md`](./ordering-experiment.md)** — the two experiments that eliminated
   edit mechanism, ordering and adjacency.
5. **[`machine-and-method-facts.md`](./machine-and-method-facts.md)** — reusable facts, the
   `harness doctor` output, machine state, and **the way back** if a deploy goes sideways.
6. **[`deploy-runbook.md`](./deploy-runbook.md)** — build → pack → deploy → verify by behaviour.

## What was established

**Our chain works end-to-end on Windows** — first time. Hook fires → UTF-8 BOM stripped → payload
parsed → repo resolved → commit classified → written to a **live** daemon → note produced. It
also fails *honestly*: stop the daemon and the pipe vanishes, `connect` returns `ENOENT`, and the
relay journals `failed: absent` rather than a false `emitted`.

**Attribution is wrong when no `KnownHuman` attestation exists for the human's lines** — which on
Windows is always, because **`KnownHuman` has never once been recorded there** (0 of 28
checkpoints), despite git-ai's VS Code extension being installed. That is git-ai's commit-time
recovery and attestation model, not our relay. Eliminated by measurement: the Cursor sandbox, our
relay emitting vs staying silent, edit ordering, adjacency, the agent's edit mechanism, and
same-file vs cross-file.

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

- Whether the daemon **acts on** our six synthetic events — they reach a live listener, but we
  have not shown one produced a note git's own trace2 could not have.
- **Why git-ai's `KnownHuman` path never fires on Windows** — the extension is installed and
  never produces one. Highest-value open question.
- The third outcome shape (human line **unclaimed** rather than claimed) was seen once.
- macOS/Windows comparison of what produces a `KnownHuman` attestation.
- `validate-attribution` cannot run in the guest (`E149`) and its parser drops `unparseable`.
