import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeGitRead } from '../../../src/adapters/git/fake-git-read.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import {
  emptyRefusalTally,
  readRefSegmentsOutcome,
  totalRefusals,
} from '../../../src/services/telemetry/ref-source.js';
import {
  decodeSegment,
  decodeSegmentDetailed,
  SEGMENT_SCHEMA_PIN,
  type SegmentInput,
  serializeSegment,
} from '../../../src/services/telemetry/segment.js';
import { combineSession } from '../../../src/services/telemetry/session-export.js';

/*
THE 2.7 PIN — a record we will not read must SAY so.

Pre-fix, `decodeSegment` returned `null` for every refusal, so a below-pin record,
a corrupt record, a truncated record and an absent record were the SAME answer to
every caller. Narrowing the accepted version set without adding a reason channel
would have made declined records disappear into that same silence — the packet's
own defect, built on purpose, with a version number on it.

Three reasons, deliberately kept apart:
  below_pin           a KNOWN version below the pin — declined by policy, data is fine
  unsupported_version a version outside the declared set — INCLUDING above the pin,
                      because calling a 2.8 record "below" would be the same defect
  malformed           at the pin and structurally invalid, or no readable version

Ruling #1.1: a control that exercises the decoder ALONE cannot see a caller that
swallows the reason, so the surface controls below ride a REAL caller's output.
*/

const tel = (root: string): string => `${root}/.harness/temp/telemetry`;

/** A genuine, serializer-produced segment — never a bespoke shape. */
function realSegment(over: Partial<SegmentInput> = {}) {
  return serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'sessPin',
      timecode: '2026-06-29T00:00:00Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      event_stream: [],
      ...over,
    } as SegmentInput,
    '/work',
  );
}

/** Lay raw JSON bodies into a FakeFs telemetry buffer as `<seq>.json`. */
function bufferOf(bodies: unknown[]) {
  const files: Record<string, string> = {};
  const names: string[] = [];
  bodies.forEach((body, i) => {
    files[`${tel('/work')}/sessPin/${i}.json`] =
      typeof body === 'string' ? body : JSON.stringify(body);
    names.push(`${i}.json`);
  });
  return {
    fs: new FakeFs(files, { [`${tel('/work')}/sessPin`]: names }),
    proc: new FakeProcess({}, '/nowhere'),
    env: new FakeEnv({}, '/home/dev'),
  };
}

describe('the 2.7 pin — decodeSegmentDetailed names its refusals', () => {
  it('GUARD: a record AT the pin still decodes (the pin declines, it does not break reading)', () => {
    const at = realSegment();
    expect(at.schema_version).toBe(SEGMENT_SCHEMA_PIN);
    const result = decodeSegmentDetailed(at);
    expect(result.ok).toBe(true);
  });

  it('CONTROL: a 2.6 record is below_pin — NOT malformed', () => {
    /*
    Test Doc:
    - Why: the dossier's headline case. Pre-fix this was `null`, byte-identical to a
      corrupt record, so "where did the 2.6 evidence go?" had no answer in the output.
    - Contract: a known version below the pin resolves { ok:false, reason:'below_pin' }
      and carries the version it declared.
    */
    expect(decodeSegmentDetailed({ ...realSegment(), schema_version: '2.6' })).toEqual({
      ok: false,
      reason: 'below_pin',
      schema_version: '2.6',
    });
  });

  it('CONTROL: an ABOVE-pin version is unsupported_version, never below_pin', () => {
    /*
    Test Doc:
    - Why: a 2.8 record is not "below" anything. Labelling it below_pin would assert a
      relation this build cannot establish — the packet's defect class, committed by
      the fix. The third reason exists precisely so that claim is never made.
    */
    expect(decodeSegmentDetailed({ ...realSegment(), schema_version: '2.8' })).toEqual({
      ok: false,
      reason: 'unsupported_version',
      schema_version: '2.8',
    });
  });

  it('CONTROL: malformed stays malformed and is NOT reported as below_pin', () => {
    // At the pin, but structurally invalid — a different fact from a declined version.
    expect(decodeSegmentDetailed({ schema_version: SEGMENT_SCHEMA_PIN })).toEqual({
      ok: false,
      reason: 'malformed',
      schema_version: SEGMENT_SCHEMA_PIN,
    });
    // No readable version at all — still malformed, and the version is honestly null.
    for (const junk of [null, undefined, 42, [], 'nope', {}, { schema_version: 7 }]) {
      expect(decodeSegmentDetailed(junk)).toEqual({
        ok: false,
        reason: 'malformed',
        schema_version: null,
      });
    }
  });

  it('GUARD: the narrowing wrapper still answers Segment | null for callers with nothing to say', () => {
    expect(decodeSegment(realSegment())).not.toBeNull();
    expect(decodeSegment({ ...realSegment(), schema_version: '2.6' })).toBeNull();
  });

  it('CONTROL: the reason path is TOTAL — it never throws and never yields a bare null', () => {
    /*
    Test Doc:
    - Why: ruling #1.2. If the reason-bearing path can collapse on its own failure it
      has re-created the silence it replaced. This repo has shipped one fix that
      reproduced its own defect in its failure branch.
    - Contract: for ANY input, the result is `ok` or carries a named reason.
    */
    const hostile: unknown[] = [
      null,
      undefined,
      0,
      '',
      [],
      {},
      { schema_version: '2.7', event_stream: 'not-an-array' },
      { schema_version: {} },
      Object.create(null),
      {
        get schema_version() {
          return '2.6';
        },
      },
    ];
    for (const input of hostile) {
      const result = decodeSegmentDetailed(input);
      expect(result).not.toBeNull();
      if (!result.ok) {
        expect(['below_pin', 'unsupported_version', 'malformed']).toContain(result.reason);
      }
    }
  });
});

describe('the pin at a REAL caller surface (ruling #1.1 — a channel nobody reads is not a channel)', () => {
  it('CONTROL: combineSession SURFACES a below-pin refusal in the export envelope', () => {
    /*
    Test Doc:
    - Why: THE control for ruling #1.1. Adding a reason to decodeSegment's return does
      not make a caller SAY it — every caller previously collapsed refusals into its
      own "not present" path. A decoder-only control cannot see that, which is the same
      shape as FX003's R1-M9 ("a validator nothing calls proves nothing").
    - Contract: summary.segments_refused counts the declined record, by reason, and the
      record does NOT appear in the schema-version histogram (it was not read).
    */
    const deps = bufferOf([{ ...realSegment(), schema_version: '2.6' }]);
    const exp = combineSession('sessPin', deps, { root: '/work' });
    expect(exp.summary.segments_refused).toEqual({
      below_pin: 1,
      unsupported_version: 0,
      malformed: 0,
    });
    expect(exp.summary.segment_schema_versions['2.6']).toBeUndefined();
  });

  it('CONTROL: the envelope keeps the reasons APART', () => {
    const deps = bufferOf([
      { ...realSegment(), schema_version: '2.6' },
      { ...realSegment(), schema_version: '9.9-private' },
      '{ not json at all',
    ]);
    const exp = combineSession('sessPin', deps, { root: '/work' });
    expect(exp.summary.segments_refused).toEqual({
      below_pin: 1,
      unsupported_version: 1,
      malformed: 1,
    });
  });

  it('GUARD: a clean session reports an ALL-ZERO tally, present and countable', () => {
    /*
    Test Doc:
    - Why: an all-zero tally is the positive claim "I refused nothing". An OMITTED
      field cannot make that claim — it is indistinguishable from a reader that never
      looked, which is the absence-vs-silence confusion this whole packet is about.
    */
    const exp = combineSession('sessPin', bufferOf([realSegment()]), { root: '/work' });
    expect(exp.summary.segments_refused).toEqual(emptyRefusalTally());
    expect(exp.source.segment_count).toBe(1);
  });

  it('GUARD: totalRefusals sums the tally at ONE site (no second, drifting count)', () => {
    expect(totalRefusals({ below_pin: 2, unsupported_version: 3, malformed: 4 })).toBe(9);
    expect(totalRefusals(emptyRefusalTally())).toBe(0);
  });
});

describe('the pin at the OTHER real caller — the ref surface', () => {
  const REF = 'refs/harness-telemetry/2026-06-29/sessPin';
  const blob = (name: string, content: string) => ({ name, content });

  it('CONTROL: readRefSegmentsOutcome keeps below_pin apart from malformed', () => {
    /*
    Test Doc:
    - Why: the second enumerated caller of the decoder (ruling #1.1). Pre-fix this
      path had ONE counter, `skipped`, which folded "declined by the pin" together
      with "would not parse" — the same two facts the envelope must keep apart.
    - Contract: refused is a per-reason tally; skipped remains their SUM, derived at
      one site so it can never disagree with the tally it summarises.
    */
    const gitRead = new FakeGitRead({
      [REF]: [
        blob('0.json', JSON.stringify(realSegment())),
        blob('1.json', JSON.stringify({ ...realSegment(), schema_version: '2.6' })),
        blob('2.json', JSON.stringify({ ...realSegment(), schema_version: '9.9-private' })),
      ],
    });
    const out = readRefSegmentsOutcome(gitRead);
    expect(out.status).toBe('ok');
    expect(out.refused).toEqual({ below_pin: 1, unsupported_version: 1, malformed: 0 });
    expect(out.skipped).toBe(2);
    expect(out.segments.get('sessPin')).toHaveLength(1);
  });

  it("CONTROL: decodeLooseSegment's OWN catch names `malformed` rather than collapsing", () => {
    /*
    Test Doc:
    - Why: ruling #1.2, at the exact function it warns about. `decodeLooseSegment`
      wraps JSON.parse in a try/catch; pre-fix that catch returned a bare `null`. If
      the reason-bearing path collapses on its OWN failure it has re-created the
      silence it exists to remove — in the function that supplies every other check.
    - Contract: unparseable bytes are counted as `malformed`, never as `below_pin`
      and never dropped from the tally.
    */
    const gitRead = new FakeGitRead({
      [REF]: [blob('0.json', '{ this is not json'), blob('1.json', '')],
    });
    const out = readRefSegmentsOutcome(gitRead);
    expect(out.refused).toEqual({ below_pin: 0, unsupported_version: 0, malformed: 2 });
    expect(out.skipped).toBe(2);
  });

  it('GUARD: a clean ref refuses nothing, and a port failure is still NOT a refusal', () => {
    /*
    A failed git read means the surface was never established — categorically
    different from "I read it and declined the contents" (FX001 · R2). The pin's new
    counters must not blur that boundary.
    */
    const clean = new FakeGitRead({ [REF]: [blob('0.json', JSON.stringify(realSegment()))] });
    expect(readRefSegmentsOutcome(clean).refused).toEqual(emptyRefusalTally());

    const failing = new FakeGitRead({ [REF]: [] });
    failing.listTelemetryRefsStrict = () => {
      throw new Error('git exploded');
    };
    const out = readRefSegmentsOutcome(failing);
    expect(out.status).toBe('port_failed');
    expect(out.refused).toEqual(emptyRefusalTally());
  });
});
