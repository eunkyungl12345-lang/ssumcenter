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
  return svc.send([{
    to: String(to).replace(/[^0-9]/g, ""),
    from: String(SENDER).replace(/[^0-9]/g, ""),
    text,
  }]);
}

module.exports = { sendSms, isValidPhone };
