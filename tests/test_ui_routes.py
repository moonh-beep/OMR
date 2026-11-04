import unittest

from app import app


class MainApplicationRoutesTest(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_main_workspace_route_serves_four_stage_shell(self):
        response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        for marker in (
            'id="sec-tpl"',
            'id="sec-up"',
            'id="sec-review"',
            'id="sec-res"',
            'id="generator-frame"',
            'id="review-frame"',
        ):
            self.assertIn(marker, html)

    def test_generator_route_exposes_visual_question_builder(self):
        response = self.client.get("/generator")
        self.assertEqual(response.status_code, 200)
        html = response.get_data(as_text=True)
        self.assertIn('id="question-list"', html)
        self.assertIn('id="add-question"', html)
        self.assertIn('id="survey-json"', html)

    def test_review_route_and_editor_assets_are_available(self):
        for route in ("/review", "/app.css", "/app.js"):
            with self.subTest(route=route):
                response = self.client.get(route)
                self.assertEqual(response.status_code, 200)
                self.assertGreater(len(response.data), 100)

    def test_status_and_results_endpoints_return_expected_shapes(self):
        status = self.client.get("/api/status")
        self.assertEqual(status.status_code, 200)
        self.assertTrue({"template", "pages", "questions", "sheets", "reviewed"} <= set(status.get_json()))

        results = self.client.get("/api/results")
        self.assertEqual(results.status_code, 200)
        self.assertTrue({"questions", "rows"} <= set(results.get_json()))


if __name__ == "__main__":
    unittest.main()
