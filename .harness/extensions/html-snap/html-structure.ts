/**
 * html-structure — a stack-based HTML nesting check for html-snap's
 * `--structure` mode. Exists because of a class of defect screenshots are
 * STRUCTURALLY BLIND to: browsers error-recover malformed markup (an eaten
 * `>`, an unclosed <figure>), so the page RENDERS FINE while the document is
 * broken — a screenshot proves it looks right; only a parse proves it IS
 * right. (Governance: the 065 freeze forensics, spine seq 542 thread.)
 *
 * Not a full HTML5 parser — a deliberate, small checker for the defect
 * classes that matter here: unclosed elements, mismatched close tags, and
 * open-tags whose attribute area swallowed a close tag (the eaten-`>`).
 */

export interface StructureProblem {
  line: number;
  kind: 'eaten-gt' | 'mismatched-close' | 'stray-close' | 'unclosed-at-eof';
  detail: string;
}

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);
const RAW_TEXT = new Set(['script', 'style']);

export function checkStructure(html: string): StructureProblem[] {
  const problems: StructureProblem[] = [];
  const stack: Array<{ tag: string; line: number }> = [];
  const lineAt = (idx: number): number => {
    let n = 1;
    for (let i = 0; i < idx && i < html.length; i++) if (html[i] === '\n') n++;
    return n;
  };

  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;

    // comments / doctype
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt);
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt)) {
      const end = html.indexOf('>', lt);
      i = end === -1 ? html.length : end + 1;
      continue;
    }

    const isClose = html[lt + 1] === '/';
    const nameMatch = /^[a-zA-Z][a-zA-Z0-9-]*/.exec(html.slice(lt + (isClose ? 2 : 1)));
    if (!nameMatch) { i = lt + 1; continue; }
    const tag = nameMatch[0].toLowerCase();

    const gt = html.indexOf('>', lt);
    if (gt === -1) {
      problems.push({ line: lineAt(lt), kind: 'eaten-gt', detail: `<${tag} never closed by '>' before end of file` });
      break;
    }
    const tagBody = html.slice(lt, gt);

    // the eaten-'>' signature: an OPEN tag whose attribute area contains '</'
    // means the scanner swallowed a close tag (`<div ..."stuff</div>`)
    if (!isClose && tagBody.includes('</')) {
      problems.push({
        line: lineAt(lt),
        kind: 'eaten-gt',
        detail: `<${tag} …> spans a '</' — an attribute area swallowed a close tag (likely a missing '>' after the attributes)`,
      });
      i = gt + 1;
      continue; // don't push: the element's own state is unknowable
    }

    if (isClose) {
      if (stack.length === 0) {
        problems.push({ line: lineAt(lt), kind: 'stray-close', detail: `</${tag}> with nothing open` });
      } else {
        const top = stack[stack.length - 1];
        if (top.tag === tag) {
          stack.pop();
        } else {
          const idxInStack = stack.map((s) => s.tag).lastIndexOf(tag);
          if (idxInStack === -1) {
            problems.push({ line: lineAt(lt), kind: 'stray-close', detail: `</${tag}> but <${tag}> is not open (innermost open: <${top.tag}> from line ${top.line})` });
          } else {
            for (let k = stack.length - 1; k > idxInStack; k--) {
              problems.push({ line: lineAt(lt), kind: 'mismatched-close', detail: `</${tag}> closes over unclosed <${stack[k].tag}> opened at line ${stack[k].line}` });
            }
            stack.length = idxInStack;
          }
        }
      }
      i = gt + 1;
      continue;
    }

    // open tag
    const selfClosing = /\/\s*$/.test(tagBody);
    if (!VOID.has(tag) && !selfClosing) stack.push({ tag, line: lineAt(lt) });
    i = gt + 1;

    if (RAW_TEXT.has(tag) && !selfClosing) {
      const close = html.toLowerCase().indexOf(`</${tag}`, i);
      if (close === -1) {
        problems.push({ line: lineAt(lt), kind: 'unclosed-at-eof', detail: `<${tag}> raw-text element never closes` });
        break;
      }
      const closeGt = html.indexOf('>', close);
      stack.pop();
      i = closeGt === -1 ? html.length : closeGt + 1;
    }
  }

  for (const open of stack) {
    problems.push({ line: open.line, kind: 'unclosed-at-eof', detail: `<${open.tag}> opened at line ${open.line} never closes` });
  }
  return problems;
}
