import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../../src/adapters/clock/fake-clock.js';
import {
  buildComment,
  buildCustomEvent,
  buildManualEvent,
  duckTypeValue,
  type FlowEvent,
  nextEventId,
  prefixFor,
} from '../../../src/services/flow/flow-events.js';

/**
 * T012 — duck-typed custom events + event id format (plan 024 AC-05;
 * ws-002 §E3/E6). The duck-typer turns a raw CLI string into `{type,value}`
 * with `type` stored explicitly; ids are `<PREFIX>-<NNN>` (observe format).
 */

describe('T012 — duck-typing (bool/date/int/float/string; leading-zero; --type override)', () => {
  it('booleans (case-insensitive)', () => {
    expect(duckTypeValue('true')).toEqual({ type: 'bool', value: true });
    expect(duckTypeValue('False')).toEqual({ type: 'bool', value: false });
  });

  it('ISO-8601 UTC → date (stored as the ISO string)', () => {
    expect(duckTypeValue('2026-06-18T05:00:00.000Z')).toEqual({
      type: 'date',
      value: '2026-06-18T05:00:00.000Z',
    });
    expect(duckTypeValue('2026-06-18T05:00:00Z')).toEqual({
      type: 'date',
      value: '2026-06-18T05:00:00Z',
    });
  });

  it('canonical integers → int (number)', () => {
    expect(duckTypeValue('42')).toEqual({ type: 'int', value: 42 });
    expect(duckTypeValue('-7')).toEqual({ type: 'int', value: -7 });
    expect(duckTypeValue('0')).toEqual({ type: 'int', value: 0 });
  });

  it('leading-zero stays a string (ids/codes preserved)', () => {
    expect(duckTypeValue('007')).toEqual({ type: 'string', value: '007' });
  });

  it('fractional / scientific → float (number)', () => {
    expect(duckTypeValue('3.14')).toEqual({ type: 'float', value: 3.14 });
    expect(duckTypeValue('-0.5e3')).toEqual({ type: 'float', value: -500 });
  });

  it('anything else → string', () => {
    expect(duckTypeValue('hello world')).toEqual({ type: 'string', value: 'hello world' });
    expect(duckTypeValue('1e3')).toEqual({ type: 'string', value: '1e3' }); // no decimal point → not float
  });

  it('--type override wins (explicit), coercing the value', () => {
    expect(duckTypeValue('42', 'string')).toEqual({ type: 'string', value: '42' });
    expect(duckTypeValue('42', 'int')).toEqual({ type: 'int', value: 42 });
    expect(duckTypeValue('yes', 'bool')).toEqual({ type: 'bool', value: false }); // only "true" is true
  });
});

describe('T012 — event ids <PREFIX>-<NNN> (per-prefix monotonic; observe format)', () => {
  it('prefixFor maps built-in + manual kinds; derives unknown manual prefixes', () => {
    expect(prefixFor('created', 'engine')).toBe('CRT');
    expect(prefixFor('status-changed', 'engine')).toBe('STA');
    expect(prefixFor('build-run', 'manual')).toBe('BLD');
    expect(prefixFor('custom', 'manual')).toBe('CUS');
    expect(prefixFor('teleport', 'manual')).toBe('TEL'); // derived
  });

  it('nextEventId is per-prefix monotonic, padStart(3), tolerant of foreign ids', () => {
    const events: FlowEvent[] = [
      { id: 'CRT-001', kind: 'created', origin: 'engine', fired_at: 't' },
      { id: 'STA-001', kind: 'status-changed', origin: 'engine', fired_at: 't' },
      { id: 'STA-002', kind: 'status-changed', origin: 'engine', fired_at: 't' },
      { id: 'weird-legacy', kind: 'x', origin: 'manual', fired_at: 't' },
    ];
    expect(nextEventId('CRT', events)).toBe('CRT-002');
    expect(nextEventId('STA', events)).toBe('STA-003');
    expect(nextEventId('BLD', events)).toBe('BLD-001'); // unseen prefix starts at 001
  });

  it('buildCustomEvent duck-types + stamps id/name/type/value', () => {
    const e = buildCustomEvent('coverage', '87.5', [], new FakeClock('2026-06-18T05:00:00.000Z'));
    expect(e).toMatchObject({
      id: 'CUS-001',
      kind: 'custom',
      origin: 'manual',
      name: 'coverage',
      type: 'float',
      value: 87.5,
      fired_at: '2026-06-18T05:00:00.000Z',
    });
  });

  it('buildManualEvent stamps an open-vocabulary manual event', () => {
    const e = buildManualEvent('build-run', [], new FakeClock(), { description: 'npm test' });
    expect(e.id).toBe('BLD-001');
    expect(e.origin).toBe('manual');
    expect(e.kind).toBe('build-run');
    expect(e.description).toBe('npm test');
  });

  it('buildComment stamps `at` from the clock + keeps text/optional fields', () => {
    const c = buildComment('hi', new FakeClock('2026-06-18T05:00:00.000Z'), { source: 'user' });
    expect(c).toEqual({ at: '2026-06-18T05:00:00.000Z', text: 'hi', source: 'user' });
  });
});
