// 네이버 검색광고 — 키워드 월간 검색량 가져오기
//
//  "썸류센터" 를 한 달에 몇 명이나 검색하는지, 어떤 소개팅 키워드가 뜨는지 본다.
//  광고를 집행하지 않아도 검색광고 계정만 있으면 무료로 쓸 수 있다.
//
//  환경변수 3개 (검색광고 사이트 → 도구 → API 사용 관리 에서 발급)
//    NAVER_AD_API_KEY      액세스라이선스
//    NAVER_AD_SECRET_KEY   비밀키
//    NAVER_AD_CUSTOMER_ID  고객 번호(CUSTOMER_ID)
//
//  ⚠️ 파일 이름이 _ 로 시작하면 Vercel 이 '함수'로 세지 않는다.
//     지금 함수가 12개(한도)로 꽉 차 있어서 새 함수를 만들면 배포가 안 된다.
//     그래서 공용 모듈로 두고 airtable.js 가 가져다 쓴다.
const crypto = require("crypto");

const HOST = "https://api.searchad.naver.com";
const PATH = "/keywordstool";

// 네이버는 키워드를 '공백 없이 대문자'로 맞춰서 돌려준다.
// 우리가 보낸 키워드와 응답을 짝지으려면 양쪽 다 같은 방식으로 다듬어야 한다.
function norm(k) {
  return String(k || "").replace(/\s+/g, "").toUpperCase();
}

// 검색량이 10 미만이면 숫자가 아니라 "< 10" 같은 문자열로 온다.
function toCount(v) {
  if (v == null) return 0;
  const n = Number(String(v).replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function authHeaders(method, path) {
  const KEY = process.env.NAVER_AD_API_KEY;
  const SECRET = process.env.NAVER_AD_SECRET_KEY;
  const CUSTOMER = process.env.NAVER_AD_CUSTOMER_ID;
  const ts = String(Date.now());
  const sign = crypto.createHmac("sha256", SECRET)
    .update(ts + "." + method + "." + path)
    .digest("base64");
  return {
    "X-Timestamp": ts,
    "X-API-KEY": KEY,
    "X-Customer": String(CUSTOMER),
    "X-Signature": sign,
    "Content-Type": "application/json; charset=UTF-8",
  };
}

/**
 * 키워드들의 월간 검색량을 가져온다.
 *   searchVolume(["썸류센터", "강남 소개팅"])
 *     → [{ keyword:"썸류센터", pc:120, mobile:1100, total:1220, found:true }, ...]
 *
 * 네이버는 한 번에 5개까지만 받아서, 5개씩 나눠 부른다.
 * 못 찾은 키워드는 found:false 로 돌려준다 (검색량이 거의 없는 키워드).
 */
async function searchVolume(keywords) {
  const KEY = process.env.NAVER_AD_API_KEY;
  const SECRET = process.env.NAVER_AD_SECRET_KEY;
  const CUSTOMER = process.env.NAVER_AD_CUSTOMER_ID;
  if (!KEY || !SECRET || !CUSTOMER) {
    throw new Error("네이버 검색광고 환경변수가 설정되지 않았습니다 (NAVER_AD_API_KEY / NAVER_AD_SECRET_KEY / NAVER_AD_CUSTOMER_ID)");
  }
  const list = (keywords || []).map((k) => String(k || "").trim()).filter(Boolean);
  if (!list.length) return [];

  const out = [];
  for (let i = 0; i < list.length; i += 5) {
    const chunk = list.slice(i, i + 5);
    // hintKeywords 는 공백을 빼서 보내야 제대로 찾는다.
    const qs = "hintKeywords=" + encodeURIComponent(chunk.map(norm).join(",")) + "&showDetail=1";
    const r = await fetch(HOST + PATH + "?" + qs, { headers: authHeaders("GET", PATH) });
    const body = await r.text();
    if (!r.ok) {
      let why = body.slice(0, 200);
      try { const d = JSON.parse(body); why = d.title || d.message || why; } catch (_) {}
      throw new Error("네이버 검색광고 응답 오류 (" + r.status + ") " + why);
    }
    let data = null;
    try { data = JSON.parse(body); } catch (_) {
      throw new Error("네이버 검색광고 응답을 읽지 못했습니다: " + body.slice(0, 120));
    }
    const rel = (data && data.keywordList) || [];
    // 응답에는 '연관 키워드'까지 잔뜩 들어오므로, 우리가 물어본 것만 골라낸다.
    const byName = new Map();
    for (const row of rel) byName.set(norm(row.relKeyword), row);
    for (const k of chunk) {
      const row = byName.get(norm(k));
      if (!row) { out.push({ keyword: k, pc: 0, mobile: 0, total: 0, found: false }); continue; }
      const pc = toCount(row.monthlyPcQcCnt);
      const mobile = toCount(row.monthlyMobileQcCnt);
      out.push({ keyword: k, pc, mobile, total: pc + mobile, found: true });
    }
  }
  return out;
}

/**
 * 설정 점검 — 검색량을 못 가져올 때 '어디서 막혔는지' 알려준다.
 * (문자 점검 checkSmsConfig 과 같은 방식)
 */
async function checkNaverConfig() {
  const KEY = process.env.NAVER_AD_API_KEY;
  const SECRET = process.env.NAVER_AD_SECRET_KEY;
  const CUSTOMER = process.env.NAVER_AD_CUSTOMER_ID;
  const out = {
    "환경변수 NAVER_AD_API_KEY": KEY ? "✅ 설정됨" : "❌ 없음",
    "환경변수 NAVER_AD_SECRET_KEY": SECRET ? "✅ 설정됨" : "❌ 없음",
    "환경변수 NAVER_AD_CUSTOMER_ID": CUSTOMER ? "✅ " + CUSTOMER : "❌ 없음",
  };
  if (!KEY || !SECRET || !CUSTOMER) {
    out["결론"] = "❌ 환경변수가 빠져 있어요. 그래서 네이버까지 요청이 가지 않습니다.";
    return out;
  }
  try {
    const r = await searchVolume(["썸류센터"]);
    const v = r[0];
    out["시험 조회"] = v && v.found
      ? "✅ '썸류센터' 월 " + (v.total).toLocaleString() + "회"
      : "⚠️ 연결은 됐는데 '썸류센터' 검색량이 잡히지 않아요 (검색량이 아주 적으면 이렇게 나와요)";
    out["결론"] = "✅ 네이버 검색량을 가져올 수 있어요.";
  } catch (e) {
    out["시험 조회"] = "❌ " + e.message;
    out["결론"] = "❌ " + (/401|403|signature|Unauthorized/i.test(e.message)
      ? "키가 틀렸거나 서명이 안 맞아요. 액세스라이선스·비밀키·고객번호를 다시 확인해주세요."
      : "네이버에 연결하지 못했어요.");
  }
  return out;
}

module.exports = { searchVolume, checkNaverConfig, norm, toCount };
