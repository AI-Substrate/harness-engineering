import { describe, expect, it } from 'vitest';
import { NodeHash } from '../../../../src/adapters/hash/node-hash.js';
import { downloadAndVerify } from '../../../../src/services/doctor/collector/download.js';
import {
  FakeCollectorFs,
  FakeDownload,
  FakeExecutableBit,
  ok200,
} from '../../../support/collector-fakes.js';

/**
 * Plan 073 · ac-0004, ac-0005, ac-0006, ac-0015, ac-0016 — download-and-verify.
 *
 * A real {@link NodeHash} is used deliberately: the digests asserted here are
 * genuine SHA-256 values produced by Node's crypto, which is the same code path
 * that runs in production on all six platforms. A fake hash would prove the
 * plumbing and nothing about the guarantee.
 */

const URL = 'https://github.com/git-ai-project/git-ai/releases/download/v1.6.21/git-ai-macos-arm64';
const DEST = '/home/u/.git-ai/bin/git-ai';
const PAYLOAD = new TextEncoder().encode('#!/bin/sh\necho git-ai\n');
/** The host GitHub redirects every release-asset download to (078 · #124). */
const GITHUB_CDN_HOST = 'release-assets.githubusercontent.com';
/** The real SHA-256 of PAYLOAD — computed once here, never copied from the code. */
const DIGEST = new NodeHash().sha256Hex(PAYLOAD);

function deps(scripts: Record<string, ReturnType<typeof ok200>>, exeOk = true) {
  const fs = new FakeCollectorFs();
  const exe = new FakeExecutableBit(exeOk);
  return {
    fs,
    exe,
    http: new FakeDownload(scripts),
    deps: { fs, hash: new NodeHash(), http: new FakeDownload(scripts), exe },
  };
}

function request(over: Record<string, unknown> = {}) {
  return {
    url: URL,
    sha256: DIGEST,
    destPath: DEST,
    platform: 'darwin',
    ...over,
  } as Parameters<typeof downloadAndVerify>[1];
}

describe('downloadAndVerify — the happy path places a verified, executable binary', () => {
  it('hashes a TEMP file, then renames into place (ac-0004, ac-0016)', async () => {
    const { fs, exe, deps: d } = deps({ [URL]: ok200(PAYLOAD) });

    const result = await downloadAndVerify(d, request());

    expect(result).toMatchObject({ ok: true, path: DEST, digest: DIGEST, executable: true });
    // Verification happened on the temp path, and the ONLY publish was a rename.
    expect(fs.siblingTempDirs).toEqual(['/home/u/.git-ai/bin/.git-ai.harness-gitai-0']);
    expect(fs.writes).toEqual(['/home/u/.git-ai/bin/.git-ai.harness-gitai-0/download.bin']);
    expect(fs.renames).toEqual([
      `/home/u/.git-ai/bin/.git-ai.harness-gitai-0/download.bin->${DEST}`,
    ]);
    expect(fs.paths()).toEqual([DEST]);
    // The mode is set BEFORE the rename — the final path is never non-executable.
    expect(exe.calls).toEqual(['/home/u/.git-ai/bin/.git-ai.harness-gitai-0/download.bin']);
  });

  it('does not attempt a Unix mode on Windows', async () => {
    const { exe, deps: d } = deps({ [URL]: ok200(PAYLOAD) });

    const result = await downloadAndVerify(
      d,
      request({ platform: 'win32', destPath: '/home/u/.git-ai/bin/git-ai.exe' }),
    );

    expect(result).toMatchObject({ ok: true, executable: false });
    expect(exe.calls).toEqual([]);
  });

  it('reports a failure to set the mode rather than claiming an executable binary', async () => {
    const { deps: d } = deps({ [URL]: ok200(PAYLOAD) }, false);

    expect(await downloadAndVerify(d, request())).toMatchObject({ ok: true, executable: false });
  });
});

describe('downloadAndVerify — GitHub’s real redirect SUCCEEDS (078 · ac-0002)', () => {
  it('installs after a redirect to release-assets.githubusercontent.com — the CDN hop GitHub ALWAYS makes', async () => {
    // The fake that was missing. Every release-asset download 302s off github.com
    // to this host — universal GitHub behaviour, confirmed against an unrelated
    // repo (cli/cli v2.62.0), not specific to git-ai. The suite only ever faked a
    // redirect that SHOULD be refused (cdn.example.com, below), so nothing proved
    // the guard stays quiet on the one redirect that actually happens. It did not:
    // `harness doctor --install-collector` could not succeed on any platform.
    const { fs, deps: d } = deps({
      [URL]: {
        ...ok200(PAYLOAD),
        url: `https://${GITHUB_CDN_HOST}/git-ai-project/git-ai/releases/assets/1?token=x`,
        redirects: 1,
      },
    });

    const result = await downloadAndVerify(d, request());

    expect(result).toMatchObject({ ok: true, path: DEST, digest: DIGEST, redirects: 1 });
    expect(fs.renames).toEqual([
      `/home/u/.git-ai/bin/.git-ai.harness-gitai-0/download.bin->${DEST}`,
    ]);
    expect(fs.paths()).toEqual([DEST]);
  });
});

describe('downloadAndVerify — a digest mismatch fails closed (ac-0005)', () => {
  it('installs nothing, leaves no partial file, and names BOTH digests', async () => {
    const { fs, deps: d } = deps({ [URL]: ok200(new TextEncoder().encode('malicious')) });

    const result = await downloadAndVerify(d, request());

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('digest-mismatch');
    expect(result.expected).toBe(DIGEST);
    expect(result.actual).toBe(new NodeHash().sha256Hex(new TextEncoder().encode('malicious')));
    expect(result.detail).toContain(DIGEST);
    expect(result.detail).toContain(result.actual as string);
    // Nothing placed, nothing left behind.
    expect(fs.paths()).toEqual([]);
    expect(fs.renames).toEqual([]);
    expect(fs.removedDirs).toEqual(['/home/u/.git-ai/bin/.git-ai.harness-gitai-0']);
  });

  it('still refuses a bad digest AFTER a redirect to the real CDN host (078 · ac-0003)', async () => {
    // Removing the host pin must not have removed the control that actually
    // provides integrity. Same CDN redirect as the happy path above; only the
    // bytes differ. If dropping the host check had coupled the two, this is
    // where it would show — the redirect accepted, and the payload with it.
    const { fs, deps: d } = deps({
      [URL]: {
        ...ok200(new TextEncoder().encode('malicious')),
        url: `https://${GITHUB_CDN_HOST}/git-ai-project/git-ai/releases/assets/1?token=x`,
        redirects: 1,
      },
    });

    const result = await downloadAndVerify(d, request());

    expect(result).toMatchObject({ ok: false, reason: 'digest-mismatch' });
    expect(fs.paths()).toEqual([]);
    expect(fs.renames).toEqual([]);
    expect(fs.removedDirs).toEqual(['/home/u/.git-ai/bin/.git-ai.harness-gitai-0']);
  });
});

describe('downloadAndVerify — every transport failure is named, not collapsed (ac-0015)', () => {
  it('non-2xx HTTP aborts and reports the status', async () => {
    const { fs, deps: d } = deps({ [URL]: { ...ok200(PAYLOAD), status: 404 } });

    const result = await downloadAndVerify(d, request());

    expect(result).toMatchObject({ ok: false, reason: 'http-status' });
    expect(fs.paths()).toEqual([]);
    expect(fs.siblingTempDirs).toEqual([]); // aborted before any disk was touched
  });

  // DELETED HERE (078 · #124): "a redirect off the pinned host is refused BEFORE
  // the digest is consulted", which faked a redirect to cdn.example.com. It
  // asserted a guard that no longer exists, because the guard could never be
  // satisfied on the happy path — GitHub always redirects release assets to a
  // CDN host, so it refused every real install on every platform. What is no
  // longer checked: a redirect to an unexpected host is not refused. What checks
  // integrity in its place, as it always did: the pinned SHA-256, verified
  // against bytes read back off disk before anything is placed. The digest
  // refusal is proven to still fire AFTER a real CDN redirect — see the
  // digest-mismatch block above; the two were never coupled.

  it('a timeout aborts with the timeout named', async () => {
    const { deps: d } = deps({
      [URL]: { ok: false, kind: 'timeout', message: 'read timed out after 60000ms' },
    });

    expect(await downloadAndVerify(d, request())).toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('a connect error aborts with the network cause named', async () => {
    const { deps: d } = deps({
      [URL]: { ok: false, kind: 'network', message: 'ECONNREFUSED' },
    });

    const result = await downloadAndVerify(d, request());
    expect(result).toMatchObject({ ok: false, reason: 'network' });
    if (!result.ok) expect(result.detail).toContain('ECONNREFUSED');
  });

  it('a body shorter than the declared Content-Length aborts as a short write', async () => {
    const { fs, deps: d } = deps({
      [URL]: { ...ok200(PAYLOAD), declaredBytes: PAYLOAD.byteLength + 10 },
    });

    expect(await downloadAndVerify(d, request())).toMatchObject({
      ok: false,
      reason: 'short-write',
    });
    expect(fs.paths()).toEqual([]);
  });

  it('an interrupted write is caught by reading the bytes BACK off disk', async () => {
    const fs = new FakeCollectorFs();
    fs.truncateOnReadBack.set('/home/u/.git-ai/bin/.git-ai.harness-gitai-0/download.bin', 3);
    const result = await downloadAndVerify(
      {
        fs,
        hash: new NodeHash(),
        http: new FakeDownload({ [URL]: ok200(PAYLOAD) }),
        exe: new FakeExecutableBit(),
      },
      request(),
    );

    expect(result).toMatchObject({ ok: false, reason: 'short-write' });
    expect(fs.paths()).toEqual([]);
    expect(fs.renames).toEqual([]);
  });

  it('a refused write aborts as write-failed and cleans up', async () => {
    const fs = new FakeCollectorFs();
    fs.failWrites.add('/home/u/.git-ai/bin/.git-ai.harness-gitai-0/download.bin');
    const result = await downloadAndVerify(
      {
        fs,
        hash: new NodeHash(),
        http: new FakeDownload({ [URL]: ok200(PAYLOAD) }),
        exe: new FakeExecutableBit(),
      },
      request(),
    );

    expect(result).toMatchObject({ ok: false, reason: 'write-failed' });
    expect(fs.paths()).toEqual([]);
    expect(fs.removedDirs).toEqual(['/home/u/.git-ai/bin/.git-ai.harness-gitai-0']);
  });
});

describe('downloadAndVerify — hashing never shells out (ac-0006)', () => {
  it('the download module contains no shasum/sha256sum/certutil invocation', async () => {
    const { readFileSync } = await import('node:fs');
    const { dirname, join } = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(
      join(
        dirname(fileURLToPath(import.meta.url)),
        '../../../../src/services/doctor/collector/download.ts',
      ),
      'utf8',
    );

    // Named in prose (the comment explains WHY they are absent); never invoked.
    expect(source).not.toMatch(/exec\.run\(\s*['"](shasum|sha256sum|certutil|openssl)/);
    expect(source).not.toContain('child_process');
    expect(source).toContain('deps.hash.sha256Hex');
  });
});

/**
 * Plan 077 — EXDEV. The publish must stay on the destination's filesystem.
 *
 * MEASURED on a clean Ubuntu 25.04 VM before this fix: the download succeeded,
 * the digest matched, and the atomic publish failed with
 * `EXDEV: cross-device link not permitted` renaming
 * `/tmp/harness-gitai-…/download.bin` -> `~/.git-ai/bin/git-ai`. `/tmp` was
 * tmpfs (device 50), `$HOME` was /dev/vdb1 (device 41). POSIX `rename(2)`
 * cannot cross a filesystem boundary, so on most Linux boxes the install could
 * NEVER have succeeded — deterministic, not a flake.
 *
 * It hid on macOS, where `/tmp` and `$HOME` are usually one volume. The unit
 * suite hid it too, because `FakeCollectorFs.rename` used to move bytes between
 * any two paths happily. A fake that is permissive where the kernel is strict
 * cannot fail on the thing that matters, so the fake now enforces EXDEV and
 * these two tests stand on that.
 */
describe('plan 077 — staging is BESIDE the target, so the publish cannot hit EXDEV', () => {
  it('stages on the destination’s filesystem and renames within it', async () => {
    const fs = new FakeCollectorFs();
    const result = await downloadAndVerify(
      {
        fs,
        hash: new NodeHash(),
        http: new FakeDownload({ [URL]: ok200(PAYLOAD) }),
        exe: new FakeExecutableBit(),
      },
      request(),
    );

    expect(result.ok).toBe(true);
    // Never the system temp dir…
    expect(fs.mkdtemps).toEqual([]);
    // …always a sibling of the destination.
    for (const dir of fs.siblingTempDirs) {
      expect(dir.startsWith('/home/u/.git-ai/bin/')).toBe(true);
    }
    for (const rename of fs.renames) {
      const [from, to] = rename.split('->');
      expect(from?.split('/')[1]).toBe(to?.split('/')[1]);
    }
  });

  it('the OLD behaviour is now detectable — a cross-device rename throws', () => {
    // The control that makes the test above mean something. Before the fix this
    // exact move was what the code performed, and the fake permitted it, so no
    // test could have gone red. Now it cannot pass silently.
    const fs = new FakeCollectorFs();
    fs.writeBytes('/tmp/staged/download.bin', new Uint8Array([1, 2, 3]));

    expect(() => fs.rename('/tmp/staged/download.bin', '/home/u/.git-ai/bin/git-ai')).toThrow(
      /EXDEV/,
    );
  });
});
