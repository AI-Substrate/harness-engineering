import type { DdDoc, DdShape, ResolvedDdSchema } from '../core/model.js';
import { isRecord } from '../core/value.js';
import type { DdCursorKind, DdLocateResult, DdMutationFailure } from './model.js';

function refuse(reason: DdMutationFailure['reason'], message: string): DdMutationFailure {
  return { ok: false, reason, message };
}

/**
 * Walk a document's live value graph to the container that HOLDS the addressed
 * value.
 *
 * `links/resolver.ts` already descends an address, but it answers a different
 * question: it returns the value a reader wants. A writer needs the parent and
 * the key, because that is the only pair you can assign to or splice out of —
 * so this is a second job over the same grammar, not a second copy of the same
 * job. Both classify segments the same way and for the same stated reason:
 * shape-directed, never positional (the Phase 4 `--resolve` leaf ruling).
 *
 * The cursor points INTO `doc`, so callers clone before they mutate.
 */
export function locate(
  doc: DdDoc,
  schema: ResolvedDdSchema,
  segments: readonly string[],
  options: { permissiveTail?: boolean } = {},
): DdLocateResult {
  const [first, ...rest] = segments;
  if (first === undefined) return refuse('section-unknown', 'address interior names no section');

  const declaration = schema.sections[first];
  if (!declaration) {
    return refuse('section-unknown', `schema "${schema.name}" declares no section "${first}"`);
  }
  const section = doc.sections.find((candidate) => candidate.name === first);
  if (!section) return refuse('section-unknown', `the document has no section "${first}"`);

  const trail: string[] = [first];
  let parent: unknown[] | Record<string, unknown> | null = null;
  let key: string | number = first;
  let value: unknown = section.value;
  let shape: DdShape | undefined = declaration.shape;
  let kind: DdCursorKind = 'section';

  for (const [index, segment] of rest.entries()) {
    const last = index === rest.length - 1;
    if (shape?.type === 'array') {
      if (!Array.isArray(value)) {
        return refuse('container-invalid', `"${trail.join('/')}" is not an array in this document`);
      }
      const at = value.findIndex((entry) => isRecord(entry) && entry.id === segment);
      if (at < 0) {
        return refuse('target-unknown', `no entry with id "${segment}" in "${trail.join('/')}"`);
      }
      parent = value;
      key = at;
      value = value[at];
      shape = shape.items;
      kind = 'instance';
      trail.push(segment);
      continue;
    }
    if (shape?.type === 'object') {
      if (!isRecord(value)) {
        return refuse(
          'container-invalid',
          `"${trail.join('/')}" is not an object in this document`,
        );
      }
      const declaredField = shape.fields?.[segment];
      const fieldShape = declaredField ?? shape.valuesShape;
      if (!fieldShape) {
        return refuse('target-unknown', `"${trail.join('/')}" declares no part "${segment}"`);
      }
      const present = segment in value;
      // The permissive tail is what makes a JIT-born key addressable BEFORE it
      // exists: `dd add <file>#done_when/tk-7028 '[...]'` has to name a key the
      // document does not carry yet. It is deliberately the LAST segment only —
      // a missing key mid-path is still a genuine miss, not an invitation to
      // conjure the whole chain.
      if (!present && !(last && options.permissiveTail === true)) {
        return refuse(
          'target-unknown',
          `the document carries no "${segment}" at "${trail.join('/')}"`,
        );
      }
      parent = value;
      key = segment;
      value = present ? value[segment] : undefined;
      shape = fieldShape;
      kind = declaredField ? 'part' : 'instance';
      trail.push(segment);
      continue;
    }
    return refuse(
      'container-invalid',
      `"${trail.join('/')}" is a ${shape?.type ?? 'leaf'} and cannot contain "${segment}"`,
    );
  }

  return { ok: true, parent, key, value, shape, kind, trail };
}
