# Validate Harness Flow — Rules

- **Drive the setup skills, don't bypass them.** The assessment, the boot
  extension, and the retro must be produced by their respective skills
  (`eng-harness-0-harnessability-assessment`, `eng-harness-0-add-extension`,
  `eng-harness-4-retro` / `harness record retro`) — not hand-rolled. Hand-writing
  what a skill should produce defeats the dogfood. **Exception:** the governance
  doc (`.harness/engineering-harness.md`) *is* hand-written from the BIO template,
  because no `harness init` writer is shipped yet — that gap is itself a finding.

- **Never run the router conversationally.** `eng-harness-flow` is an interactive
  print-then-offer router; it cannot be driven headless. Drive its child setup
  skills directly, in the order the prompt lays out. The flow skill is reference
  only.

- **Independent verification is mandatory.** Re-check every step yourself —
  `harness doctor` / `harness help` / `harness boot` / reading the file — and
  never report a step succeeded solely on a skill's own claim. Prefer `--json` so
  you parse the Envelope (`status`, `error.code`, `next_action`, `data`) rather
  than scraping text.

- **Abandonment is a valid outcome, not a failure.** If harnessability is poor
  (grade D/E/F, or Operate-Today in the lowest band), stop after the assessment,
  report `verdict: ABANDONED` with a reason, and emit. Do not force a poor repo
  through the rest of the flow, and do not pick the next candidate yourself — the
  orchestrator/operator re-fires an alternate.

- **Honest statuses.** A boot verb that returns `degraded`/`unconfigured` (exit 2)
  with a `next_action` is correct behaviour, not a bug — only `bootRuns: false`
  if it crashed, never ran the repo, or lied about success.

- **Throwaway only.** All writes happen **inside `targetRepo`** (the clone) — the
  harness install, the governance doc, the boot extension, the assessment reports,
  the retro. **Never modify `$MINIH_PROJECT_ROOT`.** The orchestrator owns the
  clone's deletion.

- **Retros are surfaced, never auto-implemented.** Do not act on a retro's content
  or change the repo because of what a retro says. The **only** corrective change
  you may make mid-run is repairing a **broken record-write path** (e.g. `harness
  record` itself erroring) so the record can be written — and log that you did.

- **Capture friction at the moment of friction.** Every awkward step, missing
  flag, confusing error, undocumented requirement, or skill mis-wire goes in
  `retrospective.difficulties` (numbered `VF-NNN`, layer-tagged `project` |
  `minih`) — even if you found a workaround. This honesty is the whole point.
