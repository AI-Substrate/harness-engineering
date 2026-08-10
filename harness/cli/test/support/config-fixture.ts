import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * THE CONFIG FIXTURE HARNESS (plan 082 tk-0001) — sensors before feature code.
 *
 * A per-agent fixture that materialises a realistic config under an INJECTED home,
 * runs a writer against it, and compares the result byte-for-byte against a
 * COMMITTED GOLDEN FILE.
 *
 * WHY A GOLDEN AND NOT A SELF-DIFF. After a legitimate install the bytes have
 * changed — that is the point of an install — so byte-equality against the INPUT
 * cannot be the check. Only a golden can express "changed in exactly this way and
 * no other".
 *
 * WHY THE INPUT ALREADY CONTAINS git-ai's ENTRIES. Preservation is the property
 * most likely to break silently, and a fixture starting from an empty config could
 * never catch a writer that destroys what was already there. The seeded entries are
 * modelled on the LIVE `~/.cursor/hooks.json` measured on this machine, including
 * its compound shape: git-ai's checkpoint call is one pipeline stage inside a
 * command somebody else wrote.
 *
 * WHY THE KEY ORDER IS DELIBERATELY NOT ALPHABETICAL. `preToolUse` is written
 * before `postToolUse`, which is the real file's order and the reverse of
 * alphabetical. A fixture that happened to be sorted already would go GREEN against
 * a re-sorting writer, and the most-predicted failure would be invisible.
 *
 * INJECTED HOME, BY CONSTRUCTION (dw-0004). Every path is composed from the `home`
 * ARGUMENT. This module imports no `homedir`, reads no `process.env`, and offers no
 * overload that omits the home — so pointing a fixture at the real HOME is not
 * something a caller can do by accident, rather than something convention asks them
 * to avoid. That matters here specifically: the live `~/.cursor/hooks.json` holds
 * the git-ai checkpoint pipeline that phase 1's only end-to-end measurement depends
 * on.
 */

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'hooks');

/** The binary path the goldens were authored against — quoted, as tk-0006 requires. */
export const FIXTURE_BINARY = '"/usr/local/bin/harness"';

export interface AgentFixture {
  /** The agent slug, as it appears in our hook command. */
  agent: string;
  /** Config path RELATIVE to the injected home. */
  relativePath: string;
  /** Committed input, before any install. */
  inputFile: string;
  /** Committed expectation, after a correct install. */
  goldenFile: string;
}

export const FIXTURES: AgentFixture[] = [
  {
    agent: 'cursor',
    relativePath: join('.cursor', 'hooks.json'),
    inputFile: 'cursor.input.json',
    goldenFile: 'cursor.golden.json',
  },
  {
    agent: 'droid',
    relativePath: join('.factory', 'settings.jsonc'),
    inputFile: 'droid.input.jsonc',
    goldenFile: 'droid.golden.jsonc',
  },
];

/** A writer under test: takes the current config text, returns what it would write. */
export type ConfigWriter = (contents: string, fixture: AgentFixture) => string;

export const readFixture = (name: string): string => readFileSync(join(FIXTURE_DIR, name), 'utf8');

/** Materialise the input config under `home`, and return its absolute path. */
export function materialise(home: string, fixture: AgentFixture): string {
  const target = join(home, fixture.relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFixture(fixture.inputFile));
  return target;
}

export interface FixtureResult {
  /** True when the produced bytes equal the golden EXACTLY. */
  matchesGolden: boolean;
  produced: string;
  golden: string;
}

/** Run one writer against one agent's config and compare with the golden. */
export function runWriter(
  home: string,
  fixture: AgentFixture,
  writer: ConfigWriter,
): FixtureResult {
  const target = materialise(home, fixture);
  const produced = writer(readFileSync(target, 'utf8'), fixture);
  writeFileSync(target, produced);
  const golden = readFixture(fixture.goldenFile);
  return { matchesGolden: produced === golden, produced, golden };
}

/** The command a correct install writes for one phase. */
export const ourCommand = (agent: string, phase: 'pre' | 'post'): string =>
  `${FIXTURE_BINARY} hooks fire ${agent} --phase ${phase} --hook-input stdin --hook-owner ai-substrate-harness-hook-v1`;

// ---------------------------------------------------------------------------
// THE KNOWN-BAD WRITERS.
//
// Three, not one, and the count is the point. A deliberate CLOBBER is caught by the
// weakest plausible assertion, so proving the fixture sees deletion proves almost
// nothing. The two failures the workshop actually predicts are git-ai's serde_json
// BTreeMap alphabetical RE-SORT and a JSONC-to-JSON DE-COMMENT, and neither is a
// deletion — both preserve every value and destroy something else.
// ---------------------------------------------------------------------------

/** Strips `//` line comments — never inside a string literal. */
function stripLineComments(text: string): string {
  return text
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

function withOurEntries(doc: Record<string, unknown>, fixture: AgentFixture): void {
  const hooks = doc.hooks as Record<string, { command: string }[]>;
  hooks.preToolUse.push({ command: ourCommand(fixture.agent, 'pre') });
  hooks.postToolUse.push({ command: ourCommand(fixture.agent, 'post') });
}

/** Recursively sorts every object's keys — serde_json's BTreeMap behaviour. */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value === null || typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return Object.fromEntries(entries.map(([k, v]) => [k, sortKeysDeep(v)]));
}

/**
 * KNOWN-BAD 1 — CLOBBER. Replaces the event arrays with only our entry, deleting
 * whatever was there. The easy one; caught by the weakest assertion anyone would
 * write, which is exactly why it cannot be the whole mutation set.
 */
export const clobberWriter: ConfigWriter = (contents, fixture) => {
  const doc = JSON.parse(stripLineComments(contents)) as Record<string, unknown>;
  doc.hooks = {
    preToolUse: [{ command: ourCommand(fixture.agent, 'pre') }],
    postToolUse: [{ command: ourCommand(fixture.agent, 'post') }],
  };
  return `${JSON.stringify(doc, null, 2)}\n`;
};

/**
 * KNOWN-BAD 2 — WHOLE-FILE ALPHABETICAL RE-SORT. Adds our entry correctly and
 * preserves every existing value, then re-serialises with every object's keys
 * sorted. This is git-ai's ACTUAL behaviour (serde_json deserialises into a
 * BTreeMap), and it is invisible to any assertion that checks content rather than
 * bytes: `toContainEqual` passes, a deep-equal passes, and the customer's config
 * has been silently rearranged.
 */
export const alphabeticalResortWriter: ConfigWriter = (contents, fixture) => {
  const doc = JSON.parse(stripLineComments(contents)) as Record<string, unknown>;
  withOurEntries(doc, fixture);
  return `${JSON.stringify(sortKeysDeep(doc), null, 2)}\n`;
};

/**
 * KNOWN-BAD 3 — DE-COMMENT. Adds our entry correctly, preserves key order, and
 * drops every comment, because it parsed JSONC into an object and serialised JSON
 * back out. Comment preservation is one of the four headline defects the workshop
 * exists to fix, and this writer is what a naive implementation actually does.
 */
export const deCommentWriter: ConfigWriter = (contents, fixture) => {
  const doc = JSON.parse(stripLineComments(contents)) as Record<string, unknown>;
  withOurEntries(doc, fixture);
  return `${JSON.stringify(doc, null, 2)}\n`;
};

/**
 * THE POSITIVE CONTROL — not a writer under test.
 *
 * It emits the golden bytes verbatim, so the comparator is proven able to return
 * GREEN. Without it, "all three known-bad writers are RED" would be satisfied just
 * as well by a comparator that never passes at all — a sensor that always fires
 * detects nothing, and the three RED rows would be measuring the fixture's own
 * brokenness. It proves the harness can say yes; it proves nothing about any real
 * writer.
 */
export const goldenWriter: ConfigWriter = (_contents, fixture) => readFixture(fixture.goldenFile);
