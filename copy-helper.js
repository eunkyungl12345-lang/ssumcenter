/**
 * 어디서든 복사되게 하는 공용 코드.
 *
 * navigator.clipboard 는 아이폰 사파리에서 자주 막힌다(사용자 제스처 밖, 권한 등).
 * 예전에는 실패하면 "길게 눌러 복사해주세요" 토스트만 띄웠는데,
 * 정작 길게 누를 글자가 화면에 없어서 아무것도 할 수 없었다.
 *
 * 순서대로 시도한다.
 *   1) navigator.clipboard.writeText
 *   2) 숨은 textarea + execCommand("copy")   ← 구형 사파리에서 동작
 *   3) 그래도 안 되면 글자를 화면에 띄우고 전체 선택해준다 (길게 눌러 복사)
 */
(function () {
  function toastSafe(msg) {
    try { if (typeof toast === "function") { toast(msg); return; } } catch (_) {}
  }

  // 3단계: 복사할 글자를 보여주고 전체 선택해준다
  function showCopyBox(text) {
    var old = document.getElementById("copy-fallback");
    if (old) old.remove();

    var wrap = document.createElement("div");
    wrap.id = "copy-fallback";
    wrap.style.cssText =
      "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.85);display:flex;" +
      "align-items:center;justify-content:center;padding:18px";
    wrap.innerHTML =
      '<div style="background:#161615;border:1px solid #3a3a37;border-radius:16px;padding:16px;max-width:520px;width:100%">' +
      '<div style="color:#F5F5F3;font-size:13px;font-weight:800;margin-bottom:4px">복사할 내용이에요</div>' +
      '<div style="color:#9E9E97;font-size:11.5px;margin-bottom:10px">글자를 길게 눌러 <b>복사</b>를 선택하세요 (이미 전체 선택돼 있어요)</div>' +
      '<textarea id="copy-fallback-text" readonly rows="7" style="width:100%;background:#0D0D0C;border:1px solid #3a3a37;' +
      'border-radius:10px;padding:10px;color:#F5F5F3;font-size:13px;font-family:inherit;line-height:1.6;resize:vertical"></textarea>' +
      '<div style="display:flex;gap:8px;margin-top:10px">' +
      '<button id="copy-fallback-retry" style="flex:1;background:#E8B050;color:#000;border:none;border-radius:10px;' +
      'padding:11px;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">다시 복사 시도</button>' +
      '<button id="copy-fallback-close" style="flex:1;background:transparent;color:#9E9E97;border:1px solid #3a3a37;' +
      'border-radius:10px;padding:11px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">닫기</button>' +
      "</div></div>";
    document.body.appendChild(wrap);

    var ta = document.getElementById("copy-fallback-text");
    ta.value = text;
    try { ta.focus(); ta.setSelectionRange(0, text.length); } catch (_) {}

    document.getElementById("copy-fallback-close").onclick = function () { wrap.remove(); };
    document.getElementById("copy-fallback-retry").onclick = function () {
      try { ta.focus(); ta.setSelectionRange(0, text.length); document.execCommand("copy"); } catch (_) {}
      this.textContent = "복사했어요 (안 됐으면 길게 눌러주세요)";
    };
    wrap.addEventListener("click", function (e) { if (e.target === wrap) wrap.remove(); });
  }

  // 2단계: 숨은 textarea 로 복사
  function execCopy(text) {
    try {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, text.length);
      var ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch (_) { return false; }
  }

  window.copyText = function (text, okMsg) {
    text = String(text == null ? "" : text);
    if (!text) { toastSafe("복사할 내용이 없어요"); return; }
    var done = okMsg || "복사됐어요! 카톡에 붙여넣으세요";

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () { toastSafe(done); },
          function () { if (execCopy(text)) toastSafe(done); else showCopyBox(text); }
        );
        return;
      }
    } catch (_) {}

    if (execCopy(text)) toastSafe(done);
    else showCopyBox(text);
  };

  // 복사가 되든 안 되든 글자를 꼭 보고 싶을 때
  window.showCopyBox = showCopyBox;
})();
