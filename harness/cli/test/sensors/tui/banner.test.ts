import { describe, expect, it } from 'vitest';
import { SENSORS_WORDMARK } from '../../../src/services/sensors/tui/banner.js';

const BLOCK_WORDMARK = [
  '█▀▀▀▀  █▀▀▀▀  █▄  █  █▀▀▀▀  ▄▀▀▀▄  █▀▀▀▄  █▀▀▀▀',
  '▀▀▀▀█  █▀▀▀▀  █ ▀▄█  ▀▀▀▀█  █   █  █▀█▀   ▀▀▀▀█',
  '▀▀▀▀▀  ▀▀▀▀▀  ▀   ▀  ▀▀▀▀▀   ▀▀▀   ▀  ▀   ▀▀▀▀▀',
];

describe('SENSORS_WORDMARK', () => {
  it('pins the three-row equal-width block-element rendition', () => {
    const lines = SENSORS_WORDMARK.split('\n');

    expect(lines).toEqual(BLOCK_WORDMARK);
    expect(lines.map((line) => [...line].length)).toEqual([47, 47, 47]);
    expect(SENSORS_WORDMARK).not.toMatch(/[\u2500-\u257f]/u);
    for (const line of lines) expect(line).toMatch(/^[\u2580-\u259f ]+$/u);
  });
});
