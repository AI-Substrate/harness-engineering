import type { BundleFsPort } from '../../adapters/fs/fs-port.js';
import type { HashPort } from '../../adapters/hash/hash-port.js';
import { compareUnsignedUtf8 } from './remote-selection.js';
import { bytesEqual, type TelemetryBundle } from './telemetry-bundle.js';

export interface BundlePublisherDeps {
  fs: BundleFsPort;
  hash: HashPort;
}

export type BundlePublishResult =
  | { ok: true; written: boolean; reused: boolean }
  | { ok: false; kind: 'target_conflict' | 'filesystem_failure' };

function under(root: string, relative: string): string {
  const normalized = root.replace(/\\/g, '/').replace(/\/+$/, '');
  return `${normalized}/${relative}`;
}

function parent(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  const slash = normalized.lastIndexOf('/');
  return slash <= 0 ? (slash === 0 ? '/' : '.') : normalized.slice(0, slash);
}

function expectedPaths(bundle: TelemetryBundle): string[] {
  return bundle.files.map((file) => file.path).sort(compareUnsignedUtf8);
}

function exactFolder(bundle: TelemetryBundle, root: string, deps: BundlePublisherDeps): boolean {
  const listed = deps.fs.listRegularFilesNoFollow(root);
  const expected = expectedPaths(bundle);
  if (
    listed === null ||
    listed.length !== expected.length ||
    listed.some((path, index) => path !== expected[index])
  ) {
    return false;
  }
  const byPath = new Map(bundle.files.map((file) => [file.path, file.bytes] as const));
  for (const path of expected) {
    const actual = deps.fs.readBytesNoFollow(under(root, path));
    const wanted = byPath.get(path);
    if (actual === null || wanted === undefined || !bytesEqual(actual, wanted)) return false;
  }
  return true;
}

function verifyIntegrity(bundle: TelemetryBundle, root: string, deps: BundlePublisherDeps): void {
  const listed = deps.fs.listRegularFilesNoFollow(root);
  const expected = expectedPaths(bundle);
  if (
    listed === null ||
    listed.length !== expected.length ||
    listed.some((path, index) => path !== expected[index])
  ) {
    throw new Error('bundle file set mismatch');
  }
  const integrity = new Map(bundle.manifest.integrity.blobs.map((row) => [row.path, row] as const));
  for (const file of bundle.files) {
    const bytes = deps.fs.readBytesNoFollow(under(root, file.path));
    if (bytes === null || !bytesEqual(bytes, file.bytes)) throw new Error('bundle byte mismatch');
    const digest = deps.hash.sha256Hex(bytes).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(digest)) throw new Error('invalid sha256');
    if (file.path !== 'bundle.json') {
      const row = integrity.get(file.path);
      if (row === undefined || row.sha256 !== digest || row.bytes !== bytes.byteLength) {
        throw new Error('bundle integrity mismatch');
      }
    }
  }
  if (integrity.size !== bundle.files.length - 1) throw new Error('bundle integrity set mismatch');
}

/** Ports-only exact-folder publication with no overwrite/force path. */
export function publishTelemetryBundle(
  bundle: TelemetryBundle,
  target: string,
  deps: BundlePublisherDeps,
): BundlePublishResult {
  let targetIdentity: string;
  try {
    targetIdentity = deps.fs.normalizeBundleTargetIdentity(target);
  } catch {
    return { ok: false, kind: 'filesystem_failure' };
  }

  if (deps.fs.exists(targetIdentity)) {
    try {
      return exactFolder(bundle, targetIdentity, deps)
        ? { ok: true, written: false, reused: true }
        : { ok: false, kind: 'target_conflict' };
    } catch {
      return { ok: false, kind: 'target_conflict' };
    }
  }

  let temp: string | null = null;
  try {
    temp = deps.fs.createSiblingTempDir(targetIdentity, 'harness-pull-');
    for (const file of bundle.files) {
      const destination = under(temp, file.path);
      deps.fs.mkdirp(parent(destination));
      deps.fs.writeBytes(destination, file.bytes);
    }
    verifyIntegrity(bundle, temp, deps);
    // Every writer targeting the same canonical folder contends on one lock,
    // regardless of bundle bytes or the caller's path spelling.
    const lockDigest = deps.hash.sha256Hex(targetIdentity).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(lockDigest)) throw new Error('invalid lock digest');
    deps.fs.publishDirectoryExclusive(
      temp,
      targetIdentity,
      `telemetry-pull-${lockDigest.slice(0, 16)}`,
    );
    temp = null;
    return { ok: true, written: true, reused: false };
  } catch {
    return { ok: false, kind: 'filesystem_failure' };
  } finally {
    if (temp !== null) {
      try {
        deps.fs.removeDir(temp);
      } catch {
        // The public outcome is already E227-equivalent; never expose temp details.
      }
    }
  }
}
