# Original ask — telemetry-fixture-corpus
**Captured**: 2026-06-25  ·  **By**: /the-flow

> we need better test harness / fixtures to valdate the data we produce and to
> help us work on future stuff. we need to collect real copilot cli, gh vscode,
> claude and cursor logs and save them as fixtures in this repo then we can write
> tests so our system reads those and produces desired outputs. do your researc
> then plan back to me my ask i a single paragraph before we start work

## Clarifications locked in-session (2026-06-25)

> yes we can cap from thsi machine, we should just scrub them yeah, remove
> machine paths and things... but can keep full tool usage and prompts etc.
> (check em for anythign bad though)

Resolved scrub policy (the crux of the work):

- **Capture source**: real sessions from *this* machine — all four surfaces confirmed
  present here (`~/.claude/projects/*`, `~/.copilot/session-state/*` + `process-*.log`,
  `…/github.copilot-chat/session-store.db`, `…/Cursor/User/globalStorage/state.vscdb`;
  cursor agent transcripts persist on disk at `~/.cursor/projects/<cwd>/agent-transcripts/<conv>/<conv>.jsonl`
  — `AGENT_TRANSCRIPTS` being unset only blocks the runtime adapter's auto-detect, not capture, so
  cursor is a real capturable surface [corrected 2026-06-25]).
- **Keep verbatim**: full prompt text + tool-usage/commands, so the fixtures exercise the
  counts-only adapters end-to-end (and prove they strip what they don't emit).
- **Scrub (mechanical)**: machine paths / home dirs → placeholders, emails, real names,
  API keys / tokens / secrets.
- **Scrub (manual, non-skippable)**: an eyes-on "check em for anything bad" review of every
  captured fixture before commit — these land in a **public** repo, permanently in git history.
