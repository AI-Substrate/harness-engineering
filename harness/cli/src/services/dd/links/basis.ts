import type { DdReference } from '../core/model.js';
import { resolveAddressFile } from '../core/validate.js';
import { isRecord } from '../core/value.js';
import type { DdBasisVerdict, DdLinkIssue } from './model.js';
import { linkIssue } from './model.js';
import { type DdLinkResolveOptions, type DdLinkResolverDeps, resolveLink } from './resolver.js';

export type DdBasisResult =
  | { ok: true; verdict: DdBasisVerdict }
  | { ok: false; issues: DdLinkIssue[] };

/**
 * `verify-basis(address, recorded-sha) → fresh | stale` — workshop 001's one
 * consumer-facing primitive, and the reason the ledger exists.
 *
 * Consumers derive state *through* links (D12): a flow node gates on an AC
 * section, and if a row is added upstream the previously-satisfied gate is
 * silently wrong. Nothing about the consumer's own storage can detect that; the
 * recorded digest can. So this is deliberately a pure question about two shas —
 * a non-dd consumer records the same basis beside its own link and asks exactly
 * the same question. `stale` means recompute, never "trust the cached verdict".
 */
export function verifyBasis(
  address: string,
  recordedSha: string,
  deps: DdLinkResolverDeps,
  options: DdLinkResolveOptions,
): DdBasisResult {
  const resolution = resolveLink(address, deps, options);
  if (!resolution.ok) return { ok: false, issues: resolution.issues };
  const { target } = resolution;
  return {
    ok: true,
    verdict: {
      state: target.sha === recordedSha ? 'fresh' : 'stale',
      address: target.address,
      path: target.path,
      recorded: recordedSha,
      actual: target.sha,
    },
  };
}

/** Look up the ledger entry a document records for one target document. */
export function findLedgerEntry(
  references: readonly DdReference[],
  fromPath: string,
  targetPath: string,
): DdReference | undefined {
  return references.find(
    (reference) => resolveAddressFile(fromPath, reference.path) === targetPath,
  );
}

export type DdLedgerUpdate =
  | { ok: true; text: string; previous: string; entry: DdReference }
  | { ok: false; message: string };

/**
 * Move one recorded basis to a new sha — the *explicit re-verification* a
 * `pinned` entry only ever moves by (workshop 001).
 *
 * Two properties are load-bearing, and both are asserted by tests:
 *
 * 1. **Only `sha` changes.** The entry is rewritten by spread, so `mode` (and any
 *    other field an author put there) survives byte-identically. Re-verifying a
 *    citation must never quietly turn it into a transclusion.
 * 2. **It moves an entry; it never mints one.** A missing entry is reported, not
 *    invented — adding a document to the ledger is authoring, and authoring is
 *    not what a re-verification verb is allowed to do behind your back.
 *
 * Documents are machine-authored JSON, so the file is re-serialized in the
 * canonical two-space form rather than patched in place.
 */
export function updateLedgerEntry(
  docText: string,
  docPath: string,
  targetPath: string,
  sha: string,
): DdLedgerUpdate {
  let parsed: unknown;
  try {
    parsed = JSON.parse(docText);
  } catch {
    return { ok: false, message: `${docPath} is not valid JSON` };
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.references)) {
    return { ok: false, message: `${docPath} carries no references ledger` };
  }

  const index = parsed.references.findIndex(
    (entry) =>
      isRecord(entry) &&
      typeof entry.path === 'string' &&
      resolveAddressFile(docPath, entry.path) === targetPath,
  );
  if (index < 0) {
    return {
      ok: false,
      message: `${docPath} records no basis entry for ${targetPath}`,
    };
  }

  const current = parsed.references[index] as DdReference;
  const previous = current.sha;
  const entry: DdReference = { ...current, sha };
  const references = [...parsed.references];
  references[index] = entry;
  const text = `${JSON.stringify({ ...parsed, references }, null, 2)}\n`;
  return { ok: true, text, previous, entry };
}

export function basisIssue(message: string, owner: string, location = '$.references'): DdLinkIssue {
  return linkIssue('link-unresolved', 'ERROR', location, message, owner, 'file-unreadable');
}
