/**
 * 🚨 틀린 관리자 비밀번호 → 슬랙 알림
 *
 * 관리자 비밀번호는 틀려도 횟수 제한이 없어서, 누가 계속 넣어보며 맞추려 해도 알 수가 없었다.
 * 이제 틀린 비밀번호가 들어오면 슬랙으로 알린다. (넣어본 비밀번호 자체는 절대 적지 않는다)
 *
 * - 처음 틀리면 바로 알림. 그 뒤 10분 동안은 모아서 세다가, 10·50·200회째에 "계속 시도 중" 알림.
 *   (서버가 여러 대로 나뉘어 돌 수 있어서 횟수는 대략이다)
 * - 비밀번호를 바꾼 직후에는 옛 비밀번호가 저장된 센터장 폰에서도 알림이 올 수 있다 → 그 기기에서 다시 로그인하면 멈춘다.
 * - 파일 이름이 `_` 로 시작해서 Vercel 함수 개수(12개 한도)에 들어가지 않는다.
 */
const { clientIp } = require("./_ratelimit.js");   // 시도 제한과 같은 방식으로 실제 접속 주소를 읽는다
const WINDOW = 10 * 60 * 1000;
const BURST = [10, 50, 200];
const state = { last: 0, count: 0 };

const WHERE = {
  "admin-auth": "관리자 로그인 화면",
  airtable: "신청·매칭 데이터",
  member: "회원 명부·칸 만들기",
  "send-sms": "문자 발송",
  vote: "투표 관리",
  activity: "활동 기록",
  content: "콘텐츠 관리",
};

function hdr(req, k) { const v = req && req.headers ? req.headers[k] : ""; return Array.isArray(v) ? v[0] : (v || ""); }

function whoText(req) {
  let city = hdr(req, "x-vercel-ip-city"); try { city = decodeURIComponent(city); } catch (e) {}
  const country = hdr(req, "x-vercel-ip-country");
  const ip = String(clientIp(req) || "");
  const ipShort = ip ? ip.split(".").slice(0, 2).join(".") + ".*.*" : "";   // 전체 IP는 적지 않는다
  const ua = hdr(req, "user-agent");
  const dev = /iPhone|iPad/.test(ua) ? "아이폰" : /Android/.test(ua) ? "안드로이드" : /Mac OS/.test(ua) ? "맥" : /Windows/.test(ua) ? "윈도우" : ua ? "기타 기기" : "알 수 없음";
  return [country && city ? `${country} ${city}` : (country || ""), ipShort, dev].filter(Boolean).join(" · ");
}

async function post(text) {
  const url = process.env.SLACK_WEBHOOK_URL; if (!url) return;
  try {
    const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    const t = ctl ? setTimeout(() => ctl.abort(), 2500) : null;
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }), signal: ctl ? ctl.signal : undefined });
    if (t) clearTimeout(t);
  } catch (e) { /* 알림 실패는 무시 */ }
}

async function reportBadAdmin(req, where, note) {
  const now = Date.now();
  const place = WHERE[where] || where || "관리 기능";
  const time = new Date(now + 9 * 3600 * 1000).toISOString().slice(5, 16).replace("T", " ");
  if (now - state.last > WINDOW) {
    const before = state.count; state.last = now; state.count = 1;
    await post(`🚨 틀린 관리자 비밀번호\n${time} (한국시간) · ${place}\n${whoText(req)}` + (before > 1 ? `\n(직전 10분 동안 ${before}회 있었어요)` : "")
      + (note ? `\n${note}` : "") + `\n센터장님이 잘못 누른 거면 괜찮아요. 아니라면 Vercel 에서 ADMIN_PASSWORD 를 길게 바꿔주세요.`);
    return;
  }
  state.count++;
  if (BURST.includes(state.count) || (note && state.count > 1)) {
    await post(`🚨🚨 관리자 비밀번호를 계속 틀리고 있어요 — 10분 안에 약 ${state.count}회\n${time} · ${place}\n${whoText(req)}\n누가 비밀번호를 맞춰보는 중일 수 있어요. Vercel 에서 ADMIN_PASSWORD 를 길게(12자 이상) 바꿔주세요.`);
  }
}

/** 요청에 관리자 비밀번호가 붙어 왔는데 틀렸으면 알린다 (손님 요청에는 비밀번호가 붙지 않는다) */
async function watchAdminKey(req, where) {
  const key = hdr(req, "x-admin-key");
  const pw = process.env.ADMIN_PASSWORD;
  if (key && pw && key !== pw) await reportBadAdmin(req, where);
}

module.exports = { watchAdminKey, reportBadAdmin, _state: state };
