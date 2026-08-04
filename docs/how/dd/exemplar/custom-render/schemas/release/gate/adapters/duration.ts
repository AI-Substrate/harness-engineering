/**
 * Custom type `duration` — minutes in the data, human time in the render.
 *
 * The adapter contract (workshop-003 W1): default-exported, `(value, ctx) => string`,
 * pure, synchronous, and TOTAL — it must never throw for user input, because a
 * document with one bad cell should still render the other ninety-nine.
 *
 * Registration is PRESENCE. This file's path is its registration:
 *   <the winning schema.json's folder>/adapters/<type-name>.ts
 * There is no manifest, no import list, and nothing to edit when you add one.
 */
export default function duration(value: unknown, ctx: { field: string }): string {
  const minutes = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(minutes) || minutes < 0) return `⟨${ctx.field}: not a duration⟩`;

  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = Math.round(minutes % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (rest > 0 || parts.length === 0) parts.push(`${rest}m`);
  return `**${parts.join(' ')}**`;
}
