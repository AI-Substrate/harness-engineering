import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

function ddFiles(relativeDir = ''): string[] {
  return readdirSync(`${FIXTURES}${relativeDir}`, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${relativeDir}${entry.name}`;
    return entry.isDirectory()
      ? ddFiles(`${relative}/`)
      : relative.endsWith('.dd.json')
        ? [relative]
        : [];
  });
}

describe('dd fixture corpus', () => {
  it('enumerates parseable real documents across every required class', () => {
    const files = ddFiles();
    expect(files.length).toBeGreaterThanOrEqual(23);
    for (const file of files) {
      expect(() => JSON.parse(readFileSync(`${FIXTURES}${file}`, 'utf8'))).not.toThrow();
    }

    expect(files.filter((file) => file.startsWith('invalid/'))).toHaveLength(9);
    expect(files).toContain('valid/minted-id.dd.json');
    for (const file of [
      'warn/absolute-path.dd.json',
      'warn/non-posix-path.dd.json',
      'warn/path-escape.dd.json',
      'warn/untracked-target.dd.json',
      'warn/missing-target.dd.json',
    ]) {
      expect(files).toContain(file);
    }
    expect(files).toContain('graph/chain-d-invalid.dd.json');
    expect(files).toContain('graph/chain-d-valid.dd.json');
    expect(files).toContain('graph/cycle-a.dd.json');
    expect(files).toContain('graph/cycle-b.dd.json');
  });

  it('documents every ERROR fixture twin and WARN path class', () => {
    const readme = readFileSync(`${FIXTURES}README.md`, 'utf8');
    for (const issueClass of [
      'duplicate-id',
      'id-invalid',
      'address-malformed',
      'schema-unresolvable',
      'state-note-required',
      'human-skipped-receipt-required',
      'enum-invalid',
      'link-type-mismatch',
      'address-path-absolute',
      'address-path-non-posix',
      'address-path-escape',
      'address-target-untracked',
      'address-target-missing',
    ]) {
      expect(readme).toContain(`\`${issueClass}\``);
    }
  });
});
