"""Smoke test for the original omr.py using a synthetic mark on a generated PNG.

Run from the project folder:
    python tests/test_omr_integration.py

The test looks for omr.py beside this project or one directory above it and
uses a temporary working folder so it does not alter the user's work/output.
"""
from __future__ import annotations

import importlib.util
import json
import shutil
import sys
import tempfile
from pathlib import Path

import cv2

PROJECT = Path(__file__).resolve().parents[1]
OMR_CANDIDATES = [PROJECT / "omr.py", PROJECT.parent / "omr.py"]
OMR_PATH = next((candidate for candidate in OMR_CANDIDATES if candidate.is_file()), None)
if OMR_PATH is None:
    raise SystemExit("لم يتم العثور على omr.py بجوار المشروع أو في المجلد الأب.")

spec = importlib.util.spec_from_file_location("original_omr", OMR_PATH)
if spec is None or spec.loader is None:
    raise SystemExit("تعذر تحميل ملف omr.py الأصلي.")
omr = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = omr
spec.loader.exec_module(omr)

source_template = PROJECT / "template"
layout = json.loads((source_template / "layout.json").read_text(encoding="utf-8"))
if not layout.get("pages") or not layout.get("questions"):
    raise SystemExit("ملفات القالب غير مكتملة. أنشئ القالب أولاً.")

with tempfile.TemporaryDirectory(prefix="questionnaire-omr-test-") as temp:
    root = Path(temp)
    template = root / "template"
    template.mkdir()
    shutil.copy2(source_template / "layout.json", template / "layout.json")
    shutil.copy2(source_template / "p1.png", template / "p1.png")

    image = cv2.imread(str(template / "p1.png"), cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit("تعذرت قراءة PNG التجريبية.")

    points = omr.find_markers(image)
    assert points is not None and len(points) == 4, "فشل OMR في اكتشاف علامات الزوايا الأربع."
    for point, expected in zip(points, layout["pages"][0]["markers"]):
        assert abs(float(point[0]) - expected[0]) <= 3 and abs(float(point[1]) - expected[1]) <= 3, \
            f"مركز علامة الزاوية لا يطابق layout.json: {point} مقابل {expected}"

    first_question = next(q for q in layout["questions"] if q["type"] == "choice")
    first_option = first_question["options"][0]["rect"]
    x, y, width, height = first_option
    # الدائرة توضع في الفراغ الوسطي داخل مستطيل الخيار كي لا تتداخل مع النص المطبوع.
    center = (x + width // 2, y + height // 2)
    cv2.circle(image, center, 13, (0, 0, 0), 4)
    scan = root / "marked-page.png"
    assert cv2.imwrite(str(scan), image), "تعذر حفظ صورة الاختبار."

    previous_cwd = Path.cwd()
    try:
        import os
        os.chdir(root)
        stats = omr.process(str(scan), True)
    finally:
        os.chdir(previous_cwd)

    sheets = json.loads((root / "work" / "sheets.json").read_text(encoding="utf-8"))
    assert stats["errors"] == 0, f"حدث خطأ محاذاة: {stats}"
    assert len(sheets) == 1, f"المتوقع ورقة واحدة: {len(sheets)}"
    detected = sheets[0]["q"][first_question["id"]]
    assert detected["sel"] == 0, f"لم يكتشف OMR الخيار الأول: {detected}"
    assert detected["status"] == "ok", f"حالة الاختيار غير متوقعة: {detected}"
    assert detected["scores"][0] >= omr.MIN_PIX, f"درجة الحبر أقل من الحد: {detected}"

    print("PASS: original omr.py detected four fiducial markers.")
    print(f"PASS: original OMR aligned the page without error: {stats}.")
    print(f"PASS: synthetic mark selected option 0 for {first_question['id']}: {detected}.")
