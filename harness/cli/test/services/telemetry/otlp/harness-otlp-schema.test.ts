import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  A,
  GENAI_INPUT_TOKENS,
  GENAI_MODEL,
  GENAI_OUTPUT_TOKENS,
  GENAI_TOKEN_TYPE,
  GENAI_TOKEN_USAGE_METRIC,
  RES_BRANCH,
  RES_COMMAND,
  RES_ENV,
  RES_HARNESS,
  RES_SCHEMA_VERSION,
  RES_SERVICE,
  RES_SERVICE_VERSION,
  RES_SESSION,
} from '../../../../src/services/telemetry/otlp/semconv.js';
import {
  HARNESS_SCHEMA_URL,
  OTLP_SCOPE_VERSION,
} from '../../../../src/services/telemetry/otlp/types.js';

/**
 * T014 — the `harness.*` OTLP attribute contract freeze (the successor to
 * `segment.schema.json` as the cross-tool consumer contract; T006-deferred).
 *
 * `semconv.ts` is the single producer source; `harness-otlp.schema.json` is the
 * frozen artifact a downstream (the eng-thrive scraper, T013) reads against.
 * These tests pin the file key-set-EQUAL to the module so a semconv rename
 * without a contract bump is impossible to ship silently — the same guard the
 * `segment-schema.test.ts` ⟷ `SEGMENT_FIELD_KEYS` pairing gives the internal
 * model, now extended to the OTLP output (WS-A "Rewritten" row).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = join(
  HERE,
  '../../../../src/services/telemetry/otlp/harness-otlp.schema.json',
);
const contract = JSON.parse(readFileSync(CONTRACT_PATH, 'utf8')) as {
  $id: string;
  schema_url: string;
  scope_version: string;
  additionalAttributes: boolean;
  resource_attributes: string[];
  genai_attributes: string[];
  harness_attributes: string[];
};

describe('T014 — harness.* OTLP attribute contract freeze', () => {
  it('harness_attributes equals the deduped semconv `A` vocabulary exactly', () => {
    // A carries metric/log aliases that share a value (TOOL≡TOOL_NAME, …); the
    // contract pins the deduped VALUE set, so adding/renaming a key in semconv.ts
    // without updating the contract trips here.
    expect(new Set(contract.harness_attributes)).toEqual(new Set(Object.values(A)));
  });

  it('resource_attributes equals the semconv resource keys exactly', () => {
    expect([...contract.resource_attributes].sort()).toEqual(
      [
        RES_SERVICE,
        RES_SERVICE_VERSION,
        RES_SESSION,
        RES_HARNESS,
        RES_COMMAND,
        RES_BRANCH,
        RES_SCHEMA_VERSION,
        RES_ENV,
      ].sort(),
    );
  });

  it('genai_attributes equals the adopted stable OTEL GenAI names exactly', () => {
    expect([...contract.genai_attributes].sort()).toEqual(
      [
        GENAI_MODEL,
        GENAI_INPUT_TOKENS,
        GENAI_OUTPUT_TOKENS,
        GENAI_TOKEN_USAGE_METRIC,
        GENAI_TOKEN_TYPE,
      ].sort(),
    );
  });

  it('pins schema_url + scope_version in lockstep with the serializer', () => {
    expect(contract.schema_url).toBe(HARNESS_SCHEMA_URL);
    expect(contract.scope_version).toBe(OTLP_SCOPE_VERSION);
    expect(OTLP_SCOPE_VERSION).toBe('2.3');
  });

  it('quarantine holds: harness_attributes are all harness.*, genai_attributes all gen_ai.*, set is closed', () => {
    for (const a of contract.harness_attributes) expect(a.startsWith('harness.')).toBe(true);
    for (const a of contract.genai_attributes) expect(a.startsWith('gen_ai.')).toBe(true);
    expect(contract.additionalAttributes).toBe(false); // closed set (no smuggled attrs)
    expect(contract.$id).toContain('2.3'); // $id tracks the scope version
  });
});
