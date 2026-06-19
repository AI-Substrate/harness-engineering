import { describe, expect, it } from 'vitest';
import { extractMermaidFences } from './lib/extract.js';

/**
 * The fence extractor decides which blocks reach the mermaid syntax check, so the
 * tricky cases get teeth here: nested/wrapped fences, varying backtick counts,
 * tilde fences, info-string variants, CRLF, and unterminated blocks at EOF.
 */
describe('extractMermaidFences', () => {
  it('extracts a single mermaid fence with 1-based opening line and body text', () => {
    const md = ['# Doc', '', '```mermaid', 'graph TD', '  A-->B', '```', '', 'after'].join('\n');
    const out = extractMermaidFences(md, 'doc.md');
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ path: 'doc.md', line: 3, text: 'graph TD\n  A-->B' });
  });

  it('extracts multiple mermaid fences and ignores non-mermaid code blocks', () => {
    const md = [
      '```js', // non-mermaid → skipped
      'const x = 1;',
      '```',
      '```mermaid',
      'graph TD',
      '```',
      'prose',
      '```mermaid',
      'sequenceDiagram',
      '```',
    ].join('\n');
    const out = extractMermaidFences(md, 'f.md');
    expect(out.map((f) => f.line)).toEqual([4, 8]);
    expect(out.map((f) => f.text)).toEqual(['graph TD', 'sequenceDiagram']);
  });

  it('does NOT extract a ```mermaid example that is merely shown inside a 4-backtick fence', () => {
    const md = ['````', '```mermaid', 'graph TD', '```', '````'].join('\n');
    expect(extractMermaidFences(md, 'doc.md')).toEqual([]);
  });

  it('handles a 4-backtick mermaid fence whose body contains a 3-backtick line', () => {
    const md = ['````mermaid', 'graph TD', '```', 'A-->B', '````'].join('\n');
    const out = extractMermaidFences(md, 'd.md');
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('graph TD\n```\nA-->B');
  });

  it('detects an info string with attributes/trailing spaces (first token = mermaid)', () => {
    const md = ['```mermaid  ', 'graph TD', '```'].join('\n');
    expect(extractMermaidFences(md, 'd.md')).toHaveLength(1);
    const md2 = ['```mermaidjs', 'graph TD', '```'].join('\n'); // not mermaid
    expect(extractMermaidFences(md2, 'd.md')).toEqual([]);
  });

  it('supports tilde fences', () => {
    const md = ['~~~mermaid', 'graph TD', '~~~'].join('\n');
    expect(extractMermaidFences(md, 'd.md')).toHaveLength(1);
  });

  it('emits an unterminated mermaid fence at EOF best-effort', () => {
    const md = ['```mermaid', 'graph TD', '  A-->B'].join('\n');
    const out = extractMermaidFences(md, 'd.md');
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('graph TD\n  A-->B');
  });

  it('normalizes CRLF line endings', () => {
    const md = '```mermaid\r\ngraph TD\r\n```\r\n';
    const out = extractMermaidFences(md, 'd.md');
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('graph TD');
  });

  it('returns [] when there are no mermaid fences', () => {
    expect(extractMermaidFences('# Just prose\n\nNo fences here.', 'd.md')).toEqual([]);
  });

  it('passes the path through verbatim', () => {
    const out = extractMermaidFences('```mermaid\ngraph TD\n```', 'docs/how/x.md');
    expect(out[0].path).toBe('docs/how/x.md');
  });
});
