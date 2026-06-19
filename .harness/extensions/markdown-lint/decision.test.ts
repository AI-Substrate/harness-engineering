import { describe, expect, it } from 'vitest';
import { type CheckResult, decide } from './lib/decision.js';

const mk = (over: Partial<CheckResult> & Pick<CheckResult, 'name' | 'outcome'>): CheckResult => ({
  findings: 0,
  examined: 0,
  summary: '',
  ...over,
});

/**
 * The decision is the honest-envelope contract (AC-03, warn-launch). All four
 * reachable states are proven, plus the precedence rule (unavailable beats
 * findings) and the totals/evidence aggregation.
 */
describe('decide', () => {
  it('all checks pass → ok / exit 0 with evidence counts, no next_action', () => {
    const d = decide([
      mk({ name: 'markdownlint', outcome: 'pass', examined: 42 }),
      mk({ name: 'links', outcome: 'pass', examined: 42 }),
      mk({ name: 'mermaid', outcome: 'pass', examined: 7 }),
    ]);
    expect(d.status).toBe('ok');
    expect(d.exitIntent).toBe(0);
    expect(d.next_action).toBeUndefined();
    expect(d.data.totals).toEqual({
      findings: 0,
      filesLinted: 42,
      linksFilesChecked: 42,
      fencesParsed: 7,
    });
  });

  it('real findings → degraded / exit 0 (warn-launch), next_action names counts', () => {
    const d = decide([
      mk({ name: 'markdownlint', outcome: 'findings', findings: 12, examined: 40 }),
      mk({ name: 'links', outcome: 'pass', examined: 40 }),
      mk({ name: 'mermaid', outcome: 'findings', findings: 2, examined: 5 }),
    ]);
    expect(d.status).toBe('degraded');
    expect(d.exitIntent).toBe(0);
    expect(d.data.totals.findings).toBe(14);
    expect(d.next_action).toContain('14 markdown finding');
    expect(d.next_action).toMatch(/12 markdown lint/);
    expect(d.next_action).toMatch(/2 mermaid syntax/);
  });

  it('a missing tool → unconfigured / exit 2 with an actionable next_action', () => {
    const d = decide([
      mk({
        name: 'markdownlint',
        outcome: 'unavailable',
        unavailableReason: 'markdownlint-cli2 not installed',
      }),
      mk({ name: 'links', outcome: 'pass', examined: 40 }),
      mk({ name: 'mermaid', outcome: 'pass', examined: 5 }),
    ]);
    expect(d.status).toBe('unconfigured');
    expect(d.exitIntent).toBe(2);
    expect(d.next_action).toContain('markdown lint');
    expect(d.next_action).toContain('markdownlint-cli2 not installed');
  });

  it('unavailable takes precedence over findings', () => {
    const d = decide([
      mk({ name: 'markdownlint', outcome: 'findings', findings: 9, examined: 40 }),
      mk({ name: 'links', outcome: 'unavailable', unavailableReason: 'remark-validate-links missing' }),
      mk({ name: 'mermaid', outcome: 'pass', examined: 5 }),
    ]);
    expect(d.status).toBe('unconfigured');
    expect(d.exitIntent).toBe(2);
  });

  it('carries the per-check breakdown through in data.checks', () => {
    const checks = [
      mk({ name: 'markdownlint', outcome: 'pass', examined: 1 }),
      mk({ name: 'links', outcome: 'pass', examined: 1 }),
      mk({ name: 'mermaid', outcome: 'pass', examined: 0 }),
    ];
    expect(decide(checks).data.checks).toBe(checks);
  });
});
