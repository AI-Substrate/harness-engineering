import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RETRO_TEMPLATE, retroRecordType } from '../../../src/services/record/core-types/retro.js';

/*
Test Doc:
- Why: the core `retro` template is a deployment ECHO of the frozen retro.schema.json; if the two
  drift, an agent fills a record the harvest/compound flow can't read. This test pins the seam:
  the template's frontmatter top-level keys must be a SUPERSET of the schema's required fields.
- Contract: RETRO_TEMPLATE parses as `---`-fenced YAML frontmatter; its top-level keys ⊇
  { schema_version, retro_id, agent, started_at }; it uses only the schema's open `system` object.
- Quality Contribution: the CLI↔skill contract seam that keeps the template honest without a YAML dep.
*/

/** Path to the frozen schema this template echoes (single source of truth). */
const SCHEMA_PATH = fileURLToPath(
  new URL(
    '../../../../../skills/eng-harness-loop/eng-harness-4-retro/references/retro.schema.json',
    import.meta.url,
  ),
);

/** Extract the `---`-fenced frontmatter block from a markdown template. */
function frontmatter(md: string): string {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    throw new Error('template has no --- frontmatter fence');
  }
  return match[1];
}

/** Top-level YAML keys (column-0 `key:` lines) — enough to assert a key superset without a YAML dep. */
function topLevelKeys(frontmatterBody: string): Set<string> {
  const keys = new Set<string>();
  for (const line of frontmatterBody.split('\n')) {
    const m = line.match(/^([a-z_][a-z0-9_]*):/);
    if (m) {
      keys.add(m[1]);
    }
  }
  return keys;
}

describe('retro core record type', () => {
  it('declares the 4-field record contract for type "retro"', () => {
    expect(retroRecordType.kind).toBe('record');
    expect(retroRecordType.type).toBe('retro');
    expect(retroRecordType.description.length).toBeGreaterThan(0);
    expect(retroRecordType.template).toBe(RETRO_TEMPLATE);
  });

  it('frontmatter top-level keys are a superset of the schema required fields', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8')) as { required: string[] };
    const required = schema.required;
    expect(required).toContain('schema_version'); // guard the schema didn't change shape

    const keys = topLevelKeys(frontmatter(RETRO_TEMPLATE));
    for (const field of required) {
      expect(keys, `template frontmatter must include required field "${field}"`).toContain(field);
    }
  });

  it('uses the schema open `system` object (convention), not an undeclared top-level field', () => {
    // `system:` appears (nested under an entry); it is the open object the schema allows.
    expect(RETRO_TEMPLATE).toContain('system:');
    expect(RETRO_TEMPLATE).toContain('compound:');
  });
});
