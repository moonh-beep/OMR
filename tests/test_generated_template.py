import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

import omr


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "template"


class GeneratedTemplateIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        layout_path = TEMPLATE / "layout.json"
        pdf_path = TEMPLATE / "survey.pdf"
        if not layout_path.is_file() or not pdf_path.is_file():
            raise unittest.SkipTest("Run npm run generate before the generated-template integration tests.")

        cls.layout = json.loads(layout_path.read_text(encoding="utf-8"))
        cls.pdf_bytes = pdf_path.read_bytes()
        if not cls.pdf_bytes.startswith(b"%PDF-"):
            raise AssertionError("The generated survey.pdf is not a valid PDF file header.")

    def test_generated_pdf_and_page_images_match_layout(self):
        self.assertGreater(len(self.pdf_bytes), 1000)
        pages = self.layout.get("pages", [])
        self.assertGreater(len(pages), 0)

        for index, page in enumerate(pages, start=1):
            image_path = TEMPLATE / f"p{index}.png"
            self.assertTrue(image_path.is_file(), f"Missing generated page image: {image_path.name}")
            image = cv2.imread(str(image_path), cv2.IMREAD_GRAYSCALE)
            self.assertIsNotNone(image, f"Could not read {image_path.name}")
            self.assertEqual(image.shape[1], page["w"])
            self.assertEqual(image.shape[0], page["h"])
            self.assertEqual(len(page["markers"]), 4)

            for x, y in page["markers"]:
                px, py = int(round(x)), int(round(y))
                self.assertLess(image[py, px], 80, f"Marker centre is not black on page {index}")

        for question in self.layout.get("questions", []):
            page = pages[question["page"]]
            x, y, width, height = question["rect"]
            self.assertGreater(width, 0)
            self.assertGreater(height, 0)
            self.assertGreaterEqual(x, 0)
            self.assertGreaterEqual(y, 0)
            self.assertLessEqual(x + width, page["w"])
            self.assertLessEqual(y + height, page["h"])

    def test_original_omr_reads_a_synthetic_mark_from_generated_page(self):
        question = next(
            (item for item in self.layout.get("questions", [])
             if item.get("type") == "choice" and item.get("options")),
            None,
        )
        self.assertIsNotNone(question, "The generated template has no choice question to test.")

        page_index = question["page"]
        source_page = TEMPLATE / f"p{page_index + 1}.png"
        image = cv2.imread(str(source_page), cv2.IMREAD_COLOR)
        self.assertIsNotNone(image)

        x, y, width, height = question["options"][0]["rect"]
        center = (int(x + width / 2), int(y + height / 2))
        radius = max(8, min(13, int(height / 4)))
        cv2.circle(image, center, radius, (0, 0, 0), thickness=-1)

        with tempfile.TemporaryDirectory(prefix="omr-generated-template-") as temporary:
            temp_root = Path(temporary)
            shutil.copytree(TEMPLATE, temp_root / "template")
            scan_path = temp_root / "synthetic-answer.png"
            self.assertTrue(cv2.imwrite(str(scan_path), image))

            previous_cwd = Path.cwd()
            try:
                os.chdir(temp_root)
                summary = omr.process(str(scan_path), fresh=True)
                sheets = json.loads((temp_root / "work" / "sheets.json").read_text(encoding="utf-8"))
            finally:
                os.chdir(previous_cwd)

        self.assertEqual(summary["errors"], 0)
        self.assertEqual(len(sheets), 1)
        answer = sheets[0]["q"][question["id"]]
        self.assertEqual(answer["sel"], 0, f"Unexpected OMR result: {answer}")
        self.assertEqual(answer["status"], "ok", f"OMR did not accept the synthetic mark: {answer}")


if __name__ == "__main__":
    unittest.main()
