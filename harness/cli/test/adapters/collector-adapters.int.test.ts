import { chmodSync, lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { NodeExecutableBit } from '../../src/adapters/fs/node-executable-bit.js';
import { NodePathKind } from '../../src/adapters/fs/node-path-kind.js';
import { NodeDownload } from '../../src/adapters/http/node-download.js';

/**
 * `chmodSync`/`lstatSync` mocked, defaulting to the REAL implementation
 * (`vi.fn(actual.fn)` pass-through) — every OTHER use of `node:fs` in this file
 * (`mkdtempSync`, `rmSync`, `writeFileSync`) is untouched and still hits the
 * real filesystem. Only `NodeExecutableBit`'s and `NodePathKind`'s two specific
 * seams get completed: see the tests below for why (plan 108 B2).
 */
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, chmodSync: vi.fn(actual.chmodSync), lstatSync: vi.fn(actual.lstatSync) };
});

/*
Test Doc:
- Why: P0 of the phase-1 review — the collector's service logic was complete and
  its real adapters did not exist. These are those adapters, and they are the
  only collector code that touches the network, a mode bit, or `lstat`.
- Contract: NodeDownload reports the FINAL url and the hop count, caps redirect
  chains, refuses a Location-less 3xx, and distinguishes a timeout from a network
  error. NodeExecutableBit sets 0o755 and is an honest no-op on win32.
  NodePathKind never dereferences the final component, and never reports a path
  it could not classify as absent.
- Quality: no real network — a LOOPBACK http server on an ephemeral port, the
  same pattern the git-daemon fixtures already use. Nothing here reaches the
  internet, so it runs in CI unchanged.
*/

let server: Server;
let base = '';
/** Requests the loopback server saw, so redirect chains are observable. */
const seen: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? '/';
    seen.push(url);
    if (url === '/bytes') {
      const body = Buffer.from('hello-collector');
      res.writeHead(200, { 'content-length': String(body.byteLength) });
      res.end(body);
      return;
    }
    if (url === '/short') {
      // Declares more than it sends — the short-write tripwire upstream.
      res.writeHead(200, { 'content-length': '999' });
      res.end(Buffer.from('tiny'));
      return;
    }
    if (url === '/hop1') {
      res.writeHead(302, { location: '/hop2' });
      res.end();
      return;
    }
    if (url === '/hop2') {
      res.writeHead(302, { location: '/bytes' });
      res.end();
      return;
    }
    if (url === '/loop') {
      res.writeHead(302, { location: '/loop' });
      res.end();
      return;
    }
    if (url === '/nowhere') {
      res.writeHead(302);
      res.end();
      return;
    }
    if (url === '/missing') {
      res.writeHead(404);
      res.end('no');
      return;
    }
    if (url === '/slow') {
      // Never answers: the timeout must cover the whole operation, not just the
      // connect — a stalled body is exactly as fatal to a doctor run.
      return;
    }
    res.writeHead(500);
    res.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  base = `http://127.0.0.1:${typeof address === 'object' && address !== null ? address.port : 0}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
});

describe('NodeDownload', () => {
  it('returns the bytes, the status and the declared length', async () => {
    const result = await new NodeDownload().get(`${base}/bytes`, { timeoutMs: 5_000 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(200);
    expect(new TextDecoder().decode(result.bytes)).toBe('hello-collector');
    expect(result.declaredBytes).toBe('hello-collector'.length);
    expect(result.redirects).toBe(0);
  });

  it('counts every hop and reports where it ENDED UP, not where it was asked', async () => {
    // The provenance claim the pin rests on: "these bytes came from the pinned
    // host" is only checkable if the adapter says where it finally landed.
    const result = await new NodeDownload().get(`${base}/hop1`, { timeoutMs: 5_000 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.redirects).toBe(2);
    expect(result.url).toBe(`${base}/bytes`);
  });

  it('refuses an endless redirect chain instead of following it', async () => {
    const result = await new NodeDownload().get(`${base}/loop`, { timeoutMs: 5_000 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('network');
    expect(result.message).toContain('redirects');
  });

  it('refuses a 3xx with no Location rather than returning its body as content', async () => {
    const result = await new NodeDownload().get(`${base}/nowhere`, { timeoutMs: 5_000 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain('no Location');
  });

  it('passes a non-2xx status through so the caller can name it', async () => {
    const result = await new NodeDownload().get(`${base}/missing`, { timeoutMs: 5_000 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(404);
  });

  it('reports a stalled response as a TIMEOUT, distinctly from a network error', async () => {
    const result = await new NodeDownload().get(`${base}/slow`, { timeoutMs: 250 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('timeout');
    expect(result.message).toContain('250ms');
  });

  it('reports an unreachable host as a network error', async () => {
    // Port 1 on loopback: refused immediately, no DNS and no internet involved.
    const result = await new NodeDownload().get('http://127.0.0.1:1/x', { timeoutMs: 2_000 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.kind).toBe('network');
  });
});

describe('NodeExecutableBit', () => {
  it('sets mode 0o755 on a real file', () => {
    // The seam completed, not skipped (plan 108 B2): the platform was already
    // injected (the `'linux'` constructor arg), but the assertion still read
    // back `statSync`'s real mode bits — and Windows `chmod` cannot represent
    // POSIX mode bits at all (it only toggles the read-only flag), so that
    // assertion was never portable. What the port's contract actually claims
    // ("sets mode 0o755") is a claim about the SYSCALL it makes, so assert that
    // directly instead of the host filesystem's after-the-fact rendering of it.
    const dir = mkdtempSync(join(tmpdir(), 'harness-exebit-'));
    try {
      const path = join(dir, 'bin');
      writeFileSync(path, '#!/bin/sh\n');

      expect(new NodeExecutableBit('linux').setExecutable(path)).toBe(true);
      expect(chmodSync).toHaveBeenCalledWith(path, 0o755);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('is an honest no-op on win32 — false, never a pretended success', () => {
    expect(new NodeExecutableBit('win32').setExecutable('/nonexistent')).toBe(false);
  });

  it('returns false rather than throwing when the mode cannot be set', () => {
    expect(new NodeExecutableBit('linux').setExecutable('/nonexistent/really/not/here')).toBe(
      false,
    );
  });
});

describe('NodePathKind', () => {
  it('never dereferences the final component — a link to a directory reads `symlink`', () => {
    // The whole skills guard turns on this distinction: git-ai's own link may be
    // replaced, somebody's directory may not.
    //
    // Seam completed, not skipped (plan 108 B2): creating a REAL symlink needs
    // Developer Mode or elevation on Windows, which CI does not grant — but
    // `NodePathKind.kindNoFollow` never creates one, it only READS `lstat`'s
    // result and classifies it. Injecting that result tests the actual contract
    // ("never dereferences the final component") without depending on this
    // host's ability to create the fixture that would exercise it.
    const target = '/fake/harness-pathkind/target';
    const link = '/fake/harness-pathkind/link';
    lstatSync.mockImplementation((path) => {
      if (path === link) {
        return { isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false };
      }
      if (path === target) {
        return { isSymbolicLink: () => false, isDirectory: () => true, isFile: () => false };
      }
      throw Object.assign(new Error(`unexpected lstat: ${path}`), { code: 'ENOENT' });
    });
    try {
      expect(new NodePathKind().kindNoFollow(link)).toBe('symlink');
      expect(new NodePathKind().kindNoFollow(target)).toBe('directory');
    } finally {
      lstatSync.mockRestore();
    }
  });

  it('classifies files, and reports a genuinely missing path as absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'harness-pathkind-'));
    try {
      const path = join(dir, 'f');
      writeFileSync(path, 'x');

      expect(new NodePathKind().kindNoFollow(path)).toBe('file');
      expect(new NodePathKind().kindNoFollow(join(dir, 'nope'))).toBe('absent');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a broken symlink is still a symlink, not an absent path', () => {
    // `exists()` would say no here. That answer would let the guard treat
    // somebody's dangling link as free space. Same seam completion as above —
    // a dangling symlink still needs real symlink creation to test via the
    // filesystem, which needs elevation on Windows (plan 108 B2).
    const link = '/fake/harness-pathkind/dangling';
    lstatSync.mockImplementation((path) => {
      if (path === link) {
        return { isSymbolicLink: () => true, isDirectory: () => false, isFile: () => false };
      }
      throw Object.assign(new Error(`unexpected lstat: ${path}`), { code: 'ENOENT' });
    });
    try {
      expect(new NodePathKind().kindNoFollow(link)).toBe('symlink');
    } finally {
      lstatSync.mockRestore();
    }
  });
});
