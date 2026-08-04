import { BUILTIN_RELS, type BuiltinRel, DEFAULT_REL } from './constants.js';
import type { DdShape, ResolvedDdSchema } from './model.js';

/**
 * The relation an edge actually carries.
 *
 * Undeclared and unknown collapse to the same answer on purpose: the built-in
 * set is frozen, the namespace is open, and a consumer must never have to ask
 * "is this one of ours?" before it can walk an edge. Extra MEANING is what a
 * built-in rel buys; an unknown one is still a first-class link.
 */
export function relOf(shape: DdShape | undefined): string {
  const declared = shape?.rel;
  return declared === undefined || declared.trim().length === 0 ? DEFAULT_REL : declared;
}

/** Whether a relation is one of the frozen five — i.e. whether dd attaches semantics to it. */
export function isBuiltinRel(rel: string): rel is BuiltinRel {
  return (BUILTIN_RELS as readonly string[]).includes(rel);
}

/** The semantics dd applies to an edge: an unknown rel is treated as `ref`. */
export function effectiveRel(rel: string): BuiltinRel {
  return isBuiltinRel(rel) ? rel : DEFAULT_REL;
}

export interface DeclaredRel {
  /** Dotted shape path, e.g. `tasks.satisfies[]` or `acceptance_criteria.pressure`. */
  field: string;
  rel: string;
  target?: string;
  /** False when the relation is outside the frozen five — legal, but semantics-free. */
  builtin: boolean;
}

/**
 * Every link field a schema declares, with the relation it carries.
 *
 * This is what makes "does the engine actually see anything?" a testable
 * question. A contradiction engine written perfectly against relations is INERT
 * if no shipped schema declares one (validation finding F2), and no unit test of
 * the engine can notice — so the schema test pins this list instead.
 */
export function collectDeclaredRels(schema: ResolvedDdSchema): DeclaredRel[] {
  const found: DeclaredRel[] = [];
  const visit = (shape: DdShape | undefined, field: string): void => {
    if (!shape) return;
    if (shape.type === 'link') {
      found.push({
        field,
        rel: relOf(shape),
        ...(shape.target !== undefined && { target: shape.target }),
        builtin: isBuiltinRel(relOf(shape)),
      });
      return;
    }
    if (shape.type === 'array') {
      visit(shape.items, `${field}[]`);
      return;
    }
    if (shape.type === 'object') {
      for (const [name, child] of Object.entries(shape.fields ?? {})) {
        visit(child, `${field}.${name}`);
      }
      visit(shape.valuesShape, `${field}.*`);
    }
  };
  for (const [name, section] of Object.entries(schema.sections)) visit(section.shape, name);
  return found;
}
