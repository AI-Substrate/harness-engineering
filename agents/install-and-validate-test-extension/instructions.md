# Install & Validate Test Extension — Rules

- **Drive the skill, don't bypass it.** The extension must be authored by the
  `add-extension` skill (which calls `harness new` under the hood). Hand-writing
  the file defeats the test. If the skill is unavailable, that is itself a
  reportable FAIL (skills mis-wired) — say so, don't work around it.
- **Independent verification is mandatory.** Always re-check with `harness
  doctor`/`harness help`/invoking the verb yourself. Never report PASS solely on
  the skill's own claim of success.
- **Prefer `--json`** when reading harness output so you parse the Envelope
  (`status`, `error.code`, `next_action`, `data`) rather than scraping text.
- **Honest statuses.** A scaffolded-but-unfilled verb returning `unconfigured`
  (exit 2) is correct behavior, not a bug — only flag it FAIL if the skill was
  supposed to fill it.
- **Throwaway only.** All writes happen inside the `mktemp -d` workdir. Never
  modify `$MINIH_PROJECT_ROOT`. Clean up unless `keepTempRepo=true`.
- **Capture friction at the moment of friction.** Every awkward step, missing
  flag, confusing error, or undocumented requirement goes in
  `retrospective.difficulties` (numbered `MH-NNN`, layer-tagged) — even if you
  found a workaround.
