import { describe, expect, it } from 'vitest';
import {
  renderStarter,
  starterInstructions,
  toIdentifier,
  v2Js,
  v2SensorTs,
  v2SubTs,
  v2Ts,
  v2WrapTs,
} from '../../../src/services/scaffold/templates.js';

describe('v2 scaffold templates', () => {
  it('converts kebab names to identifiers for downstream template utilities', () => {
    expect(toIdentifier('ci-smoke-2')).toBe('ciSmoke2');
  });

  it('emits the default TypeScript factory form without stamping api', () => {
    const contents = v2Ts('greet');
    expect(contents).toContain('import { defineExtension }');
    expect(contents).toContain('export default defineExtension({');
    expect(contents).toContain("name: 'greet'");
    expect(contents).not.toMatch(/\bapi:/);
    expect(contents).toContain('ctx.unconfigured');
  });

  it('emits real structural subverbs with no hand-written dispatch', () => {
    const contents = v2SubTs('db', ['reset', 'seed']);
    expect(contents).toContain('sub: {');
    expect(contents).toContain("'reset': {");
    expect(contents).toContain("'seed': {");
    expect(contents).not.toMatch(/switch\s*\(/);
    expect(contents).not.toContain('ctx.args.verb');
  });

  it('emits a bounded TypeScript wrapper through ctx.exec', () => {
    const contents = v2WrapTs('test', 'npm run test');
    expect(contents).toContain("ctx.exec('npm', ['run', 'test'], { timeoutMs: 120_000 })");
    expect(contents).toContain("ctx.error('E_WRAP_FAILED'");
    expect(contents).not.toContain('Date.now');
  });

  it('emits a typed sensor that maps command exit code without persisting raw output', () => {
    const contents = v2SensorTs('lint-count');
    expect(contents).toContain('sensors: {');
    expect(contents).toContain("'lint-count': {");
    expect(contents).toContain("ctx.exec('npm', ['run', 'lint-count', '--silent'])");
    expect(contents).toContain("guidance: '");
    expect(contents).toContain("{ state: 'pass' }");
    expect(contents).toContain("{ state: 'fail', details:");
    expect(contents).not.toMatch(/result\.(stdout|stderr)/);
  });

  it('emits plain JS as the sanctioned bare literal with no runtime import', () => {
    const contents = v2Js('seed');
    expect(contents).toContain("kind: 'extension'");
    expect(contents).toContain('.ExtensionDefinition}');
    expect(contents).not.toContain('defineExtension(');
    expect(contents).not.toMatch(/^import\s/m);
  });

  it('selects exactly the five v2 variants', () => {
    expect(renderStarter({ name: 'a', js: false })).toMatchObject({
      variant: 'v2-ts',
      ext: 'ts',
    });
    expect(renderStarter({ name: 'a', js: false, sub: ['one'] })).toMatchObject({
      variant: 'v2-sub-ts',
      ext: 'ts',
    });
    expect(renderStarter({ name: 'a', js: false, wrap: 'npm test' })).toMatchObject({
      variant: 'v2-wrap-ts',
      ext: 'ts',
    });
    expect(renderStarter({ name: 'a', js: true })).toMatchObject({
      variant: 'v2-js',
      ext: 'js',
    });
    expect(renderStarter({ name: 'a', js: false, sensor: true })).toMatchObject({
      variant: 'v2-sensor-ts',
      ext: 'ts',
    });
  });

  it('keeps the package instructions focused on the calling agent', () => {
    const contents = starterInstructions('greet');
    expect(contents).toContain('harness greet');
    expect(contents).toMatch(/calling agent/i);
    expect(contents).toMatch(/judg(e|ment)/i);
  });
});
