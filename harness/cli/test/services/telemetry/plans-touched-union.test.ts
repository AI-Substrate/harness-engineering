import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import type {
  HarnessAdapter,
  HarnessCapabilities,
} from '../../../src/services/telemetry/adapters/harness-adapter.js';
import {
  type CaptureDeps,
  captureTelemetry,
} from '../../../src/services/telemetry/capture-service.js';
import type { Event } from '../../../src/services/telemetry/events.js';
import type { Segment } from '../../../src/services/telemetry/segment.js';

/**
 * 048 Phase 1 · T1.2-fix (AC-12) — `plans_touched` live-emptiness root cause.
 *
 * Before: `plans_touched` derived ONLY from `HARNESS_PLAN_ID` / a cwd under
 * `docs/plans/<id>/` — neither of which fires in a real run (everyone runs from
 * the repo root, no env var). So the field was live-empty despite the agent
 * editing `docs/plans/<id>/…` files all session.
 *
 * Fix (bounded to capture-service): `plans_touched` = the DEDUPED UNION of
 *   (a) the env/cwd-derived planId (kept for the flight-plan read), PLUS
 *   (b) every distinct `docs/plans/<id>/` prefix in the window's
 *       `files.written` / `files.edited` paths.
 * And the flight-plan READ gains an evidence-derived fallback: env/cwd wins;
 * else a single-plan union reads that plan; a multi-plan union prefers the plan
 * whose own `the-flow.json` is in the touched paths; still ambiguous ⇒ NO flow
 * event (honest) while `plans_touched` keeps the full list.
 */

const REPO = '/repo';
const TEL = '/repo/.harness/temp/telemetry';
const T0 = '2026-07-01T09:00:00Z';
const T1 = '2026-07-01T09:01:00Z';

const TWO_EVENTS: Event[] = [
  { t: T0, kind: 'prompt', words: 4 },
  { t: T1, kind: 'turn', dur_s: 50, out: 120 },
];

function flightPlan(stage: string, status: string, agent = 'the-flow'): string {
  return JSON.stringify({
    provenance: { agent },
    nav: { now: stage },
    nodes: [{ id: stage, status }],
  });
}

function adapter(caps: HarnessCapabilities): HarnessAdapter {
  return {
    harness: 'claude-code',
    handles: (id) => id === 'claude-code',
    currentPosition: () => 240,
    extract: () => caps,
  };
}

/** Capture with a chosen cwd, env, on-disk files, and adapter capabilities. */
function capture(opts: {
  cwd?: string;
  env?: Record<string, string>;
  files?: Record<string, string>;
  caps: HarnessCapabilities;
}): Segment | null {
  const fs = new FakeFs(opts.files ?? {});
  const d: CaptureDeps = {
    fs,
    env: new FakeEnv({ HARNESS_TELEMETRY_CAPTURE: '1', CLAUDE_CODE_SESSION_ID: 'sess1', ...(opts.env ?? {}) }),
    clock: new FakeClock('2026-07-01T09:02:00.000Z'),
    proc: new FakeProcess({}, opts.cwd ?? REPO),
    git: new FakeGit({ isRepo: true, branch: 'feat/x', remoteUrl: 'github.com/x/y' }),
    command: 'flow',
    adapters: [adapter(opts.caps)],
  };
  captureTelemetry(d);
  const raw = fs.readText(`${TEL}/sess1/1.json`);
  return raw === null ? null : (JSON.parse(raw) as Segment);
}

const flowOf = (seg: Segment | null): (Event & { stage?: string }) | undefined =>
  seg?.event_stream.find((e) => e.kind === 'flow') as (Event & { stage?: string }) | undefined;

// ── Union derivation (mutation: union-derivation-dropped ⇒ RED) ──────────────

describe('T1.2-fix — plans_touched = union of env/cwd + touched docs/plans prefixes', () => {
  it('derives plans_touched from touched files when NO env/cwd plan id exists (the live case)', () => {
    const seg = capture({
      cwd: REPO, // repo root — the real run: no cwd plan dir, no HARNESS_PLAN_ID
      caps: {
        event_stream: TWO_EVENTS,
        files: {
          written: ['docs/plans/050-foo/plan.md'],
          edited: ['docs/plans/050-foo/tasks/phase-1.md', 'README.md'],
        },
      },
    });
    // MUTATION union-derivation-dropped: honoring only env/cwd ⇒ [] ⇒ undefined ⇒ RED.
    expect(seg?.plans_touched).toEqual(['050-foo']);
  });

  it('dedupes the union across two distinct touched plans, first-seen order', () => {
    const seg = capture({
      cwd: REPO,
      caps: {
        event_stream: TWO_EVENTS,
        files: {
          written: ['docs/plans/050-foo/a.md', 'docs/plans/051-bar/b.md'],
          edited: ['docs/plans/050-foo/c.md'],
        },
      },
    });
    expect(seg?.plans_touched).toEqual(['050-foo', '051-bar']);
  });

  it('unions the env/cwd plan id WITH the touched-file plans (deduped)', () => {
    const seg = capture({
      cwd: REPO,
      env: { HARNESS_PLAN_ID: '034-x' },
      files: { [`${REPO}/docs/plans/034-x/the-flow.json`]: flightPlan('phase-5', 'in_progress') },
      caps: {
        event_stream: TWO_EVENTS,
        files: { written: ['docs/plans/099-other/notes.md'], edited: ['docs/plans/034-x/y.md'] },
      },
    });
    expect(seg?.plans_touched).toEqual(['034-x', '099-other']);
  });

  it('records no plan link when neither env/cwd NOR any touched file supplies one', () => {
    const seg = capture({
      cwd: REPO,
      caps: { event_stream: TWO_EVENTS, files: { written: ['README.md'], edited: ['src/x.ts'] } },
    });
    expect(seg?.plans_touched).toBeUndefined();
  });

  it('a docs/plansfoo/ sibling never false-matches the touched-file scan (regex hygiene)', () => {
    // `docs/plansfoo/x` is NOT under `docs/plans/` — the literal-segment regex must
    // reject it (relative AND absolute forms). MUTATION docs/plans/ ⇒ docs/plans/?
    // makes the trailing slash optional so `plansfoo` captures `foo` ⇒ RED.
    const seg = capture({
      cwd: REPO,
      files: {
        [`${REPO}/docs/plansfoo/x`]: flightPlan('phase-5', 'in_progress'),
        [`${REPO}/docs/plansfoo/foo/the-flow.json`]: flightPlan('ship', 'in_progress'),
      },
      caps: {
        event_stream: TWO_EVENTS,
        files: {
          written: ['docs/plansfoo/x', `${REPO}/docs/plansfoo/foo/the-flow.json`],
          edited: ['docs/plansfoobar/y.md'],
        },
      },
    });
    // No plan id derived from a plansfoo sibling — and thus NO evidence-derived flow event.
    expect(seg?.plans_touched).toBeUndefined();
    expect(flowOf(seg)).toBeUndefined();
  });
});

// ── Evidence-derived flight-plan read ────────────────────────────────────────

describe('T1.2-fix — flight-plan read gains an evidence-derived fallback', () => {
  it('single touched plan ⇒ reads THAT plan the-flow.json for the flow event', () => {
    const seg = capture({
      cwd: REPO, // no env/cwd plan id
      files: { [`${REPO}/docs/plans/050-foo/the-flow.json`]: flightPlan('phase-5', 'in_progress') },
      caps: {
        event_stream: TWO_EVENTS,
        files: { written: ['docs/plans/050-foo/plan.md'], edited: [] },
      },
    });
    expect(flowOf(seg)).toMatchObject({ kind: 'flow', flow: 'the-flow', stage: 'phase-5' });
    expect(seg?.plans_touched).toEqual(['050-foo']);
  });

  it('multiple plans, exactly ONE with its the-flow.json in touched paths ⇒ prefer it', () => {
    const seg = capture({
      cwd: REPO,
      files: {
        [`${REPO}/docs/plans/050-foo/the-flow.json`]: flightPlan('research', 'in_progress'),
        [`${REPO}/docs/plans/051-bar/the-flow.json`]: flightPlan('ship', 'in_progress'),
      },
      caps: {
        event_stream: TWO_EVENTS,
        files: {
          written: ['docs/plans/050-foo/x.md'],
          edited: ['docs/plans/051-bar/the-flow.json'], // 051-bar's flight plan was touched
        },
      },
    });
    expect(flowOf(seg)?.stage).toBe('ship'); // 051-bar preferred
    expect(seg?.plans_touched).toEqual(['050-foo', '051-bar']);
  });

  it('ambiguous multi-plan window (no the-flow.json touched) ⇒ NO flow event, full list kept', () => {
    const seg = capture({
      cwd: REPO,
      files: {
        [`${REPO}/docs/plans/050-foo/the-flow.json`]: flightPlan('research', 'in_progress'),
        [`${REPO}/docs/plans/051-bar/the-flow.json`]: flightPlan('ship', 'in_progress'),
      },
      caps: {
        event_stream: TWO_EVENTS,
        files: { written: ['docs/plans/050-foo/x.md', 'docs/plans/051-bar/y.md'], edited: [] },
      },
    });
    // MUTATION ambiguous-window-fabricates-flow-event: picking either plan ⇒ a flow
    // event appears ⇒ RED. Honest behavior emits none but keeps both plans.
    expect(flowOf(seg)).toBeUndefined();
    expect(seg?.plans_touched).toEqual(['050-foo', '051-bar']);
  });

  it('env/cwd plan id still wins the flight-plan read over touched-file evidence', () => {
    const seg = capture({
      cwd: REPO,
      env: { HARNESS_PLAN_ID: '034-x' },
      files: {
        [`${REPO}/docs/plans/034-x/the-flow.json`]: flightPlan('plan', 'in_progress'),
        [`${REPO}/docs/plans/099-other/the-flow.json`]: flightPlan('ship', 'in_progress'),
      },
      caps: {
        event_stream: TWO_EVENTS,
        files: { written: ['docs/plans/099-other/z.md'], edited: [] },
      },
    });
    expect(flowOf(seg)?.stage).toBe('plan'); // env plan wins the read
    expect(seg?.plans_touched).toEqual(['034-x', '099-other']);
  });
});
