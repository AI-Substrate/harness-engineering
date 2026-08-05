---
schema_version: "1.2"
retro_id: "2026-08-04T10:18Z-agent-p1drain"
agent: agent
plan_id: 070-dd-native-builder
started_at: "2026-08-04T07:33:53.051Z"
ended_at: "2026-08-04T10:18:30Z"
summary: "retro --drain phase-1 boundary save (9 entries)"
entries:
  - id: DL-001
    kind: difficulty
    description: "dd id-prefix registry is a CLI constant (ID_PREFIXES in core/constants.ts) \u2014 a schema cannot mint a new item kind (e.g. open-question rows); full-builder-spec dogfood had to design sections without ids to avoid E403"
    first_seen_at: "2026-08-04T07:33:53.051Z"
    fp: "59f59b5d92ab"
    disposition: task
    resolved_by: "ph-7001 revisit (prefix registry vs id-less pattern) \u2014 dogfood-log open thread"
  - id: DL-002
    kind: difficulty
    description: "flow apply op vocabulary undiscoverable: batch op is 'insert' (flat fields) while the CLI verb is 'insert-node' (nested); placement takes exactly one of after/before/branch_of \u2014 two E108 rounds + a source dive to learn it; an --ops example in help would cost zero"
    first_seen_at: "2026-08-04T08:21:22.334Z"
    fp: "7b64bc59fab6"
    disposition: task
    resolved_by: "tk-7044 ops-vocabulary doc \u2014 dogfood-log DF-006"
  - id: DL-003
    kind: difficulty
    description: "dd validate caught two authoring defects before ship: hand-minted id dialects (E403 x16) and a colliding dw-id mint (19 duplicate-id errors) \u2014 the grammar and dup detection doing exactly their job on the first real dd-native plan"
    first_seen_at: "2026-08-04T08:21:22.700Z"
    fp: "ae1691933066"
    disposition: kept
  - id: DL-004
    kind: difficulty
    description: "dd documents have no writer surface \u2014 every structural edit is ad-hoc python read-modify-write (caused dw-id collisions + stale-sibling risk); ruled into plan 070 as ac-7019/tk-7028 (get/set/add/rm + minting), FIRST task of phase 1"
    first_seen_at: "2026-08-04T08:44:36.595Z"
    fp: "d41a98342368"
    disposition: fixed-now
    resolved_by: "ac-7019/tk-7028 writer verbs SHIPPED this phase (commits 77e3ef3f, ab37d55d) \u2014 DF-012 ruled into the plan"
  - id: DL-005
    kind: difficulty
    description: "dd prose authoring: text sections render verbatim, so a plan authored as single newline-free strings becomes wall-of-text in the .dd.md \u2014 plan/JIT authoring prompting (tk-7041/7042) must require \\n\\n paragraph breaks in prose sections; no validator warns on it today"
    first_seen_at: "2026-08-04T09:11:11.055Z"
    fp: "a91bb93b9c63"
    disposition: fixed-now
    resolved_by: "paragraph-break authoring fixed 2873e947; DF-013 logged"
  - id: DL-006
    kind: difficulty
    description: "A schema change adding a REQUIRED section silently breaks every existing corpus and the scaffold that emits them; nothing warns at edit time and it surfaces later as an E402 doctor sweep on files the schema author never opened. dd schema could report which documents a shape change would invalidate."
    first_seen_at: "2026-08-04T09:27:07.304Z"
    fp: "00ef34acc532"
    disposition: task
    resolved_by: "tk-7041/tk-7042 schema-change fixtures + task-file schema split \u2014 DF-014"
  - id: DL-007
    kind: difficulty
    description: "The dd writer verbs need an address to name a section that may not exist yet (a JIT-born assertion list). Solved with a permissive TAIL in locate(), but a caller cannot discover that rule from --help: dd add on a missing map key succeeds while dd get on the same address refuses. Worth teaching in the verb help text."
    first_seen_at: "2026-08-04T09:27:26.128Z"
    fp: "c04a1dce5add"
    disposition: task
    resolved_by: "dd set now creates absent optional fields (design call 4, phase-1); --help discoverability rides tk-7044 prompting"
  - id: DL-008
    kind: difficulty
    description: "The full vitest suite is flaky under load in test/adapters/git/exec-remote-telemetry-git.int.test.ts \u2014 different tests fail on different runs (credential-helper lookup, real network-served Git), always green when the file runs alone. Roughly 50 percent flake rate on a 16-core box; it makes `harness checks` non-deterministic and trains people to re-run."
    first_seen_at: "2026-08-04T09:50:22.055Z"
    fp: "72cc11417cd5"
    disposition: task
    resolved_by: "candidate plan task at phase-2/3 JIT: quarantine or fix exec-remote-telemetry-git.int.test.ts flake"
  - id: CONF-001
    kind: confusion
    description: "First live contradiction fire (plan validate): tk-7027 checked vs ac-7009 unchecked \u2014 a cross-phase satisfies arm warns for the whole of phase 2. Is task-checked-before-its-AC genuinely a contradiction, or should the satisfies direction only fire when the AC is checked over unchecked tasks? Standing WARN accepted mid-flight; revisit at phase-2 JIT."
    first_seen_at: "2026-08-04T10:17:29.654Z"
    fp: "7cbdad3ffd8b"
    disposition: task
    resolved_by: "revisit satisfies-direction contradiction semantics at phase-2 JIT (standing WARN accepted mid-flight)"
system:
  compound:
    bubble_action: "all-save"
---

Phase-1 boundary drain, plan 070 dd-native-builder. Full narrative context in
docs/plans/070-dd-native-builder/assets/dogfood-log.md (DF-001..DF-016).
