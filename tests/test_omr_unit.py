import unittest

import cv2
import numpy as np

import omr


class OMRUnitTests(unittest.TestCase):
    def test_no_marked_option_requires_review(self):
        result = omr.decide([0, 0, 0])
        self.assertEqual(result["sel"], 0)
        self.assertEqual(result["status"], "review")
        self.assertEqual(result["why"], "none")

    def test_single_clear_mark_is_accepted(self):
        result = omr.decide([450, 0, 0])
        self.assertEqual(result["sel"], 0)
        self.assertEqual(result["status"], "ok")

    def test_competing_marks_are_flagged_as_ambiguous(self):
        result = omr.decide([450, 150, 0])
        self.assertEqual(result["sel"], 0)
        self.assertEqual(result["status"], "review")
        self.assertEqual(result["why"], "multi")

    def test_find_markers_returns_four_corners_in_expected_order(self):
        image = np.full((1400, 1000, 3), 255, dtype=np.uint8)
        size = 40
        offset = 60
        corners = [
            (offset, offset),
            (1000 - offset - size, offset),
            (1000 - offset - size, 1400 - offset - size),
            (offset, 1400 - offset - size),
        ]
        for x, y in corners:
            cv2.rectangle(image, (x, y), (x + size - 1, y + size - 1), (0, 0, 0), -1)

        markers = omr.find_markers(image)
        self.assertIsNotNone(markers)
        expected = np.float32([
            [offset + size / 2, offset + size / 2],
            [1000 - offset - size / 2, offset + size / 2],
            [1000 - offset - size / 2, 1400 - offset - size / 2],
            [offset + size / 2, 1400 - offset - size / 2],
        ])
        np.testing.assert_allclose(markers, expected, atol=2.0)

    def test_new_empty_sheet_prepares_only_choice_questions_for_omr(self):
        layout = {
            "pages": [{}, {}],
            "questions": [
                {"id": "age", "type": "choice"},
                {"id": "comment", "type": "text"},
            ],
        }
        sheet = omr.new_empty_sheet("0001", layout)
        self.assertEqual(sheet["pages"], ["blank_p1.jpg", "blank_p2.jpg"])
        self.assertIn("age", sheet["q"])
        self.assertNotIn("comment", sheet["q"])
        self.assertFalse(sheet["reviewed"])


if __name__ == "__main__":
    unittest.main()
