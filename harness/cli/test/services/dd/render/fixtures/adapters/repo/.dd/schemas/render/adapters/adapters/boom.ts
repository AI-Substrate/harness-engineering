/** Failure class E425 `DD_ADAPTER_RUNTIME_FAILED`: loads fine, throws when called. */
export default function boom(): string {
  throw new Error('adapter exploded on purpose');
}
