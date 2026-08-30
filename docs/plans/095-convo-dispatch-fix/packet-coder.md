# packet-coder — s095 HOTFIX: convo sync dispatches a refused command and reports fired

role: coder · branch s095/convo-dispatch-fix · worktree THIS one · prime: pij-massive-meadowlark
Rituals: government/how-we-work.md — numbered ack first, 60-implement SIMPLE MODE,
receipts-or-not-done. URGENT: three repos are enabling this feature today and every
fire currently false-greens.

## Root cause, MEASURED (do not re-derive, do verify)
acts/convo.ts ~207: FlowspaceCliAdapter.ingest appends `--pij <id>` alongside
`--harness/--session`. flowspace3 REFUSES the combination: "the argument
'--harness <HARNESS>' cannot be used with '--pij <SEAT>'" (usage, exit 2). The
detached child dies instantly; the envelope still says fired. Reproduction: this
repo, .harness/temp/convo-sync.log carries the refusal; read-back delta = 0 while
a direct `flowspace3 conversation ingest --harness claude --session <id>` adds
turns. Dajeil (dd prime) has an independent live repro, +56-turn delta.

## Fix, two parts, both required
1. ARGV: never send --pij with --harness/--session. Identity resolved to
   harness+session (explicit or registry) → those two + --folder ONLY.
2. DEAD-ON-ARRIVAL DETECTION: a detached child that exits nonzero within a short
   grace (~250ms) must flip the envelope to DEGRADED with status
   'dispatch-failed', naming the logPath it wrote — the current ok+dead-child is
   'silence plus ok', indistinguishable from working (dajeil's phrasing; the
   packet's law). A child still alive after grace keeps today's honest
   fired/not-verified ok. Do NOT block longer than the grace; the seams must stay
   fast and silent-on-disabled.

## Done-bar
RED: a test proving the current argv is the REFUSED combination (assert against
the recorded fs3 grammar: harness+session+pij together = the bug) and a test
where the fake child dies instantly yet status reads fired — both must FAIL
after the fix in their old expectation and be rewritten to the new contract.
GREEN + mutation (restore --pij append → argv test red; remove DOA detection →
DOA test red). Full suite + just fix. LIVE receipt: in THIS worktree run the
built binary against the real repo session with read-back delta >0 (this repo's
settings are enabled on main; the conversation is huge and grows constantly, so
delta will be nonzero) — the discriminator dajeil taught us, as a receipt.

## Forbidden
government/** · the-flow files · push · merge · other worktrees · fs3 daemon
lifecycle · anything beyond acts/convo.ts, services/convo/*, their tests.
