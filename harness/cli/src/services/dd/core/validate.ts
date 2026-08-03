import { isAddressFailure, normalizeFilePath, parseAddress } from './address.js';
import { COMPLETION_STATES, ID_PREFIXES, MINTED_ID_PATTERN } from './constants.js';
import type { DdDoc, DdShape, ResolvedDdSchema } from './model.js';
import { isRecord } from './value.js';

export type DdSeverity = 'ERROR' | 'WARN';

export type DdIssueClass =
  | 'address-malformed'
  | 'address-path-absolute'
  | 'address-path-escape'
  | 'address-path-non-posix'
  | 'address-target-missing'
  | 'address-target-untracked'
  | 'basis-stale'
  | 'duplicate-id'
  | 'enum-invalid'
  | 'human-skipped-receipt-required'
  | 'id-invalid'
  | 'link-type-mismatch'
  | 'schema-shape'
  | 'schema-unresolvable'
  | 'state-note-required';

export interface DdIssue {
  class: DdIssueClass;
  severity: DdSeverity;
  location: string;
  message: string;
  /** The document that must change to resolve the finding. */
  owner: string;
}

export type SchemaResolveResult =
  | { ok: true; schema: ResolvedDdSchema }
  | { ok: false; message: string };

/** P2 implements this interface with the real convention-based schema resolver. */
export interface SchemaResolver {
  resolve(schemaRef: string, fromPath: string): SchemaResolveResult;
}

export interface DdLinkCell {
  raw: string;
  location: string;
  target?: string;
}

interface ValidationContext {
  doc: DdDoc;
  path: string;
  repoRoot: string;
  schema: ResolvedDdSchema;
  issues: DdIssue[];
}

function addIssue(
  ctx: Pick<ValidationContext, 'issues' | 'path'>,
  issueClass: DdIssueClass,
  severity: DdSeverity,
  location: string,
  message: string,
): void {
  ctx.issues.push({ class: issueClass, severity, location, message, owner: ctx.path });
}

function dirname(path: string): string {
  const normalized = normalizeFilePath(path);
  const boundary = normalized.lastIndexOf('/');
  return boundary <= 0 ? (normalized.startsWith('/') ? '/' : '.') : normalized.slice(0, boundary);
}

export function resolveAddressFile(fromPath: string, target: string): string {
  const posixTarget = target.replaceAll('\\', '/');
  if (posixTarget.startsWith('/')) return normalizeFilePath(posixTarget);
  return normalizeFilePath(`${dirname(fromPath)}/${posixTarget}`);
}

export function isPathWithinRepo(path: string, root: string): boolean {
  const normalizedPath = normalizeFilePath(path);
  const normalizedRoot = normalizeFilePath(root).replace(/\/+$/, '');
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function enumValues(shape: DdShape, schema: ResolvedDdSchema): readonly string[] | undefined {
  if (shape.values) return shape.values;
  if (shape.enum) return schema.enums?.[shape.enum]?.values;
  return shape.type === 'state' ? COMPLETION_STATES : undefined;
}

function validateStateNotes(
  value: Record<string, unknown>,
  location: string,
  ctx: ValidationContext,
) {
  const state = value.state;
  if ((state === 'blocked' || state === 'na') && !nonEmptyString(value.note)) {
    addIssue(
      ctx,
      'state-note-required',
      'ERROR',
      `${location}.note`,
      `state "${state}" requires a non-empty note`,
    );
  }
  if (state === 'human-skipped') {
    const receipt = value.receipt;
    const verbatim =
      nonEmptyString(receipt) || (isRecord(receipt) && nonEmptyString(receipt.verbatim_words));
    if (!verbatim) {
      addIssue(
        ctx,
        'human-skipped-receipt-required',
        'ERROR',
        `${location}.receipt`,
        'state "human-skipped" requires a receipt containing the human verbatim words',
      );
    }
  }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateLink(raw: string, shape: DdShape, location: string, ctx: ValidationContext) {
  const address = parseAddress(raw);
  if (isAddressFailure(address)) {
    addIssue(ctx, 'address-malformed', 'ERROR', location, address.message);
    return;
  }
  if (address.file !== null) {
    if (address.file.includes('\\')) {
      addIssue(
        ctx,
        'address-path-non-posix',
        'WARN',
        location,
        'address paths should use POSIX separators',
      );
    }
    if (address.file.startsWith('/') || /^[A-Za-z]:[\\/]/.test(address.file)) {
      addIssue(
        ctx,
        'address-path-absolute',
        'WARN',
        location,
        'address paths should be relative to the containing document',
      );
    }
    const targetPath = resolveAddressFile(ctx.path, address.file);
    if (!isPathWithinRepo(targetPath, ctx.repoRoot)) {
      addIssue(
        ctx,
        'address-path-escape',
        'WARN',
        location,
        `address resolves outside the repository: ${targetPath}`,
      );
    }
    return;
  }

  if (shape.target) {
    const sectionName = address.segments[0]?.value;
    const actual = sectionName ? `${ctx.schema.name}/section/${sectionName}` : ctx.schema.name;
    if (actual !== shape.target) {
      addIssue(
        ctx,
        'link-type-mismatch',
        'ERROR',
        location,
        `link targets "${actual}", expected "${shape.target}"`,
      );
    }
  }
}

function collectShapeLinks(
  value: unknown,
  shape: DdShape,
  location: string,
  links: DdLinkCell[],
): void {
  if (shape.type === 'link') {
    if (typeof value === 'string') {
      links.push({ raw: value, location, ...(shape.target && { target: shape.target }) });
    }
    return;
  }
  if (shape.type === 'array' && Array.isArray(value) && shape.items) {
    const itemShape = shape.items;
    value.forEach((entry, index) => {
      collectShapeLinks(entry, itemShape, `${location}[${index}]`, links);
    });
    return;
  }
  if (shape.type === 'object' && isRecord(value)) {
    for (const [field, fieldShape] of Object.entries(shape.fields ?? {})) {
      if (field in value) {
        collectShapeLinks(value[field], fieldShape, `${location}.${field}`, links);
      }
    }
    // OD-8: a dynamic-key map's interiors carry real link cells too — an evidence
    // entry's `proven_by`/`pressure` is the linkage the design exists to make
    // navigable, and leaving it uncollected would strand it outside the walk.
    const valuesShape = shape.valuesShape;
    if (valuesShape) {
      for (const [key, entry] of Object.entries(value)) {
        if (shape.fields && key in shape.fields) continue;
        collectShapeLinks(entry, valuesShape, `${location}.${key}`, links);
      }
    }
  }
}

export function collectLinkCells(doc: DdDoc, schema: ResolvedDdSchema): DdLinkCell[] {
  const sections = new Map(doc.sections.map((section) => [section.name, section]));
  const links: DdLinkCell[] = [];
  for (const [name, declaration] of Object.entries(schema.sections)) {
    const section = sections.get(name);
    if (section) {
      collectShapeLinks(section.value, declaration.shape, `$.sections[${name}].value`, links);
    }
  }
  return links;
}

function validateShape(
  value: unknown,
  shape: DdShape,
  location: string,
  ctx: ValidationContext,
  stateOwnedByObject = false,
): void {
  switch (shape.type) {
    case 'array':
      if (!Array.isArray(value)) {
        addIssue(ctx, 'schema-shape', 'ERROR', location, 'value must be an array');
        return;
      }
      if (shape.items) {
        const itemShape = shape.items;
        value.forEach((entry, index) => {
          validateShape(entry, itemShape, `${location}[${index}]`, ctx);
        });
      }
      return;
    case 'object':
      if (!isRecord(value)) {
        addIssue(ctx, 'schema-shape', 'ERROR', location, 'value must be an object');
        return;
      }
      for (const field of shape.required ?? []) {
        if (!(field in value)) {
          addIssue(
            ctx,
            'schema-shape',
            'ERROR',
            `${location}.${field}`,
            `missing required field "${field}"`,
          );
        }
      }
      for (const [field, fieldShape] of Object.entries(shape.fields ?? {})) {
        if (field in value) {
          validateShape(
            value[field],
            fieldShape,
            `${location}.${field}`,
            ctx,
            fieldShape.type === 'state',
          );
        }
      }
      if (shape.allowAdditional === false && shape.fields) {
        for (const field of Object.keys(value)) {
          if (!(field in shape.fields)) {
            addIssue(
              ctx,
              'schema-shape',
              'ERROR',
              `${location}.${field}`,
              `field "${field}" is not declared by the schema`,
            );
          }
        }
      } else if (shape.valuesShape) {
        // OD-8: keys the schema cannot name in advance are SHAPED, not forbidden.
        // `fields` still wins per key, so a map may declare fixed members and a
        // shape for the rest without either half surprising the other.
        const valuesShape = shape.valuesShape;
        for (const [key, entry] of Object.entries(value)) {
          if (shape.fields && key in shape.fields) continue;
          validateShape(entry, valuesShape, `${location}.${key}`, ctx);
        }
      }
      validateStateNotes(value, location, ctx);
      return;
    case 'bool':
      if (typeof value !== 'boolean') {
        addIssue(ctx, 'schema-shape', 'ERROR', location, 'value must be a boolean');
      }
      return;
    case 'int':
      if (!Number.isInteger(value)) {
        addIssue(ctx, 'schema-shape', 'ERROR', location, 'value must be an integer');
      }
      return;
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        addIssue(ctx, 'schema-shape', 'ERROR', location, 'value must be a finite number');
      }
      return;
    case 'string':
    case 'text':
      if (typeof value !== 'string') {
        addIssue(ctx, 'schema-shape', 'ERROR', location, 'value must be a string');
      }
      return;
    case 'enum':
    case 'state': {
      const values = enumValues(shape, ctx.schema);
      if (typeof value !== 'string' || (values && !values.includes(value))) {
        addIssue(
          ctx,
          'enum-invalid',
          'ERROR',
          location,
          `value "${String(value)}" is not in ${values?.join(', ') ?? 'the declared enum'}`,
        );
      } else if (shape.type === 'state' && !stateOwnedByObject) {
        validateStateNotes({ state: value }, location, ctx);
      }
      return;
    }
    case 'link':
      if (typeof value !== 'string') {
        addIssue(ctx, 'schema-shape', 'ERROR', location, 'link value must be a string');
      } else {
        validateLink(value, shape, location, ctx);
      }
      return;
    default:
      // Custom types are rendered by schema adapters. Without a declared enum or
      // structural shape there is intentionally nothing for core to validate.
      return;
  }
}

function validateIds(doc: DdDoc, ctx: ValidationContext): void {
  const firstSeen = new Map<string, string>();
  const visit = (value: unknown, location: string): void => {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => {
        visit(entry, `${location}[${index}]`);
      });
      return;
    }
    if (!isRecord(value)) return;
    if (typeof value.id === 'string') {
      const id = value.id;
      const idLocation = `${location}.id`;
      const seenAt = firstSeen.get(id);
      if (seenAt) {
        addIssue(ctx, 'duplicate-id', 'ERROR', idLocation, `id "${id}" duplicates ${seenAt}`);
      } else {
        firstSeen.set(id, idLocation);
      }
      if (ID_PREFIXES.some((prefix) => id.startsWith(prefix)) && !MINTED_ID_PATTERN.test(id)) {
        addIssue(
          ctx,
          'id-invalid',
          'ERROR',
          idLocation,
          `minted id "${id}" must use a registered prefix and exactly four lowercase hex digits`,
        );
      }
    }
    for (const [field, child] of Object.entries(value)) {
      if (field !== 'id') visit(child, `${location}.${field}`);
    }
  };
  for (const section of doc.sections) {
    visit(section.value, `$.sections[${section.name}].value`);
  }
}

/** Validate one document only. Cross-document resolution and BFS live in `validateWalk`. */
export function validateDocument(
  doc: DdDoc,
  path: string,
  resolver: SchemaResolver,
  repoRoot: string,
): DdIssue[] {
  const resolved = resolver.resolve(doc.dd.schema, path);
  if (!resolved.ok) {
    return [
      {
        class: 'schema-unresolvable',
        severity: 'ERROR',
        location: '$.dd.schema',
        message: resolved.message,
        owner: path,
      },
    ];
  }
  const ctx: ValidationContext = {
    doc,
    path,
    repoRoot,
    schema: resolved.schema,
    issues: [],
  };
  validateIds(doc, ctx);

  const sections = new Map(doc.sections.map((section) => [section.name, section]));
  for (const [name, declaration] of Object.entries(resolved.schema.sections)) {
    const section = sections.get(name);
    if (!section) {
      if (declaration.required) {
        addIssue(
          ctx,
          'schema-shape',
          'ERROR',
          `$.sections[${name}]`,
          `missing required section "${name}"`,
        );
      }
      continue;
    }
    validateShape(section.value, declaration.shape, `$.sections[${name}].value`, ctx);
  }
  for (const section of doc.sections) {
    if (!(section.name in resolved.schema.sections)) {
      addIssue(
        ctx,
        'schema-shape',
        'ERROR',
        `$.sections[${section.name}]`,
        `section "${section.name}" is not declared by schema "${resolved.schema.name}"`,
      );
    }
  }
  return ctx.issues;
}
