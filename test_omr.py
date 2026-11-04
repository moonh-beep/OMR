"""اختبارات omr.py بصور مولّدة برمجياً (لا تحتاج قالب المشروع الحقيقي).
التشغيل من مجلد المشروع:  python -m unittest tests.test_omr -v
"""
import json, sys, tempfile, unittest
from pathlib import Path
import cv2, numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import omr

W, H, M = 827, 1169, 40           # صفحة A4 بدقة 100dpi، ومراكز المربعات على بعد M من الحواف
BOX = 32                          # حجم المربع الأسود
# (رقم الصفحة، اسم السؤال، مستطيلات الخيارات) - الخيار الثالث في q1 أعرض بأربعة أضعاف ليختبر التطبيع
QUESTIONS = {
    "q1": (0, [[150, 300, 200, 40], [150, 380, 200, 40], [150, 460, 200, 40]]),
    "q2": (0, [[150, 600, 200, 40], [400, 600, 200, 40]]),
    "q3": (1, [[150, 300, 200, 40], [150, 380, 200, 40], [150, 460, 200, 40]]),
}


def make_layout():
    return {
        "pages": [{"w": W, "h": H, "markers": [[M, M], [W - M, M], [W - M, H - M], [M, H - M]]}] * 2,
        "questions": [
            {"id": qid, "page": pg, "type": "choice", "text": qid,
             "options": [{"label": f"{qid}-{i}", "rect": r} for i, r in enumerate(rects)]}
            for qid, (pg, rects) in QUESTIONS.items()
        ],
    }


def make_template_page(pi):
    img = np.full((H, W), 255, np.uint8)
    for cx, cy in [(M, M), (W - M, M), (W - M, H - M), (M, H - M)]:
        cv2.rectangle(img, (cx - BOX // 2, cy - BOX // 2), (cx + BOX // 2, cy + BOX // 2), 0, -1)
    # نص مميّز لكل صفحة (لاكتشاف رقم الصفحة)، بعيداً عن مستطيلات الخيارات
    text, y = ("PAGE ONE TEXT", 140) if pi == 0 else ("SECOND SHEET WORDS", 900)
    cv2.putText(img, text, (120, y), cv2.FONT_HERSHEY_SIMPLEX, 1.6, 0, 4)
    cv2.putText(img, text, (120, y + 80), cv2.FONT_HERSHEY_SIMPLEX, 1.6, 0, 4)
    return img


def simulate_scan(template, marks, shade=0.9, angle=1.5, noise=3, seed=0):
    """يرسم علامات بالحبر الأزرق ثم يحاكي مسحاً: دوران بسيط + خلفية رمادية + تدرّج إضاءة + ضجيج."""
    img = cv2.cvtColor(template, cv2.COLOR_GRAY2BGR)
    for (x, y, w, h) in marks:
        cv2.ellipse(img, (x + w // 2, y + h // 2), (w // 2 - 10, h // 2 - 6), 0, 0, 360, (130, 40, 20), 3)
        cv2.line(img, (x + w // 2 - 20, y + h // 2), (x + w // 2 + 20, y + h // 2), (130, 40, 20), 4)
    CW, CH = W + 160, H + 140
    Mx = cv2.getRotationMatrix2D((W / 2, H / 2), angle, 1.0)
    Mx[:, 2] += (80, 70)
    out = cv2.warpAffine(img, Mx, (CW, CH), borderValue=(128, 128, 128))
    grad = np.linspace(1.0, shade, CW, dtype=np.float32)[None, :, None]
    out = (out.astype(np.float32) * grad)
    out += np.random.default_rng(seed).normal(0, noise, out.shape)
    return np.clip(out, 0, 255).astype(np.uint8)


class OmrTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        root = Path(self.tmp.name)
        omr.TEMPLATE, omr.WORK, omr.OUT = root / "template", root / "work", root / "output"
        omr.TEMPLATE.mkdir()
        self.L = make_layout()
        json.dump(self.L, open(omr.TEMPLATE / "layout.json", "w"))
        self.tpl = [make_template_page(0), make_template_page(1)]
        for i, t in enumerate(self.tpl):
            cv2.imwrite(str(omr.TEMPLATE / f"p{i+1}.png"), t)
        self.scans = root / "scans"
        self.scans.mkdir()
        self.n = 0

    def tearDown(self):
        self.tmp.cleanup()

    def add_scan(self, pi, picks=(), blank=False, **kw):
        """picks: قائمة (سؤال، رقم الخيار) تُرسم عليها علامات."""
        marks = [QUESTIONS[q][1][o] for q, o in picks]
        img = np.full((H, W, 3), 255, np.uint8) if blank else simulate_scan(self.tpl[pi], marks, **kw)
        self.n += 1
        cv2.imwrite(str(self.scans / f"{self.n:03d}.png"), img)

    def run_omr(self):
        omr.process(str(self.scans), True)
        return json.load(open(omr.WORK / "sheets.json", encoding="utf-8"))

    # ---------- القراءة الأساسية ----------
    def test_clean_marks_two_pages(self):
        self.add_scan(0, [("q1", 1), ("q2", 0)])
        self.add_scan(1, [("q3", 2)])
        sheets = self.run_omr()
        self.assertEqual(len(sheets), 1)
        q = sheets[0]["q"]
        self.assertEqual([q[k]["sel"] for k in ("q1", "q2", "q3")], [1, 0, 2])
        self.assertTrue(all(q[k]["status"] == "ok" for k in q))
        self.assertEqual(sheets[0]["scanned_pages"], [0, 1])

    def test_multi_and_none_are_flagged(self):
        self.add_scan(0, [("q1", 0), ("q1", 2)])      # q1 علامتان، وq2 بلا علامة
        self.add_scan(1, [("q3", 1)])
        q = self.run_omr()[0]["q"]
        self.assertEqual((q["q1"]["status"], q["q1"].get("why")), ("review", "multi"))
        self.assertEqual((q["q2"]["status"], q["q2"].get("why")), ("review", "none"))
        self.assertEqual((q["q3"]["status"], q["q3"]["sel"]), ("ok", 1))

    # ---------- تجميع الأوراق ----------
    def test_failed_page_does_not_split_sheets(self):
        self.add_scan(0, [("q1", 0)])
        self.add_scan(1, blank=True)                 # صفحة 2 فاشلة (بلا مربعات)
        self.add_scan(0, [("q1", 2)])
        self.add_scan(1, [("q3", 0)])
        sheets = self.run_omr()
        self.assertEqual(len(sheets), 2)
        self.assertIn("الصفحة 2", sheets[0]["error"])
        self.assertIsNone(sheets[1]["error"])
        self.assertEqual(sheets[1]["q"]["q1"]["sel"], 2)
        self.assertEqual(sheets[1]["q"]["q3"]["sel"], 0)

    def test_failed_first_page_starts_new_sheet(self):
        self.add_scan(0, [("q1", 0)])
        self.add_scan(1, [("q3", 1)])
        self.add_scan(0, blank=True)                 # الصفحة 1 من الورقة الثانية فاشلة
        self.add_scan(1, [("q3", 2)])
        sheets = self.run_omr()
        self.assertEqual(len(sheets), 2)
        self.assertIn("الصفحة 1", sheets[1]["error"])
        self.assertEqual(sheets[1]["q"]["q3"]["sel"], 2)

    # ---------- التطبيع والإضاءة ----------
    def test_uneven_illumination(self):
        """ظل قوي على جانب الصفحة: لا يجوز أن يُحسب الورق حبراً."""
        self.add_scan(0, [("q1", 1)], shade=0.55)
        self.add_scan(1, [("q3", 0)], shade=0.55)
        q = self.run_omr()[0]["q"]
        self.assertEqual((q["q1"]["sel"], q["q1"]["status"]), (1, "ok"))
        self.assertEqual((q["q2"]["status"], q["q2"].get("why")), ("review", "none"))
        self.assertEqual((q["q3"]["sel"], q["q3"]["status"]), (0, "ok"))

    def test_scores_normalized_by_area(self):
        rng = np.random.default_rng(1)
        small, wide = [100, 100, 100, 20], [100, 400, 400, 20]
        q = {"options": [{"rect": small}, {"rect": wide}]}
        ink = rng.random((600, 700)) < 0.10          # كثافة حبر 10% في كل مكان
        s_small, s_wide = omr.score_options(ink, q, ref_area=4000.0)
        self.assertAlmostEqual(s_small / 400, 1.0, delta=0.2)   # الكثافة ثابتة ⇒ الدرجة ≈ 10% × المساحة المرجعية
        self.assertAlmostEqual(s_wide / 400, 1.0, delta=0.2)

    def test_padding_is_clipped_between_neighbors(self):
        q = {"options": [{"rect": [100, 100, 100, 20]}, {"rect": [100, 124, 100, 20]}]}   # فجوة 4 بكسل
        ink = np.zeros((300, 300), bool)
        ink[124:144, 100:200] = True                  # حبر في الخيار الثاني فقط
        a, b = omr.score_options(ink, q, ref_area=2000.0)
        self.assertEqual(a, 0)
        self.assertGreater(b, 0)

    # ---------- المربعات ----------
    def test_marker_quad_validation_rejects_stray_square(self):
        img = simulate_scan(self.tpl[0], [])
        cv2.rectangle(img, (5, 5), (45, 45), (0, 0, 0), -1)   # مربع شاذ عند الزاوية يسار-أعلى خارج الصفحة
        pts = omr.find_markers(img, omr.marker_ratio(self.L))
        if pts is not None:   # إن قُبل شكل فيجب أن يكون صالحاً
            self.assertTrue(omr.quad_ok(pts, omr.marker_ratio(self.L)))


if __name__ == "__main__":
    unittest.main()
