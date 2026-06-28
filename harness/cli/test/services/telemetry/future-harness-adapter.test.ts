import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGit } from '../../../src/adapters/git/fake-git.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import {
  type HarnessAdapter,
  nullDefaultAdapter,
} from '../../../src/services/telemetry/adapters/harness-adapter.js';
import {
  type CaptureDeps,
  captureTelemetry,
} from '../../../src/services/telemetry/capture-service.js';
import { sessionDirFor } from '../../../src/services/telemetry/cursor.js';
import {
  SEGMENT_FIELD_KEYS,
  SEGMENT_REQUIRED_KEYS,
  type SegmentInput,
  serializeSegment,
} from '../../../src/services/telemetry/segment.js';

/**
 * T007 (plan 2.6 · AC-12) — a NEW harness adapter registers as a capability
 * module WITHOUT changing the segment schema or capture core. Proven three ways:
 * (1) a partial-capability future adapter serializes to a schema-shaped, all-
 * null-filled segment; (2) the null-default safety net handles any unknown
 * harness; (3) the REAL capture-service consumes an arbitrary adapter (for an
 * already-detected harness) and writes a valid segment — no edit to
 * capture-service.ts needed.
 *
 * Scope note (companion F003): detecting a brand-NEW harness *id* requires
 * extending `HARNESS_ENV_CHAIN` in capture-service — a documented capture-service
 * concern, NOT a capability-seam change. AC-12's "no core change" guarantee is
 * about the adapter/capability layer (proofs 1+2) + the null-default safety net;
 * proof 3 narrowly shows the core consumes an injected adapter unmodified, with
 * the harness still reported by detection.
 */

const REPO = '/repo';

/** A throwaway adapter for a harness that doesn't exist yet — implements ONE capability. */
const futureAdapter: HarnessAdapter = {
  harness: 'acme-harness-9000',
  handles: (id) => id === 'acme-harness-9000',
  extract: () => ({ tools: { AcmeTool: 2 } }), // every other capability omitted/unimplemented
};

describe('T007 — future-harness adapter (AC-12)', () => {
  it('partial caps serialize to a schema-shaped, all-null-filled segment', () => {
    const caps = futureAdapter.extract({
      env: new FakeEnv({}, '/home/x'),
      fs: new FakeFs({}),
      repoRoot: REPO,
      harness: 'acme-harness-9000',
      window: { since: 'session-start', from: 0, to: 0 },
    });
    const input: SegmentInput = {
      command: 'flow',
      harness: 'acme-harness-9000',
      harness_session_id: 'sess-acme',
      timecode: '2026-06-23T00:00:00Z',
      window: { since: 'session-start', from: 0, to: 0 },
      branch: null,
      branch_changed: false,
      tokens: caps.tokens,
      models: caps.models ?? {},
      effort: caps.effort,
      skills: caps.skills ?? {},
      tools: caps.tools ?? {},
      subagents: caps.subagents ?? [],
      files: caps.files ?? { written: [], edited: [] },
      plans_touched: [],
      events: {
        compactions: caps.compactions ?? [],
        api_errors: caps.api_errors ?? 0,
        local_commands: caps.local_commands ?? 0,
      },
      thinking: caps.thinking,
    };
    const seg = serializeSegment(input, REPO);

    // schema-shaped: every key is in the allowlist, the always-present subset is
    // emitted, version pinned. Empty v1-compat collections are omitted (v2).
    for (const k of Object.keys(seg)) expect(SEGMENT_FIELD_KEYS).toContain(k);
    for (const k of SEGMENT_REQUIRED_KEYS) expect(Object.keys(seg)).toContain(k);
    expect(seg.schema_version).toBe('2.1');
    // the one implemented capability survives; everything unimplemented is null/omitted
    expect(seg.tools).toEqual({ AcmeTool: 2 });
    expect(seg.tokens).toBeNull();
    expect(seg.thinking).toBeUndefined();
    expect(seg.skills).toBeUndefined();
    expect(seg.subagents).toBeUndefined();
    expect(seg.files).toBeUndefined();
  });

  it('the null-default safety net handles ANY unknown harness id', () => {
    expect(nullDefaultAdapter.handles('acme-harness-9000')).toBe(true);
    const caps = nullDefaultAdapter.extract({
      env: new FakeEnv({}, '/home/x'),
      fs: new FakeFs({}),
      repoRoot: REPO,
      harness: 'acme-harness-9000',
      window: { since: 'session-start', from: 0, to: 0 },
    });
    expect(caps.tokens).toBeNull();
    expect(caps.tools).toBeNull();
  });

  it('capture-service consumes an arbitrary adapter for an already-detected harness (no core change)', () => {
    const fs = new FakeFs({});
    const deps: CaptureDeps = {
      fs,
      env: new FakeEnv({ CLAUDE_CODE_SESSION_ID: 'sess1' }, '/home/x'),
      clock: new FakeClock('2026-06-23T04:58:00.000Z'),
      proc: new FakeProcess({}, REPO),
      git: new FakeGit({ isRepo: true, branch: 'b', remoteUrl: 'github.com/x/y' }),
      command: 'flow',
      // A brand-new adapter, dropped into the array — capture-service is untouched.
      // It reports a source position (like any real adapter) so the window is non-empty
      // and the capture has activity to spool (FIX-1 skips no-activity captures).
      adapters: [{ ...futureAdapter, handles: () => true, currentPosition: () => 5 }],
    };
    captureTelemetry(deps);

    const entryPath = `${sessionDirFor(REPO, 'sess1')}/1.json`;
    const written = fs.readText(entryPath);
    expect(written).not.toBeNull();
    const seg = JSON.parse(written as string);
    for (const k of Object.keys(seg)) expect(SEGMENT_FIELD_KEYS).toContain(k);
    for (const k of SEGMENT_REQUIRED_KEYS) expect(Object.keys(seg)).toContain(k);
    // The injected adapter's capability flows through unchanged...
    expect(seg.tools).toEqual({ AcmeTool: 2 });
    expect(seg.tokens).toBeNull();
    // ...but detection still reports the env-detected harness (F003): a NEW
    // harness *id* would need a HARNESS_ENV_CHAIN extension (capture-service
    // concern), which is out of the capability-seam AC-12 scope this proves.
    expect(seg.harness).toBe('claude-code');
  });
});
