/**
 * 🔑 관리자 비밀번호 확인 (/api/admin-auth)
 *
 * 예전에는 틀린 비밀번호를 몇 번이든 계속 시도할 수 있었다.
 * 비밀번호 하나면 손님 전체(연락처·사진·재직서류)와 문자 발송까지 열리므로,
 * 이제 같은 IP에서 연속으로 틀리면 잠시 잠근다 (api/_ratelimit.js).
 *
 * - 10분에 10번까지 틀릴 수 있고, 10번째에 닿으면 5분 동안 잠긴다 (잠금 중엔 맞는 비밀번호도 받지 않는다).
 * - 성공하면 그 IP의 실패 기록은 지워진다 (오타 몇 번은 그냥 넘어간다).
 * - 잠겼을 때는 429 + Retry-After(초) 로 알려준다. 화면은 이 값을 읽어 몇 초 뒤에 다시 하라고 안내한다.
 *
 * CORS: 이 확인은 관리자 페이지들에서만 부른다(같은 사이트). 예전엔 모든 사이트에 열어줘서(*)
 *       아무 웹사이트나 방문자의 브라우저로 비밀번호를 계속 찔러볼 수 있었다. 이제 열어주지 않는다.
 */
const { clientIp, check, fail, clear, safeEqual } = require("./_ratelimit.js");
const { reportBadAdmin } = require("./_guard.js");   // 🚨 틀린 비밀번호 → 슬랙 알림
// 슬랙 알림은 응답을 늦추지 않게 뒤에서 보낸다 (Vercel 이 응답 뒤에도 끝까지 보내게 waitUntil 로 맡긴다)
let later = (p) => { if (p && p.catch) p.catch(() => {}); };
try { const vf = require("@vercel/functions"); if (vf && vf.waitUntil) later = (p) => vf.waitUntil(p.catch(() => {})); } catch (e) {}

const LIMIT = { max: 10, windowMs: 10 * 60 * 1000, lockMs: 5 * 60 * 1000 };
const NAME = "admin-auth";

function fail429(res, retryAfter) {
  res.setHeader("Retry-After", String(retryAfter));
  const mins = Math.ceil(retryAfter / 60);
  return res.status(429).json({
    ok: false,
    error: `비밀번호를 너무 여러 번 틀렸어요. ${mins}분 뒤에 다시 시도해주세요.`,
    retryAfter,
  });
}

module.exports = function handler(req, res) {
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST로만 확인할 수 있어요" });

  const ip = clientIp(req);
  const now = check(NAME, ip, LIMIT);
  if (now.blocked) return fail429(res, now.retryAfter);

  const { password } = req.body || {};
  const ADMIN_PW = process.env.ADMIN_PASSWORD;

  if (!ADMIN_PW) return res.status(500).json({ error: "서버 환경변수 미설정" });

  if (safeEqual(password, ADMIN_PW)) {
    clear(NAME, ip);
    return res.status(200).json({ ok: true });
  }

  const after = fail(NAME, ip, LIMIT);
  // 🚨 틀린 비밀번호 → 슬랙 알림 (넣어본 비밀번호는 적지 않는다). 잠금에 걸리면 그것도 알린다.
  if (password) later(reportBadAdmin(req, "admin-auth", after.blocked ? "🔒 10번 틀려서 이 접속 주소는 5분 동안 잠겼어요." : ""));
  if (after.blocked) return fail429(res, after.retryAfter);
  return res.status(401).json({ ok: false, error: "비밀번호가 틀렸습니다" });
};
