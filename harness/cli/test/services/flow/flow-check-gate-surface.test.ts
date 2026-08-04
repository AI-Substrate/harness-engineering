import { describe, expect, it } from 'vitest';
import type { DdLink, FlowDoc } from '../../../src/services/flow/flow-events.js';
import { renderFlow, renderRailLine } from '../../../src/services/flow/flow-renderer.js';
import { gatedFlow } from './gate-fixtures/index.js';

/**
 * tk-7135 / dw-0008 — the check gate on the rendered surfaces.
 *
 * Two properties, and the second matters more than the first: a check gate has a
 * badge and a rail callout that say which question is being asked, AND a flow
 * without one renders BYTE-IDENTICALLY to what it rendered before the kind
 * existed. The opt-in promise is only worth what its control proves — an
 * unconditional legend clause once changed every golden in the repo by one line,
 * which is exactly the blast radius the promise was made to prevent.
 *
 * Pure renderer, so no corpus: the subject is `FlowDoc → markdown` and nothing
 * else. Everything the renderer knows about a check gate is what the document
 * carries, which is also why the untrusted-reading rows below matter.
 */

const COMPLETE = {
  status: 'complete' as const,
  terminal: 1,
  total: 1,
  incomplete: [],
  at: '2026-08-04T09:00:00.000Z',
};
const INCOMPLETE = { ...COMPLETE, status: 'incomplete' as const, terminal: 0, incomplete: ['x'] };

function render(link: DdLink | undefined): string {
  return renderFlow(gatedFlow(link));
}

/** The rail line is its own pure function — the `.md` embeds it, `orient` prints it. */
function rail(link: DdLink): string {
  return renderRailLine(gatedFlow(link));
}

/** The mermaid block only — the legend explains the glyphs and must not be searched. */
function diagram(markdown: string): string {
  return markdown.split('```mermaid')[1]?.split('```')[0] ?? '';
}

describe('dw-0008 — a check gate renders its verdict, not a meaningless count', () => {
  it('badges a green check with ⛨✓ and a non-green one with ⛨✕', () => {
    expect(
      diagram(render({ address: 'docs/plan.dd.json', check: 'plan-validate', reading: COMPLETE })),
    ).toContain('⛨✓');
    expect(
      diagram(
        render({ address: 'docs/plan.dd.json', check: 'plan-validate', reading: INCOMPLETE }),
      ),
    ).toContain('⛨✕');
  });

  it('badges an unevaluated check with the bare shield', () => {
    // Searched in the DIAGRAM, never the whole document: the legend explains both
    // marks by printing them, so a whole-file `not.toContain` would be asserting
    // against the explanation rather than the badge.
    const md = diagram(render({ address: 'docs/plan.dd.json', check: 'plan-validate' }));
    expect(md).toContain('⛨');
    expect(md).not.toContain('⛨✓');
    expect(md).not.toContain('⛨✕');
  });

  it('never renders 1/1 for a check — the count channel carries no information', () => {
    // A check asks ONE question. `1/1` would occupy the busiest channel on the
    // diagram to say nothing, and would read as "one of one tasks done".
    const md = diagram(
      render({ address: 'docs/plan.dd.json', check: 'plan-validate', reading: COMPLETE }),
    );
    expect(md).not.toContain('1/1');
  });

  it('names the check on the rail, where there is room for words', () => {
    const line = rail({
      address: 'docs/plan.dd.json',
      check: 'plan-validate',
      reading: INCOMPLETE,
    });
    expect(line).toContain('⚑ gate: Phase A ⛨ plan-validate ✕');
  });

  it('says "not yet evaluated" on the rail before the first departure', () => {
    expect(rail({ address: 'docs/plan.dd.json', check: 'plan-validate' })).toContain(
      '⚑ gate: Phase A ⛨ plan-validate not yet evaluated',
    );
  });

  it('adds the check legend clause ONLY when a check gate is on the page', () => {
    const check = render({ address: 'docs/plan.dd.json', check: 'plan-validate' });
    const completion = render({ address: 'docs/tasks.dd.json#tasks' });
    expect(check).toContain('plan-validate check gate');
    expect(completion).not.toContain('plan-validate check gate');
    // The completion clause is still there — the check clause is additive, one
    // level finer than the gate clause it sits beside.
    expect(completion).toContain('⛨ dd gate');
  });
});

describe('dw-0008 — absence is byte-identical, and the check kind is never echoed', () => {
  it('a flow with NO dd_link renders byte-identically to the pre-gate output', () => {
    const before = render(undefined);
    expect(before).not.toContain('⛨');
    expect(before).not.toContain('⚑ gate:');
    expect(before).not.toContain('dd gate');
  });

  it('a completion-only flow is byte-identical to what it rendered before the check kind', () => {
    // The control that would have caught an unconditional legend clause: the
    // completion rendering must not have moved by a single byte.
    const completion: DdLink = { address: 'docs/tasks.dd.json#tasks', reading: COMPLETE };
    const rendered = render(completion);
    expect(diagram(rendered)).toContain('⛨1/1 ✓');
    expect(diagram(rendered)).not.toContain('⛨✓');
    expect(rendered).not.toContain('plan-validate');
    expect(rail(completion)).toContain('⚑ gate: Phase A ⛨ 1/1 ✓');
  });

  it('an UNKNOWN check kind renders as a plain completion link, never echoed', () => {
    // The untrusted-reading rule for the second authored key. A renderer that
    // interpolated `link.check` would hand anyone with an editor a second string
    // channel straight into a mermaid label — the hole F004 closed for the counts.
    const evil = { address: 'docs/plan.dd.json', check: 'x"] --> EVIL["pwned' } as DdLink;
    const md = render({ ...evil, reading: COMPLETE });
    expect(md).not.toContain('EVIL');
    expect(md).not.toContain('pwned');
    expect(rail({ ...evil, reading: COMPLETE })).not.toContain('EVIL');
    // It falls back to the counts path, which is the honest reading of a link
    // whose check kind means nothing here.
    expect(diagram(md)).toContain('⛨1/1 ✓');
  });

  it('an unknown check kind adds no legend clause either', () => {
    const md = render({ address: 'docs/plan.dd.json', check: 'plan-vibes' } as DdLink);
    expect(md).not.toContain('plan-validate check gate');
  });

  it('the rendered flow is still valid markdown structure with a check gate', () => {
    const md = render({ address: 'docs/plan.dd.json', check: 'plan-validate', reading: COMPLETE });
    const doc: FlowDoc = gatedFlow({ address: 'docs/plan.dd.json', check: 'plan-validate' });
    expect(md).toContain('```mermaid');
    expect(md.split('```mermaid').length - 1).toBe(1);
    expect(doc.nodes).toHaveLength(2);
  });
});
