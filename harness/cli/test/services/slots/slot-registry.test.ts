import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import { FakeFs } from '../../../src/adapters/fs/fake-fs.js';
import { exitCodeFor } from '../../../src/output/exit.js';
import {
  type CommandSlot,
  loadSlotRegistry,
  slotEnvelope,
} from '../../../src/services/slots/slot-registry.js';

const EXPECTED_SLOTS = ['run', 'validate', 'build', 'lint', 'test', 'smoke', 'health', 'observe'];

describe('loadSlotRegistry', () => {
  it('given_builtin_seed_when_loaded_then_eight_unconfigured_slots_each_with_next_action', () => {
    /*
    Test Doc:
    - Why: every unconfigured slot must be honest — status:unconfigured + next_action (Finding 05).
    - Contract: loadSlotRegistry returns the 8 seed slots, all unconfigured, each with a next_action.
    - Usage Notes: pass an FsPort (unused this slice); returns fresh copies.
    - Quality Contribution: locks the 8-slot honest-stub contract the front door advertises.
    - Worked Example: loadSlotRegistry(fs).find(s => s.name==='run').status === 'unconfigured'.
    */
    const registry = loadSlotRegistry(new FakeFs());
    expect(registry.map((s) => s.name)).toEqual(EXPECTED_SLOTS);
    for (const slot of registry) {
      expect(slot.status).toBe('unconfigured');
      expect(slot.next_action.length).toBeGreaterThan(0);
      expect(slot.description.length).toBeGreaterThan(0);
    }
  });

  it('only run/validate accept --dry-run', () => {
    const registry = loadSlotRegistry(new FakeFs());
    const dryRunnable = registry.filter((s) => s.acceptsDryRun).map((s) => s.name);
    expect(dryRunnable).toEqual(['run', 'validate']);
  });

  it('returns fresh copies (mutating one load does not affect the next)', () => {
    const first = loadSlotRegistry(new FakeFs());
    const firstSlot = first[0];
    expect(firstSlot).toBeDefined();
    if (firstSlot) {
      firstSlot.status = 'configured';
    }
    const second = loadSlotRegistry(new FakeFs());
    expect(second[0]?.status).toBe('unconfigured');
  });

  it('registry stays open — an arbitrary new slot name is representable (Q4/R7)', () => {
    // CommandSlot.name is a plain string, so a future loader can append a slot
    // the core never knew about. This compiles and runs precisely because the
    // type is NOT a closed `SlotName` union.
    const registry = loadSlotRegistry(new FakeFs());
    const custom: CommandSlot = {
      name: 'deploy',
      status: 'unconfigured',
      description: 'A slot the core never declared.',
      next_action: 'Provided by an extension.',
    };
    registry.push(custom);
    expect(registry.at(-1)?.name).toBe('deploy');
  });
});

describe('slotEnvelope', () => {
  it('every slot renders unconfigured + next_action and maps to exit 2', () => {
    const clock = new FakeClock('2026-06-08T07:20:00.000Z');
    for (const slot of loadSlotRegistry(new FakeFs())) {
      const env = slotEnvelope(slot, {}, clock);
      expect(env.status).toBe('unconfigured');
      expect(env.next_action).toBe(slot.next_action);
      expect(env.timestamp).toBe('2026-06-08T07:20:00.000Z');
      expect(exitCodeFor(env)).toBe(2);
    }
  });

  it('--dry-run carries {dry_run, slot, mapped_command:null} and still exits 2', () => {
    const clock = new FakeClock('2026-06-08T07:20:00.000Z');
    const run = loadSlotRegistry(new FakeFs()).find((s) => s.name === 'run');
    expect(run).toBeDefined();
    if (!run) {
      return;
    }
    const env = slotEnvelope(run, { dryRun: true }, clock);
    expect(env.status).toBe('unconfigured');
    expect(env.data).toEqual({ dry_run: true, slot: 'run', mapped_command: null });
    expect(exitCodeFor(env)).toBe(2);
  });

  it('without --dry-run there is no data payload', () => {
    const clock = new FakeClock('2026-06-08T07:20:00.000Z');
    const validate = loadSlotRegistry(new FakeFs()).find((s) => s.name === 'validate');
    expect(validate).toBeDefined();
    if (!validate) {
      return;
    }
    const env = slotEnvelope(validate, {}, clock);
    expect(env.data).toBeUndefined();
  });
});
