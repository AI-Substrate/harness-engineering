import { describe, expect, it } from 'vitest';
import {
  isPlanDocPath,
  planDirCandidates,
  planIdFromPath,
} from '../../../src/services/telemetry/plan-paths.js';

/**
 * The plan-folder path grammar (archive move, PR #106).
 *
 * These tests exist because the defect they pin was NOT a crash. Before the
 * archive move, four call sites each carried their own copy of
 * `/(?:^|\/)docs\/plans\/([^/]+)/`. Moving a plan under `docs/plans/archive/`
 * makes every one of them return the literal string `archive` as the plan id —
 * a confident wrong answer, identical in shape to a right one, which collapses
 * every archived plan's telemetry onto one fabricated plan. Nothing downstream
 * can tell the difference, so the grammar has to be pinned here.
 */
describe('planIdFromPath — archive is a location, never an identity', () => {
  it('lifts the id from a live plan path', () => {
    expect(planIdFromPath('docs/plans/065-deterministic-documents/tasks/x.md')).toBe(
      '065-deterministic-documents',
    );
  });

  it('lifts the SAME id once the plan is archived', () => {
    expect(planIdFromPath('docs/plans/archive/065-deterministic-documents/tasks/x.md')).toBe(
      '065-deterministic-documents',
    );
  });

  it('never reports the `archive` segment as a plan id (the defect this pins)', () => {
    for (const p of [
      'docs/plans/archive/051-pij-fleet-session-eval/plan.md',
      'docs/plans/archive/070-capture-stall/the-flow.json',
      '/abs/repo/docs/plans/archive/001-x/research-dossier.md',
    ]) {
      expect(planIdFromPath(p)).not.toBe('archive');
    }
  });

  it('yields null for the archive folder itself — it is not a plan', () => {
    expect(planIdFromPath('docs/plans/archive')).toBeNull();
    expect(planIdFromPath('docs/plans/archive/')).toBeNull();
  });

  it('works from an absolute path and from any depth', () => {
    expect(planIdFromPath('/Users/x/repo/docs/plans/archive/012-y')).toBe('012-y');
    expect(planIdFromPath('/Users/x/repo/docs/plans/012-y/tasks/phase-1/evidence/a.md')).toBe(
      '012-y',
    );
  });

  it('normalizes Windows separators', () => {
    expect(planIdFromPath('docs\\plans\\archive\\012-y\\tasks\\a.md')).toBe('012-y');
  });

  it('requires the literal `docs/plans/` segment (no false match)', () => {
    expect(planIdFromPath('docs/plansfoo/012-y/a.md')).toBeNull();
    expect(planIdFromPath('docs/plan/012-y/a.md')).toBeNull();
    expect(planIdFromPath('harness/cli/src/index.ts')).toBeNull();
  });
});

describe('isPlanDocPath — a plan does not stop being a plan when it is archived', () => {
  it('matches a live plan document', () => {
    expect(isPlanDocPath('docs/plans/050-semantic-artifact-telemetry/x-plan.md')).toBe(true);
  });

  it('matches the same document under archive/', () => {
    expect(isPlanDocPath('docs/plans/archive/050-semantic-artifact-telemetry/x-plan.md')).toBe(
      true,
    );
  });

  it('does not match a non-plan document inside a plan folder', () => {
    expect(isPlanDocPath('docs/plans/archive/050-x/research-dossier.md')).toBe(false);
    expect(isPlanDocPath('docs/plans/archive/050-x/tasks/phase-1/tasks.md')).toBe(false);
  });

  it('does not match a plan document nested deeper than the plan folder', () => {
    expect(isPlanDocPath('docs/plans/archive/050-x/workshops/deep/y-plan.md')).toBe(false);
  });
});

describe('planDirCandidates — live first, archived second', () => {
  it('offers both locations in resolution order', () => {
    expect(planDirCandidates('065-x')).toEqual(['docs/plans/065-x', 'docs/plans/archive/065-x']);
  });

  it('round-trips: every candidate lifts the id it was built from', () => {
    for (const dir of planDirCandidates('065-deterministic-documents')) {
      expect(planIdFromPath(`${dir}/the-flow.json`)).toBe('065-deterministic-documents');
    }
  });
});
