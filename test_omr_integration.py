"""Smoke tests for OMR alignment and multi-page question scoring.

Run from the project folder:
    python test_omr_integration.py

The tests use temporary folders and do not alter the user's work/output.
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

import cv2

PROJECT = Path(__file__).resolve().parent
OMR_PATH = PROJECT / "omr.py"
if not OMR_PATH.is_file():
    raise SystemExit("لم يتم العثور على omr.py بجوار ملف الاختبار.")

spec = importlib.util.spec_from_file_location("original_omr", OMR_PATH)
if spec is None or spec.loader is None:
    raise SystemExit("تعذر تحميل ملف omr.py الأصلي.")
omr = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = omr
spec.loader.exec_module(omr)

SOURCE_TEMPLATE = PROJECT / "template"
SOURCE_LAYOUT = json.loads((SOURCE_TEMPLATE / "layout.json").read_text(encoding="utf-8"))
if not SOURCE_LAYOUT.get("pages") or not SOURCE_LAYOUT.get("questions"):
    raise SystemExit("ملفات القالب غير مكتملة. أنشئ القالب أولاً.")


def run_process(root: Path, source: Path):
    previous_cwd = Path.cwd()
    try:
        os.chdir(root)
        return omr.process(str(source), True)
    finally:
        os.chdir(previous_cwd)


def prepare_template(root: Path, layout: dict, page_indices: list[int]):
    template = root / "template"
    template.mkdir(parents=True, exist_ok=True)
    (template / "layout.json").write_text(json.dumps(layout), encoding="utf-8")
    for index in page_indices:
        shutil.copy2(SOURCE_TEMPLATE / f"p{index + 1}.png", template / f"p{index + 1}.png")
    return template


def test_single_page_detection():
    with tempfile.TemporaryDirectory(prefix="questionnaire-omr-single-") as temp:
        root = Path(temp)
        first_question = next(
            q for q in SOURCE_LAYOUT["questions"]
            if q["type"] == "choice" and q["page"] == 0
        )
        layout = {"pages": [SOURCE_LAYOUT["pages"][0]], "questions": [first_question]}
        prepare_template(root, layout, [0])

        image = cv2.imread(str(root / "template" / "p1.png"), cv2.IMREAD_COLOR)
        assert image is not None, "تعذرت قراءة PNG التجريبية."
        points = omr.find_markers(image)
        assert points is not None and len(points) == 4, "فشل OMR في اكتشاف علامات الزوايا الأربع."
        for point, expected in zip(points, layout["pages"][0]["markers"]):
            assert abs(float(point[0]) - expected[0]) <= 3 and abs(float(point[1]) - expected[1]) <= 3, (
                f"مركز علامة الزاوية لا يطابق layout.json: {point} مقابل {expected}"
            )

        first_question = layout["questions"][0]
        first_option = first_question["options"][0]["rect"]
        x, y, width, height = first_option
        center = (x + width // 2, y + height // 2)
        cv2.circle(image, center, 13, (0, 0, 0), 4)
        scans = root / "scans"
        scans.mkdir()
        scan = scans / "0001.png"
        assert cv2.imwrite(str(scan), image), "تعذر حفظ صورة الاختبار."

        stats = run_process(root, scans)
        sheets = json.loads((root / "work" / "sheets.json").read_text(encoding="utf-8"))
        assert stats["errors"] == 0, f"حدث خطأ محاذاة: {stats}"
        assert len(sheets) == 1, f"المتوقع ورقة واحدة: {len(sheets)}"
        detected = sheets[0]["q"][first_question["id"]]
        assert detected["sel"] == 0, f"لم يكتشف OMR الخيار الأول: {detected}"
        assert detected["status"] == "ok", f"حالة الاختيار غير متوقعة: {detected}"
        assert detected["scores"][0] >= omr.MIN_PIX, f"درجة الحبر أقل من الحد: {detected}"


def test_split_question_scores_across_pages():
    page_zero_question = next(
        q for q in SOURCE_LAYOUT["questions"]
        if q["type"] == "choice" and q["page"] == 0 and len(q.get("options", [])) >= 2
    )
    page_one_question = next(
        q for q in SOURCE_LAYOUT["questions"]
        if q["type"] == "choice" and q["page"] == 1 and q.get("options")
    )
    split_question = {
        "id": "split_test",
        "type": "choice",
        "page": 0,
        "rect": page_zero_question["rect"],
        "text": "Split test / اختبار التقسيم",
        "options": [
            {"label": "First / الأول", "rect": page_zero_question["options"][0]["rect"], "page": 0},
            {"label": "Second / الثاني", "rect": page_one_question["options"][0]["rect"], "page": 1},
        ],
    }
    layout = {
        "pages": SOURCE_LAYOUT["pages"][:2],
        "questions": [split_question],
    }

    with tempfile.TemporaryDirectory(prefix="questionnaire-omr-split-") as temp:
        root = Path(temp)
        prepare_template(root, layout, [0, 1])
        scans = root / "scans"
        scans.mkdir()

        first_scan = cv2.imread(str(root / "template" / "p1.png"), cv2.IMREAD_COLOR)
        second_scan = cv2.imread(str(root / "template" / "p2.png"), cv2.IMREAD_COLOR)
        assert first_scan is not None and second_scan is not None, "تعذرت قراءة صفحات الاختبار."

        x, y, width, height = split_question["options"][1]["rect"]
        center = (x + width // 2, y + height // 2)
        cv2.circle(second_scan, center, 13, (0, 0, 0), 4)
        assert cv2.imwrite(str(scans / "0001.png"), first_scan), "تعذر حفظ الصفحة الأولى."
        assert cv2.imwrite(str(scans / "0002.png"), second_scan), "تعذر حفظ الصفحة الثانية."

        stats = run_process(root, scans)
        sheets = json.loads((root / "work" / "sheets.json").read_text(encoding="utf-8"))
        assert stats["errors"] == 0, f"حدث خطأ محاذاة في اختبار الصفحات المتعددة: {stats}"
        assert len(sheets) == 1, f"المتوقع ورقة واحدة عند مسح صفحتين: {len(sheets)}"
        detected = sheets[0]["q"]["split_test"]
        assert detected["sel"] == 1, f"لم يجمع OMR درجات الخيارات من الصفحة الثانية: {detected}"
        assert detected["status"] == "ok", f"حالة السؤال المقسّم غير متوقعة: {detected}"
        assert detected["scores"][1] >= omr.MIN_PIX, f"درجة الخيار في الصفحة الثانية غير كافية: {detected}"


if __name__ == "__main__":
    test_single_page_detection()
    print("PASS: single-page OMR alignment and option detection.")
    test_split_question_scores_across_pages()
    print("PASS: a split question combines option scores across two scanned pages.")
