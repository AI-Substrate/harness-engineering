---
record_kind: "retro"
harness_version: "0.13.0"
branch: "s065/deterministic-documents"
repo: "https://github.com/AI-Substrate/harness-engineering"
created_at: "2026-08-04T17:05:00Z"
agent: pij-sole-snipe
plan_id: 071-dd-native-builder
schema_version: "1.2"
retro_id: "2026-08-05T03:05Z-pij-sole-snipe-p3drain"
started_at: "2026-08-04T13:06:43.350Z"
ended_at: "2026-08-05T03:05:00Z"
summary: "retro --drain phase-3 boundary save (7 entries, bucket pij-sole-snipe)"
entries:
  - id: DL-001
    kind: difficulty
    description: "The dd-surface manifest is the DD surface's registry and has no home for 'plan' verbs: plan new/validate/render already ship unlisted, and tk-7151's 'plan pr-body' makes four. So a new plan verb has no mechanical record anywhere, and the brief's 'every new verb = a manifest row' silently does not apply to a whole verb family. Ruled A (follow precedent) for phase 3; the registry gap itself is real and outlives this plan."
    suggested_encoding: "Either give the surface manifest a 'Plan commands' section that backfills the four plan verbs, or state explicitly in the manifest header which surface classes it governs so 'no row' is a deliberate answer rather than an omission."
    fp: "43eefa608820"
    disposition: task
    resolved_by: "surface-registry gap: no manifest home for plan verbs (ruling Q1-A precedent); future manifest structure decision"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T13:06:43.350Z"
  - id: DL-002
    kind: difficulty
    description: "exec-git-write.int.test.ts > 'readRefTree round-trips a >1 MiB blob byte-verbatim' failed ONCE under full-suite load and passed alone and on the next full run. Sibling class to the DL-008 flake I root-caused in tk-7173, but a DIFFERENT file and a different mechanism (a >1MiB git cat-file under contention, not a shared-tmpdir scan). Not reproduced yet, so not diagnosed - recording the sighting so the next occurrence has a prior."
    suggested_encoding: "If it recurs during the 20x loaded verification, capture the actual error text (ENOBUFS vs timeout vs index.lock) before theorising; the fix shape will differ completely between those three."
    fp: "df6b2895a040"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T13:10:08.656Z"
  - id: INS-001
    kind: insight
    description: "A PATTERN, not three incidents: three separate real-git integration suites have now failed once each under full-suite load and passed alone — exec-remote-telemetry-git (root-caused in tk-7173: shared os.tmpdir scan), exec-git-write (>1MiB cat-file), cat-file-batch (subprocess-count bound). The last two are timing/resource-shaped, not namespace-shaped, so tk-7173's fix does not cover them. Common factor: heavy real-git work contending for CPU under vitest's default file parallelism, with assertions that bound RESOURCES (subprocess counts, buffer sizes) rather than outcomes."
    suggested_encoding: "Consider a vitest project/pool split that runs *.int.test.ts serially (or with concurrency 1) while unit tests keep full parallelism - the resource-bounding assertions are only meaningful uncontended. Cheaper than root-causing each suite, and it makes the bound mean what it says."
    fp: "d88e983653ab"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T14:17:28.215Z"
  - id: DL-003
    kind: difficulty
    description: "Plan 071's own journey ran with ZERO dd_link gates on its flight plan (22 nodes, none gated, plan_dir null) — the plan that built mechanical departure refusal was not itself mechanically refusable. Consequence chain: no gate meant no refusal to capture, so ac-7117's 'at least one genuine refusal in telemetry' is not merely unmet but unmeetable for this journey; and flow relocate will refuse the flow at archive time because there is no plan_dir anchor."
    suggested_encoding: "The gap is that NOTHING notices an ungated flight plan. A flow created without --plan-dir, or with no dd_link nodes, is indistinguishable from a correctly gated one until a departure that never gets refused. Consider a doctor-style check ('this flow declares no gates') or making --plan-dir required for flight-plan kinds - the same reasoning that made a dropped --plan-dir a refusal rather than a silent drop."
    fp: "6dd63a31cc4e"
    disposition: fixed-now
    resolved_by: "gates retrofit bdfaf690 (review-3 check gate + ship completion gate); refusal/override/pass exercised at the boundary"
    system:
      compound:
        status: encoded
        source: agent-self
        first_seen_at: "2026-08-04T14:41:02.825Z"
  - id: INS-002
    kind: insight
    description: "The phase-3 fence omitted THREE files that its own task texts require: .dependency-cruiser.cjs was phase-1's, flow-eval resolvers.ts phase-2's, and phase 3 needed docs/plans/065-.../builder-tuning (tk-7163 signpost), .claude/skills/flow-eval-run/SKILL.md (tk-7168), plus a README line (tk-7161's alias drop). Five amendments across three phases, all granted, all the same shape: the brief instructs a mechanism and omits the file the mechanism lives in - which is the exact defect class tk-7171 was commissioned to fix."
    suggested_encoding: "tk-7171 shipped builder/fence but nothing CLOSES the loop: a fence is still authored by hand from a task list. The obvious next step is deriving candidate allow rows from the tasks themselves - every task text that names a path is a fence row nobody typed - and running plan fence in the dispatch flow so the omission surfaces at dispatch time rather than at the coder's third question."
    fp: "baf560a980e0"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T14:42:41.984Z"
  - id: INS-003
    kind: insight
    description: "tk-7173's stated bar was '20 consecutive loaded full-suite runs green'. The FIRST attempt at that bar was vacuous: my script classified a run by grepping vitest's summary line, the grep matched nothing, so every run scored PASS and reported 20/20. Rewriting it to key on vitest's EXIT CODE immediately produced 18/20 and surfaced two real defects (a leak check that failed on a directory DISAPPEARING, and a 5s default timeout on a test that publishes 150 git blobs)."
    suggested_encoding: "A verification script is an instrument and deserves the same control discipline as production code: before trusting a green run, make it fail on purpose. A pass/fail classifier that can only ever say PASS is the same defect class as a check only ever run against good input - and it is MORE dangerous, because it launders every other proof that rides on it."
    fp: "a689347b2afe"
    disposition: kept
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T14:54:40.844Z"
  - id: DL-004
    kind: difficulty
    description: "Vitest's 5s default testTimeout is not survivable for real-git test cases in this repo, and the exposure is a CLASS, not a file: 17 test files spawn subprocesses, only 3 declare a budget (exec-remote-telemetry-git.int.test.ts pre-existing, publication-boundary.test.ts and git-read.test.ts added in plan 071 phase-3 fix rounds), leaving a 14-file gap. Across three review rounds the SAME flake surfaced in three DIFFERENT files: round 1 publication-boundary.test.ts, round 2 git-read.test.ts:349, round 3 exec-git-write.int.test.ts:117 'push uses --no-verify' at load ~142 with 10 load generators. Root cause measured, not assumed: spawnSync blocks on children the file cannot influence while sibling suites spawn their own; a sampled git child runs p50 73ms / p90 130ms / p99 356ms / MAX 1202ms under load, and git-read's two real-git cases spend 46 git children between them. Fixing the named file each round is whack-a-mole against the class."
    suggested_encoding: "Extend the measured vi.setConfig idiom (precedent: exec-remote-telemetry-git.int.test.ts) to the real-git suites that lack a budget, scoped by evidence of actual git children per file — NOT a blanket raise of the global vitest testTimeout, which would hide genuine hangs across the whole suite. Consider a shared test-support helper so the budget has ONE definition and a comment explaining the measurement, rather than 14 hand-copied numbers."
    fp: "d753a6b2ff5a"
    disposition: task
    resolved_by: "prime-ledgered OWNER: NONE — real-git-under-contention CLASS, 14/17 suites unbudgeted, firing relocates as bar rises; bound holds by load condition (~142 >> CI), NOT by ever-fired coverage"
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-08-04T16:50:13.783Z"
system:
  compound:
    bubble_action: "all-save"
---

# Retro — plan 071 phase-3 boundary drain (pij-sole-snipe bucket)
