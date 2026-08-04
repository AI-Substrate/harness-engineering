import { execFileSync, spawn } from 'node:child_process';
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
- Contract: piped stdout of `harness docs <id>` byte-equals getDoc(id).content; a reader that
  stops after the first line doesn't provoke an EPIPE stack trace.
- Usage Notes: the early-close test is SHELL-FREE (plan 017 AC-6 — no bash/head, so it runs
  on Windows): spawn the CLI with Node primitives, read one line, destroy the pipe, await
  close. It asserts the CLI's documented behaviour — first line delivered, stderr clean —
  NOT a blanket exit-0 (the old `bash -c '… | head -1'` form asserted *head's* pipeline
  status, never the CLI's).
- Quality Contribution: a regression guard against truncation + EPIPE stack traces on the raw path.
- Worked Example: `node dist/index.js docs <id>` captured fully === DOCS[<id>].content.
*/

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const distEntry = join(repoRoot, 'harness/cli/dist/index.js');

describe('docs command — end-to-end through a real pipe (F002 truncation/EPIPE guard)', () => {
  beforeAll(() => {
    if (!existsSync(distEntry)) {
      // Windows-safe npm invocation (plan 017 AC-6): npm is npm.cmd on win32 and
      // needs a shell to run it; the guard must work — not be skipped — everywhere.
      const win32 = process.platform === 'win32';
      execFileSync(win32 ? 'npm.cmd' : 'npm', ['run', 'build'], {
        cwd: repoRoot,
        stdio: 'ignore',
        shell: win32,
      });
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
    const staleHint =
      'piped dist output differs from source docs-content — the built CLI is likely STALE; ' +
      'run `npm run build` and re-run (plan 014 orchestrator retro OH-003)';
    expect(out.length, staleHint).toBe(expected.length);
    expect(out, staleHint).toBe(expected);
  }, 120_000);

  it('survives a reader that closes after one line without an EPIPE stack trace (shell-free)', async () => {
    const id = listDocs().docs[0]?.id ?? '';
    const child = spawn(process.execPath, [distEntry, 'docs', id, '--no-extensions'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk;
    });

    // `head -1` in Node primitives: read until the first newline, then destroy
    // the read side — the child's next write hits a closed pipe (EPIPE).
    const firstLine = await new Promise<string>((resolveLine) => {
      let buffer = '';
      child.stdout.setEncoding('utf8');
      child.stdout.on('error', () => {
        // The destroyed pipe may error on the parent side too — irrelevant here.
      });
      const onData = (chunk: string) => {
        buffer += chunk;
        const newline = buffer.indexOf('\n');
        if (newline !== -1) {
          child.stdout.off('data', onData);
          child.stdout.destroy();
          resolveLine(buffer.slice(0, newline));
        }
      };
      child.stdout.on('data', onData);
    });

    await new Promise<void>((resolveClose) => {
      child.on('close', () => resolveClose());
    });

    expect(firstLine.length).toBeGreaterThan(0);
    expect(stderr).not.toMatch(/EPIPE|Error:/);
  }, 120_000);
});
