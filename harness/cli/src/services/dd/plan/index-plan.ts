import { isAddressFailure, parseAddress } from '../core/address.js';
import { DEFAULT_GATE_TERMINAL_STATES } from '../core/constants.js';
import { deriveItems } from '../core/derive.js';
import type { DdDoc, ResolvedDdSchema } from '../core/model.js';
import { collectDeclaredRels, effectiveRel } from '../core/rel.js';
import { resolveAddressFile } from '../core/validate.js';
import { isRecord } from '../core/value.js';
import {
  addressableAt,
  anchorForLocation,
  type DdDocumentIndex,
  indexDocument,
} from '../links/map.js';
import type { DdLinkEdge } from '../links/model.js';
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

export function itemKey(path: string, interior: readonly string[]): string {
  return `${path}#${interior.join('/')}`;
}

function displayAddress(repoRoot: string, path: string, interior: readonly string[]): string {
  const root = repoRoot.replace(/\/+$/, '');
  const relative = path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path;
  return interior.length === 0 ? relative : `${relative}#${interior.join('/')}`;
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
 */
export function buildPlanIndex(
  documents: readonly PlanDocument[],
  edges: readonly DdLinkEdge[],
  repoRoot: string,
): PlanIndex {
  const claims = claimSections(documents.map((entry) => entry.schema));
  const indexes = new Map<string, DdDocumentIndex>();
  const schemas = new Map<string, ResolvedDdSchema>();
  for (const entry of documents) {
    indexes.set(entry.path, indexDocument(entry.path, entry.doc, entry.schema));
    schemas.set(entry.path, entry.schema);
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
        address: displayAddress(repoRoot, path, entry.interior),
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
    const sourceIndex = indexes.get(edge.from);
    if (!sourceIndex) continue;
    const fromInterior = anchorForLocation(sourceIndex, edge.location);
    const from = itemKey(edge.from, fromInterior);
    if (!byKey.has(from)) continue;

    let to: string | null = null;
    const parsed = parseAddress(edge.address);
    if (!isAddressFailure(parsed)) {
      const targetPath =
        parsed.file === null ? edge.from : resolveAddressFile(edge.from, parsed.file);
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
