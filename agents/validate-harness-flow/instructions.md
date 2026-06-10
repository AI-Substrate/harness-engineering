# Validate Harness Flow — Rules

- **What the harness's skills produce must be produced by driving those
  skills, not hand-rolled.** Hand-writing an artifact a skill exists to
  produce defeats the dogfood — the test measures whether the product's own
  path works, not whether you can imitate its outputs.

- **Never drive an interactive router headless.** A skill that is a
  print-then-offer conversation for a human cannot be run by you. Use the
  skills that do the work directly.

- **Independent verification is mandatory.** Re-check every step yourself —
  `harness doctor` / `harness help` / running the verb / reading the file —
  and never report a step succeeded solely on a skill's own claim. Prefer
  `--json` so you parse the Envelope (`status`, `error.code`, `next_action`,
  `data`) rather than scraping text.

- **Abandonment is a valid outcome, not a failure.** If the assessment you ran
  concludes the repo is poorly harnessable, stop, report `verdict: ABANDONED`
  with a reason grounded in that assessment's own report, and emit. Do not
  force a poor repo through the rest of the flow, and do not pick the next
  candidate yourself — the orchestrator/operator re-fires an alternate.

- **Honest statuses.** A boot verb honestly reporting a degraded or
  unconfigured state (with a `next_action`) is correct behaviour, not a
  failure — only report `bootRuns: false` if it crashed, never ran the repo,
  or lied about success.

- **Throwaway only.** All writes happen **inside `targetRepo`** (the clone).
  **Never modify `$MINIH_PROJECT_ROOT`.** The orchestrator owns the clone's
  deletion.

- **Retros are surfaced, never auto-implemented.** Do not act on a retro's
  content or change the repo because of what a retro says. The **only**
  corrective change you may make mid-run is repairing a **broken record-write
  path** (e.g. `harness record` itself erroring) so the record can be written
  — and log that you did.

- **Capture friction at the moment of friction.** Every awkward step, missing
  flag, confusing error, undocumented requirement, or skill mis-wire goes in
  `retrospective.difficulties` (numbered `VF-NNN`, layer-tagged `project` |
  `minih`) — even if you found a workaround. This honesty is the whole point.
