import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerDocsAct } from '../../src/acts/docs.js';
import type { CliIo, OutputMode, Writers } from '../../src/output/output-port.js';
import { getDoc, listDocs } from '../../src/services/docs/docs-service.js';

/*
Test Doc:
- Why: the `docs` act is the CLI front door to the bundled corpus; it must list as a stable
  envelope, dump a doc as RAW markdown (agent-pipe-friendly), and fail honestly with E160.
- Contract: `docs` -> formatOk {docs}; `docs <id>` -> raw markdown stdout exit 0; `docs <unknown>` -> E160 exit 1.
- Usage Notes: exits route through exitWithEnvelope (single-exit architecture); raw path emits content only.
- Quality Contribution: pins the three output shapes + exit codes against the real bundled corpus.
- Worked Example: `harness docs <id>` writes getDoc(id).content verbatim, no envelope, exit 0.
*/

function ioFor(mode: OutputMode): { io: CliIo; out: () => string; err: () => string } {
  let o = '';
  let e = '';
  const writers: Writers = {
    out: (t) => {
      o += t;
    },
    err: (t) => {
      e += t;
    },
  };
  return { io: { mode, writers }, out: () => o, err: () => e };
}

describe('registerDocsAct', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function run(io: CliIo, args: string[]): number {
    let code = -1;
    vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
      code = c ?? 0;
      throw new Error(`exit:${code}`);
    }) as never);
    const program = new Command().name('harness');
    registerDocsAct(program, io);
    expect(() => program.parse(['node', 'harness', 'docs', ...args])).toThrow(/^exit:/);
    return code;
  }

  it('list (json): ok envelope with data.docs[] (no content), exit 0', () => {
    const { io, out } = ioFor('json');
    const code = run(io, []);
    const env = JSON.parse(out());
    expect(env.command).toBe('docs');
    expect(env.status).toBe('ok');
    expect(Array.isArray(env.data.docs)).toBe(true);
    expect(env.data.docs[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        title: expect.any(String),
        summary: expect.any(String),
        audience: expect.any(String),
      }),
    );
    expect(env.data.docs[0].content).toBeUndefined();
    expect(code).toBe(0);
  });

  it('list (human): prints each doc id to stdout, exit 0', () => {
    const { io, out } = ioFor('human');
    const code = run(io, []);
    for (const entry of listDocs().docs) {
      expect(out()).toContain(entry.id);
    }
    expect(code).toBe(0);
  });

  it('read <id>: writes raw markdown (not an envelope) to stdout, exit 0', () => {
    const firstId = listDocs().docs[0]?.id ?? '';
    const lookup = getDoc(firstId);
    const expected = 'content' in lookup ? lookup.content : '';
    const { io, out } = ioFor('json'); // raw even in json mode (mirrors minih agent-readme)
    const code = run(io, [firstId]);
    expect(out()).toBe(expected);
    expect(out().startsWith('{"command"')).toBe(false); // a raw dump, not an envelope line
    expect(code).toBe(0);
  });

  it('read <unknown>: error envelope with E160, exit 1', () => {
    const { io, out } = ioFor('json');
    const code = run(io, ['definitely-not-a-real-doc']);
    const env = JSON.parse(out());
    expect(env.command).toBe('docs');
    expect(env.status).toBe('error');
    expect(env.error.code).toBe('E160');
    expect(code).toBe(1);
  });

  it('read <unknown> (human): writes the error + next_action to stderr, exit 1', () => {
    const { io, err } = ioFor('human');
    const code = run(io, ['nope']);
    expect(err()).toMatch(/nope/);
    expect(err()).toMatch(/harness docs/);
    expect(code).toBe(1);
  });
});
