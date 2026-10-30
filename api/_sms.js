// 공용 SMS 발송 헬퍼 (솔라피)
//  - send-sms.js(관리자 수동 발송)와 airtable.js(접수 자동 발송)에서 공통 사용
//  - 환경변수: SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_SENDER
const { SolapiMessageService } = require("solapi");

// 전화번호 유효성: 숫자만 9자리 이상이면 유효한 것으로 간주 (예: 01012345678)
function isValidPhone(to) {
  return /^[0-9]{9,}$/.test(String(to || "").replace(/[^0-9]/g, ""));
}

// 문자 발송. 성공 시 솔라피 결과, 실패 시 throw.
async function sendSms({ to, text }) {
  const API_KEY = process.env.SOLAPI_API_KEY;
  const API_SECRET = process.env.SOLAPI_API_SECRET;
  const SENDER = process.env.SOLAPI_SENDER;
  if (!API_KEY || !API_SECRET || !SENDER) {
    throw new Error("솔라피 환경변수가 설정되지 않았습니다");
  }
  if (!to || !text) throw new Error("수신번호와 메시지 내용이 필요합니다");

  const svc = new SolapiMessageService(API_KEY, API_SECRET);
  const result = await svc.send([{
    to: String(to).replace(/[^0-9]/g, ""),
    from: String(SENDER).replace(/[^0-9]/g, ""),
    text,
  }]);

  // ⚠️ 솔라피는 '접수 실패'를 예외로 던지지 않는다.
  // 발신번호 미등록 · 잔액 부족 · 수신거부 같은 경우에도 호출 자체는 성공으로 돌아오고,
  // 결과 안의 registeredFailed / failedMessageList 에만 표시된다.
  // 이걸 확인하지 않으면 "✅ 문자 보냈어요"라고 떠놓고 실제로는 아무것도 안 간다.
  const failedList = (result && result.failedMessageList) || [];
  const cnt = (result && result.groupInfo && result.groupInfo.count) || {};
  if (failedList.length || Number(cnt.registeredFailed) > 0) {
    const f = failedList[0] || {};
    const why = [f.statusMessage, f.statusCode].filter(Boolean).join(" ")
      || "솔라피가 접수를 거부했어요 (발신번호 등록 · 잔액 · 수신거부 확인 필요)";
    throw new Error("문자 접수 실패: " + why);
  }
  return result;
}


/**
 * 문자 설정 점검 — 문자를 보내지 않고 "지금 보낼 수 있는 상태인지"만 확인한다.
 * 관리자 상태판(/api/send-sms {check:true})과 아침 브리핑에서 함께 쓴다.
 * 돌려주는 값의 "결론" 이 ✅ 로 시작하면 정상이다.
 */
async function checkSmsConfig() {
  const KEY = process.env.SOLAPI_API_KEY;
  const SECRET = process.env.SOLAPI_API_SECRET;
  const SENDER = process.env.SOLAPI_SENDER;
  const out = {
    "환경변수 SOLAPI_API_KEY": KEY ? "✅ 설정됨" : "❌ 없음",
    "환경변수 SOLAPI_API_SECRET": SECRET ? "✅ 설정됨" : "❌ 없음",
    "환경변수 SOLAPI_SENDER": SENDER ? "✅ " + SENDER : "❌ 없음",
  };
  if (!KEY || !SECRET || !SENDER) {
    out["결론"] = "❌ 환경변수가 빠져 있어요. 그래서 솔라피까지 요청이 가지 않습니다.";
    return out;
  }

  // 솔라피 REST 인증 헤더 (HMAC-SHA256)
  const crypto = require("crypto");
  const authHeader = () => {
    const date = new Date().toISOString();
    const salt = crypto.randomBytes(32).toString("hex");
    const signature = crypto.createHmac("sha256", SECRET).update(date + salt).digest("hex");
    return `HMAC-SHA256 apiKey=${KEY}, date=${date}, salt=${salt}, signature=${signature}`;
  };
  const call = async (url) => {
    const r = await fetch(url, { headers: { Authorization: authHeader() } });
    const body = await r.text();
    let d = null; try { d = JSON.parse(body); } catch (_) {}
    return { ok: r.ok, status: r.status, data: d, raw: body.slice(0, 200) };
  };

  try {
    const bal = await call("https://api.solapi.com/cash/v1/balance");
    if (!bal.ok) {
      out["API 키"] = "❌ 인증 실패 (" + bal.status + ") " + ((bal.data && (bal.data.errorMessage || bal.data.message)) || bal.raw);
      out["결론"] = "❌ API 키가 틀렸거나 IP 제한에 막혔어요. 그래서 솔라피까지 요청이 가지 않습니다.";
      return out;
    }
    out["API 키"] = "✅ 정상";
    const point = (bal.data && (bal.data.balance != null ? bal.data.balance : bal.data.point));
    out["잔액"] = (point != null ? point + "원" : JSON.stringify(bal.data));
    // 잔액 0원도 문자가 안 나가는 '원인'이므로 ❌로 표시한다 (경고로 두면 결론이 '정상'으로 나온다)
    if (point != null && Number(point) <= 0) out["잔액"] = "❌ " + point + "원 — 충전이 필요해요. 잔액이 없으면 문자가 나가지 않습니다";

    const nums = await call("https://api.solapi.com/senderid/v1/numbers?limit=100");
    if (nums.ok) {
      const list = ((nums.data && (nums.data.numberList || nums.data.senderIdList || nums.data.data)) || [])
        .map((n) => String(n.phoneNumber || n.number || n).replace(/[^0-9]/g, ""))
        .filter(Boolean);
      const mine = String(SENDER).replace(/[^0-9]/g, "");
      out["등록된 발신번호"] = list.length ? list.join(", ") : "없음";
      out["발신번호 등록 여부"] = list.includes(mine)
        ? "✅ " + mine + " 등록돼 있어요"
        : "❌ " + mine + " 가 등록 목록에 없어요 — 솔라피에서 발신번호 등록이 필요합니다";
    } else {
      out["발신번호 조회"] = "확인 불가 (" + nums.status + ")";
    }

    const bad = Object.values(out).some((v) => String(v).startsWith("❌"));
    out["결론"] = bad ? "❌ 위에 ❌ 표시된 항목이 원인이에요." : "✅ 설정은 정상이에요. 실제 발송을 한 번 해보세요.";
    return out;
  } catch (e) {
    out["결론"] = "❌ 솔라피에 연결하지 못했어요: " + e.message;
    return out;
  }
}

module.exports = { sendSms, isValidPhone, checkSmsConfig };
