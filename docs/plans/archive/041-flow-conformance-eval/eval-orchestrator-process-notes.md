# Eval-Orchestrator Process Notes (skill seed)

Running notes on **the process the eval/orchestrator agent uses** to drive a
flow-conformance run end-to-end. Captured live during run 003 (Sonnet 5 @ xhigh)
so it can be baked into a skill. This is the *reusable playbook*; per-run findings
(F1–F16) live in the numbered experience logs.

> **North star**: the orchestrator IS the eval agent. It owns the deliverable,
> drives the blind subject through the whole cadence, makes every orchestrator
> decision itself, and does **not** ask the principal for routine stage gates.
> (See memory `eval-agent-drives-autonomously`.)

## Actors (keep them straight)
- **flow-eval extension** — read-only scorer (`harness flow-eval score`). Never drives pij.
- **orchestrator (me)** — drives the subject over pij; the "human-driven" coordinator.
- **subject** — blind peer; creates its own worktree, builds, reports per its packet.

## The procedure (top to bottom)

### 0. Pre-flight hygiene (BEFORE spawn) — F12
- Remove stale eval worktrees + branches + any leaked plan dir, or the next subject
  *resumes* prior finished work and the run is invalid:
  `git worktree list | grep <slug>` → `git worktree remove --force <wt>` →
  `git worktree prune` → `git branch -D <branch>`. Confirm no `docs/plans/<n>-<slug>`
  leaked into the MAIN tree (subject plan dirs must be untracked-in-worktree only).
- Confirm the working tree is clean of *other* sessions' work; never touch it.

### 1. Resolve the model id from the AUTHORITATIVE source — F15
- A model id you don't recognise may be **real and post-your-cutoff**, not a typo.
  Verify against the `claude-api` skill (authoritative), NOT training memory and NOT
  `pij models` (its registry is stale; it WARNS "unknown model … did you mean" on
  models that actually run). Two stale sources agreeing is not truth.

### 2. Spawn
- `pij spawn --harness <claude|copilot|…> --model <id> [--effort <low|…|xhigh|max>]`.
- The "unknown model" warning is non-fatal — the string passes through to the CLI;
  the **canary** (step 3) is the real test.
- Wait for the daemon's ready→bound push (don't tight-poll).

### 3. Canary-verify the model (a ready-ping is NOT proof)
- `pij send <id> "Canary: reply with the exact model id you are running, nothing else."`
- Confirm: exact expected model id + session alive + **no 400**. Catches silent
  mis-spawn / fallback. Mark healthy only then.

### 3b. State the REPORT CONTRACT — every message, not once — F18
- A control-plane peer (Claude Code / copilot over the `pij` CLI + daemon) has **no
  automatic content back-channel**: the daemon pushes only liveness (`done` /
  `stalled` / `dead`), never the peer's reply *text*. A subject on the pi-peer mental
  model finishes in its own pane and goes idle — the orchestrator gets nothing and is
  forced to `tmux capture-pane`-scrape every turn.
- So **every** orchestrator→subject `pij send` must carry the report contract:
  *"I only receive what you PUSH; reply at every gate via `pij send <my-orch-id>
  \"<report>\"`."* Name your own pij id explicitly. Repeat it each message — compaction
  wipes a one-time instruction, so a once-in-the-packet statement is gone by
  implement-time. Bake the contract line into the send template so it can't be
  forgotten.

### 4. Deliver the BLIND packet
- Strip the reviewer-only gate; deliver only above-the-rule content:
  `sed '/REVIEWER-ONLY/,$d' prompts/subject.md | sed '/<!--/,/-->/d'`.
- No method / stage / skill / measurement names leak.
- Stamp a wall-clock anchor (`date -u +%FT%TZ`) — telemetry doesn't expose duration
  yet (F13), so time = first→last event `t` span + orchestration stamps.

### 5. Process steer — cadence only, orchestrator voice — F16
- Speak as the **human-DRIVEN orchestrator**; NEVER claim to BE a human. The packet
  already legitimises the pij channel as the orchestrator link; asserting separate
  "human" authority over that channel reads as social engineering to a
  security-aware model and it will (correctly) refuse.
- **Separate method from process**: "method/architecture is entirely yours;
  the orchestrator coordinates *cadence* only." Otherwise it contradicts the
  packet's "no prescribed method" line and the subject flags the inconsistency.
- Ask the subject to **check in at each stage boundary and await 'proceed'**
  (post-explore / post-plan / post-validate / pre-build). These check-ins are the
  orchestrator's control points to hold the load-bearing choreography.

### 6. Drive the cadence (autonomously)
- **Load-bearing steers** (scenario choreography, scored): plan must be **Simple**
  (A2); **compact BEFORE implement** (A5). The subject is blind to these — the
  orchestrator must inject them at the right boundary.
- At every check-in, **verify the artifact exists before advancing** (never
  fabricate): dossier file, `<slug>-plan.md`, `the-flow.json`, etc. Read the load-
  bearing part (e.g. the plan's validation design) — don't rubber-stamp a report.
- Answer each gate yourself with an orchestrator-voice `pij send … proceed`,
  reiterating method-is-yours. Don't ask the principal.

### 7. Recovery patterns (diagnose before nudging)
- **"Stalled" push** → could be deep xhigh thinking, a hanging bash command, a
  backgrounded-pane wedge, or an **interactive prompt** (e.g. a trust menu). Look
  first: `tmux capture-pane -t <pane> -p`. Don't blind-nudge.
- **Trust/permission menu** → answer as the legitimate orchestrator: `tmux send-keys
  -t <pane> <choice>`; then fix the framing that caused it (F16).
- **Pane wedge** (copilot esp.) → SIGWINCH redraw-nudge: `tmux resize-pane …`.
- **Death notices for peers not mine** → ignore (only my orchestrator + my subject
  matter).

### 8. Score (read-only; the evaluator never drives pij)
- Collect `$SUBJECT` (pij id = telemetry join key) + `$WORKTREE`.
- Resolve per-run placeholder assertions (A7 verb-help, A8 PDF validator) with the
  subject's *real* reported commands; restore after.
- `harness flow-eval score --scenario <slug> --session $SUBJECT --worktree $WORKTREE`
  → `report.{json,md}`. Check `data.telemetry.available`; `unknown` ≠ subject failure.
- Fill judged fields (A11 backpressure quality) against evidence + worktree.

### 9. Teardown
- `pij close $SUBJECT`; then the F12 hygiene (remove worktree + branch). Leave
  *provided* peers alone.

## Stop→fix→start-over (the governing loop)
If the run goes off-track (contamination, wrong model, leaked method, a real
conformance gap in the harness), **stop, fix the root cause, restart** — and log the
finding. This is the fast feedback loop on the-flow + eng-harness-flow themselves;
the dogfood finding IS a deliverable.
