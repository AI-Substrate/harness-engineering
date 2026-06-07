import { describe, expect, it } from 'vitest';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { buildHelp, renderHelpText } from '../../../src/services/help/help-service.js';
import { loadSlotRegistry } from '../../../src/services/slots/slot-registry.js';

describe('buildHelp', () => {
  it('given_registry_when_built_then_each_slot_is_machine_readable', () => {
    /*
    Test Doc:
    - Why: the front door must be agent-readable, not just human text (AC-8/PL-02).
    - Contract: buildHelp(registry).slots lists every slot as {name,status,next_action(+description)}.
    - Usage Notes: feed the live registry; output is pure data (no I/O).
    - Quality Contribution: locks the stable JSON shape agents parse to discover commands.
    - Worked Example: buildHelp(reg).slots[0] === {name:'run', status:'unconfigured', ...}.
    */
    const content = buildHelp(loadSlotRegistry(new FakeFs()));
    expect(content.slots).toHaveLength(8);
    for (const slot of content.slots) {
      expect(slot.name.length).toBeGreaterThan(0);
      expect(slot.status).toBe('unconfigured');
      expect(slot.next_action.length).toBeGreaterThan(0);
    }
    expect(content.purpose.length).toBeGreaterThan(0);
    expect(content.safe_first_actions.length).toBeGreaterThan(0);
    expect(Object.keys(content.exit_codes).sort()).toEqual(['0', '1', '2']);
  });
});

describe('renderHelpText', () => {
  it('produces human text covering commands, output modes, exit codes, first actions', () => {
    const text = renderHelpText(buildHelp(loadSlotRegistry(new FakeFs())));
    expect(text).toContain('doctor');
    expect(text).toContain('run');
    expect(text).toContain('unconfigured');
    expect(text).toContain('Output modes:');
    expect(text).toContain('Exit codes:');
    expect(text).toContain('Safe first actions:');
  });
});
