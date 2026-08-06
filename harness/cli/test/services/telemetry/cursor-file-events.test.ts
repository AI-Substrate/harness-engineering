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

/**
 * FX009 — the OBJECT-input write vocabulary (`Write` / `StrReplace`).
 *
 * SHAPE PROVENANCE, stated: these key names entered as INHERITED — UNVERIFIED from
 * an external defect report and were later CONFIRMED against the reporter's own
 * scrubbed transcript (`Write` → `{contents, path}`, `StrReplace` →
 * `{old_string, new_string, path}`), which is committed as the
 * `2026-08-06-write-strreplace` corpus instance. These remain SYNTHETIC unit
 * controls: they pin the negative and edge cases one captured session cannot
 * supply, and the tolerant alternates below are NOT evidence of a producer — they
 * are deliberate slack the read-side counter guards.
 */
describe('cursorAdapter · Write/StrReplace object inputs (FX009)', () => {
  function objectCall(name: string, input: unknown): string {
    return `${JSON.stringify({
      role: 'assistant',
      message: { content: [{ type: 'tool_use', name, input }] },
    })}\n`;
  }

  it('matches the CONFIRMED keys and the tolerant alternates alike', () => {
    // `file_path`/`content` are slack, not observation. Keeping them costs nothing;
    // narrowing them because the confirmed shape passes would remove the only give
    // the extraction has when this toolset is renamed again — and it has been, twice.
    const confirmed = fileEvents(objectCall('Write', { path: 'a.ts', contents: 'one\ntwo\n' }));
    const tolerant = fileEvents(objectCall('Write', { file_path: 'a.ts', content: 'one\ntwo\n' }));
    expect(confirmed).toEqual(tolerant);
    expect(confirmed[0].delta.lines_added).toBe(2);
  });

  it('counts a StrReplace as a MULTISET difference — shared anchor lines are not churn', () => {
    const events = fileEvents(
      objectCall('StrReplace', {
        path: 'a.ts',
        old_string: 'const anchor = 0;\nconst x = 1;\n',
        new_string: 'const anchor = 0;\nconst x = 2;\nconst y = 3;\n',
      }),
    );
    expect(events).toHaveLength(1);
    expect(events[0].change).toBe('edited');
    // `const anchor = 0;` appears on both sides → contributes nothing. Bytes are
    // measured per line WITHOUT the separator: `const x = 2;` + `const y = 3;` = 24.
    expect(events[0].delta).toEqual({
      lines_added: 2,
      lines_removed: 1,
      bytes_added: 24,
      bytes_removed: 12,
    });
  });

  it('keeps SAME-PATH churn as separate events (array push, never last-write-wins)', () => {
    const text = `${objectCall('StrReplace', {
      path: 'a.ts',
      old_string: 'one\n',
      new_string: 'two\n',
    })}${objectCall('StrReplace', { path: 'a.ts', old_string: 'two\n', new_string: 'three\n' })}`;
    const events = fileEvents(text);
    expect(events).toHaveLength(2); // a keyed map would collapse these and lose the churn
    expect(events.every((e) => e.path === 'a.ts')).toBe(true);
  });

  it('produces NOTHING (never a fabricated zero) when no path key matches', () => {
    // This is the branch the read-side counter exists for: extraction runs, yields
    // nothing, and the gap is named downstream instead of passing as a measured 0.
    for (const input of [
      { target_file: 'a.ts', contents: 'x\n' }, // unknown path key
      { path: '   ', contents: 'x\n' }, // blank path
      { path: 'a.ts' }, // no payload at all
      { path: 'a.ts', contents: 42 }, // non-string payload
    ]) {
      expect(fileEvents(objectCall('Write', input))).toEqual([]);
    }
  });

  it('never carries file CONTENT out of the adapter (AC-04, both object branches)', () => {
    const text = `${objectCall('Write', {
      path: 'w.ts',
      contents: 'const token = "SUPER_SECRET_WRITE";\n',
    })}${objectCall('StrReplace', {
      path: 'e.ts',
      old_string: 'const old = "SUPER_SECRET_OLD";\n',
      new_string: 'const neu = "SUPER_SECRET_NEW";\n',
    })}`;
    const caps = extract(text, { capturedAt: CAPTURED_AT });
    const serialized = JSON.stringify(caps);
    for (const secret of ['SUPER_SECRET_WRITE', 'SUPER_SECRET_OLD', 'SUPER_SECRET_NEW']) {
      expect(serialized).not.toContain(secret);
    }
    // …and the measurement still happened: counts survive, text does not.
    expect(caps.tools).toEqual({ Write: 1, StrReplace: 1 });
    expect((caps.event_stream ?? []).filter((e) => e.kind === 'file')).toHaveLength(2);
  });

  it('never carries content through the SERIALIZED segment either (AC-04, end to end)', () => {
    const events = serialize(
      objectCall('Write', { path: 'w.ts', contents: 'password = "hunter2"\n' }),
    );
    expect(JSON.stringify(events)).not.toContain('hunter2');
  });
});

/**
 * FX009 — WINDOWS path shape. The Cursor build that produced the reported session
 * runs on Windows and emits lowercase drive-letter absolute paths (`c:\src\…`).
 * The corpus cannot carry that form: the fixture scrub rebases machine paths, so
 * the committed transcript keeps the BACKSLASH separators but loses the drive
 * letter. These synthetic controls hold the drive-letter half — no real machine
 * data is involved, so there is nothing to scrub.
 */
describe('cursorAdapter · Windows path confinement (FX009)', () => {
  const WIN_REPO = 'c:\\repo';

  function winSerialize(input: unknown, repoRoot = WIN_REPO): Event[] {
    return serialize(
      `${JSON.stringify({
        role: 'assistant',
        message: { content: [{ type: 'tool_use', name: 'Write', input }] },
      })}\n`,
      repoRoot,
    );
  }

  it('relativizes a lowercase drive-letter path INSIDE the repo (separators normalized)', () => {
    const files = winSerialize({ path: 'c:\\repo\\src\\deep\\x.ts', contents: 'a\n' }).filter(
      (e) => e.kind === 'file',
    );
    expect(files.map((e) => e.path)).toEqual(['src/deep/x.ts']);
  });

  it('is drive-letter CASE insensitive (`C:` repo root vs a `c:` payload path)', () => {
    const files = winSerialize({ path: 'c:\\repo\\src\\x.ts', contents: 'a\n' }, 'C:\\repo').filter(
      (e) => e.kind === 'file',
    );
    expect(files.map((e) => e.path)).toEqual(['src/x.ts']);
  });

  it('collapses an out-of-repo Windows path to `<external>` — the filename never leaks', () => {
    const files = winSerialize({
      path: 'c:\\Users\\dev\\secrets\\creds.env',
      contents: 'a\n',
    }).filter((e) => e.kind === 'file');
    expect(files.map((e) => e.path)).toEqual(['<external>']);
    expect(JSON.stringify(files)).not.toContain('creds.env');
    expect(JSON.stringify(files)).not.toContain('Users');
  });

  it('collapses a DIFFERENT DRIVE to `<external>` (a sibling path is not containment)', () => {
    const files = winSerialize({ path: 'd:\\repo\\src\\x.ts', contents: 'a\n' }).filter(
      (e) => e.kind === 'file',
    );
    expect(files.map((e) => e.path)).toEqual(['<external>']);
  });

  it('confines the `files.written`/`files.edited` surface the same way (FX009 §6.2)', () => {
    // Those lists used to go through a BASENAME fallback while `file` events already
    // collapsed to `<external>` — one write, two surfaces, and the quieter one was
    // the honest one. Cursor populates both, so the fix increases exposure here.
    const caps = extract(
      `${JSON.stringify({
        role: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              name: 'Write',
              input: { path: 'c:\\Users\\dev\\secrets\\creds.env', contents: 'a\n' },
            },
          ],
        },
      })}\n`,
      { capturedAt: CAPTURED_AT },
    );
    const input: SegmentInput = {
      command: 'flow',
      harness: 'cursor-agent',
      harness_version: '0.0.0-test',
      harness_session_id: CONV,
      timecode: CAPTURED_AT,
      window: { since: 'session-start', from: 0, to: 99 },
      branch: null,
      tokens: null,
      files: caps.files ?? { written: [], edited: [] },
      event_stream: caps.event_stream ?? undefined,
    };
    const seg = serializeSegment(input, WIN_REPO);
    expect(seg.files).toEqual({ written: ['<external>'], edited: [] });
    expect(JSON.stringify(seg)).not.toContain('creds.env');
  });
});
