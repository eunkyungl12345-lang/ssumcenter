#!/usr/bin/env python3
"""어두운 테마 페이지를 밝은 테마로 바꾸는 도구 (2026-11 전면 리뉴얼 때 만듦).

쓰는 법:  python3 scripts/lighten.py 파일.html [파일2.html ...]
          python3 scripts/lighten.py --tailwind      (tailwind.css → tailwind-light.css)

⚠️ 한 번만 돌리는 도구다. 이미 밝게 바꾼 페이지에 다시 돌리면 색이 엉킨다.
   (밝은 페이지인지는 <html data-theme="light"> 로 표시해 두고, 표시가 있으면 건너뛴다)

원리: 색 하나하나를 "어디에 쓰였나(글자/배경/테두리/그림자)"와 "어떤 색인가(어두운 무채색/밝은 무채색/
      앰버 포인트/그 밖의 색)"로 나눠서 밝은 테마의 짝으로 바꾼다.
"""
import re, sys, colorsys

INK, SUB, FAINT = "#1E1E1E", "#666666", "#767676"
BG, CARD = "#FAFAF8", "#FFFFFF"
POINT, POINT_SOFT, POINT_TEXT, POINT_MID = "#FF6B6B", "#FF8E7E", "#E5484D", "#E5484D"
FONT = "Pretendard,-apple-system,BlinkMacSystemFont,Apple SD Gothic Neo,system-ui,sans-serif"   # 따옴표를 쓰지 않는다 (style="…" 나 JS 문자열 안에서 깨지지 않게)
PRETENDARD = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard/dist/web/static/pretendard.css">'

# 그대로 둬야 하는 남의 브랜드 색 (카카오 노랑·네이버 초록 등)
KEEP = {"#fee500", "#fae100", "#ffe812", "#03c75a", "#3c1e1e", "#191919", "#191600"}

TOKEN = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(?:,\s*[\d.]+\s*)?\)")


def parse(tok):
    t = tok.lower()
    if t.startswith("#"):
        h = t[1:]
        if len(h) in (3, 4):
            h = "".join(c * 2 for c in h)
        if len(h) not in (6, 8):
            return None
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
        return r, g, b, a
    n = re.findall(r"[\d.]+", t)
    if len(n) < 3:
        return None
    a = float(n[3]) if len(n) > 3 else 1.0
    return int(n[0]), int(n[1]), int(n[2]), a


def fmt_alpha(a):
    s = ("%.3f" % a).rstrip("0").rstrip(".")
    return s[1:] if s.startswith("0.") else s


def rgba(hexc, a):
    r, g, b, _ = parse(hexc)
    return "rgba(%d,%d,%d,%s)" % (r, g, b, fmt_alpha(a))


def role_of(text, start):
    """색 바로 앞을 읽어서 글자/배경/테두리/그림자 중 무엇인지 알아낸다."""
    seg = text[max(0, start - 160):start]
    # 1) CSS 선언:  prop: ... #색
    m = re.search(r"(?:^|[;{\"'`>\s(])(-{0,2}[a-zA-Z][\w-]*)\s*:\s*[^;{}\"'`<>]*$", seg)
    prop = m.group(1).lower() if m else None
    if not prop:
        # 2) JS:  style.color = "#색"  /  color: "#색"
        m = re.search(r"([A-Za-z][\w-]*)\s*[:=]\s*[\"'`]\s*$", seg)
        prop = m.group(1).lower() if m else ""
    p = prop
    if p.startswith("--"):
        if re.search(r"ink-on|on-amber|on-gold", p):
            return "text"
        if re.search(r"line|border", p):
            return "border"
        return "var"
    if "shadow" in p:
        return "shadow"
    if "border" in p or p in ("outline", "outline-color", "stroke", "column-rule"):
        return "border"
    if p in ("color", "-webkit-text-fill-color", "caret-color", "text-decoration-color", "text-decoration", "fill"):
        return "text"
    if p.startswith("background") or p in ("bg", "backgroundcolor", "accent-color"):
        return "bg"
    return "var"


def convert(tok, role):
    low = tok.lower()
    if low in KEEP:
        return tok
    c = parse(tok)
    if not c:
        return tok
    r, g, b, a = c
    mx, mn = max(r, g, b), min(r, g, b)
    chroma = mx - mn
    h, l, s = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    hue = h * 360
    accent = chroma >= 70 and 20 <= hue <= 62 and l >= .3
    neutral = not accent and chroma < 64

    def out(hexc, alpha=None):
        alpha = a if alpha is None else alpha
        return hexc if alpha >= .995 else rgba(hexc, alpha)

    if accent:
        if role == "text":
            return out(POINT_TEXT, max(a, .85) if a < 1 else None)
        if role == "shadow":
            return rgba(POINT, a * .6)
        if role in ("bg", "border"):
            return out(POINT_SOFT if l > .68 else POINT)
        return out(POINT_MID)

    if neutral:
        if l < .24:  # 어두운 무채색 = 다크 테마의 바탕·카드·선 (글자로 쓰였으면 버튼 위 글자)
            if role == "text":
                return out(INK)
            if role == "shadow":
                return rgba("#000000", max(.04, a * .16))
            if a < .995:  # 반투명 어두운 판 (상단바·가림막)
                if role == "bg" and (r, g, b) == (0, 0, 0):
                    return rgba("#000000", a * .18 if a < .4 else min(a, .45))
                return rgba(BG if l < .1 else "#F4F2EE", a)
            if role == "border":
                return "#EEEBE6" if l < .1 else ("#E6E2DC" if l < .15 else "#D9D5CD")
            return BG if l < .06 else (CARD if l < .1 else ("#F4F2EE" if l < .15 else "#ECE9E4"))
        if l < .45:  # 흐린 글자
            if role == "border":
                return out("#CFCAC2")
            if role == "bg":
                return out("#E4E0DA")
            return out(FAINT)
        if l < .74:  # 보조 글자
            if role == "border":
                return out("#CFCAC2")
            if role == "bg":
                return out("#E4E0DA")
            return out(SUB if l < .64 else "#4A4A4A")
        # 밝은 무채색 = 다크 테마의 본문 글자 (배경으로 쓰였으면 흰 카드 → 그대로)
        if a < .995:
            if role == "text":
                return rgba(INK, max(a, .55))
            if role == "shadow":
                return rgba("#000000", a * .3)
            return rgba("#000000", a * .8)
        if role in ("text", "var"):
            return INK
        if role == "border":
            return "#D9D5CD"
        return tok

    # 그 밖의 색 (초록·분홍·파랑·빨강): 흰 바탕에서 읽히도록 글자일 때만 진하게
    if role in ("text", "var") and l > .5 and a >= .995:
        r2, g2, b2 = colorsys.hls_to_rgb(h, .42, min(1, s * .95))
        return "#%02X%02X%02X" % (round(r2 * 255), round(g2 * 255), round(b2 * 255))
    if role == "bg" and l < .3 and a >= .995:
        r2, g2, b2 = colorsys.hls_to_rgb(h, .95, s)
        return "#%02X%02X%02X" % (round(r2 * 255), round(g2 * 255), round(b2 * 255))
    return tok


def is_accent(tok):
    c = parse(tok)
    if not c or tok.lower() in KEEP:
        return False
    r, g, b, a = c
    h, l, _ = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return a >= .995 and max(r, g, b) - min(r, g, b) >= 70 and 20 <= h * 360 <= 62 and l >= .3


def is_strong(tok):
    """빨강·초록·파랑처럼 진한 색 판 (그 위의 흰 글자는 흰색으로 남겨야 한다)"""
    c = parse(tok)
    if not c or tok.lower() in KEEP:
        return False
    r, g, b, a = c
    _, l, _ = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
    return a >= .995 and max(r, g, b) - min(r, g, b) >= 64 and l < .62


def on_accent(text, st, test=None):
    """이 글자색이 들어 있는 묶음(CSS 한 덩어리 또는 style="…" 하나)에 포인트색 배경이 같이 있는가"""
    a = max(text.rfind("{", 0, st), text.rfind('"', 0, st), text.rfind("}", 0, st))
    ends = [e for e in (text.find("}", st), text.find('"', st)) if e >= 0]
    b = min(ends) if ends else len(text)
    block = text[a + 1:b]
    for m in re.finditer(r"background(?:-color|-image)?\s*:\s*([^;]+)", block):
        if any((test or is_accent)(t.group(0)) for t in TOKEN.finditer(m.group(1))):
            return True
    return False


def recolor(text):
    out, last = [], 0
    for m in TOKEN.finditer(text):
        st = m.start()
        prev = text[st - 1] if st else ""
        prev2 = text[st - 2:st]
        # tailwind 클래스 이름 속 색(bg-[#16140f])은 건드리지 않는다 → tailwind-light.css 가 대신 바꿔준다
        if prev in "[\\&" or prev2 == "\\#" or (prev.isalnum()):
            continue
        role = role_of(text, st)
        new = convert(m.group(0), role)
        if role == "text" and new == INK and (on_accent(text, st) or on_accent(text, st, is_strong)):
            new = "#fff"   # 포인트색·진한 색 판 위의 글자는 흰색
        if new != m.group(0):
            out.append(text[last:st]); out.append(new); last = m.end()
    out.append(text[last:])
    return "".join(out)


def fonts(text):
    def fam(m):
        v = m.group(2)
        if re.search(r"monospace|Jua|Font Awesome|inherit", v, re.I):
            return m.group(0)
        return m.group(1) + FONT
    # 값 = 쉼표로 이어진 글꼴 이름들 ("…" / '…' / 따옴표 없는 이름). 속성 끝의 따옴표에서 멈춘다.
    tok = r"""\s*(?:"[^"\n,;{}<>]*"|'[^'\n,;{}<>]*'|[\w\- ]+)\s*"""
    text = re.sub(r"(font-family\s*:)(" + tok + "(?:," + tok + ")*)", fam, text)
    # 이제 안 쓰는 구글 글꼴(Noto Sans KR · Gmarket Sans · Inter) 불러오기 제거
    text = re.sub(r"[ \t]*<link[^>]+fonts\.googleapis\.com/css2\?[^>]*>\n?", "", text)
    text = re.sub(r"[ \t]*<link rel=\"preconnect\" href=\"https://fonts\.(?:googleapis|gstatic)\.com\"[^>]*>\n?", "", text)
    if "pretendard" not in text.lower().split("</head>")[0].replace("font-family", ""):
        text = text.replace("</title>", "</title>\n" + PRETENDARD, 1)
    elif "pretendard.css" not in text and "pretendardvariable" not in text.lower():
        text = text.replace("</title>", "</title>\n" + PRETENDARD, 1)
    return text


def page(path):
    s = open(path, encoding="utf-8").read()
    if 'data-theme="light"' in s[:600]:
        print("건너뜀 (이미 밝은 테마):", path); return
    s = recolor(s)
    s = fonts(s)
    s = s.replace(".bg-y{background:#FF6B6B}", ".bg-y{background:#FF6B6B;color:#fff}")   # 포인트색 버튼 글자는 흰색
    s = s.replace("color-scheme:dark", "color-scheme:light").replace("color-scheme: dark", "color-scheme: light")
    s = re.sub(r'((?:src|href)=")(/?)logo\.png"', r'\1\2logo-dark.png"', s)
    s = re.sub(r'(href="/?(?:\.\./)?)tailwind\.css', r"\1tailwind-light.css", s)
    s = re.sub(r"<html\b", '<html data-theme="light"', s, 1)
    open(path, "w", encoding="utf-8").write(s)
    print("밝게 바꿈:", path)


def tailwind():
    s = open("tailwind.css", encoding="utf-8").read()
    s = recolor(s)
    # 색 이름표(var) 자체는 그대로 둔다 — 흰 카드(bg-white)는 계속 흰색이어야 한다
    s = re.sub(r"--color-black:\s*[^;]+;", "--color-black: #000;", s)
    s = re.sub(r"--color-white:\s*[^;]+;", "--color-white: #fff;", s)
    # 파스텔 색(…-400)은 흰 바탕에서 글자가 흐려서 조금 진하게
    s = re.sub(r"(--color-[a-z]+-400:\s*oklch\()[\d.]+%", r"\g<1>56%", s)
    # 흰 글자 → 진한 글자, 흰 반투명 판·선 → 검은 반투명 (색 이름으로 적혀 있어 줄 단위로 바꾼다)
    out, mode = [], None
    for line in s.split("\n"):
        m = re.match(r"  (\.\S+) \{", line)
        if m:
            sel = m.group(1)
            mode = "ink" if re.search(r"text-white", sel) else ("black" if re.search(r"(bg|border)-white\\/", sel) else None)
        if mode == "ink":
            line = line.replace("var(--color-white)", INK)
        elif mode == "black":
            line = line.replace("var(--color-white)", "var(--color-black)")
        out.append(line)
    s = "\n".join(out)
    acc = sorted(set(m.group(1) for m in re.finditer(r"^  \.bg-\\\[\\(#[0-9a-fA-F]{6})\\\] \{", open("tailwind.css", encoding="utf-8").read(), re.M) if is_accent(m.group(1))))
    if acc:
        s += "\n/* 포인트색 버튼 위 글자는 흰색 */\n" + ",\n".join('[class~="bg-[%s]"]' % h for h in acc) + " { color: #fff; }\n"
    # 색을 안 적은 테두리(border)는 글자색을 따라가서 밝은 테마에선 시커멓게 보인다 → 기본 선 색을 정해 둔다
    s += "\n@layer base { *, ::before, ::after { border-color: #E6E2DC; } }\n"
    s = "/* ⚠️ 직접 고치지 말 것 — tailwind.css 를 `python3 scripts/lighten.py --tailwind` 로 밝게 바꾼 사본 */\n" + s
    open("tailwind-light.css", "w", encoding="utf-8").write(s)
    print("만듦: tailwind-light.css")


if __name__ == "__main__":
    args = sys.argv[1:]
    if args and args[0] == "--tailwind":
        tailwind()
    for f in args:
        if not f.startswith("--"):
            page(f)
