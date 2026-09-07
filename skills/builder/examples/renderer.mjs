/** Inject write(path, text): Promise<void>; only composition chooses the filesystem. */
export function createRenderer({ write }) {
  return async (document, path) => {
    const text = document.lines.map((line) => `<p>${line.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</p>`).join('\n');
    await write(path, text);
    return { path, bytes: Buffer.byteLength(text) };
  };
}
