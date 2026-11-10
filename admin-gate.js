/**
 * 센터장 전용 문서 잠금
 *
 * 진행 대본·업무 흐름·관리자 링크 모음 같은 내부 문서가 누구나 열리고 검색에도 걸려 있었다.
 * <head> 에서 이 파일을 불러오면, 관리자 로그인이 안 된 기기에서는 비밀번호부터 묻는다.
 *
 * - 다른 관리자 페이지와 같은 방식이다: /api/admin-auth 로 확인 → localStorage 의 admin_key 에 저장.
 *   한 번 로그인한 기기에서는 다시 묻지 않는다.
 * - ⚠️ 화면을 가리는 잠금이다. 이 사이트는 정적 페이지라 문서 내용 자체는 파일에 들어 있다.
 *   그래서 비밀번호·계좌 비밀 같은 진짜 민감한 정보는 이런 문서에 적으면 안 된다.
 */
(function () {
  var KEY = "admin_key";
  var has = false;
  try { has = !!localStorage.getItem(KEY); } catch (e) {}
  if (has) return;

  // 내용이 잠깐이라도 보이지 않게 먼저 가린다
  var hide = document.createElement("style");
  hide.id = "admin-gate-hide";
  hide.textContent = "body > *:not(#admin-gate){display:none !important}";
  document.documentElement.appendChild(hide);

  function open() {
    var box = document.createElement("div");
    box.id = "admin-gate";
    box.style.cssText = "position:fixed;inset:0;z-index:99999;background:#0e0c0a;color:#f5f0ea;display:flex;align-items:center;justify-content:center;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo',system-ui,sans-serif";
    box.innerHTML =
      '<div style="width:100%;max-width:340px;text-align:center">'
      + '<div style="font-size:40px;margin-bottom:14px">🔒</div>'
      + '<div style="font-size:18px;font-weight:800;margin-bottom:6px">센터장 전용 문서예요</div>'
      + '<div style="font-size:13px;color:#9a9080;line-height:1.6;margin-bottom:18px">관리자 비밀번호를 입력해주세요.<br>한 번 입력하면 이 기기에서는 다시 묻지 않아요.</div>'
      + '<input id="admin-gate-pw" type="password" autocomplete="current-password" placeholder="비밀번호" style="width:100%;box-sizing:border-box;background:#16140f;border:1px solid #2a261e;border-radius:12px;color:#fff;font-size:16px;padding:13px 14px;outline:none">'
      + '<button id="admin-gate-btn" style="width:100%;margin-top:10px;background:#E8B050;color:#000;border:none;font-weight:800;font-size:15px;padding:13px;border-radius:12px;cursor:pointer">열기</button>'
      + '<div id="admin-gate-msg" style="font-size:12.5px;color:#ffb4b4;margin-top:10px;min-height:18px"></div>'
      + '<a href="/" style="display:inline-block;margin-top:14px;font-size:12.5px;color:#6b6358;text-decoration:none">← 썸류센터 홈으로</a>'
      + '</div>';
    document.body.appendChild(box);

    var pw = document.getElementById("admin-gate-pw");
    var btn = document.getElementById("admin-gate-btn");
    var msg = document.getElementById("admin-gate-msg");
    function go() {
      var v = pw.value;
      if (!v) return;
      btn.disabled = true; btn.textContent = "확인 중…"; msg.textContent = "";
      fetch("/api/admin-auth", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: v }) })
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d && d.ok) {
            try { localStorage.setItem(KEY, v); } catch (e) {}
            box.remove();
            var h = document.getElementById("admin-gate-hide"); if (h) h.remove();
          } else {
            btn.disabled = false; btn.textContent = "열기";
            msg.textContent = "비밀번호가 틀렸어요.";
          }
        })
        .catch(function () {
          btn.disabled = false; btn.textContent = "열기";
          msg.textContent = "오류가 났어요. 잠시 후 다시 해주세요.";
        });
    }
    btn.addEventListener("click", go);
    pw.addEventListener("keydown", function (e) { if (e.key === "Enter") go(); });
    pw.focus();
  }
  if (document.body) open();
  else document.addEventListener("DOMContentLoaded", open);
})();
