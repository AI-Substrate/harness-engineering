import type { DdDoc, DdShape, ResolvedDdSchema } from '../core/model.js';
import { type DdIssue, type SchemaResolver, validateDocument } from '../core/validate.js';
import { isRecord } from '../core/value.js';
import { locate } from './locate.js';
import { mintId } from './mint.js';
import type { DdMutationFailure, DdMutationResult } from './model.js';

export interface DdMutationDeps {
  schema: ResolvedDdSchema;
  /** Used for the BEFORE/AFTER validation diff that gates every write. */
  schemaResolver: SchemaResolver;
  repoRoot: string;
  path: string;
}

export type DdMutationOutcome = DdMutationResult | DdMutationFailure;

function refuse(
  reason: DdMutationFailure['reason'],
  message: string,
  introduced?: DdIssue[],
): DdMutationFailure {
  return { ok: false, reason, message, ...(introduced && { introduced }) };
}

function clone(doc: DdDoc): DdDoc {
  return JSON.parse(JSON.stringify(doc)) as DdDoc;
}

/**
 * Read a supplied command-line string as the DECLARED type.
 *
 * A CLI hands every value over as text, so something has to decide that `3` is an
 * int and `checked` is a state. Asking the shape is the only answer that cannot
 * be wrong: the same characters mean different things in different cells, and
 * guessing from the characters alone would make `dd set …/note 3` silently write
 * a number into a string field.
 *
 * `asJson` is the explicit override for the cases a shape cannot settle — an
 * undeclared interior (A3), or replacing a whole instance in one stroke.
 */
export function coerceValue(
  raw: string,
  shape: DdShape | undefined,
  asJson: boolean,
): { ok: true; value: unknown } | DdMutationFailure {
  if (asJson) {
    try {
      return { ok: true, value: JSON.parse(raw) as unknown };
    } catch {
      return refuse('value-invalid', `--value-json was supplied but the value is not valid JSON`);
    }
  }
  switch (shape?.type) {
    case 'int': {
      const value = Number(raw);
      return Number.isInteger(value)
        ? { ok: true, value }
        : refuse('value-invalid', `"${raw}" is not an integer`);
    }
    case 'number': {
      const value = Number(raw);
      return Number.isFinite(value)
        ? { ok: true, value }
        : refuse('value-invalid', `"${raw}" is not a finite number`);
    }
    case 'bool':
      if (raw === 'true') return { ok: true, value: true };
      if (raw === 'false') return { ok: true, value: false };
      return refuse('value-invalid', `"${raw}" is not "true" or "false"`);
    case 'array':
    case 'object':
      return refuse(
        'value-invalid',
        `"${shape.type}" values are structural — supply them with --value-json`,
      );
    default:
      return { ok: true, value: raw };
  }
}

/**
 * The gate every write passes: validate the MUTATED document and refuse on any
 * ERROR the mutation introduced.
 *
 * It is a diff, not an absolute bar, and the difference is the whole point. An
 * absolute bar would make a broken document unrepairable through the verbs —
 * which is precisely the corner the writer surface exists to get agents out of
 * (DF-012: every structural edit was ad-hoc python because there was no verb).
 * A finding that was already there stays the caller's problem to fix; a finding
 * this mutation created blocks it, and NOTHING is written.
 */
function gate(before: DdDoc, after: DdDoc, deps: DdMutationDeps): DdIssue[] {
  const signature = (issue: DdIssue): string =>
    `${issue.class}\u0000${issue.location}\u0000${issue.message}`;
  const existing = new Set(
    validateDocument(before, deps.path, deps.schemaResolver, deps.repoRoot)
      .filter((issue) => issue.severity === 'ERROR')
      .map(signature),
  );
  return validateDocument(after, deps.path, deps.schemaResolver, deps.repoRoot).filter(
    (issue) => issue.severity === 'ERROR' && !existing.has(signature(issue)),
  );
}

function applied(
  before: DdDoc,
  after: DdDoc,
  deps: DdMutationDeps,
  result: Omit<DdMutationResult, 'ok' | 'doc'>,
): DdMutationOutcome {
  const introduced = gate(before, after, deps);
  if (introduced.length > 0) {
    return refuse(
      'schema-refused',
      `the change would make ${deps.path} invalid: ${introduced[0]?.message ?? 'schema violation'}`,
      introduced,
    );
  }
  return { ok: true, doc: after, ...result };
}

/** Read the value at an address. The one verb of the four that never writes. */
export function ddGet(
  doc: DdDoc,
  schema: ResolvedDdSchema,
  segments: readonly string[],
): DdMutationOutcome {
  const cursor = locate(doc, schema, segments);
  if (!cursor.ok) return cursor;
  return { ok: true, doc, value: cursor.value, kind: cursor.kind, trail: cursor.trail };
}

/**
 * Set the value at an address, creating an ABSENT optional field rather than
 * refusing it.
 *
 * `set` means "make it this", so requiring the field to already exist would fail
 * on exactly the case a writer surface exists for: a task row that has never
 * carried a `done` link, an assertion that has never carried a `note`. The tail
 * is permissive only for a field the SCHEMA declares (or a map key the schema
 * shapes) — `#tasks/tk-9999/state` still refuses, because an array member is
 * found by id and a missing id is a genuine miss. The write gate then judges the
 * result, so permissiveness here can never produce an invalid document.
 */
export function ddSet(
  doc: DdDoc,
  segments: readonly string[],
  raw: string,
  deps: DdMutationDeps & { asJson?: boolean },
): DdMutationOutcome {
  const probe = locate(doc, deps.schema, segments, { permissiveTail: true });
  if (!probe.ok) return probe;
  const coerced = coerceValue(raw, probe.shape, deps.asJson === true);
  if (!coerced.ok) return coerced;

  const after = clone(doc);
  const cursor = locate(after, deps.schema, segments, { permissiveTail: true });
  if (!cursor.ok) return cursor;
  if (cursor.parent === null) {
    const section = after.sections.find((entry) => entry.name === cursor.key);
    if (!section) return refuse('section-unknown', `the document has no section "${cursor.key}"`);
    section.value = coerced.value;
  } else if (Array.isArray(cursor.parent)) {
    cursor.parent[cursor.key as number] = coerced.value;
  } else {
    cursor.parent[cursor.key as string] = coerced.value;
  }
  return applied(doc, after, deps, {
    value: coerced.value,
    kind: cursor.kind,
    trail: cursor.trail,
  });
}

/**
 * Append an item to an addressed list, or create an addressed map entry.
 *
 * `--mint` fills the item's `id` from the CLI rather than the caller's head. It
 * REFUSES an item that already carries one instead of overwriting it: an id is
 * born once, and silently replacing an author's explicit id would be the writer
 * surface quietly rewriting identity.
 */
export function ddAdd(
  doc: DdDoc,
  segments: readonly string[],
  raw: string,
  deps: DdMutationDeps & { mint?: string },
): DdMutationOutcome {
  let item: unknown;
  try {
    item = JSON.parse(raw) as unknown;
  } catch {
    return refuse('value-invalid', 'the item to add is not valid JSON');
  }

  const after = clone(doc);
  const cursor = locate(after, deps.schema, segments, { permissiveTail: true });
  if (!cursor.ok) return cursor;

  let minted: string | undefined;
  if (deps.mint !== undefined) {
    if (!isRecord(item)) {
      return refuse('value-invalid', '--mint needs an object item to carry the minted id');
    }
    if (typeof item.id === 'string' && item.id.length > 0) {
      return refuse(
        'id-conflict',
        `the item already carries id "${item.id}" — drop --mint, or drop the id`,
      );
    }
    const result = mintId(after, deps.mint);
    if (!result.ok) return result;
    minted = result.id;
    // `id` first so the rendered row leads with it, exactly as every hand-authored
    // instance in the corpus does.
    item = { id: minted, ...item };
  }

  if (cursor.value === undefined) {
    // Permissive tail: a map entry that does not exist yet.
    const parent = cursor.parent;
    if (parent === null || Array.isArray(parent)) {
      return refuse('container-invalid', `"${cursor.trail.join('/')}" cannot hold a new entry`);
    }
    // A JIT-born container for an APPEND is a LIST. `add` means "put this item in
    // that collection", so birthing the bare item would make the first add
    // produce a different SHAPE from every subsequent one — and against a schema
    // whose map values are arrays (`done_when`), the very first `dd add --mint`
    // would be refused as `value must be an array`.
    //
    // An array item passes through untouched: `dd add <map-key> '[{…}]'` is
    // birthing the whole list at once, which is a different, legitimate thing to
    // ask for. (That form is what the plan-070 control happened to use, which is
    // exactly why it never caught this — the phase-2 dry-run did.)
    const born = Array.isArray(item) ? item : [item];
    parent[cursor.key as string] = born;
    return applied(doc, after, deps, {
      value: born,
      kind: cursor.kind,
      trail: cursor.trail,
      ...(minted !== undefined && { minted }),
    });
  }

  if (!Array.isArray(cursor.value)) {
    return refuse(
      'target-exists',
      `"${cursor.trail.join('/')}" is not a list — use \`dd set\` to replace it`,
    );
  }
  cursor.value.push(item);
  return applied(doc, after, deps, {
    value: item,
    kind: cursor.kind,
    trail: cursor.trail,
    ...(minted !== undefined && { minted }),
  });
}

/** Remove the array member, map entry, field or section an address names. */
export function ddRemove(
  doc: DdDoc,
  segments: readonly string[],
  deps: DdMutationDeps,
): DdMutationOutcome {
  const after = clone(doc);
  const cursor = locate(after, deps.schema, segments);
  if (!cursor.ok) return cursor;
  const removed = cursor.value;

  if (cursor.parent === null) {
    const index = after.sections.findIndex((entry) => entry.name === cursor.key);
    if (index < 0) return refuse('section-unknown', `the document has no section "${cursor.key}"`);
    after.sections.splice(index, 1);
  } else if (Array.isArray(cursor.parent)) {
    cursor.parent.splice(cursor.key as number, 1);
  } else {
    delete cursor.parent[cursor.key as string];
  }
  return applied(doc, after, deps, {
    value: removed,
    kind: cursor.kind,
    trail: cursor.trail,
  });
}

/** Canonical two-space serialization — the one form every dd writer emits. */
export function serializeDoc(doc: DdDoc, original: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(original) as unknown;
  } catch {
    parsed = {};
  }
  // Preserve any top-level key the envelope parser does not model (`references`
  // is modelled; a future sibling ledger would not be), so a mutation can never
  // silently drop a field it does not understand.
  const base = isRecord(parsed) ? parsed : {};
  const next: Record<string, unknown> = {
    ...base,
    dd: doc.dd,
    sections: doc.sections,
  };
  if (doc.references.length > 0) next.references = doc.references;
  else delete next.references;
  return `${JSON.stringify(next, null, 2)}\n`;
}
