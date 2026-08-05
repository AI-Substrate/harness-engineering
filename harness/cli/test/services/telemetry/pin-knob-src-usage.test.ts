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
import {
  combineSession,
  combineSessionAtPinForTests,
} from '../../../src/services/telemetry/session-export.js';

/*
THE CONTROL THAT MAKES THE PIN KNOB SURVIVABLE — FOURTH REWRITE, AND THIS TIME THE
SCAN WAS NOT THE THING THAT CHANGED. Read this before changing it; three previous
versions were correct about the hazard and wrong about where to look for it, and the
fourth was correct about where to look and WRONG ABOUT WHAT IT PROVED.

THE HAZARD. The read pin sits at the FLOOR, so production refuses nothing it could
have read. A `src/` caller passing a HIGHER pin would silently make production
STRICTER — refusing records the stated policy says we read, with nothing in the
output naming who decided it. That is this packet's own defect class (a system
reporting a conclusion it did not reach) arriving through the mitigation for its own
collision. A policy any call site can raise in private is not a policy.
(The pre-reversal control asserted the MIRROR of this — that nobody LOWERED a strict
2.7 pin. That question died with the reversal: nothing is below the floor. Do not
restore it; it would be an assertion that cannot fail.)

WHY THE SCOPE IS NOT "FILES THAT TOUCH THE DECODER" — THE THREE FAILURES.
  1. The first version counted pin KEYS and missed the dynamic pass-through entirely.
  2. The second was rewritten and still ignored `session-export.ts`'s `{ pin: opts.pin }`.
  3. The third covered that site but scoped the property scan to files matching
     /decodeSegment|SegmentDecodeOptions/, "because only those can reach the read
     policy". THAT STATED REASON WAS FALSE. `acts/telemetry.ts` names neither string
     and reaches the read policy through `combineSession`, which accepts and forwards
     a pin. A reviewer planted `{ pin: '2.7' }` there and this file passed 6/6.
Every time the scope was drawn around where the author was looking, and the hazard
lived one hop outside it. Adding `combineSession` to the pattern fixes hop 2 and goes
blind at hop 3, with nothing to say so.

THE FIX IS A CHANGE OF PRINCIPLE, NOT OF PATTERN: SCOPE ON THE PIN, NOT THE DECODER.
The hazard does not live at the decoder. It lives anywhere a pin can be BORN and
flow to one, however many hops away. Hop-counting cannot work, because it requires
enumerating hops and the enumeration is what keeps being wrong. Scanning for
ORIGINATION is hop-count-INDEPENDENT by construction: whatever the chain length,
the value must be WRITTEN somewhere, and in TypeScript that means the identifier
`pin` appears at the origin. So the scan covers EVERY file under `src/` with no
content filter at all, and the 11 resulting sites are declared by hand below.
That list is short because the surface genuinely is: an eleven-entry allowlist is
affordable, and a scope that cannot be argued about is worth more than a short list.

THE FOURTH FAILURE, AND WHY THE ANSWER IS NO LONGER A SCAN. The scan above is not
wrong — it finds every place `pin` is WRITTEN in `src/`, exactly as advertised. The
CLAIM was wrong. A reviewer did not argue the hole, it BUILT one: it added
`combineSession(sessionId, deps, { ...JSON.parse(config) })` to production source and
this file stayed 9/9 GREEN. No `pin` identifier, no `pin:` property, no direct decoder
call — a value arriving through `any` needs no token at all, so every static scan is
defeated at once and none of them is defective. Text scanning can establish "nobody
WROTE a pin"; it cannot establish "no production path can RAISE the pin", and this
file's prose asserted the second.

SO THE DOOR IS SEALED, NOT POLICED (packet ruling #11, reversing the earlier decision
to keep and police the parameter). `pin` is GONE from `CombineSessionOpts`. The
below-pin surfacing lives behind `combineSessionAtPinForTests` — a named export, taking
the pin as a POSITIONAL argument. The shape is the whole point: a FIELD on a bag that
production callers already construct can be filled by DATA, and data leaves nothing to
find; an IDENTIFIER cannot arrive that way, because `JSON.parse` returns values, never
bindings. To reach the seam a caller must WRITE the name, and a written name is the one
thing an exhaustive scan cannot miss. The hazard moved from undetectable to trivially
detectable, which is why the scans below stop being load-bearing and become confirming.

WHAT SEALING DID NOT BUY, stated because the packet's own thesis demands it: the
planted evasion still TYPE-CHECKS. Spreading `any` into an object literal yields `any`,
and excess-property checking does not apply to `any`, so removing the field does not
produce a compiler error at the plant (verified: `tsc --noEmit` exits 0 with the
reviewer's exact line in `src/`). What it produces is INERTNESS — no code reads
`opts.pin` any more, so the bag can carry the key and change nothing. The proof of the
seal is therefore behavioural, not a compiler diagnostic: the control below replays the
reviewer's construction verbatim and asserts the record is READ.

NON-VACUITY. A permissive default makes it very easy to write an assertion that
passes because there is nothing left to catch, so the scan is proved against planted
violations two ways: the reviewer's exact plant and a THIRD-HOP chain are permanent
in-test fixtures below ("the scan's SCOPE is not drawn around the decoder"), and the
Dim-0 mutation gate plants both in real `src/`. A scan that cannot report the
opposite is not a probe.
*/

const SRC = fileURLToPath(new URL('../../../src', import.meta.url));

/** Relative path -> source text. Taking a MAP is what lets the scans be probed. */
type SourceMap = ReadonlyMap<string, string>;

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

function readSrcFiles(): SourceMap {
  const files = new Map<string, string>();
  for (const file of tsFilesUnder(SRC)) {
    files.set(file.slice(SRC.length + 1), readFileSync(file, 'utf8'));
  }
  return files;
}

const REGEX_MAY_FOLLOW = /[([{,;:=!&|?+\-*%~^<>]$/;
const REGEX_MAY_FOLLOW_KEYWORD = /\b(return|typeof|case|in|of|do|else|yield|await|instanceof)$/;

/**
 * Source with comments, string literals and regex literals removed, so `\bpin\b` in
 * what remains is a real IDENTIFIER rather than help text ("--pin <version>") or prose.
 * Template `${...}` interpolations are KEPT — they are code.
 *
 * Newlines are preserved exactly, which is not decoration: `linesAreInSync` below turns
 * that into a fail-closed control. A hand-rolled tokenizer that mistakes a regex literal
 * for a division would swallow the rest of a file and the pin scan would go quietly
 * blind — the precise failure mode this rewrite exists to end. If the line counts ever
 * diverge, the tokenizer is out of step with the language and the scan is untrustworthy,
 * and the suite says so before any allowlist is consulted.
 */
function codeOnly(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  const regexCanStartHere = (): boolean => {
    const t = out.replace(/\s+$/, '');
    return t === '' || REGEX_MAY_FOLLOW.test(t) || REGEX_MAY_FOLLOW_KEYWORD.test(t);
  };
  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && source[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      continue;
    }
    if (c === '/' && regexCanStartHere()) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      for (; j < n; j += 1) {
        const ch = source[j];
        if (ch === '\\') {
          j += 1;
          continue;
        }
        if (ch === '\n') break;
        if (inClass) {
          if (ch === ']') inClass = false;
          continue;
        }
        if (ch === '[') inClass = true;
        else if (ch === '/') {
          closed = true;
          break;
        }
      }
      if (closed) {
        i = j + 1;
        while (i < n && /[a-z]/.test(source[i] ?? '')) i += 1;
        out += ' ';
        continue;
      }
    }
    if (c === "'" || c === '"') {
      const quote = c;
      i += 1;
      while (i < n && source[i] !== quote && source[i] !== '\n') {
        if (source[i] === '\\') i += 1;
        i += 1;
      }
      if (source[i] === quote) i += 1;
      out += ' ';
      continue;
    }
    if (c === '`') {
      i += 1;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === '`') {
          i += 1;
          break;
        }
        if (source[i] === '$' && source[i + 1] === '{') {
          let depth = 1;
          i += 2;
          out += ' ';
          while (i < n && depth > 0) {
            if (source[i] === '{') depth += 1;
            else if (source[i] === '}') {
              depth -= 1;
              if (depth === 0) {
                i += 1;
                break;
              }
            }
            out += source[i];
            i += 1;
          }
          out += ' ';
          continue;
        }
        if (source[i] === '\n') out += '\n';
        i += 1;
      }
      out += ' ';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/** Files whose tokenized form lost or gained a line — i.e. where the scan is blind. */
function desyncedFiles(files: SourceMap): string[] {
  const bad: string[] = [];
  for (const [path, source] of files) {
    if (codeOnly(source).split('\n').length !== source.split('\n').length) bad.push(path);
  }
  return bad.sort();
}

/**
 * THE SCOPE-FOLLOWING SCAN. Every line under `src/` on which the identifier `pin`
 * appears in CODE, as `<relative path>:<code-only line, whitespace collapsed>`.
 * No file filter, no proximity to the decoder, no notion of hops.
 */
function pinIdentifierSites(files: SourceMap): string[] {
  const found: string[] = [];
  for (const [path, source] of files) {
    for (const line of codeOnly(source).split('\n')) {
      if (/\bpin\b/.test(line)) found.push(`${path}:${line.trim().replace(/\s+/g, ' ')}`);
    }
  }
  return found.sort();
}

/**
 * THE DECLARED SET. Exact strings, so a CHANGED line is as loud as a new one, and a
 * new site anywhere under `src/` fails until someone declares it on purpose with an
 * argument attached. That is the entire mechanism.
 *
 * NOTE ON `acts/update.ts`: this is `harness update --pin`, an unrelated pin — the
 * registry version to install. It is listed rather than exempted BY FILE deliberately.
 * A file-level exemption is the same move that failed three times: a scope narrowed by
 * a judgement about what a file "is about". The claim made here is only the one the
 * mechanism can keep — that every place the identifier appears has been looked at —
 * NOT a reachability proof that update's pin cannot reach a decoder.
 */
const DECLARED_PIN_IDENTIFIER_SITES: readonly string[] = [
  // --- harness update --pin: the registry version to install. Different domain. ---
  'acts/update.ts:const spec = normalizePin(opts.pin);',
  'acts/update.ts:data: { pin: opts.pin },',
  'acts/update.ts:if (opts.pin) {',
  'acts/update.ts:message: opts.pin ,', // template interpolation inside an error string
  'acts/update.ts:pin?: string;', // the CLI flag's own option type
  'acts/update.ts:summary: opts.pin ,', // template interpolation inside an error string
  // --- the read policy itself: where the pin is consumed, and nowhere else. ---
  'services/telemetry/segment.ts:const pin = options.pin ?? SEGMENT_SCHEMA_PIN;',
  'services/telemetry/segment.ts:const pinRank = KNOWN_SCHEMA_VERSIONS.indexOf(pin);',
  'services/telemetry/segment.ts:pin?: string;', // SegmentDecodeOptions — the knob
  // --- the one forwarding hop, declared so its callers are a bounded question. ---
  'services/telemetry/session-export.ts:...(readPin === undefined ? {} : { pin: readPin }),',
];

/**
 * Every `src/` occurrence of the TEST-ONLY seam's name. The seal's own control: the
 * pin left `CombineSessionOpts` so no data-shaped value can reach the read policy, and
 * what remains is a door that can ONLY be opened by writing this identifier. Unlike a
 * field on an options bag, that is a thing a text scan can genuinely establish.
 */
function seamCallSites(files: SourceMap): string[] {
  const found: string[] = [];
  for (const [path, source] of files) {
    const body = codeOnly(source);
    for (const match of body.matchAll(/\bcombineSessionAtPinForTests\b/g)) {
      const before = body.slice(Math.max(0, match.index - 30), match.index);
      // The definition itself declares the seam; it does not call it.
      if (/\b(?:export\s+)?function\s+$/.test(before)) continue;
      found.push(path);
    }
  }
  return [...new Set(found)].sort();
}

/**
 * Every `src/` site handing a SECOND argument (the read policy) to the decoder, as
 * `<relative path>:<argument expression>`. An independent door: the identifier scan
 * catches where a pin is born, this catches where one is handed to the decoder.
 * Function DEFINITIONS are excluded — they declare the parameter, they do not supply one.
 */
function pinSupplyingCallSites(files: SourceMap): string[] {
  const found: string[] = [];
  for (const [path, source] of files) {
    const body = codeOnly(source);
    for (const match of body.matchAll(/\bdecodeSegment(?:Detailed)?\s*\(/g)) {
      const open = match.index + match[0].length - 1;
      const before = body.slice(Math.max(0, match.index - 20), match.index);
      if (/\bfunction\s+$/.test(before)) continue;
      const args = topLevelArgs(balancedArgs(body, open));
      if (args.length < 2) continue;
      found.push(`${path}:${(args[1] ?? '').replace(/\s+/g, ' ')}`);
    }
  }
  return found.sort();
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

const DECLARED_PIN_SUPPLY_SITES: readonly string[] = [
  // The narrowing wrapper forwarding its own caller's options — cannot originate.
  'services/telemetry/segment.ts:options',
  // The combine's internal read loop forwarding the bag built at combineSession.
  'services/telemetry/session-export.ts:decodeOptions',
];

/**
 * Every `pin` PROPERTY written under `src/`, as `<relative path>:<expression>`.
 * `pin?:` (a type declaration) is deliberately not matched — it declares the knob
 * rather than filling it, and it is covered by the identifier scan instead.
 */
function pinPropertyExpressions(files: SourceMap): string[] {
  const found: string[] = [];
  for (const [path, source] of files) {
    for (const match of codeOnly(source).matchAll(/[^?\w]pin\s*:\s*([^,;}\n]*)/g)) {
      found.push(`${path}:${(match[1] ?? '').trim()}`);
    }
  }
  return found.sort();
}

const DECLARED_PIN_PROPERTY_SITES: readonly string[] = [
  // The update act forwarding its own CLI flag into an error envelope's data bag.
  'acts/update.ts:opts.pin',
  // The combine's private body threading the pin it was CALLED with — a positional
  // parameter, not a bag field, so nothing data-shaped can arrive here.
  'services/telemetry/session-export.ts:readPin',
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
  it('CONTROL: the tokenizer is in step with every src file — the scan is not blind', () => {
    /*
    Test Doc:
    - Why: every assertion below reads `codeOnly` output. A hand-rolled tokenizer that
      mistook a regex literal for a division would swallow the remainder of a file, and
      a pin inside it would simply not be found — the scan would report "all declared"
      while looking at nothing. That is silent-wrong, the class this packet exists to
      kill, reproduced inside the control meant to catch it.
    - Contract: tokenizing preserves the line count of every file under src/, exactly.
    - Worked Example: an earlier draft handled strings but not regex literals; six real
      files desynced (one lost 316 of 355 lines) and this control named all six.
    */
    expect(desyncedFiles(readSrcFiles())).toEqual([]);
  });

  it("CONTROL: the scan's SCOPE is not drawn around the decoder — planted violations surface", () => {
    /*
    Test Doc:
    - Why: THIS IS THE CONTROL ON THE CONTROL, and the reason the file was rewritten a
      third time. The previous scan skipped any file not naming the decoder, so a pin
      planted where the decoder is never mentioned was invisible AND the suite still
      reported green. A scan that cannot report the opposite is not a probe, so the
      opposite is planted here permanently rather than by hand once.
    - Contract: a violation is found (a) in a file mentioning nothing about the decoder,
      and (b) at a THIRD hop — an origin whose forwarder is itself a forwarder; while a
      file where `pin` appears only in prose and help text is NOT reported.
    - Worked Example: (a) is the reviewer's exact plant against `acts/telemetry.ts`,
      which names neither `decodeSegment` nor `SegmentDecodeOptions` and reaches the
      read policy through `combineSession`.
    */
    const reviewersPlant: SourceMap = new Map([
      [
        'acts/telemetry.ts',
        ['exp = combineSession(sessionId, deps, { pin: ' + "'2.7'" + ' });'].join('\n'),
      ],
    ]);
    expect(pinIdentifierSites(reviewersPlant)).toEqual([
      'acts/telemetry.ts:exp = combineSession(sessionId, deps, { pin: });',
    ]);

    const thirdHop: SourceMap = new Map([
      [
        'services/report/export-for-report.ts',
        [
          'export function exportForReport(o: { pin?: string }) {',
          '  return combineSession(id, deps, { pin: o.pin });',
          '}',
        ].join('\n'),
      ],
      ['acts/report.ts', ["exportForReport({ pin: '2.7' });"].join('\n')],
    ]);
    // BOTH the new forwarder and the origin one hop further out are reported; neither
    // file's distance from the decoder changes whether it is seen.
    expect(pinIdentifierSites(thirdHop)).toEqual([
      'acts/report.ts:exportForReport({ pin: });',
      'services/report/export-for-report.ts:export function exportForReport(o: { pin?: string }) {',
      'services/report/export-for-report.ts:return combineSession(id, deps, { pin: o.pin });',
    ]);

    // GUARD: prose and help text are NOT violations. Without this the allowlist fills
    // with noise, and an allowlist nobody can read is one nobody checks.
    const innocent: SourceMap = new Map([
      [
        'acts/help.ts',
        [
          '// we pin the docs at a sha',
          "const flag = '--pin <version>';",
          '/* --pin: choose a version */',
          'export const help = flag;',
        ].join('\n'),
      ],
    ]);
    expect(pinIdentifierSites(innocent)).toEqual([]);
  });

  it('CONTROL: every src/ occurrence of the identifier `pin` is DECLARED', () => {
    /*
    Test Doc:
    - Why: the live hazard, scanned at its ORIGIN rather than at its destination. A new
      caller writing `{ pin: '2.7' }` — or `{ pin: SEGMENT_SCHEMA_VERSION }`, which a
      literal-only scan waves straight through — makes production refuse live data while
      the declared policy still reads "the floor", and nothing in the envelope names the
      decision. Scanning origination is hop-count-independent; scanning the decoder's
      neighbourhood is not, which is why the previous two versions went blind.
    - Contract: the set of code lines under src/ carrying the identifier `pin` equals
      DECLARED_PIN_IDENTIFIER_SITES, exactly, across ALL files with no content filter.
    */
    expect(pinIdentifierSites(readSrcFiles())).toEqual([...DECLARED_PIN_IDENTIFIER_SITES].sort());
  });

  it('CONTROL: every src/ site that supplies a read policy to the decoder is DECLARED', () => {
    /*
    Test Doc:
    - Why: the second, independent door. The identifier scan catches where a pin is
      born; this catches where one is handed to the decoder, including through a bag
      whose name says nothing about pins.
    - Worked Example: `ref-source.ts` calls `decodeSegmentDetailed(parsed)` with ONE
      argument and so never appears here; giving it a second fails this test, which is
      exactly what happened when that mutation was planted.
    */
    expect(pinSupplyingCallSites(readSrcFiles())).toEqual([...DECLARED_PIN_SUPPLY_SITES].sort());
  });

  it('CONTROL: every src/ `pin:` property is DECLARED — and none of them originates a value', () => {
    /*
    Test Doc:
    - Why: a declared forward is only safe while the bag it forwards cannot be filled in
      by production code. This is the half a reviewer found missing twice.
    - Contract: the pin properties written under src/ equal DECLARED_PIN_PROPERTY_SITES,
      and each expression is a plain member path (a forward), never a value of its own.
      A string literal tokenizes to the empty expression, which fails the shape — so
      `pin: '2.7'` is caught as an ORIGINATION even where the literal itself is stripped.
    */
    const sites = pinPropertyExpressions(readSrcFiles());
    expect(sites).toEqual([...DECLARED_PIN_PROPERTY_SITES].sort());
    for (const site of sites) {
      const expr = site.slice(site.indexOf(':') + 1);
      expect(expr).toMatch(/^[A-Za-z_$][\w$]*(\?)?(\.[A-Za-z_$][\w$]*)*$/);
    }
  });

  it('CONTROL: the SEAL — a `pin` on the production options bag changes NOTHING', () => {
    /*
    Test Doc:
    - Why: THE control for ruling #11, and the one the three scans above could not be.
      A reviewer CONSTRUCTED the evasion rather than arguing it — it added
      `combineSession(id, deps, { ...JSON.parse(config) })` to real `src/` and this file
      stayed 9/9 green: a value arriving through `any` carries no token, so nothing
      textual can see it. The answer is not a better scan. `pin` left
      `CombineSessionOpts`, so the key can be present and mean nothing.
    - Contract: the reviewer's exact construction, replayed here, does NOT raise the
      read policy. The 2.4 record is READ and counted; the refusal tally stays zero.
    - Worked Example: run against the pre-seal source this FAILS with
      `below_pin: 1` — the plant worked, which is precisely why it had to be sealed.
    - Boundary: removing the field does NOT make the plant a compile error (`tsc`
      exits 0 on it — spreading `any` yields `any`). It makes it INERT, and inertness
      is only observable by running it. Hence a behavioural control, not a type one.
    */
    const config = '{"pin":"2.7"}';
    const bag = { root: '/work', ...JSON.parse(config) };
    // The bag really does carry the key — this control is not passing by accident.
    expect((bag as { pin?: string }).pin).toBe('2.7');

    const exp = combineSession(
      'sessKnob',
      bufferOf([{ ...realSegment(), schema_version: '2.4' }]),
      bag,
    );
    expect(exp.summary.segments_refused).toEqual({
      below_pin: 0,
      unsupported_version: 0,
      malformed: 0,
    });
    expect(exp.summary.segment_schema_versions['2.4']).toBe(1);
  });

  it('CONTROL: the one remaining door is an IDENTIFIER, and no src/ file names it', () => {
    /*
    Test Doc:
    - Why: the seal moves the pin behind `combineSessionAtPinForTests`, which keeps
      `below_pin`'s ENVELOPE plumbing exercised at a real caller. That door has to stay
      out of production — but unlike a bag field it CANNOT be opened by data, because
      `JSON.parse` returns values and never bindings. Reaching it requires writing the
      name, so here the scan is sufficient rather than merely the best available.
    - Contract: no file under src/ calls the seam.
    - Worked Example: the guard below plants a call in a file that mentions neither the
      decoder nor a pin, and it is reported.
    */
    expect(seamCallSites(readSrcFiles())).toEqual([]);

    const planted: SourceMap = new Map([
      [
        'acts/report.ts',
        ["const exp = combineSessionAtPinForTests(id, deps, {}, '2.7');"].join(''),
      ],
      ['acts/quiet.ts', ['export const nothing = 1;'].join('')],
    ]);
    expect(seamCallSites(planted)).toEqual(['acts/report.ts']);
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
    reason the seam survives the seal.
    */
    const rec = { ...realSegment(), schema_version: '2.4' };
    expect(decodeSegmentDetailed(rec).ok).toBe(true);
    expect(decodeSegmentDetailed(rec, { pin: '2.7' })).toEqual({
      ok: false,
      reason: 'below_pin',
      schema_version: '2.4',
    });
    expect(decodeSegment(rec, { pin: '2.7' })).toBeNull();
    // …and it reaches the envelope, not just the decoder — through the seam, which is
    // now the only caller-surface path that can.
    const exp = combineSessionAtPinForTests('sessKnob', bufferOf([rec]), { root: '/work' }, '2.7');
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
