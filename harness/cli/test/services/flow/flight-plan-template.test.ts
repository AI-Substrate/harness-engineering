import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import type { FlowDoc, FlowNode } from '../../../src/services/flow/flow-events.js';
import { applyBatch } from '../../../src/services/flow/flow-mutations.js';

/*
Test Doc:
- Why: the builder flight-plan template is the mechanically re-read token-discipline channel;
  phase expansion must preserve its guidance without relying on prose memory.
- Contract: phase-1, boot-1, and observe-1 carry the same exact token-discipline and model-tier
  lines; each is <=150 UTF-8 bytes and keeps suggestion posture; applyBatch cloning preserves
  phase-1 instructions byte-identically on phase-2.
- Named mutations: delete either line from one node; lengthen either past 150 bytes; add
  must/gate/block/score wording; omit instructions from the phase-2 upsert.
*/

const TEMPLATE_PATH = fileURLToPath(
  new URL('../../../../../skills/builder/references/flight-plan.template.json', import.meta.url),
);

const TOKEN_DISCIPLINE =
  'Spend tokens where they can change the outcome; use `--quiet` for routine flow mutations.';
const MODEL_TIER =
  'Match model tier to work: chores -> cheap subagent, analysis -> Opus-class, judgement -> lead; context may override (§ Shared conventions).';
const TARGET_NODE_IDS = ['phase-1', 'boot-1', 'observe-1'] as const;
const DISALLOWED_POSTURE = /\b(?:must|required|gate|gates|block|blocks|score|scores)\b/i;

function templateNodes(): FlowNode[] {
  const parsed = JSON.parse(readFileSync(TEMPLATE_PATH, 'utf8')) as { nodes: FlowNode[] };
  return parsed.nodes;
}

function flowDoc(nodes: FlowNode[]): FlowDoc {
  return {
    schema_version: 1,
    kind: 'flight-plan',
    slug: 'template-guard',
    nav: { now: 'phase-1', next: null },
    created_at: '2026-07-10T00:00:00.000Z',
    provenance: {
      record_kind: 'flow',
      harness_version: '0.10.0',
      branch: '057-flow-token-efficiency',
      repo: null,
      created_at: '2026-07-10T00:00:00.000Z',
      agent: null,
      plan_id: '057',
    },
    events: [],
    nodes,
  };
}

function node(nodes: FlowNode[], id: string): FlowNode {
  const found = nodes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`template node "${id}" is missing`);
  return found;
}

describe('plan 057 P2 — flight-plan token-discipline template lockstep', () => {
  it('pins both guidance lines on phase-1, boot-1, and observe-1', () => {
    const nodes = templateNodes();
    for (const id of TARGET_NODE_IDS) {
      expect(node(nodes, id).instructions, `${id} token discipline`).toContain(TOKEN_DISCIPLINE);
      expect(node(nodes, id).instructions, `${id} model tier`).toContain(MODEL_TIER);
    }
  });

  it('keeps the new lines concise and suggestion-postured', () => {
    for (const line of [TOKEN_DISCIPLINE, MODEL_TIER]) {
      expect(Buffer.byteLength(line, 'utf8'), line).toBeLessThanOrEqual(150);
      expect(line, line).not.toMatch(DISALLOWED_POSTURE);
    }
  });

  it('the real applyBatch expander path preserves phase instructions byte-identically', () => {
    const nodes = templateNodes();
    const phase1 = node(nodes, 'phase-1');
    const instructions = phase1.instructions ?? [];
    const result = applyBatch(
      flowDoc(nodes),
      [
        {
          op: 'upsert',
          id: 'phase-2',
          type: 'phase',
          phase: 2,
          label: 'P2: Implementation',
          status: 'known',
          next: phase1.next,
          instructions,
        },
        { op: 'set', id: 'phase-1', next: ['phase-2'] },
      ],
      { clock: new FakeClock('2026-07-10T00:01:00.000Z') },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(node(result.doc.nodes, 'phase-2').instructions).toEqual(instructions);
    expect(JSON.stringify(node(result.doc.nodes, 'phase-2').instructions)).toBe(
      JSON.stringify(instructions),
    );
  });
});
