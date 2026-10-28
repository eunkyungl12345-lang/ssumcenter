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

module.exports = { sendSms, isValidPhone };
