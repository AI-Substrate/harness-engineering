/**
 * Custom type `sparkline` — an array of numbers drawn as one inline glyph run.
 *
 * This is the case that argues hardest for custom types: the DATA is a plain
 * number array (still queryable with stock jq, still diffable, still validated
 * as an array), while the RENDER is something no generic table cell would ever
 * produce. Data and presentation stay separate, which is dd's whole thesis.
 */
const BARS = '▁▂▃▄▅▆▇█';

export default function sparkline(value: unknown, ctx: { field: string }): string {
  if (!Array.isArray(value)) return `⟨${ctx.field}: not a series⟩`;

  const numbers = value.filter((entry): entry is number => typeof entry === 'number');
  if (numbers.length === 0) return `_(no data)_`;

  const max = Math.max(...numbers);
  const min = Math.min(...numbers);
  const span = max - min || 1;

  const glyphs = numbers
    .map((entry) => {
      const index = Math.round(((entry - min) / span) * (BARS.length - 1));
      return BARS[index] ?? BARS[0];
    })
    .join('');

  // The trailing figure is the point of a sparkline: shape AND where it landed.
  return `${glyphs} ${numbers[numbers.length - 1]}`;
}
