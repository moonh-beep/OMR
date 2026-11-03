"""معالجة الاستبيانات الممسوحة (يدعم الصفحة الواحدة أو الاستبيان الكامل) + واجهة المراجعة.
  python omr.py process scan.jpg --fresh          # معالجة صورة لصفحة واحدة (يكتشف رقم الصفحة تلقائياً)
  python omr.py process scan.jpg --page 2 --fresh # معالجة صورة مع تحديد أنها الصفحة رقم 2
  python omr.py process scans/ --fresh            # معالجة مجلد صور أو ملف PDF
  python omr.py review                            # يفتح واجهة المراجعة في المتصفح
"""
import argparse, json, shutil, sys, threading, webbrowser
from pathlib import Path
import cv2, numpy as np

HERE = Path(__file__).parent
TEMPLATE = Path("template")
WORK, OUT = Path("work"), Path("output")
INK_THRESHOLD = 170   # بكسل أغمق من هذا (في أغمق قناة لونية) يُعدّ حبرًا
MIN_PIX = 150         # أقل كمية حبر ليُعتبر الخيار محددًا
AMBIG = 0.25          # الخيار الثاني بهذه النسبة من الأول أو أكثر = غموض
PAD = 10              # توسيع منطقة كل خيار (بكسل) لاستيعاب الدائرة حول الكلمة


def load_pages(src):
    p = Path(src)
    if p.is_dir():
        exts = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}
        return [cv2.imread(str(f)) for f in sorted(p.iterdir()) if f.suffix.lower() in exts]
    if p.suffix.lower() == ".pdf":
        try:
            import fitz
        except ImportError:
            sys.exit("لقراءة PDF ثبّت: pip install pymupdf")
        pages = []
        for pg in fitz.open(p):
            pix = pg.get_pixmap(dpi=200, alpha=False)
            a = np.frombuffer(pix.samples, np.uint8).reshape(pix.h, pix.w, 3)
            pages.append(cv2.cvtColor(a, cv2.COLOR_RGB2BGR))
        return pages
    img = cv2.imread(str(p))
    if img is None:
        sys.exit(f"تعذّر قراءة الملف: {src}")
    return [img]


def find_markers(img):
    """يرجع مراكز المربعات الأربعة (يسار-أعلى، يمين-أعلى، يمين-أسفل، يسار-أسفل) أو None."""
    h, w = img.shape[:2]
    gray = cv2.GaussianBlur(img.min(axis=2), (5, 5), 0)
    _, bw = cv2.threshold(gray, 80, 255, cv2.THRESH_BINARY_INV)  # أسود فقط (يتجاهل الخلفية الرمادية)
    cnts, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cands = []
    for c in cnts:
        x, y, cw, ch = cv2.boundingRect(c)
        if not (0.02 * w < cw < 0.08 * w) or not (0.75 < cw / ch < 1.33):
            continue
        if cv2.contourArea(c) / (cw * ch) < 0.85:
            continue
        cands.append((x + cw / 2, y + ch / 2))
    pts = []
    for cx, cy in [(0, 0), (w, 0), (w, h), (0, h)]:
        if not cands:
            return None
        pts.append(min(cands, key=lambda q: (q[0] - cx) ** 2 + (q[1] - cy) ** 2))
    return np.float32(pts) if len(set(pts)) == 4 else None


def detect_page_index(img, pts, L, ttext):
    """يكتشف تلقائياً رقم الصفحة (0-based) عبر مطابقة أماكن النصوص المطبوعة مع القالب."""
    if len(L["pages"]) == 1:
        return 0
    best_pi, best_score = 0, -1.0
    for pi, pl in enumerate(L["pages"]):
        M = cv2.getPerspectiveTransform(pts, np.float32(pl["markers"]))
        warped = cv2.warpPerspective(img, M, (pl["w"], pl["h"]), borderValue=(255, 255, 255))
        dark = warped.min(axis=2) < 150
        overlap = (dark & ttext[pi]).sum()
        score = overlap / max(1, ttext[pi].sum())
        if score > best_score:
            best_pi, best_score = pi, score
    return best_pi


def decide(scores):
    order = sorted(range(len(scores)), key=lambda i: -scores[i])
    best, b = order[0], scores[order[0]]
    s2 = scores[order[1]] if len(order) > 1 else 0
    if b < MIN_PIX:
        return {"sel": 0, "status": "review", "why": "none"}
    if s2 >= MIN_PIX and s2 >= AMBIG * b:
        return {"sel": best, "status": "review", "why": "multi"}
    return {"sel": best, "status": "ok"}


def new_empty_sheet(sid, L):
    """ينشئ سجل استبيان جديد مع تهيئة الصفحات غير الممسوحة لتتوافق مع واجهة المراجعة."""
    npp = len(L["pages"])
    q_init = {}
    for q in L["questions"]:
        if q["type"] == "choice":
            q_init[q["id"]] = {
                "sel": None,
                "status": "ok",
                "scores": [0] * len(q.get("options", [])),
            }
    return {
        "id": sid,
        "pages": [f"blank_p{i+1}.jpg" for i in range(npp)],
        "scanned_pages": [],
        "q": q_init,
        "reviewed": False,
        "error": None,
    }


def process(src, fresh, forced_page=None):
    L = json.load(open(TEMPLATE / "layout.json", encoding="utf-8"))
    npp = len(L["pages"])
    tdark, ttext = [], []

    if fresh and WORK.exists():
        shutil.rmtree(WORK)
    WORK.mkdir(exist_ok=True)

    for i in range(npp):
        t = cv2.imread(str(TEMPLATE / f"p{i+1}.png"), 0)
        tdark.append(cv2.dilate((t < 140).astype(np.uint8), np.ones((7, 7), np.uint8)))
        # قناع لنصوص الصفحة فقط (مع استبعاد حواف المربعات الأربعة) لاكتشاف رقم الصفحة بدقة
        h, w = t.shape
        mask = np.zeros_like(t, dtype=bool)
        mask[int(h * 0.07):int(h * 0.93), int(w * 0.07):int(w * 0.93)] = True
        ttext.append((t < 140) & mask)
        # حفظ صورة باهتة للصفحات غير الممسوحة لكي لا تنكسر واجهة review.html
        blank_path = WORK / f"blank_p{i+1}.jpg"
        if not blank_path.exists():
            faded = cv2.cvtColor(255 - ((255 - t) // 5), cv2.COLOR_GRAY2BGR)
            cv2.imwrite(str(blank_path), faded, [cv2.IMWRITE_JPEG_QUALITY, 75])

    sf = WORK / "sheets.json"
    sheets = json.load(open(sf, encoding="utf-8")) if sf.exists() else []
    pages = load_pages(src)

    if forced_page is not None and not (1 <= forced_page <= npp):
        sys.exit(f"رقم الصفحة (--page) يجب أن يكون بين 1 و {npp}")

    cur_sheet = None
    for idx, img in enumerate(pages):
        pts = find_markers(img)
        if pts is None:
            pi = (forced_page - 1) if forced_page else (idx % npp)
            cur_sheet = new_empty_sheet(f"{len(sheets)+1:04d}", L)
            sheets.append(cur_sheet)
            pl = L["pages"][pi]
            name = f"s{cur_sheet['id']}_p{pi+1}.jpg"
            cur_sheet["error"] = f"تعذّر إيجاد مربعات الزوايا في الصفحة {pi+1}"
            raw = cv2.resize(img, (pl["w"], int(img.shape[0] * pl["w"] / img.shape[1])))
            cv2.imwrite(str(WORK / name), raw)
            cur_sheet["pages"][pi] = name
            cur_sheet = None
            continue

        pi = (forced_page - 1) if forced_page else detect_page_index(img, pts, L, ttext)

        # فتح سجل ورقة جديد إذا كانت هذه أول صورة أو إذا تكررت نفس الصفحة في دفعة جديدة
        if cur_sheet is None or pi in cur_sheet["scanned_pages"] or (cur_sheet["scanned_pages"] and pi < cur_sheet["scanned_pages"][-1]):
            cur_sheet = new_empty_sheet(f"{len(sheets)+1:04d}", L)
            sheets.append(cur_sheet)

        cur_sheet["scanned_pages"].append(pi)
        pl = L["pages"][pi]
        name = f"s{cur_sheet['id']}_p{pi+1}.jpg"
        M = cv2.getPerspectiveTransform(pts, np.float32(pl["markers"]))
        warped = cv2.warpPerspective(img, M, (pl["w"], pl["h"]), borderValue=(255, 255, 255))
        cv2.imwrite(str(WORK / name), warped, [cv2.IMWRITE_JPEG_QUALITY, 88])
        cur_sheet["pages"][pi] = name

        ink = (cv2.GaussianBlur(warped.min(axis=2), (3, 3), 0) < INK_THRESHOLD) & (tdark[pi] == 0)
        for q in L["questions"]:
            if q["type"] != "choice":
                continue

            # Ordinary questions have all options on q["page"]. For a continued
            # question, each option carries its own page and scores accumulate
            # until every page containing that question has been scanned.
            page_options = [
                (option_index, option)
                for option_index, option in enumerate(q.get("options", []))
                if option.get("page", q["page"]) == pi
            ]
            if not page_options:
                continue

            scores = list(cur_sheet["q"].get(q["id"], {}).get("scores", []))
            if len(scores) != len(q.get("options", [])):
                scores = [0] * len(q.get("options", []))

            for option_index, option in page_options:
                x, y, w, h = option["rect"]
                score = int(ink[max(0, y - PAD):y + h + PAD, max(0, x):x + w + PAD].sum())
                scores[option_index] = score

            cur_sheet["q"][q["id"]] = {**decide(scores), "scores": scores}

    json.dump(sheets, open(sf, "w", encoding="utf-8"), ensure_ascii=False)
    bad = sum(1 for s in sheets if s["error"])
    flagged = sum(1 for s in sheets for r in s["q"].values() if r["status"] != "ok")
    print(f"إجمالي الأوراق: {len(sheets)} | صور معالجة: {len(pages)} | أخطاء محاذاة: {bad} | أسئلة تحتاج تأكيدًا: {flagged}")
    return {"sheets": len(sheets), "images": len(pages), "errors": bad, "flagged": flagged}


def review(port):
    from flask import Flask, jsonify, request, send_file, send_from_directory
    app = Flask(__name__)
    L = json.load(open(TEMPLATE / "layout.json", encoding="utf-8"))
    sf = WORK / "sheets.json"
    load = lambda: json.load(open(sf, encoding="utf-8"))

    @app.get("/")
    def index():
        return send_file(HERE / "review.html")

    @app.get("/api/layout")
    def layout():
        return jsonify(L)

    @app.get("/api/sheets")
    def sheets():
        return jsonify([{"id": s["id"], "reviewed": s["reviewed"], "error": s["error"]} for s in load()])

    @app.get("/api/sheet/<int:i>")
    def sheet(i):
        return jsonify(load()[i])

    @app.get("/img/<path:name>")
    def img(name):
        return send_from_directory(WORK.resolve(), name)

    @app.post("/api/sheet/<int:i>")
    def save(i):
        answers = request.json["answers"]
        data = load()
        exp = {}
        for q in L["questions"]:
            a = answers.get(q["id"], {})
            if q["type"] == "choice":
                exp[q["id"]] = q["options"][a["sel"]]["label"] if a.get("sel") is not None else None
            else:
                exp[q["id"]] = a.get("text", "")
        data[i]["reviewed"], data[i]["saved"] = True, answers
        OUT.mkdir(exist_ok=True)
        s = data[i]
        json.dump({"sheet_id": s["id"], "answers": exp}, open(OUT / f"sheet_{s['id']}.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        allr = []
        for t in data:
            if t["reviewed"]:
                allr.append(json.load(open(OUT / f"sheet_{t['id']}.json", encoding="utf-8")))
        json.dump(allr, open(OUT / "all.json", "w", encoding="utf-8"), ensure_ascii=False, indent=2)
        json.dump(data, open(sf, "w", encoding="utf-8"), ensure_ascii=False)
        return jsonify(ok=True)

    threading.Timer(1, lambda: webbrowser.open(f"http://127.0.0.1:{port}")).start()
    app.run(port=port)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("process")
    p.add_argument("src")
    p.add_argument("--fresh", action="store_true")
    p.add_argument("--page", type=int, default=None, help="رقم الصفحة (اختياري، يتم اكتشافه تلقائياً إن لم يُحدد)")
    r = sub.add_parser("review")
    r.add_argument("--port", type=int, default=5000)
    a = ap.parse_args()
    process(a.src, a.fresh, a.page) if a.cmd == "process" else review(a.port)
