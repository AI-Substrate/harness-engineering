/** Deliberately BAD: separate files/tasks would still share one mutable implicit contract. */
export function coupledUnits() {
  const state = { output: null };
  return {
    parser: (source) => { state.output = source.split('\n'); },
    renderer: () => state.output.map((line) => `<p>${line}</p>`).join(''),
  };
}
