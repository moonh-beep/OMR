"""معالجة الاستبيانات الممسوحة (يدعم الصفحة الواحدة أو الاستبيان الكامل).
  python omr.py process scan.jpg --fresh          # معالجة صورة لصفحة واحدة (يكتشف رقم الصفحة تلقائياً)
  python omr.py process scan.jpg --page 2 --fresh # معالجة صورة مع تحديد أنها الصفحة رقم 2
  python omr.py process scans/ --fresh            # معالجة مجلد صور أو ملف PDF
  python omr.py review                            # يشغّل واجهة التطبيق الموحد (app.py) للمراجعة

ملاحظات التصميم:
- الصور تُفترض بترتيب الأوراق (1،2،1،2…) ولا مقلوبة.
- درجة كل خيار = كمية الحبر منسوبة لمساحة منطقته، ثم مضروبة في مساحة الخيار "المرجعي"
  (وسيط مساحات الخيارات في القالب). لذلك تبقى المقاييس MIN_PIX وAMBIG بنفس معناها،
  ولا يتحيّز القرار للمستطيلات الأكبر.
"""
import argparse, json, shutil, sys
from pathlib import Path
import cv2, numpy as np

HERE = Path(__file__).parent
TEMPLATE = Path("template")
WORK, OUT = Path("work"), Path("output")
INK_THRESHOLD = 170   # بكسل أغمق من هذا (بعد تسوية الإضاءة) يُعدّ حبرًا
MIN_PIX = 150         # أقل كمية حبر (مكافئة لمساحة الخيار المرجعي) ليُعتبر الخيار محددًا
AMBIG = 0.25          # الخيار الثاني بهذه النسبة من الأول أو أكثر = غموض
PAD = 10              # توسيع منطقة كل خيار (بكسل)، ويُقصّ عند منتصف المسافة بين الخيارات المتجاورة
MARKER_THRESHOLDS = (80, 110, 140, 55)  # عتبات تجربة المربعات السوداء (تُجرَّب بالترتيب)
QUAD_TOL = 0.2        # تفاوت مسموح في أضلاع الشكل الرباعي ونسبة أبعاده


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


def flatten(gray):
    """يسوّي الإضاءة: يقسم الصورة على خلفيتها المقدّرة، فيصير الورق أبيض حتى مع ظل أو تدرّج."""
    small = cv2.resize(gray, None, fx=0.25, fy=0.25, interpolation=cv2.INTER_AREA)
    bg = cv2.dilate(small, np.ones((11, 11), np.uint8))   # يزيل الحبر والنص (أرفع من ~44 بكسل)
    bg = cv2.GaussianBlur(bg, (0, 0), 6)
    bg = cv2.resize(bg, (gray.shape[1], gray.shape[0]), interpolation=cv2.INTER_LINEAR)
    out = gray.astype(np.float32) * 255.0 / np.maximum(bg.astype(np.float32), 1.0)
    return np.clip(out, 0, 255).astype(np.uint8)


def marker_ratio(L):
    """نسبة عرض إلى ارتفاع الشكل الرباعي لمراكز المربعات في القالب."""
    m = np.float32(L["pages"][0]["markers"])
    top, bot = np.linalg.norm(m[1] - m[0]), np.linalg.norm(m[2] - m[3])
    left, right = np.linalg.norm(m[3] - m[0]), np.linalg.norm(m[2] - m[1])
    return float((top + bot) / (left + right))


def quad_ok(pts, ratio=None):
    """يتحقق أن النقاط الأربع تشكّل مستطيلاً معقولاً (أضلاع متقابلة متقاربة ونسبة أبعاد قريبة من القالب)."""
    p = np.float32(pts)
    top, bot = np.linalg.norm(p[1] - p[0]), np.linalg.norm(p[2] - p[3])
    left, right = np.linalg.norm(p[3] - p[0]), np.linalg.norm(p[2] - p[1])
    if min(top, bot, left, right) < 1:
        return False
    if abs(top - bot) > QUAD_TOL * max(top, bot) or abs(left - right) > QUAD_TOL * max(left, right):
        return False
    if ratio and abs(((top + bot) / (left + right)) / ratio - 1) > QUAD_TOL:
        return False
    return True


def find_markers(img, ratio=None):
    """يرجع مراكز المربعات الأربعة (يسار-أعلى، يمين-أعلى، يمين-أسفل، يسار-أسفل) أو None.
    يجرّب عدة عتبات، ولا يقبل إلا شكلاً رباعياً صالحاً."""
    h, w = img.shape[:2]
    gray = cv2.GaussianBlur(img.min(axis=2), (5, 5), 0)
    for thr in MARKER_THRESHOLDS:
        _, bw = cv2.threshold(gray, thr, 255, cv2.THRESH_BINARY_INV)
        cnts, _ = cv2.findContours(bw, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        cands = []
        for c in cnts:
            x, y, cw, ch = cv2.boundingRect(c)
            if not (0.02 * w < cw < 0.08 * w) or not (0.75 < cw / ch < 1.33):
                continue
            if cv2.contourArea(c) / (cw * ch) < 0.85:
                continue
            cands.append((x + cw / 2, y + ch / 2))
        if not cands:
            continue
        pts = [min(cands, key=lambda q: (q[0] - cx) ** 2 + (q[1] - cy) ** 2)
               for cx, cy in [(0, 0), (w, 0), (w, h), (0, h)]]
        if len(set(pts)) == 4 and quad_ok(pts, ratio):
            return np.float32(pts)
    return None


def detect_page_index(img, pts, L, ttext):
    """يكتشف تلقائياً رقم الصفحة (0-based) عبر مطابقة أماكن النصوص المطبوعة مع القالب."""
    if len(L["pages"]) == 1:
        return 0
    best_pi, best_score = 0, -1.0
    for pi, pl in enumerate(L["pages"]):
        M = cv2.getPerspectiveTransform(pts, np.float32(pl["markers"]))
        warped = cv2.warpPerspective(img, M, (pl["w"], pl["h"]), borderValue=(255, 255, 255))
        dark = flatten(warped.min(axis=2)) < 150
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


def option_region(rect, others):
    """منطقة القياس لخيار: مستطيله + PAD، مع قصّ الهامش عند منتصف المسافة بين الخيار وجاره
    كي لا يتسرّب حبر الخيار المجاور إلى درجته."""
    x, y, w, h = rect
    l = r = t = b = PAD
    for ox, oy, ow, oh in others:
        if min(x + w, ox + ow) > max(x, ox):          # يتداخلان أفقياً: جار فوق/تحت
            if oy >= y + h:
                b = min(b, max(0, (oy - (y + h)) // 2))
            elif oy + oh <= y:
                t = min(t, max(0, (y - (oy + oh)) // 2))
        if min(y + h, oy + oh) > max(y, oy):          # يتداخلان رأسياً: جار يمين/يسار
            if ox >= x + w:
                r = min(r, max(0, (ox - (x + w)) // 2))
            elif ox + ow <= x:
                l = min(l, max(0, (x - (ox + ow)) // 2))
    return x - l, y - t, x + w + r, y + h + b


def reference_area(L):
    """وسيط مساحات مستطيلات الخيارات في القالب."""
    areas = [o["rect"][2] * o["rect"][3] for q in L["questions"] if q["type"] == "choice" for o in q["options"]]
    return float(np.median(areas)) if areas else 1.0


def score_options(ink, q, ref_area):
    """درجة كل خيار = حبر منطقته منسوباً إلى مساحتها × مساحة الخيار المرجعي."""
    rects = [o["rect"] for o in q["options"]]
    H, W = ink.shape
    out = []
    for i, rc in enumerate(rects):
        x0, y0, x1, y1 = option_region(rc, rects[:i] + rects[i + 1:])
        x0, y0, x1, y1 = max(0, x0), max(0, y0), min(W, x1), min(H, y1)
        part = ink[y0:y1, x0:x1]
        out.append(int(round(int(part.sum()) * ref_area / max(1, part.size))))
    return out


def new_empty_sheet(sid, L):
    """ينشئ سجل استبيان جديد مع تهيئة الصفحات غير الممسوحة لتتوافق مع واجهة المراجعة."""
    npp = len(L["pages"])
    q_init = {}
    for q in L["questions"]:
        if q["type"] == "choice":
            q_init[q["id"]] = {"sel": None, "status": "ok", "scores": []}
    return {
        "id": sid,
        "pages": [f"blank_p{i+1}.jpg" for i in range(npp)],
        "scanned_pages": [],
        "placed": [],      # الصفحات الموضوعة في هذه الورقة (الممسوحة والفاشلة) لتجميع الأوراق
        "q": q_init,
        "reviewed": False,
        "error": None,
    }


def place_page(cur_sheet, sheets, pi, L):
    """يُرجع الورقة التي تنتمي لها الصفحة pi، وينشئ ورقة جديدة عند تكرار الصفحة أو تراجع الترتيب."""
    if cur_sheet is None or pi in cur_sheet["placed"] or (cur_sheet["placed"] and pi < cur_sheet["placed"][-1]):
        cur_sheet = new_empty_sheet(f"{len(sheets)+1:04d}", L)
        sheets.append(cur_sheet)
    return cur_sheet


def process(src, fresh, forced_page=None):
    L = json.load(open(TEMPLATE / "layout.json", encoding="utf-8"))
    npp = len(L["pages"])
    ratio, ref_area = marker_ratio(L), reference_area(L)
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
        pts = find_markers(img, ratio)
        if pts is None:
            # الصفحة الفاشلة تبقى في ورقتها: نخمّن أنها الصفحة التالية في الترتيب، ولا نقطع تجميع الأوراق.
            if forced_page:
                pi = forced_page - 1
            elif cur_sheet is not None and cur_sheet["placed"] and cur_sheet["placed"][-1] + 1 < npp:
                pi = cur_sheet["placed"][-1] + 1
            else:
                pi = 0
            cur_sheet = place_page(cur_sheet, sheets, pi, L)
            cur_sheet["placed"].append(pi)
            pl = L["pages"][pi]
            name = f"s{cur_sheet['id']}_p{pi+1}.jpg"
            msg = f"تعذّر إيجاد مربعات الزوايا في الصفحة {pi+1}"
            cur_sheet["error"] = f"{cur_sheet['error']}؛ {msg}" if cur_sheet["error"] else msg
            raw = cv2.resize(img, (pl["w"], int(img.shape[0] * pl["w"] / img.shape[1])))
            cv2.imwrite(str(WORK / name), raw)
            cur_sheet["pages"][pi] = name
            continue

        pi = (forced_page - 1) if forced_page else detect_page_index(img, pts, L, ttext)
        cur_sheet = place_page(cur_sheet, sheets, pi, L)
        cur_sheet["placed"].append(pi)
        cur_sheet["scanned_pages"].append(pi)
        pl = L["pages"][pi]
        name = f"s{cur_sheet['id']}_p{pi+1}.jpg"
        M = cv2.getPerspectiveTransform(pts, np.float32(pl["markers"]))
        warped = cv2.warpPerspective(img, M, (pl["w"], pl["h"]), borderValue=(255, 255, 255))
        cv2.imwrite(str(WORK / name), warped, [cv2.IMWRITE_JPEG_QUALITY, 88])
        cur_sheet["pages"][pi] = name

        gray = cv2.GaussianBlur(warped.min(axis=2), (3, 3), 0)
        ink = (flatten(gray) < INK_THRESHOLD) & (tdark[pi] == 0)
        for q in L["questions"]:
            if q["page"] != pi or q["type"] != "choice":
                continue
            scores = score_options(ink, q, ref_area)
            cur_sheet["q"][q["id"]] = {**decide(scores), "scores": scores}

    json.dump(sheets, open(sf, "w", encoding="utf-8"), ensure_ascii=False)
    bad = sum(1 for s in sheets if s["error"])
    flagged = sum(1 for s in sheets for r in s["q"].values() if r["status"] != "ok")
    print(f"إجمالي الأوراق: {len(sheets)} | صور معالجة: {len(pages)} | أخطاء محاذاة: {bad} | أسئلة تحتاج تأكيدًا: {flagged}")
    return {"sheets": len(sheets), "images": len(pages), "errors": bad, "flagged": flagged}


def review(port):
    """واجهة المراجعة موجودة في app.py فقط (نسخة واحدة)؛ هذا الأمر يشغّلها للتوافق مع الأوامر القديمة."""
    import app as web
    sys.argv = ["app.py", str(port)]
    web.main()


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