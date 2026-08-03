import { isAddressFailure, parseAddress } from '../core/address.js';
import { DEFAULT_GATE_TERMINAL_STATES } from '../core/constants.js';
import { type DdDerivedState, deriveState } from '../core/derive.js';
import type { DdDoc, ResolvedDdSchema } from '../core/model.js';
import { parse } from '../core/parse.js';
import { collectLinkCells, resolveAddressFile } from '../core/validate.js';
import { sectionForAddress } from './renderer.js';

/** The narrow read surface refresh needs. `NodeSchemaFs` satisfies it structurally. */
export interface DdRefreshFs {
  readText(path: string): string | null;
}

/** Content hashing, declared here so this layer never imports a harness adapter. */
export interface DdRefreshHash {
  sha256Hex(input: string): string;
}

export type DdRefreshIssueClass = 'basis-refresh-failed' | 'watch-failed';

export interface DdRefreshIssue {
  class: DdRefreshIssueClass;
  severity: 'WARN';
  path: string;
  message: string;
}

export interface DdRefreshedBasis {
  path: string;
  /** The sha recorded in the document's ledger. */
  recorded: string;
  /** The sha the target actually hashes to right now. */
  actual: string;
}

export interface DdRefreshResult {
  /**
   * Cross-file derived summaries, keyed by the raw address as written in the cell —
   * exactly the map `renderDd` consumes.
   */
  derived: Map<string, DdDerivedState>;
  /** Live entries whose target has moved since the ledger recorded it. */
  refreshed: DdRefreshedBasis[];
  issues: DdRefreshIssue[];
}

export interface RefreshOptions {
  doc: DdDoc;
  /** Path of the document being rendered — every relative address resolves from here. */
  path: string;
  schema: ResolvedDdSchema;
  gateTerminal?: readonly string[];
  fs: DdRefreshFs;
  hash: DdRefreshHash;
}

/**
 * Recompute what a `live` ledger entry promises: that this document's VIEW of its
 * transclusions is current at render time (workshop-001 — "auto-refreshes at
 * render; view freshness; refreshing is always correct").
 *
 * **It does not rewrite the document.** Two reasons, and they are the ruling:
 * `dd build` would otherwise become a mutating verb that fights its own drift gate
 * (every build would dirty the `.dd.json`, so `--check` could never be stable); and
 * staleness already has an owner — `dd validate` reports `basis-stale`, and P4's
 * `verify-basis` adjudicates a pinned one. Duplicating that surface here would give
 * an operator two answers to one question.
 *
 * So the refresh's visible effect is the **derived summaries** — a task row that
 * says `[~] 2/3` about a list living in another file. `refreshed[]` reports which
 * bases have moved, for a caller that wants to say so.
 *
 * The ledger is the opt-in: only files carrying a `live` entry are read, so a
 * document declares what it transcludes rather than dragging in every link it
 * happens to mention. `pinned` entries are untouched — they are P4's.
 */
export function refreshLiveReferences(options: RefreshOptions): DdRefreshResult {
  const gateTerminal = options.gateTerminal ?? DEFAULT_GATE_TERMINAL_STATES;
  const derived = new Map<string, DdDerivedState>();
  const refreshed: DdRefreshedBasis[] = [];
  const issues: DdRefreshIssue[] = [];

  const live = new Map<string, string>();
  for (const reference of options.doc.references) {
    if (reference.mode !== 'live') continue;
    live.set(resolveAddressFile(options.path, reference.path), reference.sha);
  }
  if (live.size === 0) return { derived, refreshed, issues };

  const loaded = new Map<string, DdDoc | null>();
  const loadTarget = (targetPath: string): DdDoc | null => {
    const cached = loaded.get(targetPath);
    if (cached !== undefined) return cached;
    const text = options.fs.readText(targetPath);
    if (text === null) {
      issues.push({
        class: 'basis-refresh-failed',
        severity: 'WARN',
        path: targetPath,
        message: `live reference target is missing or unreadable: ${targetPath}`,
      });
      loaded.set(targetPath, null);
      return null;
    }
    const recorded = live.get(targetPath);
    const actual = options.hash.sha256Hex(text);
    if (recorded !== undefined && recorded !== actual) {
      refreshed.push({ path: targetPath, recorded, actual });
    }
    const parsed = parse(text);
    if (Array.isArray(parsed)) {
      issues.push({
        class: 'basis-refresh-failed',
        severity: 'WARN',
        path: targetPath,
        message: `live reference target is not a readable dd document: ${targetPath}`,
      });
      loaded.set(targetPath, null);
      return null;
    }
    loaded.set(targetPath, parsed);
    return parsed;
  };

  // Touch every live target once, even one nothing links into: a moved basis is
  // worth reporting whether or not a cell happens to summarise it.
  for (const targetPath of live.keys()) loadTarget(targetPath);

  for (const cell of collectLinkCells(options.doc, options.schema)) {
    const address = parseAddress(cell.raw);
    if (isAddressFailure(address) || address.file === null) continue;
    const targetPath = resolveAddressFile(options.path, address.file);
    if (!live.has(targetPath)) continue;
    const target = loadTarget(targetPath);
    if (!target) continue;
    const section = sectionForAddress(target, address);
    if (!section) continue;
    derived.set(cell.raw, deriveState(section, gateTerminal));
  }

  return { derived, refreshed, issues };
}

/** True when `doc` declares a reference to `targetPath` — its own outbound ledger only. */
export function referencesTarget(doc: DdDoc, docPath: string, targetPath: string): boolean {
  return doc.references.some(
    (reference) => resolveAddressFile(docPath, reference.path) === targetPath,
  );
}

// ---------------------------------------------------------------------------
// Watcher — library support only. No daemon, no sensor declaration (P5 owns those).
// ---------------------------------------------------------------------------

export interface DdWatchSubscription {
  close(): void;
}

/**
 * The watcher seam, injected. Deliberately the smallest thing that can be true:
 * "tell me which paths changed". Anything richer would bake a scheduler's shape
 * into a library that must also work under a fake.
 */
export interface DdWatcherPort {
  watch(root: string, onChange: (changed: readonly string[]) => void): DdWatchSubscription;
}

export interface WatchForRegenerationOptions {
  root: string;
  watcher: DdWatcherPort;
  fs: DdRefreshFs;
  hash: DdRefreshHash;
  /** Documents to rebuild when `changed` moves. The caller owns the scan (D11 — nothing stored). */
  dependentsOf(changed: string): readonly string[];
  /** Regenerate one document's sibling — the act injects the real CLI build path. */
  regenerate(documentPath: string): Promise<{ regenerated: boolean; reason?: string }>;
  onIssue?(issue: DdRefreshIssue): void;
}

/**
 * Regenerate a consumer's markdown when the source it transcludes actually changes.
 *
 * **The content-hash contract is the point.** A watcher may fire on an mtime touch,
 * an editor's atomic-rename dance, or its own debounce flush; if that became a
 * rebuild, a save-with-no-edit would rewrite files and the drift gate would churn.
 * So a change is only a change when the bytes hash differently from the last hash
 * this subscription saw — which makes ANY watcher honest, rather than requiring a
 * particular one.
 *
 * Depth-1 revalidate-on-save stays deferred with W7: this regenerates views, it
 * does not re-run validation.
 */
export function watchForRegeneration(options: WatchForRegenerationOptions): DdWatchSubscription {
  const seen = new Map<string, string>();

  const report = (issue: DdRefreshIssue): void => options.onIssue?.(issue);

  const onChange = (changed: readonly string[]): void => {
    for (const path of changed) {
      const text = options.fs.readText(path);
      // A deleted file has no content to hash; forget it so its recreation counts
      // as a change, and let the dependent's own render report the missing basis.
      if (text === null) {
        seen.delete(path);
        continue;
      }
      const hash = options.hash.sha256Hex(text);
      if (seen.get(path) === hash) continue;
      seen.set(path, hash);

      for (const dependent of options.dependentsOf(path)) {
        void options
          .regenerate(dependent)
          .then((result) => {
            if (!result.regenerated) {
              report({
                class: 'watch-failed',
                severity: 'WARN',
                path: dependent,
                message: `regeneration failed after ${path} changed: ${result.reason ?? 'unknown'}`,
              });
            }
          })
          .catch((error: unknown) => {
            report({
              class: 'watch-failed',
              severity: 'WARN',
              path: dependent,
              message: `regeneration threw after ${path} changed: ${
                error instanceof Error ? error.message : String(error)
              }`,
            });
          });
      }
    }
  };

  try {
    return options.watcher.watch(options.root, onChange);
  } catch (error) {
    report({
      class: 'watch-failed',
      severity: 'WARN',
      path: options.root,
      message: `could not subscribe to ${options.root}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
    return { close: () => {} };
  }
}
