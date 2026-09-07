"""Independent, nonce-bearing PDF capability probe. Never trusts subject test output."""
import argparse
import hashlib
import json
import os
from urllib.parse import unquote, urlparse
from pathlib import Path
import secrets
import subprocess
import sys


def inspect_pdf(path, nonce, labels):
    try:
        import fitz
    except ImportError as error:
        raise RuntimeError('PyMuPDF is unavailable; install it into the evaluator Python environment') from error
    if not path.is_file() or not path.read_bytes().startswith(b'%PDF-'):
        raise ValueError('output is missing or is not a PDF')
    with fitz.open(path) as doc:
        if doc.page_count < 1:
            raise ValueError('PDF has no pages')
        text = '\n'.join(page.get_text() for page in doc)
        if nonce not in text:
            raise ValueError('PDF omits the fresh input nonce (canned/stale output)')
        if any(token in text for token in ['flowchart LR', 'graph LR', '-->', '```mermaid']):
            raise ValueError('Mermaid source was printed instead of rendered')
        # Text alone is not a diagram. Vector shapes or an OCR-inspected raster
        # must carry the fresh labels; page previews remain the visual review seam.
        diagram_pages = [page for page in doc if all(label in page.get_text() for label in labels)]
        raster_diagrams = 0
        if not diagram_pages:
            for page in doc:
                if not page.get_images():
                    continue
                try:
                    ocr = page.get_text(textpage=page.get_textpage_ocr())
                except Exception as error:
                    raise RuntimeError('raster Mermaid needs working Tesseract OCR in the evaluator environment') from error
                if all(label in ocr for label in labels):
                    diagram_pages.append(page)
                    raster_diagrams += 1
        if not diagram_pages:
            raise ValueError('rendered Mermaid labels are missing from text and inspectable raster diagrams')
        drawings = [drawing for page in diagram_pages for drawing in page.get_drawings()]
        closed = [d for d in drawings if d.get('closePath') or any(i[0] == 're' for i in d.get('items', []))]
        strokes = [d for d in drawings if d.get('type') in ('s', 'fs') and d.get('items')]
        if not raster_diagrams and (len(closed) < len(labels) or not strokes):
            raise ValueError('diagram labels lack independently observable node shapes/connectors (text-only diagram)')
        previews = []
        for index, page in enumerate(doc):
            preview = path.with_suffix(f'.page-{index + 1}.png')
            page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5)).save(preview)
            previews.append(str(preview))
        return {'pdf': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                'pages': doc.page_count, 'text': text, 'diagram_shapes': len(closed),
                'diagram_strokes': len(strokes), 'raster_diagrams': raster_diagrams, 'previews': previews}


def run(root, out):
    out.mkdir(parents=True, exist_ok=False)
    manifest = root / '.harness/pdf-command.json'
    if not manifest.is_file():
        return {'verdict': 'fail', 'reason': 'missing .harness/pdf-command.json invocation contract', 'outputs': []}
    argv = json.loads(manifest.read_text()).get('argv')
    if not isinstance(argv, list) or not argv or not all(isinstance(v, str) for v in argv) or '{input}' not in argv or '{output}' not in argv:
        return {'verdict': 'fail', 'reason': 'manifest argv must contain separate {input} and {output} arguments', 'outputs': []}
    try:
        import fitz  # noqa: F401 — prove the evaluator prerequisite before invoking subject code
    except ImportError:
        return {'verdict': 'unknown', 'reason': 'PyMuPDF unavailable in evaluator Python environment', 'outputs': []}
    outputs = []
    coverage = out / 'execution-coverage'
    coverage.mkdir()
    for n in range(2):
        nonce = secrets.token_hex(12)
        labels = [f'Input{nonce[:8]}', f'Render{nonce[8:16]}', f'Output{nonce[16:]}']
        if n:
            labels.reverse()
        source = out / f'fresh-{n}.md'
        pdf = out / f'fresh-{n}.pdf'
        source.write_text(f'# Document {nonce}\n\nFresh body **{nonce}**.\n\n'
                          f'```mermaid\nflowchart LR\nA[{labels[0]}] --> B[{labels[1]}]\nB --> C[{labels[2]}]\n```\n')
        actual = [str(source) if value == '{input}' else str(pdf) if value == '{output}' else value for value in argv]
        try:
            process = subprocess.run(actual, cwd=root, capture_output=True, text=True, timeout=180, check=False,
                                     env={**os.environ, 'NODE_V8_COVERAGE': str(coverage)})
        except (OSError, subprocess.TimeoutExpired) as error:
            return {'verdict': 'fail', 'reason': f'delivered invocation failed: {error}', 'outputs': outputs}
        (out / f'invocation-{n}.json').write_text(json.dumps({'argv': actual, 'exit_code': process.returncode,
             'stdout': process.stdout, 'stderr': process.stderr}, indent=2))
        if process.returncode:
            return {'verdict': 'fail', 'reason': f'delivered invocation exited {process.returncode}', 'outputs': outputs}
        try:
            outputs.append(inspect_pdf(pdf, nonce, labels))
        except RuntimeError as error:
            return {'verdict': 'unknown', 'reason': str(error), 'outputs': outputs}
        except ValueError as error:
            return {'verdict': 'fail', 'reason': str(error), 'outputs': outputs}
    if outputs[0]['sha256'] == outputs[1]['sha256']:
        return {'verdict': 'fail', 'reason': 'distinct fresh inputs yielded identical PDFs', 'outputs': outputs}
    executed = set()
    for file in coverage.glob('*.json'):
        for script in json.loads(file.read_text()).get('result', []):
            url = script.get('url', '')
            # Loading a module is not executing its implementation. Exclude the
            # top-level range so unused checker imports cannot pad the team.
            invoked = any(f.get('ranges') and f['ranges'][0].get('startOffset', 0) > 0 and
                          f['ranges'][0].get('count', 0) > 0 for f in script.get('functions', []))
            if url.startswith('file:') and invoked:
                executed.add(str(Path(unquote(urlparse(url).path)).resolve()))
    return {'verdict': 'pass', 'reason': 'two fresh documents independently rendered, parsed and rasterized with Mermaid labels and graphics',
            'outputs': outputs, 'executed_files': sorted(executed)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    root, out = args.root.resolve(), args.out.resolve()
    if out == root or root in out.parents:
        result = {'verdict': 'fail', 'reason': 'evidence output must be outside the disposable subject root', 'outputs': []}
    else:
        try:
            result = run(root, out)
        except Exception as error:
            result = {'verdict': 'fail', 'reason': f'probe could not inspect output: {error}', 'outputs': []}
    if out.is_dir():
        (out / 'result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result))
    sys.exit(0 if result['verdict'] == 'pass' else 2 if result['verdict'] == 'unknown' else 1)
