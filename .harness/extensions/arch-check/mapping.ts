/**
 * Pure violations→envelope mapping for `harness arch-check` (plan 016, AC-10).
 *
 * No I/O, no `node:*` imports, fully synchronous — the extension shell does the
 * exec/parse plumbing and feeds this function data. Rule comments arrive AS DATA
 * (from the parsed document's own `summary.ruleSetUsed.forbidden`), never via an
 * import, so the function stays pure and the explanation travels with the failure.
 *
 * Contract: spec § Envelope & Exit Contract. The kernel owns the real exit code
 * (status → exit); `exitIntent` documents this module's intent so the unit tests
 * can assert the contract's exit column without running the CLI.
 */

/** The slice of a depcruise rule the mapping reads (from summary.ruleSetUsed.forbidden). */
export interface DepcruiseRule {
  name: string;
  comment?: string;
  severity?: string;
}

/** The slice of depcruise's `--output-type json` document the mapping reads. */
export interface DepcruiseSummary {
  summary: {
    totalCruised: number;
    totalDependenciesCruised: number;
    violations: Array<{
      from: string;
      to: string;
      rule: { name: string; severity: string };
    }>;
  };
}

/** Flattened violation per the spec's pinned `data` shape (comment joined in). */
export interface ArchViolation {
  from: string;
  to: string;
  rule: string;
  severity: string;
  comment: string;
}

export interface ArchDecision {
  status: 'ok' | 'degraded' | 'error';
  /** What the contract's exit column says for this status; the kernel derives the real exit. */
  exitIntent: 0 | 1;
  data: { modules: number; dependencies: number; violations: ArchViolation[] };
  error?: { code: string; message: string };
  next_action?: string;
}

export type ParseResult = { ok: true; parsed: unknown } | { ok: false; detail: string };

/**
 * Parse depcruise stdout. Pure (string in, result out) — extracted here so the
 * malformed-output state (contract row 6) is unit-provable. depcruise 17.4.3
 * exits 0 from `--output-type json` even with error-severity violations
 * (measured 2026-06-10), so parsing stdout is the only honest detection path —
 * callers must never trust the exit code instead.
 */
export function parseDepcruiseJson(stdout: string): ParseResult {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== 'object' || parsed === null || !('summary' in parsed)) {
      return { ok: false, detail: 'parsed JSON but found no `summary` — not depcruise output' };
    }
    // Schema guard (companion finding F004): JSON that parses but has drifted
    // shape must fail LOUDLY, never surface as ok with undefined counts.
    const summary = (parsed as { summary: unknown }).summary;
    if (typeof summary !== 'object' || summary === null) {
      return { ok: false, detail: '`summary` is not an object — not depcruise output' };
    }
    const s = summary as Record<string, unknown>;
    if (!Array.isArray(s.violations)) {
      return { ok: false, detail: '`summary.violations` is not an array — schema drift' };
    }
    if (typeof s.totalCruised !== 'number' || typeof s.totalDependenciesCruised !== 'number') {
      return {
        ok: false,
        detail: '`summary.totalCruised`/`totalDependenciesCruised` missing or non-numeric — schema drift',
      };
    }
    return { ok: true, parsed };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : String(e) };
  }
}

/** Deterministic order: by `from`, then `to`, then `rule` — never depcruise's emission order. */
function byFromToRule(a: ArchViolation, b: ArchViolation): number {
  if (a.from !== b.from) return a.from < b.from ? -1 : 1;
  if (a.to !== b.to) return a.to < b.to ? -1 : 1;
  if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
  return 0;
}

export function mapToDecision(parsed: unknown, rules: DepcruiseRule[]): ArchDecision {
  const { summary } = parsed as DepcruiseSummary;
  // Fallback keeps next_action actionable when the rule set carries no comment
  // for a violated rule (companion finding F004 — blank guidance is worse than
  // a pointer at the config).
  const commentFor = (name: string): string => {
    const comment = rules.find((r) => r.name === name)?.comment;
    return comment && comment.length > 0
      ? comment
      : 'no comment found for this rule — see .dependency-cruiser.cjs';
  };

  const violations: ArchViolation[] = (summary.violations ?? [])
    .map((v) => ({
      from: v.from,
      to: v.to,
      rule: v.rule.name,
      severity: v.rule.severity,
      comment: commentFor(v.rule.name),
    }))
    .sort(byFromToRule);

  const data = {
    modules: summary.totalCruised,
    dependencies: summary.totalDependenciesCruised,
    violations,
  };

  const firstError = violations.find((v) => v.severity === 'error');
  if (firstError) {
    return {
      status: 'error',
      exitIntent: 1,
      data,
      error: {
        code: 'E_ARCH_VIOLATION',
        message: `${violations.length} architecture violation(s)`,
      },
      next_action: `Fix \`${firstError.rule}\`: ${firstError.comment} (rules: .dependency-cruiser.cjs)`,
    };
  }

  if (violations.length > 0) {
    const ruleNames = [...new Set(violations.map((v) => v.rule))].sort().join(', ');
    return {
      status: 'degraded',
      exitIntent: 0,
      data,
      next_action:
        `Review ${violations.length} warn-severity architecture violation(s) (rules: ${ruleNames}). ` +
        `Promote a rule's severity to 'error' in .dependency-cruiser.cjs once it should block — ` +
        `and never weaken a rule in the same PR that trips it.`,
    };
  }

  return { status: 'ok', exitIntent: 0, data };
}
