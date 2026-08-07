import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import {
  CURSOR_SESSION_ENV,
  CURSOR_TRANSCRIPTS_ENV,
  cursorAdapter,
  cursorTranscriptPath,
} from '../../../src/services/telemetry/adapters/cursor-adapter.js';
import type { HarnessContext } from '../../../src/services/telemetry/adapters/harness-adapter.js';
import type { FileEvent } from '../../../src/services/telemetry/events.js';

/**
 * FX009 — the FAILING-FIRST proof.
 *
 * `cursor-adapter.ts` gates file-event extraction on
 * `name === 'ApplyPatch' && typeof b.input === 'string'`. A Cursor build whose
 * edit tools are `Write` / `StrReplace` passes an OBJECT input, so it falls
 * through BOTH halves of that gate: the tool is still counted in the `tools`
 * histogram, but zero `file` events are emitted. Downstream that publishes a
 * confident 0.0% agent share rather than a gap — a silent zero, which plan 068
 * forbids ("a zero is a measurement, a null is a gap").
 *
 * These tests assert the FIXED behaviour and therefore FAIL against the current
 * adapter. That failure is the point: a control only ever run against the fixed
 * code is demonstrated, not tested.
 *
 * FIXTURE BOUNDARY — stated, not hidden. No `Write`/`StrReplace` specimen exists
 * on this machine: all 7 local Cursor transcripts use `ApplyPatch`, and neither
 * installed `cursor-agent` build contains the `StrReplace` literal. The payload
 * KEY NAMES below are therefore INHERITED — UNVERIFIED, taken from the external
 * defect report. They are not a reconstructed producer fixture and must not be
 * read as one. The `tools`-histogram assertions are the load-bearing ones: they
 * hold whatever the argument keys turn out to be.
 */

const REPO = '/repo';
const TDIR = '/t/transcripts';
const CONV = 'conv-fx009';
const CAPTURED_AT = '2026-08-06T02:00:00.000Z';

/** One assistant turn carrying the given named `tool_use` blocks. */
function transcript(...calls: { name: string; input: unknown }[]): string {
  const line = {
    role: 'assistant',
    message: {
      content: calls.map(({ name, input }) => ({ type: 'tool_use', name, input })),
    },
  };
  return `${JSON.stringify(line)}\n`;
}

function extract(text: string) {
  const ctx: HarnessContext = {
    env: new FakeEnv({ [CURSOR_SESSION_ENV]: CONV, [CURSOR_TRANSCRIPTS_ENV]: TDIR }, undefined),
    fs: new FakeFs({ [cursorTranscriptPath(TDIR, CONV)]: text }),
    repoRoot: REPO,
    harness: 'cursor-agent',
    window: { since: 'session-start', from: 0, to: 99 },
    capturedAt: CAPTURED_AT,
  };
  return cursorAdapter.extract(ctx);
}

function fileEvents(text: string): FileEvent[] {
  return (extract(text).event_stream ?? []).filter((e): e is FileEvent => e.kind === 'file');
}

/** A whole-file `Write`: every line of `contents` is an addition. */
const WRITE_CALL = {
  name: 'Write',
  input: { path: 'src/added.ts', contents: 'export const a = 1;\nexport const b = 2;\n' },
};

/** A `StrReplace`: an old→new pair over one file, the `Edit` shape. */
const STR_REPLACE_CALL = {
  name: 'StrReplace',
  input: {
    path: 'src/changed.ts',
    old_string: 'const x = 1;\n',
    new_string: 'const x = 2;\nconst y = 3;\n',
  },
};

describe('FX009 — cursor object-input write tools', () => {
  it('the tool IS counted today — proving the call is seen, not missed', () => {
    // This one PASSES pre-fix. It isolates the defect: the adapter observes the
    // tool_use, so the zero cannot be blamed on a windowing or parse miss. The
    // extraction gate is the only thing that drops it.
    const caps = extract(transcript(WRITE_CALL, STR_REPLACE_CALL));
    expect(caps.tools).toEqual({ Write: 1, StrReplace: 1 });
  });

  it('emits a file event for a Write object input', () => {
    const events = fileEvents(transcript(WRITE_CALL));
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('src/added.ts');
    expect(events[0]?.change).toBe('written');
    expect(events[0]?.delta.lines_added).toBe(2);
    expect(events[0]?.delta.lines_removed).toBe(0);
  });

  it('emits a file event for a StrReplace object input', () => {
    const events = fileEvents(transcript(STR_REPLACE_CALL));
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('src/changed.ts');
    expect(events[0]?.change).toBe('edited');
    // Multiset difference: `const x = 1;` removed, `const x = 2;` + `const y = 3;` added.
    expect(events[0]?.delta.lines_added).toBe(2);
    expect(events[0]?.delta.lines_removed).toBe(1);
  });

  it('reports the written/edited file surface instead of null', () => {
    const caps = extract(transcript(WRITE_CALL, STR_REPLACE_CALL));
    expect(caps.files).toEqual({ written: ['src/added.ts'], edited: ['src/changed.ts'] });
  });

  it('still handles ApplyPatch — the old vocabulary is never deprecated', () => {
    // Cursor has already renamed its toolset once on this machine (`Read`+`Glob`
    // in June → `ReadFile`+`ApplyPatch` in August). Both vocabularies must work
    // simultaneously; a build speaking either one must be measurable.
    const patch = '*** Update File: src/kept.ts\n+added line\n-removed line\n';
    const events = fileEvents(transcript({ name: 'ApplyPatch', input: patch }));
    expect(events).toHaveLength(1);
    expect(events[0]?.path).toBe('src/kept.ts');
  });
});
