import { isAddressFailure, parseAddress } from '@ai-substrate/dd';
import type { DdDoc, ResolvedDdSchema } from '@ai-substrate/dd/core/model';
import { resolveAddressFile } from '@ai-substrate/dd/core/validate';
import type { DdLinkEdge } from '@ai-substrate/dd/links';
import {
  addressableAt,
  anchorForLocation,
  type DdDocumentIndex,
  indexDocument,
} from '@ai-substrate/dd/links';
import { isWithin, posixRelative, toPosix } from '../shared/posix-path.js';
import { DEFAULT_GATE_TERMINAL_STATES } from './dd-mechanisms/constants.js';
import { deriveItems } from './dd-mechanisms/derive.js';
import { collectDeclaredRels, effectiveRel } from './dd-mechanisms/rel.js';
import { isRecord } from './dd-mechanisms/value.js';
import type { PlanEdge, PlanIndex, PlanItem } from './model.js';

export interface PlanDocument {
  path: string;
  doc: DdDoc;
  schema: ResolvedDdSchema;
}

const LABEL_FIELDS = ['title', 'claim', 'criterion', 'assertion', 'text', 'brief', 'name'] as const;

function labelOf(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const field of LABEL_FIELDS) {
    const candidate = value[field];
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim();
  }
  return null;
}

/**
 * The identity two producers must agree on: a filesystem walk (native
 * separators on Windows) and a parsed dd address (always forward slashes).
 * `toPosix` here means both spellings of one document collapse to one key,
 * regardless of what the caller passes in (plan 108 · A2).
 */
export function itemKey(path: string, interior: readonly string[]): string {
  return `${toPosix(path)}#${interior.join('/')}`;
}

/**
 * Converges on the same shape as `links/map.ts`'s `displayAddress`
 * (`posixRelative`, not a hand-rolled `startsWith` prefix test) so there is
 * one repo-relative-address grammar, not two (plan 108 · A1).
 *
 * The `: toPosix(path)` fallback fires when `path === repoRoot` — that is the
 * one case where `posixRelative` returns `''`. An OUTSIDE-repoRoot path does
 * NOT take this fallback: `posixRelative` returns a non-empty `../…` climb for
 * it instead, so the RELATIVE branch (`base = relative`) renders it. The
 * fallback is unreachable from `buildPlanIndex`, its only production caller,
 * which asserts `isWithin(root, path)` on every document before this is ever
 * reached — name the enforcer, because that assertion is the thing that would
 * have to change for the fallback to become reachable again, not a property
 * of this function itself.
 *
 * Exported (module-internal reach only — `package.json` exposes just `.` and
 * `./contract`, so this creates no SDK surface) specifically so A1 has a test
 * that cannot be masked: `buildPlanIndex` normalises its inputs before ever
 * calling this, so an integration-only test would pass with this function
 * still broken — it would never see the un-normalised input that breaks it.
 */
export function displayAddress(
  repoRoot: string,
  path: string,
  interior: readonly string[],
): string {
  const relative = posixRelative(repoRoot, path);
  const base = relative.length > 0 ? relative : toPosix(path);
  return interior.length === 0 ? base : `${base}#${interior.join('/')}`;
}

/**
 * Which `<schema>/section/<name>` pairs are the TARGET of a `satisfies` link
 * anywhere in the plan's schemas.
 *
 * This is how "acceptance criterion" is recognised without the word appearing in
 * the code. A section is a claim section because something declares that work
 * SATISFIES it — so a schema that calls its claims `outcomes`, or a second plan
 * schema entirely, gets the orphan check for free, and renaming a section in the
 * builder schema cannot silently switch the check off.
 */
export function claimSections(schemas: readonly ResolvedDdSchema[]): Set<string> {
  const targets = new Set<string>();
  for (const schema of schemas) {
    for (const declared of collectDeclaredRels(schema)) {
      if (effectiveRel(declared.rel) !== 'satisfies') continue;
      if (declared.target !== undefined) targets.add(declared.target);
    }
  }
  return targets;
}

function sectionTargetOf(schema: ResolvedDdSchema, interior: readonly string[]): string | null {
  const section = interior[0];
  return section === undefined ? null : `${schema.name}/section/${section}`;
}

/**
 * Flatten a plan's documents into one item graph.
 *
 * Items come from the SAME index the map walks (`indexDocument`), so a row means
 * the same thing to `dd graph map` and to `plan validate` — two readings of one
 * structure, never two structures that have to agree.
 *
 * Edges are re-anchored from documents onto items: `traverseCorpus` answers
 * "which file cites which file", and the semantic layer needs "which ROW cites
 * which row". `anchorForLocation` turns an edge's location back into the nearest
 * addressable row, which is exactly the citer.
 *
 * `repoRoot` and `documents[].path` are bare `string`, not a branded/validated
 * type, even though this function TRUSTS them to be POSIX. It normalises them
 * defensively on entry (a runtime guard, not a compile-time one) — but **a new
 * caller must not rely on that: pass an already-normalised root.**
 *
 * That instruction is deliberately phrased as a rule for callers rather than as a
 * claim about how many callers exist. A headcount goes stale silently and a
 * reader either trusts a wrong number or has to re-derive it; an instruction
 * stays true however the call graph changes. **It is not enforced by a test** —
 * enforcing it needs a closed-world reference guard, which is issue #115.
 *
 * A branded type was considered and declined: it would thread ceremony through an
 * already-guarded call chain (plan 108 · dlg-0003). RECONSIDER if this grows a
 * second real entry point — another caller, or a new package export — at which
 * point the type would defend an actual multi-producer surface rather than a
 * hypothetical one.
 */
export function buildPlanIndex(
  documents: readonly PlanDocument[],
  edges: readonly DdLinkEdge[],
  repoRoot: string,
): PlanIndex {
  // Every caller trusts `repoRoot` and each `documents[].path` to already be
  // POSIX — no CLI ingress violates that today (plan 108 · dlg-0003), but the
  // trust was undocumented and unenforced. Normalising here means a future
  // caller cannot re-arm A1/A2 by handing in a native-spelled path.
  const root = toPosix(repoRoot);
  const claims = claimSections(documents.map((entry) => entry.schema));
  const indexes = new Map<string, DdDocumentIndex>();
  const schemas = new Map<string, ResolvedDdSchema>();
  for (const entry of documents) {
    const path = toPosix(entry.path);
    // The one precondition `displayAddress` needs to never fall onto its
    // out-of-repo branch: every document this function is handed is already
    // proven inside `root` by its ONLY two producers (`check.ts`'s
    // `resolvePlanAddress`/`planDocumentSet`, both `isWithin`-gated before a
    // path ever reaches a `PlanDocument`). Asserting it HERE, at the boundary,
    // means a future producer that skips that gate fails loudly and by name,
    // instead of `displayAddress` quietly rendering something plausible-looking
    // for an address that was never supposed to exist.
    if (!isWithin(root, path)) {
      throw new Error(`buildPlanIndex: document path is outside repoRoot: ${path} (root: ${root})`);
    }
    indexes.set(path, indexDocument(path, entry.doc, entry.schema));
    schemas.set(path, entry.schema);
  }

  const items: PlanItem[] = [];
  const byKey = new Map<string, PlanItem>();
  for (const [path, index] of indexes) {
    const schema = schemas.get(path);
    for (const entry of index.entries) {
      const key = itemKey(path, entry.interior);
      if (byKey.has(key)) continue;
      const state =
        isRecord(entry.value) && typeof entry.value.state === 'string' ? entry.value.state : null;
      const completable = state !== null && entry.terminal !== null;
      const terminalSet = new Set(entry.terminal ?? DEFAULT_GATE_TERMINAL_STATES);
      // A container's doneness is DERIVED from its members — which is exactly
      // what a `derives` edge means, and the same computation `markOf` does for
      // the map's pips. Without it a task's `done` link would point at a list
      // that can never be open or closed, and the one contradiction the design
      // most wants to catch (a task ticked over unproven assertions) would be
      // structurally invisible.
      const members =
        state === null && !completable
          ? deriveItems({ name: entry.interior.at(-1) ?? 'document', value: entry.value })
          : [];
      const derived = members.length > 0;
      const sectionTarget = schema ? sectionTargetOf(schema, entry.interior) : null;
      const item: PlanItem = {
        key,
        path,
        interior: entry.interior,
        address: displayAddress(root, path, entry.interior),
        location: entry.location,
        kind: entry.kind,
        state,
        terminal: entry.terminal,
        completable,
        derived,
        checkable: completable || derived,
        done: completable
          ? terminalSet.has(state as string)
          : derived && members.every((member) => terminalSet.has(member.state)),
        label: labelOf(entry.value),
        claim: entry.kind === 'instance' && sectionTarget !== null && claims.has(sectionTarget),
      };
      items.push(item);
      byKey.set(key, item);
    }
  }

  const planEdges: PlanEdge[] = [];
  for (const edge of edges) {
    const fromPath = toPosix(edge.from);
    const sourceIndex = indexes.get(fromPath);
    if (!sourceIndex) continue;
    const fromInterior = anchorForLocation(sourceIndex, edge.location);
    const from = itemKey(fromPath, fromInterior);
    if (!byKey.has(from)) continue;

    let to: string | null = null;
    const parsed = parseAddress(edge.address);
    if (!isAddressFailure(parsed)) {
      const targetPath =
        parsed.file === null ? fromPath : resolveAddressFile(fromPath, parsed.file);
      const targetIndex = indexes.get(targetPath);
      if (targetIndex) {
        const interior = parsed.segments.map((segment) => segment.value);
        const resolved = addressableAt(targetIndex, interior);
        if (resolved) to = itemKey(targetPath, resolved.interior);
      }
    }
    planEdges.push({ from, to, rel: edge.rel, address: edge.address, location: edge.location });
  }

  return { items, edges: planEdges, byKey };
}
