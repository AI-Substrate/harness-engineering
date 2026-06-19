/**
 * Headless mermaid syntax validator — a SUBPROCESS for `harness markdown-lint`
 * (plan 029, AC-07). Invoked as `node lib/mermaid-runner.mjs` with cwd = repo
 * root, so `import('mermaid')` resolves from the repo's node_modules.
 *
 * Kept OUT of extension.ts on purpose: mermaid is a heavy browser-oriented ESM
 * graph (finding 02); isolating it in a child process keeps the loader fast and
 * the verb shell free of that import. It does NOT render (no Chromium / mmdc) —
 * `mermaid.parse()` is syntax-only.
 *
 * Protocol:
 *   fences ← `process.argv[2]` as a JSON string when present (how the verb shell
 *            passes them — `ctx.exec` has no stdin), else read JSON from stdin
 *            (handy for manual runs / spikes)
 *   stdout → JSON `{ ok: true, results: [{ path, line, valid, diagramType?, error? }] }`
 *            or, if mermaid can't be loaded, `{ ok: false, loadError }`
 * Always exits 0 — validity travels in the JSON, never the exit code.
 */

const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info, debug: console.debug };
const silenceConsole = () => {
  console.log = console.warn = console.error = console.info = console.debug = () => {};
};
const restoreConsole = () => {
  Object.assign(console, orig);
};

const emit = (obj) => {
  restoreConsole();
  process.stdout.write(`${JSON.stringify(obj)}\n`);
};

async function readPayload() {
  if (typeof process.argv[2] === 'string') return process.argv[2];
  let raw = '';
  for await (const chunk of process.stdin) raw += chunk;
  return raw;
}

const raw = await readPayload();

let fences;
try {
  fences = JSON.parse(raw || '[]');
  if (!Array.isArray(fences)) throw new Error('stdin payload is not a JSON array');
} catch (e) {
  emit({ ok: false, loadError: `bad stdin payload: ${e?.message ?? String(e)}` });
  process.exit(0);
}

let mermaid;
try {
  silenceConsole();
  // mermaid sanitizes node-label text through DOMPurify, which needs a DOM —
  // without one, `mermaid.parse()` throws "DOMPurify.addHook is not a function"
  // on ANY labeled diagram (trivial `A-->B` graphs skip sanitization, which is
  // why a label-less spike falsely looked headless-clean). jsdom supplies a
  // pure-JS DOM (NOT a browser — AC-07 "no Chromium" still holds).
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.SVGElement = dom.window.SVGElement;
  mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
} catch (e) {
  emit({ ok: false, loadError: e?.message ?? String(e) });
  process.exit(0);
}

const results = [];
for (const f of fences) {
  try {
    const parsed = await mermaid.parse(f.text ?? '', { suppressErrors: true });
    // suppressErrors → false on invalid; a `{ diagramType }` object on valid.
    results.push({
      path: f.path,
      line: f.line,
      valid: parsed !== false,
      diagramType: parsed && parsed.diagramType ? parsed.diagramType : undefined,
    });
  } catch (e) {
    results.push({
      path: f.path,
      line: f.line,
      valid: false,
      error: String(e?.message ?? e).split('\n')[0],
    });
  }
}

emit({ ok: true, results });
