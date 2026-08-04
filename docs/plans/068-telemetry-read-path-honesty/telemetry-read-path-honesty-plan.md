# Plan 068 — telemetry read-path honesty

Six bounded items making the read path degrade-and-name instead of throw,
fabricate, or stay silent. All are testable from data already in the repo or
on this machine; none touch `refs/harness-telemetry/*`. House rule throughout
(Jordan ruling, hardened last week in `output/envelope.ts`): **always warn,
never hide** — a surface degrades and names what it skipped, on both the human
and `--json` surface; it never dies and never quietly omits.

## Item 1 — BUG-1: the exit_code metric throw (data loss)

`telemetry session save <id> --source git-ref` permanently fails for some real
sessions (verified live: `71679da4-5249-4e02-9117-68a3abf3ed0e`, ref
`refs/harness-telemetry/2026/08/03/71679da4-…`) with
`E100 invalid producer metric set: harness.command.exit_code`.

Chain: `otlp/metrics.ts:141-147` keys the gauge on the single attr `CMD_VERB`;
`:362-364` emits one datapoint per `outcomes.exits` entry; `:206-218`
`validateMetricDataPointSet` fails on duplicate tuple identity; `:286-288`
(`checkedPoints`) **throws**. A read-path throw = the whole session is
unreadable — no report, no insights, no partial.

Fix: on tuple collision (or any single-metric validation failure), SKIP that
metric, record it via the `formatDegraded` idiom (see `acts/telemetry.ts`,
`acts/update.ts`, `acts/skills.ts` for the pattern), and return the rest.
Root-cause the collision too (which two verbs sanitize identically — fix the
sanitizer if that's the true bug) but the degrade-never-throw contract lands
regardless.

AC-1: session `71679da4` becomes readable end-to-end (save → report), with the
skipped metric NAMED in the degraded output; a unit test pins the collision
shape; the throw path is gone for metric-set validation.

## Item 2 — BUG-2: `t_precision` has zero consumers (dishonest time)

`t_precision` serializes (`otlp/logs.ts:568`) and deserializes (`:723-726`)
and is then read by NOTHING in `report.ts` / `rollup.ts` / `insights.ts`
(grep-verified; o-prime independently confirmed zero occurrences). Meanwhile
plan 066 emits file events at `t_precision: 'interval'` stamped with the
capture wall-clock — the gap classifier (`report.ts:620-638` area, and
`rollup.ts:47-50` `classifyGap` which never caps non-prompt gaps) treats them
as exact instants, silently accruing whole spans into `agent_working_s`, and
can trip insights §5's `active > wall` exclusion (`insights.ts:620-624`),
silently dropping the session from cohort rows.

Fix: exclude `'interval'`-precision events from active-time gap accrual (they
still count for everything non-temporal); surface an `interval_events` count
in report provenance so the exclusion is visible, not silent.

AC-2: a synthetic session where interval file events land far from anchored
turns shows byte-identical `totals.time_s` with and without those events;
provenance carries the count; existing fixtures (exact-timed) byte-identical.

## Item 3 — §8 path-only rendering (make vscode's evidence visible)

Post plan-066 phase 2, copilot-vscode sessions carry `files.written/edited`
path lists but (honestly) no `file` events — and both the report `authorship`
table (`report.ts:1128` ← `rollup.ts` `computeAuthorship`, events-only) and
insights §8 `files_written` (`insights.ts:1124-1194`, gated on `authorship`)
ignore path lists entirely, so the evidence is queryable but invisible.

Fix: extend the authorship surface to carry path-only entries explicitly
marked delta-unavailable (e.g. `lines: null` + a named reason, never zeros),
and teach §8 to render such rows with the caveat naming the missing
capability. Design freedom on the exact shape, but three hard rules: never
fabricate a number; delta-backed rows must remain byte-identical to today;
the marker must survive to both JSON and HTML surfaces.

AC-3: a vscode-shaped input (files lists, no file events) renders §8 rows with
the explicit unavailable marker; claude/cursor sessions' authorship output is
byte-identical to pre-change; schema files updated in the same commit as their
consumers (drift guards will enforce).

## Item 4 (rider) — telemetry ref-size sensor

The 17,566-file legacy ref sat undetected since June because nothing watches
ref tree size. Add a WARN-level check (fit it into the existing sensor/checks
surface where such repo checks live — follow the neighbouring patterns) that
lists any `refs/harness-telemetry/**` ref whose tree exceeds a threshold
(default 16 files — rolled refs have exactly 3). It must WARN and name
offenders, never fail the gate (the June ref is a known, o-prime-accepted
offender and will trip it forever by design — the sensor's job is making that
visible, not red).

AC-4: sensor lists the June ref in this repo; a rolled 3-file ref passes; the
checks summary shows it as degraded/warn, not error.

## Item 5 (rider) — fixture-scrub cursor-mangle gap

`fixture-scrub`'s `pathVariants` covers native/posix/Claude-mangled paths but
not Cursor's projects-dir mangle (`Users-<user>-<path>`, as in
`~/.cursor/projects/Users-jordanknight-substrate-…`). Identity is caught by
the bare-username sweep but the real directory structure survives verbatim.
Add the cursor mangle to `pathVariants` with a test using the real observed
form (found during 066 fixture minting).

AC-5: a cursor-mangled path in fixture input scrubs to the placeholder form;
existing scrub tests untouched.

## Item 6 (rider) — cursor `harness_session_id`

The cursor adapter returns `harness_session_id: null` while holding the
conversation id in hand (`CURSOR_CONVERSATION_ID`). Set it. One line + test.

AC-6: cursor segments carry the conv id as `harness_session_id`; serializer
allowlist already has the field (verify, don't widen).

## Out of scope, recorded here so they are not silently dropped

- **Pre-commit capture hook** — goes to the o-prime as a written proposal
  (fail-safe design: fast, exit-0-always, kill-switched) given the repo's
  hook-recursion history; orchestrator authors it in this dossier's follow-ups.
- **Checks/push-signature capture (all adapters)** — plan 069, next.
- **Cursor store.db protobuf** — deferred until the honest-null pain bites.

## Outcome (retrospective close, 2026-08-04)

All six items + the ruled pre-commit hook shipped in 10 commits, pair-fleet
built (opus-5 coder, terra reviewer), independently reviewed with mutation
gates both rounds.

- **Item 1's hypothesis was WRONG and the fix is bigger than planned**: not a
  tuple collision but a logs↔metrics **grammar seam** — multi-word extension
  verbs (`dd build`) were legal in logs and illegal in metrics, poisoning
  every session where an extension subcommand exited, at write AND read. A
  second same-class throw in the logs encoder was found and given the same
  degrade-never-throw contract. Real-data proof: session `71679da4` went from
  permanently unreadable to a 231-segment save, `degraded` only for the
  pre-existing `subagent_tokens` gap, with the `dd build` datapoint present —
  and its authorship table surfaced a genuine path-only row (`retitle.py`)
  invisible before item 3.
- **Review chain**: combined FIX_REQUIRED round (1 HIGH — the hook's amend
  heuristic deduped a normal commit whose MESSAGE contained `--amend`;
  reviewer-built reproducer) → fix cuts the argv scan at the first
  message-bearing flag, matches amend tokens only in the prefix, and the hook
  header now names the detection a heuristic over a lossy source with its
  residual direction steered to capture-as-noise → narrow re-review APPROVE
  with an independent boundary mutation. The coder also found its own
  first-fix bug (a boundary-space case with no test on it) via logic table +
  mutation testing, and a test-harness artifact that had silently inverted
  the amend test's flag ordering.
- **The reviewer's C3 contest is resolved by ruling, not fix**: the packet
  predated the o-prime's second ruling (C3 met, idle formally waived,
  merge-as-enablement approved — see the proposal doc), and the government
  ruling file isn't present in this worktree; the contest was correct on the
  evidence it had.
- Sensor placement judgment (beside repo-sensors, not inside `checks` — no
  per-sensor selector exists) stands, reviewer-ratified; a
  `sensors check --sensor <id>` selector is a possible future nicety.

## Gates

`just test` + `node harness/cli/bin/harness.js checks`; baseline green except
arch-check 2 warns / markdown-lint 199 findings (add to neither). Known box
flakes under cross-worktree vitest load: docs.test.ts pipe timeouts,
exec-remote-telemetry-git temp-dir inventory — re-run solo before blaming a
change.
