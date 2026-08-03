import { describe, expect, it } from 'vitest';
import { deriveRollup, deriveState } from '../../../../src/services/dd/core/derive.js';
import type { DdSection } from '../../../../src/services/dd/core/model.js';
import { fixtureDoc } from '../helpers.js';

describe('dd-core derived state', () => {
  it('is complete only when every evidence entry is gate-terminal', () => {
    const complete: DdSection = {
      name: 'evidence',
      value: [
        { id: 'dw-a1b2', state: 'checked' },
        { id: 'dw-b2c3', state: 'human-skipped' },
        { id: 'dw-c3d4', state: 'na' },
      ],
    };
    expect(deriveState(complete)).toEqual({
      complete: true,
      status: 'complete',
      terminal: 3,
      total: 3,
      incomplete: [],
    });

    const incomplete: DdSection = {
      name: 'evidence',
      value: [
        { id: 'dw-a1b2', state: 'checked' },
        { id: 'dw-b2c3', state: 'blocked' },
        { id: 'dw-c3d4', state: 'unchecked' },
      ],
    };
    expect(deriveState(incomplete)).toEqual({
      complete: false,
      status: 'incomplete',
      terminal: 1,
      total: 3,
      incomplete: ['dw-b2c3', 'dw-c3d4'],
    });
  });

  it('accepts a schema-declared custom gate-terminal set', () => {
    const section: DdSection = {
      name: 'review',
      value: [
        { id: 'dw-a1b2', state: 'verified' },
        { id: 'dw-b2c3', state: 'waived' },
      ],
    };
    expect(deriveState(section, ['verified', 'waived']).complete).toBe(true);
    expect(deriveState(section, ['verified']).incomplete).toEqual(['dw-b2c3']);
  });

  it('continues through nested state-bearing evidence', () => {
    const section: DdSection = {
      name: 'evidence',
      value: [
        {
          id: 'dw-a1b2',
          state: 'checked',
          subtasks: [{ id: 'dw-b2c3', state: 'unchecked' }],
        },
      ],
    };
    expect(deriveState(section)).toEqual({
      complete: false,
      status: 'incomplete',
      terminal: 1,
      total: 2,
      incomplete: ['dw-b2c3'],
    });
  });

  it('uses a stable location when a state-bearing entry has no id', () => {
    const section: DdSection = {
      name: 'evidence',
      value: {
        review: { state: 'unchecked' },
      },
    };
    expect(deriveState(section).incomplete).toEqual(['$.sections[evidence].value.review']);
  });

  it('rolls task evidence from a second file through phase and plan', () => {
    const plan = fixtureDoc('derive/plan.dd.json');
    const tasks = fixtureDoc('derive/tasks.dd.json');
    const evidence = tasks.sections.find((section) => section.name === 'evidence');
    expect(evidence).toBeDefined();
    if (!evidence) throw new Error('derive fixture is missing its evidence section');
    const lists = evidence.value as Record<string, unknown>;

    const result = deriveRollup({
      id: 'plan',
      source: 'plan.dd.json',
      children: [
        {
          id: 'ph-a1b2',
          source: 'plan.dd.json',
          children: [
            {
              id: 'tk-a1b2',
              source: 'tasks.dd.json',
              section: { name: 'tk-a1b2', value: lists['tk-a1b2'] },
            },
            {
              id: 'tk-b2c3',
              source: 'tasks.dd.json',
              section: { name: 'tk-b2c3', value: lists['tk-b2c3'] },
            },
          ],
        },
      ],
    });

    expect(plan.sections[0]?.name).toBe('phases');
    expect(result.complete).toBe(false);
    expect(result.terminal).toBe(2);
    expect(result.total).toBe(3);
    expect(result.children[0]?.children[0]?.complete).toBe(true);
    expect(result.children[0]?.children[1]?.incomplete).toEqual(['dw-c3d4']);
  });
});
