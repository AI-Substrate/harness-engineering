import { documentFromLines } from './contracts.mjs';

/** Inject read(path): Promise<string>; parser can be exercised without a renderer. */
export function createParser({ read }) {
  return async (path) => {
    const source = await read(path);
    if (typeof source !== 'string') throw new TypeError('Reader must return text');
    return documentFromLines(source.replaceAll('\r\n', '\n').split('\n'));
  };
}
