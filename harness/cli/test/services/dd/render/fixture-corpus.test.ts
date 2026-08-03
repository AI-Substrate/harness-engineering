import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerBuildCommand } from '../../../../src/acts/dd/build.js';
import { FakeClock } from '../../../../src/adapters/clock/fake-clock.js';
import { ErrorCodes } from '../../../../src/output/error-codes.js';
import type { CliIo } from '../../../../src/output/output-port.js';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));
const README = readFileSync(`${FIXTURES}README.md`, 'utf8');

function files(suffix: string, relativeDir = ''): string[] {
  return readdirSync(`${FIXTURES}${relativeDir}`, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${relativeDir}${entry.name}`;
    return entry.isDirectory()
      ? files(suffix, `${relative}/`)
      : relative.endsWith(suffix)
        ? [relative]
        : [];
  });
}

/** Every adapter failure class the pipeline must name, and the fixture that provokes it. */
const ADAPTER_CLASSES = [
  { field: 'missing', adapter: null, code: ErrorCodes.DD_ADAPTER_NOT_FOUND },
  { field: 'broken', adapter: 'broken.ts', code: ErrorCodes.DD_ADAPTER_LOAD_FAILED },
  { field: 'shapeless', adapter: 'shapeless.ts', code: ErrorCodes.DD_ADAPTER_LOAD_FAILED },
  { field: 'boom', adapter: 'boom.ts', code: ErrorCodes.DD_ADAPTER_RUNTIME_FAILED },
  { field: 'numeric', adapter: 'numeric.ts', code: ErrorCodes.DD_ADAPTER_OUTPUT_INVALID },
] as const;

const ADAPTER_DIR = `${FIXTURES}adapters/repo/.dd/schemas/render/adapters/adapters/`;

describe('dd render fixture corpus', () => {
  it('pairs every fixture document with a committed golden render', () => {
    const documents = files('.dd.json');
    expect(documents.length).toBeGreaterThanOrEqual(6);
    for (const document of documents) {
      expect(() => JSON.parse(readFileSync(`${FIXTURES}${document}`, 'utf8'))).not.toThrow();
      expect(existsSync(`${FIXTURES}${document.replace(/\.json$/, '.md')}`)).toBe(true);
    }
  });

  it('enumerates every fixture case in the README', () => {
    for (const fixture of [
      'showcase/repo/docs/showcase.dd.json',
      'limits/repo/docs/limits.dd.json',
      'chain/repo/docs/source.dd.json',
      'drift/repo/docs/drift.dd.json',
    ]) {
      expect(README).toContain(fixture);
    }
  });

  it('gives every adapter failure class its own fixture and frozen code', () => {
    for (const { field, adapter, code } of ADAPTER_CLASSES) {
      expect(existsSync(`${ADAPTER_DIR}${field}.ts`)).toBe(adapter !== null);
      expect(README).toContain(`\`${code} `);
    }
    // The control: a conforming adapter must sit beside the failures, so a green
    // run proves the pipeline still renders, not merely that it never crashes.
    expect(existsSync(`${ADAPTER_DIR}good.ts`)).toBe(true);
  });

  it('keeps the drift subject hand-edited — regenerating it destroys the fixture', () => {
    const drift = readFileSync(`${FIXTURES}drift/repo/docs/drift.dd.md`, 'utf8');
    const expected = readFileSync(`${FIXTURES}drift/repo/docs/drift.expected.md`, 'utf8');
    expect(drift).not.toEqual(expected);
    expect(README).toContain('must **stay** hand-edited');
  });

  it('ships no golden-regeneration switch — the corpus is a spec, not a snapshot', () => {
    // Pin the REAL command surface, not prose about it: registering the act on a
    // bare commander root exposes exactly the flags `dd build` accepts, so adding
    // an `--update-goldens` escape hatch reddens this row (review F002 — the
    // earlier version of this test only read the README, which an escape hatch
    // could be added without ever touching).
    const root = new Command();
    const io: CliIo = { mode: 'json', writers: { out: () => undefined, err: () => undefined } };
    registerBuildCommand(root, io, { clock: new FakeClock('2026-08-03T00:00:00.000Z') });
    const build = root.commands.find((command) => command.name() === 'build');
    expect(build?.options.map((option) => option.long)).toEqual(['--check']);
    // …and the README still carries the reason, so the next agent knows it is a rule.
    expect(README).toContain('no `--update-goldens` flag');
  });
});
