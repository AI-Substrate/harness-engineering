const record = (frontmatter: string): string => `---
${frontmatter.trim()}
---

# Fixture retro
`;

export const files: Record<string, string> = {
  '/repo/.harness/records/retro/2026-05-01/001-alpha.md': record(`
schema_version: "1.0"
retro_id: "2026-05-01T10:00:00Z-alpha-a001"
agent: alpha
plan_id: plan-one
started_at: "2026-05-01T09:00:00Z"
entries:
  - id: DL-001
    kind: difficulty
    description: "The same tooling setup had to be read manually before every run."
    target: tooling
    severity: degrading
    disposition: declined
    system:
      compound:
        status: open
        first_seen_at: "2026-05-01T09:15:00Z"
  - id: MW-001
    kind: magic-wand
    description: "Add a diagnostic command that checks the project sensor before implementation."
    target: project-sensor
    suggested_encoding: "harness sensor-check"
    disposition: deferred
    system:
      compound:
        status: open
        first_seen_at: "2026-05-01T09:20:00Z"
`),
  '/repo/.harness/records/retro/2026-05-15/001-duplicate-canonical.md': record(`
record_kind: "retro"
schema_version: "1.2"
retro_id: "2026-05-15T10:00:00Z-alpha-d00d"
agent: alpha
plan_id: plan-two
started_at: "2026-05-15T09:00:00Z"
entries:
  - id: DL-002
    kind: difficulty
    description: "Schema drift was only found after the generated artifact failed."
    target: schema
    severity: blocking
    fp: abcdef123456
    disposition: task
    system:
      compound: { status: suggested, source: agent-self, first_seen_at: "2026-05-15T09:10:00Z" }
`),
  '/repo/.harness/records/retro/2026-06-01/001-gamma.md': record(`
schema_version: "1.1"
retro_id: "2026-06-01T10:00:00Z-gamma-c003"
agent: gamma
plan_id: plan-three
started_at: "2026-06-01T09:00:00Z"
entries:
  - id: INS-001
    kind: insight
    description: "A stable fixture makes the parser behaviour directly observable."
    target: plan
    system:
      compound:
        status: encoded
        first_seen_at: "2026-06-01T09:30:00Z"
`),
  '/repo/.harness/records/retro/2026-06-02/001-minor-skew.md': record(`
schema_version: "1.9"
retro_id: "2026-06-02T10:00:00Z-beta-b009"
agent: beta
plan_id: plan-three
started_at: "2026-06-02T09:00:00Z"
entries:
  - id: SUGG-001
    kind: improvement-suggestion
    description: "The health smoke path should emit a readable log and trace."
    target: infra
    severity: annoying
    disposition: kept
    system:
      compound:
        status: open
        first_seen_at: "2026-06-02T09:05:00Z"
`),
  '/repo/.harness/records/retro/2026-06-03/001-malformed.md':
    '---\nschema_version: "1.2"\nretro_id: "unterminated"\n',
  '/repo/.harness/records/retro/2026-06-04/001-future-major.md': record(`
schema_version: "2.0"
retro_id: "2026-06-04T10:00:00Z-beta-b200"
agent: beta
plan_id: plan-four
started_at: "2026-06-04T09:00:00Z"
entries:
  - id: DL-200
    kind: difficulty
    description: "A future major version must be counted and skipped."
    system:
      compound:
        status: open
        first_seen_at: "2026-06-04T09:05:00Z"
`),
  '/repo/docs/harness/agents/alpha/run-1/duplicate.retro.md': record(`
schema_version: "1.1"
retro_id: "2026-05-15T10:00:00Z-alpha-d00d"
agent: alpha
plan_id: plan-two
started_at: "2026-05-15T09:00:00Z"
entries:
  - id: DL-LEGACY
    kind: difficulty
    description: "This lower-precedence duplicate must never replace the canonical record."
    target: tooling
    system:
      compound:
        status: open
        first_seen_at: "2026-05-15T09:05:00Z"
`),
  '/repo/docs/harness/agents/beta/run-2/deviant.retro.md': record(`
schema_version: "1.0"
retro_id: "2026-05-20T10:00:00Z-beta-b004"
agent: beta
plan_id: plan-four
started_at: "2026-05-20T09:00:00Z"
entries:
  - id: WH-001
    kind: worker-harvest
    description: "A historical producer emitted a non-standard kind that must remain visible."
    target: minih
    system:
      compound:
        status: open
        first_seen_at: "2026-05-20T09:05:00Z"
`),
  '/repo/docs/retros/plan-one-followup.md': record(`
schema_version: "1.2"
retro_id: "2026-05-22T10:00:00Z-delta-d005"
agent: delta
plan_id: plan-one
started_at: "2026-05-22T09:00:00Z"
entries:
  - id: DL-003
    kind: difficulty
    description: "The same tooling setup was deferred again after code was read manually."
    target: tooling
    severity: degrading
    disposition: deferred
    system:
      compound:
        status: open
        first_seen_at: "2026-05-22T09:05:00Z"
`),
  '/repo/docs/retros/plan-four-proof-gap.md': record(`
schema_version: "1.1"
retro_id: "2026-05-25T10:00:00Z-delta-d006"
agent: delta
plan_id: plan-four
started_at: "2026-05-25T09:00:00Z"
entries:
  - id: DL-004
    kind: difficulty
    description: "No screenshot or smoke check proved the behaviour, so the page was eyeballed."
    target: infra
    severity: annoying
    system:
      compound:
        status: open
        first_seen_at: "2026-05-25T09:05:00Z"
`),
  '/repo/docs/retros/ignored.legacy.md': 'legacy backup that must not be scanned',
};

export const dirs: Record<string, string[]> = {
  '/repo/.harness/records/retro': [
    '2026-05-01',
    '2026-05-15',
    '2026-06-01',
    '2026-06-02',
    '2026-06-03',
    '2026-06-04',
  ],
  '/repo/.harness/records/retro/2026-05-01': ['001-alpha.md'],
  '/repo/.harness/records/retro/2026-05-15': ['001-duplicate-canonical.md'],
  '/repo/.harness/records/retro/2026-06-01': ['001-gamma.md'],
  '/repo/.harness/records/retro/2026-06-02': ['001-minor-skew.md'],
  '/repo/.harness/records/retro/2026-06-03': ['001-malformed.md'],
  '/repo/.harness/records/retro/2026-06-04': ['001-future-major.md'],
  '/repo/docs/harness/agents': ['alpha', 'beta'],
  '/repo/docs/harness/agents/alpha': ['run-1'],
  '/repo/docs/harness/agents/alpha/run-1': ['duplicate.retro.md'],
  '/repo/docs/harness/agents/beta': ['run-2'],
  '/repo/docs/harness/agents/beta/run-2': ['deviant.retro.md'],
  '/repo/docs/retros': ['plan-one-followup.md', 'plan-four-proof-gap.md', 'ignored.legacy.md'],
};
