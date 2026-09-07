/** Frozen baseline contract shared by units, with no I/O or sibling implementation. */
export function documentFromLines(lines) {
  if (!Array.isArray(lines) || lines.some((line) => typeof line !== 'string')) {
    throw new TypeError('Document.lines must be strings');
  }
  return Object.freeze({ lines: Object.freeze([...lines]) });
}
