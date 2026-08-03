import { readFileSync } from 'node:fs';
import type { DdDoc, DdFailure, ResolvedDdSchema } from '../../../src/services/dd/core/model.js';
import { parse } from '../../../src/services/dd/core/parse.js';
import type {
  SchemaResolveResult,
  SchemaResolver,
} from '../../../src/services/dd/core/validate.js';

export function fixtureText(relative: string): string {
  return readFileSync(new URL(`./fixtures/${relative}`, import.meta.url), 'utf8');
}

export function fixtureDoc(relative: string): DdDoc {
  const result = parse(fixtureText(relative));
  if (Array.isArray(result)) {
    throw new Error(
      `fixture failed to parse: ${relative}: ${JSON.stringify(result as DdFailure[])}`,
    );
  }
  return result;
}

export const TEST_SCHEMA = JSON.parse(
  fixtureText('schemas/test-plan.schema.json'),
) as ResolvedDdSchema;

export class FixtureSchemaResolver implements SchemaResolver {
  resolve(schemaRef: string): SchemaResolveResult {
    return schemaRef === TEST_SCHEMA.name
      ? { ok: true, schema: TEST_SCHEMA }
      : { ok: false, message: `schema not found: ${schemaRef}` };
  }
}
