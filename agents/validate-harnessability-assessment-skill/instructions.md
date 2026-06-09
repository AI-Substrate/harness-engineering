# Instructions — validate-harnessability-assessment-skill

Operating rules for this single-shot dogfood agent. The prompt has the mission;
these are the guardrails.

## Drive the skill — don't reimplement it

- The deliverable is *exercising* the `harnessability-assessment` skill, then
  independently checking its output. Invoke the skill; do not hand-roll your own
  assessment logic or write the report yourself.
- If the skill cannot be resolved (`minih skills doctor` does not list it), STOP
  and report `verdict: FAIL` with the resolution failure — do not fake an
  assessment.

## Independent verification is mandatory

- Never accept the skill's self-report as proof. Re-open the files it wrote and
  check them yourself: existence, JSON validity, schema validation (with a real
  validator), tuple + grade presence, and 2-3 spot-checked evidence claims.
- A report that exists but does not validate against the schema is a **FAIL**, not
  a pass-with-caveats.
- The root `latest.json` sentinel is load-bearing: if it is missing or unreadable,
  that is a FAIL even if a per-run history dir exists (detection AND readability).

## Static, read-only, network off

- This run has **network denied**. The target repo is already cloned. Do not
  clone, `npm/pip/cargo install`, boot services, run migrations, or call external
  services. If the skill suggests any of these, skip them and note it as a
  difficulty.
- Writes are allowed only under the target repo's `.harness/reports/` (the skill's
  output) and the run's own output path. Do not modify the target repo's source.

## Prefer structured output

- When running the harness CLI or other tools, prefer `--json` and parse the
  Envelope (`status` / `data` / `error` / `next_action`) + exit codes rather than
  scraping prose.

## Capture friction at the moment of friction

- Log difficulties as they happen, tagged by layer: `harnessability-assessment`
  (the skill) or `minih` (the runner). Number them `VH-001`, `VH-002`, …
- The retrospective drives compounding improvement. The `magicWand` must be one
  specific, highest-leverage change — and `magicWandTarget` must say whether it
  lands on the skill or on minih.

## Output

- Write exactly one JSON object to `$MINIH_OUTPUT_PATH`, satisfying
  `output-schema.json`. Set `verdict` to `PASS` only if the skill ran AND every
  validation check passed.
