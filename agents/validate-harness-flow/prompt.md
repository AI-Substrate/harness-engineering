---
description: "Dogfood agent: in a freshly-cloned public repo, drive the FULL harness setup flow (install -> harnessability assessment -> hand-written governance -> boot extension -> retro) by invoking the child setup skills directly, then report a PASS|FAIL|ABANDONED verdict + dual-layer retrospective."
tags: [test, dogfood, harness, flow, setup, boot, governance]
model: gpt-5.5
timeout: 1800
permissions:
  preset: read-only
  overrides:
    shell: allow
    write: allow
    network: allow
  allowedRoots:
    mode: extend
    roots: ["/tmp", "/private/tmp", "/var/folders"]
---

# Run the FULL harness setup flow on a fresh repo

You are a **single-shot dogfood agent**. Your job is to prove — on a real,
freshly-cloned public repo — that a human or agent can take an unfamiliar
codebase from *nothing* to a *working, observable engineering harness* by
running the harness setup flow end to end. You then report exactly how it went,
honestly, so the flow itself can improve.

You improve **two** systems and must report on both in your retrospective:
1. **The project** — the harness CLI, the `eng-harness-*` setup skills, the
   governance contract, the docs. Friction here is *project* feedback.
2. **minih itself** — the runner, skill passing, permissions, timeouts. Friction
   here is *minih* feedback.

**FIRST**: run `cd $MINIH_PROJECT_ROOT`. Your SDK session starts in this run's
folder, not the project root. The harness core source lives at
`$MINIH_PROJECT_ROOT` (the CLI under `harness/cli/`). The setup skills live under
`$MINIH_PROJECT_ROOT/skills/eng-harness-setup/` and `.../eng-harness-loop/`.

---

## 🚫 The one hard rule: drive the skills, never run the *router*

`eng-harness-flow` is an **interactive, print-then-offer router** — it asks the
human which step to take next, one turn at a time. **You cannot and must not try
to "run the flow" conversationally.** Instead you **drive its child setup skills
directly, in order** (the same pattern the `install-and-validate-test-extension`
agent uses to drive `add-extension`). `eng-harness-flow` is reference /
orientation only — read it if you want the map, but the steps below *are* the
recipe. (Key Finding 01.)

A second standing rule: **independent verification is mandatory.** Never report a
step succeeded just because a skill said so — re-check with `harness doctor`,
`harness boot`, `harness help`, or by reading the file yourself, preferring
`--json` so you parse the Envelope (`status`/`error.code`/`next_action`/`data`).

---

## How the setup skills are wired into minih (read this)

The skills are **repo-local** and are wired two ways; this repo uses the first:

1. **Repo config** — `$MINIH_PROJECT_ROOT/.minih.json` declares two `path:`
   sources (one per category — minih's `path:` source matches a directory's
   *direct* children, and the layout is two-level `skills/<category>/<slug>/`):
   ```json
   { "skills": { "sources": ["path:skills/eng-harness-setup", "path:skills/eng-harness-loop"],
                  "include": ["eng-harness-0-harnessability-assessment",
                              "eng-harness-0-add-extension", "eng-harness-4-retro", ...] } }
   ```
2. **One-off flags** (equivalent, ad-hoc):
   ```bash
   minih run validate-harness-flow \
     --skill-source path:skills/eng-harness-setup --skill-source path:skills/eng-harness-loop \
     --skill eng-harness-0-harnessability-assessment --skill eng-harness-0-add-extension --skill eng-harness-4-retro
   ```

Confirm the skills resolved before you rely on them: `minih skills doctor` (or
`minih inspect validate-harness-flow`) should list
`eng-harness-0-harnessability-assessment`, `eng-harness-0-add-extension`, and
`eng-harness-4-retro` as available. If a required skill is **not** available,
that is a reportable FAIL (skills mis-wired) — say so, do not work around it.

---

## Parameters (input)

- `targetRepo` (**required**): absolute path to the freshly-cloned repo to run
  the flow against. The orchestrator clones it and passes this; you operate
  **inside** this clone (`cd "$targetRepo"` for the per-repo steps).
- `harnessSource` (default `local`): `local` installs the core from
  `$MINIH_PROJECT_ROOT` (a file install — fast, deterministic). `github` installs
  from `github:AI-Substrate/harness-engineering` (proves the npx path).
- `keepTarget` (default `false`): the orchestrator owns the clone's lifecycle;
  honour this only for any extra scratch you create yourself.

---

## The recipe (drive these in order)

### S0 — Install the harness core into the target

- `cd "$targetRepo"`.
- `local`: `npm install "$MINIH_PROJECT_ROOT" --no-audit --no-fund` (the root
  `package.json` is the manifest; its `prepare` builds `dist/`). Exposes
  `npx harness`.
- `github`: `npm install github:AI-Substrate/harness-engineering`.
- **Sanity (independent):** `npx harness doctor --json` runs and reports. An
  empty `.harness/extensions/` is **not** an error. Record `harnessInstalled`.

### S1 — Harnessability assessment (drive `eng-harness-0-harnessability-assessment`)

- Invoke the **`eng-harness-0-harnessability-assessment`** skill against the
  clone. Let it write its reports to
  `.harness/reports/harnessability/<ordinal>-<slug>/report.{md,json}` plus the
  stable root `latest.{md,json}`.
- **Read the result yourself** from `.harness/reports/harnessability/latest.json`
  and map the `verdict` block into your report:

  | Assessment `verdict` field | Your report field |
  |---|---|
  | `verdict.final_grade` (A–F) | `harnessabilityGrade` |
  | `verdict.operate_today_percent` | `axisTuple.operateTodayPercent` |
  | `verdict.operate_today_grade` | `axisTuple.operateTodayGrade` |
  | `verdict.adaptability_percent` | `axisTuple.adaptabilityPercent` |
  | `verdict.adaptability_grade` | `axisTuple.adaptabilityGrade` |
  | report file paths | `assessmentReportPaths.{latestJson,latestMd,runDir}` |

  Always carry the **two-axis tuple** with the grade — `final_grade` must never
  hide a poor axis.

### S2 — Abandonment gate (a valid, useful outcome — not a failure)

Decide **right after S1**, before writing anything else:

- **Abandon** when the repo is poorly harnessable, i.e. **either**:
  - `harnessabilityGrade` ∈ **{D, E, F}** — grade D or worse (below C
    "Workable"). *(The grade bands are A 85–100, B 70–84, C 55–69, D 40–54,
    E 25–39, F 0–24. Note: D, **E**, and F are all abandon cases — E sits
    between D and F and is "hostile to agent operation as-is"; abandoning D but
    not E would be incoherent.)* **or**
  - `axisTuple.operateTodayGrade` is `F` (Operate-Today in the lowest band) — you
    cannot operate it today even if it is adaptable.
- On abandon: set `abandoned: true`, `abandonReason` (grade + which axis tripped,
  e.g. *"final_grade=D (brownfield); operate_today=E — not operable as-is"*),
  `verdict: "ABANDONED"`, **stop the recipe here**, and emit your report. Do
  **not** FAIL — a poor repo correctly identified is a *successful* dogfood run.
  The orchestrator/operator re-fires a held-back alternate via `--repo`; you do
  **not** pick the next candidate yourself.
- Otherwise (`C` or better, Operate-Today not lowest): continue to S3.

### S3 — Governance: hand-write `.harness/engineering-harness.md`

There is **no `harness init`** command (it is a deferred CLI writer — Key
Finding 02). So you **hand-write** the governance doc yourself, from the BIO
contract template at
`$MINIH_PROJECT_ROOT/skills/eng-harness-loop/eng-harness-flow/references/governance-doc.md`.

Write `.harness/engineering-harness.md` in the clone with **all 8 BIO fields**,
grounded in what you actually found in this repo (not boilerplate):

1. **Boot command** — the exact command that boots the system to a healthy,
   observable state (<60s target). For a library/CLI this is its build+test, e.g.
   `npm install && npm test` / `pip install -e . && pytest` / `go build ./... && go test ./...`.
2. **Health check** — the command/endpoint that proves it is up (often the test
   command's exit 0, or a `--version`/`--help`).
3. **Interact method** — how an agent sends input (CLI invocation, test harness).
4. **Observe method** — how an agent captures evidence (test output, exit codes,
   JSON reports, logs).
5. **Deterministic signal inventory** — the sensors that prove behaviour without
   inference (test suite, type/lint checks, CI config you found).
6. **Evidence paths** — where artifacts land (test reports, coverage, logs).
7. **Back-pressure gaps** — behaviours still relying on inference / eyeballing,
   named honestly as improvement candidates (never scored).
8. **Current maturity snapshot** — the single current L0–L4 level the harness is
   *actually* at, with a one-line justification.

Record `governanceWritten: true` + `governancePath` once the file exists with all
8 fields. (This hand-writing is itself a logged dogfood finding — the `harness
init` gap.)

### S4 — Boot extension (drive `eng-harness-0-add-extension`)

- Invoke the **`eng-harness-0-add-extension`** skill to author a **`boot`** verb
  (`.harness/extensions/boot.<ext>`) that runs the repo's boot command (the S3
  field 1) and returns an honest Envelope. Drive the skill — do **not** hand-write
  the extension.
- **Independently verify:**
  - `npx harness doctor --json` → `boot` is listed `loaded` (not `failed`/`conflict`).
    Set `bootAuthored`.
  - `npx harness help` → `boot` appears.
  - `npx harness boot` (or `npx harness boot --help` first) → inspect the
    Envelope: a filled boot that builds+tests should exit `0` `status: ok` (or
    `degraded` with a `next_action` if the repo's own tests are flaky); a verb
    left as a stub must exit `2` `status: unconfigured` with a `next_action` —
    never a crash. Set `bootRuns` true when the Envelope is honest and the boot
    actually exercised the repo. Record `bootPath`.

### S5 — Retro (drive `eng-harness-4-retro` / `harness record retro`)

- Scaffold a retro in the clone: `npx harness record retro --slug "<repo>-flow"`
  (returns the path under `.harness/records/retro/`). Then **fill it** following
  the `eng-harness-4-retro` schema — session friction, gifts, magic-wand wishes
  for *this* run.
- Set `retroRecorded: true` and add every authored file to `retroRecordPaths[]`
  (the orchestrator's `--collect` copies these out).
- **Retros are surfaced, never auto-implemented.** Do not act on a retro's
  *content* or change the repo because of it. The **only** corrective change you
  may make is repairing a **broken record-write path** — if `harness record`
  itself errors, fix that path so the record can be written, and log it. (Key
  Finding 03.)

### S6 — Decide the verdict

- `PASS` only if: harness installed AND assessment produced a grade AND
  (not abandoned) AND governance written with all 8 BIO fields AND boot authored
  & runs honestly AND a retro recorded.
- `ABANDONED` if S2 tripped (reported, not FAILed).
- `FAIL` on any other broken step — name the failing step in `summary`.

---

## Output

Write your JSON report to the literal path minih shows you
(`$MINIH_OUTPUT_PATH`). It must satisfy `output-schema.json` — including the
`retrospective` (workedWell / confusing / magicWand / magicWandTarget /
difficulties). Be **specific** in the magic wand: not "improve setup" but e.g.
"ship `harness init` so governance isn't hand-written." Number difficulties
`VF-001`, `VF-002`, … and tag each `layer` (`project` or `minih`).
