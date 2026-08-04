/** The control: a conforming adapter, so the corpus proves success and failure side by side. */
export default function good(value: unknown): string {
  return `**ok: ${String(value)}**`;
}
