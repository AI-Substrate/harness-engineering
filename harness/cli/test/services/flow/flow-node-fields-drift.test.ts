import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NODE_FIELDS } from '../../../src/services/flow/flow-events.js';

/*
Test Doc:
- Why: `NODE_FIELDS` is the WRITE-side allowlist (#135) and it is a MIRROR of
  `flow.schema.json`. A mirror with no drift test is a second source of truth wearing a
  comment that says it isn't. The repo already mirrors closed vocabularies this way
  (`ZONE_VALUES`, `CHORE_KINDS`) and neither is pinned; this one is.
- Contract: set-equality in BOTH directions. A field added to the schema but not the
  allowlist becomes unwritable through `apply` (a silent capability loss); a field added
  to the allowlist but not the schema re-opens the hole the allowlist exists to close.
- Usage Notes: the schema stays authoritative. When this fails, change the schema first
  and follow it here — never the other way round.
- Quality Contribution: makes "it cannot drift from the schema" a mechanical fact.
- Worked Example: adding `"owner"` to `node.optional` fails here until `NODE_FIELDS`
  names it too.
*/

const schemaPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../src/services/flow/schemas/flow.schema.json',
);

function schemaNodeFields(): string[] {
  const schema = JSON.parse(readFileSync(schemaPath, 'utf8')) as {
    node: { required: string[]; optional: string[] };
  };
  return [...schema.node.required, ...schema.node.optional];
}

describe('#135 — NODE_FIELDS mirrors flow.schema.json and cannot drift from it', () => {
  it('names every field the schema declares', () => {
    const missing = schemaNodeFields().filter((field) => !NODE_FIELDS.has(field));
    expect(missing, 'schema fields absent from NODE_FIELDS — they would be unwritable').toEqual([]);
  });

  it('names no field the schema does not declare', () => {
    const schema = new Set(schemaNodeFields());
    const extra = [...NODE_FIELDS].filter((field) => !schema.has(field));
    expect(extra, 'NODE_FIELDS entries with no schema backing — the allowlist has drifted').toEqual(
      [],
    );
  });

  it('declares `instructions`, which the renderer badges and `apply` writes', () => {
    // Regression for the drift this issue found: `instructions` was typed on FlowNode,
    // written by `specFrom` and rendered as the 📝 badge, but was MISSING from the
    // schema. A source of truth that refuses a field it renders is not one.
    expect(schemaNodeFields()).toContain('instructions');
    expect(NODE_FIELDS.has('instructions')).toBe(true);
  });
});
