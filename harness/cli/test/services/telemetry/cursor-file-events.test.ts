import { describe, expect, it } from 'vitest';
import { FakeDb } from '../../../src/adapters/db/fake-db.js';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  CURSOR_SESSION_ENV,
  CURSOR_TRANSCRIPTS_ENV,
  cursorAdapter,
  cursorTranscriptPath,
} from '../../../src/services/telemetry/adapters/cursor-adapter.js';
import type { HarnessContext } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import type { Event, FileEvent } from '../../../src/services/telemetry/events.js';
import { type SegmentInput, serializeSegment } from '../../../src/services/telemetry/segment.js';

/**
 * Plan 066 — direct unit cover for the Cursor adapter's `ApplyPatch` branch.
 *
 * Cursor logs its edit tool as a `tool_use` whose `input` is the RAW V4A patch
 * STRING (not an object), so the adapter shares copilot's counting parser
 * (`parseApplyPatchDeltas`) and turns each `*** Add/Update/Delete File:` header
 * into one `file` event. Two properties are Cursor-specific and are what these
 * tests pin:
 *
 *  1. **Timing honesty.** The transcript is UNTIMED. With an IDE bubble to anchor
 *     to, a file event is `anchored` at the bubble's time; without one (every
 *     headless CLI session) it takes the capture wall-clock at
 *     `t_precision:'interval'` — "within this window". With NEITHER anchor nor
 *     `capturedAt` the event is DROPPED, never stamped with a fabricated time.
 *  2. **Privacy + confinement.** Only header paths and `+`/`-` line/byte COUNTS
 *     leave the adapter; patch body text never travels. Paths stay raw in the
 *     adapter and are confined by `serializeSegment` (repo-relative, else the
 *     `<external>` sentinel).
 *
 * The real-corpus counterpart is the `2026-08-03-applypatch-textstat` fixture
 * driven by `real-capture.e2e.test.ts`; these are the negative/edge controls a
 * single captured session cannot supply.
 */

const REPO = '/repo';
const HOME = '/home/dev';
const TDIR = '/t/transcripts';
const CONV = 'conv-1';
const CAPTURED_AT = '2026-08-03T22:30:00.000Z';
const BUBBLE_AT = '2026-08-03T21:00:00.000Z';

/** One assistant turn carrying the given `ApplyPatch` inputs, as a JSONL transcript. */
function transcript(...inputs: unknown[]): string {
  const line = {
    role: 'assistant',
    message: { content: inputs.map((input) => ({ type: 'tool_use', name: 'ApplyPatch', input })) },
  };
  return `${JSON.stringify(line)}\n`;
}

/** A `cursorDiskKV` assistant bubble (`type: 2`) — the ONLY timed cursor source. */
function bubbleRows(createdAt: string) {
  return [
    {
      key: `bubbleId:${CONV}:b1`,
      value: JSON.stringify({ type: 2, createdAt, modelInfo: { modelName: 'composer-2.5' } }),
    },
  ];
}

interface ExtractOpts {
  /** Omit to simulate a headless session (no IDE bubbles at all). */
  bubbleAt?: string;
  /** Omit to simulate an adapter invoked without a capture wall-clock. */
  capturedAt?: string;
}

function extract(text: string, opts: ExtractOpts = {}) {
  const ctx: HarnessContext = {
    env: new FakeEnv(
      { [CURSOR_SESSION_ENV]: CONV, [CURSOR_TRANSCRIPTS_ENV]: TDIR },
      opts.bubbleAt === undefined ? undefined : HOME,
    ),
    fs: new FakeFs({ [cursorTranscriptPath(TDIR, CONV)]: text }),
    repoRoot: REPO,
    harness: 'cursor-agent',
    window: { since: 'session-start', from: 0, to: 99 },
    ...(opts.bubbleAt === undefined ? {} : { db: new FakeDb(bubbleRows(opts.bubbleAt)) }),
    ...(opts.capturedAt === undefined ? {} : { capturedAt: opts.capturedAt }),
  };
  return cursorAdapter.extract(ctx);
}

function fileEvents(text: string, opts: ExtractOpts = { capturedAt: CAPTURED_AT }): FileEvent[] {
  return (extract(text, opts).event_stream ?? []).filter((e): e is FileEvent => e.kind === 'file');
}

/** Serialize an extraction so the path-confinement layer (plan 056 · D2) runs. */
function serialize(text: string, repoRoot: string = REPO): Event[] {
  const caps = extract(text, { capturedAt: CAPTURED_AT });
  const input: SegmentInput = {
    command: 'flow',
    harness: 'cursor-agent',
    harness_version: '0.0.0-test',
    harness_session_id: CONV,
    timecode: CAPTURED_AT,
    window: { since: 'session-start', from: 0, to: 99 },
    branch: null,
    tokens: null,
    models: {},
    effort: null,
    skills: {},
    tools: caps.tools ?? {},
    user_prompts: [],
    subagents: [],
    files: caps.files ?? { written: [], edited: [] },
    plans_touched: [],
    events: { compactions: [], api_errors: 0, local_commands: 0 },
    thinking: null,
    event_stream: caps.event_stream ?? undefined,
  };
  return serializeSegment(input, repoRoot).event_stream;
}

describe('cursorAdapter · ApplyPatch → file events (plan 066)', () => {
  it('emits ONE event per `*** File:` header — a multi-file patch is not collapsed', () => {
    const events = fileEvents(
      transcript(
        [
          '*** Begin Patch',
          '*** Add File: a.ts',
          '+one',
          '*** Add File: b.ts',
          '+two',
          '*** Update File: c.ts',
          '@@',
          '-old',
          '+new',
          '*** End Patch',
        ].join('\n'),
      ),
    );
    expect(events.map((e) => e.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('maps `Add File` → written and `Update`/`Delete File` → edited (event + path lists)', () => {
    const text = transcript(
      [
        '*** Begin Patch',
        '*** Add File: new.ts',
        '+added',
        '*** Update File: changed.ts',
        '+touched',
        '*** Delete File: gone.ts',
        '-removed',
        '*** End Patch',
      ].join('\n'),
    );
    expect(fileEvents(text).map((e) => ({ path: e.path, change: e.change }))).toEqual([
      { path: 'new.ts', change: 'written' },
      { path: 'changed.ts', change: 'edited' },
      { path: 'gone.ts', change: 'edited' },
    ]);
    // `Delete` is an EDIT, not a write: only `Add File` ever lands in `written`.
    expect(extract(text, { capturedAt: CAPTURED_AT }).files).toEqual({
      written: ['new.ts'],
      edited: ['changed.ts', 'gone.ts'],
    });
  });

  it('counts `+`/`-` bodies in LINES and UTF-8 BYTES (multibyte chars cost >1 byte)', () => {
    // `+café ☕` → body "café ☕": c,a,f = 3 · é = 2 · space = 1 · ☕ = 3 → 9 bytes.
    // `+ok` → 2 bytes; `-déjà` → body "déjà": d,j = 2 · é,à = 4 → 6 bytes.
    const events = fileEvents(
      transcript(
        [
          '*** Begin Patch',
          '*** Update File: u.ts',
          '+café ☕',
          '+ok',
          '-déjà',
          '*** End Patch',
        ].join('\n'),
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0].delta).toEqual({
      lines_added: 2,
      lines_removed: 1,
      bytes_added: 11, // 9 + 2 — NOT the 8 a naive `.length` char count would give
      bytes_removed: 6, // 6 — NOT 4
    });
  });

  it('ignores context, `@@` hunk markers, and `***` directives — only `+`/`-` count', () => {
    const events = fileEvents(
      transcript(
        [
          '*** Begin Patch',
          '*** Update File: u.ts',
          '@@ class Thing',
          ' unchanged context line',
          '',
          '+real',
          '*** End Patch',
        ].join('\n'),
      ),
    );
    expect(events[0].delta).toEqual({
      lines_added: 1,
      lines_removed: 0,
      bytes_added: 4,
      bytes_removed: 0,
    });
  });

  it('never carries patch BODY text into the extracted capabilities (AC-04)', () => {
    const caps = extract(
      transcript(
        [
          '*** Begin Patch',
          '*** Add File: s.ts',
          '+const token = "SUPER_SECRET_VALUE";',
          '*** End Patch',
        ].join('\n'),
      ),
      { capturedAt: CAPTURED_AT },
    );
    expect(JSON.stringify(caps)).not.toContain('SUPER_SECRET_VALUE');
    expect(caps.tools).toEqual({ ApplyPatch: 1 });
  });
});

describe('cursorAdapter · ApplyPatch path confinement at serialize time', () => {
  it('rewrites an ABSOLUTE in-repo header path to repo-relative', () => {
    const events = serialize(
      transcript(
        ['*** Begin Patch', `*** Add File: ${REPO}/src/deep/x.ts`, '+a', '*** End Patch'].join(
          '\n',
        ),
      ),
    );
    expect(events.filter((e) => e.kind === 'file').map((e) => e.path)).toEqual(['src/deep/x.ts']);
  });

  it('collapses an OUT-OF-repo path to `<external>` — the filename never leaks', () => {
    const events = serialize(
      transcript(
        [
          '*** Begin Patch',
          '*** Add File: /elsewhere/private/creds.env',
          '+a',
          '*** End Patch',
        ].join('\n'),
      ),
    );
    const files = events.filter((e) => e.kind === 'file');
    expect(files.map((e) => e.path)).toEqual(['<external>']);
    expect(JSON.stringify(files)).not.toContain('creds.env');
  });
});

describe('cursorAdapter · ApplyPatch timing honesty (plan 066)', () => {
  const text = transcript(
    ['*** Begin Patch', '*** Add File: a.ts', '+a', '*** End Patch'].join('\n'),
  );

  it('ANCHORS to the bubble timestamp when the IDE timeline exists', () => {
    const events = fileEvents(text, { bubbleAt: BUBBLE_AT, capturedAt: CAPTURED_AT });
    expect(events).toHaveLength(1);
    expect(events[0].t_precision).toBe('anchored');
    expect(events[0].t).toBe(BUBBLE_AT); // the anchor WINS over the capture clock
  });

  it('falls back to INTERVAL at `capturedAt` when there is no bubble (headless session)', () => {
    const events = fileEvents(text, { capturedAt: CAPTURED_AT });
    expect(events).toHaveLength(1);
    expect(events[0].t_precision).toBe('interval');
    expect(events[0].t).toBe(CAPTURED_AT);
  });

  it('DROPS the event (no throw, no fabricated `t`) with neither a bubble nor `capturedAt`', () => {
    const caps = extract(text); // no db, no capturedAt
    expect(caps.event_stream).toBeNull(); // nothing timed and nothing to stamp
    // The path lists are timing-independent, so the write is still REPORTED —
    // the segment stays honest about WHAT changed while claiming nothing about WHEN.
    expect(caps.files).toEqual({ written: ['a.ts'], edited: [] });
  });
});

describe('cursorAdapter · ApplyPatch malformed input (never throws)', () => {
  it('yields no file events for an empty or header-less patch string', () => {
    for (const patch of ['', '   ', 'not a patch at all', '*** Begin Patch\n*** End Patch']) {
      expect(fileEvents(transcript(patch))).toEqual([]);
    }
  });

  it('skips a header with an EMPTY path and keeps parsing the rest of the patch', () => {
    const events = fileEvents(
      transcript(
        [
          '*** Begin Patch',
          '*** Add File: ',
          '+orphaned body line',
          '*** Add File: real.ts',
          '+kept',
          '*** End Patch',
        ].join('\n'),
      ),
    );
    expect(events.map((e) => e.path)).toEqual(['real.ts']);
    expect(events[0].delta.lines_added).toBe(1); // the orphaned body did NOT leak in
  });

  it('ignores a NON-string ApplyPatch input (object/array/number/null) — counted, not parsed', () => {
    const text = transcript(
      { patch: '*** Begin Patch\n*** Add File: a.ts\n+a\n*** End Patch' },
      ['*** Add File: b.ts'],
      42,
      null,
    );
    const caps = extract(text, { capturedAt: CAPTURED_AT });
    expect(caps.event_stream).toBeNull();
    expect(caps.files).toBeNull();
    expect(caps.tools).toEqual({ ApplyPatch: 4 }); // the CALLS are still counted
  });

  it('tolerates a malformed transcript line and still extracts the well-formed one', () => {
    const text = `{ not json\n${transcript(
      ['*** Begin Patch', '*** Add File: a.ts', '+a', '*** End Patch'].join('\n'),
    )}`;
    expect(fileEvents(text).map((e) => e.path)).toEqual(['a.ts']);
  });
});
