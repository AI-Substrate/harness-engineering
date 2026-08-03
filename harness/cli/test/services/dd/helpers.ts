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

/**
 * The OD-8 twin of {@link TEST_SCHEMA}: a schema whose `evidence` section declares
 * `valuesShape`, so a dynamic-key map's interiors are shaped rather than opaque.
 * Kept separate so every pre-OD-8 expectation keyed on `test/plan` stays exactly
 * as it was — the regression pin lives in the corpus, not only in an assertion.
 */
export const EVIDENCE_SCHEMA = JSON.parse(
  fixtureText('schemas/test-evidence.schema.json'),
) as ResolvedDdSchema;

const FIXTURE_SCHEMAS: readonly ResolvedDdSchema[] = [TEST_SCHEMA, EVIDENCE_SCHEMA];

export class FixtureSchemaResolver implements SchemaResolver {
  resolve(schemaRef: string): SchemaResolveResult {
    const schema = FIXTURE_SCHEMAS.find((candidate) => candidate.name === schemaRef);
    return schema ? { ok: true, schema } : { ok: false, message: `schema not found: ${schemaRef}` };
  }
}
