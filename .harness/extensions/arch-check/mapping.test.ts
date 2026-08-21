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

  it('given_parseable_but_drifted_schema_when_parsed_then_rejected_not_fake_ok', () => {
    /*
    Test Doc:
    - Why: companion finding F004 — JSON that parses but is NOT depcruise's shape
      (renamed counts, violations not an array) previously slipped through the
      `summary`-key check and could surface as `ok` with undefined counts: a fake
      green, the exact failure mode P5 exists to prevent.
    - Contract: parseDepcruiseJson rejects ({ok:false, non-empty detail}) any
      document whose summary lacks numeric totalCruised/totalDependenciesCruised
      or whose violations is not an array — these route to the error/exit-1 state.
    - Usage Notes: drift documents are handcrafted strings (no fixture file —
      the shapes are degenerate variants of clean.json, not real captures).
    - Quality Contribution: catches depcruise major-version schema drift turning
      the sensor silently green instead of failing loudly.
    - Worked Example: '{"summary":{"violations":{}}}' → {ok:false};
      '{"summary":{"violations":[],"error":0,"warn":0,"info":0}}' (counts absent)
      → {ok:false}
    */
    const driftCases = [
      '{"summary": {"violations": {}}}',
      '{"summary": {"violations": [], "error": 0, "warn": 0, "info": 0}}',
      '{"summary": {"violations": [], "totalCruised": "66", "totalDependenciesCruised": 112}}',
    ];
    for (const doc of driftCases) {
      const result = parseDepcruiseJson(doc);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.detail.length).toBeGreaterThan(0);
      }
    }
  });

  it('given_violation_whose_rule_is_missing_from_ruleset_when_mapped_then_comment_falls_back_not_blank', () => {
    /*
    Test Doc:
    - Why: companion finding F004 — a violation whose rule name has no match in
      summary.ruleSetUsed.forbidden previously joined an EMPTY comment, producing
      blank guidance in next_action ('Fix `x`:  (rules: …)').
    - Contract: the comment join falls back to a non-empty pointer at the config
      file when the rule set carries no comment for the violated rule.
    - Usage Notes: built from the warn-only fixture with the rule name rewritten
      to one absent from the rule set.
    - Quality Contribution: catches comment-join regressions and rule-set/output
      mismatches degrading next_action to unactionable blanks.
    - Worked Example: rule 'ghost-rule' not in rules → comment
      'no comment found for this rule — see .dependency-cruiser.cjs'
    */
    const { parsed, rules } = parsedWithRules('warn-only.json');
    const doc = parsed as {
      summary: { violations: Array<{ rule: { name: string; severity: string } }> };
    };
    for (const v of doc.summary.violations) {
      v.rule.name = 'ghost-rule';
    }
    const decision = mapToDecision(doc, rules);
    expect(decision.status).toBe('degraded');
    for (const v of decision.data.violations) {
      expect(v.comment).toBe('no comment found for this rule — see .dependency-cruiser.cjs');
    }
  });

  it('given_zero_modules_cruised_when_mapped_then_error_exit1_never_ok', () => {
    /*
    Test Doc:
    - Why: the gate held its own denominator and never looked at it. `totalCruised`
      was validated by parseDepcruiseJson and published as data.modules, but no
      branch read it — so an empty cruise (0 modules, 0 violations, valid schema,
      depcruise exit 0) fell through the clean path and reported `ok`. An
      architecture gate that scanned NOTHING has abstained, not passed, and a
      green there is indistinguishable from real enforcement.
    - Contract: summary.totalCruised === 0 → {status:'error', exitIntent:1} with
      error.code E_ARCH_NO_MODULES, regardless of violations being empty.
    - Usage Notes: zero-modules.json is a REAL capture, not a hand-built stub —
      dependency-cruiser 18.1.0 over harness/cli/src under TypeScript 7.0.2
      (2026-08-11), the same tree that cruises 336 modules under TypeScript 6.0.3.
      TS7's native port drops the JS compiler API depcruise parses with, and
      depcruise resolves the HOST project's typescript, so it goes silently blind.
    - Quality Contribution: this is the fixture the gate must REFUSE. Without it
      the new branch is one nobody has watched fire. It also covers the sibling
      route in Gotcha #1 (bare `npx depcruise` scanning 0 modules in directory
      mode), which the config has documented as a comment since plan 016 —
      a comment only fires for a reader who is already suspicious, and nobody is
      suspicious of a green gate.
    - Worked Example: zero-modules.json → {status:'error', exitIntent:1,
      data:{modules:0, dependencies:0, violations:[]},
      error.code:'E_ARCH_NO_MODULES'}
    */
    const { parsed, rules } = parsedWithRules('zero-modules.json');
    const decision = mapToDecision(parsed, rules);

    expect(decision.status).toBe('error');
    expect(decision.exitIntent).toBe(1);
    expect(decision.status).not.toBe('ok');
    expect(decision.error?.code).toBe('E_ARCH_NO_MODULES');
    // The honest counts still travel, so the reader sees the zero itself.
    expect(decision.data).toEqual({ modules: 0, dependencies: 0, violations: [] });
  });

  it('given_zero_modules_when_mapped_then_next_action_names_the_causes_and_the_reproduction', () => {
    /*
    Test Doc:
    - Why: a refusal that does not say what to do converts a false green into a
      confusing red. The reader must learn that nothing was scanned, how to
      reproduce it, and that a passing build/test suite cannot see this — `tsc`
      is a native binary and stays green while depcruise is blind.
    - Contract: next_action is present, states that nothing was scanned, carries
      the raw reproduction command, and names the TypeScript-API cause.
    - Usage Notes: asserts on substrings that must survive rewording, not on the
      whole string.
    - Quality Contribution: stops the guard degrading into a bare 'failed' with
      no route out — the defect class this whole change is about.
    - Worked Example: next_action contains 'scanned NOTHING', 'depcruise --config'
      and 'createProgram'.
    */
    const { parsed, rules } = parsedWithRules('zero-modules.json');
    const decision = mapToDecision(parsed, rules);

    expect(decision.next_action).toBeDefined();
    expect(decision.next_action).toContain('scanned NOTHING');
    expect(decision.next_action).toContain('depcruise --config');
    expect(decision.next_action).toContain('createProgram');
  });

  it('given_zero_modules_with_intact_schema_when_parsed_then_it_is_not_a_parse_failure', () => {
    /*
    Test Doc:
    - Why: the empty cruise must be separable from schema drift. parseDepcruiseJson
      rejects malformed output (contract row 6); an empty-but-well-formed document
      is NOT malformed — it parses cleanly and is refused later, by the mapping,
      for a different and correctly-named reason. Collapsing the two would report
      a tooling incompatibility as corrupt output and send the reader hunting the
      wrong bug.
    - Contract: parseDepcruiseJson(zero-modules.json) → {ok:true}, and the refusal
      arrives from mapToDecision with E_ARCH_NO_MODULES rather than a parse detail.
    - Usage Notes: same real TS7 capture; its schema is fully intact (25 forbidden
      rules present in ruleSetUsed), which is exactly what makes it dangerous.
    - Quality Contribution: pins the boundary between 'output is broken' and
      'output is honestly empty', so each keeps its own diagnosis.
    - Worked Example: parse ok:true → mapToDecision status 'error'
      code 'E_ARCH_NO_MODULES'.
    */
    const parseResult = parseDepcruiseJson(fixture('zero-modules.json'));
    expect(parseResult.ok).toBe(true);

    const { parsed, rules } = parsedWithRules('zero-modules.json');
    expect(mapToDecision(parsed, rules).error?.code).toBe('E_ARCH_NO_MODULES');
  });

  it('given_zero_modules_but_violations_present_when_mapped_then_still_refuses_as_no_modules', () => {
    /*
    Test Doc:
    - Why: ordering has to be deliberate. The guard sits BEFORE the violation
      branches, so an incoherent document (nothing cruised, yet violations
      reported) is refused on the more fundamental fault rather than being
      reported as an ordinary violation over a scan that never happened.
    - Contract: totalCruised === 0 wins over the error/degraded violation paths.
    - Usage Notes: built by grafting the warn-only fixture's violations onto the
      real zero-module summary — a state depcruise should never emit, asserted so
      the precedence is pinned rather than incidental.
    - Quality Contribution: prevents a later refactor from reordering the branches
      and quietly restoring exit 0 for an empty cruise.
    - Worked Example: {totalCruised:0, violations:[warn]} → E_ARCH_NO_MODULES.
    */
    const { parsed: zero, rules } = parsedWithRules('zero-modules.json');
    const { parsed: warn } = parsedWithRules('warn-only.json');
    const doc = zero as { summary: { violations: unknown[] } };
    doc.summary.violations = (warn as { summary: { violations: unknown[] } }).summary.violations;

    const decision = mapToDecision(doc, rules);
    expect(decision.status).toBe('error');
    expect(decision.error?.code).toBe('E_ARCH_NO_MODULES');
  });
});
