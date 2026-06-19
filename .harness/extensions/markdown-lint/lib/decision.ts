/**
 * Pure check-results → envelope decision for `harness markdown-lint` (plan 029).
 *
 * No I/O, no `node:*` imports, fully synchronous. The shell runs the three tools,
 * normalizes each into a {@link CheckResult}, and hands them here; this maps them
 * to the honest envelope per the plan's warn-launch posture (AC-03):
 *
 *   - any check `unavailable` (missing tool/config)  → unconfigured / exit 2
 *   - else any real findings                         → degraded     / exit 0
 *   - else                                           → ok           / exit 0
 *
 * `exitIntent` documents the contract's exit column so the unit tests can assert
 * it without running the CLI; the kernel still owns the real exit code.
 */

export type CheckName = 'markdownlint' | 'links' | 'mermaid';
export type CheckOutcome = 'pass' | 'findings' | 'unavailable';

export interface CheckResult {
  name: CheckName;
  outcome: CheckOutcome;
  /** Number of issues (0 when `pass`/`unavailable`). */
  findings: number;
  /** Evidence count: files linted / files link-checked / fences parsed. */
  examined: number;
  /** One-line human summary (first finding, or an evidence sentence). */
  summary: string;
  /** Present only when `outcome === 'unavailable'` — why the check could not run. */
  unavailableReason?: string;
}

export interface MdLintDecision {
  status: 'ok' | 'degraded' | 'unconfigured';
  exitIntent: 0 | 2;
  data: {
    checks: CheckResult[];
    totals: {
      findings: number;
      filesLinted: number;
      linksFilesChecked: number;
      fencesParsed: number;
    };
  };
  next_action?: string;
}

const LABEL: Record<CheckName, string> = {
  markdownlint: 'markdown lint',
  links: 'in-repo links/anchors',
  mermaid: 'mermaid syntax',
};

function find(checks: CheckResult[], name: CheckName): CheckResult | undefined {
  return checks.find((c) => c.name === name);
}

function examinedOf(checks: CheckResult[], name: CheckName): number {
  return find(checks, name)?.examined ?? 0;
}

export function decide(checks: CheckResult[]): MdLintDecision {
  const totals = {
    findings: checks.reduce((n, c) => n + (c.outcome === 'findings' ? c.findings : 0), 0),
    filesLinted: examinedOf(checks, 'markdownlint'),
    linksFilesChecked: examinedOf(checks, 'links'),
    fencesParsed: examinedOf(checks, 'mermaid'),
  };
  const data = { checks, totals };

  const unavailable = checks.filter((c) => c.outcome === 'unavailable');
  if (unavailable.length > 0) {
    const detail = unavailable
      .map((c) => `${LABEL[c.name]} (${c.unavailableReason ?? 'unavailable'})`)
      .join('; ');
    return {
      status: 'unconfigured',
      exitIntent: 2,
      data,
      next_action:
        `Set up the missing check(s): ${detail}. Run \`npm install\` at the repo root, ` +
        'then re-run `harness markdown-lint` from the repo root.',
    };
  }

  if (totals.findings > 0) {
    const where = checks
      .filter((c) => c.outcome === 'findings')
      .map((c) => `${c.findings} ${LABEL[c.name]}`)
      .join(', ');
    return {
      status: 'degraded',
      exitIntent: 0,
      data,
      next_action:
        `Review ${totals.findings} markdown finding(s) (${where}) in \`data.checks\` — ` +
        'visible but non-blocking (warn-launch). Fix the authored docs, then promote the ' +
        'gate to error/exit 1 once they are clean (never widen the scope to dodge a finding).',
    };
  }

  return { status: 'ok', exitIntent: 0, data };
}
