/* ============================================================
   유형 테스트 공용 도구 (연애 취향 영수증 · 연애 사원증이 같이 쓴다)

   들어 있는 것
   1) 캐릭터 그리기 — 표정·장식·포즈가 다른 '컵 친구들'. 그림 파일 없이 코드로 그린다.
      (어디서든 깨지지 않고, 결과 이미지에도 그대로 들어간다)
   2) 결과 이미지에 쓰는 그리기 도구 — 말풍선, 도장, 바코드, 배경
   3) 테스트 진행 — 질문 → 결과 → 공유 → 신청. 페이지는 '질문·유형·결과 그림'만 넘겨주면 된다.

   지켜야 할 것 (CLAUDE.md 에도 적혀 있다)
   - 이름·연락처를 묻는 화면을 결과 앞에 넣지 않는다.
   - 지어낸 숫자("오늘 N명 참여" 등)를 넣지 않는다.
   ============================================================ */
(function () {
  "use strict";

  var OUT = "#4a2e1f";
  var BODY = "-apple-system,'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif";
  var KAKAO_KEY = "702b5ffe9fbe4643438cdedc5e4e1a52"; // 로그인 화면과 같은 공개용 키
  function $(id) { return document.getElementById(id); }

  /* ---------- 기본 도형 ---------- */
  function rr(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r); c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h); c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r); c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y); c.closePath(); }
  function heart(c, x, y, s) { c.beginPath(); c.moveTo(x, y + s * .3); c.bezierCurveTo(x - s * .6, y - s * .25, x - s * .28, y - s * .62, x, y - s * .22); c.bezierCurveTo(x + s * .28, y - s * .62, x + s * .6, y - s * .25, x, y + s * .3); c.closePath(); }
  function star4(c, x, y, s) { c.beginPath(); c.moveTo(x, y - s); c.quadraticCurveTo(x + s * .18, y - s * .18, x + s, y); c.quadraticCurveTo(x + s * .18, y + s * .18, x, y + s); c.quadraticCurveTo(x - s * .18, y + s * .18, x - s, y); c.quadraticCurveTo(x - s * .18, y - s * .18, x, y - s); c.closePath(); }

  /* ---------- 글자 ---------- */
  /* 귀여운 글꼴(Jua)을 실제로 불러왔을 때만 쓴다. 못 불러왔으면 기본 글꼴을 굵게 써서 얇아 보이지 않게 한다. */
  function juaReady() { var ok = false; try { document.fonts.forEach(function (f) { if (/Jua/i.test(f.family) && f.status === "loaded") ok = true; }); } catch (e) { } return ok; }
  function cuteFont(px) { return juaReady() ? px + "px 'Jua'," + BODY : "800 " + px + "px " + BODY; }
  function today() { var d = new Date(Date.now() + 9 * 3600 * 1000); var p = function (n) { return String(n).padStart(2, "0"); }; return d.getUTCFullYear() + "." + p(d.getUTCMonth() + 1) + "." + p(d.getUTCDate()); }
  function wrapLines(c, text, maxW) {
    var words = String(text).split(" "), lines = [], cur = "";
    words.forEach(function (w) { var t = cur ? cur + " " + w : w; if (c.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur); return lines;
  }
  function cleanName(v) { return String(v || "").replace(/[<>&"'`\\\/]/g, "").replace(/\s+/g, " ").trim().slice(0, 10).trim(); }
  function toast(msg) { var t = $("toast"); if (!t) return; t.textContent = msg; t.classList.add("on"); clearTimeout(toast._t); toast._t = setTimeout(function () { t.classList.remove("on"); }, 3200); }

  /* ============================================================
     캐릭터 — 컵 친구들
     spec = { cup, foam, face, eyes, mouth, top, pose, acc:[...], tie }
       eyes : dot | angry | half | heart | shades | happy | wide | sleepy | wink
       mouth: open | flat | smirk | smile | o | tongue
       top  : flame | ice | straw | honey | bubbles | bolt | moon | sparkles | sprout | star | latte | none
       pose : down | up | hip | heart | cross | wave | peace | think | point
       acc  : tie | glasses | horn(뿔테) | badge
     ============================================================ */
  function mascot(c, cx, cy, s, spec) {
    var lw = Math.max(2, s * .034), FACE = spec.face || OUT, CUP = spec.cup;
    var BW = .30, BT = -.19, BB = .34;
    c.save(); c.translate(cx, cy); c.lineJoin = "round"; c.lineCap = "round";
    function fs(col, w) { c.fillStyle = col; c.fill(); c.lineWidth = w || lw; c.strokeStyle = OUT; c.stroke(); }

    // 바닥 그림자
    c.fillStyle = "rgba(74,46,31,.13)"; c.beginPath(); c.ellipse(0, s * .485, s * .3, s * .04, 0, 0, Math.PI * 2); c.fill();
    // 다리 + 발
    [-1, 1].forEach(function (d) {
      c.beginPath(); c.moveTo(d * s * .12, s * (BB - .03)); c.lineTo(d * s * .12, s * .43); c.lineWidth = lw * 3; c.strokeStyle = OUT; c.stroke();
      c.beginPath(); c.moveTo(d * s * .12, s * (BB - .03)); c.lineTo(d * s * .12, s * .43); c.lineWidth = lw * 1.4; c.strokeStyle = CUP; c.stroke();
      c.beginPath(); c.ellipse(d * s * .14, s * .447, s * .078, s * .04, 0, 0, Math.PI * 2); fs(CUP);
    });
    // 손잡이
    c.beginPath(); c.arc(s * BW, s * .06, s * .115, -Math.PI * .5, Math.PI * .5); c.lineWidth = lw * 3.1; c.strokeStyle = OUT; c.stroke();
    c.beginPath(); c.arc(s * BW, s * .06, s * .115, -Math.PI * .5, Math.PI * .5); c.lineWidth = lw * 1.3; c.strokeStyle = CUP; c.stroke();

    // 잔 뒤에 있어야 자연스러운 장식
    if (spec.top === "straw") {
      c.beginPath(); c.moveTo(s * .1, s * (BT + .01)); c.lineTo(s * .22, s * (BT - .33)); c.lineWidth = lw * 2.6; c.strokeStyle = OUT; c.stroke();
      c.beginPath(); c.moveTo(s * .1, s * (BT + .01)); c.lineTo(s * .22, s * (BT - .33)); c.lineWidth = lw * 1.2; c.strokeStyle = "#FF8FA3"; c.stroke();
    }

    // 몸통 + 윗면
    rr(c, -s * BW, s * BT, s * BW * 2, s * (BB - BT), s * .16); fs(CUP);
    c.beginPath(); c.ellipse(0, s * BT, s * (BW + .005), s * .08, 0, 0, Math.PI * 2); fs(spec.foam || "#fff");

    // 볼터치
    c.fillStyle = "rgba(255,105,125,.42)";
    c.beginPath(); c.ellipse(-s * .2, s * .155, s * .05, s * .03, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.ellipse(s * .2, s * .155, s * .05, s * .03, 0, 0, Math.PI * 2); c.fill();

    // 눈
    var ex = s * .115, ey = s * .06, er = s * .035;
    function dot(x, r) { c.fillStyle = FACE; c.beginPath(); c.arc(x, ey, r, 0, Math.PI * 2); c.fill(); c.fillStyle = "#fff"; c.beginPath(); c.arc(x - r * .3, ey - r * .35, r * .32, 0, Math.PI * 2); c.fill(); }
    function arcEye(x, up) { c.beginPath(); if (up) c.arc(x, ey + s * .02, s * .043, Math.PI * 1.12, Math.PI * 1.88); else c.arc(x, ey - s * .02, s * .043, Math.PI * .12, Math.PI * .88); c.lineWidth = lw * 1.15; c.strokeStyle = FACE; c.stroke(); }
    function line(x1, y1, x2, y2, w) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.lineWidth = w || lw * 1.15; c.strokeStyle = FACE; c.stroke(); }
    switch (spec.eyes) {
      case "angry": dot(-ex, er); dot(ex, er); line(-ex - s * .06, ey - s * .085, -ex + s * .045, ey - s * .055); line(ex + s * .06, ey - s * .085, ex - s * .045, ey - s * .055); break;
      case "half": [-ex, ex].forEach(function (x) { c.beginPath(); c.arc(x, ey - s * .005, er * 1.15, 0, Math.PI); c.closePath(); c.fillStyle = FACE; c.fill(); line(x - er * 1.5, ey - s * .005, x + er * 1.5, ey - s * .005); }); break;
      case "heart": c.fillStyle = "#FF5C7A"; heart(c, -ex, ey + s * .02, s * .11); c.fill(); heart(c, ex, ey + s * .02, s * .11); c.fill(); break;
      case "shades":
        c.fillStyle = "#1d1512"; rr(c, -ex - s * .085, ey - s * .05, s * .17, s * .105, s * .04); c.fill(); rr(c, ex - s * .085, ey - s * .05, s * .17, s * .105, s * .04); c.fill();
        c.beginPath(); c.moveTo(-ex + s * .08, ey - s * .02); c.lineTo(ex - s * .08, ey - s * .02); c.lineWidth = lw * 1.2; c.strokeStyle = "#1d1512"; c.stroke();
        c.strokeStyle = "rgba(255,255,255,.75)"; c.lineWidth = lw * .8;
        [-ex, ex].forEach(function (x) { c.beginPath(); c.moveTo(x - s * .045, ey + s * .02); c.lineTo(x - s * .01, ey - s * .025); c.stroke(); });
        break;
      case "happy": arcEye(-ex, true); arcEye(ex, true); break;
      case "wide": dot(-ex, er * 1.45); dot(ex, er * 1.45); break;
      case "sleepy": arcEye(-ex, false); arcEye(ex, false); break;
      case "wink": arcEye(-ex, true); dot(ex, er * 1.1); break;
      default: dot(-ex, er); dot(ex, er);
    }
    // 입
    var my = s * .135;
    function smile(w) { c.beginPath(); c.arc(0, my - s * .005, w, Math.PI * .12, Math.PI * .88); c.lineWidth = lw * 1.15; c.strokeStyle = FACE; c.stroke(); }
    switch (spec.mouth) {
      case "open": c.beginPath(); c.arc(0, my, s * .058, 0, Math.PI); c.closePath(); c.fillStyle = "#B8403A"; c.fill(); c.lineWidth = lw; c.strokeStyle = FACE; c.stroke(); break;
      case "flat": line(-s * .035, my + s * .02, s * .035, my + s * .02); break;
      case "smirk": c.beginPath(); c.moveTo(-s * .05, my + s * .025); c.quadraticCurveTo(s * .01, my + s * .05, s * .065, my); c.lineWidth = lw * 1.15; c.strokeStyle = FACE; c.stroke(); break;
      case "o": c.beginPath(); c.arc(0, my + s * .015, s * .022, 0, Math.PI * 2); c.lineWidth = lw; c.strokeStyle = FACE; c.stroke(); break;
      case "tongue": smile(s * .055); c.fillStyle = "#FF7A8A"; c.beginPath(); c.ellipse(s * .012, my + s * .045, s * .026, s * .03, 0, 0, Math.PI); c.fill(); break;
      default: smile(s * .048);
    }

    // 머리 위 장식
    var T0 = s * BT;
    function cube(x, y, a, z) { c.save(); c.translate(x, y); c.rotate(a); rr(c, -z / 2, -z / 2, z, z, z * .22); fs("#EEF8FF"); c.restore(); }
    switch (spec.top) {
      case "flame":
        c.beginPath(); c.moveTo(0, T0 - s * .35); c.bezierCurveTo(s * .16, T0 - s * .21, s * .13, T0 - s * .05, 0, T0 - s * .05); c.bezierCurveTo(-s * .13, T0 - s * .05, -s * .15, T0 - s * .19, -s * .04, T0 - s * .25); c.bezierCurveTo(-s * .03, T0 - s * .29, -s * .02, T0 - s * .32, 0, T0 - s * .35); c.closePath(); fs("#FF7A2E");
        c.beginPath(); c.moveTo(0, T0 - s * .21); c.bezierCurveTo(s * .07, T0 - s * .15, s * .06, T0 - s * .08, 0, T0 - s * .08); c.bezierCurveTo(-s * .06, T0 - s * .08, -s * .06, T0 - s * .14, 0, T0 - s * .21); c.closePath(); c.fillStyle = "#FFD93B"; c.fill();
        break;
      case "ice": case "straw":
        cube(-s * .12, T0 - s * .04, -.25, s * .13); cube(s * .02, T0 - s * .065, .3, s * .115);
        if (spec.top === "ice") { c.fillStyle = "#FFD93B"; star4(c, -s * .31, T0 - s * .2, s * .06); c.fill(); }
        break;
      case "honey":
        c.beginPath(); c.moveTo(-s * .28, T0 + s * .02); c.quadraticCurveTo(-s * .27, T0 + s * .15, -s * .215, T0 + s * .15); c.quadraticCurveTo(-s * .16, T0 + s * .15, -s * .16, T0 + s * .07);
        c.quadraticCurveTo(-s * .09, T0 + s * .13, -s * .06, T0 + s * .22); c.quadraticCurveTo(-s * .025, T0 + s * .26, 0, T0 + s * .2); c.quadraticCurveTo(s * .01, T0 + s * .1, s * .08, T0 + s * .075);
        c.quadraticCurveTo(s * .19, T0 + s * .065, s * .28, T0 + s * .02); c.quadraticCurveTo(0, T0 + s * .11, -s * .28, T0 + s * .02); c.closePath(); c.fillStyle = "#F59E0B"; c.fill();
        c.fillStyle = "#FF5C7A"; heart(c, s * .29, T0 - s * .23, s * .1); c.fill(); heart(c, s * .41, T0 - s * .1, s * .055); c.fill();
        break;
      case "bubbles":
        [[-s * .29, T0 - s * .19, s * .06], [-s * .16, T0 - s * .3, s * .04], [s * .26, T0 - s * .23, s * .05]].forEach(function (b) { c.beginPath(); c.arc(b[0], b[1], b[2], 0, Math.PI * 2); c.fillStyle = "rgba(255,255,255,.9)"; c.fill(); c.lineWidth = lw * .7; c.strokeStyle = "#C9A66B"; c.stroke(); });
        break;
      case "bolt":
        c.beginPath(); c.moveTo(s * .04, T0 - s * .39); c.lineTo(-s * .1, T0 - s * .19); c.lineTo(-s * .01, T0 - s * .19); c.lineTo(-s * .06, T0 - s * .05); c.lineTo(s * .11, T0 - s * .25); c.lineTo(s * .02, T0 - s * .25); c.closePath(); fs("#FFD93B");
        break;
      case "moon":
        (function () {
          var x = s * .2, y = T0 - s * .23, r = s * .11, d = s * .075, r2 = s * .1;
          var th = Math.acos((d * d + r * r - r2 * r2) / (2 * d * r)), ph = Math.acos((d * d + r2 * r2 - r * r) / (2 * d * r2));
          c.beginPath(); c.arc(x, y, r, th, Math.PI * 2 - th); c.arc(x + d, y, r2, Math.PI + ph, Math.PI - ph, true); c.closePath(); fs("#FFD93B");
          c.fillStyle = "#FFD93B"; star4(c, -s * .26, T0 - s * .21, s * .05); c.fill(); star4(c, -s * .1, T0 - s * .31, s * .032); c.fill();
        })();
        break;
      case "sparkles":
        c.fillStyle = "#FF8FA3"; star4(c, -s * .28, T0 - s * .21, s * .07); c.fill();
        c.fillStyle = "#FFD93B"; star4(c, s * .02, T0 - s * .31, s * .055); c.fill();
        c.fillStyle = "#8CC6EA"; star4(c, s * .3, T0 - s * .19, s * .065); c.fill();
        break;
      case "sprout":
        c.beginPath(); c.moveTo(0, T0 - s * .02); c.lineTo(0, T0 - s * .17); c.lineWidth = lw * 1.3; c.strokeStyle = OUT; c.stroke();
        c.beginPath(); c.moveTo(0, T0 - s * .17); c.bezierCurveTo(-s * .05, T0 - s * .3, -s * .2, T0 - s * .3, -s * .21, T0 - s * .2); c.bezierCurveTo(-s * .13, T0 - s * .13, -s * .05, T0 - s * .14, 0, T0 - s * .17); c.closePath(); fs("#7ED07A");
        c.beginPath(); c.moveTo(0, T0 - s * .17); c.bezierCurveTo(s * .05, T0 - s * .33, s * .2, T0 - s * .33, s * .22, T0 - s * .23); c.bezierCurveTo(s * .14, T0 - s * .15, s * .05, T0 - s * .15, 0, T0 - s * .17); c.closePath(); fs("#9BE08F");
        break;
      case "star":
        c.fillStyle = "#FFD93B"; star4(c, 0, T0 - s * .22, s * .11); c.fill(); c.lineWidth = lw * .9; c.strokeStyle = OUT; c.stroke();
        break;
      case "latte": // 거품 위 하트 라떼아트 + 김
        c.save(); c.translate(0, T0 + s * .005); c.scale(1, .5); c.fillStyle = "#E79A7B"; heart(c, 0, 0, s * .2); c.fill(); c.restore();
        c.lineWidth = lw * .9; c.strokeStyle = "rgba(255,255,255,.9)";
        [-.1, .08].forEach(function (dx) { c.beginPath(); c.moveTo(s * dx, T0 - s * .14); c.bezierCurveTo(s * (dx + .05), T0 - s * .2, s * (dx - .05), T0 - s * .26, s * dx, T0 - s * .32); c.stroke(); });
        c.fillStyle = "#FF5C7A"; heart(c, s * .3, T0 - s * .2, s * .09); c.fill();
        break;
    }

    // 소품
    var acc = spec.acc || [];
    if (acc.indexOf("glasses") >= 0) {
      c.lineWidth = lw * 1.05; c.strokeStyle = OUT;
      [-ex, ex].forEach(function (x) { c.beginPath(); c.arc(x, ey, s * .075, 0, Math.PI * 2); c.fillStyle = "rgba(255,255,255,.28)"; c.fill(); c.stroke(); });
      c.beginPath(); c.moveTo(-ex + s * .075, ey); c.lineTo(ex - s * .075, ey); c.stroke();
    }
    if (acc.indexOf("horn") >= 0) { // 뿔테 안경
      [-ex, ex].forEach(function (x) { rr(c, x - s * .088, ey - s * .068, s * .176, s * .136, s * .045); c.fillStyle = "rgba(255,255,255,.16)"; c.fill(); c.lineWidth = lw * 1.45; c.strokeStyle = "#2b1d14"; c.stroke(); });
      c.beginPath(); c.moveTo(-ex + s * .088, ey - s * .01); c.lineTo(ex - s * .088, ey - s * .01); c.lineWidth = lw * 1.45; c.strokeStyle = "#2b1d14"; c.stroke();
    }
    if (acc.indexOf("tie") >= 0) {
      var ty = s * .215;
      c.beginPath(); c.moveTo(-s * .035, ty); c.lineTo(s * .035, ty); c.lineTo(s * .02, ty + s * .035); c.lineTo(-s * .02, ty + s * .035); c.closePath(); fs(spec.tie || "#E5484D", lw * .8);
      c.beginPath(); c.moveTo(-s * .02, ty + s * .035); c.lineTo(s * .02, ty + s * .035); c.lineTo(s * .04, ty + s * .1); c.lineTo(0, ty + s * .125); c.lineTo(-s * .04, ty + s * .1); c.closePath(); fs(spec.tie || "#E5484D", lw * .8);
    }
    if (acc.indexOf("badge") >= 0) {
      rr(c, -s * .245, s * .215, s * .1, s * .085, s * .018); fs("#fff", lw * .8);
      c.fillStyle = spec.tie || "#FFBE2E"; c.fillRect(-s * .23, s * .23, s * .07, s * .022);
      c.fillStyle = "#cdbfae"; c.fillRect(-s * .23, s * .262, s * .07, s * .01); c.fillRect(-s * .23, s * .278, s * .045, s * .01);
    }

    // 팔
    function arm(x1, y1, qx, qy, x2, y2) {
      c.beginPath(); c.moveTo(s * x1, s * y1); c.quadraticCurveTo(s * qx, s * qy, s * x2, s * y2); c.lineWidth = lw * 3; c.strokeStyle = OUT; c.stroke();
      c.beginPath(); c.moveTo(s * x1, s * y1); c.quadraticCurveTo(s * qx, s * qy, s * x2, s * y2); c.lineWidth = lw * 1.4; c.strokeStyle = CUP; c.stroke();
      c.beginPath(); c.arc(s * x2, s * y2, s * .046, 0, Math.PI * 2); fs(CUP);
    }
    var LX = -BW + .015, LY = .17, RX = BW - .015, RY = .215;
    var Ld = function () { arm(LX, LY, -.4, .22, -.42, .31); }, Rd = function () { arm(RX, RY, .4, .27, .42, .34); };
    var Lh = function () { arm(LX, LY, -.5, .2, -.33, .31); }, Rh = function () { arm(RX, RY, .5, .25, .33, .33); };
    switch (spec.pose) {
      case "up": arm(LX, LY, -.44, .1, -.44, -.09); arm(RX, RY, .47, .14, .47, -.07); break;
      case "hip": Lh(); Rh(); break;
      case "heart":
        c.fillStyle = "#FF5C7A"; heart(c, 0, s * .305, s * .16); c.fill(); c.lineWidth = lw * .9; c.strokeStyle = OUT; c.stroke();
        arm(LX, LY, -.36, .33, -.105, .3); arm(RX, RY, .36, .36, .105, .3); break;
      case "cross": arm(LX, LY, -.3, .34, .1, .275); arm(RX, RY, .3, .36, -.1, .305); break;
      case "wave":
        Ld(); arm(RX, RY, .5, .16, .47, -.06);
        c.lineWidth = lw * .9; c.strokeStyle = OUT;
        c.beginPath(); c.arc(s * .47, -s * .06, s * .1, -Math.PI * .45, -Math.PI * .05); c.stroke();
        c.beginPath(); c.arc(s * .47, -s * .06, s * .145, -Math.PI * .42, -Math.PI * .08); c.stroke();
        break;
      case "peace":
        Lh(); arm(RX, RY, .5, .16, .46, -.05);
        c.lineWidth = lw * 2.4; c.strokeStyle = OUT;
        c.beginPath(); c.moveTo(s * .445, -s * .08); c.lineTo(s * .415, -s * .15); c.stroke(); c.beginPath(); c.moveTo(s * .475, -s * .08); c.lineTo(s * .505, -s * .15); c.stroke();
        c.lineWidth = lw * 1.1; c.strokeStyle = CUP;
        c.beginPath(); c.moveTo(s * .445, -s * .08); c.lineTo(s * .415, -s * .15); c.stroke(); c.beginPath(); c.moveTo(s * .475, -s * .08); c.lineTo(s * .505, -s * .15); c.stroke();
        break;
      case "think": Ld(); arm(RX, RY, .4, .38, .14, .25); break;
      case "point": Lh(); arm(RX, RY, .44, .18, .52, .05); break;
      default: Ld(); Rd();
    }
    c.restore();
  }
  /* 화면에 있는 <canvas> 하나에 캐릭터를 꽉 차게 그린다 */
  function drawOn(cv, spec) {
    if (!cv || !spec) return;
    var c = cv.getContext("2d"), w = cv.width;
    c.clearRect(0, 0, w, cv.height);
    mascot(c, w / 2, cv.height * .53, w * .86, spec);
  }

  /* ---------- 결과 이미지용 도구 ---------- */
  /* 말풍선 (꼬리는 왼쪽 아래 → 왼쪽에 있는 캐릭터를 가리킨다) */
  function speech(c, x, y, text, px, ink) {
    c.save(); c.font = "700 " + px + "px " + BODY;
    var w = c.measureText(text).width + px * 1.5, h = px * 2.1;
    c.beginPath(); c.moveTo(x + 6, y + h * .62); c.lineTo(x - px * .55, y + h * .86); c.lineTo(x + 6, y + h * .9); c.closePath(); c.fillStyle = "#fff"; c.fill(); c.lineWidth = 4; c.strokeStyle = OUT; c.stroke();
    rr(c, x, y, w, h, h / 2); c.fillStyle = "#fff"; c.fill(); c.lineWidth = 4; c.strokeStyle = OUT; c.stroke();
    c.fillStyle = "#fff"; c.fillRect(x + 1, y + h * .64, 8, h * .23); // 꼬리와 풍선 사이 선 지우기
    c.fillStyle = ink || OUT; c.textAlign = "left"; c.textBaseline = "middle"; c.fillText(text, x + px * .75, y + h / 2 + 1);
    c.restore(); return w;
  }
  /* 동그란 도장 */
  function stamp(c, x, y, r, l1, l2, color, rot) {
    c.save(); c.translate(x, y); c.rotate(rot || -.22); c.globalAlpha = .82;
    c.strokeStyle = color; c.fillStyle = color;
    c.lineWidth = r * .075; c.beginPath(); c.arc(0, 0, r, 0, Math.PI * 2); c.stroke();
    c.lineWidth = r * .03; c.setLineDash([r * .09, r * .07]); c.beginPath(); c.arc(0, 0, r * .84, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = "800 " + Math.round(r * .36) + "px " + BODY; c.fillText(l1, 0, l2 ? -r * .2 : 0);
    if (l2) { c.font = "800 " + Math.round(r * .3) + "px " + BODY; c.fillText(l2, 0, r * .24); }
    heart(c, 0, -r * .58, r * .2); c.fill();
    c.restore();
  }
  /* 파스텔 배경 + 흩뿌린 하트·별 */
  function backdrop(g, W, H, bg) {
    var grad = g.createLinearGradient(0, 0, W, H); grad.addColorStop(0, bg[0]); grad.addColorStop(1, bg[1]);
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    var s2 = 7; function r2() { s2 = (s2 * 1103515245 + 12345) >>> 0; return s2 / 4294967296; }
    for (var i = 0; i < 34; i++) {
      var x = r2() * W, y = r2() * H, z = 14 + r2() * 26;
      g.fillStyle = "rgba(255,255,255," + (0.35 + r2() * 0.35) + ")";
      if (i % 2) heart(g, x, y, z * 1.5); else star4(g, x, y, z);
      g.fill();
    }
  }
  /* 바코드 (글자마다 모양이 다르다) */
  function barcode(c, cx, y, w, h, seedStr, color) {
    var seed = 0; for (var i = 0; i < seedStr.length; i++) seed = (seed * 31 + seedStr.charCodeAt(i)) >>> 0;
    function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
    var bx = cx - w / 2; c.fillStyle = color;
    while (bx < cx + w / 2) { var bw = 3 + Math.floor(rnd() * 3) * 3; c.fillRect(bx, y, bw, h); bx += bw + 4 + Math.floor(rnd() * 3) * 3; }
  }

  /* ---------- 공유 ---------- */
  var kakaoReady = null;
  function loadKakao() {
    if (kakaoReady) return kakaoReady;
    kakaoReady = new Promise(function (res) {
      function done() { try { if (!window.Kakao) return res(false); if (!Kakao.isInitialized()) Kakao.init(KAKAO_KEY); res(!!(Kakao.Share && Kakao.Share.sendDefault)); } catch (e) { res(false); } }
      if (window.Kakao) return done();
      var s = document.createElement("script"); s.src = "https://t1.kakaocdn.net/kakao_js_sdk/2.7.4/kakao.min.js";
      s.onload = done; s.onerror = function () { res(false); }; document.head.appendChild(s);
      setTimeout(function () { res(false); }, 6000);
    });
    return kakaoReady;
  }
  async function copyUrl(url) {
    try { await navigator.clipboard.writeText(url); toast("링크를 복사했어요! 친구한테 붙여넣어 보내보세요 💌"); }
    catch (e) { window.prompt("아래 주소를 복사해서 보내주세요", url); } // 일부 앱 안 브라우저는 복사를 막는다
  }

  /* ============================================================
     테스트 진행
     cfg = { id(집계용 이름: coffee/work), store, path, og, fileName, questions, types, calc(answers)→{key,data},
             build({key,data,name})→canvas, detail(key,data,type), shareText(name,type),
             chem(friendKey,myKey)→{head,sub}, alt(name,type) }
     types[key] = { name, emoji, spec, nick, say, match:{key,reason}, ... }
     ============================================================ */
  function run(cfg) {
    var Q = cfg.questions, TYPES = cfg.types;
    var st = { step: 0, answers: [], key: null, data: null, name: "", blob: null };

    /* 친구가 보낸 링크: ?r=유형&n=이름 */
    var FRIEND = (function () {
      try { var p = new URLSearchParams(location.search), r = p.get("r"); if (!r || !TYPES[r]) return null; return { key: r, name: cleanName(p.get("n")) }; }
      catch (e) { return null; }
    })();

    function show(id) { ["intro", "quiz", "loading", "result"].forEach(function (p) { $(p).classList.add("hidden"); }); $(id).classList.remove("hidden"); window.scrollTo(0, 0); }
    function start() { st.step = 0; st.answers = []; show("quiz"); renderQ(); countEvent("start"); }
    function renderQ() {
      var item = Q[st.step];
      $("qcount").textContent = "Q" + (st.step + 1) + " / " + Q.length;
      $("progress").style.width = (st.step / Q.length * 100) + "%";
      $("qback").disabled = st.step === 0;
      $("qcat").textContent = item.cat;
      var qt = $("qtext"); qt.textContent = item.q; qt.classList.remove("fade"); void qt.offsetWidth; qt.classList.add("fade");
      var box = $("qopts"); box.innerHTML = "";
      item.a.forEach(function (o, i) {
        var b = document.createElement("button");
        b.className = "opt fade" + (st.answers[st.step] === i ? " on" : ""); b.style.animationDelay = (i * 45) + "ms";
        b.textContent = o.t; b.onclick = function () { answer(i, b); };
        box.appendChild(b);
      });
    }
    function answer(i, btn) {
      st.answers[st.step] = i;
      $("qopts").querySelectorAll("button").forEach(function (b) { b.disabled = true; b.classList.remove("on"); });
      btn.classList.add("on");
      setTimeout(function () { st.step++; if (st.step < Q.length) renderQ(); else finish(); }, 260);
    }
    function prev() { if (st.step > 0) { st.step--; renderQ(); } }
    // l(유형 이름)도 같이 기억한다 — 나중에 신청서(/matching)가 읽어서 '테스트결과' 칸에 넣는다
    function persist() { try { localStorage.setItem(cfg.store, JSON.stringify({ k: st.key, l: TYPES[st.key].name, d: st.data, n: st.name, t: Date.now() })); } catch (e) { } }
    // 발급 수 +1 (같은 기기에서는 하루에 한 번만). 저장소가 연결돼 있지 않으면 서버가 아무 일도 안 한다.
    function countOnce() {
      if (!cfg.id) return;
      try {
        var flag = "ssum_cnt_" + cfg.id, day = today();
        if (localStorage.getItem(flag) === day) return;
        localStorage.setItem(flag, day);
        fetch("/api/airtable?testcount=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test: cfg.id, type: st.key }), keepalive: true }).catch(function () { });
      } catch (e) { }
    }
    function finish() {
      $("progress").style.width = "100%";
      var r = cfg.calc(st.answers); st.key = r.key; st.data = r.data;
      persist();
      countOnce();
      drawOn($("load-m"), TYPES[st.key].spec);
      // 결과를 기다리는 1초 동안 캐릭터가 먼저 한마디 한다
      if ($("say-name")) $("say-name").textContent = TYPES[st.key].nick;
      if ($("say-text")) $("say-text").textContent = TYPES[st.key].say;
      show("loading");
      setTimeout(showResult, 1300);
    }
    function showSaved() {
      try {
        var d = JSON.parse(localStorage.getItem(cfg.store) || "null");
        if (!d || !TYPES[d.k] || !d.d) return;
        st.key = d.k; st.data = d.d; st.name = cleanName(d.n);
        $("progress").style.width = "100%";
        showResult();
      } catch (e) { }
    }
    function restart() { st.step = 0; st.answers = []; st.key = null; st.data = null; $("progress").style.width = "0%"; $("progress").parentNode.style.display = ""; watchDock(false); show("intro"); }

    function showResult() {
      var t = TYPES[st.key];
      $("r-type").textContent = t.name;
      cfg.detail(st.key, st.data, t);
      renderAll8();
      $("i-name").value = st.name;
      if (FRIEND) { // 친구 링크로 들어와서 끝낸 경우 — 둘의 케미
        var f = TYPES[FRIEND.key], who = FRIEND.name ? FRIEND.name + "님" : "친구";
        drawOn($("chem-a"), f.spec); drawOn($("chem-b"), t.spec);
        var ch = cfg.chem(FRIEND.key, st.key);
        $("chem-t").textContent = ch.head;
        $("chem-s").textContent = who + "(" + f.name + ") × 나(" + t.name + ") · " + ch.sub;
        // 링크를 보내준 친구는 내 결과를 아직 모른다 → 다시 보내게 해서 한 바퀴를 닫는다
        if ($("chem-send")) $("chem-send").textContent = "💌 " + who + "에게 내 결과 보내기";
        $("chem").classList.remove("hidden");
      }
      show("result");
      $("progress").parentNode.style.display = "none"; // 결과 화면에서는 진행 막대가 필요 없다
      watchDock(true);
      renderCard(true);
      loadKakao(); // 카톡 공유 버튼을 누를 때 바로 뜨도록 미리 준비
    }
    async function renderCard(animate) {
      // 귀여운 글꼴이 준비될 때까지 잠깐만 기다린다 (못 불러오면 기본 글꼴로 그린다)
      try { if (document.fonts && document.fonts.load) { await Promise.race([document.fonts.load("70px Jua", "가"), new Promise(function (r) { setTimeout(r, 1500); })]); } } catch (e) { }
      if (!st.key) return;
      var t = TYPES[st.key];
      var cv = cfg.build({ key: st.key, data: st.data, name: st.name });
      var img = $("card-img");
      img.alt = cfg.alt(st.name, t);
      img.src = cv.toDataURL("image/png");
      $("r-who").textContent = st.name ? st.name + "님" : "당신";
      var box = $("card"); box.classList.remove("go"); if (animate) { void box.offsetWidth; box.classList.add("go"); }
      st.blob = null;
      cv.toBlob(function (b) { st.blob = b; }, "image/png");
    }
    /* 8가지 유형 구경하기 — 내 유형에 표시 */
    function renderAll8() {
      var box = $("all8"); if (!box) return;
      box.innerHTML = "";
      Object.keys(TYPES).forEach(function (k) {
        var d = document.createElement("div"); if (k === st.key) d.className = "me";
        var cv = document.createElement("canvas"); cv.width = 150; cv.height = 150; cv.setAttribute("aria-hidden", "true");
        var b = document.createElement("b"); b.textContent = TYPES[k].name + (k === st.key ? " (나)" : "");
        d.appendChild(cv); d.appendChild(b); box.appendChild(d);
        drawOn(cv, TYPES[k].spec);
      });
      var me = box.querySelector(".me"); if (me) box.scrollLeft = Math.max(0, me.offsetLeft - 100);
    }
    /* 아래에 붙어 다니는 공유 버튼: 본문의 공유 버튼이 화면에 안 보일 때만 나온다 */
    var dockIo = null;
    function watchDock(on) {
      var dock = $("dock"), share = document.querySelector(".share .btn"); // 본문의 [이미지 저장] 버튼
      if (!dock || !share) return;
      if (dockIo) { dockIo.disconnect(); dockIo = null; }
      dock.classList.remove("on"); document.body.classList.toggle("docked", !!on);
      if (!on || !("IntersectionObserver" in window)) return;
      // 본문 버튼이 절반 넘게 보이면 숨기고, 아니면 아래에 붙여 보여준다
      dockIo = new IntersectionObserver(function (es) { var e = es[es.length - 1]; dock.classList.toggle("on", e.intersectionRatio < 0.5 && !$("result").classList.contains("hidden")); }, { threshold: [0, 0.5, 1] });
      dockIo.observe(share);
    }
    /* 어디서 사람들이 멈추는지 보는 숫자 (시작·저장·카톡·링크복사·신청). 저장소가 없으면 아무 일도 안 한다. 같은 기기는 하루 한 번. */
    function countEvent(name) {
      if (!cfg.id) return;
      try {
        var flag = "ssum_evt_" + cfg.id + "_" + name, day = today();
        if (localStorage.getItem(flag) === day) return;
        localStorage.setItem(flag, day);
        fetch("/api/airtable?testcount=1", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ test: cfg.id, type: "evt:" + name }), keepalive: true }).catch(function () { });
      } catch (e) { }
    }

    function applyName() {
      st.name = cleanName($("i-name").value);
      $("i-name").value = st.name;
      persist();
      renderCard(false);
      toast(st.name ? "이름을 넣었어요 ✏️" : "이름을 뺐어요");
    }

    function shareUrl() {
      var u = new URL(cfg.path, location.origin);
      u.searchParams.set("r", st.key);
      if (st.name) u.searchParams.set("n", st.name);
      return u.toString();
    }
    async function save() {
      countEvent("save");
      if (!st.blob) { toast("이미지를 준비 중이에요. 잠시 후 다시 눌러주세요"); return; }
      var file = new File([st.blob], cfg.fileName, { type: "image/png" });
      // 폰: 공유 창이 뜨고 거기서 '이미지 저장'이나 인스타그램 스토리를 고를 수 있다
      try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file] }); return; } }
      catch (e) { if (e && e.name === "AbortError") return; }
      try {
        var a = document.createElement("a"); a.href = URL.createObjectURL(st.blob); a.download = cfg.fileName;
        document.body.appendChild(a); a.click(); a.remove();
        toast("저장했어요! 안 됐다면 이미지를 꾹 눌러 저장해주세요");
      } catch (e) { toast("이미지를 꾹 눌러서 저장해주세요 📌"); }
    }
    function copy() { countEvent("copy"); return copyUrl(shareUrl()); }
    async function kakao() {
      countEvent("kakao");
      var url = shareUrl(), text = cfg.shareText(st.name, TYPES[st.key]);
      var ok = await loadKakao();
      if (ok) {
        try {
          Kakao.Share.sendDefault({
            objectType: "feed",
            content: { title: text, description: "10문항 · 1분. 해보면 둘의 케미도 나와요", imageUrl: location.origin + cfg.og, link: { mobileWebUrl: url, webUrl: url } },
            buttons: [{ title: "나도 해보기", link: { mobileWebUrl: url, webUrl: url } }]
          });
          return;
        } catch (e) { /* 아래 방법으로 넘어간다 */ }
      }
      try { if (navigator.share) { await navigator.share({ text: text, url: url }); return; } }
      catch (e) { if (e && e.name === "AbortError") return; }
      copyUrl(url);
    }
    function apply() {
      countEvent("apply");
      // from=test → 신청서의 '어떻게 알고 오셨어요?'에 '유형 테스트'가 자동으로 들어간다
      // friend → 링크를 보내준 친구 이름. "친구와 둘 다 매칭 성사 시 할인"을 센터장이 확인할 수 있게 신청서에 남긴다
      location.href = "/matching?from=test&result=" + encodeURIComponent(TYPES[st.key].name)
        + (FRIEND && FRIEND.name ? "&friend=" + encodeURIComponent(FRIEND.name) : "");
    }

    /* 처음 화면 준비 */
    document.querySelectorAll("canvas[data-m]").forEach(function (cv) { if (TYPES[cv.dataset.m]) drawOn(cv, TYPES[cv.dataset.m].spec); });
    if (FRIEND) {
      var f = TYPES[FRIEND.key];
      drawOn($("friend-m"), f.spec);
      $("friend-t").textContent = (FRIEND.name ? FRIEND.name + "님은 " : "친구는 ") + f.emoji + " " + f.name + "!";
      $("friend").classList.remove("hidden");
    }
    try {
      var d = JSON.parse(localStorage.getItem(cfg.store) || "null");
      if (d && TYPES[d.k] && d.d) {
        $("again-link").classList.remove("hidden");
        // 이미 해본 사람이 친구 링크로 들어온 경우 → 다시 풀지 않고 바로 둘의 케미를 볼 수 있게
        if (FRIEND && $("friend-go")) $("friend-go").classList.remove("hidden");
      }
    } catch (e) { }
    try { if (document.fonts && document.fonts.load) { document.fonts.load("20px Jua", "가").then(function () { if (juaReady()) document.documentElement.classList.add("jua"); }).catch(function () { }); } } catch (e) { }
    $("i-name").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); applyName(); e.target.blur(); } });

    return { start: start, prev: prev, showSaved: showSaved, restart: restart, applyName: applyName, save: save, kakao: kakao, copy: copy, apply: apply, state: st, friend: FRIEND, build: cfg.build };
  }

  window.SsumKit = { OUT: OUT, BODY: BODY, rr: rr, heart: heart, star4: star4, cuteFont: cuteFont, today: today, wrapLines: wrapLines, cleanName: cleanName, toast: toast, mascot: mascot, drawOn: drawOn, speech: speech, stamp: stamp, backdrop: backdrop, barcode: barcode, run: run };
})();
