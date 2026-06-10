import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { mapToDecision, parseDepcruiseJson } from './mapping.js';

/**
 * RED/GREEN suite for the pure violations→envelope mapping (plan 016, AC-10).
 *
 * Fixtures are REAL dependency-cruiser 17.4.3 `--output-type json` captures
 * from this repo (2026-06-10): `clean.json` is the live tree verbatim
 * (modules[] trimmed — the mapping never reads it); the violation fixtures
 * keep the captured entry shape with extra entries added IN SCRAMBLED ORDER
 * so the deterministic-sort assertions have teeth. `error-violation.json`
 * models the promoted-severity future (two rules flipped to `error` in
 * `ruleSetUsed`); today's committed config ships all rules at `warn`
 * (warn-launch), so the error path is fixture-proven here, not live.
 */

const fixture = (name: string): string =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

interface ParsedFixture {
  summary: { ruleSetUsed: { forbidden: { name: string; comment?: string }[] } };
}

const parsedWithRules = (name: string) => {
  const parsed = JSON.parse(fixture(name)) as ParsedFixture;
  return { parsed, rules: parsed.summary.ruleSetUsed.forbidden };
};

describe('arch-check mapping — § Envelope & Exit Contract', () => {
  it('given_clean_summary_when_mapped_then_ok_exit0_with_real_counts', () => {
    /*
    Test Doc:
    - Why: AC-3/AC-10 — the contract's row 1: a clean tree must read `ok` with REAL
      counts, never a hollow green (constitution P5/P6 honesty).
    - Contract: 0 violations → {status:'ok', exitIntent:0}, data.modules ←
      summary.totalCruised, data.dependencies ← summary.totalDependenciesCruised,
      data.violations === [] (present and empty, not undefined).
    - Usage Notes: fixture is the live-tree capture (66 modules / 112 deps);
      rules are extracted from the same document's summary.ruleSetUsed.forbidden.
    - Quality Contribution: catches count-field drift (depcruise renames) and any
      regression that drops the empty violations array CI's jq path relies on.
    - Worked Example: clean.json → {status:'ok', exitIntent:0,
      data:{modules:66, dependencies:112, violations:[]}}
    */
    const { parsed, rules } = parsedWithRules('clean.json');
    const decision = mapToDecision(parsed, rules);
    expect(decision.status).toBe('ok');
    expect(decision.exitIntent).toBe(0);
    expect(decision.data).toEqual({ modules: 66, dependencies: 112, violations: [] });
    expect(decision.error).toBeUndefined();
    expect(decision.next_action).toBeUndefined();
  });

  it('given_error_severity_violations_when_mapped_then_error_exit1_sorted_with_first_error_rule_named', () => {
    /*
    Test Doc:
    - Why: AC-5/AC-10 — the contract's row 2 (the blocking path, unit-proven while
      warn-launch keeps it off the live tree): any error-severity violation must
      become {status:'error', exit 1} with the fix explained at the point of failure.
    - Contract: ≥1 error-severity violation → status 'error', exitIntent 1,
      error.code 'E_ARCH_VIOLATION', error.message '<n> architecture violation(s)'
      (n = ALL violations); violations[] sorted by from→to→rule REGARDLESS of
      depcruise emission order; each violation flattened to {from,to,rule,severity,
      comment} with comment joined verbatim from the rule set; next_action names the
      FIRST error-severity rule in sorted order and quotes its comment verbatim.
    - Usage Notes: the fixture's three violations are deliberately scrambled
      (services/help first, adapters/exec last) and mix severities (2 error, 1 warn);
      the circular entry carries depcruise's extra `cycle` field — mapping must
      tolerate fields it does not read.
    - Quality Contribution: catches sort regressions (golden-diff stability),
      comment-join loss, severity-partition bugs (a warn entry tipping status to
      error or vice versa), and next_action drift.
    - Worked Example: error-violation.json → sorted froms [adapters/exec/node-exec.ts,
      output/envelope.ts, services/help/help-service.ts]; next_action 'Fix `no-circular`:
      No circular dependencies anywhere in the CLI. (rules: .dependency-cruiser.cjs)'
    */
    const { parsed, rules } = parsedWithRules('error-violation.json');
    const decision = mapToDecision(parsed, rules);
    expect(decision.status).toBe('error');
    expect(decision.exitIntent).toBe(1);
    expect(decision.error).toEqual({
      code: 'E_ARCH_VIOLATION',
      message: '3 architecture violation(s)',
    });
    expect(decision.data.violations).toEqual([
      {
        from: 'harness/cli/src/adapters/exec/node-exec.ts',
        to: 'harness/cli/src/services/extensions/registry.ts',
        rule: 'adapters-stay-leaf',
        severity: 'warn',
        comment: 'Adapters are leaves — they never import services, acts, or output.',
      },
      {
        from: 'harness/cli/src/output/envelope.ts',
        to: 'harness/cli/src/output/render.ts',
        rule: 'no-circular',
        severity: 'error',
        comment: 'No circular dependencies anywhere in the CLI.',
      },
      {
        from: 'harness/cli/src/services/help/help-service.ts',
        to: 'harness/cli/src/adapters/fs/node-fs.ts',
        rule: 'services-only-adapter-ports',
        severity: 'error',
        comment:
          'Services may depend on adapter PORT interfaces only, never concrete node-*/exec-*/system-* implementations or fakes.',
      },
    ]);
    expect(decision.next_action).toBe(
      'Fix `no-circular`: No circular dependencies anywhere in the CLI. (rules: .dependency-cruiser.cjs)',
    );
  });

  it('given_warn_only_violations_when_mapped_then_degraded_exit0_naming_rules_count_and_promote_guidance', () => {
    /*
    Test Doc:
    - Why: AC-4/AC-10 — the contract's row 3 IS the launch posture (grill decision
      2026-06-10: all rules ship at warn): violations must surface visibly as
      `degraded` without blocking, and the next_action must teach the promote path.
    - Contract: ≥1 violation, none error-severity → status 'degraded', exitIntent 0,
      no error object; violations[] sorted from→to→rule; next_action names the
      violated rule(s), states the count, gives the promote guidance, and echoes
      the rule-change discipline (never weaken a rule in the PR that trips it).
    - Usage Notes: fixture entries are scrambled (services/instructions before
      services/help) to assert the sort on the degraded path too.
    - Quality Contribution: catches the worst regression class — a violation that
      stops being visible (degraded→ok) — and next_action guidance drift.
    - Worked Example: warn-only.json → status 'degraded', exit 0, sorted froms
      [services/help/…, services/instructions/…], next_action 'Review 2
      warn-severity architecture violation(s) (rules: services-only-adapter-ports)…'
    */
    const { parsed, rules } = parsedWithRules('warn-only.json');
    const decision = mapToDecision(parsed, rules);
    expect(decision.status).toBe('degraded');
    expect(decision.exitIntent).toBe(0);
    expect(decision.error).toBeUndefined();
    // 113, not 112: this fixture is the SEEDED-tree capture — the seeded import
    // itself is one extra dependency. Real capture, real count.
    expect(decision.data.modules).toBe(66);
    expect(decision.data.dependencies).toBe(113);
    expect(decision.data.violations.map((v) => v.from)).toEqual([
      'harness/cli/src/services/help/help-service.ts',
      'harness/cli/src/services/instructions/instructions-service.ts',
    ]);
    for (const v of decision.data.violations) {
      expect(v.comment).toBe(
        'Services may depend on adapter PORT interfaces only, never concrete node-*/exec-*/system-* implementations or fakes.',
      );
    }
    expect(decision.next_action).toBe(
      "Review 2 warn-severity architecture violation(s) (rules: services-only-adapter-ports). Promote a rule's severity to 'error' in .dependency-cruiser.cjs once it should block — and never weaken a rule in the same PR that trips it.",
    );
  });

  it('given_malformed_stdout_when_parsed_then_parse_failure_for_the_error_state', () => {
    /*
    Test Doc:
    - Why: AC-5/AC-10 — the contract's row 6: depcruise crashing or emitting
      unparseable output must fail LOUDLY (error/exit 1), never be mistaken for a
      clean run. dependency-cruiser 17.4.3 exits 0 from `--output-type json` even
      with error-severity violations (measured 2026-06-10), so parsing stdout —
      not trusting the exit code — is the only honest detection path.
    - Contract: parseDepcruiseJson(garbage) → {ok:false, detail} (detail non-empty,
      for error.details); parseDepcruiseJson(valid capture) → {ok:true, parsed}
      round-trips into mapToDecision.
    - Usage Notes: malformed.json holds crash-style text + truncated JSON — read it
      as a string; it is NOT importable JSON by design.
    - Quality Contribution: catches a try/catch regression that would let a crashed
      sensor read as ok (the "fake green" failure mode P5 exists to prevent).
    - Worked Example: 'depcruise crashed…{"summary": {"violations": [' →
      {ok:false, detail:'…'}; clean.json text → {ok:true} → status 'ok'
    */
    const malformed = parseDepcruiseJson(fixture('malformed.json'));
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) {
      expect(malformed.detail.length).toBeGreaterThan(0);
    }

    const valid = parseDepcruiseJson(fixture('clean.json'));
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      const rules = (valid.parsed as ParsedFixture).summary.ruleSetUsed.forbidden;
      expect(mapToDecision(valid.parsed, rules).status).toBe('ok');
    }
  });
});
