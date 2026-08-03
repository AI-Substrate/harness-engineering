/**
 * Custom type `bytes` — a byte count rendered at human scale.
 *
 * Deliberately the DULLEST of the three adapters, to make a point: a custom
 * type does not have to be exotic to be worth declaring. `"footprint": 1572864`
 * tells a reader nothing; `1.5 MiB` tells them everything, and the underlying
 * integer stays exact for anything that wants to compare or sum it.
 */
const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];

export default function bytes(value: unknown, ctx: { field: string }): string {
  const count = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(count) || count < 0) return `⟨${ctx.field}: not a byte count⟩`;

  let size = count;
  let unit = 0;
  while (size >= 1024 && unit < UNITS.length - 1) {
    size /= 1024;
    unit += 1;
  }

  const rendered = unit === 0 ? String(size) : size.toFixed(size < 10 ? 1 : 0);
  return `${rendered} ${UNITS[unit]}`;
}
