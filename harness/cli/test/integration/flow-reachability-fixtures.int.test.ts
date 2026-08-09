import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Plan 081 phase 1 — the reachability fixtures behave exactly as their README
 * table promises, measured against the REAL built CLI (the same surface pij
 * workteam verbs will call). This pins the known-bad shapes from
 * AI-Substrate/pij#227 (098/099) red TODAY via `plan validate`, before the
 * phase-2 check verb composes them — a guard that has never failed has only
 * been demonstrated, not tested.
 *
 * Requires `dist/` (the repo builds before tests; CI builds first).
 */
const CLI_DIR = resolve(__dirname, '../..');
const BIN = join(CLI_DIR, 'bin/harness.js');
const FX = join(CLI_DIR, 'test/services/flow/fixtures/reachability');

function run(args: string[]): { env: Record<string, unknown>; code: number } {
  try {
    const out = execFileSync(process.execPath, [BIN, ...args], {
      cwd: resolve(CLI_DIR, '../..'),
      encoding: 'utf8',
    });
    return { env: JSON.parse(out.trim()) as Record<string, unknown>, code: 0 };
  } catch (e) {
    const err = e as { status?: number; stdout?: string };
    return {
      env: JSON.parse((err.stdout ?? '').trim()) as Record<string, unknown>,
      code: err.status ?? -1,
    };
  }
}

describe('reachability fixtures vs the real CLI (plan 081 phase 1)', () => {
  it('dist is built (prerequisite, not a silent skip)', () => {
    expect(existsSync(join(CLI_DIR, 'dist/index.js'))).toBe(true);
  });

  it.each(['098-shaped', '099-shaped'])('%s: plan validate is RED (E400, exit 1)', (shape) => {
    const { env, code } = run(['plan', 'validate', join(FX, shape)]);
    expect(env.status).toBe('error');
    expect((env.error as { code: string }).code).toBe('E400');
    expect(code).toBe(1);
  });

  // ok when the fixtures are git-tracked; degraded (WARN address-target-untracked)
  // in a dirty working tree before first commit — either way zero errors, exit 0.
  it('plan-without-flow: the plan clause alone is green (no errors, exit 0)', () => {
    const { env, code } = run(['plan', 'validate', join(FX, 'plan-without-flow')]);
    expect(['ok', 'degraded']).toContain(env.status);
    expect((env.data as { counts: { error: number } }).counts.error).toBe(0);
    expect(code).toBe(0);
  });

  it('both-good: plan validates AND the flow reads back', () => {
    const plan = run(['plan', 'validate', join(FX, 'both-good')]);
    expect(['ok', 'degraded']).toContain(plan.env.status);
    expect((plan.env.data as { counts: { error: number } }).counts.error).toBe(0);
    const rail = run(['flow', 'rail', '--path', join(FX, 'both-good/the-flow.json')]);
    expect(rail.env.status).toBe('ok');
  });

  it('legacy-flow: reads as E308 (legacy), distinct from absent', () => {
    const { env, code } = run(['flow', 'rail', '--path', join(FX, 'legacy-flow/the-flow.json')]);
    expect((env.error as { code: string }).code).toBe('E308');
    expect(code).toBe(1);
  });

  it('malformed-flow: reads as E300 (invalid), distinct from absent and legacy', () => {
    const { env, code } = run(['flow', 'rail', '--path', join(FX, 'malformed-flow/the-flow.json')]);
    expect((env.error as { code: string }).code).toBe('E300');
    expect(code).toBe(1);
  });

  it('absent flow: reads as E301, the third distinct reason', () => {
    const { env } = run(['flow', 'rail', '--path', join(FX, '098-shaped/the-flow.json')]);
    expect((env.error as { code: string }).code).toBe('E301');
  });
});
