---
schema_version: "1.0"
retro_id: "2026-06-10T10:30:00Z-claude-code-017wb"
agent: "claude-code"
plan_id: "017-windows-cross-platform-fixes"
started_at: "2026-06-10T09:47:00Z"
ended_at: "2026-06-10T10:30:00Z"
summary: "Single-phase companion build T000–T015: POSIX path helper + five services converted, Windows-shape sensor (revert-proven), shell-free EPIPE test, gen-docs stderr + portable biome, package-smoke repaired (first green), .gitattributes, idioms §11. Suite 380→434 green throughout; CI fully green after a two-step fight with nondeterministic npx root-bin resolution (committed 755 wrapper + node-direct invocation in CI). This drain materializes the session buffer (4 new entries + DL-001 carried from 016)."
entries:
  - id: DL-001
    kind: difficulty
    description: "minih companion-mode channel failure (016 build): the companion sent 7 findings as inbox replies (each with a real ackOf id) but minih outside inbox list NEVER showed them — only sender:outside messages were visible all phase. The orchestrator read silence as reviewed-clean; findings only surfaced in the farewell envelope after control:stop."
    target: minih
    severity: degrading
    workaround: "Treat sustained silence as suspect; poll minih tail or the run dir mid-phase; rely on the farewell reconciliation."
    suggested_encoding: "minih bug report + companion-mode docs note on the inbox visibility asymmetry."
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T08:27:00Z"
  - id: DL-002
    kind: difficulty
    description: "npx --no-install resolution of the ROOT package's own bin is nondeterministic across npm majors: same tree green on npm 10.9.8 + 11.13.0 at 08:36, red at 10:12 (sh: harness: Permission denied); a committed 755 wrapper fixed npm 10 only; only node-direct invocation in CI killed the whole class. Cost: 3 CI roundtrips during T014."
    target: tooling
    severity: degrading
    workaround: "Committed harness/cli/bin/harness.js at git mode 100755 + CI invokes node harness/cli/bin/harness.js directly (same verb code path, no npx)."
    suggested_encoding: "A 'just harness' recipe (node-direct) + docs note that npx --no-install of the repo's own bin is unreliable on npm 11.13 in fresh checkouts."
    system:
      compound:
        status: suggested
        source: agent-self
        first_seen_at: "2026-06-10T10:12:00Z"
  - id: CONF-001
    kind: confusion
    description: "arch-check verb is cwd-sensitive (extensions are discovered under cwd) — invoking from harness/cli yields E108 'too many arguments' because the verb never registers; separately the plan's T002 done-when wrote 'arch-check --json' which reads as a verb flag but JSON is the default envelope. Two small traps for future agents."
    target: doc
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T09:51:00Z"
  - id: GFT-001
    kind: gift
    description: "The validated plan executed T001–T013 with ZERO re-research: every empirical pin (npm pack --json contamination on 11.10.0, posix.resolve drive-letter corruption, posix.normalize UNC // collapse, FakeProcess cwdPath seam, biome bin shebang) held exactly as written. Sensor-first task ordering meant the Windows-shape tests existed before the CI proof needed them."
    target: plan
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T10:28:00Z"
  - id: MW-001
    kind: magic-wand
    description: "A deterministic packaging/bin-integrity sensor (a smoke that execs the bin from a fresh checkout the way npx would, or a doctor probe for bin exec bits + tarball shape) so 'works on my npm' can never ship — the 40 Windows failures and the bin-permission CI red are the same genus: environment-dependent resolution with no sensor watching it."
    target: infra
    system:
      compound:
        status: open
        source: agent-self
        first_seen_at: "2026-06-10T10:28:00Z"
---

# Retro — 017 windows-cross-platform-fixes (build-phase drain)

Drained at the phase seam (plan T015, `[a]` save-all). The four new entries are this build's friction/signal; DL-001 rode along in the buffer from the 016 phase and is preserved here rather than dropped. Full narrative in `docs/plans/017-windows-cross-platform-fixes/execution.log.md`.
