import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeEnv } from '../../../src/adapters/env/fake-env.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { FakeProcess } from '../../../src/adapters/process/fake-process.js';
import {
  decodeSegment,
  decodeSegmentDetailed,
  KNOWN_SCHEMA_VERSIONS,
  SEGMENT_SCHEMA_PIN,
  type SegmentInput,
  serializeSegment,
} from '../../../src/services/telemetry/segment.js';
import { combineSession } from '../../../src/services/telemetry/session-export.js';

/*
THE CONTROL THAT MAKES THE PIN KNOB SURVIVABLE — AND ITS HAZARD HAS INVERTED.

WHAT THIS FILE USED TO ASSERT, AND WHY THAT IS NOW THE WRONG QUESTION.
While the read pin sat at 2.7, production read narrowly and the knob was an OPT-OUT.
The danger was a `src/` caller quietly lowering the pin, making the build MORE
PERMISSIVE than the declared policy while the constant still read 2.7. So this file
scanned for literal pin values. The reviewer found that scan blind to the dynamic
`{ pin: opts.pin }` pass-through, and it was right — but fixing it to prove the old
claim would prove nothing, because Jordan then reversed the pin TO THE FLOOR. There is
no strict policy left to protect: opting out of a floor pin does nothing, since nothing
is below the floor.

THE LIVE HAZARD IS THE EXACT OPPOSITE, and it is what this file now asserts.
A `src/` caller passing a HIGHER pin would silently make production STRICTER — refusing
records the stated policy says we read, with nothing in the output naming who decided
it. That is this packet's own defect class (a system that could not do something,
reporting something other than that), arriving through the mitigation for its own
collision. The pin's value is a POLICY; a policy any call site can raise in private is
not a policy.

WHY THE PARAMETER IS KEPT AT ALL RATHER THAN DELETED — the alternative was live, and
"a parameter nobody in production should ever set is better deleted than policed" is a
fair rule. At a floor pin `below_pin` is unreachable in production, so this parameter is
the ONLY path by which the reason channel's below-pin plumbing — the envelope field, the
histogram exclusion, the per-reason separation — stays EXERCISED. Delete it and
`below_pin` becomes a decoder-only artifact whose surfacing nothing proves, which is the
vacuity this packet exists to kill. Kept, and policed by the allowlists below.

NON-VACUITY: this control was verified by PLANTING pin-raising call sites in `src/` and
watching it fail (packet log, "the planted-mutation proof"). A permissive default makes
it very easy to write an assertion that passes because there is nothing left to catch;
the allowlists are exact-match precisely so that ANY new or altered pin site fails until
someone re-declares it on purpose.
*/

const SRC = fileURLToPath(new URL('../../../src', import.meta.url));

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Strip block + line comments so prose about the knob never trips the scan. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/.*$/gm, '');
}

/** Text of the balanced parenthesised group starting at `open` (the index of the `(`). */
function balancedArgs(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

/** Split an argument list on TOP-LEVEL commas (nested calls/objects stay intact). */
function topLevelArgs(args: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of args) {
    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim().length > 0) out.push(current.trim());
  return out;
}

/**
 * Every `src/` site that hands a SECOND argument (the read policy) to the decoder, as
 * `<relative path>:<argument expression>`, comments stripped and whitespace collapsed.
 * Function DEFINITIONS are excluded — they declare the parameter, they do not supply one.
 */
function pinSupplyingCallSites(): string[] {
  const found: string[] = [];
  for (const file of tsFilesUnder(SRC)) {
    const body = stripComments(readFileSync(file, 'utf8'));
    for (const match of body.matchAll(/\bdecodeSegment(?:Detailed)?\s*\(/g)) {
      const open = match.index + match[0].length - 1;
      const before = body.slice(Math.max(0, match.index - 20), match.index);
      if (/\bfunction\s+$/.test(before)) continue;
      const args = topLevelArgs(balancedArgs(body, open));
      if (args.length < 2) continue;
      found.push(`${file.slice(SRC.length + 1)}:${(args[1] ?? '').replace(/\s+/g, ' ')}`);
    }
  }
  return found.sort();
}

/**
 * THE DECLARED SET. Exact strings, so a CHANGED expression is as loud as a new site.
 * Adding an entry is a deliberate act with an argument attached; that is the whole
 * mechanism. Every entry must ALSO satisfy the origin rule asserted below: it forwards
 * a caller-supplied optional and never originates a value of its own.
 */
const DECLARED_PIN_SUPPLY_SITES: readonly string[] = [
  // The narrowing wrapper forwarding its own caller's options — cannot originate.
  'services/telemetry/segment.ts:options',
  // The combine's internal read loop forwarding the bag built at combineSession.
  'services/telemetry/session-export.ts:decodeOptions',
];

/**
 * Every `src/` site that writes a `pin` PROPERTY, as `<relative path>:<expression>`.
 * Scoped to files that touch the segment decoder, because only those can reach the read
 * policy — `acts/update.ts` carries an unrelated `--pin` flag and folding it in here
 * would buy a longer list and no more proof.
 */
function pinPropertySites(): string[] {
  const found: string[] = [];
  for (const file of tsFilesUnder(SRC)) {
    const raw = readFileSync(file, 'utf8');
    if (!/decodeSegment|SegmentDecodeOptions/.test(raw)) continue;
    const body = stripComments(raw);
    // `pin?:` (a type declaration) is deliberately not matched — it declares the knob.
    for (const match of body.matchAll(/[^?\w]pin\s*:\s*([^,;}\n]+)/g)) {
      found.push(`${file.slice(SRC.length + 1)}:${(match[1] ?? '').trim()}`);
    }
  }
  return found.sort();
}

const DECLARED_PIN_PROPERTY_SITES: readonly string[] = [
  // combineSession threading its caller's optional pin through, or omitting the key
  // entirely when unset. A pure forward: it can raise nothing on its own initiative.
  'services/telemetry/session-export.ts:opts.pin',
];

/** A genuine, serializer-produced segment — never a bespoke shape. */
function realSegment(over: Partial<SegmentInput> = {}) {
  return serializeSegment(
    {
      command: 'flow',
      harness: 'claude-code',
      harness_session_id: 'sessKnob',
      timecode: '2026-06-29T00:00:00Z',
      window: { since: 'session-start', from: 0, to: 1 },
      branch: 'main',
      event_stream: [],
      ...over,
    } as SegmentInput,
    '/work',
  );
}

function bufferOf(bodies: unknown[]) {
  const files: Record<string, string> = {};
  const names: string[] = [];
  bodies.forEach((body, i) => {
    files[`/work/.harness/temp/telemetry/sessKnob/${i}.json`] = JSON.stringify(body);
    names.push(`${i}.json`);
  });
  return {
    fs: new FakeFs(files, { '/work/.harness/temp/telemetry/sessKnob': names }),
    proc: new FakeProcess({}, '/nowhere'),
    env: new FakeEnv({}, '/home/dev'),
  };
}

describe('no production path can raise the read pin (load-bearing)', () => {
  it('CONTROL: every src/ site that supplies a read policy is DECLARED', () => {
    /*
    Test Doc:
    - Why: the live hazard. A new caller passing `{ pin: '2.7' }` — or
      `{ pin: SEGMENT_SCHEMA_VERSION }`, which the previous literal-only scan would have
      waved straight through — would make production refuse live data while the declared
      policy still read "the floor". Nothing in the envelope would name the decision.
    - Contract: the set of second arguments handed to decodeSegment/decodeSegmentDetailed
      anywhere under src/ equals DECLARED_PIN_SUPPLY_SITES, exactly.
    - Worked Example: `ref-source.ts` calls `decodeSegmentDetailed(parsed)` with ONE
      argument and so never appears here; giving it a second argument fails this test,
      which is exactly what happened when that mutation was planted.
    */
    expect(pinSupplyingCallSites()).toEqual([...DECLARED_PIN_SUPPLY_SITES].sort());
  });

  it('CONTROL: every src/ `pin:` property is DECLARED — and none of them originates a value', () => {
    /*
    Test Doc:
    - Why: the second half of the same hazard, and the half the reviewer found missing.
      A declared CALL site forwarding an identifier is only safe while the bag it
      forwards cannot be filled in by production code; the dynamic pass-through at
      session-export.ts was invisible to the old literal scan.
    - Contract: the pin properties written under src/ equal DECLARED_PIN_PROPERTY_SITES,
      and each expression is a plain member path (a forward), never a literal.
    */
    const sites = pinPropertySites();
    expect(sites).toEqual([...DECLARED_PIN_PROPERTY_SITES].sort());
    for (const site of sites) {
      const expr = site.slice(site.indexOf(':') + 1);
      // A forward looks like `opts.pin`. A literal ('2.7'), a template, a call or a
      // conditional does not — any of those would be production ORIGINATING a policy.
      expect(expr).toMatch(/^[A-Za-z_$][\w$]*(\?)?(\.[A-Za-z_$][\w$]*)*$/);
      expect(expr).not.toContain("'");
      expect(expr).not.toContain('`');
    }
  });

  it('CONTROL: the declared default IS the floor — production refuses nothing it could read', () => {
    /*
    Test Doc:
    - Why: the allowlists prove nobody raises the pin; this proves what the pin they
      cannot raise actually IS. Both halves are needed — an unraised wrong default is
      still a wrong policy.
    - Contract: SEGMENT_SCHEMA_PIN is the oldest DECLARED version, and no known version
      decodes to `below_pin` under the default.
    */
    expect(SEGMENT_SCHEMA_PIN).toBe(KNOWN_SCHEMA_VERSIONS[0]);
    for (const v of KNOWN_SCHEMA_VERSIONS) {
      const result = decodeSegmentDetailed({ ...realSegment(), schema_version: v });
      if (!result.ok) expect(result.reason).not.toBe('below_pin');
    }
  });

  it('CONTROL: the production caller reads an OLD record end-to-end, refusing nothing', () => {
    /*
    Test Doc:
    - Why: a static allowlist cannot tell you the effective policy at runtime. This is
      the behavioural half at a REAL caller (ruling #1.1): a 2.4 record — the version of
      the four frozen real captures, and of most published sessions — is READ, counted,
      and refused by nothing, with no pin passed anywhere.
    */
    const exp = combineSession(
      'sessKnob',
      bufferOf([{ ...realSegment(), schema_version: '2.4' }]),
      {
        root: '/work',
      },
    );
    expect(exp.summary.segments_refused).toEqual({
      below_pin: 0,
      unsupported_version: 0,
      malformed: 0,
    });
    expect(exp.summary.segment_schema_versions['2.4']).toBe(1);
    expect(exp.source.segment_count).toBe(1);
  });

  it('GUARD: the knob is NOT inert — a raised pin genuinely refuses, and names it below_pin', () => {
    /*
    If a raised pin could not actually change the read, the allowlists above would be
    policing a parameter that does nothing, and `below_pin` would be unreachable
    everywhere rather than merely unreachable in production. The machinery has to be
    able to name a below-pin refusal the day someone raises the pin — that is the ONLY
    reason the parameter survives.
    */
    const rec = { ...realSegment(), schema_version: '2.4' };
    expect(decodeSegmentDetailed(rec).ok).toBe(true);
    expect(decodeSegmentDetailed(rec, { pin: '2.7' })).toEqual({
      ok: false,
      reason: 'below_pin',
      schema_version: '2.4',
    });
    expect(decodeSegment(rec, { pin: '2.7' })).toBeNull();
    // …and it reaches the envelope, not just the decoder.
    const exp = combineSession('sessKnob', bufferOf([rec]), { root: '/work', pin: '2.7' });
    expect(exp.summary.segments_refused.below_pin).toBe(1);
  });

  it('GUARD: the pin is a FLOOR, and an UNKNOWN version is never below_pin at any pin', () => {
    const rec = (v: string) => ({ ...realSegment(), schema_version: v });
    // Under a raised 2.5 pin, 2.4 is below and 2.6 is not.
    expect(decodeSegmentDetailed(rec('2.4'), { pin: '2.5' })).toMatchObject({
      reason: 'below_pin',
    });
    expect(decodeSegmentDetailed(rec('2.6'), { pin: '2.5' }).ok).toBe(true);
    // Above the declared set is `unsupported_version` at every pin, including the floor
    // — calling a 2.8 record "below" would assert a relation this build cannot establish.
    for (const pin of [SEGMENT_SCHEMA_PIN, '2.5', '2.7']) {
      expect(decodeSegmentDetailed(rec('2.8'), { pin })).toMatchObject({
        reason: 'unsupported_version',
      });
    }
  });
});
