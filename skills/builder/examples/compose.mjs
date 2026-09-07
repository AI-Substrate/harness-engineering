/** The PM-owned composition root depends on frozen operations, not global state. */
export function createConvert({ parse, render }) {
  return async (source, destination) => render(await parse(source), destination);
}
