import { COMPLETION_STATES, DEFAULT_GATE_TERMINAL_STATES } from '../core/constants.js';
import type { DdEnumSchema, DdSectionSchema, DdShape, ResolvedDdSchema } from '../core/model.js';
import { isRecord } from '../core/value.js';
import {
  type SchemaIssue,
  type SchemaSeverity,
  SUPPORTED_SCHEMA_VERSION,
  schemaIssue,
} from './model.js';

export interface SchemaDeclaration {
  description: string;
  version: number;
  schema: ResolvedDdSchema;
  /** The one terminal set `deriveState` uses for this schema (T008 ruling b). */
  gateTerminal: readonly string[];
}

export type DeclarationResult =
  | { ok: true; declaration: SchemaDeclaration; issues: SchemaIssue[] }
  | { ok: false; issues: SchemaIssue[] };

interface ParseContext {
  name: string;
  path: string;
  issues: SchemaIssue[];
  enums: Record<string, DdEnumSchema>;
  /** Enum names bound by `state`-typed fields, in declaration order. */
  stateBindings: (string | undefined)[];
}

function fail(
  ctx: ParseContext,
  issueClass: 'package-invalid' | 'enum-invalid' | 'rel-invalid' | 'version-unsupported',
  location: string,
  message: string,
  severity: SchemaSeverity = 'ERROR',
): void {
  ctx.issues.push(
    schemaIssue(issueClass, severity, message, { schema: ctx.name, path: ctx.path, location }),
  );
}

function stringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  return value.every((entry) => typeof entry === 'string' && entry.length > 0)
    ? (value as string[])
    : null;
}

function parseEnums(raw: unknown, ctx: ParseContext): Record<string, DdEnumSchema> {
  if (raw === undefined) return {};
  if (!isRecord(raw)) {
    fail(ctx, 'package-invalid', '$.enums', 'enums must be an object');
    return {};
  }
  const enums: Record<string, DdEnumSchema> = {};
  for (const [name, declaration] of Object.entries(raw)) {
    const location = `$.enums.${name}`;
    if (!isRecord(declaration)) {
      fail(ctx, 'enum-invalid', location, `enum "${name}" must be an object`);
      continue;
    }
    const values = stringArray(declaration.values);
    if (!values) {
      fail(ctx, 'enum-invalid', `${location}.values`, `enum "${name}" needs a non-empty values[]`);
      continue;
    }
    if (new Set(values).size !== values.length) {
      fail(ctx, 'enum-invalid', `${location}.values`, `enum "${name}" repeats a value`);
      continue;
    }
    if (declaration.gate_terminal === undefined) {
      enums[name] = { values };
      continue;
    }
    const terminal = stringArray(declaration.gate_terminal);
    if (!terminal) {
      fail(
        ctx,
        'enum-invalid',
        `${location}.gate_terminal`,
        `enum "${name}" gate_terminal must be a non-empty array of strings`,
      );
      continue;
    }
    const stray = terminal.filter((entry) => !values.includes(entry));
    if (stray.length > 0) {
      fail(
        ctx,
        'enum-invalid',
        `${location}.gate_terminal`,
        `enum "${name}" gate_terminal names ${stray.map((s) => `"${s}"`).join(', ')} which ${
          stray.length === 1 ? 'is' : 'are'
        } not in its values`,
      );
      continue;
    }
    enums[name] = { values, gate_terminal: terminal };
  }
  return enums;
}

function parseShape(raw: unknown, location: string, ctx: ParseContext): DdShape | null {
  if (!isRecord(raw)) {
    fail(ctx, 'package-invalid', location, 'shape must be an object');
    return null;
  }
  const type = raw.type;
  if (typeof type !== 'string' || type.length === 0) {
    fail(ctx, 'package-invalid', `${location}.type`, 'shape type must be a non-empty string');
    return null;
  }
  if (raw.gate_terminal !== undefined) {
    fail(
      ctx,
      'enum-invalid',
      `${location}.gate_terminal`,
      'gate_terminal is declared on the enum, not on the field',
    );
    return null;
  }

  const shape: DdShape = { type: type as DdShape['type'] };

  if (raw.values !== undefined) {
    const values = stringArray(raw.values);
    if (!values) {
      fail(
        ctx,
        'enum-invalid',
        `${location}.values`,
        'values must be a non-empty array of strings',
      );
      return null;
    }
    shape.values = values;
  }
  if (raw.enum !== undefined) {
    if (typeof raw.enum !== 'string' || raw.enum.length === 0) {
      fail(ctx, 'enum-invalid', `${location}.enum`, 'enum must name a declared enum');
      return null;
    }
    if (!(raw.enum in ctx.enums)) {
      fail(ctx, 'enum-invalid', `${location}.enum`, `enum "${raw.enum}" is not declared`);
      return null;
    }
    shape.enum = raw.enum;
  }
  if (raw.target !== undefined) {
    if (typeof raw.target !== 'string' || raw.target.length === 0) {
      fail(ctx, 'package-invalid', `${location}.target`, 'link target must be a non-empty string');
      return null;
    }
    shape.target = raw.target;
  }
  // The relation. This block is the OD-8 pin the key finding demanded: `parseShape`
  // is an ALLOW-LIST, so a key it does not name is silently discarded — which is
  // exactly how `valuesShape` was lost once before. Without these six lines every
  // `rel` in every builder schema would vanish between the file and the resolved
  // schema, and the contradiction engine would ship inert on every real plan
  // while every one of its own unit tests passed.
  if (raw.rel !== undefined) {
    if (typeof raw.rel !== 'string' || raw.rel.trim().length === 0) {
      fail(ctx, 'rel-invalid', `${location}.rel`, 'rel must be a non-empty string');
      return null;
    }
    if (type !== 'link') {
      fail(
        ctx,
        'rel-invalid',
        `${location}.rel`,
        `rel is only meaningful on a link, not "${type}" (an array of links declares it on items)`,
      );
      return null;
    }
    // An UNKNOWN rel is deliberately accepted: the built-in set is frozen, the
    // namespace is open, and a schema saying something dd does not understand
    // yet behaves as `ref` rather than being refused.
    shape.rel = raw.rel;
  }
  if (raw.allowAdditional !== undefined) {
    if (typeof raw.allowAdditional !== 'boolean') {
      fail(
        ctx,
        'package-invalid',
        `${location}.allowAdditional`,
        'allowAdditional must be boolean',
      );
      return null;
    }
    shape.allowAdditional = raw.allowAdditional;
  }

  if (type === 'enum' && shape.values === undefined && shape.enum === undefined) {
    fail(
      ctx,
      'enum-invalid',
      location,
      'an enum field needs either inline values[] or a declared enum name',
    );
    return null;
  }
  if (type === 'state') {
    ctx.stateBindings.push(shape.enum);
  }

  if (type === 'array') {
    const items = parseShape(raw.items, `${location}.items`, ctx);
    if (!items) {
      if (raw.items === undefined) {
        fail(ctx, 'package-invalid', `${location}.items`, 'an array shape needs items');
      }
      return null;
    }
    shape.items = items;
  } else if (raw.items !== undefined) {
    fail(
      ctx,
      'package-invalid',
      `${location}.items`,
      `items is only meaningful on an array, not "${type}"`,
    );
    return null;
  }

  if (type === 'object') {
    if (raw.required !== undefined) {
      const required = stringArray(raw.required);
      if (!required) {
        fail(
          ctx,
          'package-invalid',
          `${location}.required`,
          'required must be a non-empty array of field names',
        );
        return null;
      }
      shape.required = required;
    }
    if (raw.fields !== undefined) {
      if (!isRecord(raw.fields)) {
        fail(ctx, 'package-invalid', `${location}.fields`, 'fields must be an object');
        return null;
      }
      const fields: Record<string, DdShape> = {};
      for (const [field, fieldShape] of Object.entries(raw.fields)) {
        const parsed = parseShape(fieldShape, `${location}.fields.${field}`, ctx);
        if (!parsed) return null;
        fields[field] = parsed;
      }
      shape.fields = fields;
    }
    for (const field of shape.required ?? []) {
      if (shape.fields && !(field in shape.fields)) {
        fail(
          ctx,
          'package-invalid',
          `${location}.required`,
          `required names "${field}", which the shape does not declare`,
        );
        return null;
      }
    }
    // OD-8: the shape for keys a schema cannot name in advance (an evidence
    // section is one list per task id). Parsed recursively like `items`, so a
    // map interior is a first-class shape rather than an unvalidated hole.
    if (raw.valuesShape !== undefined) {
      const valuesShape = parseShape(raw.valuesShape, `${location}.valuesShape`, ctx);
      if (!valuesShape) return null;
      shape.valuesShape = valuesShape;
    }
  } else {
    for (const key of ['fields', 'required', 'valuesShape'] as const) {
      if (raw[key] !== undefined) {
        fail(
          ctx,
          'package-invalid',
          `${location}.${key}`,
          `${key} is only meaningful on an object, not "${type}"`,
        );
        return null;
      }
    }
  }

  return shape;
}

function parseSections(raw: unknown, ctx: ParseContext): Record<string, DdSectionSchema> | null {
  if (!isRecord(raw)) {
    fail(ctx, 'package-invalid', '$.sections', 'sections must be an object of section names');
    return null;
  }
  const entries = Object.entries(raw);
  if (entries.length === 0) {
    fail(ctx, 'package-invalid', '$.sections', 'sections must declare at least one section');
    return null;
  }
  const sections: Record<string, DdSectionSchema> = {};
  for (const [name, declaration] of entries) {
    const location = `$.sections.${name}`;
    if (!isRecord(declaration)) {
      fail(ctx, 'package-invalid', location, `section "${name}" must be an object`);
      return null;
    }
    if (declaration.required !== undefined && typeof declaration.required !== 'boolean') {
      fail(ctx, 'package-invalid', `${location}.required`, 'section required must be boolean');
      return null;
    }
    // Display-only, but parsed strictly: a non-string `title` is refused rather
    // than dropped. This construction is an ALLOW-LIST — a key absent here is
    // silently discarded, which is exactly how `valuesShape` was lost once
    // before (OD-8). Any new section-level key must be added in both places.
    if (
      declaration.title !== undefined &&
      (typeof declaration.title !== 'string' || declaration.title.trim().length === 0)
    ) {
      fail(ctx, 'package-invalid', `${location}.title`, 'section title must be a non-empty string');
      return null;
    }
    const shape = parseShape(declaration.shape, `${location}.shape`, ctx);
    if (!shape) {
      if (declaration.shape === undefined) {
        fail(ctx, 'package-invalid', `${location}.shape`, `section "${name}" needs a shape`);
      }
      return null;
    }
    sections[name] = {
      ...(declaration.required === true && { required: true }),
      ...(typeof declaration.title === 'string' &&
        declaration.title.trim().length > 0 && { title: declaration.title }),
      shape,
    };
  }
  return sections;
}

/**
 * Resolve the ONE gate-terminal set this schema's `deriveState` calls must use.
 *
 * Only an explicit enum-level `gate_terminal` counts as a declaration; a `state`
 * field on the built-in completion enum contributes nothing. Two *different*
 * declared sets bound to `state` fields is `E415` — `deriveState` takes exactly
 * one set, so the ambiguity is refused at declaration time rather than silently
 * resolved into a different meaning of "done" (T008 ruling b).
 */
function resolveGateTerminal(ctx: ParseContext): readonly string[] {
  const declared = new Map<string, readonly string[]>();
  for (const binding of ctx.stateBindings) {
    const terminal = binding === undefined ? undefined : ctx.enums[binding]?.gate_terminal;
    if (terminal) declared.set(JSON.stringify([...terminal].sort()), terminal);
  }
  if (declared.size > 1) {
    fail(
      ctx,
      'enum-invalid',
      '$.enums',
      `state fields bind ${declared.size} different gate_terminal sets; a schema may declare only one`,
    );
    return DEFAULT_GATE_TERMINAL_STATES;
  }
  return [...declared.values()][0] ?? DEFAULT_GATE_TERMINAL_STATES;
}

/**
 * Parse and validate one `schema.json` into the P1 `ResolvedDdSchema` the
 * validate engine consumes. Hand-rolled in the house `flow-schema.ts` style:
 * collects issues, never throws (KF-02).
 *
 * `name` comes from the folder path, never the file (T008 ruling a) — a copied
 * package cannot misreport its own identity.
 */
export function parseSchemaDeclaration(raw: string, name: string, path: string): DeclarationResult {
  const ctx: ParseContext = { name, path, issues: [], enums: {}, stateBindings: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    fail(ctx, 'package-invalid', '$', 'schema file is not valid JSON');
    return { ok: false, issues: ctx.issues };
  }
  if (!isRecord(parsed)) {
    fail(ctx, 'package-invalid', '$', 'schema file must contain a JSON object');
    return { ok: false, issues: ctx.issues };
  }

  const version = parsed.dd_schema;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    fail(ctx, 'package-invalid', '$.dd_schema', 'dd_schema must be an integer version');
    return { ok: false, issues: ctx.issues };
  }
  if (version !== SUPPORTED_SCHEMA_VERSION) {
    fail(
      ctx,
      'version-unsupported',
      '$.dd_schema',
      `dd_schema ${version} is not supported (this CLI speaks ${SUPPORTED_SCHEMA_VERSION})`,
    );
    return { ok: false, issues: ctx.issues };
  }

  if (parsed.description !== undefined && typeof parsed.description !== 'string') {
    fail(ctx, 'package-invalid', '$.description', 'description must be a string');
    return { ok: false, issues: ctx.issues };
  }

  ctx.enums = parseEnums(parsed.enums, ctx);
  const sections = parseSections(parsed.sections, ctx);
  if (!sections || ctx.issues.some((issue) => issue.severity === 'ERROR')) {
    return { ok: false, issues: ctx.issues };
  }

  const gateTerminal = resolveGateTerminal(ctx);
  if (ctx.issues.some((issue) => issue.severity === 'ERROR')) {
    return { ok: false, issues: ctx.issues };
  }

  const schema: ResolvedDdSchema = {
    name,
    sections,
    ...(Object.keys(ctx.enums).length > 0 && { enums: ctx.enums }),
  };

  return {
    ok: true,
    issues: ctx.issues,
    declaration: {
      description: typeof parsed.description === 'string' ? parsed.description : '',
      version,
      schema,
      gateTerminal,
    },
  };
}

/** The built-in completion vocabulary, exported so `dd schema show` can name it. */
export const BUILTIN_COMPLETION_ENUM: DdEnumSchema = {
  values: COMPLETION_STATES,
  gate_terminal: DEFAULT_GATE_TERMINAL_STATES,
};
