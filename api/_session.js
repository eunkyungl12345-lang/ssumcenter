/**
 * 🔐 손님 로그인 확인표 (카카오 로그인)
 *
 * 예전에는 브라우저가 "내 카카오ID는 ○○"라고 말하기만 하면 서버가 그대로 믿었다.
 * 그래서 남의 카카오ID를 알면 그 사람 신청서(연락처·사진·재직서류)를 볼 수 있었다.
 * 이제 카카오 로그인이 끝날 때 서버가 서명한 확인표(t)를 내주고, 손님 정보 조회·수정 때 그 표를 확인한다.
 *
 * - 서명 열쇠: SESSION_SECRET 환경변수가 있으면 그것, 없으면 AIRTABLE_TOKEN 을 쓴다 (둘 다 서버에만 있다).
 * - 파일 이름이 `_` 로 시작해서 Vercel 함수 개수(12개 한도)에 들어가지 않는다.
 */
const crypto = require("crypto");

function secret() {
  return process.env.SESSION_SECRET || process.env.AIRTABLE_TOKEN || "";
}

function sign(id) {
  const k = secret();
  if (!k || !id) return "";
  return crypto.createHmac("sha256", k).update("ssum-user:" + String(id)).digest("hex").slice(0, 40);
}

function verify(id, t) {
  const good = sign(id);
  if (!good || !t || typeof t !== "string" || t.length !== good.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(good), Buffer.from(t)); } catch (e) { return false; }
}

module.exports = { sign, verify };
