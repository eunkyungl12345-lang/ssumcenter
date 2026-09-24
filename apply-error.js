/**
 * 신청 실패 원인을 화면에 제대로 보여주기 위한 공용 코드.
 *
 * 예전에는 신청 폼이 서버가 돌려준 진짜 실패 이유를 버리고
 *   alert("신청 중 오류가 발생했습니다. 다시 시도해주세요.")
 * 만 띄웠다. 그래서 회원도 센터장도 무엇이 문제인지 알 수 없었다.
 *
 * 사용법 (신청 폼에서):
 *   if(!res.ok) throw new Error(await applyFailReason(res));
 *   ...
 *   catch(err){ applyFailAlert(err); }
 */
(function () {
  // Airtable이 돌려주는 영어 오류를 센터장·회원이 알아볼 수 있는 말로 바꾼다
  function translate(raw) {
    var m = String(raw || "");

    // 단일선택(회차 등)에 없는 값을 보냈을 때 — 새 회차를 열었을 때 제일 흔한 원인
    if (/select option|INVALID_MULTIPLE_CHOICE_OPTIONS/i.test(m)) {
      var opt = (m.match(/option\s*"?([^"]+)"?/i) || [])[1] || "";
      return "신청서의 선택 항목 값이 아직 등록되지 않았어요."
        + (opt ? '\n(문제되는 값: "' + opt.trim() + '")' : "")
        + "\n보통 '회차'가 원인이에요. 센터장에게 알려주세요!";
    }
    if (/Unknown field name/i.test(m)) {
      var f = (m.match(/Unknown field name:\s*"([^"]+)"/i) || [])[1] || "";
      return "신청서 항목 이름이 맞지 않아요" + (f ? ' ("' + f + '")' : "") + ".\n센터장에게 알려주세요!";
    }
    if (/필수입니다/.test(m)) return m;
    if (/AUTHENTICATION|UNAUTHORIZED|NOT_AUTHORIZED/i.test(m)) {
      return "서버 인증에 문제가 있어요. 센터장에게 알려주세요!";
    }
    if (/환경변수/.test(m)) return "서버 설정에 문제가 있어요. 센터장에게 알려주세요!";
    return m || "알 수 없는 오류";
  }

  // 실패한 응답에서 진짜 이유를 뽑아낸다
  window.applyFailReason = async function (res) {
    var raw = "";
    try {
      var d = await res.json();
      var e = d && d.error;
      raw = (e && (e.message || e.type || e)) || (d && d.message) || "";
      if (typeof raw !== "string") raw = JSON.stringify(raw);
    } catch (_) {}
    if (!raw) raw = "서버 응답 오류 (" + (res && res.status) + ")";
    var nice = translate(raw);
    return nice === raw ? raw : nice + "\n\n[자세히] " + raw;
  };

  window.applyFailAlert = function (err) {
    var why = (err && err.message) ? err.message : String(err || "");
    alert("신청 중 오류가 발생했어요 😢\n\n" + (why || "알 수 없는 오류")
      + "\n\n다시 시도해주시고, 계속 같은 오류가 나면\n이 화면을 캡처해서 센터장에게 보내주세요!");
  };
})();
