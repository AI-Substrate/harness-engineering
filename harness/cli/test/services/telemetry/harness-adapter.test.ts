import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  type HarnessCapabilities,
  type HarnessContext,
  nullDefaultAdapter,
} from '../../../src/services/telemetry/adapters/harness-adapter.js';
import {
  SEGMENT_FIELD_KEYS,
  SEGMENT_REQUIRED_KEYS,
  type SegmentInput,
  serializeSegment,
} from '../../../src/services/telemetry/segment.js';

/**
 * T004 (F1 · AC-12) — the HarnessAdapter capability seam + null-default.
 *
 * Proves the seam exists in Phase 1 (so Phase 2 plugs in without touching the
 * capture core) and that a harness present in env but with NO specific adapter
 * still yields a schema-valid, all-null segment via the null-default.
 */

const REPO = '/repo';

function ctx(harness: string): HarnessContext {
  return {
    env: new FakeEnv(),
    fs: new FakeFs(),
    repoRoot: REPO,
    harness,
    window: { since: 'session-start', from: 0, to: 0 },
  };
}

/** Merge adapter capabilities into a segment input (the capture-core seam contract). */
function inputFrom(harness: string, caps: HarnessCapabilities): SegmentInput {
  return {
    command: 'flow',
    harness,
    harness_session_id: caps.harness_session_id ?? 'unknown',
    timecode: '2026-06-23T04:58:00Z',
    window: { since: 'session-start', from: 0, to: 0 },
    branch: null,
    branch_changed: caps.branch_changed ?? false,
    tokens: caps.tokens ?? null,
    models: caps.models ?? {},
    effort: caps.effort ?? null,
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
    thinking: caps.thinking ?? null,
  };
}

describe('T004 — null-default adapter', () => {
  it('handles any harness id (catch-all seam)', () => {
    expect(nullDefaultAdapter.harness).toBe('*');
    expect(nullDefaultAdapter.handles('claude-code')).toBe(true);
    expect(nullDefaultAdapter.handles('a-future-harness')).toBe(true);
  });

  it('extracts all-null capabilities (never estimated)', () => {
    const caps = nullDefaultAdapter.extract(ctx('future-harness'));
    for (const v of Object.values(caps)) {
      expect(v).toBeNull();
    }
  });
});

describe('T004 — a future harness with only the null-default still yields a valid segment (AC-12)', () => {
  it('serializes a schema-valid all-null-capability segment', () => {
    const caps = nullDefaultAdapter.extract(ctx('future-harness'));
    const seg = serializeSegment(inputFrom('future-harness', caps), REPO) as Record<
      string,
      unknown
    >;

    // every always-present field emitted, every emitted key allowlisted (no schema
    // change to add a harness); empty v1-compat collections are omitted (v2)
    for (const key of SEGMENT_REQUIRED_KEYS) {
      expect(seg[key], `required field "${key}" present`).toBeDefined();
    }
    for (const key of Object.keys(seg)) expect(SEGMENT_FIELD_KEYS).toContain(key);
    // capabilities defaulted, never estimated
    expect(seg.tokens).toBeNull();
    expect(seg.effort).toBeNull();
    expect(seg.thinking).toBeUndefined();
    expect(seg.skills).toBeUndefined();
    expect(seg.subagents).toBeUndefined();
    expect(seg.harness).toBe('future-harness');
  });
});
