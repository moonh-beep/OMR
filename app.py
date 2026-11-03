# -*- coding: utf-8 -*-
"""برنامج موحّد: مولّد JavaScript + محرك OMR الأصلي + المراجعة والنتائج.

التشغيل من هذا المجلد:
    python app.py
ثم افتح:
    http://127.0.0.1:5000

لا يعيد هذا الملف تنفيذ تصميم القالب أو خوارزمية OMR:
- توليد PDF/PNG/layout.json يتم عبر محرك JavaScript الموجود في src/.
- قراءة الأوراق تتم باستدعاء omr.py الأصلي كما هو.
"""
from __future__ import annotations

import csv
import io
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path
from typing import Any

from flask import Flask, Response, jsonify, request, send_file, send_from_directory

HERE = Path(__file__).resolve().parent
os.chdir(HERE)  # omr.py يستخدم مجلد العمل الحالي للمجلدات template/work/output.

# يدعم وضع omr.py بجوار app.py أو في المجلد الأب (كما في ملفات هذه المحادثة).
OMR_CANDIDATES = [HERE / "omr.py", HERE.parent / "omr.py"]
OMR_PATH = next((p for p in OMR_CANDIDATES if p.is_file()), None)
if OMR_PATH is None:
    raise FileNotFoundError(
        "لم أجد omr.py. ضع ملف omr.py الأصلي بجوار app.py أو في المجلد الأب. "
        "لم يتم إنشاء نسخة بديلة من خوارزمية OMR."
    )
sys.path.insert(0, str(OMR_PATH.parent))
import omr  # noqa: E402  (استيراد ملف OMR الأصلي دون تعديل)

TEMPLATE = HERE / "template"
WORK = HERE / "work"
OUT = HERE / "output"
UP = HERE / "uploads"
SURVEY = HERE / "survey.current.json"
NODE = os.environ.get("NODE_BINARY", "node")
MAX_UPLOAD = 1024 * 1024 * 1024

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_UPLOAD
lock = threading.RLock()


# ---------- أدوات مساعدة ----------
def jload(path: Path, default: Any = None) -> Any:
    try:
        with path.open("r", encoding="utf-8") as stream:
            return json.load(stream)
    except (OSError, ValueError, TypeError):
        return default


def err(message: str, code: int = 400):
    return jsonify(ok=False, error=str(message)), code


def save_json(path: Path, value: Any, *, indent: int | None = 2) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=indent)


def validate_survey(survey: Any) -> str | None:
    if not isinstance(survey, dict):
        return "بيانات الاستبيان يجب أن تكون كائناً بصيغة JSON."
    questions = survey.get("questions")
    # محرك القالب يدعم أيضاً الاستبيانات المنظمة داخل sections فقط.
    if not isinstance(questions, list):
        sections = survey.get("sections")
        if not isinstance(sections, list) or not sections:
            return "يلزم وجود questions أو sections تحتوي على الأسئلة."
        questions = [q for section in sections if isinstance(section, dict)
                     for q in (section.get("questions") or [])]
    if not questions:
        return "لا توجد أسئلة في الاستبيان."
    ids: list[str] = []
    for q in questions:
        if not isinstance(q, dict):
            return "كل سؤال يجب أن يكون كائناً."
        qid = str(q.get("id", "")).strip()
        if not qid:
            return "كل سؤال يحتاج إلى id."
        ids.append(qid)
        qtype = q.get("type", "choice")
        if qtype not in ("choice", "text"):
            return f"نوع السؤال {qid} يجب أن يكون choice أو text."
        if qtype == "choice" and not q.get("options"):
            return f"السؤال {qid} لا يحتوي على خيارات."
    if len(ids) != len(set(ids)):
        return "معرّفات الأسئلة (id) يجب أن تكون فريدة."
    return None


def run_generator(survey: dict, action: str) -> dict:
    """ينفذ محرك التوليد الأصلي في Node، ولا يحوّل HTML إلى Python."""
    if action == "preview":
        js = r'''
import { renderPreview } from "./src/export.js";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const html = await renderPreview(JSON.parse(input));
process.stdout.write(html);
'''
    elif action == "generate":
        js = r'''
import { generateFiles } from "./src/export.js";
let input = "";
for await (const chunk of process.stdin) input += chunk;
const result = await generateFiles(JSON.parse(input), process.env.SURVEY_OUTPUT_DIR);
process.stdout.write(JSON.stringify({
  pageCount: result.pageCount,
  questionCount: result.questionCount,
  files: result.files,
  outputDir: result.outputDir
}));
'''
    else:
        raise ValueError("إجراء توليد غير معروف")

    env = os.environ.copy()
    env["SURVEY_OUTPUT_DIR"] = str(TEMPLATE)
    try:
        result = subprocess.run(
            [NODE, "--input-type=module", "-e", js],
            cwd=HERE,
            input=json.dumps(survey, ensure_ascii=False),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=300,
            env=env,
            check=False,
        )
    except FileNotFoundError as exc:
        raise RuntimeError("لم أجد Node.js. ثبّت Node.js 22 أو أحدث ثم أعد التشغيل.") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("استغرق محرك التوليد وقتاً أطول من الحد المسموح.") from exc

    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "خطأ غير محدد في محرك JavaScript")[-4000:]
        raise RuntimeError(detail)
    if action == "preview":
        return {"html": result.stdout}
    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("أعاد محرك JavaScript استجابة غير صالحة: " + result.stdout[-1000:]) from exc
    return payload


def sheets_data() -> list[dict]:
    data = jload(WORK / "sheets.json", [])
    return data if isinstance(data, list) else []


def all_results() -> list[dict]:
    data = jload(OUT / "all.json", [])
    return data if isinstance(data, list) else []


# ---------- صفحات الواجهة وملفات محرك JavaScript ----------
@app.get("/")
def index():
    return send_file(HERE / "app.html")


@app.get("/generator")
def generator_page():
    # يعرض واجهة محرك JavaScript داخل تبويب التطبيق الموحد.
    return send_file(HERE / "index.html")


@app.get("/review")
def review_page():
    return send_file(HERE / "review.html")


@app.get("/<path:name>")
def engine_asset(name: str):
    # index.html الخاص بالمولّد يطلب app.css وapp.js وsurvey.json من نفس الخادم.
    if name in {"app.js", "app.css", "survey.json"}:
        return send_from_directory(HERE, name)
    return err("الملف غير موجود.", 404)


# ---------- الحالة ----------
@app.get("/api/status")
def status():
    layout = jload(TEMPLATE / "layout.json")
    sheets = sheets_data()
    return jsonify(
        template=bool(layout),
        pages=len(layout.get("pages", [])) if layout else 0,
        questions=len(layout.get("questions", [])) if layout else 0,
        sheets=len(sheets),
        reviewed=sum(1 for sheet in sheets if sheet.get("reviewed")),
        errors=sum(1 for sheet in sheets if sheet.get("error")),
    )


@app.get("/api/survey")
def get_survey():
    # احتفظ بملف survey.json كعينة أصلية، وخزّن آخر استبيان مولّد في ملف مستقل.
    latest = jload(SURVEY)
    sample = jload(HERE / "survey.json", {"title_en": "", "title_ar": "", "questions": []})
    return jsonify(latest if latest is not None else sample)


# ---------- جسر واجهة التوليد إلى محرك JavaScript ----------
@app.post("/api/preview")
def preview_template():
    survey = request.get_json(silent=True)
    problem = validate_survey(survey)
    if problem:
        return err(problem)
    try:
        return jsonify(run_generator(survey, "preview"))
    except Exception as exc:
        return err("تعذرت المعاينة: " + str(exc), 500)


@app.post("/api/generate")
def generate_template():
    survey = request.get_json(silent=True)
    problem = validate_survey(survey)
    if problem:
        return err(problem)
    with lock:
        try:
            result = run_generator(survey, "generate")
            save_json(SURVEY, survey)
        except Exception as exc:
            return err("فشل توليد القالب: " + str(exc), 500)
    return jsonify(**result, outputUrl="/template/")


# مسار متوافق مع الواجهة القديمة التي كانت تستدعي /api/template.
@app.post("/api/template")
def legacy_generate_template():
    survey = request.get_json(silent=True)
    problem = validate_survey(survey)
    if problem:
        return err(problem)
    with lock:
        try:
            result = run_generator(survey, "generate")
            save_json(SURVEY, survey)
        except Exception as exc:
            return err("فشل توليد القالب: " + str(exc), 500)
    return jsonify(
        ok=True,
        message=f"تم إنشاء {result['pageCount']} صفحة و{result['questionCount']} سؤال باستخدام محرك JavaScript.",
    )


@app.get("/api/template/pdf")
def template_pdf():
    pdf_path = TEMPLATE / "survey.pdf"
    if not pdf_path.is_file():
        return err("أنشئ القالب أولاً من تبويب القالب.", 404)
    return send_file(pdf_path, as_attachment=True, download_name="survey.pdf")


@app.get("/template/<path:name>")
def template_file(name: str):
    return send_from_directory(TEMPLATE, name, as_attachment=False)


# ---------- رفع الصور وتشغيل OMR الأصلي ----------
@app.post("/api/process")
def process_upload():
    if not (TEMPLATE / "layout.json").is_file():
        return err("أنشئ القالب أولاً من تبويب القالب.")
    incoming = [item for item in request.files.getlist("files") if item and item.filename]
    if not incoming:
        return err("لم تُرفع أي ملفات.")

    fresh = request.form.get("fresh") == "1"
    raw_page = request.form.get("page", "").strip()
    forced_page = int(raw_page) if raw_page.isdigit() and int(raw_page) > 0 else None
    image_exts = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}
    pdfs: list[Path] = []

    with lock:
        try:
            if fresh:
                for directory in (WORK, OUT):
                    shutil.rmtree(directory, ignore_errors=True)
            shutil.rmtree(UP, ignore_errors=True)
            image_dir = UP / "images"
            image_dir.mkdir(parents=True, exist_ok=True)

            saved_images = 0
            for index, uploaded in enumerate(sorted(incoming, key=lambda f: f.filename.lower())):
                suffix = Path(uploaded.filename).suffix.lower()
                if suffix in image_exts:
                    target = image_dir / f"{index:05d}{suffix}"
                    uploaded.save(target)
                    saved_images += 1
                elif suffix == ".pdf":
                    target = UP / f"{index:05d}.pdf"
                    uploaded.save(target)
                    pdfs.append(target)

            if not saved_images and not pdfs:
                return err("الصيغ المدعومة: PNG, JPG, JPEG, TIF, TIFF, BMP, PDF.")

            processed_images = 0
            sources: list[Path] = []
            if saved_images:
                sources.append(image_dir)
            sources.extend(pdfs)

            first = fresh
            for source in sources:
                # هذه هي دالة process الأصلية في omr.py دون تعديل خوارزميتها.
                stats = omr.process(str(source), first, forced_page)
                first = False
                processed_images += int(stats.get("images", 0))

            # omr.process يعيد أعداد الأوراق والأخطاء التراكمية من sheets.json؛
            # نقرأ الحالة النهائية مرة واحدة حتى لا تتكرر الأعداد عند تعدد ملفات PDF.
            final_sheets = sheets_data()
            totals = {
                "sheets": len(final_sheets),
                "images": processed_images,
                "errors": sum(1 for item in final_sheets if item.get("error")),
                "flagged": sum(
                    1 for item in final_sheets for answer in item.get("q", {}).values()
                    if answer.get("status") != "ok"
                ),
            }
            return jsonify(ok=True, **totals)
        except SystemExit as exc:
            return err(str(exc) or "توقفت المعالجة.")
        except Exception as exc:
            return err(f"خطأ أثناء معالجة الملفات: {exc}", 500)
        finally:
            shutil.rmtree(UP, ignore_errors=True)


@app.post("/api/reset")
def reset():
    with lock:
        for directory in (WORK, OUT):
            shutil.rmtree(directory, ignore_errors=True)
    return jsonify(ok=True)


# ---------- واجهة المراجعة ----------
@app.get("/api/layout")
def layout():
    data = jload(TEMPLATE / "layout.json")
    if data is None:
        return err("لا يوجد قالب بعد.", 404)
    return jsonify(data)


@app.get("/api/sheets")
def sheets():
    return jsonify([
        {"id": sheet.get("id"), "reviewed": bool(sheet.get("reviewed")), "error": sheet.get("error")}
        for sheet in sheets_data()
    ])


@app.get("/api/sheet/<int:index>")
def get_sheet(index: int):
    data = sheets_data()
    if not 0 <= index < len(data):
        return err("الورقة غير موجودة.", 404)
    return jsonify(data[index])


@app.get("/img/<path:name>")
def sheet_image(name: str):
    if not WORK.is_dir():
        return err("لا توجد صور للمراجعة.", 404)
    return send_from_directory(WORK.resolve(), name)


@app.post("/api/sheet/<int:index>")
def save_sheet(index: int):
    payload = request.get_json(silent=True) or {}
    answers = payload.get("answers")
    if not isinstance(answers, dict):
        return err("بيانات الإجابات غير صالحة.")
    layout_data = jload(TEMPLATE / "layout.json")
    if not layout_data:
        return err("لا يوجد قالب.", 404)

    with lock:
        data = sheets_data()
        if not 0 <= index < len(data):
            return err("الورقة غير موجودة.", 404)
        sheet = data[index]
        exported: dict[str, Any] = {}
        normalized: dict[str, Any] = {}
        for question in layout_data.get("questions", []):
            qid = question["id"]
            answer = answers.get(qid, {})
            if not isinstance(answer, dict):
                answer = {}
            if question.get("type") == "choice":
                selected = answer.get("sel")
                if selected is None or selected == "":
                    selected = None
                else:
                    try:
                        selected = int(selected)
                    except (TypeError, ValueError):
                        return err(f"قيمة الاختيار للسؤال {qid} غير صالحة.")
                    if not 0 <= selected < len(question.get("options", [])):
                        return err(f"رقم الخيار للسؤال {qid} خارج النطاق.")
                normalized[qid] = {"sel": selected}
                exported[qid] = question["options"][selected]["label"] if selected is not None else None
            else:
                value = str(answer.get("text", ""))
                normalized[qid] = {"text": value}
                exported[qid] = value

        sheet["reviewed"] = True
        sheet["saved"] = normalized
        OUT.mkdir(parents=True, exist_ok=True)
        save_json(OUT / f"sheet_{sheet['id']}.json", {"sheet_id": sheet["id"], "answers": exported})
        all_rows = []
        for record in data:
            if record.get("reviewed"):
                row_path = OUT / f"sheet_{record['id']}.json"
                row = jload(row_path)
                if row is not None:
                    all_rows.append(row)
        save_json(OUT / "all.json", all_rows)
        save_json(WORK / "sheets.json", data, indent=None)
    return jsonify(ok=True)


# ---------- النتائج والتصدير ----------
def result_questions() -> list[dict]:
    layout_data = jload(TEMPLATE / "layout.json", {"questions": []})
    return [{"id": q["id"], "text": q.get("text", "")} for q in layout_data.get("questions", [])]


@app.get("/api/results")
def get_results():
    return jsonify(questions=result_questions(), rows=all_results())


@app.get("/api/export.json")
def export_json():
    body = json.dumps(all_results(), ensure_ascii=False, indent=2)
    return Response(body, mimetype="application/json; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=all.json"})


@app.get("/api/export.csv")
def export_csv():
    questions = result_questions()
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(["sheet_id"] + [f"{q['id']} - {q['text']}" for q in questions])
    for row in all_results():
        answers = row.get("answers", {})
        writer.writerow([row.get("sheet_id", "")] + [answers.get(q["id"]) or "" for q in questions])
    return Response("\ufeff" + buffer.getvalue(), mimetype="text/csv; charset=utf-8",
                    headers={"Content-Disposition": "attachment; filename=results.csv"})


def main() -> None:
    port = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get("PORT", "5000"))
    url = f"http://127.0.0.1:{port}"
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    print(f"تم تشغيل البرنامج الموحد: {url}")
    print(f"محرك التوليد: JavaScript ({HERE})")
    print(f"محرك OMR الأصلي: {OMR_PATH}")
    app.run(host="127.0.0.1", port=port, threaded=True, use_reloader=False)


if __name__ == "__main__":
    main()
