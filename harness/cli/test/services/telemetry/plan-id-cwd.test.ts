import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type {
  HarnessAdapter,
  HarnessCapabilities,
} from '../../../src/services/telemetry/adapters/harness-adapter.js';
import {
  type CaptureDeps,
  captureTelemetry,
  planIdFromCwd,
} from '../../../src/services/telemetry/capture-service.js';
import type { Segment } from '../../../src/services/telemetry/segment.js';

/**
 * T006 (plan 034 Phase 4 · AC-08) — cwd-based plan-id detection. Before this,
 * `plans_touched` was populated ONLY from `HARNESS_PLAN_ID` (live-smoke finding
 * #2: empty even when working inside `docs/plans/034/`). Now a cwd under
 * `docs/plans/<id>/` derives the link; the env var still wins.
 */

describe('planIdFromCwd', () => {
  it('derives the <ordinal>-<slug> plan dir from a cwd inside it (any depth)', () => {
    expect(planIdFromCwd('/repo/docs/plans/034-harness-telemetry-collection')).toBe(
      '034-harness-telemetry-collection',
    );
    expect(planIdFromCwd('/repo/docs/plans/034-harness-telemetry-collection/tasks/phase-4-x')).toBe(
      '034-harness-telemetry-collection',
    );
  });

  it('normalizes Windows-shaped paths', () => {
    expect(planIdFromCwd('C:\\repo\\docs\\plans\\055-thing\\tasks')).toBe('055-thing');
  });

  it('returns null outside any plan dir, and never false-matches docs/plansfoo', () => {
    expect(planIdFromCwd('/repo/harness/cli')).toBeNull();
    expect(planIdFromCwd('/repo/docs/plans')).toBeNull(); // no id segment
    expect(planIdFromCwd('/repo/docs/plansfoo/x')).toBeNull(); // not docs/plans/
  });
});

function testAdapter(): HarnessAdapter {
  const caps: HarnessCapabilities = {};
  return {
    harness: 'claude-code',
    handles: (id) => id === 'claude-code',
    currentPosition: () => 8,
    extract: () => caps,
  };
}

function captureInto(cwd: string, env: Record<string, string>): Segment | null {
  const fs = new FakeFs({});
  const d: CaptureDeps = {
    fs,
    env: new FakeEnv({ CLAUDE_CODE_SESSION_ID: 'cl-1', ...env }),
    clock: new FakeClock('2026-06-23T11:00:00.000Z'),
    proc: new FakeProcess({}, cwd),
    command: 'flow',
    adapters: [testAdapter()],
  };
  captureTelemetry(d);
  const raw = fs.readText(`${cwd}/.harness/temp/telemetry/cl-1/1.json`);
  return raw === null ? null : (JSON.parse(raw) as Segment);
}

describe('capture wires cwd-derived plan link into the segment (AC-08)', () => {
  it('records plans_touched from the cwd when no HARNESS_PLAN_ID is set', () => {
    const seg = captureInto('/repo/docs/plans/034-x/tasks', {});
    expect(seg?.plans_touched).toEqual(['034-x']);
  });

  it('lets HARNESS_PLAN_ID override the cwd-derived id', () => {
    const seg = captureInto('/repo/docs/plans/034-x/tasks', { HARNESS_PLAN_ID: 'explicit-99' });
    expect(seg?.plans_touched).toEqual(['explicit-99']);
  });

  it('records no plan link when neither the cwd nor the env supplies one', () => {
    const seg = captureInto('/repo/harness/cli', {});
    expect(seg?.plans_touched).toBeUndefined(); // empty ⇒ omitted (v2)
  });
});
