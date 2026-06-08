import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { getDoc, listDocs } from '../../src/services/docs/docs-service.js';

/*
Test Doc:
- Why: `harness docs <id>` streams raw markdown to a real pipe; an early process.exit could
  truncate a large payload before stdout flushes (companion F002 HIGH). This proves the built
  CLI delivers the full bytes end-to-end and survives a closed reader (EPIPE).
- Contract: piped stdout of `harness docs <id>` byte-equals getDoc(id).content; `| head` doesn't crash.
- Quality Contribution: a regression guard against truncation + EPIPE stack traces on the raw path.
- Worked Example: `node dist/index.js docs <id>` captured fully === DOCS[<id>].content.
*/

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const distEntry = join(repoRoot, 'harness/cli/dist/index.js');

describe('docs command — end-to-end through a real pipe (F002 truncation/EPIPE guard)', () => {
  beforeAll(() => {
    if (!existsSync(distEntry)) {
      execFileSync('npm', ['run', 'build'], { cwd: repoRoot, stdio: 'ignore' });
    }
  }, 120_000);

  it('streams the full markdown byte-for-byte to a buffered reader (no truncation)', () => {
    const id = listDocs().docs[0]?.id ?? '';
    const lookup = getDoc(id);
    const expected = 'content' in lookup ? lookup.content : '';
    const out = execFileSync(process.execPath, [distEntry, 'docs', id, '--no-extensions'], {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    expect(out.length).toBe(expected.length);
    expect(out).toBe(expected);
  });

  it('survives a reader that closes early (`| head -1`) without an EPIPE stack trace', () => {
    const id = listDocs().docs[0]?.id ?? '';
    const result = spawnSync(
      'bash',
      ['-c', `node ${JSON.stringify(distEntry)} docs ${id} --no-extensions | head -1`],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    expect(result.stderr).not.toMatch(/EPIPE|Error:/);
  });
});
