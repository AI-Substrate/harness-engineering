import type { HashPort } from '../../../adapters/hash/hash-port.js';
import {
  type CollectorFsPort,
  DOWNLOAD_TIMEOUT_MS,
  type DownloadPort,
  type ExecutableBitPort,
} from './types.js';

/**
 * Download-and-verify (plan 073 · ac-0004, ac-0005, ac-0006, ac-0015, ac-0016).
 *
 * The ONE rule this file exists to keep: nothing untrusted is ever placed at the
 * final path. Bytes land in a temp directory, are read BACK off disk, are hashed
 * with Node's crypto through {@link HashPort} — never `shasum`/`sha256sum`/
 * `certutil`, so there is one code path on all six platforms — and only a
 * digest that matches the pin is renamed into place.
 *
 * Every failure mode is named rather than collapsed into "download failed":
 * a non-2xx status, a connect/read timeout, a short or interrupted write, and a
 * digest mismatch each abort, remove the temp file, and say which one happened.
 * A caller that cannot tell "GitHub was down" from "the bytes were not the bytes
 * we pinned" cannot make a safe decision, and the second one is a supply-chain
 * event.
 *
 * There is deliberately NO host check on the final URL (plan 078 · #124). One
 * used to exist, pinned to `github.com`, and it made this path unusable on every
 * platform: GitHub always 302s a release-asset download to a CDN host, so the
 * guard fired on the happy path and no install ever started. Integrity here is
 * and always was the pinned SHA-256, verified below against bytes read back off
 * disk before anything is placed. Where the bytes came from does not change
 * whether they are the right bytes.
 */

export type DownloadFailureReason =
  | 'http-status'
  | 'timeout'
  | 'network'
  | 'short-write'
  | 'digest-mismatch'
  | 'write-failed';

export interface VerifiedDownloadRequest {
  url: string;
  /** The digest from the pin — lowercase hex. */
  sha256: string;
  /** Absolute destination path; replaced atomically after verification. */
  destPath: string;
  /** `process.platform` — decides whether the executable bit is meaningful. */
  platform: string;
  timeoutMs?: number;
}

export type VerifiedDownloadResult =
  | {
      ok: true;
      path: string;
      digest: string;
      bytes: number;
      /** False on Windows (no mode) or when the mode could not be set. */
      executable: boolean;
      redirects: number;
    }
  | {
      ok: false;
      reason: DownloadFailureReason;
      detail: string;
      /** Present for `digest-mismatch` only — both sides, always named. */
      expected?: string;
      actual?: string;
    };

export interface VerifiedDownloadDeps {
  fs: CollectorFsPort;
  hash: HashPort;
  http: DownloadPort;
  exe: ExecutableBitPort;
}

/** Best-effort cleanup — a failed install must leave NOTHING behind (ac-0005). */
function discard(fs: CollectorFsPort, tempDir: string | null): void {
  if (tempDir === null) return;
  try {
    fs.removeDir(tempDir);
  } catch {
    // The abort path must not throw a second error over the first one.
  }
}

export async function downloadAndVerify(
  deps: VerifiedDownloadDeps,
  request: VerifiedDownloadRequest,
): Promise<VerifiedDownloadResult> {
  let tempDir: string | null = null;
  try {
    const response = await deps.http.get(request.url, {
      timeoutMs: request.timeoutMs ?? DOWNLOAD_TIMEOUT_MS,
    });
    if (!response.ok) {
      return {
        ok: false,
        reason: response.kind,
        detail: `${request.url}: ${response.message}`,
      };
    }
    if (response.status < 200 || response.status > 299) {
      return {
        ok: false,
        reason: 'http-status',
        detail: `${request.url}: HTTP ${response.status}`,
      };
    }
    if (
      response.declaredBytes !== undefined &&
      response.declaredBytes !== response.bytes.byteLength
    ) {
      return {
        ok: false,
        reason: 'short-write',
        detail: `${request.url}: received ${response.bytes.byteLength} bytes, server declared ${response.declaredBytes}`,
      };
    }

    // STAGE BESIDE THE TARGET, never in the system temp dir (plan 077).
    //
    // `mkdtemp` resolves to `os.tmpdir()`, and on most Linux boxes `/tmp` is a
    // separate filesystem — tmpfs. POSIX `rename(2)` CANNOT cross a filesystem
    // boundary; it returns EXDEV by specification. So staging in `/tmp` and
    // publishing into `$HOME/.git-ai` did not merely risk failing, it could
    // NEVER succeed there. MEASURED on a clean Ubuntu 25.04 VM:
    //
    //   EXDEV: cross-device link not permitted,
    //     rename '/tmp/harness-gitai-owk7ok/download.bin' -> '/home/u/.git-ai/bin/git-ai'
    //   stat -c %d /tmp -> 50 (tmpfs)      stat -c %d $HOME -> 41 (/dev/vdb1)
    //
    // The download and the digest both SUCCEEDED; only the publish failed. It
    // hid on macOS, where `/tmp` and `$HOME` are usually one volume — the same
    // runner-blindness the fleet spent the day on, with our own dev platform as
    // the hiding place.
    //
    // A copy+unlink fallback would "fix" it by giving up atomicity, which is the
    // one property the mode-before-rename ordering below exists to protect: a
    // half-written `git-ai` on the final path is worse than a failed install.
    // Staging on the destination's own filesystem KEEPS the guarantee instead of
    // trading it away.
    const destParent = request.destPath.replace(/\/[^/]*$/, '');
    if (destParent !== '' && destParent !== request.destPath) deps.fs.mkdirp(destParent);
    tempDir = deps.fs.createSiblingTempDir(request.destPath, 'harness-gitai-');
    const tempPath = `${tempDir.replace(/\/+$/, '')}/download.bin`;
    deps.fs.writeBytes(tempPath, response.bytes);

    // Hash what is ON DISK, not what we held in memory: an interrupted or short
    // write is exactly the failure a memory-side hash cannot see (ac-0015).
    const written = deps.fs.readBytesNoFollow(tempPath);
    if (written === null) {
      discard(deps.fs, tempDir);
      return { ok: false, reason: 'write-failed', detail: `temp file unreadable at ${tempPath}` };
    }
    if (written.byteLength !== response.bytes.byteLength) {
      discard(deps.fs, tempDir);
      return {
        ok: false,
        reason: 'short-write',
        detail: `wrote ${response.bytes.byteLength} bytes but ${written.byteLength} landed on disk`,
      };
    }

    const digest = deps.hash.sha256Hex(written).toLowerCase();
    const expected = request.sha256.toLowerCase();
    if (digest !== expected) {
      // Fail closed (ac-0005): nothing placed, no partial file, both digests named.
      discard(deps.fs, tempDir);
      return {
        ok: false,
        reason: 'digest-mismatch',
        detail: `${request.url}: SHA-256 mismatch — expected ${expected}, got ${digest}. Nothing was installed.`,
        expected,
        actual: digest,
      };
    }

    // Mode BEFORE the rename, so the atomic publish can never expose a verified
    // but non-executable binary — there is no window in which the final path
    // holds something a user cannot run (ac-0016).
    const executable = request.platform === 'win32' ? false : deps.exe.setExecutable(tempPath);

    // Same-filesystem by construction now, so this rename is atomic rather than
    // hopeful. The destination directory already exists — creating it is what
    // made the sibling staging possible in the first place.
    deps.fs.rename(tempPath, request.destPath);
    discard(deps.fs, tempDir);

    return {
      ok: true,
      path: request.destPath,
      digest,
      bytes: written.byteLength,
      executable,
      redirects: response.redirects,
    };
  } catch (err) {
    discard(deps.fs, tempDir);
    return {
      ok: false,
      reason: 'write-failed',
      detail: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    };
  }
}
