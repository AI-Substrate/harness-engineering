import type { HashPort } from '../../../adapters/hash/hash-port.js';
import { GITAI_PIN } from './pin.js';
import type { CollectorPin, DownloadPort, PlatformKey } from './types.js';
import { DOWNLOAD_TIMEOUT_MS } from './types.js';

/**
 * Pin regeneration (plan 073 · ac-000e, ac-0018, ac-001a).
 *
 * A version bump fetches ALL SIX artifacts for the requested tag, hashes each
 * one, and rewrites `pin.ts`. It is deliberately a separate command from the
 * install path, because the install path must never write the manifest: a
 * downloader that can re-pin on mismatch does not have a pin, it has a
 * suggestion — it would "fix" the exact event the digest exists to catch.
 *
 * ALL-OR-NOTHING (ac-0018). If any one of the six fails to fetch or hash, the
 * existing manifest is left byte-untouched. A five-of-six manifest is worse than
 * no bump: the missing platform silently keeps the old digest, and nobody who
 * reviews the diff can see which line is stale.
 */

export interface RegeneratePinRequest {
  /** The release tag to pin, e.g. `v1.6.22`. Never `latest`. */
  version: string;
  timeoutMs?: number;
}

export type RegeneratePinResult =
  | {
      ok: true;
      version: string;
      /** The full `pin.ts` source to write — the caller owns the file write. */
      source: string;
      digests: Record<PlatformKey, string>;
    }
  | { ok: false; failures: Array<{ key: PlatformKey; file: string; reason: string }> };

export interface RegeneratePinDeps {
  http: DownloadPort;
  hash: HashPort;
  manifest?: CollectorPin;
}

/** Fetch + hash every published artifact for a tag; rewrite the pin, or nothing. */
export async function regenerateGitAiPin(
  deps: RegeneratePinDeps,
  request: RegeneratePinRequest,
): Promise<RegeneratePinResult> {
  const manifest = deps.manifest ?? GITAI_PIN;
  if (request.version === 'latest' || request.version.trim() === '') {
    return {
      ok: false,
      failures: [
        {
          key: 'macos-arm64',
          file: '(none)',
          reason: "refusing to manifest 'latest' — a manifest names one immutable tag",
        },
      ],
    };
  }

  const keys = Object.keys(manifest.artifacts) as PlatformKey[];
  const digests = {} as Record<PlatformKey, string>;
  const failures: Array<{ key: PlatformKey; file: string; reason: string }> = [];

  for (const key of keys) {
    const file = manifest.artifacts[key].file;
    const url = `${manifest.release_base_url}/${request.version}/${file}`;
    const response = await deps.http.get(url, {
      timeoutMs: request.timeoutMs ?? DOWNLOAD_TIMEOUT_MS,
    });
    if (!response.ok) {
      failures.push({ key, file, reason: `${response.kind}: ${response.message}` });
      continue;
    }
    if (response.status < 200 || response.status > 299) {
      failures.push({ key, file, reason: `HTTP ${response.status}` });
      continue;
    }
    if (response.bytes.byteLength === 0) {
      failures.push({ key, file, reason: 'empty response body' });
      continue;
    }
    digests[key] = deps.hash.sha256Hex(response.bytes).toLowerCase();
  }

  // All-or-nothing: one failure and the caller writes nothing at all.
  if (failures.length > 0) return { ok: false, failures };

  return {
    ok: true,
    version: request.version,
    source: renderPinSource(manifest, request.version, digests),
    digests,
  };
}

/**
 * Render the `pin.ts` source. The prose header is reproduced verbatim so a bump
 * diff shows ONLY the version and the six digests — a reviewer should be able to
 * read the whole change at a glance, not diff a regenerated essay.
 */
export function renderPinSource(
  manifest: CollectorPin,
  version: string,
  digests: Record<PlatformKey, string>,
): string {
  const keys = Object.keys(manifest.artifacts) as PlatformKey[];
  const entries = keys
    .map((key) =>
      [
        `    '${key}': {`,
        `      file: '${manifest.artifacts[key].file}',`,
        `      sha256: '${digests[key]}',`,
        '    },',
      ].join('\n'),
    )
    .join('\n');
  return [
    PIN_HEADER,
    'export const GITAI_PIN = {',
    '  /** Release download base; the artifact URL is the base, tag and file joined. */',
    `  release_base_url: '${manifest.release_base_url}',`,
    "  /** The exact release tag. NEVER 'latest'. */",
    `  version: '${version}',`,
    '  /** The authorship-note schema this pin was reviewed against. */',
    `  expect_schema_version: '${manifest.expect_schema_version}',`,
    '  /** One entry per published platform artifact — all six, no fallback. */',
    '  artifacts: {',
    entries,
    '  },',
    '} as const;',
    '',
  ].join('\n');
}

/** The doc header `pin.ts` carries — kept here so regeneration cannot drop it. */
const PIN_HEADER = `/**
 * THE PIN — the git-ai collector version and its per-platform digests, as DATA.
 *
 * Plan 073 · ac-0003, ac-000d, ac-000f. This file is the ENTIRE bump surface: a
 * new git-ai version is a one-file diff to the literal below, produced by
 * \`regenerateGitAiPin\` (see \`regenerate.ts\`), never by the install path. That is
 * why it holds no imports, no logic and no derived values — anything a reader
 * has to compute is somewhere a version could drift.
 *
 * \`expect_schema_version\` rides in the same literal on purpose: binary drift and
 * authorship-note FORMAT drift then arrive in the same diff, and a reviewer
 * approves both or neither. git-ai's own constant is \`AUTHORSHIP_LOG_VERSION\`
 * (\`src/authorship/authorship_log_serialization.rs\`).
 *
 * \`sha256\` values are the digests GitHub publishes for the release assets and
 * that git-ai's own \`SHA256SUMS\` repeats. Never \`latest\`, never a range: the
 * install path resolves exactly this tag and refuses anything whose bytes hash
 * differently.
 */`;
