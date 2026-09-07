"""Run with evaluator PyMuPDF installed: python3 .harness/extensions/flow-eval/pdf-probe-controls.py."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

import fitz

spec = importlib.util.spec_from_file_location('pdf_probe', Path(__file__).with_name('pdf-probe.py'))
probe = importlib.util.module_from_spec(spec)
spec.loader.exec_module(probe)


class PdfControls(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'result.pdf'
        self.nonce = 'fresh-document-192827'
        self.labels = ['InputAlpha', 'RenderBeta', 'OutputGamma']

    def document(self, text=None, diagram=True):
        with fitz.open() as doc:
            page = doc.new_page()
            page.insert_text((40, 40), self.nonce if text is None else text)
            for index, label in enumerate(self.labels):
                left = 40 + index * 160
                page.insert_text((left + 8, 105), label)
                if diagram:
                    page.draw_rect(fitz.Rect(left, 80, left + 130, 120), color=(0, 0, 0))
                    if index:
                        page.draw_line(fitz.Point(left - 30, 100), fitz.Point(left, 100), color=(0, 0, 0))
            doc.save(self.path)

    def test_fresh_vector_diagram_is_parsed_and_rasterized(self):
        self.document()
        evidence = probe.inspect_pdf(self.path, self.nonce, self.labels)
        self.assertGreaterEqual(evidence['diagram_shapes'], 3)
        self.assertEqual(evidence['pages'], 1)
        self.assertTrue(Path(evidence['previews'][0]).is_file())

    def test_canned_output_is_rejected(self):
        self.document(text='old document')
        with self.assertRaisesRegex(ValueError, 'nonce'):
            probe.inspect_pdf(self.path, self.nonce, self.labels)

    def test_text_only_mermaid_is_rejected(self):
        self.document(diagram=False)
        with self.assertRaisesRegex(ValueError, 'shapes/connectors'):
            probe.inspect_pdf(self.path, self.nonce, self.labels)

    def test_printed_mermaid_source_is_rejected(self):
        self.document(text=self.nonce + ' flowchart LR A --> B')
        with self.assertRaisesRegex(ValueError, 'source'):
            probe.inspect_pdf(self.path, self.nonce, self.labels)

    def test_missing_and_fake_pdf_are_rejected(self):
        with self.assertRaisesRegex(ValueError, 'missing'):
            probe.inspect_pdf(self.path, self.nonce, self.labels)
        self.path.write_text('not a PDF')
        with self.assertRaisesRegex(ValueError, 'not a PDF'):
            probe.inspect_pdf(self.path, self.nonce, self.labels)


if __name__ == '__main__':
    unittest.main()
