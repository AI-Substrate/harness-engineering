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
WROTE a pin"; it cannot establish that no production path REACHES the read policy, and
this file's prose asserted the second.

SO THE DOOR IS SEALED, NOT POLICED (packet ruling #11, reversing the earlier decision
to keep and police the parameter). `pin` is GONE from `CombineSessionOpts`. The
below-pin surfacing lives behind `combineSessionAtPinForTests` — a named export, taking
the pin as a POSITIONAL argument. That much stands and is worth having: a `pin` key on
the bag is now INERT, so the reviewer's construction buys nothing.

THE FIFTH FAILURE — AND IT IS THE CLAIM AGAIN, NOT THE SCAN. The seal shipped with the
argument that a FIELD can be filled by data but an IDENTIFIER cannot, because
`JSON.parse` returns values and never bindings. The reviewer refuted that by building
it: `Reflect.get(module, config.seam)`, with the seam's NAME and the pin both arriving
from JSON. All eleven pin controls stayed green and a 2.4 record reached `below_pin: 1`.
Under reflection the name is data too. A probe run here (see the log's R5 section)
pushed it further: exporting the seam under a `Symbol` defeats that exact line, and is
then defeated in turn by two hops off the namespace, and by symbol ENUMERATION using no
name at all. Tests and production share one module graph, and reflection is total over
it — so a seam a test can reach is a seam `src/` can reach.

NAME WHAT ACTUALLY HAPPENED: THE THREAT MODEL DRIFTED. This control was built to catch
a developer ACCIDENTALLY raising the pin — adding a caller, forwarding an option,
filling a bag. Five rounds later it was being asked to defend against DELIBERATELY
OBFUSCATED ACCESS: source that JSON-parses a config, reflects a named export out of a
module, and calls it. Nobody writes that by mistake; it is code written to defeat the
check. Both are legitimate concerns and they are NOT THE SAME CONCERN — and the claim
in this file had been quietly ratcheting to cover the second while the mechanism was
built for the first. That mismatch, not the reflection, is the defect: an instrument
whose coverage claim is broader than its coverage. It is the exact thing this packet
exists to kill, committed in the packet's own prose.

THE CLAIM, NARROWED TO WHAT IS ACTUALLY ESTABLISHED (packet ruling #12):
No production call site raises the read pin, and none can do so without writing the
seam's name in source. Deliberate dynamic dispatch is out of scope and unchecked.

Nothing above or below may assert more than that sentence. A control enforces it
("the CLAIM and the SCAN'S COVERAGE agree"), and the gap it names is itself asserted
as a live fact ("KNOWN GAP, ASSERTED") so that closing it later cannot happen silently.
No further scan will be written: a scanner that tried to detect reflection would be a
fifth iteration of the thing that has now been wrong four times, and the sixth
construction would defeat it.

TWO WAYS THE NARROWED CLAIM ESCAPED ITS OWN CONTROL (packet ruling #13). Neither is a
new iteration of the scan; both are the narrowing not carried all the way out.
  1. THE CLAIM LIST WAS SHORT BY ONE FILE. `SegmentDecodeOptions` in `segment.ts`
     still carried the withdrawn blanket wording a full round after it was retracted
     here and at the seam, and the control could not see it because `CLAIM_SITES`
     did not list it. The list is DECLARED on purpose — for the same reason the pin
     allowlist is by line and not by file — and a declared list is worth exactly what
     its declaration is. The answer is to declare the site, not to go hunting with a
     scan.
  2. TITLES WERE READ FROM SOURCE, SO A COMPUTED ONE WAS INVISIBLE. The title check
     matched `describe`/`it` only where the first argument was a LITERAL, so
     `describe(['no production ', 'path can raise it'].join(''), …)` would reprint the
     withdrawn wording in every failure header while the control reported nothing. The
     idiom was not hypothetical: it is the one used below to keep fabricated fixtures
     from self-matching, so the evasion was already in this file, in the author's own
     hand, as a technique.
THE FIX FOR (2) IS STRUCTURAL AND IS NOT A BETTER PARSER. An expression parser that
chased computed titles would be the fifth scan and would lose to the sixth
construction. Titles are now read from the RUNNER'S COLLECTED TREE instead — by then a
computed title has already collapsed to a string, so every construction that produces
the banned wording is caught, because what is inspected is the OUTPUT and not the
expression that made it. Source parsing stays for PROSE, where there is no runtime
equivalent to read.

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
const CLI_ROOT = fileURLToPath(new URL('../../..', import.meta.url));

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
function codeOnly(source: string, comments?: string[]): string {
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
      const from = i;
      while (i < n && source[i] !== '\n') i += 1;
      comments?.push(source.slice(from, i));
      continue;
    }
    if (c === '/' && d === '*') {
      const from = i;
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') out += '\n';
        i += 1;
      }
      i += 2;
      comments?.push(source.slice(from, i));
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
 * pin left `CombineSessionOpts` so nothing arriving as data through the options bag
 * reaches the read policy, and what remains is a door opened by WRITING this identifier.
 *
 * SCOPE, EXACTLY: this establishes that no `src/` file NAMES the seam. It does not
 * establish that no `src/` file can REACH it — `Reflect.get(module, config.seam)`
 * resolves the export with the name arriving as data, and no text scan sees that.
 * Deliberate dynamic dispatch is out of scope and unchecked; see the header.
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
 * COMMENT text only, whitespace collapsed, so a claim can be matched VERBATIM
 * regardless of how it happens to be line-wrapped.
 *
 * Comments ONLY, and that is not tidiness: this file must be able to name the wordings
 * it has retracted without those names counting as the file making them. Prose is where
 * a claim lives; a string literal in a banned-phrase list is the opposite of a claim.
 * The extraction reuses `codeOnly`'s tokenizer rather than adding a second one — a
 * second scanner would be a second answer to "what is a comment here".
 */
function commentProse(source: string): string {
  const comments: string[] = [];
  codeOnly(source, comments);
  return comments
    .join('\n')
    .replace(/^[ \t]*\/[/*]+/gm, ' ')
    .replace(/^[ \t]*\*\/?/gm, ' ')
    .replace(/\s+/g, ' ');
}

/**
 * THE CLAIM. Ruling #12, verbatim, and the ONLY thing this file's mechanism is
 * entitled to say. Both halves matter: the first is what the scans establish, the
 * second is the gap they do not cover, named in the same breath so nobody can read
 * one without the other.
 */
const NARROWED_CLAIM =
  "No production call site raises the read pin, and none can do so without writing the seam's name in source. Deliberate dynamic dispatch is out of scope and unchecked.";

/** The files that carry the claim: this control, the seam it guards, and the knob's own
 * declaration. `segment.ts` was missing from this list for a round, which is how the
 * withdrawn wording survived there — see item 1 of ruling #13 in the header. The list
 * is DECLARED rather than discovered, deliberately: a claim site is a place someone
 * chose to make a promise, and there is no pattern that reliably finds those. Adding a
 * site is a one-line edit; finding one is a reading job, and it stays a reading job.
 */
const CLAIM_SITES: readonly string[] = [
  'src/services/telemetry/segment.ts',
  'src/services/telemetry/session-export.ts',
  'test/services/telemetry/pin-knob-src-usage.test.ts',
];

/**
 * Wordings RETRACTED across rounds #11 and #12, banned so the claim cannot ratchet back
 * up by degrees. That ratchet is what actually failed here: the mechanism never changed
 * scope, the prose around it quietly grew to cover deliberate evasion, and the mismatch
 * went unnoticed for two rounds because nothing compared the two.
 */
const RETRACTED_CLAIMS: readonly string[] = [
  'identifier cannot arrive',
  'no data-shaped value',
  'no production path can raise',
  'cannot miss',
  'trivially detectable',
  'structurally impossible',
  'unnameable',
  'cannot be reached from production',
];

/**
 * The text in which a file MAKES CLAIMS: comment prose, and only that.
 *
 * Not the whole file: the retracted wordings are listed above as string literals, and a
 * file must be able to NAME what it has withdrawn without that counting as it saying
 * so. And no longer titles either — those are read from the runner instead
 * ({@link resolvedTitles}), because a title parsed out of source is only the titles
 * someone wrote as literals.
 */
function claimText(source: string): string {
  return commentProse(source);
}

/** Claim sites whose text says less, or more, than {@link NARROWED_CLAIM}. */
function claimViolations(files: SourceMap): string[] {
  const out: string[] = [];
  for (const [path, source] of files) {
    const text = claimText(source);
    if (!text.includes(NARROWED_CLAIM)) out.push(`${path}: claim missing`);
    const lower = text.toLowerCase();
    for (const banned of RETRACTED_CLAIMS) {
      if (lower.includes(banned)) out.push(`${path}: retracted claim "${banned}"`);
    }
  }
  return out.sort();
}

function readClaimSites(): SourceMap {
  const files = new Map<string, string>();
  for (const rel of CLAIM_SITES) files.set(rel, readFileSync(join(CLI_ROOT, rel), 'utf8'));
  return files;
}

/** The shape this file needs from the runner's collected tree, and nothing more. */
interface CollectedTask {
  name?: unknown;
  tasks?: unknown;
}

/**
 * Every RESOLVED suite and test title in a collected file, READ FROM THE RUNNER rather
 * than parsed out of the source.
 *
 * The ratchet's furthest reach was a TITLE: this suite's own name once asserted, in
 * full, the unrestricted version of the claim — a promise printed on the one line every
 * failure report shows. The first attempt to catch that read titles out of the source,
 * which only ever saw the ones written as string LITERALS; `describe(parts.join(''), …)`
 * printed the banned wording and the check saw nothing.
 *
 * Reading the runner's tree closes the SHAPE rather than that instance. Collection has
 * already finished by the time any test body runs, so every title in the file is
 * present — including suites declared BELOW this one — and every one of them is a plain
 * string, whatever expression produced it. There is nothing left to parse and therefore
 * nothing left to out-write. This is the one place a runtime reading exists; prose has
 * no equivalent, which is why {@link claimText} still reads source.
 */
function resolvedTitles(file: CollectedTask): string[] {
  const out: string[] = [];
  const walk = (tasks: unknown): void => {
    if (!Array.isArray(tasks)) return;
    for (const entry of tasks) {
      const node = entry as CollectedTask;
      if (typeof node.name === 'string') out.push(node.name);
      walk(node.tasks);
    }
  };
  walk(file.tasks);
  return out;
}

/**
 * This control's own title, supplied to `it` as an IDENTIFIER rather than a literal.
 * Deliberate: the reading below must work on titles nobody wrote as a literal, so the
 * control demonstrates the case it exists to cover instead of only asserting it.
 */
const TITLE_CONTROL = 'CONTROL: no RESOLVED title asserts a retracted claim, however assembled';

/** Resolved titles that assert a wording this packet has retracted. */
function titleViolations(titles: readonly string[]): string[] {
  const out: string[] = [];
  for (const title of titles) {
    const lower = title.toLowerCase();
    for (const banned of RETRACTED_CLAIMS) {
      if (lower.includes(banned)) out.push(`title "${title}": retracted claim "${banned}"`);
    }
  }
  return out.sort();
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

describe('no production path raises the read pin without naming it (load-bearing)', () => {
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
      out of production, and this is the half of that a scan can genuinely establish:
      nobody WROTE the name.
    - Contract: no file under src/ names the seam.
    - Worked Example: the guard below plants a call in a file that mentions neither the
      decoder nor a pin, and it is reported.
    - Boundary: naming is not reaching. `Reflect.get(module, config.seam)` resolves the
      export with the name arriving as data and this scan stays green — asserted as a
      live fact by "KNOWN GAP, ASSERTED" below, not left implicit here.
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

  it('KNOWN GAP, ASSERTED: dynamic dispatch DOES reach the seam — the claim says so', async () => {
    /*
    Test Doc:
    - Why: ruling #12. A reviewer refuted the seal's claim by building
      `Reflect.get(module, config.seam)` — the seam's NAME and the pin both arriving
      from JSON, no token of either in source, all eleven pin controls green, and a 2.4
      record reaching `below_pin: 1`. Rather than pretend that hole is shut, or write a
      fifth scan that a sixth construction would defeat, the gap is ASSERTED here as a
      live fact. A gap that is tested cannot be closed by accident and cannot be
      forgotten: the day someone does close it, THIS test fails and forces the claim
      above to be widened deliberately, in writing, by whoever earned it.
    - Contract: the reviewer's exact construction resolves the seam and raises the read
      policy, while `seamCallSites` — correctly, per its stated scope — reports nothing.
    - Boundary: this is why the claim is about what is WRITTEN, not about what can be
      reached. Tests and production share one module graph and reflection is total over
      it, so a seam a test can reach is a seam `src/` can reach. Exporting under a
      `Symbol` defeats this exact line and is then defeated by two hops off the
      namespace, or by symbol enumeration naming nothing at all (probed; see the log).
    */
    const mod = await import('../../../src/services/telemetry/session-export.js');
    const config = JSON.parse('{"seam":"combineSessionAtPinForTests","pin":"2.7"}');
    const reached = Reflect.get(mod, config.seam) as typeof combineSessionAtPinForTests;
    expect(typeof reached).toBe('function');

    const exp = reached(
      'sessKnob',
      bufferOf([{ ...realSegment(), schema_version: '2.4' }]),
      { root: '/work' },
      config.pin,
    );
    expect(exp.summary.segments_refused.below_pin).toBe(1);
    // The scan is not defective — it reports exactly what it claims to, and no more.
    expect(seamCallSites(readSrcFiles())).toEqual([]);
  });

  it("CONTROL: the CLAIM and the SCAN'S COVERAGE agree, gap named in the same breath", () => {
    /*
    Test Doc:
    - Why: THE control for ruling #12, and the one this file needed four rounds ago.
      Every previous failure was read as "the scan looked in the wrong place"; the last
      two were not. The mechanism never over-reached — the PROSE did, ratcheting from
      "nobody wrote a pin" up to a blanket promise about what production could reach,
      with nothing anywhere comparing the two. An instrument whose coverage claim is broader than its coverage is the
      precise defect this whole packet exists to kill, so leaving it unasserted in the
      packet's own control would be the joke telling itself.
    - Contract: all three claim sites carry NARROWED_CLAIM verbatim, and none carries any
      wording retracted in rounds #11 or #12.
    - Worked Example: the pre-fix source of this very file fails it twice — the claim
      was absent, and the suite's own `describe` title asserted a retracted wording
      outright, which is how far the ratchet had got before anything compared them.
      `segment.ts` then failed it the same way a round later, for the duller reason that
      it was never on the list.
    - Boundary: this checks that the claim MATCHES the coverage, in PROSE. It cannot
      check that the coverage is worth having; the scans and behavioural controls above
      do that. Titles are a separate reading, below.
    */
    expect(claimViolations(readClaimSites())).toEqual([]);

    // GUARD, two directions — an assertion that cannot fail is not a control, and
    // with a claim this narrow it would be very easy to write one.
    expect(claimViolations(new Map([['silent.ts', '/* says nothing at all */']]))).toEqual([
      'silent.ts: claim missing',
    ]);
    expect(
      claimViolations(
        new Map([['creep.ts', `/* ${NARROWED_CLAIM} And an identifier cannot arrive as data. */`]]),
      ),
    ).toEqual(['creep.ts: retracted claim "identifier cannot arrive"']);
  });

  it(TITLE_CONTROL, (ctx) => {
    /*
    Test Doc:
    - Why: a title is a claim printed on the one line every failure report shows, and
      the previous reading of them saw only the ones written as string LITERALS. A
      computed title — the exact idiom used for the fabricated fixtures in this file —
      would reprint a withdrawn wording with nothing to report it. Chasing computed
      expressions with a better parser would be the fifth scan; this reads the RUNNER'S
      resolved titles instead, where every construction has already collapsed to a
      string and there is no expression left to out-write.
    - Contract: no resolved suite or test title in this file asserts a retracted wording,
      however that title was assembled.
    - Worked Example: a reviewer planted `describe(['no production ', 'path can raise
      it'].join(''), …)`; source parsing reported nothing and this reading reports it.
    - Boundary: this covers THIS file's titles. Prose is covered above, by source; the
      two readings are separate because only one of them has a runtime form to read.
    */
    const titles = resolvedTitles((ctx.task as unknown as { file: CollectedTask }).file);

    // NON-VACUITY FIRST: if the runner's tree ever changes shape, the walk finds nothing
    // and the assertion below passes by having read no titles at all — which is this
    // packet's own defect class, in the control written to kill it. This test's own
    // title must come back, and it is supplied as an IDENTIFIER rather than a literal,
    // so the runtime path is exercised by the very act of checking it.
    expect(titles).toContain(TITLE_CONTROL);
    expect(titleViolations(titles)).toEqual([]);

    // GUARD. Literal and computed must be caught IDENTICALLY — that identity is the
    // fix, not an accident of it: by the time a title is read there is no difference
    // left between them. And a benign computed title must stay unreported, or the
    // control would just be banning a syntax.
    const written = 'no production path can raise it';
    const assembled = ['no production ', 'path can raise it'].join('');
    expect(titleViolations([written])).toEqual([
      `title "${written}": retracted claim "no production path can raise"`,
    ]);
    expect(titleViolations([assembled])).toEqual([
      `title "${assembled}": retracted claim "no production path can raise"`,
    ]);
    expect(titleViolations([['a benign ', 'computed title'].join('')])).toEqual([]);
  });

  it('KNOWN GAP, ASSERTED: the claim check reads TWO channels, and a code string is not one', () => {
    /*
    Test Doc:
    - Why: ruling #15. The boundary that named this gap first justified it — a string
      never printed as a title reaches nobody — and a reviewer then printed one on
      stderr from a `console.error` in this very file, with the suite green. The lesson
      is not that the justification picked the wrong channel. It is that justifying the
      gap at all requires knowing every way a string can reach a reader — stderr,
      stdout, a thrown message, a snapshot, a report file — and that enumeration has now
      been wrong four rounds running. So the boundary states COVERAGE instead: the two
      channels this check reads, and nothing about the ones it does not. An enumeration
      of what IS read cannot be falsified by finding a third channel, because it never
      spoke about the third.
    - Contract: a fixture carrying the claim in prose and EVERY retracted wording in code
      string literals reports nothing. That silence is scope, not safety.
    - Worked Example: `const decoy = "…";` and `console.error("…")` — neither is a
      comment and neither is a title, so neither is read.
    - Boundary: the day someone widens the channels, this test goes red and forces the
      scope statement to be widened deliberately, in writing. PIN-M17 is that gate. The
      assertion is over the SCAN'S OUTPUT on a fabricated fixture and emits nothing on a
      passing run: a control that printed the retracted wording every run would commit
      the defect it documents. The wordings are taken from the list rather than typed,
      so this test adds no new copy of them to the file.
    */
    const inCode = RETRACTED_CLAIMS.map((c, i) => `const decoy${i} = ${JSON.stringify(c)};`);
    const fixture = [`/* ${NARROWED_CLAIM} */`, ...inCode].join('\n');
    expect(claimViolations(new Map([['code-string.ts', fixture]]))).toEqual([]);

    // GUARD, and it is the load-bearing half. The SAME wordings in the channel that IS
    // read are every one of them reported, so the silence above is the scope and not a
    // fixture that never held banned material — true-but-empty is this packet's own
    // defect class, and it would be very easy to write here.
    const asProse = `/* ${NARROWED_CLAIM} ${RETRACTED_CLAIMS.join('. ')} */`;
    expect(claimViolations(new Map([['prose.ts', asProse]]))).toEqual(
      RETRACTED_CLAIMS.map((c) => `prose.ts: retracted claim "${c}"`).sort(),
    );
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
