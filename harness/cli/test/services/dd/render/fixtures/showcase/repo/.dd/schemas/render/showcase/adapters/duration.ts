/**
 * A well-behaved custom-type adapter (workshop-003 W1): pure, synchronous,
 * default-exported, `(value, ctx) => string`. Renders a minute count as a human
 * duration; `ctx` carries the column declaration + doc path, so this fixture
 * also proves the ctx contract reaches the adapter.
 */
export default function duration(value: unknown, ctx: { field: string }): string {
  const minutes = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(minutes)) return `⟨${ctx.field}: not a duration⟩`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours > 0 ? `**${hours}h ${rest}m**` : `**${rest}m**`;
}
