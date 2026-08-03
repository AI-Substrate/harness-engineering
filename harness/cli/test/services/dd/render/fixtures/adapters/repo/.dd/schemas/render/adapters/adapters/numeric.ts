/** Failure class E426 `DD_ADAPTER_OUTPUT_INVALID`: callable, but returns a non-string. */
export default function numeric(value: unknown): unknown {
  return Number(value) * 2;
}
